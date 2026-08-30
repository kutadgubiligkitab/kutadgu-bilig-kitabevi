-- ============================================================================
-- Kutadgu Bilig — global Maintenance Mode (PR #32)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify books, sample catalog, or other tables.
-- ============================================================================
--
-- Purpose:
--   One global boolean: store_settings.maintenance_mode
--   - Visitors (anon) may SELECT the flag only.
--   - Only authenticated rows in public.admin_users may UPDATE it.
--   - No service_role in the client.
--
-- Depends on:
--   public.is_kutadgu_admin()  (defined in SUPABASE_SETUP.sql)
--
-- After apply:
--   Default is OFF (false). The public storefront stays unchanged until
--   an Admin turns Maintenance Mode on from the Admin dashboard.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.store_settings (
  key text PRIMARY KEY,
  value boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

INSERT INTO public.store_settings (key, value)
VALUES ('maintenance_mode', false)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_settings_select_public ON public.store_settings;
CREATE POLICY store_settings_select_public
  ON public.store_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS store_settings_update_admin ON public.store_settings;
CREATE POLICY store_settings_update_admin
  ON public.store_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin())
  WITH CHECK (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_settings_insert_admin ON public.store_settings;
CREATE POLICY store_settings_insert_admin
  ON public.store_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin());

REVOKE ALL ON TABLE public.store_settings FROM PUBLIC;
GRANT SELECT ON TABLE public.store_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.store_settings TO authenticated;

COMMENT ON TABLE public.store_settings IS
  'Global store flags. maintenance_mode is the only key used by the storefront guard.';
