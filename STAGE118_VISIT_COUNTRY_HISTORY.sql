-- Stage 118 — paginated counted-visit country history for admin.
--
-- Adds public.get_kutadgu_visit_country_history and two private tables.
-- It does not replace private.kutadgu_country_visit_report,
-- get_kutadgu_analytics, or the latest-20 preview inside that report. It
-- does not change collection, the counting trigger, counted_at, the
-- three-hour gate, stored receipts, or either collection marker.
--
-- The reporting window is the existing Europe/Istanbul calendar. A new
-- read anchors that window at p_as_of, or at now() when p_as_of is omitted.
-- A future p_as_of is clamped to now(). counted_at must fall inside the
-- window, at or after private.analytics_country_counter.started_at, and at
-- or before that anchor. That timestamp bound is only the reporting window.
-- It is not a database snapshot. The counting trigger passes now(), which
-- is the inserting transaction's start time, so a transaction that starts
-- before this read and commits after it can store a receipt whose
-- counted_at is already inside the window.
--
-- Membership is copied once. When p_snapshot is omitted, the function
-- inserts the event_id of every counted receipt that this transaction can
-- already see inside the window. Another transaction that has not committed
-- is not visible, so its later commit cannot join the copy. Later pages
-- pass the opaque snapshot id and read only that copy. The id is not an
-- event id, visitor id, or transaction id. event_id stays in the private
-- member table and is not returned. Only counted receipts are copied. A
-- null country stays.
--
-- Ownership: the migration role owns both tables and the function. The
-- function is SECURITY DEFINER, so it reads and writes the tables as that
-- owner. Browser roles and service_role have no privileges on either table.
-- RLS is enabled and there are no policies.
--
-- Authorization: every call, including a call that already has a snapshot
-- id, requires is_kutadgu_admin() and JWT aal=aal2. The id does not bypass
-- that check. The frozen rows are the shared country report, not a
-- per-admin record.
--
-- Lifecycle: a new snapshot is inserted when p_snapshot is omitted. An open
-- snapshot stays readable so later pages keep the same membership. Creating
-- a snapshot deletes snapshot rows older than 36 hours, and the member rows
-- that belong to them. That delete does not delete events, receipts, gates,
-- or markers. A page that names an expired id fails; it does not start a
-- new snapshot and it does not change stored visits.
--
-- Coverage uses the same marker and gap rule as the country report, measured
-- once when the snapshot is created. An interval entirely before the marker
-- is unavailable, not zero. The function reads one bounded page.
--
-- Rollback is STAGE118_VISIT_COUNTRY_HISTORY_ROLLBACK.sql, run alone. It
-- drops this function and these two tables. It does not delete events or
-- receipts and does not move either collection marker.

BEGIN;

CREATE TABLE IF NOT EXISTS private.kutadgu_visit_history_snapshots (
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
  CONSTRAINT kutadgu_visit_history_snapshots_days_ok CHECK (days BETWEEN 1 AND 365)
);

CREATE TABLE IF NOT EXISTS private.kutadgu_visit_history_snapshot_members (
  snapshot_id uuid NOT NULL REFERENCES private.kutadgu_visit_history_snapshots (snapshot_id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  PRIMARY KEY (snapshot_id, event_id)
);

CREATE INDEX IF NOT EXISTS kutadgu_visit_history_snapshots_created_idx
  ON private.kutadgu_visit_history_snapshots (created_at);

ALTER TABLE private.kutadgu_visit_history_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.kutadgu_visit_history_snapshot_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.kutadgu_visit_history_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.kutadgu_visit_history_snapshot_members FROM PUBLIC, anon, authenticated;

DO $table_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON TABLE private.kutadgu_visit_history_snapshots FROM service_role;
    REVOKE ALL ON TABLE private.kutadgu_visit_history_snapshot_members FROM service_role;
  END IF;
END
$table_grants$;

DROP FUNCTION IF EXISTS public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz);
DROP FUNCTION IF EXISTS public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz, uuid);

CREATE FUNCTION public.get_kutadgu_visit_country_history(
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
  v_unidentified integer := 0;
  v_unprocessed integer := 0;
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
    FROM private.analytics_country_counter
    WHERE id;

    v_available := v_started IS NOT NULL AND v_until > v_started;
    v_marker_partial := v_available AND v_since < v_started;
    v_from := CASE
      WHEN v_started IS NULL THEN v_since
      ELSE greatest(v_since, v_started)
    END;

    IF v_available THEN
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
              WHERE r.event_id = e.event_id
            )
        )::integer
      INTO v_unidentified, v_unprocessed
      FROM public.analytics_events AS e
      WHERE e.created_at >= v_from
        AND e.created_at < v_until
        AND e.created_at <= v_as_of
        AND private.kutadgu_analytics_public_path(e.path);
      v_gap_partial := v_unidentified > 0 OR v_unprocessed > 0;
    END IF;

    INSERT INTO private.kutadgu_visit_history_snapshots (
      days, as_of, range_start, range_end, window_from, window_until,
      marker_partial, gap_partial, started_at
    ) VALUES (
      v_days, v_as_of, v_start, v_today, v_from, v_until,
      v_marker_partial, v_gap_partial, v_started
    )
    RETURNING snapshot_id INTO v_snapshot_id;

    IF v_available THEN
      INSERT INTO private.kutadgu_visit_history_snapshot_members (snapshot_id, event_id)
      SELECT v_snapshot_id, r.event_id
      FROM private.analytics_visit_receipts AS r
      WHERE r.counted
        AND r.counted_at >= v_from
        AND r.counted_at < v_until
        AND r.counted_at <= v_as_of;
    END IF;

    DELETE FROM private.kutadgu_visit_history_snapshots
    WHERE created_at < now() - interval '36 hours'
      AND snapshot_id IS DISTINCT FROM v_snapshot_id;
  ELSE
    SELECT
      snapshot_id, days, as_of, range_start, range_end, window_from, window_until,
      marker_partial, gap_partial, started_at
    INTO
      v_snapshot_id, v_days, v_as_of, v_start, v_today, v_from, v_until,
      v_marker_partial, v_gap_partial, v_started
    FROM private.kutadgu_visit_history_snapshots
    WHERE snapshot_id = p_snapshot;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'history snapshot is not available' USING ERRCODE = 'P0002';
    END IF;
    v_available := v_started IS NOT NULL AND v_until > v_started;
  END IF;

  IF NOT v_available THEN
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

  SELECT count(*)::integer
  INTO v_total
  FROM private.kutadgu_visit_history_snapshot_members
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
    FROM private.kutadgu_visit_history_snapshot_members AS m
    JOIN private.analytics_visit_receipts AS r ON r.event_id = m.event_id
    WHERE m.snapshot_id = v_snapshot_id
    ORDER BY r.counted_at DESC, r.event_id DESC
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

REVOKE ALL ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz, uuid) TO authenticated;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz, uuid) FROM service_role;
  END IF;
END
$grants$;

COMMIT;
