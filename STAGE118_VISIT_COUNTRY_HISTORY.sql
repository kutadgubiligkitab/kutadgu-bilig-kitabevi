-- Stage 118 — paginated counted-visit country history for admin.
--
-- Adds public.get_kutadgu_visit_country_history. It does not replace
-- private.kutadgu_country_visit_report, get_kutadgu_analytics, or the
-- latest-20 preview inside that report. It does not change collection,
-- the three-hour gate, stored receipts, or either collection marker.
--
-- The window is the existing Europe/Istanbul calendar, anchored at the
-- snapshot instant p_as_of (or now() when omitted). counted_at must fall
-- inside that window, at or after private.analytics_country_counter.started_at,
-- and at or before the snapshot. A later counted visit stays out of an open
-- snapshot, so offset pages cannot skip or repeat rows because a new visit
-- arrived. event_id breaks equal counted_at ties inside the query and is
-- not returned. Only counted receipts are included. A null country stays.
--
-- Coverage uses the same marker and gap rule as the country report, also
-- cut at the snapshot. An interval entirely before the marker is unavailable,
-- not zero. The function reads one bounded page. It does not delete rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_kutadgu_visit_country_history(
  p_days integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20,
  p_as_of timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $history$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_as_of timestamptz := least(coalesce(p_as_of, now()), now());
  v_today date := (timezone('Europe/Istanbul', v_as_of))::date;
  v_start date := v_today - (v_days - 1);
  v_since timestamptz := v_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_until timestamptz := (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_started timestamptz;
  v_from timestamptz;
  v_partial boolean := false;
  v_total integer := 0;
  v_unidentified integer := 0;
  v_unprocessed integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_page_count integer := 0;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;

  SELECT started_at INTO v_started
  FROM private.analytics_country_counter
  WHERE id;

  IF v_started IS NULL OR v_until <= v_started THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'timezone', 'Europe/Istanbul',
      'window_hours', 3,
      'started_at', v_started,
      'status', 'unavailable',
      'range_start', to_char(v_start, 'YYYY-MM-DD'),
      'range_end', to_char(v_today, 'YYYY-MM-DD'),
      'days', v_days,
      'as_of', v_as_of,
      'offset', v_offset,
      'limit', v_limit,
      'next_offset', v_offset,
      'total', NULL,
      'page_count', 0,
      'has_more', false,
      'rows', NULL
    );
  END IF;

  v_partial := v_since < v_started;
  v_from := greatest(v_since, v_started);

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
    AND created_at <= v_as_of
    AND private.kutadgu_analytics_public_path(path);

  IF v_unidentified > 0 OR v_unprocessed > 0 THEN
    v_partial := true;
  END IF;

  SELECT count(*)::integer
  INTO v_total
  FROM private.analytics_visit_receipts
  WHERE counted
    AND counted_at >= v_from
    AND counted_at < v_until
    AND counted_at <= v_as_of;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('country', country, 'counted_at', counted_at)
      ORDER BY counted_at DESC, event_id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT country, counted_at, event_id
    FROM private.analytics_visit_receipts
    WHERE counted
      AND counted_at >= v_from
      AND counted_at < v_until
      AND counted_at <= v_as_of
    ORDER BY counted_at DESC, event_id DESC
    OFFSET v_offset
    LIMIT v_limit
  ) page;

  v_page_count := coalesce(jsonb_array_length(v_rows), 0);

  RETURN jsonb_build_object(
    'schema_version', 1,
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

REVOKE ALL ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz) TO authenticated;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz) FROM service_role;
  END IF;
END
$grants$;

COMMIT;
