-- Book review length and admin deletion.
-- Apply after STAGE107_BOOK_REVIEWS.sql. Do not edit that file.
-- New top-level reviews are 1–1000 characters after trim.
-- The table check stays at 2000 so an already stored longer review
-- can still be approved, rejected, or deleted.

begin;

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
  if new.body is null or char_length(new.body) < 1 or char_length(new.body) > 1000 then
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

create or replace function public.delete_book_review(p_review_id uuid)
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
  delete from public.book_reviews where id = p_review_id;
  if not found then
    raise exception 'Review not found' using errcode = '02000';
  end if;
end;
$$;

revoke all on function public.delete_book_review(uuid) from public, anon;
grant execute on function public.delete_book_review(uuid) to authenticated;

create or replace function public.admin_list_book_reviews(p_status text)
returns table (
  id uuid,
  book_id bigint,
  book_title text,
  display_name text,
  body text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if p_status is distinct from 'pending'
     and p_status is distinct from 'approved'
     and p_status is distinct from 'rejected' then
    raise exception 'Invalid review status' using errcode = '22023';
  end if;
  return query
  select r.id, r.book_id, b.title, r.display_name, r.body, r.status, r.created_at
  from public.book_reviews r
  join public.books b on b.id = r.book_id
  where r.status = p_status
  order by r.created_at asc, r.id asc
  limit 100;
end;
$$;

revoke all on function public.admin_list_book_reviews(text) from public, anon;
grant execute on function public.admin_list_book_reviews(text) to authenticated;

create or replace function public.admin_book_review_exists(p_review_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  return exists (select 1 from public.book_reviews where id = p_review_id);
end;
$$;

revoke all on function public.admin_book_review_exists(uuid) from public, anon;
grant execute on function public.admin_book_review_exists(uuid) to authenticated;

commit;
