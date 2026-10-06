-- Stage 114 — three-hour counted visits.
-- MANUAL APPLY ONLY. Do not run this from an agent task. Do not apply it
-- to production until this file has been reviewed. It does not apply
-- STAGE100, STAGE101, or STAGE8, and it does not delete analytics_events.
--
-- Counting rule, enforced with server now() inside one transaction:
--   The first public page_view for a persistent browser id counts.
--   Another public page_view counts only when it is at least 3 hours after
--   the previous COUNTED visit. Reloads, navigation, and other tabs inside
--   that window add nothing, and they do not move the window.
--   At exactly 3 hours, the next page_view counts. The window crosses midnight.
--   The identity is the existing visitor_id UUID. Sign-in does not change it.
--   This is not a count of verified people or of distinct browsers per day.
--
-- Book views, cart adds, WhatsApp clicks, and other events are still stored.
-- Only a public page_view can open a counted visit. /admin.html and
-- /book-staff.html are excluded, matching the storefront recorder.
-- Rows without a UUID v4 visitor_id or an event_id are stored and not counted.
-- The same event_id is accepted once, including a concurrent or retried insert.
--
-- Collection starts at private.analytics_visit_counter.started_at, set on the
-- first successful apply and left unchanged when this file is applied again.
-- Older analytics_events rows stay in place. They are not backfilled.
-- An interval entirely before that marker is unavailable, including an empty
-- one. Missing old rows are not a measured zero. An interval that crosses
-- the marker is partial even when it has no pre-start row. Only a fully
-- covered post-start interval may be zero or complete. A valid public
-- page_view with no receipt is a processing gap and stays partial. A receipt
-- with counted = false is a suppressed visit, not a gap.
--
-- Deployment order:
--   The site can ship first. Until these columns exist, the browser omits
--   visitor_id and event_id and still stores the page view. The admin page
--   shows the new metric as unavailable, not zero, while the rolling-window
--   event totals keep working.
--   Apply this file once in the Supabase SQL editor after review. New public
--   page views then start the 3-hour count. No site deploy is required for
--   the recorder: current analytics.js already sends both ids and drops them
--   only while PostgREST says the columns are missing.
--   The admin labels need the site that reads counted_visits. An older admin
--   page ignores that JSON key and keeps the previous event cards.
--
-- Rollback: STAGE114_THREE_HOUR_VISITS_ROLLBACK.sql, run by itself.
--   It restores the previous rolling-window function, drops the trigger and
--   the private visit tables, and leaves analytics_events rows, visitor_id,
--   and event_id in place.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS visitor_id text;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS event_id uuid;

DO $shape$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analytics_events_visitor_id_shape'
      AND conrelid = 'public.analytics_events'::regclass
  ) THEN
    ALTER TABLE public.analytics_events
      ADD CONSTRAINT analytics_events_visitor_id_shape
      CHECK (
        visitor_id IS NULL
        OR visitor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      );
  END IF;
END
$shape$;

CREATE TABLE IF NOT EXISTS private.analytics_visit_counter (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  started_at timestamptz NOT NULL
);

