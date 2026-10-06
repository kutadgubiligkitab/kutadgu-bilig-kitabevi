-- After Stage 114 is reapplied, the same event_id is processed once.

INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id)
VALUES (
  'page_view',
  '/index.html',
  'abababab-abab-4aba-8aba-abababababab',
  'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
);

INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id)
VALUES (
  'page_view',
  '/index.html',
  'abababab-abab-4aba-8aba-abababababab',
  'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
);

DO $check$
DECLARE
  v_payload jsonb;
  v_rows integer;
  v_receipts integer;
  v_counted integer;
BEGIN
  SELECT count(*) INTO v_rows
  FROM public.analytics_events
  WHERE event_id = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_rows <> 3 THEN
    RAISE EXCEPTION 'retry did not keep the original page view, found %', v_rows;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE counted)
  INTO v_receipts, v_counted
  FROM private.analytics_visit_receipts
  WHERE event_id = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_receipts <> 1 OR v_counted <> 1 THEN
    RAISE EXCEPTION 'same event_id retry counted % of % receipts', v_counted, v_receipts;
  END IF;
  SELECT private.kutadgu_visit_window_status(
    now() + interval '6 hours' - interval '30 minutes',
    now() + interval '6 hours' + interval '30 minutes',
    (SELECT started_at FROM private.analytics_visit_counter)
  ) INTO v_payload;
  IF v_payload->>'status' <> 'complete' OR (v_payload->>'visits')::integer <> 0 THEN
    RAISE EXCEPTION 'recovered created_at window invented a counted visit: %', v_payload;
  END IF;
END
$check$;
