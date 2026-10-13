-- Members-only physical gift offers.
-- Apply manually after review. This file does not run in CI and does not
-- change public.books policies, books.price, or books.stock.
-- An offer is book_id, enabled, and updated_at. Availability is the book's
-- existing stock and stock_status. A request does not reserve stock.
-- Reapplying keeps existing offer rows.
-- Rollback is STAGE122_GIFT_BOOK_OFFERS_ROLLBACK.sql.
-- That rollback drops this table and these functions. It does not drop books.

begin;

create table if not exists public.gift_book_offers (
  book_id bigint primary key references public.books (id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.gift_book_offers is
  'Which existing books an administrator offers as free physical gifts. Not a price, a stock quantity, or a public catalog flag.';

alter table public.gift_book_offers enable row level security;
alter table public.gift_book_offers force row level security;

revoke all on table public.gift_book_offers from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.gift_book_offers to authenticated;

create or replace function public.gift_book_offers_touch()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists gift_book_offers_touch on public.gift_book_offers;
create trigger gift_book_offers_touch
before insert or update on public.gift_book_offers
for each row execute function public.gift_book_offers_touch();

revoke all on function public.gift_book_offers_touch() from public, anon, authenticated, service_role;

-- Security invoker so public.books row security still applies to the caller.
create or replace function public.gift_book_is_requestable(p_book_id bigint)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.books b
    where b.id = p_book_id
      and b.is_active is true
      and b.submission_status = 'approved'
      and (b.stock is null or b.stock > 0)
      and lower(btrim(coalesce(b.stock_status, ''))) not in (
        'out', 'out_of_stock', 'soldout', 'sold-out', 'تۈگەپ كەتتى'
      )
  );
$$;

revoke all on function public.gift_book_is_requestable(bigint) from public, anon, authenticated, service_role;
grant execute on function public.gift_book_is_requestable(bigint) to authenticated;

drop policy if exists "members read eligible gift offers" on public.gift_book_offers;
create policy "members read eligible gift offers"
on public.gift_book_offers
for select
to authenticated
using (
  enabled is true
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
  )
  and public.gift_book_is_requestable(book_id)
);

drop policy if exists "admins read gift offers" on public.gift_book_offers;
create policy "admins read gift offers"
on public.gift_book_offers
for select
to authenticated
using (
  coalesce(public.is_kutadgu_admin(), false)
  and (select auth.jwt()->>'aal') = 'aal2'
);

drop policy if exists "admins insert gift offers" on public.gift_book_offers;
create policy "admins insert gift offers"
on public.gift_book_offers
for insert
to authenticated
with check (coalesce(public.is_kutadgu_admin(), false));

drop policy if exists "aal2 required to insert gift offers" on public.gift_book_offers;
create policy "aal2 required to insert gift offers"
on public.gift_book_offers
as restrictive
for insert
to authenticated
with check ((select auth.jwt()->>'aal') = 'aal2');

drop policy if exists "admins update gift offers" on public.gift_book_offers;
create policy "admins update gift offers"
on public.gift_book_offers
for update
to authenticated
using (coalesce(public.is_kutadgu_admin(), false))
with check (coalesce(public.is_kutadgu_admin(), false));

drop policy if exists "aal2 required to update gift offers" on public.gift_book_offers;
create policy "aal2 required to update gift offers"
on public.gift_book_offers
as restrictive
for update
to authenticated
using ((select auth.jwt()->>'aal') = 'aal2')
with check ((select auth.jwt()->>'aal') = 'aal2');

drop policy if exists "admins delete gift offers" on public.gift_book_offers;
create policy "admins delete gift offers"
on public.gift_book_offers
for delete
to authenticated
using (coalesce(public.is_kutadgu_admin(), false));

drop policy if exists "aal2 required to delete gift offers" on public.gift_book_offers;
create policy "aal2 required to delete gift offers"
on public.gift_book_offers
as restrictive
for delete
to authenticated
using ((select auth.jwt()->>'aal') = 'aal2');

commit;
