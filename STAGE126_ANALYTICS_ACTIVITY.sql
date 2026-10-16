-- Stage 126 — admin activity lists and server-side action attestation.
-- MANUAL APPLY ONLY. Do not run this from an agent task and do not apply it
-- to production until this file has been reviewed. It does not delete or
-- rewrite analytics_events, verified visit receipts, or the visit marker.
-- It does not mark historical events as verified.
--
-- PR #294 verifies visits only. Book, cart, WhatsApp, and search rows stay
-- unverified until the Worker, using the current signed kb_visit cookie,
-- calls kutadgu_attest_analytics_event. A submitted visitor id or a client
-- flag cannot create that row. Direct anon/authenticated inserts cannot.
-- The 3-hour visit gate is not applied to these actions. The same event_id
-- is attested once. A different event_id is a separate action.
--
-- Verified activity before private.analytics_action_attestation_counter.started_at
-- is unavailable, not zero. A window that crosses that start, or an attestation
-- outage, is partial. A quiet window entirely after the start is zero.
-- Raw scope is every stored event and is not a verified count.
--
-- Dates are Europe/Istanbul calendar dates. The query is half-open:
-- [start 00:00, end+1 day 00:00). Presets are computed from now().
--
-- Rollback: STAGE126_ANALYTICS_ACTIVITY_ROLLBACK.sql, run by itself.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.analytics_action_attestation_counter (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  started_at timestamptz NOT NULL
);

INSERT INTO private.analytics_action_attestation_counter (id, started_at)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.analytics_action_attestations (
  event_id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private.analytics_action_attestation_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  observed_until timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind = 'outage')
);

CREATE INDEX IF NOT EXISTS analytics_action_attestation_signals_coverage_idx
  ON private.analytics_action_attestation_signals (occurred_at, observed_until);

