-- Book reviews. Apply this file by hand in the Supabase SQL editor.
-- Do not fold it into an older migration. It is not applied by this change.
-- Anonymous reads use only the approved-and-active-book policy.
-- That policy does not call public.is_kutadgu_admin().

begin;

create extension if not exists pgcrypto;

create table if not exists public.book_reviews (
  id uuid primary key default gen_random_uuid(),
  book_id bigint not null references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default 'ئەزا',
  body text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  constraint book_reviews_status_chk check (status in ('pending', 'approved', 'rejected')),
  constraint book_reviews_body_chk check (char_length(btrim(body)) between 1 and 2000),
  constraint book_reviews_display_name_chk check (
    char_length(btrim(display_name)) between 1 and 80
    and position('@' in display_name) = 0
  )
);

create unique index if not exists book_reviews_one_pending_per_member_book
  on public.book_reviews (book_id, user_id)
  where status = 'pending';

create index if not exists book_reviews_approved_book_idx
  on public.book_reviews (book_id, created_at desc)
  where status = 'approved';

create or replace function public.book_reviews_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.books b
    where b.id = new.book_id and b.is_active = true
  ) then
    raise exception 'Book is not public' using errcode = '42501';
  end if;
  new.user_id := auth.uid();
  new.status := 'pending';
  new.moderated_at := null;
  new.created_at := now();
  new.body := btrim(new.body);
  if new.body is null or char_length(new.body) < 1 or char_length(new.body) > 2000 then
    raise exception 'Review text is empty or too long' using errcode = '22023';
  end if;
  select nullif(btrim(p.full_name), '')
    into raw_name
  from public.profiles p
  where p.id = auth.uid();
  if raw_name is null or position('@' in raw_name) > 0 or char_length(raw_name) > 80 then
    new.display_name := 'ئەزا';
  else
    new.display_name := raw_name;
  end if;
  return new;
end;
$$;

drop trigger if exists book_reviews_before_insert on public.book_reviews;
create trigger book_reviews_before_insert
before insert on public.book_reviews
for each row
execute function public.book_reviews_before_insert();

create or replace function public.moderate_book_review(review_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if decision is distinct from 'approved' and decision is distinct from 'rejected' then
    raise exception 'Invalid review decision' using errcode = '22023';
  end if;
  update public.book_reviews
     set status = decision,
         moderated_at = now()
   where id = review_id
     and status = 'pending';
  if not found then
    raise exception 'Review not pending' using errcode = '02000';
  end if;
end;
$$;

revoke all on function public.book_reviews_before_insert() from public, anon;
grant execute on function public.book_reviews_before_insert() to authenticated;

revoke all on function public.moderate_book_review(uuid, text) from public, anon;
grant execute on function public.moderate_book_review(uuid, text) to authenticated;

alter table public.book_reviews enable row level security;
alter table public.book_reviews force row level security;

drop policy if exists "public reads approved reviews of active books" on public.book_reviews;
create policy "public reads approved reviews of active books"
on public.book_reviews
for select
to anon, authenticated
using (
  status = 'approved'
  and exists (
    select 1 from public.books b
    where b.id = book_reviews.book_id
      and b.is_active = true
  )
);

drop policy if exists "member reads own book reviews" on public.book_reviews;
create policy "member reads own book reviews"
on public.book_reviews
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "admin aal2 reads book reviews" on public.book_reviews;
create policy "admin aal2 reads book reviews"
on public.book_reviews
for select
to authenticated
using (
  public.is_kutadgu_admin()
  and (select auth.jwt()->>'aal') = 'aal2'
);

drop policy if exists "member inserts own pending review" on public.book_reviews;
create policy "member inserts own pending review"
on public.book_reviews
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and char_length(btrim(body)) between 1 and 2000
  and exists (
    select 1 from public.books b
    where b.id = book_reviews.book_id
      and b.is_active = true
  )
);

revoke all on table public.book_reviews from public, anon, authenticated;
grant select (
  id,
  book_id,
  display_name,
  body,
  status,
  created_at,
  moderated_at
) on table public.book_reviews to anon, authenticated;
grant insert (book_id, body) on table public.book_reviews to authenticated;

commit;
