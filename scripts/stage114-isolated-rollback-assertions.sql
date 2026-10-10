DO $check$
DECLARE
  v_rows integer;
  v_def text;
BEGIN
  SELECT count(*) INTO v_rows FROM public.analytics_events;
  IF v_rows < 6 THEN
    RAISE EXCEPTION 'rollback deleted analytics rows, found %', v_rows;
  END IF;
  IF to_regclass('private.analytics_visit_receipts') IS NOT NULL
     OR to_regclass('private.analytics_visit_gate') IS NOT NULL
     OR to_regclass('private.analytics_visit_counter') IS NOT NULL THEN
    RAISE EXCEPTION 'visit tables survived rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'analytics_events_count_page_visit') THEN
    RAISE EXCEPTION 'visit trigger survived rollback';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analytics_events' AND column_name = 'visitor_id'
  ) THEN
    RAISE EXCEPTION 'rollback dropped visitor_id';
  END IF;
  SELECT pg_get_functiondef('public.get_kutadgu_analytics(integer)'::regprocedure) INTO v_def;
  IF v_def ILIKE '%counted_visits%' OR v_def NOT ILIKE '%make_interval%' THEN
    RAISE EXCEPTION 'analytics function was not restored';
  END IF;

  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  IF public.get_kutadgu_analytics(30) ? 'counted_visits' THEN
    RAISE EXCEPTION 'restored payload still has counted visits';
  END IF;
  IF (public.get_kutadgu_analytics(30)->>'book_views')::integer < 1 THEN
    RAISE EXCEPTION 'rolling book views disappeared';
  END IF;
END
$check$;
