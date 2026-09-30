DO $$
DECLARE
  result jsonb;
  def text;
  rows bigint;
BEGIN
  SELECT n INTO rows FROM public._stage100_harness WHERE k = 'rows';
  IF (SELECT count(*) FROM public.analytics_events) IS DISTINCT FROM rows THEN
    RAISE EXCEPTION 'rollback changed event rows from % to %', rows, (SELECT count(*) FROM public.analytics_events);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analytics_events' AND column_name = 'visitor_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analytics_events' AND column_name = 'occurred_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analytics_events' AND column_name = 'action_seq'
  ) THEN
    RAISE EXCEPTION 'rollback dropped analytics columns';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'analytics_events_validate_timing' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'timing trigger still installed';
  END IF;

  def := pg_get_functiondef('public.get_kutadgu_analytics(integer)'::regprocedure);
  IF def ILIKE '%schema_version%' OR def ILIKE '%ordered_user_action%' THEN
    RAISE EXCEPTION 'rollback function still has the stage 100 body';
  END IF;
  IF def NOT ILIKE '%make_interval%' THEN
    RAISE EXCEPTION 'rollback function is not the rolling window';
  END IF;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.get_kutadgu_analytics(7);
  IF result ? 'schema_version' OR result ? 'ordered_user_action' THEN
    RAISE EXCEPTION 'rollback result still exposes stage 100 fields %', result;
  END IF;
  IF result->'page_views' IS NULL THEN
    RAISE EXCEPTION 'rollback result missing page_views';
  END IF;
  RAISE NOTICE 'stage100 rollback rows=% page_views=%', rows, result->>'page_views';
END $$;
