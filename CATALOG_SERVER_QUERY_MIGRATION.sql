-- قۇتادغۇبىلىك كىتابخانىسى — server-side search/filter/sort index لىرى
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- بۇ migration ھېچقانداق كىتاب، مۇقاۋا ياكى باشقا سانلىق مەلۇماتنى ئۆچۈرمەيدۇ.

begin;

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

commit;
