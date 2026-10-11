-- Members-only private website feedback.
-- Apply manually after review. This file does not run in CI.
-- Anonymous and ordinary members cannot read the table.
-- Eligible members submit only as auth.uid().
-- Admin reads require is_kutadgu_admin() and JWT aal exactly aal2.
-- The 2,000 limit is Unicode code points, matching char_length and the browser counter.
-- website_feedback_normalize trims the same edge whitespace the browser trims:
-- tab, LF, VT, FF, CR, space, U+0085, NBSP, Ogham space, U+2000–U+200A,
-- line and paragraph separators, narrow NBSP, medium mathematical space,
-- ideographic space, and BOM. Internal spaces and line breaks stay.
-- Page 0 may omit a cursor and returns bound_at/bound_id of the newest row.
-- Later pages pass that pair. Rows created after it stay out of that walk
-- and appear on the next unbounded page 0. Offset paging without the cursor
-- can repeat a row and skip an older one when a newer row arrives.
-- Rollback is STAGE120_WEBSITE_FEEDBACK_ROLLBACK.sql.
-- That rollback drops public.website_feedback and deletes every stored message.
-- It does not change profiles, reviews, carts, or analytics.

begin;

create or replace function public.website_feedback_normalize(p_body text)
returns text
language plpgsql
immutable
as $$
declare
  v_ws text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
    || chr(133) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197)
    || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
begin
  return regexp_replace(
    coalesce(p_body, ''),
    '^[' || v_ws || ']+|[' || v_ws || ']+$',
    '',
    'g'
  );
end;
$$;

revoke all on function public.website_feedback_normalize(text) from public, anon, authenticated, service_role;

create table if not exists public.website_feedback (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint website_feedback_body_check check (
    char_length(body) between 1 and 2000
    and body = public.website_feedback_normalize(body)
  )
);

alter table public.website_feedback drop constraint if exists website_feedback_body_check;
alter table public.website_feedback add constraint website_feedback_body_check check (
  char_length(body) between 1 and 2000
  and body = public.website_feedback_normalize(body)
);

comment on table public.website_feedback is
  'Private member suggestions. Members cannot read rows. Admins read them only through admin_website_feedback_page.';

create index if not exists website_feedback_newest_idx
  on public.website_feedback (created_at desc, id desc);

alter table public.website_feedback enable row level security;
alter table public.website_feedback force row level security;

revoke all on table public.website_feedback from public, anon, authenticated, service_role;

create or replace function public.submit_website_feedback(p_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := public.website_feedback_normalize(p_body);
  v_status text;
  v_user uuid;
  v_body text;
  v_created timestamptz;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Feedback id is required' using errcode = '22023';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then
    raise exception 'Feedback text is empty or too long' using errcode = '22023';
  end if;
  select p.status into v_status
  from public.profiles p
  where p.id = v_uid;
  if not found or v_status is distinct from 'active' then
    raise exception 'Member permission required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_id::text)::bigint);

  select f.user_id, f.body, f.created_at
    into v_user, v_body, v_created
  from public.website_feedback f
  where f.id = p_id;

  if found then
    if v_user = v_uid and v_body = v_text then
      return jsonb_build_object('id', p_id, 'created_at', v_created, 'replayed', true);
    end if;
    raise exception 'Feedback submission does not match' using errcode = '23505';
  end if;

  begin
    insert into public.website_feedback (id, user_id, body)
    values (p_id, v_uid, v_text)
    returning created_at into v_created;
  exception
    when unique_violation then
      select f.user_id, f.body, f.created_at
        into v_user, v_body, v_created
      from public.website_feedback f
      where f.id = p_id;
      if v_user = v_uid and v_body = v_text then
        return jsonb_build_object('id', p_id, 'created_at', v_created, 'replayed', true);
      end if;
      raise exception 'Feedback submission does not match' using errcode = '23505';
  end;

  return jsonb_build_object('id', p_id, 'created_at', v_created, 'replayed', false);
end;
$$;

drop function if exists public.admin_website_feedback_page(integer);
drop function if exists public.admin_website_feedback_page(integer, timestamptz, uuid);

create function public.admin_website_feedback_page(
  p_page integer,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_page integer;
  v_rows jsonb;
  v_bound_at timestamptz := p_before;
  v_bound_id uuid := p_before_id;
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if p_page is null or p_page < 0 or p_page > 100000 then
    raise exception 'Invalid feedback page' using errcode = '22023';
  end if;
  if (p_before is null) is distinct from (p_before_id is null) then
    raise exception 'Invalid feedback page' using errcode = '22023';
  end if;
  if p_before is null then
    select f.created_at, f.id
      into v_bound_at, v_bound_id
    from public.website_feedback f
    order by f.created_at desc, f.id desc
    limit 1;
  end if;

  with bounded as (
    select
      f.id,
      f.body,
      f.created_at,
      f.user_id
    from public.website_feedback f
    where p_before is null
       or f.created_at < p_before
       or (f.created_at = p_before and f.id <= p_before_id)
  ),
  counted as (
    select count(*)::integer as total from bounded
  ),
  chosen as (
    select total,
      case when total = 0 then 0 else least(p_page, (total - 1) / 10) end as page
    from counted
  ),
  page_rows as (
    select
      f.id,
      f.body,
      f.created_at,
      case
        when btrim(coalesce(p.full_name, '')) <> '' then btrim(p.full_name)
        when btrim(coalesce(p.email, '')) <> '' then btrim(p.email)
        else 'ئەزا'
      end as member_label
    from bounded f
    left join public.profiles p on p.id = f.user_id
    order by f.created_at desc, f.id desc
    offset ((select page from chosen) * 10)
    limit 10
  )
  select chosen.total, chosen.page,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'body', page_rows.body,
        'created_at', page_rows.created_at,
        'member_label', page_rows.member_label
      ) order by page_rows.created_at desc, page_rows.id desc)
      from page_rows
    ), '[]'::jsonb)
  into v_total, v_page, v_rows
  from chosen;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'rows', v_rows,
    'bound_at', v_bound_at,
    'bound_id', v_bound_id
  );
end;
$$;

revoke all on function public.submit_website_feedback(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_website_feedback_page(integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.submit_website_feedback(uuid, text) to authenticated;
grant execute on function public.admin_website_feedback_page(integer, timestamptz, uuid) to authenticated;

commit;
