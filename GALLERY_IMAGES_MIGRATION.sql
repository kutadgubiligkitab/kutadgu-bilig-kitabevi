-- قۇتادغۇبىلىك كىتابخانىسى — optional book detail gallery
-- Supabase > SQL Editor دا Run قىلىڭ. بۇ ھۆججەتنى ئاگېنت ئىجرا قىلمايدۇ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS / DROP+ADD CHECK.
-- books.id / image_url / created_at / sales_count / RLS تېگىلمەيدۇ.
-- UPDATE / DELETE / INSERT يوق. مەۋجۇت مۇقاۋا يوللىرى قايتا يېزىلمايدۇ.
-- service_role ئاچىلمايدۇ. ئاممىۋى يېزىش ھوقۇقى كېڭەيمەيدۇ.
--
-- يېڭى ستون پەقەت قوشۇمچە رەسىم URL/path لىرىنى ساقلايدۇ (jsonb array).
-- ئاساسىي مۇقاۋا يەنىلا image_url. Base64 ساقلىمايدۇ.
-- 0–4 دانە قوشۇمچە رەسىم ئىناۋەتلىك. كونا كىتابلار [] بىلەن داۋاملىشىدۇ.

begin;

alter table public.books
  add column if not exists gallery_images jsonb not null default '[]'::jsonb;

comment on column public.books.gallery_images is
  'Optional extra detail images (back cover, TOC, sample pages). URLs/paths only. Max 4. Main cover stays in image_url.';

alter table public.books drop constraint if exists books_gallery_images_array_chk;

alter table public.books
  add constraint books_gallery_images_array_chk
  check (
    jsonb_typeof(gallery_images) = 'array'
    and jsonb_array_length(gallery_images) <= 4
  );

commit;

-- RLS: يېڭىسى يوق. SELECT يەنىلا ئاممىۋى؛ INSERT/UPDATE/DELETE يەنىلا
-- authenticated + public.is_kutadgu_admin() (SUPABASE_SETUP.sql).
