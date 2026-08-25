-- قۇتادغۇبىلىك كىتابخانىسى — server-side search/filter/sort index لىرى
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- بۇ migration ھېچقانداق كىتاب، مۇقاۋا ياكى باشقا سانلىق مەلۇماتنى ئۆچۈرمەيدۇ.

begin;

-- كونا books جەدۋىلىدە كەم بولۇشى مۇمكىن بولغان ستونلارنى
-- مەۋجۇت سانلىق مەلۇماتقا تەگمەي تولۇقلاش.
alter table public.books add column if not exists title text not null default '';
alter table public.books add column if not exists author text not null default '';
alter table public.books add column if not exists price numeric(12,2);
alter table public.books add column if not exists category text not null default '';
alter table public.books add column if not exists source text not null default 'universal.html';
alter table public.books add column if not exists is_active boolean not null default true;
alter table public.books add column if not exists is_new boolean not null default true;
alter table public.books add column if not exists is_recommended boolean not null default false;
alter table public.books add column if not exists is_bestseller boolean not null default false;
alter table public.books add column if not exists sales_count integer not null default 0;
alter table public.books add column if not exists created_at timestamptz not null default now();

-- title / author / category ئىچىدىن ilike بىلەن تېز ئىزدەش ئۈچۈن.
create extension if not exists pg_trgm;

create index if not exists books_title_trgm_idx
  on public.books using gin (title gin_trgm_ops)
  where is_active = true;

create index if not exists books_author_trgm_idx
  on public.books using gin (author gin_trgm_ops)
  where is_active = true;

create index if not exists books_category_trgm_idx
  on public.books using gin (category gin_trgm_ops)
  where is_active = true;

-- category/source بىلەن page قىلىش ۋە باھا/نام تەرتىپى ئۈچۈن.
create index if not exists books_active_source_price_idx
  on public.books (is_active,source,price,id);

create index if not exists books_active_category_price_idx
  on public.books (is_active,category,price,id);

create index if not exists books_active_title_idx
  on public.books (is_active,title,id);

-- يېڭى كەلگەن، تەۋسىيەلىك ۋە كۆپ سېتىلغان بۆلەكلەرنىڭ bounded query لىرى.
create index if not exists books_active_created_idx
  on public.books (is_active,created_at desc);

create index if not exists books_active_category_created_idx
  on public.books (is_active,category,created_at desc);

create index if not exists books_active_source_created_idx
  on public.books (is_active,source,created_at desc);

create index if not exists books_recommended_idx
  on public.books (is_recommended,created_at desc)
  where is_active = true;

create index if not exists books_bestseller_idx
  on public.books (is_bestseller,sales_count desc)
  where is_active = true;

commit;
