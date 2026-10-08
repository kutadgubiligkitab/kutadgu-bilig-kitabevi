-- Behavior checks for Stage 117 on the throwaway database.
-- The caller has already applied Stages 114, 115, 116, and 117.

DO $check$
DECLARE
  v_visitor text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_other text := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_anon text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_e1 uuid := '11111111-1111-4111-8111-111111111111';
  v_e2 uuid := '22222222-2222-4222-8222-222222222222';
  v_e3 uuid := '33333333-3333-4333-8333-333333333333';
  v_e4 uuid := '44444444-4444-4444-8444-444444444444';
  v_dup uuid := '55555555-5555-4555-8555-555555555555';
  v_cart uuid := '66666666-6666-4666-8666-666666666666';
  v_admin uuid := '77777777-7777-4777-8777-777777777777';
  v_unknown uuid := '88888888-8888-4888-8888-888888888888';
  v_t1code uuid := '99999999-9999-4999-8999-999999999999';
  v_staff uuid := 'abababab-abab-4aba-8aba-abababababab';
  v_live uuid := 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc';
  v_night uuid := 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
  v_early uuid := 'dededede-dede-4ded-8ded-dededededede';
  v_morn uuid := 'efefefef-efef-4efe-8efe-efefefefefef';
  v_night_at timestamptz;
  v_early_at timestamptz;
  v_morn_at timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_expected_code text;
  v_expected_visits integer;
  v_t1 timestamptz := now() - interval '4 hours';
  v_t2 timestamptz := now() - interval '2 hours';
  v_t3 timestamptz := now() - interval '1 hour';
  v_report jsonb;
  v_country text;
  v_counted boolean;
  v_rows integer;
