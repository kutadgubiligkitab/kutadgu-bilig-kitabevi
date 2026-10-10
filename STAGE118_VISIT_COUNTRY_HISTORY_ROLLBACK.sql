-- Stage 118 rollback. Drops only the history RPC and its two snapshot tables.
-- The member table holds receipt event ids for one frozen page set. It does
-- not hold visitor ids or raw IPs. Dropping these tables does not delete
-- analytics_events or analytics_visit_receipts, does not move either
-- collection marker, and does not restore or rewrite Stages 114, 115, 116,
-- or 117.

BEGIN;

DROP FUNCTION IF EXISTS public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.get_kutadgu_visit_country_history(integer, integer, integer, timestamptz);
DROP TABLE IF EXISTS private.kutadgu_visit_history_snapshot_members;
DROP TABLE IF EXISTS private.kutadgu_visit_history_snapshots;

COMMIT;
