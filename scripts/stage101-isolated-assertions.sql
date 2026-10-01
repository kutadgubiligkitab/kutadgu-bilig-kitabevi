-- Isolated checks for get_kutadgu_zero_searches. Not production.

DO $$
DECLARE
  result jsonb;
  queries jsonb;
  names text[];
  allowed boolean;
BEGIN
  DELETE FROM public.analytics_events;

  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at)
  SELECT 'search', 'old-' || lpad(g::text, 2, '0'), 0, now() - interval '2 days'
  FROM generate_series(1, 11) g;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at)
  SELECT 'search', 'old-' || lpad(g::text, 2, '0'), 0, now() - interval '3 days'
  FROM generate_series(1, 11) g;

  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at) VALUES
    ('search', 'aaa-tie', 0, now() - interval '1 hour'),
    ('search', 'aaa-tie', 0, now() - interval '1 hour'),
    ('search', 'aaa-tie', 0, now() - interval '1 hour'),
    ('search', 'aaa-tie', 0, now() - interval '1 hour'),
    ('search', 'aaa-tie', 0, now() - interval '1 hour'),
    ('search', 'bbb-tie', 0, now() - interval '1 hour'),
    ('search', 'bbb-tie', 0, now() - interval '1 hour'),
    ('search', 'bbb-tie', 0, now() - interval '1 hour'),
    ('search', 'bbb-tie', 0, now() - interval '1 hour'),
    ('search', 'bbb-tie', 0, now() - interval '1 hour'),
    ('search', '  spaced   query  ', 0, now() - interval '30 minutes'),
    ('search', 'spaced query', 0, now() - interval '20 minutes'),
    ('search', '<b>bold</b>', 0, now() - interval '5 minutes'),
    ('search', 'new-once', 0, now()),
    ('zero_result_search', 'new-once', 0, now()),
    ('search', 'unknown-q', NULL, now()),
    ('search', 'found-book', 4, now()),
    ('zero_result_search', 'legacy-only', 0, now()),
    ('search', 'ancient-zero', 0, now() - interval '40 days');

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  result := public.get_kutadgu_zero_searches(30, 0, 10);
  IF (result->>'total_queries')::int <> 16 THEN
    RAISE EXCEPTION 'expected 16 groups in 30 days, got %', result;
  END IF;
  IF (result->>'total_events')::int <> 36 THEN
    RAISE EXCEPTION 'expected 36 canonical zero events, got %', result;
  END IF;
  IF result->>'representation' <> 'search' THEN
    RAISE EXCEPTION 'mixed window must count search rows, got %', result->>'representation';
  END IF;
  IF result->>'timezone' <> 'Europe/Istanbul' THEN
    RAISE EXCEPTION 'timezone %', result->>'timezone';
  END IF;
  IF (result->>'has_more')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'first page must report more groups: %', result;
  END IF;
  queries := result->'queries';
  IF jsonb_array_length(queries) <> 10 THEN
    RAISE EXCEPTION 'page size 10 returned %', queries;
  END IF;
  IF queries->0->>'query' <> 'new-once' OR (queries->0->>'searches')::int <> 1 THEN
    RAISE EXCEPTION 'newest count-1 query was hidden: %', queries->0;
  END IF;
  IF queries->1->>'query' <> '<b>bold</b>' THEN
    RAISE EXCEPTION 'html query order %', queries->1->>'query';
  END IF;
  IF queries->2->>'query' <> 'spaced query' OR (queries->2->>'searches')::int <> 2 THEN
    RAISE EXCEPTION 'whitespace grouping failed: %', queries->2;
  END IF;
  IF queries->3->>'query' <> 'aaa-tie' OR queries->4->>'query' <> 'bbb-tie' THEN
    RAISE EXCEPTION 'equal timestamps must break by query: % %', queries->3->>'query', queries->4->>'query';
  END IF;
  IF (queries->3->>'searches')::int <> 5 OR (queries->4->>'searches')::int <> 5 THEN
    RAISE EXCEPTION 'tie counts %', queries;
  END IF;
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(queries));
  IF names @> ARRAY['unknown-q', 'found-book', 'legacy-only', 'ancient-zero'] THEN
    RAISE EXCEPTION 'excluded queries leaked onto page 1: %', names;
  END IF;

  result := public.get_kutadgu_zero_searches(30, 10, 10);
  queries := result->'queries';
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(queries));
  IF names <> ARRAY['old-06', 'old-07', 'old-08', 'old-09', 'old-10', 'old-11'] THEN
    RAISE EXCEPTION 'second page %', names;
  END IF;
  IF (result->>'has_more')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'second page has_more should be false: %', result->>'has_more';
  END IF;
  IF (result->>'total_queries')::int <> 16 OR (result->>'total_events')::int <> 36 THEN
    RAISE EXCEPTION 'page 2 totals drifted: %', result;
  END IF;

  result := public.get_kutadgu_zero_searches(30, 0, 1000);
  IF (result->>'limit')::int <> 50 THEN
    RAISE EXCEPTION 'limit must clamp to 50, got %', result->>'limit';
  END IF;
  IF jsonb_array_length(result->'queries') <> 16 THEN
    RAISE EXCEPTION 'clamped page should still return every group, got %', result->'queries';
  END IF;
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF 'unknown-q' = ANY(names) OR 'found-book' = ANY(names) OR 'legacy-only' = ANY(names) OR 'ancient-zero' = ANY(names) THEN
    RAISE EXCEPTION 'full list included a non-zero or out-of-range query: %', names;
  END IF;

  result := public.get_kutadgu_zero_searches(30, -5, 0);
  IF (result->>'offset')::int <> 0 OR (result->>'limit')::int <> 1 THEN
    RAISE EXCEPTION 'negative offset and zero limit were not clamped: %', result;
  END IF;

  result := public.get_kutadgu_zero_searches(7, 0, 50);
  IF (result->>'total_queries')::int <> 16 THEN
    RAISE EXCEPTION '7-day window dropped an in-range group: %', result->>'total_queries';
  END IF;
  result := public.get_kutadgu_zero_searches(90, 0, 50);
  IF (result->>'total_queries')::int <> 17 OR NOT (result->'queries')::text LIKE '%ancient-zero%' THEN
    RAISE EXCEPTION '90-day window should add ancient-zero: %', result;
  END IF;

  RESET ROLE;
