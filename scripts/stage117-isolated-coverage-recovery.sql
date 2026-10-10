-- After Stage 117 restores the counter, the stored event is counted once.

DO $recover$
DECLARE
  v_gap text := 'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7';
  v_gap_event uuid := 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8';
  v_report jsonb;
  v_receipts integer;
  v_counted integer;
  v_country text;
BEGIN
  IF NOT private.kutadgu_accept_page_visit(v_gap, v_gap_event, now()) THEN
    RAISE EXCEPTION 'recovered event did not count';
  END IF;
  IF NOT private.kutadgu_accept_page_visit(v_gap, v_gap_event, now()) THEN
    RAISE EXCEPTION 'retry of a counted event should return the original receipt';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE counted), max(country)
  INTO v_receipts, v_counted, v_country
  FROM private.analytics_visit_receipts
  WHERE event_id = v_gap_event;
  IF v_receipts IS DISTINCT FROM 1 OR v_counted IS DISTINCT FROM 1 OR v_country IS DISTINCT FROM 'DE' THEN
    RAISE EXCEPTION 'same event recovered as % receipts, % counted, country %', v_receipts, v_counted, v_country;
  END IF;

  BEGIN
    INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country)
    VALUES ('page_view', '/', v_gap, v_gap_event, 'US');
    RAISE EXCEPTION 'duplicate event_id was inserted during recovery';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
  SELECT count(*) INTO v_receipts
  FROM private.analytics_visit_receipts
  WHERE event_id = v_gap_event;
  IF v_receipts IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'duplicate insert added a visit';
  END IF;

  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'recovered window was not complete: %', v_report;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_report->'countries') item
    WHERE item->>'code' = 'DE' AND (item->>'visits')::integer = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_report->'countries') item
    WHERE item->>'code' = 'TR' AND (item->>'visits')::integer >= 1
  ) OR (v_report->>'unknown_visits')::integer < 1 THEN
    RAISE EXCEPTION 'recovery changed accepted totals: %', v_report;
  END IF;
END
$recover$;
