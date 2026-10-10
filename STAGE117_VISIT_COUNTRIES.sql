-- Stage 117 — country of a counted storefront visit.
-- MANUAL APPLY ONLY. Do not run this from an agent task. Do not apply it
-- to production until this file has been reviewed. It does not rerun
-- Stage 114, 115, or 116. It does not delete or rewrite analytics_events.
-- It does not backfill a country onto older receipts.
--
-- The three-hour rule stays in private.kutadgu_accept_page_visit. This file
-- only copies a country onto the receipt of a newly accepted counted visit.
-- A repeated event_id returns the existing receipt and does not change its
-- country. A suppressed page view does not move the gate and does not store
-- a country. Book views, cart adds, searches, and other events stay stored
-- and are not counted.
--
-- Country is an ISO 3166-1 alpha-2 code taken from Cloudflare request.cf
-- by the Worker, then inserted with service_role. A client body, a client
-- header, anon, and authenticated are not trusted: the insert trigger
-- clears country unless the current role is service_role. XX, T1, and any
-- other invalid value become unknown (NULL). No IP address is stored.
--
-- Collection starts at private.analytics_country_counter.started_at, set on
-- the first successful apply and left unchanged when this file is applied
-- again. An interval entirely before that marker is unavailable, including
-- an empty one. An interval that crosses it is partial. After the marker,
-- coverage matches the counted-visit rule: a public page view with no
-- receipt, or one without a usable visitor id or event id, is partial.
-- Accepted totals and unknown-country receipts stay in the result. Unknown
-- metadata on a counted receipt is a measured unknown, not a processing gap.
-- A receipt with counted = false is a suppressed visit, not a gap. A fully
-- covered quiet interval, or one with only suppressed visits, is a measured
-- zero. A covered interval with counted visits and no gap is complete.
--
-- Deployment order:
--   The site can ship first. Until this file is applied, the Worker retries
--   the insert without country, the browser can still store the page view
--   directly, and the admin page shows this report as unavailable.
--   Apply this file once in the Supabase SQL editor after review. Repeat
--   application must not move started_at.
--
-- Rollback: STAGE117_VISIT_COUNTRIES_ROLLBACK.sql, run by itself.
--   It restores the Stage 116 analytics function, drops the country columns
--   and this counter, and leaves analytics_events rows, the three-hour
--   gate, and private.analytics_visit_counter.started_at in place.

BEGIN;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE private.analytics_visit_receipts
  ADD COLUMN IF NOT EXISTS country text;