END $$;

DO $$
DECLARE
  result jsonb;
  names text[];
BEGIN
  DELETE FROM public.analytics_events;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at) VALUES
    ('search', 'Ab', 0, now() - interval '2 minutes'),
    ('search', 'ab', 0, now() - interval '1 minute'),
    ('search', 'a  b', 0, now() - interval '4 minutes'),
    ('search', 'a b', 0, now() - interval '3 minutes');
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.get_kutadgu_zero_searches(7, 0, 20);
  IF (result->>'total_queries')::int <> 3 OR (result->>'total_events')::int <> 4 THEN
    RAISE EXCEPTION 'case and whitespace grouping: %', result;
  END IF;
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF names <> ARRAY['ab', 'Ab', 'a b'] THEN
    RAISE EXCEPTION 'distinct case must stay split: %', names;
  END IF;
  IF (result->'queries'->2->>'searches')::int <> 2 THEN
    RAISE EXCEPTION 'collapsed whitespace count: %', result->'queries'->2;
  END IF;
  RESET ROLE;
END $$;

DO $$
DECLARE
  result jsonb;
BEGIN
  DELETE FROM public.analytics_events;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at) VALUES
    ('zero_result_search', 'legacy-null', NULL, now() - interval '1 hour'),
    ('zero_result_search', 'legacy-zero', 0, now()),
    ('zero_result_search', 'legacy-positive', 3, now());
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.get_kutadgu_zero_searches(7, 0, 20);
  IF result->>'representation' <> 'zero_result_search' THEN
    RAISE EXCEPTION 'legacy-only window representation %', result->>'representation';
  END IF;
  IF (result->>'total_queries')::int <> 2 OR (result->>'total_events')::int <> 2 THEN
    RAISE EXCEPTION 'legacy fallback counted the wrong rows: %', result;
  END IF;
  IF (result->'queries'->0->>'query') <> 'legacy-zero' OR (result->'queries'->1->>'query') <> 'legacy-null' THEN
    RAISE EXCEPTION 'legacy order %', result->'queries';
  END IF;
  RESET ROLE;
END $$;

DO $$
DECLARE
  result jsonb;
  names text[];
BEGIN
  DELETE FROM public.analytics_events;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at) VALUES
    ('search', 'real-hit', 2, now()),
    ('search', 'real-miss', NULL, now()),
    ('zero_result_search', 'old-explicit', 0, now() - interval '1 hour');
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.get_kutadgu_zero_searches(7, 0, 20);
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF coalesce(array_length(names, 1), 0) <> 0 OR (result->>'total_events')::int <> 0 THEN
    RAISE EXCEPTION 'NULL search results and legacy rows must not become zeros beside a search event: %', result;
  END IF;
  RESET ROLE;
END $$;

DO $$
DECLARE
  allowed boolean := false;
