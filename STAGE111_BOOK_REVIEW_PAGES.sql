-- Reach every moderation record and one public approved reply outside the first page.
-- Apply after STAGE110_BOOK_REVIEW_NOTIFICATIONS.sql.
-- The one-argument admin list functions stay in place. These overloads add a stable keyset page.

begin;

create or replace function public.admin_list_book_reviews(
  p_status text,
  p_after timestamptz,
  p_after_id uuid
)
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
    and (
      p_after is null
      or r.created_at > p_after
      or (r.created_at = p_after and r.id > p_after_id)
    )
  order by r.created_at asc, r.id asc
  limit 100;
end;
$$;

create or replace function public.admin_list_book_review_replies(
  p_status text,
  p_after timestamptz,
  p_after_id uuid
)
returns table (
  id uuid,
  review_id uuid,
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
  select rp.id, rp.review_id, b.id, b.title, rp.display_name, rp.body, rp.status, rp.created_at
  from public.book_review_replies rp
  join public.book_reviews parent on parent.id = rp.review_id
  join public.books b on b.id = parent.book_id
  where rp.status = p_status
    and (
      p_after is null
      or rp.created_at > p_after
      or (rp.created_at = p_after and rp.id > p_after_id)
    )
  order by rp.created_at asc, rp.id asc
  limit 100;
end;
$$;

-- Public approved reply and its public parent. It does not read user ids or call the admin helper.
create or replace function public.public_book_review_reply_target(p_reply_id uuid)
returns table (
  review_id uuid,
  review_display_name text,
  review_body text,
  review_created_at timestamptz,
  reply_id uuid,
  reply_display_name text,
  reply_body text,
  reply_created_at timestamptz,
  book_id bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select parent.id, parent.display_name, parent.body, parent.created_at,
         rp.id, rp.display_name, rp.body, rp.created_at,
         parent.book_id
  from public.book_review_replies rp
  join public.book_reviews parent on parent.id = rp.review_id
  join public.books b on b.id = parent.book_id
  where rp.id = p_reply_id
    and rp.status = 'approved'
    and parent.status = 'approved'
    and b.is_active = true;
$$;

revoke all on function public.admin_list_book_reviews(text, timestamptz, uuid) from public, anon;
revoke all on function public.admin_list_book_review_replies(text, timestamptz, uuid) from public, anon;
revoke all on function public.public_book_review_reply_target(uuid) from public;
grant execute on function public.admin_list_book_reviews(text, timestamptz, uuid) to authenticated;
grant execute on function public.admin_list_book_review_replies(text, timestamptz, uuid) to authenticated;
grant execute on function public.public_book_review_reply_target(uuid) to anon, authenticated;

commit;
