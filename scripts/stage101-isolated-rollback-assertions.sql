-- After Stage 101 rollback: the new function and index are gone, rows remain.

DO $$
DECLARE
  rows bigint;
BEGIN
  SELECT count(*) INTO rows FROM public.analytics_events;
  IF rows <= 0 THEN
    RAISE EXCEPTION 'rollback deleted analytics_events';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_kutadgu_zero_searches'
  ) THEN
    RAISE EXCEPTION 'rollback left get_kutadgu_zero_searches';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'analytics_events_zero_search_recent_idx'
  ) THEN
    RAISE EXCEPTION 'rollback left analytics_events_zero_search_recent_idx';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_kutadgu_analytics'
  ) THEN
    RAISE EXCEPTION 'rollback removed get_kutadgu_analytics';
  END IF;
END $$;
