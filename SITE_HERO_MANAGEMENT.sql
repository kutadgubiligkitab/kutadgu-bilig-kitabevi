-- ============================================================================
-- Kutadgu Bilig — homepage Hero Admin management (PR 1 / DB foundation)
-- MANUAL / REVIEWED APPLY ONLY.
-- DO NOT RUN FROM CI OR BROWSER.
-- Repeat-safe. Does not modify store_settings, store_announcements, books,
-- storage.objects, storage buckets, stock, orders, sample catalog, or
-- repository Hero assets under /assets/store/.
-- ============================================================================
--
-- Purpose:
--   store_hero_settings: singleton (id=1) rotation interval + optional
--     default-store copy overrides. NULL copy fields mean future public JS
--     must keep the hard-coded index.html Hero.
--   store_hero_store_slides: default bookstore gallery descriptors.
--     Three origin=repo seeds (main, library, exterior) only identify the
--     existing repo WebP files. Those files are permanent fallbacks.
--   store_hero_campaigns: optional featured/campaign Hero items.
--     Public SELECT is enabled + time window only. Book/stock eligibility
--     is NOT encoded here and must stay in a future public JS layer.
--
--   Public clients may SELECT the settings row, enabled store slides, and
--   currently scheduled campaigns. Only authenticated Admins
--   (public.is_kutadgu_admin()) may write. Settings has no DELETE.
--   No service_role in the client. No stock quantity column.
--
-- Depends on:
--   public.is_kutadgu_admin()  (defined in SUPABASE_SETUP.sql)
--   public.books(id) bigint     (campaigns.book_id FK, ON DELETE SET NULL)
--
-- After apply:
--   Storefront behavior is unchanged until a later public overlay exists.
--   Empty/NULL overlays must leave the hard-coded Hero in place.
--
-- v1 Hero button hrefs are internal only: #hash or /root-relative.
-- v1 image_url values are https://... or /root-relative (not //...).
-- origin=repo slides cannot be deleted via RLS.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_hero_settings (
  id integer PRIMARY KEY,
  rotation_interval_seconds integer NOT NULL DEFAULT 7,
  eyebrow text NULL,
  trust_line text NULL,
  body text NULL,
  primary_label text NULL,
  primary_href text NULL,
  secondary_label text NULL,
  secondary_href text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT store_hero_settings_singleton CHECK (id = 1),
  CONSTRAINT store_hero_settings_interval
    CHECK (rotation_interval_seconds IN (5, 7, 10, 15)),
  CONSTRAINT store_hero_settings_eyebrow_len
    CHECK (eyebrow IS NULL OR (char_length(btrim(eyebrow)) > 0 AND char_length(eyebrow) <= 80)),
  CONSTRAINT store_hero_settings_trust_len
    CHECK (trust_line IS NULL OR (char_length(btrim(trust_line)) > 0 AND char_length(trust_line) <= 80)),
  CONSTRAINT store_hero_settings_body_len
    CHECK (body IS NULL OR (char_length(btrim(body)) > 0 AND char_length(body) <= 500)),
  CONSTRAINT store_hero_settings_primary_label_len
    CHECK (primary_label IS NULL OR (char_length(btrim(primary_label)) > 0 AND char_length(primary_label) <= 80)),
  CONSTRAINT store_hero_settings_secondary_label_len
    CHECK (secondary_label IS NULL OR (char_length(btrim(secondary_label)) > 0 AND char_length(secondary_label) <= 80)),
  CONSTRAINT store_hero_settings_primary_href_len
    CHECK (primary_href IS NULL OR (char_length(btrim(primary_href)) > 0 AND char_length(primary_href) <= 500)),
  CONSTRAINT store_hero_settings_secondary_href_len
    CHECK (secondary_href IS NULL OR (char_length(btrim(secondary_href)) > 0 AND char_length(secondary_href) <= 500)),
  CONSTRAINT store_hero_settings_primary_href_internal
    CHECK (
      primary_href IS NULL
      OR btrim(primary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(primary_href) ~ '^/[^/]'
        AND btrim(primary_href) !~ '\./'
      )
    ),
  CONSTRAINT store_hero_settings_secondary_href_internal
    CHECK (
      secondary_href IS NULL
      OR btrim(secondary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(secondary_href) ~ '^/[^/]'
        AND btrim(secondary_href) !~ '\./'
      )
    )
);