BEGIN
  PERFORM set_config('test.admin', 'off', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_kutadgu_zero_searches(7, 0, 20);
    allowed := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%admin only%' THEN
      RAISE;
    END IF;
  END;
  IF allowed THEN
    RAISE EXCEPTION 'non-admin authenticated role was allowed';
  END IF;
  RESET ROLE;
END $$;

DO $$
DECLARE
  allowed boolean := false;
BEGIN
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal1', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_kutadgu_zero_searches(7, 0, 20);
    allowed := true;
  EXCEPTION WHEN insufficient_privilege THEN
    allowed := false;
  END;
  IF allowed THEN
    RAISE EXCEPTION 'AAL1 was allowed';
  END IF;
  RESET ROLE;
END $$;

DO $$
DECLARE
  allowed boolean := false;
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_kutadgu_zero_searches(7, 0, 20);
    allowed := true;
  EXCEPTION WHEN insufficient_privilege THEN
    allowed := false;
  END;
  IF allowed THEN
    RAISE EXCEPTION 'anon executed get_kutadgu_zero_searches';
  END IF;
END $$;

DO $$
DECLARE
  allowed boolean := false;
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM count(*) FROM public.analytics_events;
    allowed := true;
  EXCEPTION WHEN insufficient_privilege THEN
    allowed := false;
  END;
  IF allowed THEN
    RAISE EXCEPTION 'anon read analytics_events';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'analytics_events_zero_search_recent_idx'
  ) THEN
    RAISE EXCEPTION 'canonical zero-search index is missing';
  END IF;
END $$;

DO $$
DECLARE
  n integer;
  args text;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'get_kutadgu_zero_searches';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected one get_kutadgu_zero_searches overload, found %', n;
  END IF;
  SELECT pg_get_function_identity_arguments(p.oid) INTO args
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'get_kutadgu_zero_searches';
  IF args <> 'p_days integer, p_offset integer, p_limit integer, p_as_of timestamp with time zone' THEN
    RAISE EXCEPTION 'zero-search signature is %', args;
  END IF;
END $$;

-- Snapshot pagination. Timestamps are absolute so the check does not follow
-- the machine clock. as_of is 2026-09-30 23:00 Europe/Istanbul.
DO $$
DECLARE
  snap timestamptz := timestamptz '2026-09-30 20:00:00+00';
  later timestamptz := timestamptz '2026-09-30 20:30:00+00';
  next_day timestamptz := timestamptz '2026-10-01 12:00:00+00';
  result jsonb;
  names text[];
  page2 text[];
  seen text[];
  query26 integer;
