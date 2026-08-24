-- قۇتادغۇبىلىك V9 — مەۋجۇت كىتاب ۋە مۇقاۋىلارنى ئۆچۈرمەيدىغان بىخەتەر يېڭىلاش
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.

alter table public.books add column if not exists publish_year text not null default '';
alter table public.books add column if not exists cover_type text not null default '';
alter table public.books add column if not exists dimensions text not null default '';
alter table public.books add column if not exists stock_status text not null default 'in_stock';
alter table public.books add column if not exists is_bestseller boolean not null default false;
alter table public.books add column if not exists sales_count integer not null default 0;
