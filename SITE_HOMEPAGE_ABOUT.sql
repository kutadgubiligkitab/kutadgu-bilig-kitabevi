-- ============================================================================
-- Kutadgu Bilig — homepage About copy (بىز ھەققىدە)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify store_settings, store_hero_*, store_announcements,
-- books, stock, orders, or sample catalog.
-- ============================================================================
--
-- Why a new table:
--   public.store_settings.value is boolean and RLS only allows key
--   maintenance_mode. About copy cannot live there without changing that
--   flag table. This file adds one singleton row instead.
--
-- Purpose:
--   store_homepage_about id=1 holds one JSON object of plain-text About
--   fields (title, intro, paragraphs, closing, three service chips).
--   Founding year 2013 is not stored and stays hard-coded in index.html.
--
-- Depends on:
--   public.is_kutadgu_admin()  (defined in SUPABASE_SETUP.sql)
--
-- After apply:
--   Seeded copy matches the current homepage About text, so the public
--   section looks unchanged until an Admin saves different wording.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_homepage_about (
  id integer PRIMARY KEY,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT store_homepage_about_singleton CHECK (id = 1),
  CONSTRAINT store_homepage_about_content_object CHECK (jsonb_typeof(content) = 'object')
);

INSERT INTO public.store_homepage_about (id, content)
VALUES (
  1,
  jsonb_build_object(
    'title', 'بىز ھەققىدە',
    'intro', '«بەخت ئېلىپ كېلىدىغان بىلىم» مەنىسىدىكى «قۇتادغۇبىلىك» نامىنى قوللانغان كىتابخانىمىز 2013-يىلى قۇرۇلغان.',
    'paragraph1', 'خەلقىمىزنىڭ بىلىمگە بولغان تەشنالىقى ۋە مەنىۋى ئېھتىياجىنى قاندۇرۇش، مىللىتىمىزنىڭ مەنىۋى ساپاسىنى بېيىتىش غايىسى بىلەن قۇرۇلغان.',
    'paragraph2', 'قۇتادغۇبىلىك كىتابخانىسى كىتاب ۋە ئوقۇش قوراللىرى سېتىش، كىتاب ئارىيەت بېرىش ۋە كۈتۈپخانا قاتارلىق ئۈچ ئاساسلىق بۆلۈمدىن تەركىب تاپقان بولۇپ، تۈركىيە ئىچى ۋە سىرتىدىكى ئوقۇرمەنلىرىمىزنى ھەر خىل كىتابلار بىلەن تەمىنلەپ كەلمەكتە.',
    'closing', 'بىلىم — ئۆزىمىزنى كۈچلەندۈرۈشنىڭ ئەڭ مۇھىم يولى. قۇتادغۇبىلىك كىتابخانىسى بىلىمگە يەتكۈزىدىغان كىتابلىرى بىلەن سىزنى ھەر ۋاقىت قارشى ئالىدۇ.',
    'chip1', 'كىتاب ۋە ئوقۇش قوراللىرى سېتىش',
    'chip2', 'كىتاب ئارىيەت بېرىش',
    'chip3', 'كۈتۈپخانا'
  )
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.store_homepage_about ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_homepage_about_select_public ON public.store_homepage_about;
CREATE POLICY store_homepage_about_select_public
  ON public.store_homepage_about
  FOR SELECT
  TO anon, authenticated
  USING (id = 1);

DROP POLICY IF EXISTS store_homepage_about_insert_admin ON public.store_homepage_about;
CREATE POLICY store_homepage_about_insert_admin
  ON public.store_homepage_about
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

DROP POLICY IF EXISTS store_homepage_about_update_admin ON public.store_homepage_about;
CREATE POLICY store_homepage_about_update_admin
  ON public.store_homepage_about
  FOR UPDATE
  TO authenticated
  USING (public.is_kutadgu_admin() AND id = 1)
  WITH CHECK (public.is_kutadgu_admin() AND id = 1);

DROP POLICY IF EXISTS "aal2 required to insert store_homepage_about" ON public.store_homepage_about;
CREATE POLICY "aal2 required to insert store_homepage_about"
  ON public.store_homepage_about
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

DROP POLICY IF EXISTS "aal2 required to update store_homepage_about" ON public.store_homepage_about;
CREATE POLICY "aal2 required to update store_homepage_about"
  ON public.store_homepage_about
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((select auth.jwt()->>'aal') = 'aal2');

REVOKE ALL ON TABLE public.store_homepage_about FROM PUBLIC;
GRANT SELECT ON TABLE public.store_homepage_about TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.store_homepage_about TO authenticated;

COMMENT ON TABLE public.store_homepage_about IS
  'Singleton (id=1) homepage About copy as one JSON object. Public read; Admin insert/update only. Missing/failed reads must keep index.html fallback.';

COMMIT;
