-- Read-only page of one member's saved website cart for an admin at AAL2.
-- Does not add a table, a cart policy, or any write grant.
-- Apply after the existing member_cart_items table and is_kutadgu_admin().

begin;

create or replace function public.admin_member_cart_page(
  p_user_id uuid,
  p_after_book_id text
)
returns table (
  book_id text,
  quantity integer,
  title text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_after text;
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'Member required' using errcode = '22023';
  end if;
  v_after := nullif(p_after_book_id, '');
  return query
  select c.book_id, c.quantity, b.title
  from public.member_cart_items c
  left join public.books b on b.id::text = c.book_id
  where c.user_id = p_user_id
    and (v_after is null or c.book_id > v_after)
  order by c.book_id asc
  limit 100;
end;
$$;

revoke all on function public.admin_member_cart_page(uuid, text) from public, anon;
grant execute on function public.admin_member_cart_page(uuid, text) to authenticated;

commit;
