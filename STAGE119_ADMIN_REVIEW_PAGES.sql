-- Admin review and reply pages of 10, with an exact total and a literal search.
-- Apply after STAGE111_BOOK_REVIEW_PAGES.sql.
-- The older admin_list_book_reviews and admin_list_book_review_replies signatures stay.
-- A page index is used here because Previous/Next and a bounded last-page recovery
-- need a page number. Rows still use the existing oldest-first (created_at, id) order.
-- Search matches the book title or that row's stored display_name. % _ and \ are literal.

begin;

create or replace function public.admin_review_search_pattern(p_query text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
begin
  if char_length(v_query) > 200 then
    raise exception 'Review search is too long' using errcode = '22023';
  end if;
  if v_query = '' then
    return null;
  end if;
  return '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
end;
$$;

create or replace function public.admin_book_review_page(
  p_status text,
  p_query text,
  p_page integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pattern text;
  v_total integer;
  v_page integer;
  v_rows jsonb;
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
  if p_page is null or p_page < 0 or p_page > 100000 then
    raise exception 'Invalid review page' using errcode = '22023';
  end if;
  v_pattern := public.admin_review_search_pattern(p_query);
  with filtered as (
    select r.id, r.book_id, b.title as book_title, r.display_name, r.body, r.status, r.created_at
    from public.book_reviews r
    join public.books b on b.id = r.book_id
    where r.status = p_status
      and (
        v_pattern is null
        or b.title ilike v_pattern escape E'\\'
        or r.display_name ilike v_pattern escape E'\\'
      )
  ),
  counted as (
    select count(*)::integer as total from filtered
  ),
  chosen as (
    select total,
      case when total = 0 then 0 else least(p_page, (total - 1) / 10) end as page
    from counted
  ),
  page_rows as (
    select f.id, f.book_id, f.book_title, f.display_name, f.body, f.status, f.created_at
    from filtered f
    order by f.created_at asc, f.id asc
    offset ((select page from chosen) * 10)
    limit 10
  )
  select chosen.total, chosen.page,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'book_id', page_rows.book_id,
        'book_title', page_rows.book_title,
        'display_name', page_rows.display_name,
        'body', page_rows.body,
        'status', page_rows.status,
        'created_at', page_rows.created_at
      ) order by page_rows.created_at asc, page_rows.id asc)
      from page_rows
    ), '[]'::jsonb)
  into v_total, v_page, v_rows
  from chosen;
  return jsonb_build_object('total', v_total, 'page', v_page, 'rows', v_rows);
end;
$$;

create or replace function public.admin_book_review_reply_page(
  p_status text,
  p_query text,
  p_page integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pattern text;
  v_total integer;
  v_page integer;
  v_rows jsonb;
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
  if p_page is null or p_page < 0 or p_page > 100000 then
    raise exception 'Invalid review page' using errcode = '22023';
  end if;
  v_pattern := public.admin_review_search_pattern(p_query);
  with filtered as (
    select rp.id, rp.review_id, b.id as book_id, b.title as book_title, rp.display_name, rp.body, rp.status, rp.created_at
    from public.book_review_replies rp
    join public.book_reviews parent on parent.id = rp.review_id
    join public.books b on b.id = parent.book_id
    where rp.status = p_status
      and (
        v_pattern is null
        or b.title ilike v_pattern escape E'\\'
        or rp.display_name ilike v_pattern escape E'\\'
      )
  ),
  counted as (
    select count(*)::integer as total from filtered
  ),
  chosen as (
    select total,
      case when total = 0 then 0 else least(p_page, (total - 1) / 10) end as page
    from counted
  ),
  page_rows as (
    select f.id, f.review_id, f.book_id, f.book_title, f.display_name, f.body, f.status, f.created_at
    from filtered f
    order by f.created_at asc, f.id asc
    offset ((select page from chosen) * 10)
    limit 10
  )
  select chosen.total, chosen.page,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'review_id', page_rows.review_id,
        'book_id', page_rows.book_id,
        'book_title', page_rows.book_title,
        'display_name', page_rows.display_name,
        'body', page_rows.body,
        'status', page_rows.status,
        'created_at', page_rows.created_at
      ) order by page_rows.created_at asc, page_rows.id asc)
      from page_rows
    ), '[]'::jsonb)
  into v_total, v_page, v_rows
  from chosen;
  return jsonb_build_object('total', v_total, 'page', v_page, 'rows', v_rows);
end;
$$;

revoke all on function public.admin_review_search_pattern(text) from public, anon, authenticated;
revoke all on function public.admin_book_review_page(text, text, integer) from public, anon;
revoke all on function public.admin_book_review_reply_page(text, text, integer) from public, anon;
grant execute on function public.admin_book_review_page(text, text, integer) to authenticated;
grant execute on function public.admin_book_review_reply_page(text, text, integer) to authenticated;

commit;
