-- Deliberately break counter processing. The analytics insert must survive.
-- This file is isolated-test only. The following reapply restores the function.

CREATE OR REPLACE FUNCTION private.kutadgu_accept_page_visit(
  p_visitor_id text,
  p_event_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fail$
BEGIN
  RAISE EXCEPTION 'stage114 forced counter failure';
END;
$fail$;

INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, created_at)
VALUES (
  'page_view',
  '/index.html',
  'abababab-abab-4aba-8aba-abababababab',
  'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
  now() + interval '6 hours'
);

DO $check$
DECLARE
  v_payload jsonb;
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows
  FROM public.analytics_events
  WHERE event_id = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'failed counter processing dropped the page view, found %', v_rows;
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.analytics_visit_receipts
    WHERE event_id = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
  ) THEN
    RAISE EXCEPTION 'failed processing invented a receipt';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.analytics_visit_gate
    WHERE visitor_id = 'abababab-abab-4aba-8aba-abababababab'
  ) THEN
    RAISE EXCEPTION 'failed processing moved the visit gate';
  END IF;
  SELECT private.kutadgu_visit_window_status(
    now() + interval '6 hours' - interval '1 minute',
    now() + interval '6 hours' + interval '1 minute',
    (SELECT started_at FROM private.analytics_visit_counter)
  ) INTO v_payload;
  IF v_payload->>'status' <> 'partial' OR (v_payload->>'visits')::integer <> 0 THEN
    RAISE EXCEPTION 'unprocessed page view was not partial: %', v_payload;
  END IF;
END
$check$;
