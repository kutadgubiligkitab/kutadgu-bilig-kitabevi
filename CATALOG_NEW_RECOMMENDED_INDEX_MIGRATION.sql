-- قۇتادغۇبىلىك كىتابخانىسى
-- يېڭى كەلگەنلەر + legacy featured compatibility + bounded query index لىرى
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- بۇ migration جەدۋەلنى قايتا قۇرمايدۇ ۋە مەۋجۇت كىتابلارنى ئۆچۈرمەيدۇ.

begin;

-- كونا project لاردا كەم بولۇشى مۇمكىن بولغان flag/date ستونلىرىنى بىخەتەر تولۇقلاش.
alter table public.books add column if not exists is_active boolean not null default true;
alter table public.books add column if not exists is_new boolean not null default false;
alter table public.books add column if not exists is_recommended boolean not null default false;
alter table public.books add column if not exists is_featured boolean not null default false;
alter table public.books add column if not exists is_bestseller boolean not null default false;
alter table public.books add column if not exists sales_count integer not null default 0;
alter table public.books add column if not exists created_at timestamptz not null default now();

-- بۇندىن كېيىن is_new پەقەت قولدا override قىلىنغاندا true بولسۇن؛
-- ئادەتتىكى «يېڭى» ھالىتى created_at نىڭ 30 كۈنلۈك ۋاقتىدىن ھېسابلىنىدۇ.
alter table public.books alter column is_new set default false;

-- is_recommended يېڭى ئاساسلىق field؛ is_featured پەقەت legacy compatibility ئۈچۈن ساقلىنىدۇ.
update public.books
set is_recommended = true
where is_featured = true
  and is_recommended is distinct from true;

-- 30 كۈنلۈك يېڭى كىتاب، category + newest ۋە default newest query لىرى.
create index if not exists books_created_at_active_idx
  on public.books (created_at desc,id)
  where is_active = true;

create index if not exists books_category_created_active_idx
  on public.books (category,created_at desc,id)
  where is_active = true;

-- 30 كۈندىن كونا بولسىمۇ is_new=true قىلىنغان manual override لار.
create index if not exists books_new_manual_active_idx
  on public.books (created_at desc,id)
  where is_active = true and is_new = true;

-- تەۋسىيەلىك query نىڭ يېڭى ۋە legacy ئىككى تارمىقىغا ئايرىم partial index.
create index if not exists books_recommended_true_active_idx
  on public.books (created_at desc,id)
  where is_active = true and is_recommended = true;

create index if not exists books_featured_legacy_active_idx
  on public.books (created_at desc,id)
  where is_active = true and is_featured = true;

-- كۆپ سېتىلغان flag ۋە sales_count sort/filter.
create index if not exists books_sales_count_active_idx
  on public.books (sales_count desc,id)
  where is_active = true;

create index if not exists books_bestseller_sales_active_idx
  on public.books (sales_count desc,created_at desc,id)
  where is_active = true and is_bestseller = true;

commit;
