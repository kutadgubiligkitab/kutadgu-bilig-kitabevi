-- قۇتادغۇبىلىك كىتابخانىسى — 1000–5000 كىتابقا تەييارلاش
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ.
-- بۇ migration ھېچقانداق كىتاب، مۇقاۋا ياكى زاكاز سانلىق مەلۇماتىنى ئۆچۈرمەيدۇ.

begin;

-- كونا ئۆرنەك كىتابلارنىڭ ھەقىقىي ئامبار سانى تېخى نامەلۇم بولسا NULL ساقلاشقا يول قويىدۇ.
alter table public.books alter column stock drop not null;
alter table public.books alter column stock drop default;
alter table public.books alter column stock_status set default '';

-- چوڭ catalog دا ئەڭ كۆپ ئىشلىتىلىدىغان query لارنى تېزلىتىدۇ.
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
