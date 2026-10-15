-- Latest authenticated visit country for the admin member directory.
-- Separate from profiles.country. No history and no backfill.
-- Apply after STAGE113_ADMIN_MEMBER_DIRECTORY.sql. Not applied by this file's presence.

begin;

create table if not exists public.member_last_visit (
  user_id uuid primary key references auth.users (id) on delete cascade,
  country text,
  observed_at timestamptz not null,
  constraint member_last_visit_country_chk check (
    country is null or (country ~ '^[A-Z]{2}$' and country <> 'XX')
  )
);

alter table public.member_last_visit enable row level security;
alter table public.member_last_visit force row level security;

revoke all on table public.member_last_visit from public, anon, authenticated, service_role;

create or replace function public.record_member_last_visit(
  p_user_id uuid,
  p_page text,
  p_country text,
  p_observed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_page text;
  v_existing timestamptz;
  v_seen timestamptz;
  v_latest timestamptz;
begin
  if p_user_id is null or p_observed_at is null then
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    return;
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.status = 'suspended'
  ) then
    return;
  end if;

  perform pg_advisory_xact_lock(842124, hashtext(p_user_id::text));

  v_country := upper(btrim(coalesce(p_country, '')));
  if v_country !~ '^[A-Z]{2}$' or v_country = 'XX' then
    v_country := null;
  end if;
  v_page := left(coalesce(p_page, ''), 500);

  select observed_at into v_existing
  from public.member_last_visit
  where user_id = p_user_id
  for update;

  select last_seen_at into v_seen
  from public.profiles
  where id = p_user_id
  for update;

  v_latest := v_existing;
  if v_seen is not null and (v_latest is null or v_seen > v_latest) then
    v_latest := v_seen;
  end if;

  if v_latest is null or v_latest < p_observed_at then
    insert into public.member_last_visit (user_id, country, observed_at)
    values (p_user_id, v_country, p_observed_at)
    on conflict (user_id) do update
      set country = excluded.country,
          observed_at = excluded.observed_at;
    insert into public.profiles (id, email, last_seen_at, visit_count, last_page)
    select p_user_id, coalesce(u.email, ''), p_observed_at, 1, v_page
    from auth.users u
    where u.id = p_user_id
    on conflict (id) do update
      set last_seen_at = excluded.last_seen_at,
          visit_count = public.profiles.visit_count + 1,
          last_page = excluded.last_page,
          updated_at = p_observed_at;
  else
    update public.profiles
      set visit_count = public.profiles.visit_count + 1
      where id = p_user_id;
  end if;
end;
$$;

