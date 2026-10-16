-- Isolated Stage 126 checks. Not production. Does not insert live analytics.
DO $$
DECLARE
  marker timestamptz;
  result jsonb;
  today date := (timezone('Europe/Istanbul', now()))::date;
  visitor uuid := '11111111-1111-4111-8111-111111111111';
  other uuid := '22222222-2222-4222-8222-222222222222';
  forged uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);

  SELECT started_at INTO marker FROM private.analytics_action_attestation_counter;
  IF marker IS NULL THEN
    RAISE EXCEPTION 'missing action attestation marker';
  END IF;

  UPDATE private.analytics_action_attestation_counter
  SET started_at = timestamptz '2026-10-10 00:00:00+03'
  WHERE id;

  INSERT INTO public.books (id, title) VALUES (16, 'يېڭى كىتاب') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.analytics_events (event_name, book_id, search_query, result_count, created_at, event_id, visitor_id)
  VALUES
    ('book_view', '15', NULL, NULL, timestamptz '2026-10-09 12:00:00+03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', forged),
    ('book_view', '15', NULL, NULL, timestamptz '2026-10-11 10:00:00+03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', forged),
    ('book_view', '15', NULL, NULL, timestamptz '2026-10-11 15:00:00+03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', forged),
    ('book_view', '16', NULL, NULL, timestamptz '2026-10-11 16:00:00+03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', forged),
    ('book_view', '16', NULL, NULL, timestamptz '2026-10-11 12:00:00+03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', forged),
    ('book_view', '16', NULL, NULL, timestamptz '2026-10-11 13:00:00+03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', forged),
    ('add_to_cart', '15', NULL, NULL, timestamptz '2026-10-11 10:05:00+03', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', forged),
    ('add_to_cart', '15', NULL, NULL, timestamptz '2026-10-11 10:06:00+03', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', forged),
    ('search', '15', 'ئالما', 4, timestamptz '2026-10-12 09:00:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', forged),
    ('search', NULL, 'يوق', 0, timestamptz '2026-10-12 09:00:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', forged),
    ('search', NULL, 'يوق', 0, timestamptz '2026-10-12 11:30:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', forged),
    ('zero_result_search', NULL, 'يوق', 0, timestamptz '2026-10-12 09:00:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5', forged),
    ('zero_result_search', NULL, 'يوق', 0, timestamptz '2026-10-12 11:30:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6', forged),
    ('search', NULL, 'نامەلۇم', NULL, timestamptz '2026-10-12 12:00:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', forged),
    ('zero_result_search', NULL, 'مۇسبەت', 3, timestamptz '2026-10-14 10:00:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc7', forged),
    ('zero_result_search', NULL, 'كونا', NULL, timestamptz '2026-10-14 11:00:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8', forged),
    ('search', NULL, 'خام', 1, timestamptz '2026-10-15 10:00:00+03', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', forged),
    ('zero_result_search', NULL, 'كونا-دەلىل', 0, timestamptz '2026-10-15 11:00:00+03', 'cccccccc-cccc-4ccc-8ccc-cccccccccc10', forged),
    ('book_view', '15', NULL, NULL, today::timestamp AT TIME ZONE 'Europe/Istanbul', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', forged),
    ('book_view', '15', NULL, NULL, (today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', forged),
    ('book_view', '15', NULL, NULL, (today::timestamp AT TIME ZONE 'Europe/Istanbul') - interval '1 second', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', forged),
    ('whatsapp_order_click', NULL, NULL, NULL, timestamptz '2026-10-11 18:00:00+03', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', forged);

  UPDATE public.analytics_events
  SET meta = '{"book_ids":["16","15"]}'::jsonb
  WHERE event_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';

  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at, event_id)
  SELECT 'search', 'سۆز-' || lpad(n::text, 2, '0'), 1, timestamptz '2026-10-12 08:00:00+03' + (n || ' minutes')::interval,
         ('f0000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
  FROM generate_series(1, 25) AS n;

  INSERT INTO private.analytics_action_attestations (event_id, visitor_id)
  SELECT event_id, visitor
  FROM public.analytics_events
  WHERE event_id IN (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc6',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc7',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc8',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc10',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
  );

  PERFORM set_config('role', 'service_role', true);
  result := public.kutadgu_ingest_analytics_event(
    jsonb_build_object('event_name', 'add_to_cart', 'book_id', '16', 'event_id', '99999999-9999-4999-8999-999999999999', 'visitor_id', forged::text),
    visitor
  );
  IF result->>'result' <> 'inserted' OR result->>'attested' <> 'true' THEN
    RAISE EXCEPTION 'trusted insert was not attested: %', result;
  END IF;
  result := public.kutadgu_ingest_analytics_event(
    jsonb_build_object('event_name', 'contact_click', 'category', 'phone', 'event_id', '99999999-9999-4999-8999-999999999999', 'visitor_id', other::text),
    other
  );
  IF result->>'result' <> 'retry' OR result->>'attested' <> 'true' THEN
    RAISE EXCEPTION 'verified retry was not idempotent: %', result;
  END IF;
  IF public.kutadgu_attest_analytics_event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', visitor) IS NOT FALSE THEN
    RAISE EXCEPTION 'standalone attest wrote a row';
  END IF;
  result := public.kutadgu_ingest_analytics_event(
    jsonb_build_object('event_name', 'contact_click', 'category', 'phone', 'event_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'visitor_id', visitor::text),
    visitor
  );
  IF result->>'result' <> 'conflict' OR result->>'attested' <> 'false' THEN
    RAISE EXCEPTION 'duplicate request promoted an unverified row: %', result;
  END IF;
  result := public.kutadgu_ingest_analytics_event(
    jsonb_build_object('event_name', 'book_view', 'book_id', '15'),
    visitor
  );
  IF result->>'result' <> 'inserted' OR result->>'attested' <> 'false' THEN
    RAISE EXCEPTION 'event without an id was attested: %', result;
  END IF;
  PERFORM set_config('role', 'postgres', true);

  IF (SELECT count(*) FROM private.analytics_action_attestations WHERE event_id = '99999999-9999-4999-8999-999999999999') <> 1 THEN
    RAISE EXCEPTION 'retry created another attestation';
  END IF;
  IF (SELECT visitor_id FROM private.analytics_action_attestations WHERE event_id = '99999999-9999-4999-8999-999999999999') <> visitor THEN
    RAISE EXCEPTION 'retry replaced the attested visitor';
  END IF;
  IF (SELECT event_name FROM public.analytics_events WHERE event_id = '99999999-9999-4999-8999-999999999999') <> 'add_to_cart' THEN
    RAISE EXCEPTION 'retry replaced the stored action';
  END IF;
  IF EXISTS (SELECT 1 FROM private.analytics_action_attestations WHERE event_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'unverified book_view was promoted';
  END IF;
  IF (SELECT event_name FROM public.analytics_events WHERE event_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 'book_view' THEN
    RAISE EXCEPTION 'conflict replaced the original book_view';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM private.analytics_action_attestations AS a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.analytics_events AS e WHERE e.event_id = a.event_id
    )
  ) THEN
    RAISE EXCEPTION 'dangling attestation';
  END IF;
  IF EXISTS (SELECT 1 FROM private.analytics_action_attestations WHERE event_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') THEN
    RAISE EXCEPTION 'historical event was attested';
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'custom', DATE '2026-10-01', DATE '2026-10-09', '', 0, 20);
  IF result->>'status' <> 'unavailable' OR jsonb_typeof(result->'rows') <> 'null' OR result->>'total' IS NOT NULL THEN
    RAISE EXCEPTION 'pre-marker window looked like zero: %', result;
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'custom', DATE '2026-10-09', DATE '2026-10-11', '', 0, 20);
  IF result->>'status' <> 'partial' THEN
    RAISE EXCEPTION 'crossing window was %', result->>'status';
  END IF;
  IF result->>'total' <> '2' OR result->>'total_events' <> '5' THEN
    RAISE EXCEPTION 'partial totals %', result;
  END IF;
  IF result#>>'{rows,0,label}' <> 'يېڭى كىتاب' OR (result#>>'{rows,0,last_at}')::timestamptz <> timestamptz '2026-10-11 16:00:00+03' THEN
    RAISE EXCEPTION 'latest group was not the newest book activity: %', result->'rows';
  END IF;
  IF result#>>'{rows,1,label}' <> 'Canon' THEN
    RAISE EXCEPTION 'second latest book %', result#>>'{rows,1,label}';
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'count_desc', 'custom', DATE '2026-10-11', DATE '2026-10-11', '', 0, 20);
  IF result->>'status' <> 'complete' OR result#>>'{rows,0,key}' <> '16' OR result#>>'{rows,0,count}' <> '3' THEN
    RAISE EXCEPTION 'highest count order %', result->'rows';
  END IF;
  IF (result->>'window_from')::timestamptz <> timestamptz '2026-10-11 00:00:00+03' OR (result->>'window_until')::timestamptz <> timestamptz '2026-10-12 00:00:00+03' THEN
    RAISE EXCEPTION 'Istanbul bounds % %', result->>'window_from', result->>'window_until';
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'count_asc', 'custom', DATE '2026-10-11', DATE '2026-10-11', '', 0, 20);
  IF result#>>'{rows,0,key}' <> '15' OR result#>>'{rows,0,count}' <> '2' THEN
    RAISE EXCEPTION 'lowest count order %', result->'rows';
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'oldest', 'custom', DATE '2026-10-11', DATE '2026-10-11', '', 0, 20);
  IF result#>>'{rows,0,key}' <> '15' THEN
    RAISE EXCEPTION 'oldest group %', result#>>'{rows,0,key}';
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'custom', DATE '2026-10-11', DATE '2026-10-11', 'Canon', 0, 20);
  IF result->>'total' <> '1' OR result#>>'{rows,0,key}' <> '15' THEN
    RAISE EXCEPTION 'title filter %', result;
  END IF;

  result := public.get_kutadgu_analytics_activity('add_to_cart', 'verified', 'latest', 'custom', DATE '2026-10-11', DATE '2026-10-11', '', 0, 20);
  IF result->>'total_events' <> '2' OR result#>>'{rows,0,count}' <> '2' THEN
    RAISE EXCEPTION 'separate cart actions were gated: %', result;
  END IF;

  result := public.get_kutadgu_analytics_activity('search', 'verified', 'latest', 'custom', DATE '2026-10-12', DATE '2026-10-12', '', 0, 20);
  IF result->>'kind' <> 'phrase' OR result::text LIKE '%Canon%' OR result::text LIKE '%يېڭى كىتاب%' THEN
    RAISE EXCEPTION 'search invented a book: %', result->'rows';
  END IF;
  IF result#>>'{rows,0,label}' <> 'نامەلۇم' THEN
    RAISE EXCEPTION 'search latest phrase %', result#>>'{rows,0,label}';
  END IF;

  result := public.get_kutadgu_analytics_activity('zero_search', 'verified', 'latest', 'custom', DATE '2026-10-12', DATE '2026-10-12', '', 0, 20);
  IF result->>'total' <> '1' OR result#>>'{rows,0,label}' <> 'يوق' OR result#>>'{rows,0,count}' <> '2' OR result->>'total_events' <> '2' THEN
    RAISE EXCEPTION 'zero-search phrase %', result->'rows';
  END IF;
  IF (result#>>'{rows,0,last_at}')::timestamptz <> timestamptz '2026-10-12 11:30:00+03' THEN
    RAISE EXCEPTION 'zero-search latest time %', result#>>'{rows,0,last_at}';
  END IF;
  result := public.get_kutadgu_analytics_activity('zero_search', 'raw', 'latest', 'custom', DATE '2026-10-12', DATE '2026-10-12', 'يوق', 0, 20);
  IF result->>'total_events' <> '2' OR result#>>'{rows,0,count}' <> '2' THEN
    RAISE EXCEPTION 'raw paired zero search %', result;
  END IF;
  result := public.get_kutadgu_analytics_activity('search', 'verified', 'latest', 'custom', DATE '2026-10-12', DATE '2026-10-12', 'يوق', 0, 20);
  IF result->>'total_events' <> '2' THEN
    RAISE EXCEPTION 'repeated searches were collapsed: %', result->>'total_events';
  END IF;
  result := public.get_kutadgu_analytics_activity('zero_search', 'verified', 'latest', 'custom', DATE '2026-10-12', DATE '2026-10-12', 'نامەلۇم', 0, 20);
  IF result->>'total' <> '0' THEN
    RAISE EXCEPTION 'unknown result became a zero search: %', result;
  END IF;
  result := public.get_kutadgu_analytics_activity('zero_search', 'verified', 'latest', 'custom', DATE '2026-10-14', DATE '2026-10-14', '', 0, 20);
  IF result->>'total' <> '1' OR result#>>'{rows,0,label}' <> 'كونا' THEN
    RAISE EXCEPTION 'legacy-only zero %', result->'rows';
  END IF;
  result := public.get_kutadgu_analytics_activity('zero_search', 'raw', 'latest', 'custom', DATE '2026-10-14', DATE '2026-10-14', '', 0, 20);
  IF result->>'total' <> '1' OR result#>>'{rows,0,label}' <> 'كونا' THEN
    RAISE EXCEPTION 'raw legacy-only zero %', result->'rows';
  END IF;
  result := public.get_kutadgu_analytics_activity('zero_search', 'verified', 'latest', 'custom', DATE '2026-10-15', DATE '2026-10-15', '', 0, 20);
  IF result->>'total' <> '1' OR result#>>'{rows,0,label}' <> 'كونا-دەلىل' THEN
    RAISE EXCEPTION 'verified legacy beside an unverified search %', result->'rows';
  END IF;
  result := public.get_kutadgu_analytics_activity('zero_search', 'raw', 'latest', 'custom', DATE '2026-10-15', DATE '2026-10-15', '', 0, 20);
  IF result->>'total' <> '0' OR result::text LIKE '%كونا-دەلىل%' THEN
    RAISE EXCEPTION 'raw mixed window counted the legacy companion %', result;
  END IF;

  result := public.get_kutadgu_analytics_activity('whatsapp_order_click', 'verified', 'latest', 'custom', DATE '2026-10-11', DATE '2026-10-11', '', 0, 20);
  IF result->>'total' <> '2' THEN
    RAISE EXCEPTION 'whatsapp books %', result->'rows';
  END IF;

  result := public.get_kutadgu_analytics_activity('search', 'raw', 'oldest', 'custom', DATE '2026-10-12', DATE '2026-10-12', '', 10, 10);
  IF result->>'total' <> '28' OR jsonb_array_length(result->'rows') <> 10 OR result#>>'{rows,0,label}' <> 'سۆز-11' THEN
    RAISE EXCEPTION 'page slice % %', result->>'total', result#>>'{rows,0,label}';
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'today', NULL, NULL, '', 0, 20);
  IF result->>'range_start' <> to_char(today, 'YYYY-MM-DD') OR result->>'total_events' <> '1' THEN
    RAISE EXCEPTION 'today bounds % events %', result->>'range_start', result->>'total_events';
  END IF;
  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'yesterday', NULL, NULL, '', 0, 20);
  IF result->>'total_events' <> '1' THEN
    RAISE EXCEPTION 'yesterday boundary excluded the previous second: %', result->>'total_events';
  END IF;

  result := public.get_kutadgu_analytics_activity('book_view', 'raw', 'latest', 'custom', DATE '2026-10-09', DATE '2026-10-09', '', 0, 20);
  IF result->>'status' <> 'raw' OR result->>'metric' <> 'raw_analytics_events' OR result->>'total_events' <> '1' THEN
    RAISE EXCEPTION 'raw historical row %', result;
  END IF;
  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'custom', DATE '2026-10-13', DATE '2026-10-13', '', 0, 20);
  IF result->>'status' <> 'zero' OR result->>'total' <> '0' THEN
    RAISE EXCEPTION 'quiet covered day %', result->>'status';
  END IF;

  INSERT INTO private.analytics_action_attestation_signals (kind, occurred_at, observed_until)
  VALUES ('outage', timestamptz '2026-10-11 12:00:00+03', timestamptz '2026-10-11 18:00:00+03');
  result := public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'custom', DATE '2026-10-11', DATE '2026-10-11', '', 0, 20);
  IF result->>'status' <> 'partial' THEN
    RAISE EXCEPTION 'outage did not mark partial';
  END IF;

  PERFORM set_config('role', 'anon', true);
  BEGIN
    PERFORM public.kutadgu_attest_analytics_event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', forged);
    RAISE EXCEPTION 'anon attested an event';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  INSERT INTO public.analytics_events (event_name, book_id, created_at, event_id, visitor_id)
  VALUES ('book_view', '15', now(), 'abababab-abab-4aba-8aba-abababababab', forged);
  PERFORM set_config('role', 'postgres', true);
  IF EXISTS (SELECT 1 FROM private.analytics_action_attestations WHERE event_id = 'abababab-abab-4aba-8aba-abababababab') THEN
    RAISE EXCEPTION 'direct insert forged attestation';
  END IF;

  PERFORM set_config('test.aal', 'aal1', true);
  BEGIN
    PERFORM public.get_kutadgu_analytics_activity('book_view', 'verified', 'latest', 'last_7', NULL, NULL, '', 0, 20);
    RAISE EXCEPTION 'aal1 read the activity report';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END
$$;
