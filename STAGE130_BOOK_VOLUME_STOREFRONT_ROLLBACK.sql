-- Stage 130 data-preserving rollback.
-- Run by itself. This removes only the Stage 130 storefront/admin RPC surface
-- and its private read helpers. It does not update or delete groups,
-- memberships, books, carts, orders, or order snapshots. Stage 127/128
-- functions remain installed.

BEGIN;

REVOKE ALL ON FUNCTION public.query_public_book_catalog(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.map_public_books_to_catalog_units(bigint[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_catalog(
  text, text, text, numeric, numeric, boolean, boolean, boolean, boolean, text, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_book_volume_group_storefront(bigint, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_public_book_volume_context(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_sitemap_entries(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_discovery_unit_ids(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_preview_book_volume_members(bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_book_volume_group_publication(bigint, bigint, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_public_book_volume_catalog(
  text, text, text, numeric, numeric, boolean, boolean, boolean, boolean, text, integer, integer
);
DROP FUNCTION IF EXISTS public.query_public_book_catalog(jsonb);
DROP FUNCTION IF EXISTS public.map_public_books_to_catalog_units(bigint[]);
DROP FUNCTION IF EXISTS public.get_public_book_volume_group_storefront(bigint, text, bigint);
DROP FUNCTION IF EXISTS public.resolve_public_book_volume_context(bigint);
DROP FUNCTION IF EXISTS public.list_public_book_volume_sitemap_entries(integer, integer);
DROP FUNCTION IF EXISTS public.list_public_book_volume_discovery_unit_ids(text, integer, integer);
DROP FUNCTION IF EXISTS public.admin_preview_book_volume_members(bigint, text);
DROP FUNCTION IF EXISTS public.admin_set_book_volume_group_publication(bigint, bigint, boolean);

DROP FUNCTION IF EXISTS private.kutadgu_public_volume_group_json(bigint);
DROP FUNCTION IF EXISTS private.kutadgu_public_catalog_units();
DROP FUNCTION IF EXISTS private.kutadgu_public_volume_groups();

COMMIT;
