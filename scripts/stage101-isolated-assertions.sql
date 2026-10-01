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