ALTER TABLE public.store_hero_settings
  DROP CONSTRAINT IF EXISTS store_hero_settings_primary_href_scheme;
ALTER TABLE public.store_hero_settings
  DROP CONSTRAINT IF EXISTS store_hero_settings_secondary_href_scheme;
ALTER TABLE public.store_hero_settings
  DROP CONSTRAINT IF EXISTS store_hero_settings_primary_href_internal;
ALTER TABLE public.store_hero_settings
  DROP CONSTRAINT IF EXISTS store_hero_settings_secondary_href_internal;
ALTER TABLE public.store_hero_settings
  ADD CONSTRAINT store_hero_settings_primary_href_internal
    CHECK (
      primary_href IS NULL
      OR btrim(primary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(primary_href) ~ '^/[^/]'
        AND btrim(primary_href) !~ '\./'
      )
    );
ALTER TABLE public.store_hero_settings
  ADD CONSTRAINT store_hero_settings_secondary_href_internal
    CHECK (
      secondary_href IS NULL
      OR btrim(secondary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(secondary_href) ~ '^/[^/]'
        AND btrim(secondary_href) !~ '\./'
      )
    );

INSERT INTO public.store_hero_settings (id, rotation_interval_seconds)
VALUES (1, 7)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.store_hero_store_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  origin text NOT NULL,
  repo_key text NULL,
  image_url text NULL,
  object_path text NULL,
  alt_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT store_hero_store_slides_origin
    CHECK (origin IN ('repo', 'upload')),
  CONSTRAINT store_hero_store_slides_repo_key
    CHECK (repo_key IS NULL OR repo_key IN ('main', 'library', 'exterior')),
  CONSTRAINT store_hero_store_slides_origin_shape
    CHECK (
      (origin = 'repo' AND repo_key IN ('main', 'library', 'exterior') AND image_url IS NULL AND object_path IS NULL)
      OR (
        origin = 'upload'
        AND repo_key IS NULL
        AND image_url IS NOT NULL
        AND object_path IS NOT NULL
      )
    ),
  CONSTRAINT store_hero_store_slides_image_url_len
    CHECK (image_url IS NULL OR (char_length(btrim(image_url)) > 0 AND char_length(image_url) <= 2000)),
  CONSTRAINT store_hero_store_slides_object_path_len
    CHECK (object_path IS NULL OR (char_length(btrim(object_path)) > 0 AND char_length(object_path) <= 500)),
  CONSTRAINT store_hero_store_slides_alt_len
    CHECK (alt_text IS NULL OR (char_length(btrim(alt_text)) > 0 AND char_length(alt_text) <= 200)),
  CONSTRAINT store_hero_store_slides_image_url_safe
    CHECK (
      image_url IS NULL
      OR btrim(image_url) ~* '^https://[^/[:space:]].+$'
      OR (
        btrim(image_url) ~ '^/'
        AND btrim(image_url) !~ '^//'
      )
    )
);

ALTER TABLE public.store_hero_store_slides
  DROP CONSTRAINT IF EXISTS store_hero_store_slides_origin_shape;
ALTER TABLE public.store_hero_store_slides
  ADD CONSTRAINT store_hero_store_slides_origin_shape
    CHECK (
      (origin = 'repo' AND repo_key IN ('main', 'library', 'exterior') AND image_url IS NULL AND object_path IS NULL)
      OR (
        origin = 'upload'
        AND repo_key IS NULL
        AND image_url IS NOT NULL
        AND object_path IS NOT NULL
      )
    );
ALTER TABLE public.store_hero_store_slides
  DROP CONSTRAINT IF EXISTS store_hero_store_slides_image_url_scheme;
ALTER TABLE public.store_hero_store_slides
  DROP CONSTRAINT IF EXISTS store_hero_store_slides_image_url_safe;
