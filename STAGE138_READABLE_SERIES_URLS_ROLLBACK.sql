-- POSTLAUNCH ROLLBACK GUARD. MANUAL REVIEW/APPLY ONLY.
-- Roll the Worker back to the recorded compatibility release, NOT the old Worker.
-- Keep the additive database contract: published URLs and legacy aliases are durable.
-- This guard intentionally does not remove the directory RPC, allocator or slugs.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
  IF to_regprocedure('public.list_public_book_series_routes()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.book_volume_groups'::regclass
                    AND tgname='book_volume_groups_public_slug' AND tgenabled='O')
     OR EXISTS (SELECT 1 FROM public.book_volume_groups WHERE public_slug IS NULL) THEN
    RAISE EXCEPTION 'Series URL compatibility contract is missing; repair before Worker rollback';
  END IF;
END;
$guard$;
COMMIT;
