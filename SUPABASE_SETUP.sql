-- قۇتادغۇبىلىك كىتابخانىسى — كىتاب، ئەزالىق، زىيارەت ۋە زاكاز سىستېمىسى
-- Supabase > SQL Editor دا پۈتۈن ھۆججەتنى بىر قېتىم Run قىلىڭ.
-- بۇ كودنى قايتا Run قىلسىڭىزمۇ ھازىرقى سانلىق مەلۇمات ئۆچمەيدۇ.

create extension if not exists pgcrypto;

-- 1) باشقۇرغۇچى
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_kutadgu_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_kutadgu_admin() from public;
grant execute on function public.is_kutadgu_admin() to anon, authenticated;

-- 2) كىتابلار
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
  publish_year text not null default '',
  publisher text not null default '',
  cover_type text not null default '',
  dimensions text not null default '',
  description text not null default '',
  stock integer not null default 0 check (stock >= 0),
  stock_status text not null default 'in_stock',
  is_active boolean not null default true,
  is_new boolean not null default true,
  is_recommended boolean not null default false,
  is_bestseller boolean not null default false,
  sales_count integer not null default 0 check (sales_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- بۇرۇن قۇرۇلغان Database نىمۇ سانلىق مەلۇمات ئۆچۈرمەي يېڭىلاش
alter table public.books add column if not exists publish_year text not null default '';
alter table public.books add column if not exists cover_type text not null default '';
alter table public.books add column if not exists dimensions text not null default '';
alter table public.books add column if not exists stock_status text not null default 'in_stock';
alter table public.books add column if not exists is_bestseller boolean not null default false;
alter table public.books add column if not exists sales_count integer not null default 0;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;
revoke all on function public.touch_updated_at() from public;

drop trigger if exists books_touch_updated_at on public.books;
create trigger books_touch_updated_at before update on public.books
for each row execute function public.touch_updated_at();

-- 3) خېرىدار ئارخىپى ۋە زىيارەت ئۇچۇرى
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  phone text not null default '',
  country text not null default '',
  city text not null default '',
  address text not null default '',
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  last_seen_at timestamptz,
  visit_count bigint not null default 0 check (visit_count >= 0),
  last_page text not null default ''
);

alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists country text not null default '';
alter table public.profiles add column if not exists city text not null default '';
alter table public.profiles add column if not exists address text not null default '';
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists visit_count bigint not null default 0;
alter table public.profiles add column if not exists last_page text not null default '';

create or replace function public.handle_new_member()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id,email,full_name,created_at)
  values (new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.created_at,now()))
  on conflict (id) do update
  set email = excluded.email,
      full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;
  return new;
end;
$$;
revoke all on function public.handle_new_member() from public;

drop trigger if exists on_auth_user_created_kutadgu on auth.users;
create trigger on_auth_user_created_kutadgu
after insert or update of email on auth.users
for each row execute function public.handle_new_member();

insert into public.profiles (id,email,full_name,created_at)
select u.id,coalesce(u.email,''),coalesce(u.raw_user_meta_data->>'full_name',''),coalesce(u.created_at,now())
from auth.users u
on conflict (id) do update set email = excluded.email;

create or replace function public.is_member_active()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;
revoke all on function public.is_member_active() from public;
grant execute on function public.is_member_active() to authenticated;

create or replace function public.record_member_visit(page_path text default '')
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.profiles (id,email,last_seen_at,visit_count,last_page)
  select auth.uid(),coalesce(u.email,''),now(),1,left(coalesce(page_path,''),500)
  from auth.users u where u.id = auth.uid()
  on conflict (id) do update
  set last_seen_at = now(),
      visit_count = public.profiles.visit_count + 1,
      last_page = left(coalesce(page_path,''),500),
      updated_at = now();
end;
$$;
revoke all on function public.record_member_visit(text) from public;
grant execute on function public.record_member_visit(text) to authenticated;

create or replace function public.record_member_login()
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles set last_login_at = now(), updated_at = now() where id = auth.uid();
end;
$$;
revoke all on function public.record_member_login() from public;
grant execute on function public.record_member_login() to authenticated;

create or replace function public.set_member_status(member_id uuid,new_status text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_kutadgu_admin() then raise exception 'Admin permission required'; end if;
  if new_status not in ('active','suspended') then raise exception 'Invalid member status'; end if;
  update public.profiles set status = new_status, updated_at = now() where id = member_id;
end;
$$;
revoke all on function public.set_member_status(uuid,text) from public;
grant execute on function public.set_member_status(uuid,text) to authenticated;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

-- 4) ئەزانىڭ ياقتۇرغانلىرى ۋە سېۋىتى
create table if not exists public.member_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id,book_id)
);

create table if not exists public.member_cart_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  quantity integer not null default 1 check (quantity between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key (user_id,book_id)
);