BEGIN
  ALTER TABLE public.analytics_events DISABLE TRIGGER analytics_events_count_page_visit;

  UPDATE private.analytics_country_counter
  SET started_at = now() - interval '30 days'
  WHERE id;

  SET ROLE service_role;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country)
  VALUES
    ('page_view', '/', v_visitor, v_e1, 'tr'),
    ('page_view', '/', v_visitor, v_e2, 'DE'),
    ('page_view', '/', v_visitor, v_e3, 'FR'),
    ('page_view', '/book/15', v_other, v_e4, 'DE'),
    ('page_view', '/', v_other, v_unknown, 'XX'),
    ('page_view', '/', v_other, v_t1code, 'T1'),
    ('add_to_cart', '/', v_other, v_cart, 'TR'),
    ('page_view', '/admin.html', v_other, v_admin, 'TR');
  RESET ROLE;

  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_e1;
  IF v_country IS DISTINCT FROM 'TR' THEN
    RAISE EXCEPTION 'service role country was not normalized: %', v_country;
  END IF;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_unknown;
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION 'XX must stay unknown, got %', v_country;
  END IF;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_t1code;
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION 'T1 must stay unknown, got %', v_country;
  END IF;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_cart;
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION 'cart event stored a country';
  END IF;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_admin;
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION 'admin path stored a country';
  END IF;

  SET ROLE anon;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country)
  VALUES ('page_view', '/', v_anon, v_dup, 'TR');
  RESET ROLE;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_dup;
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION 'anon spoofed country was stored: %', v_country;
  END IF;

  UPDATE public.analytics_events SET country = 'US' WHERE event_id = v_e1;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_e1;
  IF v_country IS DISTINCT FROM 'TR' THEN
    RAISE EXCEPTION 'country update overwrote the original: %', v_country;
  END IF;

  ALTER TABLE public.analytics_events ENABLE TRIGGER analytics_events_count_page_visit;

  IF NOT private.kutadgu_accept_page_visit(v_visitor, v_e1, v_t1) THEN
    RAISE EXCEPTION 'first visit should count';
  END IF;
  IF private.kutadgu_accept_page_visit(v_visitor, v_e2, v_t2) THEN
    RAISE EXCEPTION 'visit inside three hours counted';
  END IF;
  IF NOT private.kutadgu_accept_page_visit(v_visitor, v_e3, v_t3) THEN
    RAISE EXCEPTION 'visit at three hours should count';
  END IF;
  PERFORM private.kutadgu_accept_page_visit(v_visitor, v_e1, v_t3);
  IF (SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id = v_e1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'retried event added a receipt';
  END IF;
  SELECT country INTO v_country
  FROM private.analytics_visit_receipts
  WHERE event_id = v_e1;
  IF v_country IS DISTINCT FROM 'TR' THEN
    RAISE EXCEPTION 'retry changed the original country: %', v_country;
  END IF;
  SELECT country, counted INTO v_country, v_counted
  FROM private.analytics_visit_receipts
  WHERE event_id = v_e2;
  IF v_counted OR v_country IS NOT NULL THEN
    RAISE EXCEPTION 'suppressed visit stored a country or counted';
  END IF;
  SELECT country INTO v_country FROM private.analytics_visit_receipts WHERE event_id = v_e3;
  IF v_country IS DISTINCT FROM 'FR' THEN
    RAISE EXCEPTION 'later visit kept the old country: %', v_country;
  END IF;

  v_night_at := ((timezone('Europe/Istanbul', now()))::date - 1)::timestamp AT TIME ZONE 'Europe/Istanbul' + time '23:30';
  v_early_at := v_night_at + interval '150 minutes';
  v_morn_at := v_night_at + interval '3 hours';
  IF NOT private.kutadgu_accept_page_visit('dddddddd-dddd-4ddd-8ddd-dddddddddddd', v_night, v_night_at) THEN
    RAISE EXCEPTION 'midnight visit should count';
  END IF;
  IF private.kutadgu_accept_page_visit('dddddddd-dddd-4ddd-8ddd-dddddddddddd', v_early, v_early_at) THEN
    RAISE EXCEPTION 'visit before three hours after midnight counted';
  END IF;
  IF NOT private.kutadgu_accept_page_visit('dddddddd-dddd-4ddd-8ddd-dddddddddddd', v_morn, v_morn_at) THEN
    RAISE EXCEPTION 'visit exactly three hours after midnight should count';
  END IF;

  SET ROLE service_role;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country)
  VALUES ('page_view', '/', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', v_live, 'jp');
  BEGIN
    INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country)
    VALUES ('page_view', '/', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', v_live, 'US');
    RAISE EXCEPTION 'duplicate event_id was inserted';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country)
  VALUES ('page_view', '/book-staff.html', 'ffffffff-ffff-4fff-8fff-ffffffffffff', v_staff, 'TR');
  RESET ROLE;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_live;
  IF v_country IS DISTINCT FROM 'JP' THEN
    RAISE EXCEPTION 'live insert country changed: %', v_country;
  END IF;
  IF (SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id = v_live) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'live duplicate created extra receipts';
  END IF;
  SELECT country INTO v_country FROM private.analytics_visit_receipts WHERE event_id = v_live AND counted;
  IF v_country IS DISTINCT FROM 'JP' THEN
    RAISE EXCEPTION 'counted live visit lost JP: %', v_country;
  END IF;
  SELECT country INTO v_country FROM public.analytics_events WHERE event_id = v_staff;
  IF v_country IS NOT NULL OR EXISTS (
    SELECT 1 FROM private.analytics_visit_receipts WHERE event_id = v_staff
  ) THEN
    RAISE EXCEPTION 'staff path stored a country or a receipt';
  END IF;

  PERFORM private.kutadgu_accept_page_visit(v_anon, v_dup, now());
  SELECT country INTO v_country FROM private.analytics_visit_receipts WHERE event_id = v_dup;
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION 'spoofed visit country reached the receipt';
  END IF;

  PERFORM private.kutadgu_accept_page_visit(v_other, v_e4, now() - interval '30 minutes');
  PERFORM private.kutadgu_accept_page_visit(v_other, v_unknown, now() - interval '20 minutes');

  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'covered window should be complete: %', v_report;
  END IF;
  v_window_start := ((timezone('Europe/Istanbul', now()))::date - 6)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_window_end := ((timezone('Europe/Istanbul', now()))::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  SELECT country, count(*)::integer INTO v_expected_code, v_expected_visits
  FROM private.analytics_visit_receipts
  WHERE counted
    AND counted_at >= v_window_start
    AND counted_at < v_window_end
    AND country IS NOT NULL
  GROUP BY country
  ORDER BY count(*) DESC, country ASC
  LIMIT 1;
  IF (v_report->'countries'->0->>'code') IS DISTINCT FROM v_expected_code
     OR (v_report->'countries'->0->>'visits')::integer IS DISTINCT FROM v_expected_visits THEN
    RAISE EXCEPTION 'country totals mismatch: % expected % %', v_report->'countries', v_expected_code, v_expected_visits;
  END IF;
  IF (
    SELECT coalesce(sum((item->>'visits')::integer), 0)
    FROM jsonb_array_elements(v_report->'countries') item
  ) + (v_report->>'unknown_visits')::integer
     IS DISTINCT FROM (
       SELECT count(*)::integer FROM private.analytics_visit_receipts
       WHERE counted AND counted_at >= v_window_start AND counted_at < v_window_end
     )
  THEN
    RAISE EXCEPTION 'totals do not match accepted receipts: %', v_report;
  END IF;
  IF jsonb_array_length(v_report->'latest') > 20 THEN
    RAISE EXCEPTION 'latest exceeded 20';
  END IF;
  IF (v_report->'latest'->0->>'country') IS DISTINCT FROM (
    SELECT country FROM private.analytics_visit_receipts
    WHERE counted
    ORDER BY counted_at DESC, event_id DESC
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'latest order mismatch: %', v_report->'latest';
  END IF;
  IF v_report::text ~* 'visitor_id|event_id|[0-9]{1,3}(\.[0-9]{1,3}){3}' THEN
    RAISE EXCEPTION 'report exposed a private id or address: %', v_report;
  END IF;

  FOR i IN 1..25 LOOP
    INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country)
    VALUES (
      ('a1000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
      'b1000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'),
      true,
      now() + interval '1 minute' - make_interval(secs => i),
      'JP'
    );
  END LOOP;
  v_report := private.kutadgu_country_visit_report(7);
  IF jsonb_array_length(v_report->'latest') IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'latest should be 20, got %', v_report->'latest';
  END IF;
  IF (v_report->'latest'->0->>'country') IS DISTINCT FROM 'JP' THEN
    RAISE EXCEPTION 'latest should start with the newest country: %', v_report->'latest'->0;
  END IF;
  IF (v_report->'countries'->0->>'code') IS DISTINCT FROM 'JP'
     OR (v_report->'countries'->0->>'visits')::integer < 25 THEN
    RAISE EXCEPTION 'JP totals missing: %', v_report->'countries';
  END IF;

  UPDATE private.analytics_country_counter SET started_at = now() + interval '1 day' WHERE id;
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'unavailable'
     OR jsonb_typeof(v_report->'countries') IS DISTINCT FROM 'null'
     OR jsonb_typeof(v_report->'unknown_visits') IS DISTINCT FROM 'null'
     OR jsonb_typeof(v_report->'latest') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'future collection must be unavailable, not zero: %', v_report;
  END IF;

  UPDATE private.analytics_country_counter SET started_at = now() - interval '40 minutes' WHERE id;
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'crossing the marker should be partial: %', v_report;
  END IF;
  IF (v_report->>'unknown_visits')::integer < 1 THEN
    RAISE EXCEPTION 'partial window should keep the unknown visit: %', v_report;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_report->'countries') item
    WHERE item->>'code' = 'TR'
  ) THEN
    RAISE EXCEPTION 'pre-collection visit was backfilled into the partial totals: %', v_report;
  END IF;

  UPDATE private.analytics_country_counter SET started_at = now() - interval '30 days' WHERE id;
  DELETE FROM private.analytics_visit_receipts;
  DELETE FROM private.analytics_visit_gate;
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'zero'
     OR (v_report->>'unknown_visits')::integer IS DISTINCT FROM 0
     OR jsonb_array_length(v_report->'countries') IS DISTINCT FROM 0
     OR jsonb_array_length(v_report->'latest') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'empty covered window should be a measured zero: %', v_report;
  END IF;

  PERFORM set_config('test.admin', 'off', true);
  PERFORM set_config('test.aal', 'aal2', true);
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'non-admin read was allowed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%admin only%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal1', true);
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'AAL1 admin read was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%AAL2%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  v_report := public.get_kutadgu_analytics(30);
  IF NOT (v_report ? 'visit_countries') OR NOT (v_report ? 'counted_visits')
     OR NOT (v_report ? 'top_cart_books') OR NOT (v_report ? 'top_whatsapp_books') THEN
    RAISE EXCEPTION 'admin report lost an existing key: %', v_report;
  END IF;
  IF v_report ? 'top_searches' THEN
    RAISE EXCEPTION 'country report added top_searches';
  END IF;

  RESET ROLE;
  SET ROLE anon;
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'anon read was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM private.kutadgu_country_visit_report(7);
    RAISE EXCEPTION 'anon country report was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RESET ROLE;

  PERFORM set_config('test.admin', 'off', true);
  PERFORM set_config('test.aal', 'aal2', true);
  SET ROLE authenticated;
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'authenticated non-admin read was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'authenticated non-admin was denied before the admin check';
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%admin only%' THEN
        RAISE;
      END IF;
  END;
  RESET ROLE;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal1', true);
  SET ROLE authenticated;
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'authenticated AAL1 admin read was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%AAL2%' THEN
        RAISE;
      END IF;
  END;
  RESET ROLE;

  SET ROLE service_role;
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'service role analytics read was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM private.kutadgu_country_visit_report(7);
    RAISE EXCEPTION 'service role country report was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RESET ROLE;

  SELECT count(*) INTO v_rows FROM public.analytics_events;
  IF v_rows < 8 THEN
    RAISE EXCEPTION 'events were deleted: %', v_rows;
  END IF;
END
$check$;