INSERT INTO private.analytics_visit_counter (id, started_at)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.analytics_visit_gate (
  visitor_id text PRIMARY KEY,
  last_counted_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS private.analytics_visit_receipts (
  event_id uuid PRIMARY KEY,
  visitor_id text NOT NULL,
  counted boolean NOT NULL,
  counted_at timestamptz,
  CONSTRAINT analytics_visit_receipts_counted_at_ck CHECK (
    (counted AND counted_at IS NOT NULL)
    OR (NOT counted AND counted_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS analytics_visit_receipts_counted_at_idx
  ON private.analytics_visit_receipts (counted_at)
  WHERE counted;

ALTER TABLE private.analytics_visit_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_visit_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_visit_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.analytics_visit_counter FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_visit_gate FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_visit_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.kutadgu_analytics_public_path(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $path$
  SELECT NOT (
    lower(split_part(coalesce(p_path, ''), '?', 1)) ~ '(^|/)admin\.html$'
    OR lower(split_part(coalesce(p_path, ''), '?', 1)) ~ '(^|/)book-staff\.html$'
  );
$path$;

CREATE OR REPLACE FUNCTION private.kutadgu_visitor_id_ok(p_id text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $id$
  SELECT coalesce(p_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$id$;

CREATE OR REPLACE FUNCTION private.kutadgu_visit_status_json(p_status text, p_visits integer)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $json$
  SELECT jsonb_build_object('status', p_status) || CASE
    WHEN p_visits IS NULL THEN '{"visits":null}'::jsonb
    ELSE jsonb_build_object('visits', p_visits)
  END;
$json$;

-- p_at is server time. The trigger passes now(). Tests may pass a clock.
-- A direct grant is not given to anon or authenticated.
CREATE OR REPLACE FUNCTION private.kutadgu_accept_page_visit(
  p_visitor_id text,
  p_event_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $accept$
DECLARE
  v_visitor text := lower(coalesce(p_visitor_id, ''));
  v_at timestamptz := coalesce(p_at, now());
  v_existing boolean;
  v_counted boolean := false;
BEGIN
  IF p_event_id IS NULL OR NOT private.kutadgu_visitor_id_ok(v_visitor) THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_visitor, 0));

  SELECT counted INTO v_existing
  FROM private.analytics_visit_receipts
  WHERE event_id = p_event_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO private.analytics_visit_gate AS g (visitor_id, last_counted_at)
  VALUES (v_visitor, v_at)
  ON CONFLICT (visitor_id) DO UPDATE
    SET last_counted_at = EXCLUDED.last_counted_at
    WHERE g.last_counted_at <= v_at - interval '3 hours'
  RETURNING true INTO v_counted;
  IF NOT FOUND THEN
    v_counted := false;
  END IF;

  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at)
  VALUES (
    p_event_id,
    v_visitor,
    v_counted,
    CASE WHEN v_counted THEN v_at ELSE NULL END
  );

  RETURN v_counted;
EXCEPTION
  WHEN unique_violation THEN
    SELECT counted INTO v_existing
    FROM private.analytics_visit_receipts
    WHERE event_id = p_event_id;
    RETURN coalesce(v_existing, false);
END;
$accept$;

CREATE OR REPLACE FUNCTION private.kutadgu_count_page_visit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $count$
BEGIN
  IF NEW.event_name IS DISTINCT FROM 'page_view' THEN
    RETURN NEW;
  END IF;
  IF NOT private.kutadgu_analytics_public_path(NEW.path) THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM private.kutadgu_accept_page_visit(NEW.visitor_id, NEW.event_id, now());
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NEW;
  END;
  RETURN NEW;
END;
$count$;

DROP TRIGGER IF EXISTS analytics_events_count_page_visit ON public.analytics_events;
CREATE TRIGGER analytics_events_count_page_visit
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW
  WHEN (NEW.event_name = 'page_view')
  EXECUTE FUNCTION private.kutadgu_count_page_visit();

CREATE OR REPLACE FUNCTION private.kutadgu_visit_window_status(
  p_start timestamptz,
  p_end timestamptz,
  p_started timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $status$
DECLARE
  v_counted integer := 0;
  v_public_page_views integer := 0;
  v_unidentified integer := 0;
  v_unprocessed integer := 0;
BEGIN
  SELECT count(*)::integer INTO v_counted
  FROM private.analytics_visit_receipts
  WHERE counted
    AND counted_at >= p_start
    AND counted_at < p_end;

  -- Entirely before collection. An empty interval is still unavailable.
  IF p_started IS NULL OR p_end <= p_started THEN
    RETURN private.kutadgu_visit_status_json('unavailable', NULL);
  END IF;

  -- The interval contains time before collection, even with no pre-start row.
  IF p_start < p_started THEN
    RETURN private.kutadgu_visit_status_json('partial', v_counted);
  END IF;

  SELECT
    count(*) FILTER (WHERE event_name = 'page_view')::integer,
    count(*) FILTER (
      WHERE event_name = 'page_view'
        AND (
          NOT private.kutadgu_visitor_id_ok(visitor_id)
          OR event_id IS NULL
        )
    )::integer,
    count(*) FILTER (
      WHERE event_name = 'page_view'
        AND private.kutadgu_visitor_id_ok(visitor_id)
        AND event_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM private.analytics_visit_receipts AS r
          WHERE r.event_id = public.analytics_events.event_id
        )
    )::integer
  INTO v_public_page_views, v_unidentified, v_unprocessed
  FROM public.analytics_events
  WHERE created_at >= p_start
    AND created_at < p_end
    AND private.kutadgu_analytics_public_path(path);

  IF v_unidentified > 0 OR v_unprocessed > 0 THEN
    RETURN private.kutadgu_visit_status_json('partial', v_counted);
  ELSIF v_public_page_views = 0 AND v_counted = 0 THEN
    RETURN private.kutadgu_visit_status_json('zero', 0);
  ELSE
    RETURN private.kutadgu_visit_status_json('complete', v_counted);
  END IF;
END;
$status$;

CREATE OR REPLACE FUNCTION private.kutadgu_counted_visit_report(p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $report$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_yesterday date := v_today - 1;
  v_range_start date := v_today - (v_days - 1);
  v_chart_start date := v_today - 6;
  v_started timestamptz;
  v_daily jsonb;
BEGIN
  SELECT started_at INTO v_started
  FROM private.analytics_visit_counter
  WHERE id;

  SELECT coalesce(jsonb_agg(item ORDER BY day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      d::date AS day,
      private.kutadgu_visit_window_status(
        d::timestamp AT TIME ZONE 'Europe/Istanbul',
        (d::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul',
        v_started
      ) || jsonb_build_object('date', to_char(d::date, 'YYYY-MM-DD')) AS item
    FROM generate_series(v_chart_start::timestamp, v_today::timestamp, interval '1 day') AS d
  ) days;

  RETURN jsonb_build_object(
    'version', 1,
    'timezone', 'Europe/Istanbul',
    'window_hours', 3,
    'started_at', v_started,
    'today', private.kutadgu_visit_window_status(
      v_today::timestamp AT TIME ZONE 'Europe/Istanbul',
      (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul',
      v_started
    ) || jsonb_build_object('date', to_char(v_today, 'YYYY-MM-DD')),
    'yesterday', private.kutadgu_visit_window_status(
      v_yesterday::timestamp AT TIME ZONE 'Europe/Istanbul',
      v_today::timestamp AT TIME ZONE 'Europe/Istanbul',
      v_started
    ) || jsonb_build_object('date', to_char(v_yesterday, 'YYYY-MM-DD')),
    'period', private.kutadgu_visit_window_status(
      v_range_start::timestamp AT TIME ZONE 'Europe/Istanbul',
      (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul',
      v_started
    ) || jsonb_build_object(
      'start', to_char(v_range_start, 'YYYY-MM-DD'),
      'end', to_char(v_today, 'YYYY-MM-DD')
    ),
    'daily', v_daily
  );
END;
$report$;

CREATE OR REPLACE FUNCTION public.get_kutadgu_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1,least(coalesce(p_days,30),365)));
  v_result jsonb;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'admin only';
  end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'page_views',(select count(*) from public.analytics_events where created_at>=v_since and event_name='page_view'),
    'book_views',(select count(*) from public.analytics_events where created_at>=v_since and event_name='book_view'),
    'cart_adds',(select count(*) from public.analytics_events where created_at>=v_since and event_name='add_to_cart'),
    'whatsapp_clicks',(select count(*) from public.analytics_events where created_at>=v_since and event_name='whatsapp_order_click'),
    'top_books',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select e.book_id,coalesce(b.title,e.book_id) as title,count(*)::integer as views
        from public.analytics_events e left join public.books b on b.id::text=e.book_id
        where e.created_at>=v_since and e.event_name='book_view' and e.book_id is not null
        group by e.book_id,b.title order by count(*) desc limit 10
      ) t
    ),'[]'::jsonb),
    'zero_searches',coalesce((
      select jsonb_agg(to_jsonb(z)) from (
        select search_query as query,count(*)::integer as searches
        from public.analytics_events
        where created_at>=v_since and event_name='search' and coalesce(result_count,0)=0 and search_query is not null and search_query<>''
        group by search_query order by count(*) desc limit 10
      ) z
    ),'[]'::jsonb)
  ) into v_result;
  v_result := v_result || jsonb_build_object(
    'counted_visits', private.kutadgu_counted_visit_report(p_days)
  );
  return v_result;
end
$function$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;

REVOKE ALL ON FUNCTION private.kutadgu_analytics_public_path(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_visitor_id_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_visit_status_json(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_accept_page_visit(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_count_page_visit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_visit_window_status(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_counted_visit_report(integer) FROM PUBLIC, anon, authenticated;

COMMIT;
