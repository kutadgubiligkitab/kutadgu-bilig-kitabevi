-- Behavior checks for Stage 118 on a throwaway database.
-- Stages 114 through 117 are already applied. This file does not delete rows.

DO $check$
DECLARE
  v_marker timestamptz := timestamptz '2026-09-01 00:00:00+03';
  v_as_of timestamptz := timestamptz '2026-09-15 12:00:00+03';
  v_snapshot jsonb;
  v_page2 jsonb;
  v_later jsonb;
  v_zero jsonb;
  v_unavailable jsonb;
  v_wide jsonb;
  v_now jsonb;
  v_events integer;
  v_receipts integer;
  v_visit timestamptz;
  v_country timestamptz;
  v_text text;
  v_first text;
  v_second text;
  v_total integer;
  v_step integer;
  v_joined jsonb := '[]'::jsonb;
  v_visitor text := '12121212-1212-4121-8121-121212121299';
  v_kept uuid := '19191919-1919-4191-8191-191919191919';
  v_suppressed uuid := '20202020-2020-4202-8202-202020202020';
  v_next uuid := '21212121-2121-4121-8121-212121212121';
BEGIN
  SELECT count(*) INTO v_events FROM public.analytics_events;
  SELECT count(*) INTO v_receipts FROM private.analytics_visit_receipts;
  SELECT started_at INTO v_visit FROM private.analytics_visit_counter;
  SELECT started_at INTO v_country FROM private.analytics_country_counter;

  UPDATE private.analytics_country_counter
  SET started_at = v_marker
  WHERE id;

  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country)
  VALUES
    ('10000000-0000-4000-8000-000000000001', 'hist-1', true, timestamptz '2026-08-31 23:59:00+03', 'TR'),
    ('10000000-0000-4000-8000-000000000002', 'hist-1', true, timestamptz '2026-09-01 00:00:00+03', 'TR'),
    ('10000000-0000-4000-8000-000000000003', 'hist-1', true, timestamptz '2026-09-08 23:59:00+03', 'TR'),
    ('10000000-0000-4000-8000-000000000004', 'hist-1', false, NULL, NULL);

  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country)
  SELECT
    ('11000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
    'hist-page',
    true,
    timestamptz '2026-09-10 10:00:00+03' + make_interval(mins => i),
    'TR'
  FROM generate_series(0, 17) AS i;

  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country)
  VALUES
    ('10000000-0000-4000-8000-000000000020', 'hist-eq', true, timestamptz '2026-09-11 08:00:00+03', 'FR'),
    ('10000000-0000-4000-8000-000000000021', 'hist-eq', true, timestamptz '2026-09-11 08:00:00+03', 'DE'),
    ('10000000-0000-4000-8000-000000000022', 'hist-unknown', true, timestamptz '2026-09-12 09:00:00+03', NULL),
    ('10000000-0000-4000-8000-000000000023', 'hist-late', true, timestamptz '2026-09-15 18:00:00+03', 'JP');

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);

  v_zero := public.get_kutadgu_visit_country_history(1, 0, 20, timestamptz '2026-09-02 12:00:00+03');
  IF v_zero->>'status' IS DISTINCT FROM 'zero' OR v_zero->>'total' IS DISTINCT FROM '0' OR v_zero->'rows' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'quiet interval was not measured zero: %', v_zero;
  END IF;

  v_unavailable := public.get_kutadgu_visit_country_history(7, 0, 20, timestamptz '2026-08-20 12:00:00+03');
  IF v_unavailable->>'status' IS DISTINCT FROM 'unavailable'
     OR v_unavailable->'rows' IS DISTINCT FROM 'null'::jsonb
     OR v_unavailable->'total' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'pre-collection window was not unavailable: %', v_unavailable;
  END IF;

  v_snapshot := public.get_kutadgu_visit_country_history(7, 0, 20, v_as_of);
  IF v_snapshot->>'status' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'seven-day history status %', v_snapshot->>'status';
  END IF;
  IF (v_snapshot->>'total')::integer IS DISTINCT FROM 21
     OR jsonb_array_length(v_snapshot->'rows') IS DISTINCT FROM 20
     OR v_snapshot->>'has_more' IS DISTINCT FROM 'true'
     OR (v_snapshot->>'limit')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'first page shape %', v_snapshot;
  END IF;
  IF v_snapshot->'rows'->0->>'country' IS NOT NULL
     OR (v_snapshot->'rows'->0->>'counted_at')::timestamptz IS DISTINCT FROM timestamptz '2026-09-12 09:00:00+03' THEN
    RAISE EXCEPTION 'unknown country was not first: %', v_snapshot->'rows'->0;
  END IF;
  v_first := v_snapshot->'rows'->1->>'country';
  v_second := v_snapshot->'rows'->2->>'country';
  IF v_first IS DISTINCT FROM 'DE' OR v_second IS DISTINCT FROM 'FR' THEN
    RAISE EXCEPTION 'equal timestamps ordered % then %', v_first, v_second;
  END IF;
  IF (v_snapshot->'rows'->1->>'counted_at')::timestamptz IS DISTINCT FROM (v_snapshot->'rows'->2->>'counted_at')::timestamptz THEN
    RAISE EXCEPTION 'equal timestamp pair diverged';
  END IF;

  v_page2 := public.get_kutadgu_visit_country_history(7, 20, 20, (v_snapshot->>'as_of')::timestamptz);
  IF (v_page2->>'total')::integer IS DISTINCT FROM 21
     OR jsonb_array_length(v_page2->'rows') IS DISTINCT FROM 1
     OR v_page2->>'has_more' IS DISTINCT FROM 'false'
     OR v_page2->>'as_of' IS DISTINCT FROM v_snapshot->>'as_of' THEN
    RAISE EXCEPTION 'second page shifted: %', v_page2;
  END IF;
  IF (v_page2->'rows'->0->>'counted_at')::timestamptz IS DISTINCT FROM timestamptz '2026-09-10 10:00:00+03' THEN
    RAISE EXCEPTION 'oldest row was not alone on page 2: %', v_page2->'rows'->0;
  END IF;

  v_later := public.get_kutadgu_visit_country_history(1, 0, 20, timestamptz '2026-09-10 10:00:00+03');
  IF (v_later->>'total')::integer IS DISTINCT FROM 1
     OR jsonb_array_length(v_later->'rows') IS DISTINCT FROM 1
     OR v_later->>'has_more' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'single history row was not one page: %', v_later;
  END IF;

  v_joined := '[]'::jsonb;
  FOR v_step IN 0..2 LOOP
    v_later := public.get_kutadgu_visit_country_history(7, v_step * 10, 10, v_as_of);
    IF v_later->>'as_of' IS DISTINCT FROM v_snapshot->>'as_of'
       OR (v_later->>'total')::integer IS DISTINCT FROM 21 THEN
      RAISE EXCEPTION 'limit 10 page changed the snapshot: %', v_later;
    END IF;
    v_joined := v_joined || coalesce(v_later->'rows', '[]'::jsonb);
  END LOOP;
  v_wide := public.get_kutadgu_visit_country_history(7, 0, 50, v_as_of);
  IF v_joined <> (v_wide->'rows') OR jsonb_array_length(v_joined) IS DISTINCT FROM 21 THEN
    RAISE EXCEPTION 'paged rows diverged from the ordered snapshot';
  END IF;

  v_later := public.get_kutadgu_visit_country_history(NULL, NULL, NULL, v_as_of);
  IF (v_later->>'days')::integer IS DISTINCT FROM 30
     OR (v_later->>'limit')::integer IS DISTINCT FROM 20
     OR (v_later->>'offset')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'defaults were not 30/0/20: %', v_later;
  END IF;
  v_later := public.get_kutadgu_visit_country_history(0, -4, 0, v_as_of);
  IF (v_later->>'days')::integer IS DISTINCT FROM 1
     OR (v_later->>'offset')::integer IS DISTINCT FROM 0
     OR (v_later->>'limit')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'lower bounds failed: %', v_later;
  END IF;
  v_later := public.get_kutadgu_visit_country_history(9999, 5, 500, v_as_of);
  IF (v_later->>'days')::integer IS DISTINCT FROM 365
     OR (v_later->>'limit')::integer IS DISTINCT FROM 50
     OR jsonb_array_length(v_later->'rows') > 50 THEN
    RAISE EXCEPTION 'upper bounds failed: %', v_later;
  END IF;

  v_text := v_snapshot::text || v_page2::text;
  IF v_text ~* 'event_id' OR v_text ~* 'visitor_id' OR v_text ~* '"ip"' THEN
    RAISE EXCEPTION 'history payload exposed a private identifier';
  END IF;

  v_later := public.get_kutadgu_visit_country_history(7, 20, 20, v_as_of);
  IF (v_later->>'total')::integer IS DISTINCT FROM 21
     OR position('JP' in v_later::text) > 0 THEN
    RAISE EXCEPTION 'later same-day visit entered the open snapshot: %', v_later;
  END IF;

  v_later := public.get_kutadgu_visit_country_history(7, 0, 20, timestamptz '2026-09-15 20:00:00+03');
  IF (v_later->>'total')::integer IS DISTINCT FROM 22 OR v_later->'rows'->0->>'country' IS DISTINCT FROM 'JP' THEN
    RAISE EXCEPTION 'refresh snapshot missed the new arrival: %', v_later->'rows'->0;
  END IF;

  v_wide := public.get_kutadgu_visit_country_history(30, 0, 50, v_as_of);
  v_total := (v_wide->>'total')::integer;
  IF v_wide->>'status' IS DISTINCT FROM 'partial' OR v_total IS DISTINCT FROM 23 THEN
    RAISE EXCEPTION 'thirty-day boundary total % status %', v_total, v_wide->>'status';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_wide->'rows') AS row
    WHERE (row->>'counted_at')::timestamptz = timestamptz '2026-08-31 23:59:00+03'
  ) THEN
    RAISE EXCEPTION 'receipt before the country marker was included';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_wide->'rows') AS row
    WHERE (row->>'counted_at')::timestamptz = timestamptz '2026-09-01 00:00:00+03'
  ) THEN
    RAISE EXCEPTION 'receipt at the country marker was omitted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_wide->'rows') AS row
    WHERE (row->>'counted_at')::timestamptz = timestamptz '2026-09-08 23:59:00+03'
  ) THEN
    RAISE EXCEPTION 'receipt inside the thirty-day window was omitted';
  END IF;

  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country)
  VALUES ('10000000-0000-4000-8000-000000000024', 'hist-midnight', true, timestamptz '2026-09-16 00:00:00+03', 'IT');
  v_later := public.get_kutadgu_visit_country_history(7, 0, 50, v_as_of);
  IF (v_later->>'total')::integer IS DISTINCT FROM 21 THEN
    RAISE EXCEPTION 'midnight entered the previous Istanbul day: %', v_later->>'total';
  END IF;
  v_later := public.get_kutadgu_visit_country_history(1, 0, 20, timestamptz '2026-09-16 00:30:00+03');
  IF (v_later->>'total')::integer IS DISTINCT FROM 1
     OR v_later->'rows'->0->>'country' IS DISTINCT FROM 'IT'
     OR (v_later->'rows'->0->>'counted_at')::timestamptz IS DISTINCT FROM timestamptz '2026-09-16 00:00:00+03' THEN
    RAISE EXCEPTION 'Istanbul midnight was not the new day: %', v_later;
  END IF;

  ALTER TABLE public.analytics_events DISABLE TRIGGER analytics_events_count_page_visit;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, created_at)
  VALUES ('page_view', '/', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', '30000000-0000-4000-8000-000000000099', timestamptz '2026-09-10 11:00:00+03');
  ALTER TABLE public.analytics_events ENABLE TRIGGER analytics_events_count_page_visit;

  v_snapshot := public.get_kutadgu_visit_country_history(7, 0, 20, v_as_of);
  IF v_snapshot->>'status' IS DISTINCT FROM 'partial' OR (v_snapshot->>'total')::integer IS DISTINCT FROM 21 THEN
    RAISE EXCEPTION 'gap changed the snapshot rows: %', v_snapshot->>'status';
  END IF;

  IF NOT private.kutadgu_accept_page_visit(v_visitor, v_kept, now() - interval '5 hours') THEN
    RAISE EXCEPTION 'first visit inside three hours was not counted';
  END IF;
  IF private.kutadgu_accept_page_visit(v_visitor, v_suppressed, now() - interval '4 hours') THEN
    RAISE EXCEPTION 'suppressed visit was counted';
  END IF;
  IF NOT private.kutadgu_accept_page_visit(v_visitor, v_next, now() - interval '2 hours') THEN
    RAISE EXCEPTION 'visit at the three-hour boundary was not counted';
  END IF;

  v_now := public.get_kutadgu_visit_country_history(7, 0, 50, NULL);
  IF (v_now->>'total')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'current window total %', v_now->>'total';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(v_now->'rows', '[]'::jsonb)) AS row
    WHERE (row->>'counted_at')::timestamptz = (
      SELECT counted_at FROM private.analytics_visit_receipts WHERE event_id = v_suppressed
    )
  ) THEN
    RAISE EXCEPTION 'suppressed visit appeared in history';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.analytics_visit_receipts WHERE event_id = v_suppressed AND counted = false
  ) THEN
    RAISE EXCEPTION 'suppressed receipt was removed';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) < v_events THEN
    RAISE EXCEPTION 'history checks deleted events';
  END IF;
  IF (SELECT count(*) FROM private.analytics_visit_receipts) < v_receipts THEN
    RAISE EXCEPTION 'history checks deleted receipts';
  END IF;
  IF (SELECT started_at FROM private.analytics_visit_counter) IS DISTINCT FROM v_visit THEN
    RAISE EXCEPTION 'visit marker moved';
  END IF;
  IF (SELECT started_at FROM private.analytics_country_counter) IS DISTINCT FROM v_marker THEN
    RAISE EXCEPTION 'country marker moved during reads';
  END IF;

  IF has_function_privilege('anon', 'public.get_kutadgu_visit_country_history(integer,integer,integer,timestamptz)', 'execute')
     OR has_function_privilege('public', 'public.get_kutadgu_visit_country_history(integer,integer,integer,timestamptz)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.get_kutadgu_visit_country_history(integer,integer,integer,timestamptz)', 'execute') THEN
    RAISE EXCEPTION 'history execute grants are wrong';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     AND has_function_privilege('service_role', 'public.get_kutadgu_visit_country_history(integer,integer,integer,timestamptz)', 'execute') THEN
    RAISE EXCEPTION 'service_role can execute history';
  END IF;
  IF has_table_privilege('anon', 'private.analytics_visit_receipts', 'select')
     OR has_table_privilege('authenticated', 'private.analytics_visit_receipts', 'select') THEN
    RAISE EXCEPTION 'browser role can read receipts';
  END IF;
END
$check$;