ALTER TABLE public.store_hero_store_slides
  ADD CONSTRAINT store_hero_store_slides_image_url_safe
    CHECK (
      image_url IS NULL
      OR btrim(image_url) ~* '^https://[^/[:space:]].+$'
      OR (
        btrim(image_url) ~ '^/'
        AND btrim(image_url) !~ '^//'
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS store_hero_store_slides_repo_key_uidx
  ON public.store_hero_store_slides (repo_key)
  WHERE origin = 'repo' AND repo_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS store_hero_store_slides_sort_idx
  ON public.store_hero_store_slides (sort_order, created_at);

INSERT INTO public.store_hero_store_slides (enabled, sort_order, origin, repo_key)
SELECT true, 0, 'repo', 'main'
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_hero_store_slides WHERE origin = 'repo' AND repo_key = 'main'
);

INSERT INTO public.store_hero_store_slides (enabled, sort_order, origin, repo_key)
SELECT true, 1, 'repo', 'library'
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_hero_store_slides WHERE origin = 'repo' AND repo_key = 'library'
);

INSERT INTO public.store_hero_store_slides (enabled, sort_order, origin, repo_key)
SELECT true, 2, 'repo', 'exterior'
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_hero_store_slides WHERE origin = 'repo' AND repo_key = 'exterior'
);

CREATE TABLE IF NOT EXISTS public.store_hero_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  book_id bigint NULL REFERENCES public.books(id) ON DELETE SET NULL,
  image_url text NULL,
  object_path text NULL,
  eyebrow text NULL,
  title text NULL,
  body text NULL,
  primary_label text NULL,
  primary_href text NULL,
  secondary_label text NULL,
  secondary_href text NULL,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT store_hero_campaigns_window
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT store_hero_campaigns_eyebrow_len
    CHECK (eyebrow IS NULL OR (char_length(btrim(eyebrow)) > 0 AND char_length(eyebrow) <= 80)),
  CONSTRAINT store_hero_campaigns_title_len
    CHECK (title IS NULL OR (char_length(btrim(title)) > 0 AND char_length(title) <= 120)),
  CONSTRAINT store_hero_campaigns_body_len
    CHECK (body IS NULL OR (char_length(btrim(body)) > 0 AND char_length(body) <= 500)),
  CONSTRAINT store_hero_campaigns_primary_label_len
    CHECK (primary_label IS NULL OR (char_length(btrim(primary_label)) > 0 AND char_length(primary_label) <= 80)),
  CONSTRAINT store_hero_campaigns_secondary_label_len
    CHECK (secondary_label IS NULL OR (char_length(btrim(secondary_label)) > 0 AND char_length(secondary_label) <= 80)),
  CONSTRAINT store_hero_campaigns_primary_href_len
    CHECK (primary_href IS NULL OR (char_length(btrim(primary_href)) > 0 AND char_length(primary_href) <= 500)),
  CONSTRAINT store_hero_campaigns_secondary_href_len
    CHECK (secondary_href IS NULL OR (char_length(btrim(secondary_href)) > 0 AND char_length(secondary_href) <= 500)),
  CONSTRAINT store_hero_campaigns_image_url_len
    CHECK (image_url IS NULL OR (char_length(btrim(image_url)) > 0 AND char_length(image_url) <= 2000)),
  CONSTRAINT store_hero_campaigns_object_path_len
    CHECK (object_path IS NULL OR (char_length(btrim(object_path)) > 0 AND char_length(object_path) <= 500)),
  CONSTRAINT store_hero_campaigns_primary_href_internal
    CHECK (
      primary_href IS NULL
      OR btrim(primary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(primary_href) ~ '^/[^/]'
        AND btrim(primary_href) !~ '\./'
      )
    ),
  CONSTRAINT store_hero_campaigns_secondary_href_internal
    CHECK (
      secondary_href IS NULL
      OR btrim(secondary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(secondary_href) ~ '^/[^/]'
        AND btrim(secondary_href) !~ '\./'
      )
    ),
  CONSTRAINT store_hero_campaigns_image_url_safe
    CHECK (
      image_url IS NULL
      OR btrim(image_url) ~* '^https://[^/[:space:]].+$'
      OR (
        btrim(image_url) ~ '^/'
        AND btrim(image_url) !~ '^//'
      )
    )
);

ALTER TABLE public.store_hero_campaigns
  DROP CONSTRAINT IF EXISTS store_hero_campaigns_primary_href_scheme;
