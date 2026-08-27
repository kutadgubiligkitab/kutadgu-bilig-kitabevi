-- قۇتادغۇبىلىك كىتابخانىسى — Stage 4 Admin scalability
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- جەدۋەل DROP/CREATE قىلىنمايدۇ. UPDATE/DELETE يوق. RLS ئۆزگەرتىلمەيدۇ.
-- مەۋجۇت قۇرلار، id، image_url، created_at، updated_at، sales_count ساقلىنىدۇ.
-- بۇ ھۆججەت service_role ئاچمايدۇ ۋە ئاممىۋى يېزىش ھوقۇقى بەرمەيدۇ.

-- isbn: مەۋجۇت ھەر قۇرغا بوش تېكىست قويۇلىدۇ (NOT NULL DEFAULT '').
-- قايتا Run قىلسىڭىز ستون بار بولسا ئاتلىنىدۇ؛ قىممەتلەر قايتا يېزىلمايدۇ.

begin;

alter table public.books
  add column if not exists isbn text not null default '';

-- ISBN تەكرار تەكشۈرۈش ۋە .eq / .in ئىزدەش. بوش ISBN كىرەلمەيدۇ.
create index if not exists books_isbn_eq_idx
  on public.books (isbn)
  where isbn <> '';

-- Admin تىزىملىكى يوشۇرۇلغان كىتابلارنىمۇ كۆرسىتىدۇ؛
-- كونا storefront index لار ھەمىشە is_active=true partial.
-- بۇ btree index لار filter + created_at/id تەرتىپ + LIMIT/OFFSET ئۈچۈن.
create index if not exists books_admin_created_idx
  on public.books (created_at desc, id);

create index if not exists books_admin_active_created_idx
  on public.books (is_active, created_at desc, id);

create index if not exists books_admin_recommended_idx
  on public.books (is_recommended, created_at desc, id);

create index if not exists books_admin_new_idx
  on public.books (is_new, created_at desc, id);

create index if not exists books_admin_source_created_idx
  on public.books (source, created_at desc, id);

commit;

-- pg_trgm: بۇ Stage 4 ھۆججىتى كېڭەيتىلمىنى قوزغاتمايدۇ.
-- Admin ئىزدەش ILIKE '%text%' ئىشلىتىدۇ؛ btree بۇنى تېزلىتەلمەيدۇ.
-- 5,000 قۇرلۇق Admin ئىزدەش seq scan بىلەن يېتەرلىك.
-- Storefront تەرەپتىكى trgm index لار CATALOG_SERVER_QUERY_MIGRATION.sql دا قالىدۇ.

-- RLS: يېڭىسى يوق. كىتاب INSERT/UPDATE/DELETE يەنىلا
-- authenticated + public.is_kutadgu_admin() (SUPABASE_SETUP.sql).
