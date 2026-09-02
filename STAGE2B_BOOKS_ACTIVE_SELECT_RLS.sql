-- ============================================================================
-- Kutadgu Bilig — Stage 2B books SELECT RLS (active-only public reads)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify book rows, covers, IDs, or other tables.
-- ============================================================================
--
-- Purpose:
--   Public/API clients (anon + normal authenticated) may SELECT only
--   books where is_active = true.
--   Authenticated Admins (public.is_kutadgu_admin()) may SELECT all
--   books, including inactive rows, so Admin can manage hidden books.
--   Admin INSERT / UPDATE / DELETE policies are not rewritten.
--
-- Also persists the live manual hardening:
--   REVOKE EXECUTE ON FUNCTION public.is_kutadgu_admin() FROM anon;
--   authenticated EXECUTE is preserved.
--
-- Depends on:
--   public.books.is_active
--   public.is_kutadgu_admin()  (defined in SUPABASE_SETUP.sql)
--
-- After apply:
--   Duplicate USING (true) public SELECT policies are gone.
--   Permissive SELECT policies OR together: active books for everyone
--   who can SELECT; inactive books only for verified admins.
-- ============================================================================

BEGIN;

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view books" ON public.books;
DROP POLICY IF EXISTS "public can read books" ON public.books;
DROP POLICY IF EXISTS "public can read active books" ON public.books;
DROP POLICY IF EXISTS "admin can read all books" ON public.books;

CREATE POLICY "public can read active books"
  ON public.books
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "admin can read all books"
  ON public.books
  FOR SELECT
  TO authenticated
  USING (public.is_kutadgu_admin());

REVOKE EXECUTE ON FUNCTION public.is_kutadgu_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_kutadgu_admin() TO authenticated;

COMMIT;
