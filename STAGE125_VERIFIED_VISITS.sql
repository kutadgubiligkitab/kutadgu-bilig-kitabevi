-- Stage 125 — verification-passed browser visits.
-- MANUAL APPLY ONLY. Do not run this from an agent task. Do not apply it
-- to production until this file has been reviewed. It does not delete or
-- rewrite analytics_events, legacy receipts, or the legacy collection
-- marker. It does not backfill verification onto old visits.
--
-- The metric is a browser visit that passed Cloudflare Turnstile siteverify
-- and returned a signed cookie. It is not a verified person and it is not
-- guaranteed bot-free traffic. Cookie deletion, a separate browser, and
-- advanced automation can still split or imitate an identity.
--
-- Only service_role may execute the counting and proof functions. anon,
-- authenticated, and PUBLIC cannot. The functions are SECURITY INVOKER so
-- current_user stays the caller; a SECURITY DEFINER wrapper would hide
-- that check. Private tables have RLS enabled and no browser policies.
-- The existing page_view trigger still writes legacy receipts only.
--
-- Collection starts at private.analytics_verified_counter.started_at, once.
-- An interval entirely before that marker is unavailable. An interval that
-- crosses it, or that contains a recorded verification outage, is partial
-- and must not be shown as complete coverage. A fully covered quiet
-- interval is zero. Country is Cloudflare metadata on a counted receipt.
-- Server time is now() inside the public counting function. The same
-- event_id is stored once. A suppressed visit does not move the 3-hour gate.
--
-- Deployment order:
--   1. Review this file and STAGE125_VERIFIED_VISITS_ROLLBACK.sql.
--   2. Ship the Worker only after the secrets below exist, or ship it
--      earlier knowing verification stays refused until they exist.
--   3. Apply this file once in the Supabase SQL editor.
--   4. Create a Turnstile managed widget for kutadgubilik.com and
--      www.kutadgubilik.com only. Action must be visit.
--   5. Set the public Worker var TURNSTILE_SITE_KEY.
--   6. Set Worker secrets TURNSTILE_SECRET_KEY and VISIT_SIGNING_SECRET
--      (at least 32 characters). Do not commit them. Do not use Cloudflare
--      test keys (1x, 2x, or 3x dummy keys) in production.
--   7. Confirm a real browser receives the cookie and one verified receipt.
-- Until steps 3 through 7 are done, this is not production protection.
--
-- Rollback: STAGE125_VERIFIED_VISITS_ROLLBACK.sql, run by itself.

BEGIN;

CREATE TABLE IF NOT EXISTS private.analytics_verified_counter (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  started_at timestamptz NOT NULL
);

