-- Stage 115 — unique event_id for public analytics retries.
-- Additive. Do not rerun Stage 114. Do not change started_at, gates,
-- receipts, or existing analytics_events rows. This is not STAGE100,
-- STAGE101, or STAGE8.
--
-- PostgREST 14.5 turns Prefer: resolution=ignore-duplicates into
-- INSERT ... ON CONFLICT ("id") DO NOTHING RETURNING 1 and then SELECT.
-- anon can insert analytics_events and cannot select it, so that header
-- returns 42501 and stores nothing. The browser sends return=minimal.
-- A lost response is retried with the same event_id. This index makes
-- that second insert conflict. PostgREST answers 409, and the browser
-- treats 409 as already stored. Counted visits stay idempotent in the
-- private receipt table as well.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_event_id_uidx
  ON public.analytics_events (event_id)
  WHERE event_id IS NOT NULL;

COMMIT;
