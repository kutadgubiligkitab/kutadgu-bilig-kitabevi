-- قۇتادغۇبىلىك كىتابخانىسى — new/recommended compatibility + focused indexes
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- بۇ migration table ياكى كىتاب data نى ئۆچۈرمەيدۇ.

begin;

-- Legacy featured field نى ساقلاپ، يېڭى admin flow دا is_recommended نى ئاساسلىق field قىلىمىز.
alter table public.books
  add column if not exists is_featured boolean not null default false;

-- كونا featured كىتابلار recommended تىزىملىكىدىن يوقاپ كەتمىسۇن.
update public.books
set is_recommended = true
where is_featured = true
  and is_recommended is distinct from true;

-- 30 كۈن + manual is_new override query سى ۋە كۆپ ئىشلىتىلىدىغان sort/filter لار.
create index if not exists books_new_override_created_idx
  on public.books (is_new, created_at desc)
  where is_active = true;

create index if not exists books_featured_created_idx
  on public.books (is_featured, created_at desc)
  where is_active = true;

create index if not exists books_active_sales_count_idx
  on public.books (sales_count desc, id)
  where is_active = true;

-- تۆۋەندىكى indexes كونا migration دا بار بولسا IF NOT EXISTS سەۋەبىدىن قايتا قۇرۇلمايدۇ.
create index if not exists books_active_created_idx
  on public.books (is_active, created_at desc);

create index if not exists books_active_category_created_idx
  on public.books (is_active, category, created_at desc);

create index if not exists books_recommended_idx
  on public.books (is_recommended, created_at desc)
  where is_active = true;

create index if not exists books_bestseller_idx
  on public.books (is_bestseller, sales_count desc)
  where is_active = true;

commit;
