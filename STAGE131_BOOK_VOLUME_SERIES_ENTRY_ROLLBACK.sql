-- Data-preserving rollback for Stage 131.
-- Drops the series-create function and its idempotency table only.
-- Books and series created through that function stay in place.
-- Does not reverse Stages 127–130.

REVOKE ALL ON FUNCTION public.admin_create_book_volume_series(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_part_prices(bigint[]) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.admin_create_book_volume_series(uuid, jsonb);
DROP FUNCTION IF EXISTS public.list_public_book_volume_part_prices(bigint[]);
DROP TABLE IF EXISTS public.book_volume_series_requests;
