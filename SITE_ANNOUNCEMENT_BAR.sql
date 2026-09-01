-- ============================================================================
-- Kutadgu Bilig — sticky header announcement bar (PR #36)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify store_settings, maintenance_mode, books,
-- sample catalog, or other tables.
-- ============================================================================
--
-- Purpose:
--   store_announcements: Admin-managed rotating messages
--   store_announcement_settings: one global rotation interval (default 5s)
--
--   Public clients may SELECT only enabled rows inside the current
--   starts_at/ends_at window, plus the singleton settings row.
--   Only authenticated Admins (public.is_kutadgu_admin()) may write.
--   No service_role in the client. No DELETE on settings.
--
-- Depends on:
--   public.is_kutadgu_admin()  (defined in SUPABASE_SETUP.sql)
--
-- After apply:
--   Default is zero announcements. The storefront shows no bar until
--   an Admin creates and enables at least one message.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.store_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT store_announcements_message_len
    CHECK (char_length(btrim(message)) > 0 AND char_length(message) <= 280)
);

CREATE INDEX IF NOT EXISTS store_announcements_sort_idx
  ON public.store_announcements (sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.store_announcement_settings (
  id integer PRIMARY KEY,
  rotation_interval_seconds integer NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT store_announcement_settings_singleton CHECK (id = 1),
  CONSTRAINT store_announcement_settings_interval
    CHECK (rotation_interval_seconds >= 2 AND rotation_interval_seconds <= 60)
);

INSERT INTO public.store_announcement_settings (id, rotation_interval_seconds)
VALUES (1, 5)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.store_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_announcement_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_announcements_select_public ON public.store_announcements;
CREATE POLICY store_announcements_select_public
  ON public.store_announcements
  FOR SELECT
  TO anon, authenticated
  USING (
    enabled = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  );

DROP POLICY IF EXISTS store_announcements_select_admin ON public.store_announcements;
CREATE POLICY store_announcements_select_admin
  ON public.store_announcements
  FOR SELECT
  TO authenticated
  USING (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_announcements_insert_admin ON public.store_announcements;
CREATE POLICY store_announcements_insert_admin
  ON public.store_announcements
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_announcements_update_admin ON public.store_announcements;
CREATE POLICY store_announcements_update_admin
  ON public.store_announcements
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin())
  WITH CHECK (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_announcements_delete_admin ON public.store_announcements;
CREATE POLICY store_announcements_delete_admin
  ON public.store_announcements
  FOR DELETE
  TO authenticated
  USING (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_announcement_settings_select_public ON public.store_announcement_settings;
CREATE POLICY store_announcement_settings_select_public
  ON public.store_announcement_settings
  FOR SELECT
  TO anon, authenticated
  USING (id = 1);

DROP POLICY IF EXISTS store_announcement_settings_update_admin ON public.store_announcement_settings;
CREATE POLICY store_announcement_settings_update_admin
  ON public.store_announcement_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin() AND id = 1)
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

DROP POLICY IF EXISTS store_announcement_settings_insert_admin ON public.store_announcement_settings;
CREATE POLICY store_announcement_settings_insert_admin
  ON public.store_announcement_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

REVOKE ALL ON TABLE public.store_announcements FROM PUBLIC;
REVOKE ALL ON TABLE public.store_announcement_settings FROM PUBLIC;

GRANT SELECT ON TABLE public.store_announcements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.store_announcements TO authenticated;

GRANT SELECT ON TABLE public.store_announcement_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.store_announcement_settings TO authenticated;

COMMENT ON TABLE public.store_announcements IS
  'Storefront announcement bar messages. Public clients read only enabled rows in the current date window; only Admins may write.';
COMMENT ON TABLE public.store_announcement_settings IS
  'Singleton (id=1) rotation interval for the announcement bar. Public read; Admin update only.';
