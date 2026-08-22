-- قۇتادغۇبىلىك كىتابخانىسى — STEP5 Secure Admin
-- Supabase SQL Editor غا پۈتۈنلەي بىر قېتىم Paste قىلىپ Run قىلىڭ.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_kutadgu_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_kutadgu_admin() from public;
grant execute on function public.is_kutadgu_admin() to anon, authenticated;

create table if not exists public.books (
  id text primary key,
  title text not null,
  author text not null default '',
  price numeric(12,2),
  category text not null,
  source text not null,
  image_url text not null default '',
  href text not null default '',
  pages integer,
  translator text not null default '',
  language text not null default '',
  publish_date text not null default '',
  publisher text not null default '',
  description text not null default '',
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  is_new boolean not null default true,
  is_recommended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists books_touch_updated_at on public.books;
create trigger books_touch_updated_at
before update on public.books
for each row execute function public.touch_updated_at();

alter table public.admin_users enable row level security;
alter table public.books enable row level security;

drop policy if exists "admin can read own admin row" on public.admin_users;
create policy "admin can read own admin row"
on public.admin_users for select
to authenticated
using (user_id = auth.uid());

-- كىتاب ئۇچۇرى مەخپىي ئەمەس؛ public تور بەت remote catalog نى ئوقۇيدۇ.
-- is_active=false بولغان row مۇ static fallback نى توغرا يوشۇرۇش ئۈچۈن ئوقۇلىدۇ،
-- ئەمما public تور بەت JS ئۇنى كۆرسەتمەيدۇ.
drop policy if exists "public can read books" on public.books;
create policy "public can read books"
on public.books for select
to anon, authenticated
using (true);

drop policy if exists "admin can insert books" on public.books;
create policy "admin can insert books"
on public.books for insert
to authenticated
with check (public.is_kutadgu_admin());

drop policy if exists "admin can update books" on public.books;
create policy "admin can update books"
on public.books for update
to authenticated
using (public.is_kutadgu_admin())
with check (public.is_kutadgu_admin());

drop policy if exists "admin can delete books" on public.books;
create policy "admin can delete books"
on public.books for delete
to authenticated
using (public.is_kutadgu_admin());

insert into storage.buckets (id, name, public)
values ('book-covers','book-covers',true)
on conflict (id) do update set public=true;

drop policy if exists "public can read book covers" on storage.objects;
create policy "public can read book covers"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'book-covers');

drop policy if exists "admin can upload book covers" on storage.objects;
create policy "admin can upload book covers"
on storage.objects for insert
to authenticated
with check (bucket_id='book-covers' and public.is_kutadgu_admin());

drop policy if exists "admin can update book covers" on storage.objects;
create policy "admin can update book covers"
on storage.objects for update
to authenticated
using (bucket_id='book-covers' and public.is_kutadgu_admin())
with check (bucket_id='book-covers' and public.is_kutadgu_admin());

drop policy if exists "admin can delete book covers" on storage.objects;
create policy "admin can delete book covers"
on storage.objects for delete
to authenticated
using (bucket_id='book-covers' and public.is_kutadgu_admin());

-- ئەڭ ئاخىرىدا ئۆزىڭىزنىڭ Auth user UUID سىنى تۆۋەندىكىگە قويۇڭ:
-- insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID')
-- on conflict (user_id) do nothing;
