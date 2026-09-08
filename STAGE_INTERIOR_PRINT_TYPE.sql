-- قۇتادغۇبىلىك كىتابخانىسى — optional interior print type (color | bw | null)
-- Supabase > SQL Editor دا Run قىلىڭ. بۇ ھۆججەتنى ئاگېنت ئىجرا قىلمايدۇ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / UPDATE WHERE NULL.
-- is_color_print ئۆچۈرۈلمەيدۇ. باھا / ئامبار / زاكاز / RLS ئۆزگەرتىلمەيدۇ.
-- پەقەت is_color_print = true قۇرلار 'color' غا كۆچۈرۈلىدۇ.
-- false / unmarked قۇرلار NULL قالىدۇ — 'bw' قىلىنمايدۇ.
-- service_role ئاچىلمايدۇ.

begin;

alter table public.books
  add column if not exists interior_print_type text;

alter table public.books alter column interior_print_type drop not null;
alter table public.books alter column interior_print_type drop default;

comment on column public.books.interior_print_type is
  'Optional interior print: color | bw | NULL (unmarked). Authoritative over is_color_print.';

alter table public.books drop constraint if exists books_interior_print_type_chk;
alter table public.books
  add constraint books_interior_print_type_chk
  check (
    interior_print_type is null
    or interior_print_type in ('color', 'bw')
  );

update public.books
set interior_print_type = 'color'
where is_color_print = true
  and interior_print_type is null;

commit;

-- RLS: يېڭىسى يوق. SELECT يەنىلا ئاممىۋى ئاكتىپ كىتاب؛ يېزىش يەنىلا
-- authenticated + public.is_kutadgu_admin() ۋە AAL2 restrictive policies.
