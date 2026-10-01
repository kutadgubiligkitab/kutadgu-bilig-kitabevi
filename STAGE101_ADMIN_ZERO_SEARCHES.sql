-- Stage 101 — paginated admin list of no-result searches.
-- MANUAL APPLY ONLY. This file was not executed against production.
-- It does not replace get_kutadgu_analytics and it does not require Stage 100.
--
-- Prerequisite: public.analytics_events already exists (Stage 8 or later).
-- Do not rerun STAGE8_STORE_ANALYTICS.sql over a database that has Stage 100.
--
-- Activation:
--   1. Run this file once in the Supabase SQL editor. It is repeat-safe.
--   2. Deploy the site that calls get_kutadgu_zero_searches.
-- Until both steps are done, Admin shows a setup-required state for this
-- list. It does not fall back to the old top-ten list, and it does not
-- show that missing function as zero.
--
-- The other analytics cards stay on get_kutadgu_analytics. That function
-- still uses a rolling window until Stage 100 is applied, so its zero-result
-- total can disagree with this calendar list until then. This section uses
-- only the total returned here.
--
-- Counting:
--   Canonical rows are event_name = 'search' AND result_count = 0.
--   NULL result_count is unknown, not zero.
--   zero_result_search is the older explicit event. It is used only when the
--   selected Europe/Istanbul window contains no search event at all.
--   A window that contains any search event does not also count
--   zero_result_search, because the current site writes both for one
--   completed zero-result search and the legacy table has no event_id to
--   pair them. Legacy-only queries in a mixed window are omitted. That is a
--   documented limit, not a reconstructed history.
--   In a legacy-only window, zero_result_search counts when result_count is
--   NULL or 0. A positive result_count on that event name is not a zero.
--   Stored text is grouped with the same normalization the browser uses:
--   trim, collapse whitespace, and keep the first 80 characters. Case is
--   not folded, so distinct terms stay distinct.
--   Order is last searched time descending, then the normalized query
--   ascending.
--
-- Pagination is one browsing snapshot. The first call omits p_as_of. The
-- function stamps as_of at now(), and the Europe/Istanbul day boundaries
-- are derived from that instant. Later pages pass the same as_of and the
-- next_offset from the previous page. Grouping, ordering, and totals stay
-- inside created_at <= as_of. A search that arrives after as_of, including
-- a repeat that would become the newest row, is outside this snapshot.
-- Refresh omits p_as_of and opens a new snapshot. The page cursor is
-- next_offset, not the number of rows left after a client dedupe.
--
-- This file drops the older three-argument function before creating the
-- four-argument one. Postgres would otherwise keep both, and PostgREST
-- would see an overload. A call that omits p_as_of still starts a snapshot
-- because that argument defaults to NULL. A future as_of is clamped to
-- now() so the calendar day cannot move ahead of the database clock.
--
-- The partial index analytics_events_zero_search_recent_idx limits the
-- canonical scan to confirmed zero-result search rows. The legacy event
-- still uses analytics_events_name_created_idx. Rollback drops this
-- function (both signatures, if an older one is still present) and this
-- index. It does not delete analytics_events.
--
-- Rollback: run STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql by itself.

BEGIN;

CREATE INDEX IF NOT EXISTS analytics_events_zero_search_recent_idx
  ON public.analytics_events (created_at DESC, search_query)
  WHERE event_name = 'search'
    AND result_count = 0
    AND search_query IS NOT NULL
    AND btrim(search_query) <> '';

DROP FUNCTION IF EXISTS public.get_kutadgu_zero_searches(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.get_kutadgu_zero_searches(
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
AS $$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_as_of timestamptz := least(coalesce(p_as_of, now()), now());
  v_today date := (timezone('Europe/Istanbul', v_as_of))::date;
  v_start date := v_today - (v_days - 1);
  v_since timestamptz := v_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_until timestamptz := (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_has_search boolean := false;
  v_total_events bigint := 0;
  v_total_queries bigint := 0;
  v_queries jsonb := '[]'::jsonb;
  v_page_count integer := 0;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.analytics_events
    WHERE created_at >= v_since
      AND created_at < v_until
      AND created_at <= v_as_of
      AND event_name = 'search'
  ) INTO v_has_search;

  WITH qualifying AS (
    SELECT
      left(regexp_replace(btrim(search_query), '[[:space:]]+', ' ', 'g'), 80) AS query,
      created_at
    FROM public.analytics_events
    WHERE created_at >= v_since
      AND created_at < v_until
      AND created_at <= v_as_of
      AND search_query IS NOT NULL
      AND btrim(search_query) <> ''
      AND (
        (
          v_has_search
          AND event_name = 'search'
          AND result_count = 0
        )
        OR (
          NOT v_has_search
          AND event_name = 'zero_result_search'
          AND (result_count IS NULL OR result_count = 0)
        )
      )
  ),
  grouped AS (
    SELECT query, count(*)::integer AS searches, max(created_at) AS last_searched_at
    FROM qualifying
    WHERE query <> ''
    GROUP BY query
  )
  SELECT
    coalesce(sum(searches), 0),
    count(*),
    coalesce((
      SELECT jsonb_agg(to_jsonb(page) ORDER BY page.last_searched_at DESC, page.query ASC)
      FROM (
        SELECT query, searches, last_searched_at
        FROM grouped
        ORDER BY last_searched_at DESC, query ASC
        OFFSET v_offset
        LIMIT v_limit
      ) page
    ), '[]'::jsonb)
  INTO v_total_events, v_total_queries, v_queries
  FROM grouped;

  v_page_count := coalesce(jsonb_array_length(v_queries), 0);

  RETURN jsonb_build_object(
    'schema_version', 2,
    'timezone', 'Europe/Istanbul',
    'range_start', v_start,
    'range_end', v_today,
    'days', v_days,
    'as_of', v_as_of,
    'offset', v_offset,
    'next_offset', v_offset + v_page_count,
    'limit', v_limit,
    'total_events', v_total_events,
    'total_queries', v_total_queries,
    'has_more', (v_offset + v_page_count) < v_total_queries,
    'representation', CASE WHEN v_has_search THEN 'search' ELSE 'zero_result_search' END,
    'queries', v_queries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_kutadgu_zero_searches(integer, integer, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_zero_searches(integer, integer, integer, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_zero_searches(integer, integer, integer, timestamptz) TO authenticated;

COMMIT;
