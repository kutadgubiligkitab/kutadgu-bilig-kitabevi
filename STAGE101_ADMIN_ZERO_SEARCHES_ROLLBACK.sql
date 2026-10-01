-- Roll back Stage 101 only.
-- Drops get_kutadgu_zero_searches (the snapshot signature and the older
-- three-argument signature, if one is still present) and
-- analytics_events_zero_search_recent_idx.
-- Does not delete analytics_events. Does not restore or replace
-- get_kutadgu_analytics. Do not run STAGE8_STORE_ANALYTICS.sql as this rollback.
-- Safe before or after Stage 100.

BEGIN;

DROP INDEX IF EXISTS public.analytics_events_zero_search_recent_idx;
DROP FUNCTION IF EXISTS public.get_kutadgu_zero_searches(integer, integer, integer, timestamptz);
DROP FUNCTION IF EXISTS public.get_kutadgu_zero_searches(integer, integer, integer);

COMMIT;