revoke all on function public.record_member_last_visit(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_member_last_visit(uuid, text, text, timestamptz) to service_role;

-- Cached clients still call record_member_visit(text). A newer legacy visit has no
-- country evidence, so it clears the displayed country. An older call only counts.

create or replace function public.record_member_visit(page_path text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_now timestamptz;
  v_page text;
  v_existing timestamptz;
  v_seen timestamptz;
  v_latest timestamptz;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_user) then
    return;
  end if;
  v_now := now();
  v_page := left(coalesce(page_path, ''), 500);
  perform pg_advisory_xact_lock(842124, hashtext(v_user::text));

  select observed_at into v_existing
  from public.member_last_visit
  where user_id = v_user
  for update;

  select last_seen_at into v_seen
  from public.profiles
  where id = v_user
  for update;

  v_latest := v_existing;
  if v_seen is not null and (v_latest is null or v_seen > v_latest) then
    v_latest := v_seen;
  end if;

  if v_latest is null or v_latest < v_now then
    insert into public.member_last_visit (user_id, country, observed_at)
    values (v_user, null, v_now)
    on conflict (user_id) do update
      set country = null,
          observed_at = excluded.observed_at;
    insert into public.profiles (id, email, last_seen_at, visit_count, last_page)
    select v_user, coalesce(u.email, ''), v_now, 1, v_page
    from auth.users u
    where u.id = v_user
    on conflict (id) do update
      set last_seen_at = excluded.last_seen_at,
          visit_count = public.profiles.visit_count + 1,
          last_page = excluded.last_page,
          updated_at = v_now;
  else
    update public.profiles
      set visit_count = public.profiles.visit_count + 1
      where id = v_user;
  end if;
end;
$$;

revoke all on function public.record_member_visit(text) from public, anon;
grant execute on function public.record_member_visit(text) to authenticated;

-- Paged admin member directory. The last-visit fields are not searchable.
-- A country is shown only when that visit is still the latest profile activity.

create or replace function public.admin_member_directory_page(
  p_query text,
  p_status text,
  p_cart text,
  p_page integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text;
  v_like text;
  v_status text;
  v_cart text;
  v_page integer;
  v_offset integer;
  v_result jsonb;
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  v_status := coalesce(p_status, '');
  v_cart := coalesce(p_cart, '');
  if v_status not in ('all', 'active', 'suspended') or v_cart not in ('all', 'with_items') then
    raise exception 'Invalid member filter' using errcode = '22023';
  end if;
  v_page := least(greatest(coalesce(p_page, 0), 0), 100000);
  v_offset := v_page * 20;
  v_query := left(btrim(coalesce(p_query, '')), 80);
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with filtered as (
    select p.id
    from public.profiles p
    where p.id is distinct from auth.uid()
      and (
        v_status = 'all'
        or (v_status = 'suspended' and p.status = 'suspended')
        or (v_status = 'active' and p.status is distinct from 'suspended')
      )
      and (
        v_cart = 'all'
        or exists (
          select 1 from public.member_cart_items c where c.user_id = p.id
        )
      )
      and (
        v_query = ''
        or coalesce(p.full_name, '') ilike v_like escape '\'
        or coalesce(p.email, '') ilike v_like escape '\'
        or coalesce(p.phone, '') ilike v_like escape '\'
        or coalesce(p.country, '') ilike v_like escape '\'
        or coalesce(p.city, '') ilike v_like escape '\'
      )
  ),
  page_ids as (
    select p.id
    from public.profiles p
    join filtered f on f.id = p.id
    order by p.created_at desc nulls last, p.id desc
    offset v_offset
    limit 20
  ),
  page_rows as (
    select
      p.id,
      p.full_name,
      p.email,
      p.phone,
      p.country,
      p.city,
      p.status,
      p.created_at,
      p.last_login_at,
      p.last_seen_at,
      p.visit_count,
      p.last_page,
      case
        when lv.observed_at is not null and (p.last_seen_at is null or lv.observed_at >= p.last_seen_at)
        then lv.country
        else null
      end as last_visit_country,
      case
        when lv.observed_at is not null and (p.last_seen_at is null or lv.observed_at >= p.last_seen_at)
        then lv.observed_at
        else null
      end as last_visit_observed_at,
      coalesce(s.order_count, 0)::integer as order_count,
      coalesce(s.order_total, 0)::numeric as order_total
    from page_ids i
    join public.profiles p on p.id = i.id
    left join public.member_last_visit lv on lv.user_id = p.id
    left join lateral (
      select count(*)::integer as order_count,
             coalesce(sum(o.total), 0)::numeric as order_total
      from public.orders o
      where o.user_id = p.id
        and lower(btrim(o.status)) in ('confirmed', 'processing', 'shipped', 'completed')
    ) s on true
  ),
  directory_stats as (
    select
      (select count(*)::integer from public.profiles p where p.id is distinct from auth.uid()) as members,
      (select coalesce(sum(p.visit_count), 0)::bigint from public.profiles p where p.id is distinct from auth.uid()) as visits,
      (select count(*)::integer
         from public.orders o
         where o.user_id is distinct from auth.uid()
           and exists (select 1 from public.profiles p where p.id = o.user_id)
           and lower(btrim(o.status)) in ('confirmed', 'processing', 'shipped', 'completed')) as orders,
      (select coalesce(sum(o.total), 0)::numeric
         from public.orders o
         where o.user_id is distinct from auth.uid()
           and exists (select 1 from public.profiles p where p.id = o.user_id)
           and lower(btrim(o.status)) in ('confirmed', 'processing', 'shipped', 'completed')) as revenue
  )
  select jsonb_build_object(
    'total', (select count(*)::integer from filtered),
    'page', v_page,
    'page_size', 20,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page_rows) order by page_rows.created_at desc nulls last, page_rows.id desc)
      from page_rows
    ), '[]'::jsonb),
    'stats', (
      select jsonb_build_object(
        'members', members,
        'visits', visits,
        'orders', orders,
        'revenue', revenue
      )
      from directory_stats
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_member_directory_page(text, text, text, integer) from public, anon;
grant execute on function public.admin_member_directory_page(text, text, text, integer) to authenticated;

commit;
