-- Signup network country for the admin member directory.
-- Separate from profiles.country. No backfill. Not applied by this file's presence.
-- Apply after STAGE113_ADMIN_MEMBER_DIRECTORY.sql.

begin;

create table if not exists public.member_signup_country (
  user_id uuid primary key references auth.users (id) on delete cascade,
  country text not null,
  recorded_at timestamptz not null default now(),
  constraint member_signup_country_code_chk check (country ~ '^[A-Z]{2}$' and country <> 'XX')
);

alter table public.member_signup_country enable row level security;
alter table public.member_signup_country force row level security;

revoke all on table public.member_signup_country from public, anon, authenticated, service_role;

create or replace function public.record_member_signup_country(p_user_id uuid, p_country text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_created timestamptz;
begin
  v_country := upper(btrim(coalesce(p_country, '')));
  if p_user_id is null or v_country !~ '^[A-Z]{2}$' or v_country = 'XX' then
    return;
  end if;
  select u.created_at into v_created
  from auth.users u
  where u.id = p_user_id;
  -- Account age is not proof that this call created the user. The Worker
  -- calls this only for a signup response with an email identity created
  -- by that response. This window only refuses a stale id.
  if v_created is null
     or v_created < now() - interval '15 seconds'
     or v_created > now() + interval '10 seconds' then
    return;
  end if;
  insert into public.member_signup_country (user_id, country)
  values (p_user_id, v_country)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.record_member_signup_country(uuid, text) from public, anon, authenticated;
grant execute on function public.record_member_signup_country(uuid, text) to service_role;

-- Paged admin member directory. Search, suspension, and saved-cart filters
-- run before the 20-row page. signup_country is read here and is not searchable.

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
      sc.country as signup_country,
      coalesce(s.order_count, 0)::integer as order_count,
      coalesce(s.order_total, 0)::numeric as order_total
    from page_ids i
    join public.profiles p on p.id = i.id
    left join public.member_signup_country sc on sc.user_id = p.id
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
