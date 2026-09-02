-- ============================================================================
-- Kutadgu Bilig — Stage 2C Phase 3B PR 1
-- books write AAL2 RLS + set_member_status AAL2
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify book rows, covers, IDs, or other tables.
-- Does not change books SELECT policies or public.is_kutadgu_admin().
-- ============================================================================
--
-- Purpose:
--   Authenticated Admins still need public.is_kutadgu_admin() for books
--   INSERT / UPDATE / DELETE (existing permissive policies are unchanged).
--   These additional AS RESTRICTIVE policies AND an AAL2 JWT claim so an
--   AAL1 Admin session cannot mutate books.
--
--   public.set_member_status is SECURITY DEFINER and bypasses profiles RLS.
--   Table AAL2 policies cannot close that path, so the function itself
--   requires AAL2 after is_kutadgu_admin() and before UPDATE.
--
-- Depends on:
--   public.books RLS (SUPABASE_SETUP.sql + STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql)
--   public.is_kutadgu_admin()
--   public.set_member_status(uuid, text)
--
-- After apply:
--   books SELECT (public active + Admin all) is unchanged.
--   Member profile / cart / favorites / orders / analytics are unchanged.
-- ============================================================================

BEGIN;

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aal2 required to insert books" ON public.books;
CREATE POLICY "aal2 required to insert books"
  ON public.books
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update books" ON public.books;
CREATE POLICY "aal2 required to update books"
  ON public.books
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete books" ON public.books;
CREATE POLICY "aal2 required to delete books"
  ON public.books
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

CREATE OR REPLACE FUNCTION public.set_member_status(member_id uuid, new_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if not public.is_kutadgu_admin() then raise exception 'Admin permission required'; end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;
  if new_status not in ('active','suspended') then raise exception 'Invalid member status'; end if;
  update public.profiles set status = new_status, updated_at = now() where id = member_id;
end;
$$;

REVOKE ALL ON FUNCTION public.set_member_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_member_status(uuid, text) TO authenticated;

COMMIT;
