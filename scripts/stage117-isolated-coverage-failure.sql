-- Force the counted-visit function to fail after the event is stored.
-- Isolated test only. The following Stage 117 reapply restores the function.

DO $quiet$
DECLARE
  v_report jsonb;
  v_visitor text := 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
  v_event uuid := 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0';
BEGIN
  ALTER TABLE public.analytics_events DISABLE TRIGGER analytics_events_count_page_visit;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, created_at)
  VALUES ('page_view', '/', v_visitor, v_event, now());
  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country)
  VALUES (v_event, v_visitor, false, NULL, NULL);
  ALTER TABLE public.analytics_events ENABLE TRIGGER analytics_events_count_page_visit;
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'zero'
     OR (v_report->>'unknown_visits')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'suppressed-only covered window was not zero: %', v_report;
  END IF;
  DELETE FROM private.analytics_visit_receipts WHERE event_id = v_event;
  DELETE FROM public.analytics_events WHERE event_id = v_event;
END
$quiet$;

DO $known$
DECLARE
  v_report jsonb;
  v_tr text := 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7';
  v_gap text := 'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7';
  v_tr_event uuid := 'a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8';
  v_unknown_event uuid := 'b8b8b8b8-b8b8-4b8b-8b8b-b8b8b8b8b8b8';
  v_gap_event uuid := 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8';
BEGIN
  SET ROLE service_role;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country, created_at)
  VALUES
    ('page_view', '/', v_tr, v_tr_event, 'TR', now() - interval '2 hours'),
    ('page_view', '/', 'b6b6b6b6-b6b6-4b6b-8b6b-b6b6b6b6b6b6', v_unknown_event, 'XX', now() - interval '1 hour');
  RESET ROLE;
  IF NOT private.kutadgu_accept_page_visit(v_tr, v_tr_event, now() - interval '2 hours') THEN
    RAISE EXCEPTION 'accepted TR visit did not count';
  END IF;
  IF NOT private.kutadgu_accept_page_visit('b6b6b6b6-b6b6-4b6b-8b6b-b6b6b6b6b6b6', v_unknown_event, now() - interval '1 hour') THEN
    RAISE EXCEPTION 'accepted unknown visit did not count';
  END IF;
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'unknown country was treated as a processing gap: %', v_report;
  END IF;
  IF (v_report->>'unknown_visits')::integer < 1
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_report->'countries') item
       WHERE item->>'code' = 'TR' AND (item->>'visits')::integer >= 1
     ) THEN
    RAISE EXCEPTION 'accepted totals were dropped: %', v_report;
  END IF;

  INSERT INTO public.analytics_events (event_name, path, created_at)
  VALUES ('page_view', '/index.html', now());
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'partial'
     OR (v_report->>'unknown_visits')::integer < 1 THEN
    RAISE EXCEPTION 'missing identity was not partial: %', v_report;
  END IF;
  DELETE FROM public.analytics_events
  WHERE event_name = 'page_view'
    AND visitor_id IS NULL
    AND event_id IS NULL
    AND path = '/index.html'
    AND created_at >= now() - interval '5 minutes';
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'removing the identity gap did not restore complete: %', v_report;
  END IF;

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
    RAISE EXCEPTION 'stage117 forced counter failure';
  END;
  $fail$;

  SET ROLE service_role;
  INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id, country, created_at)
  VALUES ('page_view', '/', v_gap, v_gap_event, 'DE', now());
  RESET ROLE;

  IF (SELECT count(*) FROM public.analytics_events WHERE event_id = v_gap_event) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'failed counter processing dropped the page view';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.analytics_visit_receipts WHERE event_id = v_gap_event
  ) THEN
    RAISE EXCEPTION 'failed processing invented a receipt';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.analytics_visit_gate WHERE visitor_id = v_gap
  ) THEN
    RAISE EXCEPTION 'failed processing moved the visit gate';
  END IF;
  v_report := private.kutadgu_country_visit_report(7);
  IF (v_report->>'status') IS DISTINCT FROM 'partial'
     OR (v_report->>'status') IN ('complete', 'zero') THEN
    RAISE EXCEPTION 'unprocessed page view was not partial: %', v_report;
  END IF;
  IF (v_report->>'unknown_visits')::integer < 1
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_report->'countries') item
       WHERE item->>'code' = 'TR'
     ) THEN
    RAISE EXCEPTION 'partial report dropped accepted totals: %', v_report;
  END IF;
END
$known$;
