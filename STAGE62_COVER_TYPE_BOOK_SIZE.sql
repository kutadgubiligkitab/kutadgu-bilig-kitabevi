-- قۇتادغۇبىلىك كىتابخانىسى — Stage 6.2 cover type + book size
-- Supabase > SQL Editor دا Run قىلىڭ. بۇ ھۆججەتنى ئاگېنت ئىجرا قىلمايدۇ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / ALTER COLUMN.
-- كىتاب قۇرلىرى قايتا يېزىلمايدۇ؛ قىممەت تەكشۈرۈش/تولۇقلاش يوق.
-- مۇقاۋا URL / id / legacy_id / sales_count / باھا / ئامبار ئۆزگەرتىلمەيدۇ.
-- RLS / AAL2 / is_kutadgu_admin() ئۆزگەرتىلمەيدۇ. service_role ئاچىلمايدۇ.
-- cover_type: hardcover | paperback | other | NULL | '' (بوش قۇرلار ساقلىنىدۇ).
-- book_size: A4 | A5 | B5 | other | NULL. كەڭلىك/ئېگىزلىك يوق.

begin;

alter table public.books
  add column if not exists cover_type text;

alter table public.books
  add column if not exists book_size text;

alter table public.books alter column cover_type drop not null;
alter table public.books alter column cover_type drop default;

comment on column public.books.cover_type is
  'Optional cover binding: hardcover | paperback | other. NULL/empty = unset.';
comment on column public.books.book_size is
  'Optional paper size: A4 | A5 | B5 | other. NULL = unset. Not width/height.';

alter table public.books drop constraint if exists books_cover_type_chk;
alter table public.books
  add constraint books_cover_type_chk
  check (
    cover_type is null
    or cover_type = ''
    or cover_type in ('hardcover', 'paperback', 'other')
  );

alter table public.books drop constraint if exists books_book_size_chk;
alter table public.books
  add constraint books_book_size_chk
  check (
    book_size is null
    or book_size = ''
    or book_size in ('A4', 'A5', 'B5', 'other')
  );

commit;

-- RLS: يېڭىسى يوق. SELECT يەنىلا ئاممىۋى ئاكتىپ كىتاب؛ يېزىش يەنىلا
-- authenticated + public.is_kutadgu_admin() ۋە AAL2 restrictive policies.
