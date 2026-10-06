-- Isolated checks for Stage 114. Controlled timestamps are arguments to
-- private.kutadgu_accept_page_visit. The trigger itself always uses now().

DO $check$
DECLARE
  v_payload jsonb;
  v_page_views integer;
  v_book_views integer;
  v_cart integer;
  v_whatsapp integer;
  v_rows integer;
  v_counted integer;
  v_status text;
  v_visits integer;
  v_has_visits boolean;
  v_visitor text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_other text := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_gate timestamptz;
  v_today date;
  v_y_start timestamptz;
  v_y_end timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analytics_events' AND column_name = 'visitor_id'
  ) THEN
    RAISE EXCEPTION 'visitor_id column missing';
  END IF;

  SELECT count(*) INTO v_rows FROM public.analytics_events;
  IF v_rows <> 6 THEN
    RAISE EXCEPTION 'historical rows were not preserved, found %', v_rows;
  END IF;
  IF EXISTS (SELECT 1 FROM public.analytics_events WHERE visitor_id IS NOT NULL OR event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'historical rows gained an identity';
  END IF;
  IF EXISTS (SELECT 1 FROM private.analytics_visit_receipts) THEN
    RAISE EXCEPTION 'historical page views were counted';
  END IF;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  v_payload := public.get_kutadgu_analytics(30);
  IF v_payload ? 'visitors' OR v_payload ? 'schema_version' THEN
    RAISE EXCEPTION 'counted visits were placed on the distinct-visitor payload';
  END IF;
  IF (v_payload->'counted_visits'->>'version') <> '1' THEN
    RAISE EXCEPTION 'counted_visits missing';
  END IF;
  IF (v_payload->'counted_visits'->>'window_hours') <> '3' THEN
    RAISE EXCEPTION 'window is not 3 hours';
  END IF;
  v_page_views := (v_payload->>'page_views')::integer;
  v_book_views := (v_payload->>'book_views')::integer;
  v_cart := (v_payload->>'cart_adds')::integer;
  v_whatsapp := (v_payload->>'whatsapp_clicks')::integer;
  IF v_page_views <> 1 OR v_book_views <> 1 OR v_cart <> 1 OR v_whatsapp <> 1 THEN
    RAISE EXCEPTION 'rolling event totals changed: %', v_payload;
  END IF;
  IF (v_payload->'counted_visits'->'yesterday'->>'status') <> 'unavailable'
     OR (v_payload->'counted_visits'->'yesterday')->>'visits' IS NOT NULL THEN
    RAISE EXCEPTION 'yesterday with historical page views is not unavailable: %', v_payload->'counted_visits'->'yesterday';
  END IF;
  IF (v_payload->'counted_visits'->'period'->>'status') <> 'partial' THEN
    RAISE EXCEPTION 'period covering pre-start events should be partial: %', v_payload->'counted_visits'->'period';
  END IF;

  v_today := (timezone('Europe/Istanbul', now()))::date;
  v_y_start := (v_today - 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_y_end := v_today::timestamp AT TIME ZONE 'Europe/Istanbul';
  SELECT private.kutadgu_visit_window_status(
    timestamptz '2026-08-01 00:00:00+03',
    timestamptz '2026-08-02 00:00:00+03',
    (SELECT started_at FROM private.analytics_visit_counter)
  ) INTO v_payload;
  IF v_payload->>'status' <> 'unavailable' OR v_payload->>'visits' IS NOT NULL THEN
    RAISE EXCEPTION 'August activity was reconstructed: %', v_payload;
  END IF;
  SELECT private.kutadgu_visit_window_status(
    timestamptz '2020-01-01 00:00:00+03',
    timestamptz '2020-01-02 00:00:00+03',
    (SELECT started_at FROM private.analytics_visit_counter)
  ) INTO v_payload;
  IF v_payload->>'status' <> 'zero' OR (v_payload->>'visits')::integer <> 0 THEN
    RAISE EXCEPTION 'empty historical day should be zero: %', v_payload;
  END IF;

  IF private.kutadgu_accept_page_visit(v_visitor, '11111111-1111-4111-8111-111111111111', timestamptz '2026-10-05 14:00:00+03') IS NOT TRUE THEN
    RAISE EXCEPTION 'first visit did not count';
  END IF;
  IF private.kutadgu_accept_page_visit(v_visitor, '22222222-2222-4222-8222-222222222222', timestamptz '2026-10-05 15:00:00+03') IS NOT FALSE THEN
    RAISE EXCEPTION '15:00 reload counted';
  END IF;
  IF private.kutadgu_accept_page_visit(v_visitor, '33333333-3333-4333-8333-333333333333', timestamptz '2026-10-05 16:59:59+03') IS NOT FALSE THEN
    RAISE EXCEPTION '2h59m59s counted';
  END IF;
  SELECT last_counted_at INTO v_gate FROM private.analytics_visit_gate WHERE visitor_id = v_visitor;
  IF v_gate <> timestamptz '2026-10-05 14:00:00+03' THEN
    RAISE EXCEPTION 'ignored visits moved the window to %', v_gate;
  END IF;
  IF private.kutadgu_accept_page_visit(v_visitor, '44444444-4444-4444-8444-444444444444', timestamptz '2026-10-05 17:00:00+03') IS NOT TRUE THEN
    RAISE EXCEPTION 'exactly 3 hours did not count';
  END IF;
  IF private.kutadgu_accept_page_visit(v_visitor, '33333333-3333-4333-8333-333333333333', timestamptz '2026-10-05 20:00:00+03') IS NOT FALSE THEN
    RAISE EXCEPTION 'retried suppressed event counted later';
  END IF;
  SELECT count(*) INTO v_counted
  FROM private.analytics_visit_receipts
  WHERE visitor_id = v_visitor AND counted;
  IF v_counted <> 2 THEN
    RAISE EXCEPTION 'expected 2 counted visits, found %', v_counted;
  END IF;

  -- Midnight continuity. 23:00 counts on the 5th. 01:00 does not. 02:00 counts on the 6th.
  IF private.kutadgu_accept_page_visit(v_other, '55555555-5555-4555-8555-555555555555', timestamptz '2026-10-05 23:00:00+03') IS NOT TRUE THEN
    RAISE EXCEPTION '23:00 visit did not count';
  END IF;
  IF private.kutadgu_accept_page_visit(v_other, '66666666-6666-4666-8666-666666666666', timestamptz '2026-10-06 01:00:00+03') IS NOT FALSE THEN
    RAISE EXCEPTION 'visit across midnight inside 3 hours counted';
  END IF;
  IF private.kutadgu_accept_page_visit(v_other, '77777777-7777-4777-8777-777777777777', timestamptz '2026-10-06 02:00:00+03') IS NOT TRUE THEN
    RAISE EXCEPTION 'visit at exactly 3 hours across midnight did not count';
  END IF;
  SELECT (private.kutadgu_visit_window_status(
    timestamptz '2026-10-05 00:00:00+03',
    timestamptz '2026-10-06 00:00:00+03',
    timestamptz '2026-10-01 00:00:00+03'
  )->>'visits')::integer INTO v_visits;
  IF v_visits <> 3 THEN
    RAISE EXCEPTION '5 October should have 3 counted visits, found %', v_visits;
  END IF;
  SELECT (private.kutadgu_visit_window_status(
    timestamptz '2026-10-06 00:00:00+03',
    timestamptz '2026-10-07 00:00:00+03',
    timestamptz '2026-10-01 00:00:00+03'
  )->>'visits')::integer INTO v_visits;
  IF v_visits <> 1 THEN
    RAISE EXCEPTION '6 October should have 1 counted visit, found %', v_visits;
  END IF;
  SELECT (private.kutadgu_visit_window_status(
    timestamptz '2026-10-05 00:00:00+03',
    timestamptz '2026-10-07 00:00:00+03',
    timestamptz '2026-10-01 00:00:00+03'
  )->>'visits')::integer INTO v_visits;
  IF v_visits <> 4 THEN
    RAISE EXCEPTION 'period should sum counted visits to 4, found %', v_visits;
  END IF;

  -- Same browser, two sessions, one real server-time count. Other events stay.
  INSERT INTO public.analytics_events (event_name, path, session_id, visitor_id, event_id)
  VALUES
    ('page_view', '/index.html', 'guest-tab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '88888888-8888-4888-8888-888888888888'),
    ('page_view', '/book/15', 'member-tab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '99999999-9999-4999-8999-999999999999'),
    ('book_view', '/book/15', 'member-tab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'),
    ('add_to_cart', '/book/15', 'member-tab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'),
    ('whatsapp_order_click', '/cart.html', 'member-tab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'),
    ('page_view', '/admin.html', 'staff-tab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae'),
    ('page_view', '/book-staff.html?tab=1', 'staff-tab', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf'),
    ('page_view', '/index.html', 'missing-id', NULL, NULL);
  SELECT count(*) INTO v_counted
  FROM private.analytics_visit_receipts
  WHERE visitor_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND counted;
  IF v_counted <> 1 THEN
    RAISE EXCEPTION 'tabs, cart, WhatsApp, or staff traffic changed the count: %', v_counted;
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.analytics_visit_receipts
    WHERE event_id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf'
    )
  ) THEN
    RAISE EXCEPTION 'excluded paths wrote a receipt';
  END IF;

  SELECT private.kutadgu_visit_window_status(
    v_today::timestamp AT TIME ZONE 'Europe/Istanbul',
    (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul',
    (SELECT started_at FROM private.analytics_visit_counter)
  ) INTO v_payload;
  IF v_payload->>'status' <> 'partial' THEN
    RAISE EXCEPTION 'missing visitor id should make today partial: %', v_payload;
  END IF;

  -- A crafted created_at must not choose the counted day.
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, created_at)
  VALUES (
    'page_view',
    '/index.html',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    now() - interval '2 days'
  );
  SELECT counted_at >= now() - interval '5 minutes' INTO v_has_visits
  FROM private.analytics_visit_receipts
  WHERE event_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' AND counted;
  IF v_has_visits IS NOT TRUE THEN
    RAISE EXCEPTION 'counted_at followed created_at instead of server time';
  END IF;

  -- Duplicate event_id does not add another counted visit.
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id)
  VALUES (
    'page_view', '/index.html',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  );
  SELECT count(*) INTO v_counted
  FROM private.analytics_visit_receipts
  WHERE event_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  IF v_counted <> 1 THEN
    RAISE EXCEPTION 'duplicate event_id created % receipts', v_counted;
  END IF;

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'anon could read the analytics report';
  EXCEPTION
    WHEN insufficient_privilege OR OTHERS THEN
      IF SQLERRM = 'anon could read the analytics report' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    PERFORM count(*) FROM private.analytics_visit_receipts;
    RAISE EXCEPTION 'anon could read visit receipts';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id)
  VALUES (
    'page_view', '/index.html',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  );
  RESET ROLE;
  IF NOT EXISTS (
    SELECT 1 FROM private.analytics_visit_receipts
    WHERE event_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND counted
  ) THEN
    RAISE EXCEPTION 'anon public page view was not counted';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.admin', 'off', true);
  PERFORM set_config('test.aal', 'aal2', true);
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'non-admin read the report';
  EXCEPTION
    WHEN insufficient_privilege OR OTHERS THEN
      IF SQLERRM = 'non-admin read the report' THEN
        RAISE;
      END IF;
  END;
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal1', true);
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'aal1 read the report';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      NULL;
  END;
  RESET ROLE;
END
$check$;
