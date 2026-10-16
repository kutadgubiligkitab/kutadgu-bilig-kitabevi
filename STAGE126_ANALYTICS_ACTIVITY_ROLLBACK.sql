-- Stage 126 rollback. Run by itself. Does not delete analytics_events,
-- verified visit receipts, or historical rows.

BEGIN;

DROP FUNCTION IF EXISTS public.get_kutadgu_analytics_activity(text, text, text, text, date, date, text, integer, integer);
DROP FUNCTION IF EXISTS public.kutadgu_note_action_attestation_outage();
DROP FUNCTION IF EXISTS public.kutadgu_ingest_analytics_event(jsonb, uuid);
DROP FUNCTION IF EXISTS public.kutadgu_attest_analytics_event(uuid, uuid);
DROP FUNCTION IF EXISTS private.kutadgu_action_attestation_overlaps(timestamptz, timestamptz);
DROP TABLE IF EXISTS private.analytics_action_attestation_signals;
DROP TABLE IF EXISTS private.analytics_action_attestations;
DROP TABLE IF EXISTS private.analytics_action_attestation_counter;

COMMIT;