INSERT INTO private.analytics_verified_counter (id, started_at)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.analytics_verified_gate (
  visitor_id uuid PRIMARY KEY,
  last_counted_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS private.analytics_verified_receipts (
  event_id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL,
  counted boolean NOT NULL,
  counted_at timestamptz,
  country text,
  CONSTRAINT analytics_verified_receipts_country_shape CHECK (
    country IS NULL
    OR (counted AND country ~ '^[A-Z]{2}$' AND country <> 'XX')
  ),
  CONSTRAINT analytics_verified_receipts_time_shape CHECK (
    (counted AND counted_at IS NOT NULL)
    OR (NOT counted AND counted_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS private.analytics_verified_proofs (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private.analytics_verified_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind = 'outage')
);

CREATE INDEX IF NOT EXISTS analytics_verified_receipts_counted_idx
  ON private.analytics_verified_receipts (counted_at)
  WHERE counted;

CREATE INDEX IF NOT EXISTS analytics_verified_signals_outage_idx
  ON private.analytics_verified_signals (occurred_at);

CREATE TABLE IF NOT EXISTS private.kutadgu_verified_history_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  days integer NOT NULL,
  as_of timestamptz NOT NULL,
  range_start date NOT NULL,
  range_end date NOT NULL,
  window_from timestamptz NOT NULL,
  window_until timestamptz NOT NULL,
  marker_partial boolean NOT NULL,
  gap_partial boolean NOT NULL,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kutadgu_verified_history_snapshots_days_ok CHECK (days BETWEEN 1 AND 365)
);

CREATE TABLE IF NOT EXISTS private.kutadgu_verified_history_members (
  snapshot_id uuid NOT NULL REFERENCES private.kutadgu_verified_history_snapshots (snapshot_id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  PRIMARY KEY (snapshot_id, event_id)
);

ALTER TABLE private.analytics_verified_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_verified_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_verified_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_verified_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_verified_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.kutadgu_verified_history_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.kutadgu_verified_history_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.analytics_verified_counter FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_verified_gate FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_verified_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_verified_proofs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_verified_signals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.kutadgu_verified_history_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.kutadgu_verified_history_members FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.kutadgu_accept_verified_visit(
  p_visitor_id uuid,
  p_event_id uuid,
  p_country text,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $accept$
DECLARE
  v_at timestamptz := coalesce(p_at, now());
  v_country text := private.kutadgu_normalize_country(p_country);
  v_existing boolean;
  v_counted boolean := false;
BEGIN
  IF p_visitor_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_visitor_id::text, 0));

  SELECT counted INTO v_existing
  FROM private.analytics_verified_receipts
  WHERE event_id = p_event_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO private.analytics_verified_gate AS g (visitor_id, last_counted_at)
  VALUES (p_visitor_id, v_at)
  ON CONFLICT (visitor_id) DO UPDATE
    SET last_counted_at = EXCLUDED.last_counted_at
    WHERE g.last_counted_at <= v_at - interval '3 hours'
  RETURNING true INTO v_counted;
  IF NOT FOUND THEN
    v_counted := false;
  END IF;

  INSERT INTO private.analytics_verified_receipts (event_id, visitor_id, counted, counted_at, country)
  VALUES (
    p_event_id,
    p_visitor_id,
    v_counted,
    CASE WHEN v_counted THEN v_at ELSE NULL END,
    CASE WHEN v_counted THEN v_country ELSE NULL END
  );

  RETURN v_counted;
EXCEPTION
  WHEN unique_violation THEN
    SELECT counted INTO v_existing
    FROM private.analytics_verified_receipts
    WHERE event_id = p_event_id;
    RETURN coalesce(v_existing, false);
END;
$accept$;

CREATE OR REPLACE FUNCTION public.kutadgu_accept_verified_visit(
  p_visitor_id uuid,
  p_event_id uuid,
  p_country text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $public_accept$
BEGIN
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'server only' USING ERRCODE = '42501';
  END IF;
  RETURN private.kutadgu_accept_verified_visit(p_visitor_id, p_event_id, p_country, now());
END;
$public_accept$;

CREATE OR REPLACE FUNCTION public.kutadgu_consume_visit_proof(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $proof$
BEGIN
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'server only' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  DELETE FROM private.analytics_verified_proofs
  WHERE consumed_at < now() - interval '48 hours';
  INSERT INTO private.analytics_verified_proofs (token_hash)
  VALUES (p_token_hash);
  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RETURN false;
END;
$proof$;

CREATE OR REPLACE FUNCTION public.kutadgu_note_verified_outage()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $outage$
BEGIN
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'server only' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM private.analytics_verified_signals
    WHERE kind = 'outage'
      AND occurred_at > now() - interval '1 hour'
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO private.analytics_verified_signals (kind)
  VALUES ('outage');
  RETURN true;
END;
$outage$;

CREATE OR REPLACE FUNCTION private.kutadgu_verified_window_status(
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
  v_outages integer := 0;
BEGIN
  IF p_started IS NULL OR p_end <= p_started THEN
    RETURN private.kutadgu_visit_status_json('unavailable', NULL);
  END IF;

  SELECT count(*)::integer INTO v_counted
  FROM private.analytics_verified_receipts
  WHERE counted
    AND counted_at >= p_start
    AND counted_at < p_end;

  IF p_start < p_started THEN
    RETURN private.kutadgu_visit_status_json('partial', v_counted);
  END IF;

  SELECT count(*)::integer INTO v_outages
  FROM private.analytics_verified_signals
  WHERE kind = 'outage'
    AND occurred_at >= p_start
    AND occurred_at < p_end;

  IF v_outages > 0 THEN
    RETURN private.kutadgu_visit_status_json('partial', v_counted);
  ELSIF v_counted = 0 THEN
    RETURN private.kutadgu_visit_status_json('zero', 0);
  ELSE
    RETURN private.kutadgu_visit_status_json('complete', v_counted);
  END IF;
END;
$status$;

CREATE OR REPLACE FUNCTION private.kutadgu_verified_visit_report(p_days integer)
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
  FROM private.analytics_verified_counter
  WHERE id;

  SELECT coalesce(jsonb_agg(item ORDER BY day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      d::date AS day,
      private.kutadgu_verified_window_status(
        d::timestamp AT TIME ZONE 'Europe/Istanbul',
        (d::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul',
        v_started
      ) || jsonb_build_object('date', to_char(d::date, 'YYYY-MM-DD')) AS item
    FROM generate_series(v_chart_start::timestamp, v_today::timestamp, interval '1 day') AS d
  ) days;

  RETURN jsonb_build_object(
    'version', 1,
    'metric', 'verification_passed_browser_visits',
    'timezone', 'Europe/Istanbul',
    'window_hours', 3,
    'started_at', v_started,
    'today', private.kutadgu_verified_window_status(
      v_today::timestamp AT TIME ZONE 'Europe/Istanbul',
      (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul',
      v_started
    ) || jsonb_build_object('date', to_char(v_today, 'YYYY-MM-DD')),
    'yesterday', private.kutadgu_verified_window_status(
      v_yesterday::timestamp AT TIME ZONE 'Europe/Istanbul',
      v_today::timestamp AT TIME ZONE 'Europe/Istanbul',
      v_started
    ) || jsonb_build_object('date', to_char(v_yesterday, 'YYYY-MM-DD')),
    'period', private.kutadgu_verified_window_status(
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

CREATE OR REPLACE FUNCTION private.kutadgu_verified_country_report(p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $countries$
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
  v_outages integer := 0;
  v_countries jsonb;
  v_latest jsonb;
BEGIN
  SELECT started_at INTO v_started
  FROM private.analytics_verified_counter
  WHERE id;

  IF v_started IS NULL OR v_until <= v_started THEN
    RETURN jsonb_build_object(
      'version', 1,
      'metric', 'verification_passed_browser_visits',
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

  SELECT count(*)::integer INTO v_outages
  FROM private.analytics_verified_signals
  WHERE kind = 'outage'
    AND occurred_at >= v_from
    AND occurred_at < v_until;
  IF v_outages > 0 THEN
    v_partial := true;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE country IS NULL)::integer
  INTO v_total, v_unknown
  FROM private.analytics_verified_receipts
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
    FROM private.analytics_verified_receipts
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
    FROM private.analytics_verified_receipts
    WHERE counted
      AND counted_at >= v_from
      AND counted_at < v_until
    ORDER BY counted_at DESC, event_id DESC
    LIMIT 20
  ) rows;

  RETURN jsonb_build_object(
    'version', 1,
    'metric', 'verification_passed_browser_visits',
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
$countries$;

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
    'visit_countries', private.kutadgu_country_visit_report(p_days),
    'verified_visits', private.kutadgu_verified_visit_report(p_days),
    'verified_visit_countries', private.kutadgu_verified_country_report(p_days)
  );
  return v_result;
end
$function$;


CREATE OR REPLACE FUNCTION public.get_kutadgu_verified_visit_history(
  p_days integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20,
  p_as_of timestamptz DEFAULT NULL,
  p_snapshot uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $history$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_days integer;
  v_as_of timestamptz;
  v_start date;
  v_today date;
  v_since timestamptz;
  v_until timestamptz;
  v_started timestamptz;
  v_from timestamptz;
  v_marker_partial boolean := false;
  v_gap_partial boolean := false;
  v_partial boolean := false;
  v_total integer := 0;
  v_outages integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_page_count integer := 0;
  v_snapshot_id uuid;
  v_available boolean := true;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;

  IF p_snapshot IS NULL THEN
    v_days := greatest(1, least(coalesce(p_days, 30), 365));
    v_as_of := least(coalesce(p_as_of, now()), now());
    v_today := (timezone('Europe/Istanbul', v_as_of))::date;
    v_start := v_today - (v_days - 1);
    v_since := v_start::timestamp AT TIME ZONE 'Europe/Istanbul';
    v_until := (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';

    SELECT started_at INTO v_started
    FROM private.analytics_verified_counter
    WHERE id;

    v_available := v_started IS NOT NULL AND v_until > v_started;
    v_marker_partial := v_available AND v_since < v_started;
    v_from := CASE
      WHEN v_started IS NULL THEN v_since
      ELSE greatest(v_since, v_started)
    END;

    IF v_available THEN
      SELECT count(*)::integer INTO v_outages
      FROM private.analytics_verified_signals
      WHERE kind = 'outage'
        AND occurred_at >= v_from
        AND occurred_at < v_until
        AND occurred_at <= v_as_of;
      v_gap_partial := v_outages > 0;
    END IF;

    INSERT INTO private.kutadgu_verified_history_snapshots (
      days, as_of, range_start, range_end, window_from, window_until,
      marker_partial, gap_partial, started_at
    ) VALUES (
      v_days, v_as_of, v_start, v_today, v_from, v_until,
      v_marker_partial, v_gap_partial, v_started
    )
    RETURNING snapshot_id INTO v_snapshot_id;

    IF v_available THEN
      INSERT INTO private.kutadgu_verified_history_members (snapshot_id, event_id)
      SELECT v_snapshot_id, r.event_id
      FROM private.analytics_verified_receipts AS r
      WHERE r.counted
        AND r.counted_at >= v_from
        AND r.counted_at < v_until
        AND r.counted_at <= v_as_of;
    END IF;

    DELETE FROM private.kutadgu_verified_history_snapshots
    WHERE created_at < now() - interval '36 hours'
      AND snapshot_id IS DISTINCT FROM v_snapshot_id;
  ELSE
    SELECT
      snapshot_id, days, as_of, range_start, range_end, window_from, window_until,
      marker_partial, gap_partial, started_at
    INTO
      v_snapshot_id, v_days, v_as_of, v_start, v_today, v_from, v_until,
      v_marker_partial, v_gap_partial, v_started
    FROM private.kutadgu_verified_history_snapshots
    WHERE snapshot_id = p_snapshot;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'history snapshot is not available' USING ERRCODE = 'P0002';
    END IF;
    v_available := v_started IS NOT NULL AND v_until > v_started;
  END IF;

  IF NOT v_available THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'metric', 'verification_passed_browser_visits',
      'timezone', 'Europe/Istanbul',
      'window_hours', 3,
      'started_at', v_started,
      'status', 'unavailable',
      'range_start', to_char(v_start, 'YYYY-MM-DD'),
      'range_end', to_char(v_today, 'YYYY-MM-DD'),
      'days', v_days,
      'as_of', v_as_of,
      'snapshot_id', v_snapshot_id,
      'offset', v_offset,
      'limit', v_limit,
      'next_offset', v_offset,
      'total', NULL,
      'page_count', 0,
      'has_more', false,
      'rows', NULL
    );
  END IF;

  v_partial := v_marker_partial OR v_gap_partial;

  SELECT count(*)::integer INTO v_total
  FROM private.kutadgu_verified_history_members
  WHERE snapshot_id = v_snapshot_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('country', country, 'counted_at', counted_at)
      ORDER BY counted_at DESC, event_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT r.country, r.counted_at, r.event_id
    FROM private.kutadgu_verified_history_members AS m
    JOIN private.analytics_verified_receipts AS r ON r.event_id = m.event_id
    WHERE m.snapshot_id = v_snapshot_id
    ORDER BY r.counted_at DESC, r.event_id DESC
    OFFSET v_offset
    LIMIT v_limit
  ) page;

  v_page_count := coalesce(jsonb_array_length(v_rows), 0);

  RETURN jsonb_build_object(
    'schema_version', 1,
    'metric', 'verification_passed_browser_visits',
    'timezone', 'Europe/Istanbul',
    'window_hours', 3,
    'started_at', v_started,
    'status', CASE
      WHEN v_partial THEN 'partial'
      WHEN v_total = 0 THEN 'zero'
      ELSE 'complete'
    END,
    'range_start', to_char(v_start, 'YYYY-MM-DD'),
    'range_end', to_char(v_today, 'YYYY-MM-DD'),
    'days', v_days,
    'as_of', v_as_of,
    'snapshot_id', v_snapshot_id,
    'offset', v_offset,
    'limit', v_limit,
    'next_offset', v_offset + v_page_count,
    'total', v_total,
    'page_count', v_page_count,
    'has_more', (v_offset + v_page_count) < v_total,
    'rows', v_rows
  );
END;
$history$;


REVOKE ALL ON FUNCTION private.kutadgu_accept_verified_visit(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_verified_window_status(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_verified_visit_report(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_verified_country_report(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kutadgu_accept_verified_visit(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kutadgu_consume_visit_proof(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kutadgu_note_verified_outage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_kutadgu_verified_visit_history(integer, integer, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_verified_visit_history(integer, integer, integer, timestamptz, uuid) TO authenticated;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA private TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      private.analytics_verified_counter,
      private.analytics_verified_gate,
      private.analytics_verified_receipts,
      private.analytics_verified_proofs,
      private.analytics_verified_signals,
      private.kutadgu_verified_history_snapshots,
      private.kutadgu_verified_history_members
    TO service_role;
    GRANT EXECUTE ON FUNCTION private.kutadgu_accept_verified_visit(uuid, uuid, text, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION private.kutadgu_normalize_country(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.kutadgu_accept_verified_visit(uuid, uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.kutadgu_consume_visit_proof(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.kutadgu_note_verified_outage() TO service_role;
    REVOKE ALL ON FUNCTION public.get_kutadgu_verified_visit_history(integer, integer, integer, timestamptz, uuid) FROM service_role;
  END IF;
END
$grants$;

COMMIT;