-- 5) زاكاز تارىخى
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'prepared' check (status in ('prepared','confirmed','processing','shipped','completed','cancelled')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  total numeric(12,2) not null default 0 check (total >= 0),
  total_qty integer not null default 0 check (total_qty >= 0),
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_city text not null default '',
  customer_address text not null default '',
  delivery_method text not null default '',
  customer_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at before update on public.orders
for each row execute function public.touch_updated_at();

create index if not exists orders_user_created_idx on public.orders (user_id,created_at desc);
create index if not exists profiles_last_seen_idx on public.profiles (last_seen_at desc nulls last);

-- 6) Row Level Security
alter table public.admin_users enable row level security;
alter table public.books enable row level security;
alter table public.profiles enable row level security;
alter table public.member_favorites enable row level security;
alter table public.member_cart_items enable row level security;
alter table public.orders enable row level security;

grant select on public.books to anon,authenticated;
grant insert,update,delete on public.books to authenticated;
grant select on public.admin_users to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,delete on public.member_favorites to authenticated;
grant select,insert,delete on public.member_cart_items to authenticated;
grant select,insert,update on public.orders to authenticated;

drop policy if exists "admin can read own admin row" on public.admin_users;
create policy "admin can read own admin row" on public.admin_users for select to authenticated using (user_id = auth.uid());

drop policy if exists "public can read books" on public.books;
create policy "public can read books" on public.books for select to anon,authenticated using (true);
drop policy if exists "admin can insert books" on public.books;
create policy "admin can insert books" on public.books for insert to authenticated with check (public.is_kutadgu_admin());
drop policy if exists "admin can update books" on public.books;
create policy "admin can update books" on public.books for update to authenticated using (public.is_kutadgu_admin()) with check (public.is_kutadgu_admin());
drop policy if exists "admin can delete books" on public.books;
create policy "admin can delete books" on public.books for delete to authenticated using (public.is_kutadgu_admin());

drop policy if exists "member can read own profile" on public.profiles;
create policy "member can read own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "member can update own profile" on public.profiles;
create policy "member can update own profile" on public.profiles for update to authenticated
using (id = auth.uid() and status = 'active') with check (id = auth.uid() and status = 'active');
drop policy if exists "admin can read all profiles" on public.profiles;
create policy "admin can read all profiles" on public.profiles for select to authenticated using (public.is_kutadgu_admin());

drop policy if exists "favorite owner access" on public.member_favorites;
create policy "favorite owner access" on public.member_favorites for all to authenticated
using (user_id = auth.uid() and public.is_member_active()) with check (user_id = auth.uid() and public.is_member_active());
drop policy if exists "cart owner access" on public.member_cart_items;
create policy "cart owner access" on public.member_cart_items for all to authenticated
using (user_id = auth.uid() and public.is_member_active()) with check (user_id = auth.uid() and public.is_member_active());

drop policy if exists "member can read own orders" on public.orders;
create policy "member can read own orders" on public.orders for select to authenticated using (user_id = auth.uid());
drop policy if exists "member can create own orders" on public.orders;
create policy "member can create own orders" on public.orders for insert to authenticated
with check (user_id = auth.uid() and public.is_member_active());
drop policy if exists "admin can read all orders" on public.orders;
create policy "admin can read all orders" on public.orders for select to authenticated using (public.is_kutadgu_admin());
drop policy if exists "admin can update orders" on public.orders;
create policy "admin can update orders" on public.orders for update to authenticated
using (public.is_kutadgu_admin()) with check (public.is_kutadgu_admin());

-- خېرىدار status/visit_count نى ئۆزى ئۆزگەرتەلمەيدۇ؛ پەقەت ئارخىپ مەيدانىنىلا تەھرىرلەيدۇ.
revoke update on public.profiles from authenticated;
grant update (full_name,phone,country,city,address) on public.profiles to authenticated;

-- 7) كىتاب مۇقاۋا Storage
insert into storage.buckets (id,name,public) values ('book-covers','book-covers',true)
on conflict (id) do update set public = true;

drop policy if exists "public can read book covers" on storage.objects;
create policy "public can read book covers" on storage.objects for select to anon,authenticated using (bucket_id = 'book-covers');
drop policy if exists "admin can upload book covers" on storage.objects;
create policy "admin can upload book covers" on storage.objects for insert to authenticated
with check (bucket_id = 'book-covers' and public.is_kutadgu_admin());
drop policy if exists "admin can update book covers" on storage.objects;
create policy "admin can update book covers" on storage.objects for update to authenticated
using (bucket_id = 'book-covers' and public.is_kutadgu_admin()) with check (bucket_id = 'book-covers' and public.is_kutadgu_admin());
drop policy if exists "admin can delete book covers" on storage.objects;
create policy "admin can delete book covers" on storage.objects for delete to authenticated
using (bucket_id = 'book-covers' and public.is_kutadgu_admin());

-- 8) Admin ھېساباتىنى بەلگىلەش
-- Supabase > Authentication > Users دىن ئۆزىڭىزنىڭ UUID سىنى كۆچۈرۈپ، تۆۋەندىكى UUID نى ئالماشتۇرۇپ ئايرىم Run قىلىڭ:
-- insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID') on conflict (user_id) do nothing;
