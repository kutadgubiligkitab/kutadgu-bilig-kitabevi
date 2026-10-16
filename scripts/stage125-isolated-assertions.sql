-- Isolated assertions for Stage 125. Not production.

\set ON_ERROR_STOP on

SELECT set_config('test.admin', 'on', false);
SELECT set_config('test.aal', 'aal2', false);

DO $assert$
DECLARE
  v_started timestamptz;
  v_events integer;
  v_legacy integer;
  v_verified integer;
  v_visitor uuid := '16161616-1616-4161-8161-161616161616';
  v_event uuid := '17171717-1717-4171-8171-171717171717';
  v_event2 uuid := '18181818-1818-4181-8181-181818181818';
  v_event3 uuid := '19191919-1919-4191-8191-191919191919';
  v_gate timestamptz;
  v_report jsonb;
  v_history jsonb;
  v_page2 jsonb;
  v_status jsonb;
BEGIN
  SELECT started_at INTO v_started FROM private.analytics_verified_counter;
  IF v_started IS NULL THEN
    RAISE EXCEPTION 'verified collection marker missing';
  END IF;
  SELECT count(*) INTO v_events FROM public.analytics_events;
  SELECT count(*) INTO v_verified FROM private.analytics_verified_receipts;
  IF v_verified <> 0 THEN
    RAISE EXCEPTION 'migration backfilled verified receipts';
  END IF;

  IF has_function_privilege('public', 'public.kutadgu_accept_verified_visit(uuid,uuid,text)', 'execute')
     OR has_function_privilege('anon', 'public.kutadgu_accept_verified_visit(uuid,uuid,text)', 'execute')
     OR has_function_privilege('authenticated', 'public.kutadgu_accept_verified_visit(uuid,uuid,text)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.kutadgu_accept_verified_visit(uuid,uuid,text)', 'execute') THEN
    RAISE EXCEPTION 'counting RPC grants are wrong';
  END IF;
  IF has_function_privilege('anon', 'public.kutadgu_consume_visit_proof(text)', 'execute')
     OR has_function_privilege('authenticated', 'public.kutadgu_note_verified_outage()', 'execute') THEN
    RAISE EXCEPTION 'proof or outage RPC is browser executable';
  END IF;
  IF has_table_privilege('anon', 'private.analytics_verified_receipts', 'insert')
     OR has_table_privilege('authenticated', 'private.analytics_verified_receipts', 'select')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.analytics_verified_receipts'::regclass) THEN
    RAISE EXCEPTION 'verified receipt table is exposed';
  END IF;
  IF position('analytics_verified' in pg_get_functiondef('private.kutadgu_count_page_visit()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'legacy page_view trigger writes verified receipts';
  END IF;
  IF position('p_at timestamptz' in pg_get_functiondef('public.kutadgu_accept_verified_visit(uuid,uuid,text)'::regprocedure)) > 0
     OR position('now()' in pg_get_functiondef('public.kutadgu_accept_verified_visit(uuid,uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'public counting function accepts a client clock';
  END IF;

  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id)
  VALUES ('page_view', '/', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b');
  IF (SELECT count(*) FROM private.analytics_verified_receipts) <> 0 THEN
    RAISE EXCEPTION 'direct insert created a verified receipt';
  END IF;
  IF (SELECT counted FROM private.analytics_visit_receipts WHERE event_id = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b') IS NOT TRUE THEN
    RAISE EXCEPTION 'legacy receipt was removed';
  END IF;

  PERFORM set_config('role', 'anon', true);
  BEGIN
    PERFORM public.kutadgu_accept_verified_visit(v_visitor, v_event, 'TR');
    RAISE EXCEPTION 'anon called the counting RPC';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.kutadgu_accept_verified_visit(v_visitor, v_event, 'TR');
    RAISE EXCEPTION 'authenticated called the counting RPC';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  PERFORM set_config('role', 'none', true);

  IF NOT private.kutadgu_accept_verified_visit(v_visitor, v_event, 'TR', timestamptz '2026-10-05 23:00:00+03') THEN
    RAISE EXCEPTION 'first verified visit was not counted';
  END IF;
  SELECT last_counted_at INTO v_gate FROM private.analytics_verified_gate WHERE visitor_id = v_visitor;
  IF private.kutadgu_accept_verified_visit(v_visitor, v_event2, 'DE', timestamptz '2026-10-06 01:00:00+03') THEN
    RAISE EXCEPTION 'midnight inside three hours counted again';
  END IF;
  IF (SELECT last_counted_at FROM private.analytics_verified_gate WHERE visitor_id = v_visitor) <> v_gate THEN
    RAISE EXCEPTION 'suppressed visit moved the gate';
  END IF;
  IF (SELECT country FROM private.analytics_verified_receipts WHERE event_id = v_event2) IS NOT NULL THEN
    RAISE EXCEPTION 'suppressed visit stored a country';
  END IF;
  IF NOT private.kutadgu_accept_verified_visit(v_visitor, v_event3, 'XX', timestamptz '2026-10-06 02:00:00+03') THEN
    RAISE EXCEPTION 'exactly three hours did not count';
  END IF;
  IF (SELECT country FROM private.analytics_verified_receipts WHERE event_id = v_event3) IS NOT NULL THEN
    RAISE EXCEPTION 'XX was stored';
  END IF;
  IF private.kutadgu_accept_verified_visit(v_visitor, v_event3, 'FR', timestamptz '2026-10-06 09:00:00+03') IS NOT TRUE THEN
    RAISE EXCEPTION 'retry changed the counted flag';
  END IF;
  IF (SELECT count(*) FROM private.analytics_verified_receipts WHERE event_id = v_event3) <> 1 THEN
    RAISE EXCEPTION 'retry created a second receipt';
  END IF;
  IF (SELECT country FROM private.analytics_verified_receipts WHERE event_id = v_event3) IS NOT NULL THEN
    RAISE EXCEPTION 'retry rewrote the country';
  END IF;

  v_status := private.kutadgu_verified_window_status(
    timestamptz '2020-01-01 00:00:00+03',
    timestamptz '2020-01-02 00:00:00+03',
    v_started
  );
  IF v_status->>'status' <> 'unavailable' OR v_status->>'visits' IS NOT NULL THEN
    RAISE EXCEPTION 'pre-collection window was not unavailable';
  END IF;
  v_status := private.kutadgu_verified_window_status(
    timestamptz '2026-10-04 00:00:00+03',
    timestamptz '2026-10-05 00:00:00+03',
    timestamptz '2026-01-01 00:00:00+03'
  );
  IF v_status->>'status' <> 'zero' OR v_status->>'visits' <> '0' THEN
    RAISE EXCEPTION 'quiet covered window was not zero';
  END IF;
  INSERT INTO private.analytics_verified_signals (occurred_at, kind)
  VALUES (timestamptz '2026-10-04 12:00:00+03', 'outage');
  v_status := private.kutadgu_verified_window_status(
    timestamptz '2026-10-04 00:00:00+03',
    timestamptz '2026-10-05 00:00:00+03',
    timestamptz '2026-01-01 00:00:00+03'
  );
  IF v_status->>'status' <> 'partial' OR v_status->>'visits' <> '0' THEN
    RAISE EXCEPTION 'outage looked like complete or zero coverage';
  END IF;

  INSERT INTO private.analytics_verified_signals (occurred_at, observed_until, kind)
  VALUES (
    timestamptz '2026-09-15 23:40:00+03',
    timestamptz '2026-09-16 00:40:00+03',
    'outage'
  );
  v_status := private.kutadgu_verified_window_status(
    timestamptz '2026-09-16 00:00:00+03',
    timestamptz '2026-09-16 00:30:00+03',
    timestamptz '2026-01-01 00:00:00+03'
  );
  IF v_status->>'status' <> 'partial' OR v_status->>'visits' <> '0' THEN
    RAISE EXCEPTION 'midnight boundary dropped a continuing outage: %', v_status;
  END IF;
  v_status := private.kutadgu_verified_window_status(
    timestamptz '2026-09-16 00:40:00+03',
    timestamptz '2026-09-16 02:00:00+03',
    timestamptz '2026-01-01 00:00:00+03'
  );
  IF v_status->>'status' <> 'zero' OR v_status->>'visits' <> '0' THEN
    RAISE EXCEPTION 'window after outage coverage was not zero: %', v_status;
  END IF;
  IF NOT private.kutadgu_verified_outage_overlaps(
    timestamptz '2026-09-16 00:00:00+03',
    timestamptz '2026-09-16 00:30:00+03'
  ) THEN
    RAISE EXCEPTION 'shared outage overlap missed the midnight boundary';
  END IF;

  UPDATE private.analytics_verified_counter SET started_at = now() - interval '2 days';
  INSERT INTO private.analytics_verified_signals (occurred_at, kind)
  VALUES (now() - interval '30 minutes', 'outage');
  PERFORM set_config('role', 'service_role', true);
  IF public.kutadgu_note_verified_outage() IS NOT TRUE THEN
    RAISE EXCEPTION 'continuing outage was not recorded';
  END IF;
  PERFORM set_config('role', 'none', true);
  v_status := private.kutadgu_verified_window_status(
    now() - interval '20 minutes',
    now() + interval '1 minute',
    now() - interval '2 days'
  );
  IF v_status->>'status' <> 'partial' OR v_status->>'visits' <> '0' THEN
    RAISE EXCEPTION 'continuing outage disappeared across the reporting boundary: %', v_status;
  END IF;
  v_report := private.kutadgu_verified_visit_report(7);
  IF v_report->'today'->>'status' <> 'partial'
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_report->'daily') AS day
       WHERE day->>'status' = 'partial'
     ) THEN
    RAISE EXCEPTION 'cards or charts missed the continuing outage: %', v_report->'today';
  END IF;
  v_report := private.kutadgu_verified_country_report(1);
  IF v_report->>'status' <> 'partial' THEN
    RAISE EXCEPTION 'country report missed the continuing outage: %', v_report->>'status';
  END IF;
  v_history := public.get_kutadgu_verified_visit_history(1, 0, 20, now());
  IF v_history->>'status' <> 'partial' THEN
    RAISE EXCEPTION 'history missed the continuing outage: %', v_history->>'status';
  END IF;

  v_report := public.get_kutadgu_analytics(30);
  IF v_report->'verified_visits'->>'metric' <> 'verification_passed_browser_visits' THEN
    RAISE EXCEPTION 'verified report missing';
  END IF;
  IF (v_report->'counted_visits'->'today'->>'visits')::integer
     = (v_report->'verified_visits'->'today'->>'visits')::integer
     AND (SELECT count(*) FROM private.analytics_visit_receipts WHERE counted) <>
         (SELECT count(*) FROM private.analytics_verified_receipts WHERE counted) THEN
    NULL;
  END IF;
  IF (SELECT count(*) FROM private.analytics_verified_receipts) <> 3 THEN
    RAISE EXCEPTION 'verified receipt count changed';
  END IF;
  SELECT count(*) INTO v_legacy FROM private.analytics_visit_receipts;
  IF v_legacy < 1 THEN
    RAISE EXCEPTION 'legacy history disappeared';
  END IF;

  UPDATE private.analytics_verified_counter SET started_at = timestamptz '2026-01-01 00:00:00+03';
  v_history := public.get_kutadgu_verified_visit_history(3650, 0, 20, timestamptz '2026-10-06 12:00:00+03');
  IF v_history->>'status' NOT IN ('complete', 'partial') OR jsonb_array_length(v_history->'rows') <> 2 THEN
    RAISE EXCEPTION 'history did not page the verified receipts: %', v_history;
  END IF;
  IF v_history->'rows'->0 ? 'event_id' OR v_history->'rows'->0 ? 'visitor_id' THEN
    RAISE EXCEPTION 'history exposed identity';
  END IF;
  v_page2 := public.get_kutadgu_verified_visit_history(3650, 20, 20, NULL, (v_history->>'snapshot_id')::uuid);
  IF v_page2->>'total' <> v_history->>'total' OR jsonb_array_length(v_page2->'rows') <> 0 THEN
    RAISE EXCEPTION 'history snapshot changed';
  END IF;
  PERFORM private.kutadgu_accept_verified_visit(
    '20202020-2020-4020-8020-202020202020',
    '21212121-2121-4121-8121-212121212121',
    'FR',
    timestamptz '2026-10-06 11:00:00+03'
  );
  v_page2 := public.get_kutadgu_verified_visit_history(3650, 0, 20, NULL, (v_history->>'snapshot_id')::uuid);
  IF v_page2->>'total' <> v_history->>'total' THEN
    RAISE EXCEPTION 'later visit rewrote the history page';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) < v_events THEN
    RAISE EXCEPTION 'historical analytics rows were deleted';
  END IF;
END
$assert$;
