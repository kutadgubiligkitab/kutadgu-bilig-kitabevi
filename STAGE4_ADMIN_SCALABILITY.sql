-- قۇتادغۇبىلىك كىتابخانىسى — Stage 4 Admin scalability
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- Repeat-safe: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- مەۋجۇت كىتاب، ID، image_url، created_at، sales_count ۋە RLS ئۆزگەرتىلمەيدۇ.
-- بۇ ھۆججەت RLS نى ئاجىزلاشتۇرمايدۇ؛ service_role ئاچمايدۇ.

begin;

-- ISBN/barcode: schema دا بۇرۇن isbn يوق. بوش قىممەت رۇخسەت (مەجبۇرىي ئەمەس).
alter table public.books
  add column if not exists isbn text not null default '';

-- Admin تىزىملىكى يوشۇرۇلغان كىتابلارنىمۇ ئىزدەيدۇ؛ شۇڭا is_active=true partial index يەتمەيدۇ.
create extension if not exists pg_trgm;

create index if not exists books_isbn_eq_idx
  on public.books (isbn)
  where isbn <> '';

create index if not exists books_isbn_trgm_idx
  on public.books using gin (isbn gin_trgm_ops);

create index if not exists books_publisher_trgm_idx
  on public.books using gin (publisher gin_trgm_ops);

create index if not exists books_title_trgm_all_idx
  on public.books using gin (title gin_trgm_ops);

create index if not exists books_author_trgm_all_idx
  on public.books using gin (author gin_trgm_ops);

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

-- RLS: يېڭىسى قوشۇلمايدۇ. كىتاب يېزىش يەنىلا authenticated + is_kutadgu_admin() ئارقىلىق.
-- public.books select يەنىلا ھەممە ئوقۇرمەنلەرگە ئوچۇق (مەۋجۇت ھالەت).
