DO $$
DECLARE
  result jsonb;
  rows bigint;
BEGIN
  SELECT n INTO rows FROM public._stage100_harness WHERE k = 'rows';
  IF (SELECT count(*) FROM public.analytics_events) IS DISTINCT FROM rows THEN
    RAISE EXCEPTION 'reapply changed event rows';
  END IF;
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.get_kutadgu_analytics(7);
  IF (result->>'schema_version')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'reapply schema %', result->>'schema_version';
  END IF;
  IF (result->'visitors'->'today'->>'visitors')::int IS DISTINCT FROM 3
     OR (result->'funnel'->>'cart_adds')::int IS DISTINCT FROM 2
     OR result->'arrival_funnel'->>'accurate_user_action_order' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'reapply metrics drifted %', result->'funnel';
  END IF;
  RAISE NOTICE 'stage100 reapply schema=% today_visitors=%', result->>'schema_version', result->'visitors'->'today'->>'visitors';
END $$;
