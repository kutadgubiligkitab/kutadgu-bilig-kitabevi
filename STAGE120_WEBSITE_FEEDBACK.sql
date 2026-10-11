-- Members-only private website feedback.
-- Apply manually after review. This file does not run in CI.
-- Anonymous and ordinary members cannot read the table.
-- Eligible members submit only as auth.uid().
-- Admin reads require is_kutadgu_admin() and JWT aal exactly aal2.
-- Rollback is STAGE120_WEBSITE_FEEDBACK_ROLLBACK.sql.
-- That rollback drops public.website_feedback and deletes every stored message.
-- It does not change profiles, reviews, carts, or analytics.

begin;

create table if not exists public.website_feedback (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint website_feedback_body_check check (
    char_length(body) between 1 and 2000
    and body = btrim(body, E' \t\n\r\f')
  )
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
  v_text text := btrim(coalesce(p_body, ''), E' \t\n\r\f');
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

create or replace function public.admin_website_feedback_page(p_page integer)
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
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if p_page is null or p_page < 0 or p_page > 100000 then
    raise exception 'Invalid feedback page' using errcode = '22023';
  end if;

  with counted as (
    select count(*)::integer as total from public.website_feedback
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
    from public.website_feedback f
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

  return jsonb_build_object('total', v_total, 'page', v_page, 'rows', v_rows);
end;
$$;

revoke all on function public.submit_website_feedback(uuid, text) from public, anon;
revoke all on function public.admin_website_feedback_page(integer) from public, anon;
grant execute on function public.submit_website_feedback(uuid, text) to authenticated;
grant execute on function public.admin_website_feedback_page(integer) to authenticated;

commit;
