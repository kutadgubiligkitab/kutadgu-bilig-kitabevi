DO $check$
BEGIN
  IF to_regclass('private.analytics_visit_receipts') IS NULL THEN
    RAISE EXCEPTION 'reapply did not restore receipts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.analytics_visit_counter) THEN
    RAISE EXCEPTION 'reapply did not set a new collection start';
  END IF;
  IF EXISTS (SELECT 1 FROM private.analytics_visit_receipts) THEN
    RAISE EXCEPTION 'reapply reconstructed old visits';
  END IF;
  IF private.kutadgu_accept_page_visit(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    now()
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'first visit after reapply did not count';
  END IF;
  IF private.kutadgu_accept_page_visit(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
    now()
  ) IS NOT FALSE THEN
    RAISE EXCEPTION 'second immediate visit after reapply counted';
  END IF;
  PERFORM set_config('test.admin', 'on', true);
  PERFORM set_config('test.aal', 'aal2', true);
  IF (public.get_kutadgu_analytics(7)->'counted_visits'->>'version') <> '1' THEN
    RAISE EXCEPTION 'report missing after reapply';
  END IF;
  IF (public.get_kutadgu_analytics(7)->>'page_views')::integer < 1 THEN
    RAISE EXCEPTION 'event totals missing after reapply';
  END IF;
END
$check$;
