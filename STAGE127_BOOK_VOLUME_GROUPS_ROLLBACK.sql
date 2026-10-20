-- Stage 127 data-preserving rollback.
-- Run by itself. This disables exposure and mutations but deliberately keeps
-- groups and memberships. Do not drop these tables merely because application
-- code was rolled back: Stage 128 order snapshots may reference their IDs.

BEGIN;

UPDATE public.book_volume_groups SET is_public = false WHERE is_public;

REVOKE ALL ON FUNCTION public.admin_save_book_volume_group(bigint, bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_book_volume_groups() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_book_volume_group(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_book_volume_group(bigint) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_save_book_volume_group(bigint, bigint, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.admin_list_book_volume_groups();
DROP FUNCTION IF EXISTS public.admin_get_book_volume_group(bigint);
DROP FUNCTION IF EXISTS public.get_public_book_volume_group(bigint);

-- Keep public.kutadgu_book_volume_quote_revision(bigint): Stage 128 quote and
-- historical compatibility code can continue to validate saved group IDs.
-- Keep both tables and every membership row.

COMMIT;
