-- Stage 118 rollback. Drops only the history RPC.
-- It does not delete analytics_events or analytics_visit_receipts, does not
-- move either collection marker, and does not restore or rewrite Stages
-- 114, 115, 116, or 117.

BEGIN;

DROP FUNCTION IF EXISTS public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz);

COMMIT;
