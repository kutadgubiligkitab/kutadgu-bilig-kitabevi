-- Checks for the isolated Stage 100 database. Fails the session on mismatch.

DO $$
DECLARE
  result jsonb;
  today date := (timezone('Europe/Istanbul', now()))::date;
  day jsonb;
  book2 int;
  book15 int;
  wa2 int;
  wa15 int;
  n int;
BEGIN
  IF (SELECT count(*) FROM public.analytics_events) <> 24 THEN
    RAISE EXCEPTION 'expected 24 loaded rows, got %', (SELECT count(*) FROM public.analytics_events);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.analytics_events
    WHERE path = '/probe-old' AND (occurred_at IS NOT NULL OR action_seq IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.analytics_events
    WHERE path = '/probe-future' AND (occurred_at IS NOT NULL OR action_seq IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'server window kept an invalid client timestamp';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.analytics_events
    WHERE path = '/probe-valid' AND action_seq = 4 AND occurred_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'server window dropped a timestamp inside 5 minutes';
  END IF;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.get_kutadgu_analytics(7);
  EXECUTE 'RESET ROLE';

  IF (result->>'schema_version')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'schema_version %', result->>'schema_version';
  END IF;
  IF (result->>'page_views')::int IS DISTINCT FROM 7
     OR (result->>'book_views')::int IS DISTINCT FROM 6
     OR (result->>'cart_adds')::int IS DISTINCT FROM 4
     OR (result->>'whatsapp_clicks')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'counts %', result;
  END IF;

  IF (result->'visitors'->'today'->>'visitors')::int IS DISTINCT FROM 3
     OR result->'visitors'->'today'->>'status' IS DISTINCT FROM 'partial'
     OR (result->'visitors'->'today'->>'events')::int IS DISTINCT FROM 5
     OR (result->'visitors'->'today'->>'identified_events')::int IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'today %', result->'visitors'->'today';
  END IF;
  IF (result->'visitors'->'yesterday'->>'visitors')::int IS DISTINCT FROM 1
     OR result->'visitors'->'yesterday'->>'status' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'yesterday %', result->'visitors'->'yesterday';
  END IF;
  IF (result->'visitors'->'period'->>'visitors')::int IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'period %', result->'visitors'->'period';
  END IF;
  IF (result->'visitors'->'today'->>'visitors')::int
     + (result->'visitors'->'yesterday'->>'visitors')::int
     = (result->'visitors'->'period'->>'visitors')::int THEN
    RAISE EXCEPTION 'period distinct equalled today plus yesterday';
  END IF;

  SELECT elem INTO day
  FROM jsonb_array_elements(result->'visitors'->'daily') elem
  WHERE elem->>'date' = to_char(today - 3, 'YYYY-MM-DD');
  IF day->>'status' IS DISTINCT FROM 'unavailable' OR day->'visitors' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'partial history day %', day;
  END IF;
  SELECT elem INTO day
  FROM jsonb_array_elements(result->'visitors'->'daily') elem
  WHERE elem->>'date' = to_char(today - 4, 'YYYY-MM-DD');
  IF day->>'status' IS DISTINCT FROM 'zero' OR (day->>'visitors')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'empty chart day %', day;
  END IF;

  SELECT coalesce(sum((elem->>'views')::int), 0) INTO book2
  FROM jsonb_array_elements(result->'top_books') elem
  WHERE elem->>'book_id' = '2';
  SELECT coalesce(sum((elem->>'views')::int), 0) INTO book15
  FROM jsonb_array_elements(result->'top_books') elem
  WHERE elem->>'book_id' = '15';
  IF book2 IS DISTINCT FROM 1 OR book15 IS DISTINCT FROM 1 OR jsonb_array_length(result->'top_books') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'book join %', result->'top_books';
  END IF;
  SELECT coalesce(sum((elem->>'clicks')::int), 0) INTO wa2
  FROM jsonb_array_elements(result->'top_whatsapp_books') elem
  WHERE elem->>'book_id' = '2';
  SELECT coalesce(sum((elem->>'clicks')::int), 0) INTO wa15
  FROM jsonb_array_elements(result->'top_whatsapp_books') elem
  WHERE elem->>'book_id' = '15';
  IF wa2 IS DISTINCT FROM 1 OR wa15 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'whatsapp join %', result->'top_whatsapp_books';
  END IF;

  IF result->'funnel'->>'kind' IS DISTINCT FROM 'ordered_user_action'
     OR result->'funnel'->>'accurate_user_action_order' IS DISTINCT FROM 'true'
     OR (result->'funnel'->>'views')::int IS DISTINCT FROM 3
     OR (result->'funnel'->>'cart_adds')::int IS DISTINCT FROM 2
     OR (result->'funnel'->>'whatsapp_clicks')::int IS DISTINCT FROM 0
     OR (result->'funnel'->>'excluded_without_action_seq')::int IS DISTINCT FROM 2
     OR (result->'funnel'->>'view_to_cart_pct')::numeric IS DISTINCT FROM 66.7 THEN
    RAISE EXCEPTION 'user funnel %', result->'funnel';
  END IF;
  IF result->'arrival_funnel'->>'kind' IS DISTINCT FROM 'recorded_arrival'
     OR result->'arrival_funnel'->>'order' IS DISTINCT FROM 'server_receipt_time'
     OR result->'arrival_funnel'->>'accurate_user_action_order' IS DISTINCT FROM 'false'
     OR (result->'arrival_funnel'->>'views')::int IS DISTINCT FROM 4
     OR (result->'arrival_funnel'->>'cart_adds')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'arrival funnel %', result->'arrival_funnel';
  END IF;

  RAISE NOTICE 'stage100 metrics today=% period=% user_carts=% arrival_carts=% books=%',
    result->'visitors'->'today',
    result->'visitors'->'period'->>'visitors',
    result->'funnel'->>'cart_adds',
    result->'arrival_funnel'->>'cart_adds',
    result->'top_books';
END $$;

DO $$
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'anon executed analytics';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM ILIKE '%admin only%' OR SQLERRM ILIKE '%AAL2%' THEN
        RAISE EXCEPTION 'anon received an admin error: %', SQLERRM;
      END IF;
      IF SQLERRM NOT ILIKE '%permission denied%' THEN
        RAISE EXCEPTION 'unexpected anon error: %', SQLERRM;
      END IF;
  END;
END $$;

DO $$
BEGIN
  PERFORM set_config('test.admin', '', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'non-admin executed analytics';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'admin only' THEN
        RAISE EXCEPTION 'unexpected non-admin error: %', SQLERRM;
      END IF;
  END;
END $$;

DO $$
BEGIN
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal1', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_kutadgu_analytics(7);
    RAISE EXCEPTION 'aal1 admin executed analytics';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLSTATE IS DISTINCT FROM '42501' OR SQLERRM NOT ILIKE '%AAL2%' THEN
        RAISE EXCEPTION 'aal1 error % %', SQLSTATE, SQLERRM;
      END IF;
  END;
END $$;

DO $$
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM 1 FROM public.analytics_events LIMIT 1;
    RAISE EXCEPTION 'anon selected analytics';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

DO $$
DECLARE
  n int;
BEGIN
  PERFORM set_config('test.admin', '', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.analytics_events;
  IF n <> 0 THEN
    RAISE EXCEPTION 'non-admin saw % analytics rows', n;
  END IF;
END $$;

DO $$
BEGIN
  INSERT INTO public.analytics_events (event_name, event_id, path, created_at)
  VALUES ('page_view', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '/dup', now() - interval '10 days');
  BEGIN
    INSERT INTO public.analytics_events (event_name, event_id, path, created_at)
    VALUES ('page_view', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '/dup', now() - interval '10 days');
    RAISE EXCEPTION 'duplicate event_id was inserted';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
  IF (SELECT count(*) FROM public.analytics_events WHERE event_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 THEN
    RAISE EXCEPTION 'duplicate event_id stored more than once';
  END IF;
  DELETE FROM public.analytics_events WHERE event_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
END $$;

BEGIN;
DO $$
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  INSERT INTO public.analytics_events (event_name, path, occurred_at, action_seq)
  VALUES ('page_view', '/index.html', now(), 1);
  BEGIN
    INSERT INTO public.analytics_events (event_name, path, occurred_at, action_seq)
    VALUES ('page_view', '/admin.html', now(), 2);
    RAISE EXCEPTION 'admin path insert succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;
ROLLBACK;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.analytics_events) <> 24 THEN
    RAISE EXCEPTION 'row count changed during access checks';
  END IF;
  CREATE TABLE IF NOT EXISTS public._stage100_harness (k text PRIMARY KEY, n bigint);
  INSERT INTO public._stage100_harness (k, n) VALUES ('rows', 24)
  ON CONFLICT (k) DO UPDATE SET n = EXCLUDED.n;
END $$;