ALTER TABLE public.store_hero_campaigns
  DROP CONSTRAINT IF EXISTS store_hero_campaigns_secondary_href_scheme;
ALTER TABLE public.store_hero_campaigns
  DROP CONSTRAINT IF EXISTS store_hero_campaigns_image_url_scheme;
ALTER TABLE public.store_hero_campaigns
  DROP CONSTRAINT IF EXISTS store_hero_campaigns_primary_href_internal;
ALTER TABLE public.store_hero_campaigns
  DROP CONSTRAINT IF EXISTS store_hero_campaigns_secondary_href_internal;
ALTER TABLE public.store_hero_campaigns
  DROP CONSTRAINT IF EXISTS store_hero_campaigns_image_url_safe;
ALTER TABLE public.store_hero_campaigns
  ADD CONSTRAINT store_hero_campaigns_primary_href_internal
    CHECK (
      primary_href IS NULL
      OR btrim(primary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(primary_href) ~ '^/[^/]'
        AND btrim(primary_href) !~ '\./'
      )
    );
ALTER TABLE public.store_hero_campaigns
  ADD CONSTRAINT store_hero_campaigns_secondary_href_internal
    CHECK (
      secondary_href IS NULL
      OR btrim(secondary_href) ~ '^#[A-Za-z0-9_-]+$'
      OR (
        btrim(secondary_href) ~ '^/[^/]'
        AND btrim(secondary_href) !~ '\./'
      )
    );
ALTER TABLE public.store_hero_campaigns
  ADD CONSTRAINT store_hero_campaigns_image_url_safe
    CHECK (
      image_url IS NULL
      OR btrim(image_url) ~* '^https://[^/[:space:]].+$'
      OR (
        btrim(image_url) ~ '^/'
        AND btrim(image_url) !~ '^//'
      )
    );

CREATE INDEX IF NOT EXISTS store_hero_campaigns_sort_idx
  ON public.store_hero_campaigns (sort_order, created_at);

CREATE INDEX IF NOT EXISTS store_hero_campaigns_book_idx
  ON public.store_hero_campaigns (book_id);

ALTER TABLE public.store_hero_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_hero_store_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_hero_campaigns ENABLE ROW LEVEL SECURITY;

-- Public SELECT
DROP POLICY IF EXISTS store_hero_settings_select_public ON public.store_hero_settings;
CREATE POLICY store_hero_settings_select_public
  ON public.store_hero_settings
  FOR SELECT
  TO anon, authenticated
  USING (id = 1);

DROP POLICY IF EXISTS store_hero_store_slides_select_public ON public.store_hero_store_slides;
CREATE POLICY store_hero_store_slides_select_public
  ON public.store_hero_store_slides
  FOR SELECT
  TO anon, authenticated
  USING (enabled = true);

DROP POLICY IF EXISTS store_hero_campaigns_select_public ON public.store_hero_campaigns;
CREATE POLICY store_hero_campaigns_select_public
  ON public.store_hero_campaigns
  FOR SELECT
  TO anon, authenticated
  USING (
    enabled = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  );

-- Admin SELECT (disabled / out-of-window rows)
DROP POLICY IF EXISTS store_hero_settings_select_admin ON public.store_hero_settings;
CREATE POLICY store_hero_settings_select_admin
  ON public.store_hero_settings
  FOR SELECT
  TO authenticated
  USING (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_hero_store_slides_select_admin ON public.store_hero_store_slides;
CREATE POLICY store_hero_store_slides_select_admin
  ON public.store_hero_store_slides
  FOR SELECT
  TO authenticated
  USING (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_hero_campaigns_select_admin ON public.store_hero_campaigns;
CREATE POLICY store_hero_campaigns_select_admin
  ON public.store_hero_campaigns
  FOR SELECT
  TO authenticated
  USING (public.is_kutadgu_admin());

-- Admin writes (permissive is_kutadgu_admin)
DROP POLICY IF EXISTS store_hero_settings_insert_admin ON public.store_hero_settings;
CREATE POLICY store_hero_settings_insert_admin
  ON public.store_hero_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

DROP POLICY IF EXISTS store_hero_settings_update_admin ON public.store_hero_settings;
CREATE POLICY store_hero_settings_update_admin
  ON public.store_hero_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin() AND id = 1)
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

DROP POLICY IF EXISTS store_hero_store_slides_insert_admin ON public.store_hero_store_slides;
CREATE POLICY store_hero_store_slides_insert_admin
  ON public.store_hero_store_slides
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_hero_store_slides_update_admin ON public.store_hero_store_slides;
CREATE POLICY store_hero_store_slides_update_admin
  ON public.store_hero_store_slides
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin())
  WITH CHECK (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_hero_store_slides_delete_admin ON public.store_hero_store_slides;
CREATE POLICY store_hero_store_slides_delete_admin
  ON public.store_hero_store_slides
  FOR DELETE
  TO authenticated
  USING (public.is_kutadgu_admin() AND origin = 'upload');

DROP POLICY IF EXISTS store_hero_campaigns_insert_admin ON public.store_hero_campaigns;
CREATE POLICY store_hero_campaigns_insert_admin
  ON public.store_hero_campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_hero_campaigns_update_admin ON public.store_hero_campaigns;
CREATE POLICY store_hero_campaigns_update_admin
  ON public.store_hero_campaigns
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin())
  WITH CHECK (public.is_kutadgu_admin());

