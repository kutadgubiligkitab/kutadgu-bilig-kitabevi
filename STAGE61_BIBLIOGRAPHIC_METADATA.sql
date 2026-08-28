-- قۇتادغۇبىلىك كىتابخانىسى — Stage 6.1 bibliographic metadata
-- Supabase > SQL Editor دا Run قىلىڭ. بۇ ھۆججەتنى ئاگېنت ئىجرا قىلمايدۇ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / CREATE INDEX IF NOT EXISTS.
-- UPDATE / DELETE / INSERT يوق. author ۋە isbn ستونلىرى ئۆزگەرتىلمەيدۇ.
-- ISBN غا UNIQUE قويۇلمايدۇ. نەشر ئورنى / نەشر نۇسخىسى / تىل / تولۇق چېسلا قوشۇلمايدۇ.
-- RLS ئۆزگەرتىلمەيدۇ. service_role ئاچىلمايدۇ.

begin;

alter table public.books
  add column if not exists translator text;

alter table public.books
  add column if not exists publisher text;

alter table public.books
  add column if not exists publish_year integer;

alter table public.books
  add column if not exists pages integer;

comment on column public.books.translator is
  'Optional translator name. Empty/null for original-language books.';
comment on column public.books.publisher is
  'Optional publisher name.';
comment on column public.books.publish_year is
  'Optional Gregorian publication year (1000–2100).';
comment on column public.books.pages is
  'Optional page count (integer >= 1).';

alter table public.books drop constraint if exists books_publish_year_range_chk;
alter table public.books
  add constraint books_publish_year_range_chk
  check (publish_year is null or (publish_year >= 1000 and publish_year <= 2100));

alter table public.books drop constraint if exists books_pages_positive_chk;
alter table public.books
  add constraint books_pages_positive_chk
  check (pages is null or pages >= 1);

-- title/author/category trgm index لىرى CATALOG_SERVER_QUERY_MIGRATION.sql دا بار.
-- ISBN partial btree STAGE4_ADMIN_SCALABILITY.sql دىكى books_isbn_eq_idx دا بار.
create extension if not exists pg_trgm;

create index if not exists books_translator_trgm_idx
  on public.books using gin (translator gin_trgm_ops)
  where translator is not null and btrim(translator) <> '';

create index if not exists books_publisher_trgm_idx
  on public.books using gin (publisher gin_trgm_ops)
  where publisher is not null and btrim(publisher) <> '';

commit;

-- RLS: يېڭىسى يوق. SELECT يەنىلا ئاممىۋى؛ INSERT/UPDATE/DELETE يەنىلا
-- authenticated + public.is_kutadgu_admin() (SUPABASE_SETUP.sql).
