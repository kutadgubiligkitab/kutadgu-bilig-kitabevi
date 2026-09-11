-- ============================================================================
-- Kutadgu Bilig — Stage 2C AAL2 restrictive repair
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify rows, covers, IDs, grants, or SELECT policies.
-- Does not change public.is_kutadgu_admin() or member cart/favorite/order INSERT.
-- ============================================================================
--
-- Production bug:
--   PostgreSQL combines PERMISSIVE policies for the same command with OR.
--   Separate policies "admin can update books" (is_kutadgu_admin) and
--   "aal2 required to update books" (jwt aal = aal2) are intended as AND:
--     Admin mutations need is_kutadgu_admin() AND AAL2.
--   If the AAL2 policy is PERMISSIVE (Postgres default when AS RESTRICTIVE
--   is omitted), a non-admin AAL2 member satisfies the AAL2-only policy and
--   can mutate admin tables.
--
-- Fix:
--   Recreate every AAL2-named write policy AS RESTRICTIVE. Restrictive
--   policies AND with the result of permissive Admin policies. Do not add
--   another permissive AAL2-only policy.
--
-- After apply:
--   member + AAL1: denied
--   member + AAL2: denied
--   admin + AAL1: denied on these mutations
--   admin + AAL2: allowed (existing Admin permissive policy still required)
-- ============================================================================

BEGIN;

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_announcement_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_homepage_about ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_hero_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_hero_store_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_hero_campaigns ENABLE ROW LEVEL SECURITY;

-- books
DROP POLICY IF EXISTS "aal2 required to insert books" ON public.books;
CREATE POLICY "aal2 required to insert books"
  ON public.books AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update books" ON public.books;
CREATE POLICY "aal2 required to update books"
  ON public.books AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete books" ON public.books;
CREATE POLICY "aal2 required to delete books"
  ON public.books AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

-- orders (Admin UPDATE only; member INSERT is a different command)
DROP POLICY IF EXISTS "aal2 required to update orders" ON public.orders;
CREATE POLICY "aal2 required to update orders"
  ON public.orders AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- store_settings
DROP POLICY IF EXISTS "aal2 required to insert store_settings" ON public.store_settings;
CREATE POLICY "aal2 required to insert store_settings"
  ON public.store_settings AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_settings" ON public.store_settings;
CREATE POLICY "aal2 required to update store_settings"
  ON public.store_settings AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- store_announcements
DROP POLICY IF EXISTS "aal2 required to insert store_announcements" ON public.store_announcements;
CREATE POLICY "aal2 required to insert store_announcements"
  ON public.store_announcements AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_announcements" ON public.store_announcements;
CREATE POLICY "aal2 required to update store_announcements"
  ON public.store_announcements AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete store_announcements" ON public.store_announcements;
CREATE POLICY "aal2 required to delete store_announcements"
  ON public.store_announcements AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

-- store_announcement_settings
DROP POLICY IF EXISTS "aal2 required to insert store_announcement_settings" ON public.store_announcement_settings;
CREATE POLICY "aal2 required to insert store_announcement_settings"
  ON public.store_announcement_settings AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_announcement_settings" ON public.store_announcement_settings;
CREATE POLICY "aal2 required to update store_announcement_settings"
  ON public.store_announcement_settings AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- store_homepage_about
DROP POLICY IF EXISTS "aal2 required to insert store_homepage_about" ON public.store_homepage_about;
CREATE POLICY "aal2 required to insert store_homepage_about"
  ON public.store_homepage_about AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_homepage_about" ON public.store_homepage_about;
CREATE POLICY "aal2 required to update store_homepage_about"
  ON public.store_homepage_about AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- store_hero_settings
DROP POLICY IF EXISTS "aal2 required to insert store_hero_settings" ON public.store_hero_settings;
CREATE POLICY "aal2 required to insert store_hero_settings"
  ON public.store_hero_settings AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_hero_settings" ON public.store_hero_settings;
CREATE POLICY "aal2 required to update store_hero_settings"
  ON public.store_hero_settings AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- store_hero_store_slides
DROP POLICY IF EXISTS "aal2 required to insert store_hero_store_slides" ON public.store_hero_store_slides;
CREATE POLICY "aal2 required to insert store_hero_store_slides"
  ON public.store_hero_store_slides AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_hero_store_slides" ON public.store_hero_store_slides;
CREATE POLICY "aal2 required to update store_hero_store_slides"
  ON public.store_hero_store_slides AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete store_hero_store_slides" ON public.store_hero_store_slides;
CREATE POLICY "aal2 required to delete store_hero_store_slides"
  ON public.store_hero_store_slides AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

-- store_hero_campaigns
DROP POLICY IF EXISTS "aal2 required to insert store_hero_campaigns" ON public.store_hero_campaigns;
CREATE POLICY "aal2 required to insert store_hero_campaigns"
  ON public.store_hero_campaigns AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_hero_campaigns" ON public.store_hero_campaigns;
CREATE POLICY "aal2 required to update store_hero_campaigns"
  ON public.store_hero_campaigns AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete store_hero_campaigns" ON public.store_hero_campaigns;
CREATE POLICY "aal2 required to delete store_hero_campaigns"
  ON public.store_hero_campaigns AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

-- book-covers storage (same OR-composition bug if those AAL2 policies are PERMISSIVE)
DROP POLICY IF EXISTS "aal2 required to insert book covers" ON storage.objects;
CREATE POLICY "aal2 required to insert book covers"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (bucket_id = 'book-covers' AND (select auth.jwt()->>'aal') = 'aal2')
    OR (bucket_id IS DISTINCT FROM 'book-covers')
  );

DROP POLICY IF EXISTS "aal2 required to update book covers" ON storage.objects;
CREATE POLICY "aal2 required to update book covers"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (bucket_id = 'book-covers' AND (select auth.jwt()->>'aal') = 'aal2')
    OR (bucket_id IS DISTINCT FROM 'book-covers')
  )
  WITH CHECK (
    (bucket_id = 'book-covers' AND (select auth.jwt()->>'aal') = 'aal2')
    OR (bucket_id IS DISTINCT FROM 'book-covers')
  );

DROP POLICY IF EXISTS "aal2 required to delete book covers" ON storage.objects;
CREATE POLICY "aal2 required to delete book covers"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (bucket_id = 'book-covers' AND (select auth.jwt()->>'aal') = 'aal2')
    OR (bucket_id IS DISTINCT FROM 'book-covers')
  );

DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(format('%I.%I %L', n.nspname, c.relname, p.polname), ', ' ORDER BY n.nspname, c.relname, p.polname)
  INTO leftover
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'storage')
    AND p.polname LIKE 'aal2 required%'
    AND p.polpermissive;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'AAL2 write policies must be RESTRICTIVE; still PERMISSIVE: %', leftover;
  END IF;
END $$;

COMMIT;
