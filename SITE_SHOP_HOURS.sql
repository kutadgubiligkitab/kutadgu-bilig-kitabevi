-- ============================================================================
-- Kutadgu Bilig — physical shop opening hours (Stage Admin 1M)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify store_settings, store_homepage_about,
-- store_hero_*, store_announcements, books, stock, orders, or sample catalog.
-- ============================================================================
--
-- Why a new table:
--   public.store_settings.value is boolean and RLS only allows key
--   maintenance_mode. Shop hours cannot live there without widening that
--   flag table. This file adds one singleton row, matching store_homepage_about.
--
-- Purpose:
--   store_shop_hours id=1 holds weekday (Mon–Sat) and Sunday open/close times.
--   Public SELECT of id and content on that row only (not updated_at/updated_by).
--   Seeded values match the current Contact page / JSON-LD hours.
--
-- Depends on:
--   public.is_kutadgu_admin()  (defined in SUPABASE_SETUP.sql)
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_shop_hours (
  id integer PRIMARY KEY,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT store_shop_hours_singleton CHECK (id = 1),
  CONSTRAINT store_shop_hours_content_object CHECK (jsonb_typeof(content) = 'object')
);

INSERT INTO public.store_shop_hours (id, content)
VALUES (
  1,
  jsonb_build_object(
    'weekdayOpen', '08:30',
    'weekdayClose', '20:00',
    'sundayOpen', '10:30',
    'sundayClose', '18:00'
  )
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.store_shop_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_shop_hours_select_public ON public.store_shop_hours;
CREATE POLICY store_shop_hours_select_public
  ON public.store_shop_hours
  FOR SELECT
  TO anon, authenticated
  USING (id = 1);

DROP POLICY IF EXISTS store_shop_hours_insert_admin ON public.store_shop_hours;
CREATE POLICY store_shop_hours_insert_admin
  ON public.store_shop_hours
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

DROP POLICY IF EXISTS store_shop_hours_update_admin ON public.store_shop_hours;
CREATE POLICY store_shop_hours_update_admin
  ON public.store_shop_hours
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin() AND id = 1)
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

DROP POLICY IF EXISTS "aal2 required to insert store_shop_hours" ON public.store_shop_hours;
CREATE POLICY "aal2 required to insert store_shop_hours"
  ON public.store_shop_hours
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_shop_hours" ON public.store_shop_hours;
CREATE POLICY "aal2 required to update store_shop_hours"
  ON public.store_shop_hours
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

REVOKE ALL ON TABLE public.store_shop_hours FROM PUBLIC;
REVOKE SELECT ON TABLE public.store_shop_hours FROM anon, authenticated;
GRANT SELECT (id, content)
  ON TABLE public.store_shop_hours
  TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.store_shop_hours TO authenticated;

COMMENT ON TABLE public.store_shop_hours IS
  'Singleton (id=1) shop opening hours as one JSON object. Public SELECT is column-level (id, content) only — not updated_at/updated_by. Full Admin insert/update only with AAL2. Missing/failed reads must keep Contact and JSON-LD fallback hours.';

COMMIT;
