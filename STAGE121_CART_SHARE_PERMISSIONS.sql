-- Account-controlled cart-link creation.
-- Apply manually after review, after STAGE105_SHARED_CART_LINKS.sql and
-- after is_kutadgu_admin() exists. This file does not run in CI and does not
-- change STAGE105, STAGE113, or STAGE120.
-- Default: global sharing off, and no individual grant.
-- Effective permission is an active profile and (global mode or a saved grant).
-- Guests, missing profiles, and suspended profiles are never allowed.
-- Global mode does not write or clear saved grants.
-- create_shared_cart_link stays service_role only. Authenticated creation is
-- create_member_shared_cart_link, which uses auth.uid() from the verified JWT.
-- The permission check and the insert run in one transaction. Both that
-- function and the admin writes take advisory lock 841211211 first, so a
-- revoke or a global-mode change cannot commit between the check and the insert.
-- Link rows stay code, items, created_at, and expires_at. No account id is stored.
-- Reapplying this file keeps cart_share_settings and cart_share_grants.
-- Rollback is STAGE121_CART_SHARE_PERMISSIONS_ROLLBACK.sql.
-- That rollback drops these functions and the two permission tables.
-- It deletes saved grants and the global flag. It does not delete shared_cart_links.
-- Release order: apply this file before deploying the worker that calls
-- create_member_shared_cart_link. Until both are live, creation fails closed.
-- Recipients of existing short and legacy links do not need this permission.

begin;

create table if not exists public.cart_share_settings (
  id smallint primary key,
  global_enabled boolean not null default false,
  constraint cart_share_settings_singleton check (id = 1)
);

create table if not exists public.cart_share_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted boolean not null,
  updated_at timestamptz not null default now()
);

comment on table public.cart_share_settings is
  'Cart-link creation switch. One row. Members cannot read or write it.';

comment on table public.cart_share_grants is
  'Saved per-member cart-link grants. Not a profile column. Members cannot read or write rows.';

alter table public.cart_share_settings enable row level security;
alter table public.cart_share_settings force row level security;
alter table public.cart_share_grants enable row level security;
alter table public.cart_share_grants force row level security;

revoke all on table public.cart_share_settings from public, anon, authenticated, service_role;
revoke all on table public.cart_share_grants from public, anon, authenticated, service_role;

insert into public.cart_share_settings (id, global_enabled)
values (1, false)
on conflict (id) do nothing;

create or replace function public.my_cart_share_permission()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_global boolean;
  v_granted boolean;
begin
  if v_uid is null then
    return false;
  end if;
  select p.status into v_status
  from public.profiles p
  where p.id = v_uid;
  if not found or v_status is distinct from 'active' then
    return false;
  end if;
  select s.global_enabled into v_global
  from public.cart_share_settings s
  where s.id = 1;
  if not found then
    return false;
  end if;
  select g.granted into v_granted
  from public.cart_share_grants g
  where g.user_id = v_uid;
  return coalesce(v_global, false) or coalesce(v_granted, false);
end;
$$;

create or replace function public.admin_cart_share_state(p_user_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_global boolean;
  v_self_granted boolean;
  v_eligible boolean := false;
  v_grants jsonb;
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_user_ids), 0) > 20 then
    raise exception 'Invalid cart share page' using errcode = '22023';
  end if;
  select s.global_enabled into v_global
  from public.cart_share_settings s
  where s.id = 1;
  if not found then
    v_global := false;
  end if;
  select p.status into v_status
  from public.profiles p
  where p.id = v_uid;
  v_eligible := found and v_status is not distinct from 'active';
  select g.granted into v_self_granted
  from public.cart_share_grants g
  where g.user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ids.id,
    'granted', coalesce(g.granted, false)
  )), '[]'::jsonb)
  into v_grants
  from (
    select distinct requested.id
    from unnest(coalesce(p_user_ids, array[]::uuid[])) as requested(id)
    where requested.id is not null
  ) ids
  left join public.cart_share_grants g on g.user_id = ids.id;

  return jsonb_build_object(
    'global_enabled', coalesce(v_global, false),
    'self_id', v_uid,
    'self_granted', coalesce(v_self_granted, false),
    'self_eligible', v_eligible,
    'grants', v_grants
  );
end;
$$;

create or replace function public.admin_set_cart_share_global(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(841211211);
  update public.cart_share_settings
     set global_enabled = v_enabled
   where id = 1;
  if not found then
    raise exception 'Cart share settings are missing' using errcode = '55000';
  end if;
  return jsonb_build_object('global_enabled', v_enabled);
end;
$$;

create or replace function public.admin_set_cart_share_grant(p_user_id uuid, p_granted boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_granted boolean := coalesce(p_granted, false);
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'Member id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Member id is required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(841211211);
  insert into public.cart_share_grants (user_id, granted, updated_at)
  values (p_user_id, v_granted, now())
  on conflict (user_id) do update
    set granted = excluded.granted,
        updated_at = now();
  return jsonb_build_object('user_id', p_user_id, 'granted', v_granted);
end;
$$;

create or replace function public.create_member_shared_cart_link(
  p_code text,
  p_items jsonb,
  p_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_global boolean;
  v_granted boolean;
  recent_count integer;
  day_count integer;
begin
  if v_uid is null then
    return 'denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(841211211);

  select p.status into v_status
  from public.profiles p
  where p.id = v_uid
  for update;
  if not found or v_status is distinct from 'active' then
    return 'denied';
  end if;

  select s.global_enabled into v_global
  from public.cart_share_settings s
  where s.id = 1
  for update;
  if not found then
    return 'denied';
  end if;

  select g.granted into v_granted
  from public.cart_share_grants g
  where g.user_id = v_uid
  for update;

  if coalesce(v_global, false) is not true and coalesce(v_granted, false) is not true then
    return 'denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(841050105);

  if p_code is null
    or p_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$'
    or p_expires_at is null
    or p_expires_at <= now()
    or not public.shared_cart_items_valid(p_items) then
    return 'invalid';
  end if;

  select count(*)::integer into recent_count
    from public.shared_cart_links
   where created_at > now() - interval '10 minutes';

  if recent_count >= 300 then
    return 'rate_limited';
  end if;

  select count(*)::integer into day_count
    from public.shared_cart_links
   where created_at > now() - interval '24 hours';

  if day_count >= 1000 then
    return 'rate_limited';
  end if;

  delete from public.shared_cart_links
   where expires_at <= now();

  insert into public.shared_cart_links (code, items, expires_at)
  values (p_code, p_items, p_expires_at);

  return 'ok';
exception
  when unique_violation then
    return 'conflict';
end;
$$;

revoke all on function public.my_cart_share_permission() from public, anon, authenticated, service_role;
revoke all on function public.admin_cart_share_state(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_cart_share_global(boolean) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_cart_share_grant(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.create_member_shared_cart_link(text, jsonb, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.my_cart_share_permission() to authenticated;
grant execute on function public.admin_cart_share_state(uuid[]) to authenticated;
grant execute on function public.admin_set_cart_share_global(boolean) to authenticated;
grant execute on function public.admin_set_cart_share_grant(uuid, boolean) to authenticated;
grant execute on function public.create_member_shared_cart_link(text, jsonb, timestamptz) to authenticated;

commit;