BEGIN
  DELETE FROM public.analytics_events;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at)
  SELECT 'search', 'query-' || lpad(g::text, 2, '0'), 0, snap - (g || ' minutes')::interval
  FROM generate_series(1, 26) g;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at) VALUES
    ('search', 'tie-b', 0, snap - interval '40 minutes'),
    ('search', 'tie-a', 0, snap - interval '40 minutes');

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  result := public.get_kutadgu_zero_searches(7, 0, 20, snap);
  IF (result->>'as_of')::timestamptz <> snap THEN
    RAISE EXCEPTION 'snapshot did not keep as_of: %', result->>'as_of';
  END IF;
  IF result->>'range_end' <> '2026-09-30' OR result->>'range_start' <> '2026-09-24' THEN
    RAISE EXCEPTION 'snapshot calendar drifted: % — %', result->>'range_start', result->>'range_end';
  END IF;
  IF (result->>'total_queries')::int <> 28 OR (result->>'next_offset')::int <> 20 THEN
    RAISE EXCEPTION 'first snapshot page: %', result;
  END IF;
  IF (result->>'has_more')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'first snapshot page must continue';
  END IF;
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF names[1] <> 'query-01' OR names[20] <> 'query-20' OR array_length(names, 1) <> 20 THEN
    RAISE EXCEPTION 'first page order %', names;
  END IF;
  IF 'query-26' = ANY(names) THEN
    RAISE EXCEPTION 'query-26 was not supposed to be on page 1';
  END IF;

  RESET ROLE;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at) VALUES
    ('search', 'query-26', 0, snap + interval '1 minute'),
    ('search', 'arrived-later', 0, snap + interval '2 minutes'),
    ('search', 'after-midnight', 0, timestamptz '2026-09-30 21:30:00+00');
  EXECUTE 'SET LOCAL ROLE authenticated';

  result := public.get_kutadgu_zero_searches(7, 20, 20, snap);
  page2 := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF page2 <> ARRAY['query-21', 'query-22', 'query-23', 'query-24', 'query-25', 'query-26', 'tie-a', 'tie-b'] THEN
    RAISE EXCEPTION 'snapshot page 2 changed after a newer search: %', page2;
  END IF;
  IF (result->>'total_queries')::int <> 28 OR (result->>'has_more')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'snapshot totals moved: %', result;
  END IF;
  IF (result->>'next_offset')::int <> 28 THEN
    RAISE EXCEPTION 'page 2 cursor %', result->>'next_offset';
  END IF;
  SELECT (value->>'searches')::int INTO query26
  FROM jsonb_array_elements(result->'queries') value
  WHERE value->>'query' = 'query-26';
  IF query26 <> 1 THEN
    RAISE EXCEPTION 'repeat after as_of changed the snapshot count: %', query26;
  END IF;
  IF result->>'range_end' <> '2026-09-30' THEN
    RAISE EXCEPTION 'midnight crossed inside the snapshot: %', result->>'range_end';
  END IF;
  seen := names || page2;
  IF array_length(seen, 1) <> 28 OR (SELECT count(DISTINCT q) FROM unnest(seen) q) <> 28 THEN
    RAISE EXCEPTION 'snapshot walk duplicated or dropped a group';
  END IF;
  IF 'arrived-later' = ANY(seen) OR 'after-midnight' = ANY(seen) THEN
    RAISE EXCEPTION 'later groups leaked into the snapshot';
  END IF;

  result := public.get_kutadgu_zero_searches(7, 0, 50, later);
  IF result->>'range_end' <> '2026-09-30' THEN
    RAISE EXCEPTION 'same-day refresh crossed midnight: %', result->>'range_end';
  END IF;
  IF (result->>'total_queries')::int <> 29 THEN
    RAISE EXCEPTION 'same-day refresh total %', result->>'total_queries';
  END IF;
  IF result->'queries'->0->>'query' <> 'arrived-later' THEN
    RAISE EXCEPTION 'refresh did not surface the new group first: %', result->'queries'->0;
  END IF;
  SELECT (value->>'searches')::int INTO query26
  FROM jsonb_array_elements(result->'queries') value
  WHERE value->>'query' = 'query-26';
  IF query26 <> 2 THEN
    RAISE EXCEPTION 'refresh did not count the repeated search: %', query26;
  END IF;
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF 'after-midnight' = ANY(names) THEN
    RAISE EXCEPTION 'the next Istanbul day was included before midnight';
  END IF;

  result := public.get_kutadgu_zero_searches(7, 0, 50, next_day);
  IF result->>'range_start' <> '2026-09-25' OR result->>'range_end' <> '2026-10-01' THEN
    RAISE EXCEPTION 'next-day snapshot calendar % — %', result->>'range_start', result->>'range_end';
  END IF;
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF names[1] <> 'after-midnight' OR NOT ('arrived-later' = ANY(names)) OR NOT ('query-26' = ANY(names)) THEN
    RAISE EXCEPTION 'next-day snapshot %', names;
  END IF;
  IF (result->>'total_queries')::int <> 30 THEN
    RAISE EXCEPTION 'next-day total %', result->>'total_queries';
  END IF;

  result := public.get_kutadgu_zero_searches(7, 0, 20, now() + interval '10 days');
  IF (result->>'range_end')::date <> (timezone('Europe/Istanbul', now()))::date THEN
    RAISE EXCEPTION 'future as_of moved the calendar day: %', result->>'range_end';
  END IF;
  IF (result->>'as_of')::timestamptz > now() THEN
    RAISE EXCEPTION 'future as_of was not clamped: %', result->>'as_of';
  END IF;

  RESET ROLE;
END $$;

DO $$
DECLARE
  result jsonb;
  names text[];
  second text[];
BEGIN
  DELETE FROM public.analytics_events;
  INSERT INTO public.analytics_events (event_name, search_query, result_count, created_at)
  SELECT 'search', 'cap-' || lpad(g::text, 2, '0'), 0,
         timestamptz '2026-09-20 06:00:00+00' - (g || ' minutes')::interval
  FROM generate_series(1, 55) g;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  result := public.get_kutadgu_zero_searches(7, 0, 1000, timestamptz '2026-09-20 08:00:00+00');
  IF (result->>'limit')::int <> 50 OR jsonb_array_length(result->'queries') <> 50 THEN
    RAISE EXCEPTION 'clamped snapshot page %', result->>'limit';
  END IF;
  IF (result->>'has_more')::boolean IS NOT TRUE OR (result->>'next_offset')::int <> 50 THEN
    RAISE EXCEPTION 'clamped page must stay continuable: %', result;
  END IF;
  IF (result->>'total_queries')::int <> 55 THEN
    RAISE EXCEPTION 'clamped total %', result->>'total_queries';
  END IF;
  names := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));

  result := public.get_kutadgu_zero_searches(7, 50, 50, timestamptz '2026-09-20 08:00:00+00');
  second := ARRAY(SELECT value->>'query' FROM jsonb_array_elements(result->'queries'));
  IF array_length(second, 1) <> 5 OR (result->>'has_more')::boolean IS NOT FALSE OR (result->>'next_offset')::int <> 55 THEN
    RAISE EXCEPTION 'remainder page %', result;
  END IF;
  IF (SELECT count(DISTINCT q) FROM unnest(names || second) q) <> 55 THEN
    RAISE EXCEPTION 'clamped walk lost or repeated a group';
  END IF;

  RESET ROLE;
END $$;