DROP POLICY IF EXISTS store_hero_campaigns_delete_admin ON public.store_hero_campaigns;
CREATE POLICY store_hero_campaigns_delete_admin
  ON public.store_hero_campaigns
  FOR DELETE
  TO authenticated
  USING (public.is_kutadgu_admin());

-- Restrictive AAL2 (AND-ed with Admin policies). No SELECT AAL2.
DROP POLICY IF EXISTS "aal2 required to insert store_hero_settings" ON public.store_hero_settings;
CREATE POLICY "aal2 required to insert store_hero_settings"
  ON public.store_hero_settings
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_hero_settings" ON public.store_hero_settings;
CREATE POLICY "aal2 required to update store_hero_settings"
  ON public.store_hero_settings
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to insert store_hero_store_slides" ON public.store_hero_store_slides;
CREATE POLICY "aal2 required to insert store_hero_store_slides"
  ON public.store_hero_store_slides
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_hero_store_slides" ON public.store_hero_store_slides;
CREATE POLICY "aal2 required to update store_hero_store_slides"
  ON public.store_hero_store_slides
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete store_hero_store_slides" ON public.store_hero_store_slides;
CREATE POLICY "aal2 required to delete store_hero_store_slides"
  ON public.store_hero_store_slides
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to insert store_hero_campaigns" ON public.store_hero_campaigns;
CREATE POLICY "aal2 required to insert store_hero_campaigns"
  ON public.store_hero_campaigns
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_hero_campaigns" ON public.store_hero_campaigns;
CREATE POLICY "aal2 required to update store_hero_campaigns"
  ON public.store_hero_campaigns
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to delete store_hero_campaigns" ON public.store_hero_campaigns;
CREATE POLICY "aal2 required to delete store_hero_campaigns"
  ON public.store_hero_campaigns
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2');

REVOKE ALL ON TABLE public.store_hero_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.store_hero_store_slides FROM PUBLIC;
REVOKE ALL ON TABLE public.store_hero_campaigns FROM PUBLIC;

GRANT SELECT ON TABLE public.store_hero_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.store_hero_settings TO authenticated;

GRANT SELECT ON TABLE public.store_hero_store_slides TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.store_hero_store_slides TO authenticated;

GRANT SELECT ON TABLE public.store_hero_campaigns TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.store_hero_campaigns TO authenticated;

COMMENT ON TABLE public.store_hero_settings IS
  'Singleton (id=1) homepage Hero interval and optional default-store copy. NULL copy fields preserve hard-coded index.html. Public read; Admin insert/update only.';
COMMENT ON TABLE public.store_hero_store_slides IS
  'Default bookstore Hero gallery. origin=repo seeds identify /assets/store WebP fallbacks and cannot be deleted (RLS). Public reads enabled rows; only Admins may write.';
COMMENT ON TABLE public.store_hero_campaigns IS
  'Optional featured/campaign Hero items. Public reads enabled rows in the current date window; book/stock eligibility is applied by a future storefront layer. Only Admins may write. No stock quantity column.';

COMMIT;
