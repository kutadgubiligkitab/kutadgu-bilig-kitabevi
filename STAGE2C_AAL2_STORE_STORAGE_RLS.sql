-- ============================================================================
-- Kutadgu Bilig — Stage 2C Phase 3B PR 2
-- AAL2 restrictive writes: store settings, announcements, book-covers, orders
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify rows, covers, IDs, or catalog data.
-- Does not change SELECT policies, public.is_kutadgu_admin(), books write
-- policies, or public.set_member_status.
-- ============================================================================
--
-- Purpose:
--   Existing permissive Admin write policies (is_kutadgu_admin(), and
--   key/id/bucket checks) stay as-is. These AS RESTRICTIVE policies AND
--   an AAL2 JWT claim onto Admin mutations only.
--
-- Storage:
--   Restrictive AAL2 applies when bucket_id = 'book-covers'. Other buckets
--   are not AAL2-gated: a global (aal = aal2)-only policy on storage.objects
--   would lock every bucket. USING/WITH CHECK is:
--     (bucket_id = 'book-covers' AND jwt aal = aal2)
--     OR (bucket_id IS DISTINCT FROM 'book-covers')
--
-- Orders:
--   Member INSERT is a separate command (own-row WITH CHECK). There is no
--   member UPDATE policy. UPDATE-only restrictive AAL2 is therefore isolated.
--
-- Depends on:
--   SITE_MAINTENANCE_MODE.sql
--   SITE_ANNOUNCEMENT_BAR.sql
--   SUPABASE_SETUP.sql storage.objects + orders policies
--
-- After apply:
--   Public SELECT on settings/announcements/covers is unchanged.
--   Member profile / cart / favorites / order INSERT / analytics INSERT
--   unchanged. Books AAL2 (Phase 3B PR 1) unchanged.
-- ============================================================================

BEGIN;

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_announcement_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- store_settings: Admin INSERT / UPDATE only (no SELECT, no DELETE)
DROP POLICY IF EXISTS "aal2 required to insert store_settings" ON public.store_settings;
CREATE POLICY "aal2 required to insert store_settings"
  ON public.store_settings
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_settings" ON public.store_settings;
CREATE POLICY "aal2 required to update store_settings"
  ON public.store_settings
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- store_announcements: INSERT / UPDATE / DELETE only (no SELECT)
DROP POLICY IF EXISTS "aal2 required to insert store_announcements" ON public.store_announcements;
CREATE POLICY "aal2 required to insert store_announcements"
  ON public.store_announcements
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_announcements" ON public.store_announcements;
CREATE POLICY "aal2 required to update store_announcements"
  ON public.store_announcements
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete store_announcements" ON public.store_announcements;
CREATE POLICY "aal2 required to delete store_announcements"
  ON public.store_announcements
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

-- store_announcement_settings: INSERT / UPDATE only (no SELECT)
DROP POLICY IF EXISTS "aal2 required to insert store_announcement_settings" ON public.store_announcement_settings;
CREATE POLICY "aal2 required to insert store_announcement_settings"
  ON public.store_announcement_settings
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_announcement_settings" ON public.store_announcement_settings;
CREATE POLICY "aal2 required to update store_announcement_settings"
  ON public.store_announcement_settings
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- orders: Admin UPDATE only (no INSERT, no SELECT)
DROP POLICY IF EXISTS "aal2 required to update orders" ON public.orders;
CREATE POLICY "aal2 required to update orders"
  ON public.orders
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

-- storage.objects: book-covers INSERT / UPDATE / DELETE only (no SELECT)
DROP POLICY IF EXISTS "aal2 required to insert book covers" ON storage.objects;
CREATE POLICY "aal2 required to insert book covers"
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (bucket_id = 'book-covers' AND (select auth.jwt()->>'aal') = 'aal2')
    OR (bucket_id IS DISTINCT FROM 'book-covers')
  );

DROP POLICY IF EXISTS "aal2 required to update book covers" ON storage.objects;
CREATE POLICY "aal2 required to update book covers"
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
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
  ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    (bucket_id = 'book-covers' AND (select auth.jwt()->>'aal') = 'aal2')
    OR (bucket_id IS DISTINCT FROM 'book-covers')
  );

COMMIT;