ALTER TABLE private.analytics_action_attestation_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_action_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.analytics_action_attestation_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.analytics_action_attestation_counter FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_action_attestations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.analytics_action_attestation_signals FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.kutadgu_action_attestation_overlaps(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $overlap$
  SELECT EXISTS (
    SELECT 1
    FROM private.analytics_action_attestation_signals
    WHERE kind = 'outage'
      AND occurred_at < p_end
      AND observed_until > p_start
  );
$overlap$;

REVOKE ALL ON FUNCTION private.kutadgu_action_attestation_overlaps(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kutadgu_attest_analytics_event(
  p_event_id uuid,
  p_visitor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $attest$
BEGIN
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'server only' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_visitor_id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO private.analytics_action_attestations (event_id, visitor_id)
  VALUES (p_event_id, p_visitor_id)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN true;
END;
$attest$;

CREATE OR REPLACE FUNCTION public.kutadgu_note_action_attestation_outage()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $outage$
DECLARE
  v_id bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'server only' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id
  FROM private.analytics_action_attestation_signals
  WHERE kind = 'outage'
    AND observed_until > now()
  ORDER BY observed_until DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF v_id IS NOT NULL THEN
    UPDATE private.analytics_action_attestation_signals
    SET observed_until = greatest(observed_until, now() + interval '1 hour')
    WHERE id = v_id;
    RETURN true;
  END IF;
  INSERT INTO private.analytics_action_attestation_signals (kind, occurred_at, observed_until)
  VALUES ('outage', now(), now() + interval '1 hour');
  RETURN true;
END;
$outage$;

REVOKE ALL ON FUNCTION public.kutadgu_attest_analytics_event(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kutadgu_note_action_attestation_outage() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_kutadgu_analytics_activity(
  p_category text DEFAULT 'book_view',
  p_scope text DEFAULT 'verified',
  p_sort text DEFAULT 'latest',
  p_preset text DEFAULT 'last_30',
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $activity$
DECLARE
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_sort text := lower(btrim(coalesce(p_sort, '')));
  v_preset text := lower(btrim(coalesce(p_preset, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_filter text := left(btrim(coalesce(p_query, '')), 80);
  v_as_of timestamptz := now();
  v_today date := (timezone('Europe/Istanbul', v_as_of))::date;
  v_start date;
  v_end date;
  v_from timestamptz;
  v_until timestamptz;
  v_query_from timestamptz;
  v_started timestamptz;
  v_status text;
  v_partial boolean := false;
  v_total integer := 0;
  v_events integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_page_count integer := 0;
  v_kind text;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF v_category NOT IN ('book_view', 'add_to_cart', 'whatsapp_order_click', 'search', 'zero_search') THEN
    RAISE EXCEPTION 'unknown activity category' USING ERRCODE = '22023';
  END IF;
  IF v_scope NOT IN ('verified', 'raw') THEN
    RAISE EXCEPTION 'unknown activity scope' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN ('latest', 'oldest', 'count_desc', 'count_asc') THEN
    RAISE EXCEPTION 'unknown activity sort' USING ERRCODE = '22023';
  END IF;
  IF v_preset NOT IN ('today', 'yesterday', 'last_7', 'last_30', 'custom') THEN
    RAISE EXCEPTION 'unknown activity preset' USING ERRCODE = '22023';
  END IF;

  IF v_preset = 'today' THEN
    v_start := v_today;
    v_end := v_today;
  ELSIF v_preset = 'yesterday' THEN
    v_start := v_today - 1;
    v_end := v_today - 1;
  ELSIF v_preset = 'last_7' THEN
    v_start := v_today - 6;
    v_end := v_today;
  ELSIF v_preset = 'last_30' THEN
    v_start := v_today - 29;
    v_end := v_today;
  ELSE
    IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR (p_end - p_start) > 366 THEN
      RAISE EXCEPTION 'invalid activity range' USING ERRCODE = '22023';
    END IF;
    v_start := p_start;
    v_end := p_end;
  END IF;

  v_from := v_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_until := (v_end + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_kind := CASE WHEN v_category IN ('search', 'zero_search') THEN 'phrase' ELSE 'book' END;
  SELECT started_at INTO v_started
  FROM private.analytics_action_attestation_counter
  WHERE id;

  IF v_scope = 'verified' THEN
    IF v_started IS NULL OR v_until <= v_started THEN
      RETURN jsonb_build_object(
        'schema_version', 1,
        'metric', 'verification_passed_browser_actions',
        'scope', 'verified',
        'category', v_category,
        'kind', v_kind,
        'sort', v_sort,
        'timezone', 'Europe/Istanbul',
        'status', 'unavailable',
        'started_at', v_started,
        'range_start', to_char(v_start, 'YYYY-MM-DD'),
        'range_end', to_char(v_end, 'YYYY-MM-DD'),
        'window_from', v_from,
        'window_until', v_until,
        'offset', v_offset,
        'limit', v_limit,
        'next_offset', v_offset,
        'total', NULL,
        'total_events', NULL,
        'page_count', 0,
        'has_more', false,
        'rows', NULL
      );
    END IF;
    v_partial := v_from < v_started;
    v_query_from := greatest(v_from, v_started);
    IF private.kutadgu_action_attestation_overlaps(v_query_from, v_until) THEN
      v_partial := true;
    END IF;
    v_status := CASE WHEN v_partial THEN 'partial' ELSE 'complete' END;
  ELSE
    v_query_from := v_from;
    v_status := 'raw';
  END IF;

  WITH base AS (
    SELECT
      e.id,
      e.event_id,
      e.event_name,
      e.created_at,
      e.result_count,
      e.search_query,
      e.book_id,
      e.meta,
      coalesce(e.event_id::text, 'id:' || e.id::text) AS event_key
    FROM public.analytics_events AS e
    WHERE e.created_at >= v_query_from
      AND e.created_at < v_until
      AND e.created_at <= v_as_of
      AND (
        v_scope = 'raw'
        OR EXISTS (
          SELECT 1
          FROM private.analytics_action_attestations AS a
          WHERE a.event_id = e.event_id
        )
      )
  ),
  items AS (
    SELECT
      btrim(e.book_id) AS item_key,
      e.event_key,
      e.created_at
    FROM base AS e
    WHERE v_category IN ('book_view', 'add_to_cart')
      AND e.event_name = v_category
      AND e.book_id IS NOT NULL
      AND btrim(e.book_id) <> ''
    UNION ALL
    SELECT
      tok.book_id AS item_key,
      e.event_key,
      e.created_at
    FROM base AS e
    CROSS JOIN LATERAL (
      SELECT DISTINCT nullif(btrim(raw.token), '') AS book_id
      FROM (
        SELECT e.book_id AS token
        UNION
        SELECT item
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(e.meta -> 'book_ids') = 'array' THEN e.meta -> 'book_ids'
            ELSE '[]'::jsonb
          END
        ) AS item
      ) AS raw(token)
    ) AS tok
    WHERE v_category = 'whatsapp_order_click'
      AND e.event_name = 'whatsapp_order_click'
      AND tok.book_id IS NOT NULL
    UNION ALL
    SELECT
      left(regexp_replace(btrim(e.search_query), '[[:space:]]+', ' ', 'g'), 80) AS item_key,
      e.event_key,
      e.created_at
    FROM base AS e
    WHERE v_category = 'search'
      AND e.event_name = 'search'
      AND e.search_query IS NOT NULL
      AND btrim(e.search_query) <> ''
    UNION ALL
    SELECT
      left(regexp_replace(btrim(e.search_query), '[[:space:]]+', ' ', 'g'), 80) AS item_key,
      e.event_key,
      e.created_at
    FROM base AS e
    WHERE v_category = 'zero_search'
      AND e.search_query IS NOT NULL
      AND btrim(e.search_query) <> ''
      AND (
        (e.event_name = 'search' AND e.result_count = 0)
        OR e.event_name = 'zero_result_search'
      )
  ),
  grouped AS (
    SELECT
      i.item_key AS item_key,
      CASE
        WHEN v_kind = 'phrase' THEN i.item_key
        ELSE coalesce(max(b.title), i.item_key)
      END AS label,
      count(DISTINCT i.event_key)::integer AS action_count,
      max(i.created_at) AS last_at
    FROM items AS i
    LEFT JOIN public.books AS b
      ON v_kind = 'book' AND b.id::text = i.item_key
    WHERE i.item_key IS NOT NULL
      AND i.item_key <> ''
    GROUP BY i.item_key
  ),
  matched AS (
    SELECT item_key, label, action_count, last_at
    FROM grouped
    WHERE v_filter = ''
      OR strpos(lower(label), lower(v_filter)) > 0
      OR strpos(lower(item_key), lower(v_filter)) > 0
  )
  SELECT
    count(*)::integer,
    coalesce(sum(action_count), 0)::integer,
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', page.item_key,
          'label', page.label,
          'kind', v_kind,
          'count', page.action_count,
          'last_at', page.last_at
        )
        ORDER BY
          CASE WHEN v_sort = 'latest' THEN page.last_at END DESC NULLS LAST,
          CASE WHEN v_sort = 'oldest' THEN page.last_at END ASC NULLS LAST,
          CASE WHEN v_sort = 'count_desc' THEN page.action_count END DESC,
          CASE WHEN v_sort = 'count_asc' THEN page.action_count END ASC,
          CASE WHEN v_sort IN ('count_desc', 'count_asc') THEN page.last_at END DESC,
          page.item_key ASC
      )
      FROM (
        SELECT item_key, label, action_count, last_at
        FROM matched
        ORDER BY
          CASE WHEN v_sort = 'latest' THEN last_at END DESC NULLS LAST,
          CASE WHEN v_sort = 'oldest' THEN last_at END ASC NULLS LAST,
          CASE WHEN v_sort = 'count_desc' THEN action_count END DESC,
          CASE WHEN v_sort = 'count_asc' THEN action_count END ASC,
          CASE WHEN v_sort IN ('count_desc', 'count_asc') THEN last_at END DESC,
          item_key ASC
        OFFSET v_offset
        LIMIT v_limit
      ) AS page
    ), '[]'::jsonb)
  INTO v_total, v_events, v_rows
  FROM matched;

  v_page_count := coalesce(jsonb_array_length(v_rows), 0);
  IF v_scope = 'verified' AND v_status = 'complete' AND v_total = 0 THEN
    v_status := 'zero';
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'metric', CASE
      WHEN v_scope = 'verified' THEN 'verification_passed_browser_actions'
      ELSE 'raw_analytics_events'
    END,
    'scope', v_scope,
    'category', v_category,
    'kind', v_kind,
    'sort', v_sort,
    'timezone', 'Europe/Istanbul',
    'status', v_status,
    'started_at', v_started,
    'range_start', to_char(v_start, 'YYYY-MM-DD'),
    'range_end', to_char(v_end, 'YYYY-MM-DD'),
    'window_from', v_from,
    'window_until', v_until,
    'offset', v_offset,
    'limit', v_limit,
    'next_offset', v_offset + v_page_count,
    'total', v_total,
    'total_events', v_events,
    'page_count', v_page_count,
    'has_more', (v_offset + v_page_count) < v_total,
    'rows', v_rows
  );
END;
$activity$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics_activity(text, text, text, text, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics_activity(text, text, text, text, date, date, text, integer, integer) TO authenticated;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA private TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      private.analytics_action_attestation_counter,
      private.analytics_action_attestations,
      private.analytics_action_attestation_signals
    TO service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA private TO service_role;
    GRANT EXECUTE ON FUNCTION public.kutadgu_attest_analytics_event(uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.kutadgu_note_action_attestation_outage() TO service_role;
    REVOKE ALL ON FUNCTION public.get_kutadgu_analytics_activity(text, text, text, text, date, date, text, integer, integer) FROM service_role;
  END IF;
END
$grants$;

COMMIT;
