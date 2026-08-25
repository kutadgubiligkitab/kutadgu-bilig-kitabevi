-- قۇتادغۇبىلىك كىتابخانىسى
-- تەۋسىيەلىك / يېڭى كەلگەن / كۆپ سېتىلغان final rule migration
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- جەدۋەل قايتا قۇرۇلمايدۇ، مەۋجۇت data ئۆچۈرۈلمەيدۇ.

begin;

alter table public.books add column if not exists is_active boolean not null default true;
alter table public.books add column if not exists is_new boolean not null default false;
alter table public.books add column if not exists is_recommended boolean not null default false;
alter table public.books add column if not exists is_featured boolean not null default false;
alter table public.books add column if not exists is_bestseller boolean not null default false;
alter table public.books add column if not exists sales_count integer not null default 0;
alter table public.books add column if not exists created_at timestamptz not null default now();

-- يېڭى كىتابنى بۇندىن كېيىن Admin دىكى is_new toggle بەلگىلەيدۇ.
alter table public.books alter column is_new set default false;

-- كونا is_featured=true data نى بىر قېتىم يېڭى ئاساسلىق field قا كۆچۈرۈش.
-- is_featured ئۆچۈرۈلمەيدۇ؛ پەقەت legacy compatibility ئۈچۈن ساقلىنىدۇ.
update public.books
set is_recommended = true
where is_featured = true
  and is_recommended is distinct from true;

-- Admin تاللىغان يېڭى ۋە تەۋسىيەلىك كىتابلار ئۈچۈن bounded partial index لار.
create index if not exists books_new_selected_active_idx
  on public.books (created_at desc,id)
  where is_active = true and is_new = true;

create index if not exists books_recommended_selected_active_idx
  on public.books (created_at desc,id)
  where is_active = true and is_recommended = true;

-- كۆپ سېتىلغانلار sales_count DESC بويىچە server-side تاللىنىدۇ.
create index if not exists books_sales_rank_active_idx
  on public.books (sales_count desc,created_at desc,id)
  where is_active = true;

commit;
