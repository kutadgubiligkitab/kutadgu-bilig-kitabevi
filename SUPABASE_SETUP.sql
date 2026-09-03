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
revoke execute on function public.is_kutadgu_admin() from anon;
grant execute on function public.is_kutadgu_admin() to authenticated;

-- 2) كىتابلار
create table if not exists public.books (
  id text primary key,
  title text not null,
  author text not null default '',
  price numeric(12,2),
  original_price numeric(12,2),
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
  cover_type text,
  book_size text,
  dimensions text not null default '',
  description text not null default '',
  stock integer check (stock is null or stock >= 0),
  stock_status text not null default '',
  is_active boolean not null default true,
  is_new boolean not null default true,
  is_featured boolean not null default false,
  is_recommended boolean not null default false,
  is_bestseller boolean not null default false,
  sales_count integer not null default 0 check (sales_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- بۇرۇن قۇرۇلغان Database نىمۇ سانلىق مەلۇمات ئۆچۈرمەي يېڭىلاش
alter table public.books add column if not exists publish_year text not null default '';
alter table public.books add column if not exists original_price numeric(12,2);
alter table public.books alter column original_price drop not null;
alter table public.books alter column original_price drop default;
alter table public.books drop constraint if exists books_original_price_chk;
alter table public.books
  add constraint books_original_price_chk
  check (original_price is null or original_price >= 0);
alter table public.books add column if not exists cover_type text;
alter table public.books add column if not exists book_size text;
alter table public.books alter column cover_type drop not null;
alter table public.books alter column cover_type drop default;
alter table public.books drop constraint if exists books_cover_type_chk;
alter table public.books
  add constraint books_cover_type_chk
  check (
    cover_type is null
    or cover_type = ''
    or cover_type in ('hardcover', 'paperback', 'other')
  );
alter table public.books drop constraint if exists books_book_size_chk;
alter table public.books
  add constraint books_book_size_chk
  check (
    book_size is null
    or book_size = ''
    or book_size in ('A4', 'A5', 'B5', 'other')
  );
alter table public.books add column if not exists dimensions text not null default '';
alter table public.books add column if not exists stock_status text not null default 'in_stock';
alter table public.books add column if not exists is_bestseller boolean not null default false;
alter table public.books add column if not exists is_featured boolean not null default false;
alter table public.books add column if not exists sales_count integer not null default 0;
alter table public.books alter column stock drop not null;
alter table public.books alter column stock drop default;
alter table public.books alter column stock_status set default '';

create index if not exists books_active_created_idx on public.books (is_active,created_at desc);
create index if not exists books_active_category_created_idx on public.books (is_active,category,created_at desc);
create index if not exists books_active_source_created_idx on public.books (is_active,source,created_at desc);
create index if not exists books_recommended_idx on public.books (is_recommended,created_at desc) where is_active = true;
create index if not exists books_bestseller_idx on public.books (is_bestseller,sales_count desc) where is_active = true;
create index if not exists books_new_override_created_idx on public.books (is_new,created_at desc) where is_active = true;
create index if not exists books_featured_created_idx on public.books (is_featured,created_at desc) where is_active = true;
create index if not exists books_active_sales_count_idx on public.books (sales_count desc,id) where is_active = true;

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
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;
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

drop policy if exists "Public can view books" on public.books;
drop policy if exists "public can read books" on public.books;
drop policy if exists "public can read active books" on public.books;
create policy "public can read active books" on public.books for select to anon,authenticated using (is_active = true);
drop policy if exists "admin can read all books" on public.books;
create policy "admin can read all books" on public.books for select to authenticated using (public.is_kutadgu_admin());
drop policy if exists "admin can insert books" on public.books;
create policy "admin can insert books" on public.books for insert to authenticated with check (public.is_kutadgu_admin());
drop policy if exists "admin can update books" on public.books;
create policy "admin can update books" on public.books for update to authenticated using (public.is_kutadgu_admin()) with check (public.is_kutadgu_admin());
drop policy if exists "admin can delete books" on public.books;
create policy "admin can delete books" on public.books for delete to authenticated using (public.is_kutadgu_admin());
drop policy if exists "aal2 required to insert books" on public.books;
create policy "aal2 required to insert books" on public.books as restrictive for insert to authenticated with check ((select auth.jwt()->>'aal') = 'aal2');
drop policy if exists "aal2 required to update books" on public.books;
create policy "aal2 required to update books" on public.books as restrictive for update to authenticated using ((select auth.jwt()->>'aal') = 'aal2') with check ((select auth.jwt()->>'aal') = 'aal2');
drop policy if exists "aal2 required to delete books" on public.books;
create policy "aal2 required to delete books" on public.books as restrictive for delete to authenticated using ((select auth.jwt()->>'aal') = 'aal2');

-- Stage 65: selling-price history (append-only) + Admin AAL2 rollback RPC.
-- No backfill. Trigger writes history. Browser has SELECT only (admin+AAL2).
create table if not exists public.book_price_history (
  id bigint generated by default as identity primary key,
  book_id text not null references public.books(id) on delete cascade,
  old_price numeric(12,2),
  new_price numeric(12,2),
  changed_by uuid,
  change_kind text not null default 'price_change',
  changed_at timestamptz not null default now()
);
comment on table public.book_price_history is
  'Append-only selling-price history. Written only by log_book_price_change(). Never backfilled.';
alter table public.book_price_history drop constraint if exists book_price_history_change_kind_chk;
alter table public.book_price_history
  add constraint book_price_history_change_kind_chk
  check (change_kind in ('price_change', 'rollback'));
create index if not exists book_price_history_book_changed_idx
  on public.book_price_history (book_id, changed_at desc);
create index if not exists book_price_history_changed_idx
  on public.book_price_history (changed_at desc);
alter table public.book_price_history enable row level security;
revoke all on table public.book_price_history from public;
revoke all on table public.book_price_history from anon;
revoke all on table public.book_price_history from authenticated;
grant select on table public.book_price_history to authenticated;
drop policy if exists "admin aal2 can read price history" on public.book_price_history;
create policy "admin aal2 can read price history"
  on public.book_price_history
  for select
  to authenticated
  using (
    public.is_kutadgu_admin()
    and (select auth.jwt()->>'aal') = 'aal2'
  );

create or replace function public.log_book_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  if old.price is not distinct from new.price then
    return new;
  end if;
  v_kind := nullif(current_setting('kutadgu.price_change_kind', true), '');
  if v_kind is null or v_kind not in ('price_change', 'rollback') then
    v_kind := 'price_change';
  end if;
  insert into public.book_price_history (
    book_id, old_price, new_price, changed_by, change_kind
  ) values (
    new.id, old.price, new.price, auth.uid(), v_kind
  );
  return new;
end;
$$;
revoke all on function public.log_book_price_change() from public;
revoke all on function public.log_book_price_change() from anon;
revoke all on function public.log_book_price_change() from authenticated;

drop trigger if exists books_log_price_change on public.books;
create trigger books_log_price_change
  after update of price on public.books
  for each row
  when (old.price is distinct from new.price)
  execute function public.log_book_price_change();

create or replace function public.rollback_book_price(
  p_book_id text,
  p_history_id bigint,
  p_expected_price numeric
)
returns table(id text, price numeric, original_price numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book public.books%rowtype;
  v_hist public.book_price_history%rowtype;
  v_target numeric(12,2);
begin
  if not public.is_kutadgu_admin() then
    raise exception 'Admin permission required';
  end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;
  if p_book_id is null or btrim(p_book_id) = '' then
    raise exception 'كىتاب ID تېپىلمىدى.';
  end if;
  if p_history_id is null then
    raise exception 'تارىخ قۇرى تېپىلمىدى.';
  end if;

  select * into v_book
  from public.books
  where public.books.id = p_book_id
  for update;
  if not found then
    raise exception 'كىتاب تېپىلمىدى.';
  end if;

  select * into v_hist
  from public.book_price_history
  where public.book_price_history.id = p_history_id;
  if not found then
    raise exception 'تارىخ قۇرى تېپىلمىدى.';
  end if;
  if v_hist.book_id is distinct from v_book.id then
    raise exception 'تارىخ قۇرى بۇ كىتابقا تەۋە ئەمەس.';
  end if;

  v_target := v_hist.old_price;
  if v_target is null or v_target < 0 then
    raise exception 'قايتۇرۇلىدىغان باھا ئىناۋەتسىز.';
  end if;

  if v_book.price is distinct from p_expected_price then
    raise exception 'باھا باشقا بەتتە ئۆزگەرتىلگەن. كىتابنى قايتا ئېچىپ قايتا سىناڭ.';
  end if;

  if v_book.price is not distinct from v_target then
    return query
      select v_book.id as id, v_book.price as price, v_book.original_price as original_price;
    return;
  end if;

  perform set_config('kutadgu.price_change_kind', 'rollback', true);

  update public.books
  set price = v_target
  where public.books.id = v_book.id
    and public.books.price is not distinct from v_book.price;

  if not found then
    raise exception 'باھا باشقا بەتتە ئۆزگەرتىلگەن. كىتابنى قايتا ئېچىپ قايتا سىناڭ.';
  end if;

  return query
    select b.id as id, b.price as price, b.original_price as original_price
    from public.books b
    where b.id = v_book.id;
end;
$$;
revoke all on function public.rollback_book_price(text, bigint, numeric) from public;
revoke execute on function public.rollback_book_price(text, bigint, numeric) from anon;
grant execute on function public.rollback_book_price(text, bigint, numeric) to authenticated;

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
drop policy if exists "aal2 required to update orders" on public.orders;
create policy "aal2 required to update orders" on public.orders as restrictive for update to authenticated using ((select auth.jwt()->>'aal') = 'aal2') with check ((select auth.jwt()->>'aal') = 'aal2');

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
drop policy if exists "aal2 required to insert book covers" on storage.objects;
create policy "aal2 required to insert book covers" on storage.objects as restrictive for insert to authenticated with check ((bucket_id = 'book-covers' and (select auth.jwt()->>'aal') = 'aal2') or (bucket_id is distinct from 'book-covers'));
drop policy if exists "aal2 required to update book covers" on storage.objects;
create policy "aal2 required to update book covers" on storage.objects as restrictive for update to authenticated using ((bucket_id = 'book-covers' and (select auth.jwt()->>'aal') = 'aal2') or (bucket_id is distinct from 'book-covers')) with check ((bucket_id = 'book-covers' and (select auth.jwt()->>'aal') = 'aal2') or (bucket_id is distinct from 'book-covers'));
drop policy if exists "aal2 required to delete book covers" on storage.objects;
create policy "aal2 required to delete book covers" on storage.objects as restrictive for delete to authenticated using ((bucket_id = 'book-covers' and (select auth.jwt()->>'aal') = 'aal2') or (bucket_id is distinct from 'book-covers'));

-- 8) Admin ھېساباتىنى بەلگىلەش
-- Supabase > Authentication > Users دىن ئۆزىڭىزنىڭ UUID سىنى كۆچۈرۈپ، تۆۋەندىكى UUID نى ئالماشتۇرۇپ ئايرىم Run قىلىڭ:
-- insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID') on conflict (user_id) do nothing;


-- ===== Analytics (v10) =====
-- Kutadgu Bilig v10: analytics + scalable collection indexes
-- Safe for an existing project. No existing rows are deleted.
create table if not exists public.analytics_events (
  id bigint generated by default as identity primary key,
  event_name text not null,
  book_id text,
  search_query text,
  category text,
  result_count integer,
  item_count integer,
  order_total numeric(12,2),
  path text,
  session_id text,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_created_idx on public.analytics_events(created_at desc);
create index if not exists analytics_events_name_created_idx on public.analytics_events(event_name,created_at desc);
create index if not exists analytics_events_book_created_idx on public.analytics_events(book_id,created_at desc) where book_id is not null;
create index if not exists analytics_events_search_created_idx on public.analytics_events(search_query,created_at desc) where search_query is not null;
create index if not exists books_active_new_manual_idx on public.books(is_new,created_at desc) where is_active=true;
create index if not exists books_active_recommended_manual_idx on public.books(is_recommended,created_at desc) where is_active=true;
create index if not exists books_active_sales_auto_idx on public.books(sales_count desc,created_at desc) where is_active=true;
alter table public.analytics_events enable row level security;
grant insert on public.analytics_events to anon,authenticated;
grant select on public.analytics_events to authenticated;
drop policy if exists "public can insert analytics" on public.analytics_events;
create policy "public can insert analytics" on public.analytics_events for insert to anon,authenticated with check (true);
drop policy if exists "admin can read analytics" on public.analytics_events;
create policy "admin can read analytics" on public.analytics_events for select to authenticated using (public.is_kutadgu_admin());


-- ===== Analytics aggregate RPC (v10) =====
grant usage, select on sequence public.analytics_events_id_seq to anon,authenticated;

create or replace function public.get_kutadgu_analytics(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1,least(coalesce(p_days,30),365)));
  v_result jsonb;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'admin only';
  end if;
  select jsonb_build_object(
    'page_views',(select count(*) from public.analytics_events where created_at>=v_since and event_name='page_view'),
    'book_views',(select count(*) from public.analytics_events where created_at>=v_since and event_name='book_view'),
    'cart_adds',(select count(*) from public.analytics_events where created_at>=v_since and event_name='add_to_cart'),
    'whatsapp_clicks',(select count(*) from public.analytics_events where created_at>=v_since and event_name='whatsapp_order_click'),
    'top_books',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select e.book_id,coalesce(b.title,e.book_id) as title,count(*)::integer as views
        from public.analytics_events e left join public.books b on b.id::text=e.book_id
        where e.created_at>=v_since and e.event_name='book_view' and e.book_id is not null
        group by e.book_id,b.title order by count(*) desc limit 10
      ) t
    ),'[]'::jsonb),
    'zero_searches',coalesce((
      select jsonb_agg(to_jsonb(z)) from (
        select search_query as query,count(*)::integer as searches
        from public.analytics_events
        where created_at>=v_since and event_name='search' and coalesce(result_count,0)=0 and search_query is not null and search_query<>''
        group by search_query order by count(*) desc limit 10
      ) z
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
grant execute on function public.get_kutadgu_analytics(integer) to authenticated;