DO $shape$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analytics_events_country_shape'
      AND conrelid = 'public.analytics_events'::regclass
  ) THEN
    ALTER TABLE public.analytics_events
      ADD CONSTRAINT analytics_events_country_shape
      CHECK (country IS NULL OR (country ~ '^[A-Z]{2}$' AND country <> 'XX'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analytics_visit_receipts_country_shape'
      AND conrelid = 'private.analytics_visit_receipts'::regclass
  ) THEN
    ALTER TABLE private.analytics_visit_receipts
      ADD CONSTRAINT analytics_visit_receipts_country_shape
      CHECK (
        country IS NULL
        OR (counted AND country ~ '^[A-Z]{2}$' AND country <> 'XX')
      );
  END IF;
END
$shape$;

CREATE TABLE IF NOT EXISTS private.analytics_country_counter (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  started_at timestamptz NOT NULL
);

INSERT INTO private.analytics_country_counter (id, started_at)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.analytics_country_counter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.analytics_country_counter FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.kutadgu_normalize_country(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $country$
  SELECT CASE
    WHEN upper(btrim(coalesce(p_code, ''))) ~ '^[A-Z]{2}$'
     AND upper(btrim(p_code)) <> 'XX'
    THEN upper(btrim(p_code))
    ELSE NULL
  END;
$country$;

CREATE OR REPLACE FUNCTION public.kutadgu_strip_untrusted_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $strip$
DECLARE
  v_path text := lower(split_part(coalesce(NEW.path, ''), '?', 1));
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.country := OLD.country;
    RETURN NEW;
  END IF;
  IF current_user IS DISTINCT FROM 'service_role'
     OR NEW.event_name IS DISTINCT FROM 'page_view'
     OR v_path ~ '(^|/)admin\.html$'
     OR v_path ~ '(^|/)book-staff\.html$'
  THEN
    NEW.country := NULL;
  ELSIF upper(btrim(coalesce(NEW.country, ''))) ~ '^[A-Z]{2}$'
    AND upper(btrim(NEW.country)) <> 'XX'
  THEN
    NEW.country := upper(btrim(NEW.country));
  ELSE
    NEW.country := NULL;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    NEW.country := NULL;
    RETURN NEW;
END;
$strip$;

DROP TRIGGER IF EXISTS analytics_events_trust_country ON public.analytics_events;
CREATE TRIGGER analytics_events_trust_country
  BEFORE INSERT OR UPDATE OF country ON public.analytics_events
  FOR EACH ROW
  EXECUTE FUNCTION public.kutadgu_strip_untrusted_country();

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
  v_country text := NULL;
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

  IF v_counted THEN
    SELECT private.kutadgu_normalize_country(e.country)
    INTO v_country
    FROM public.analytics_events e
    WHERE e.event_id = p_event_id
    ORDER BY e.id DESC
    LIMIT 1;
  END IF;

  INSERT INTO private.analytics_visit_receipts (
    event_id, visitor_id, counted, counted_at, country
  )
  VALUES (
    p_event_id,
    v_visitor,
    v_counted,
    CASE WHEN v_counted THEN v_at ELSE NULL END,
    v_country
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

CREATE OR REPLACE FUNCTION private.kutadgu_country_visit_report(p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $report$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_start date := v_today - (v_days - 1);
  v_since timestamptz := v_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_until timestamptz := (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_started timestamptz;
  v_from timestamptz;
  v_partial boolean := false;
  v_total integer := 0;
  v_unknown integer := 0;
  v_unidentified integer := 0;
  v_unprocessed integer := 0;
  v_countries jsonb := '[]'::jsonb;
  v_latest jsonb := '[]'::jsonb;
BEGIN
  SELECT started_at INTO v_started
  FROM private.analytics_country_counter
  WHERE id;

  IF v_started IS NULL OR v_until <= v_started THEN
    RETURN jsonb_build_object(
      'version', 1,
      'timezone', 'Europe/Istanbul',
      'window_hours', 3,
      'started_at', v_started,
      'status', 'unavailable',
      'countries', NULL,
      'unknown_visits', NULL,
      'latest', NULL,
      'start', to_char(v_start, 'YYYY-MM-DD'),
      'end', to_char(v_today, 'YYYY-MM-DD')
    );
  END IF;

  v_partial := v_since < v_started;
  v_from := greatest(v_since, v_started);

  -- Same gap rule as private.kutadgu_visit_window_status, limited to the
  -- country-covered slice. A counted receipt with a null country is not a gap.
  SELECT
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
  INTO v_unidentified, v_unprocessed
  FROM public.analytics_events
  WHERE created_at >= v_from
    AND created_at < v_until
    AND private.kutadgu_analytics_public_path(path);

  IF v_unidentified > 0 OR v_unprocessed > 0 THEN
    v_partial := true;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE country IS NULL)::integer
  INTO v_total, v_unknown
  FROM private.analytics_visit_receipts
  WHERE counted
    AND counted_at >= v_from
    AND counted_at < v_until;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('code', code, 'visits', visits) ORDER BY visits DESC, code ASC),
    '[]'::jsonb
  )
  INTO v_countries
  FROM (
    SELECT country AS code, count(*)::integer AS visits
    FROM private.analytics_visit_receipts
    WHERE counted
      AND counted_at >= v_from
      AND counted_at < v_until
      AND country IS NOT NULL
    GROUP BY country
  ) rows;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('country', country, 'counted_at', counted_at)
      ORDER BY counted_at DESC, event_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_latest
  FROM (
    SELECT country, counted_at, event_id
    FROM private.analytics_visit_receipts
    WHERE counted
      AND counted_at >= v_from
      AND counted_at < v_until
    ORDER BY counted_at DESC, event_id DESC
    LIMIT 20
  ) rows;

  RETURN jsonb_build_object(
    'version', 1,
    'timezone', 'Europe/Istanbul',
    'window_hours', 3,
    'started_at', v_started,
    'status', CASE
      WHEN v_partial THEN 'partial'
      WHEN v_total = 0 THEN 'zero'
      ELSE 'complete'
    END,
    'countries', v_countries,
    'unknown_visits', v_unknown,
    'latest', v_latest,
    'start', to_char(v_start, 'YYYY-MM-DD'),
    'end', to_char(v_today, 'YYYY-MM-DD')
  );
END;
$report$;

REVOKE ALL ON FUNCTION private.kutadgu_normalize_country(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_accept_page_visit(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_country_visit_report(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kutadgu_strip_untrusted_country() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kutadgu_strip_untrusted_country() TO anon, authenticated;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.kutadgu_strip_untrusted_country() TO service_role;
    GRANT INSERT ON TABLE public.analytics_events TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.analytics_events_id_seq TO service_role;
  END IF;
END
$grants$;

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
    ),'[]'::jsonb),
    'top_cart_books',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.adds desc, t.book_id asc)
      from (
        select e.book_id,
               coalesce(b.title, e.book_id) as title,
               count(distinct coalesce(e.event_id::text, 'id:' || e.id::text))::integer as adds
        from public.analytics_events e
        left join public.books b on b.id::text = e.book_id
        where e.created_at >= v_since
          and e.event_name = 'add_to_cart'
          and e.book_id is not null
          and btrim(e.book_id) <> ''
        group by e.book_id, b.title
        order by count(distinct coalesce(e.event_id::text, 'id:' || e.id::text)) desc, e.book_id asc
        limit 10
      ) t
    ),'[]'::jsonb),
    'top_whatsapp_books',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.clicks desc, t.book_id asc)
      from (
        select x.book_id,
               coalesce(b.title, x.book_id) as title,
               count(distinct x.event_key)::integer as clicks
        from (
          select distinct
            coalesce(e.event_id::text, 'id:' || e.id::text) as event_key,
            tok.book_id
          from public.analytics_events e
          cross join lateral (
            select distinct nullif(btrim(raw.token), '') as book_id
            from (
              select e.book_id as token
              union
              select item
              from jsonb_array_elements_text(
                case
                  when jsonb_typeof(e.meta -> 'book_ids') = 'array' then e.meta -> 'book_ids'
                  else '[]'::jsonb
                end
              ) as item
            ) raw(token)
          ) tok
          where e.created_at >= v_since
            and e.event_name = 'whatsapp_order_click'
            and tok.book_id is not null
        ) x
        left join public.books b on b.id::text = x.book_id
        group by x.book_id, b.title
        order by count(distinct x.event_key) desc, x.book_id asc
        limit 10
      ) t
    ),'[]'::jsonb),
    'unknown_result_searches',(
      select count(distinct coalesce(event_id::text, 'id:' || id::text))
      from public.analytics_events
      where created_at >= v_since
        and event_name = 'search'
        and result_count is null
        and search_query is not null
        and btrim(search_query) <> ''
    )
  ) into v_result;
  v_result := v_result || jsonb_build_object(
    'counted_visits', private.kutadgu_counted_visit_report(p_days),
    'visit_countries', private.kutadgu_country_visit_report(p_days)
  );
  return v_result;
end
$function$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;

COMMIT;
