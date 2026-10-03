-- Kutadgu Bilig — Stage 106 catalog credits
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI, an agent, or the browser.
-- Does not apply itself to production. Do not run production SQL from this task.
--
-- Deployment order:
-- 1. Apply this file once in the Supabase SQL editor on the live project.
-- 2. Read public.catalog_credit_review. Reading that table does not separate
--    any names. Those rows stay one identity until
--    STAGE106_CATALOG_CREDIT_CORRECTIONS.sql is applied for an exact match.
-- 3. Apply STAGE106_CATALOG_CREDIT_CORRECTIONS.sql, then run
--    apply_catalog_credit_corrections(). Unmapped review rows stay whole.
-- 4. Deploy the website after the SQL succeeds. The site keeps books.author,
--    books.translator, and books.publisher for the mobile app and other clients.
--
-- Rollback is STAGE106_CATALOG_CREDITS_ROLLBACK.sql, run by itself.
-- Rollback drops the new tables, functions, and trigger. It does not change
-- books.author, books.translator, books.publisher, RLS on books, or book rows.
--
-- Repeat-safe. A second run does not replace credits that already exist for a
-- book and role, so an explicit multi-person save is not collapsed.
-- Observed active-catalog separator on 2026-10-03 was U+060C Arabic comma.
-- This file does not split on that comma, on spaces, or on ۋە.

begin;

create extension if not exists pgcrypto;

create or replace function public.catalog_identity_key(p_name text)
returns text
language sql
immutable
as $$
  select case
    when cleaned = '' then null
    when cleaned in ('—', '–', '-', 'ئاپتور ئىسمى') then null
    when lower(cleaned) in ('undefined', 'null', 'unknown') then null
    else cleaned
  end
  from (
    select btrim(normalize(coalesce(p_name, ''), NFC)) as cleaned
  ) keyed;
$$;

create or replace function public.catalog_credit_legacy_ambiguous(p_name text)
returns boolean
language sql
immutable
as $$
  select public.catalog_identity_key(p_name) is not null
    and (
      coalesce(p_name, '') ~ '[،,;؛/|&+·•]'
      or coalesce(p_name, '') ~ E'[\n\r]'
      or coalesce(p_name, '') ~ '(^|[[:space:]])ۋە([[:space:]]|$)'
    );
$$;

create or replace function public.catalog_credit_legacy_join(p_names text[])
returns text
language sql
immutable
as $$
  select nullif(array_to_string(array(
    select public.catalog_identity_key(item.name)
    from unnest(coalesce(p_names, array[]::text[])) with ordinality as item(name, ord)
    where public.catalog_identity_key(item.name) is not null
    order by item.ord
  ), '، '), '');
$$;

create table if not exists public.catalog_identities (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  name_key text not null,
  created_at timestamptz not null default now(),
  constraint catalog_identities_display_len check (char_length(btrim(display_name)) between 1 and 500),
  constraint catalog_identities_name_key_len check (char_length(name_key) between 1 and 500),
  constraint catalog_identities_name_key_unique unique (name_key)
);

create table if not exists public.book_credits (
  book_id bigint not null references public.books(id) on delete cascade,
  identity_id uuid not null references public.catalog_identities(id) on delete restrict,
  role text not null,
  position smallint not null,
  constraint book_credits_role_chk check (role in ('author', 'translator', 'publisher')),
  constraint book_credits_position_chk check (position >= 0 and position < 8),
  constraint book_credits_pk primary key (book_id, role, position),
  constraint book_credits_identity_role_unique unique (book_id, identity_id, role)
);

create unique index if not exists book_credits_one_publisher_idx
  on public.book_credits (book_id)
  where role = 'publisher';

create index if not exists book_credits_identity_role_book_idx
  on public.book_credits (identity_id, role, book_id);

create table if not exists public.catalog_credit_review (
  id bigint generated always as identity primary key,
  book_id bigint not null references public.books(id) on delete cascade,
  role text not null,
  legacy_value text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint catalog_credit_review_role_chk check (role in ('author', 'translator', 'publisher')),
  constraint catalog_credit_review_reason_chk check (reason in ('legacy-value-not-split')),
  constraint catalog_credit_review_unique unique (book_id, role, legacy_value)
);

comment on table public.catalog_identities is
  'One display identity. The same row can be an author on one book and a translator on another.';
comment on table public.book_credits is
  'Role-specific book links. Position is the saved order. Matching is by identity id, not substring search.';
comment on table public.catalog_credit_review is
  'Legacy strings that look like more than one name and were stored as one identity for review.';

create or replace function public.catalog_write_role_credits(
  p_book_id bigint,
  p_role text,
  p_names jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $write$
declare
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_count integer := 0;
  v_index integer;
  v_raw text;
  v_key text;
  v_seen text[] := array[]::text[];
  v_keys text[] := array[]::text[];
  v_identity uuid;
  v_join text;
begin
  perform set_config('kutadgu.credit_write', 'explicit', true);
  if v_role not in ('author', 'translator', 'publisher') then
    raise exception 'credit role is invalid' using errcode = '22023';
  end if;
  if p_names is null or jsonb_typeof(p_names) is distinct from 'array' then
    raise exception 'credit names must be a JSON array' using errcode = '22023';
  end if;
  if not exists (select 1 from public.books where id = p_book_id) then
    raise exception 'book not found' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_names);
  if v_count > 8 then
    raise exception 'too many credit names' using errcode = '22023';
  end if;
  if v_role = 'publisher' and v_count > 1 then
    raise exception 'publisher accepts one name' using errcode = '22023';
  end if;
  if v_role = 'author' and v_count = 0 then
    raise exception 'author name is required' using errcode = '22023';
  end if;

  for v_index in 0 .. greatest(v_count - 1, -1) loop
    if jsonb_typeof(p_names->v_index) is distinct from 'string' then
      raise exception 'credit names must be strings' using errcode = '22023';
    end if;
    v_raw := p_names->>v_index;
    v_key := public.catalog_identity_key(v_raw);
    if v_key is null then
      continue;
    end if;
    if char_length(v_key) > 500 then
      raise exception 'credit name is too long' using errcode = '22023';
    end if;
    if v_key = any(v_seen) then
      raise exception 'duplicate credit name' using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;
    v_keys := v_keys || v_key;
  end loop;

  if v_role = 'author' and coalesce(array_length(v_keys, 1), 0) = 0 then
    raise exception 'author name is required' using errcode = '22023';
  end if;
  if v_role = 'publisher' and coalesce(array_length(v_keys, 1), 0) > 1 then
    raise exception 'publisher accepts one name' using errcode = '22023';
  end if;

  -- Books row first, then credit rows. Approval updates books and does not
  -- touch book_credits, so it waits on this same row lock.
  perform 1
  from public.books
  where id = p_book_id
  for update;

  delete from public.book_credits
  where book_id = p_book_id and role = v_role;
  delete from public.catalog_credit_review
  where book_id = p_book_id and role = v_role;

  for v_index in 1 .. coalesce(array_length(v_keys, 1), 0) loop
    v_key := v_keys[v_index];
    insert into public.catalog_identities (display_name, name_key)
    values (v_key, v_key)
    on conflict (name_key) do nothing;
    select id into v_identity
    from public.catalog_identities
    where name_key = v_key;
    insert into public.book_credits (book_id, identity_id, role, position)
    values (p_book_id, v_identity, v_role, (v_index - 1)::smallint);
  end loop;

  if coalesce(array_length(v_keys, 1), 0) = 1
     and public.catalog_credit_legacy_ambiguous(v_keys[1]) then
    insert into public.catalog_credit_review (book_id, role, legacy_value, reason)
    values (p_book_id, v_role, v_keys[1], 'legacy-value-not-split')
    on conflict (book_id, role, legacy_value) do nothing;
  end if;

  v_join := public.catalog_credit_legacy_join(v_keys);
  if v_role = 'author' then
    update public.books
    set author = coalesce(v_join, '')
    where id = p_book_id;
  elsif v_role = 'translator' then
    update public.books
    set translator = v_join
    where id = p_book_id;
  else
    update public.books
    set publisher = v_join
    where id = p_book_id;
  end if;
end;
$write$;

create or replace function public.catalog_sync_role_from_legacy(
  p_book_id bigint,
  p_role text,
  p_old text,
  p_new text
)
returns void
language plpgsql
security definer
set search_path = public
as $sync$
declare
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_new_key text := public.catalog_identity_key(p_new);
  v_current text[];
  v_current_join text;
  v_identity uuid;
begin
  if coalesce(current_setting('kutadgu.credit_write', true), '') = 'explicit' then
    return;
  end if;
  if v_role not in ('author', 'translator', 'publisher') then
    return;
  end if;
  if p_old is not distinct from p_new then
    return;
  end if;

  select coalesce(array_agg(i.display_name order by c.position), array[]::text[])
  into v_current
  from public.book_credits c
  join public.catalog_identities i on i.id = c.identity_id
  where c.book_id = p_book_id and c.role = v_role;
  v_current_join := public.catalog_credit_legacy_join(v_current);
  if v_new_key is not distinct from v_current_join then
    return;
  end if;

  -- An ambiguous legacy string is not one person. A text write must not
  -- replace separate contributors with one combined identity. Reading
  -- catalog_credit_review does not split it. The reviewed correction file
  -- matches the whole string and writes the ordered names in one transaction.
  if public.catalog_credit_legacy_ambiguous(p_new) then
    if v_new_key is not null then
      insert into public.catalog_credit_review (book_id, role, legacy_value, reason)
      values (p_book_id, v_role, v_new_key, 'legacy-value-not-split')
      on conflict (book_id, role, legacy_value) do nothing;
    end if;
    return;
  end if;

  delete from public.book_credits
  where book_id = p_book_id and role = v_role;
  delete from public.catalog_credit_review
  where book_id = p_book_id and role = v_role;

  if v_new_key is null then
    return;
  end if;

  insert into public.catalog_identities (display_name, name_key)
  values (v_new_key, v_new_key)
  on conflict (name_key) do nothing;
  select id into v_identity
  from public.catalog_identities
  where name_key = v_new_key;
  insert into public.book_credits (book_id, identity_id, role, position)
  values (p_book_id, v_identity, v_role, 0);
  if public.catalog_credit_legacy_ambiguous(p_new) then
    insert into public.catalog_credit_review (book_id, role, legacy_value, reason)
    values (p_book_id, v_role, v_new_key, 'legacy-value-not-split')
    on conflict (book_id, role, legacy_value) do nothing;
  end if;
end;
$sync$;

create or replace function public.books_catalog_credits_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $trigger$
begin
  if coalesce(current_setting('kutadgu.credit_write', true), '') = 'explicit' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.catalog_sync_role_from_legacy(new.id, 'author', null, new.author);
    perform public.catalog_sync_role_from_legacy(new.id, 'translator', null, new.translator);
    perform public.catalog_sync_role_from_legacy(new.id, 'publisher', null, new.publisher);
    return new;
  end if;
  if old.author is distinct from new.author then
    perform public.catalog_sync_role_from_legacy(new.id, 'author', old.author, new.author);
  end if;
  if old.translator is distinct from new.translator then
    perform public.catalog_sync_role_from_legacy(new.id, 'translator', old.translator, new.translator);
  end if;
  if old.publisher is distinct from new.publisher then
    perform public.catalog_sync_role_from_legacy(new.id, 'publisher', old.publisher, new.publisher);
  end if;
  return new;
end;
$trigger$;

create or replace function public.set_book_credits(
  p_book_id bigint,
  p_authors jsonb,
  p_translators jsonb,
  p_publisher text
)
returns void
language plpgsql
security definer
set search_path = public
as $admin$
declare
  v_publisher jsonb;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;
  if p_publisher is null or btrim(p_publisher) = '' then
    v_publisher := '[]'::jsonb;
  else
    v_publisher := jsonb_build_array(p_publisher);
  end if;
  perform public.catalog_write_role_credits(p_book_id, 'author', coalesce(p_authors, '[]'::jsonb));
  perform public.catalog_write_role_credits(p_book_id, 'translator', coalesce(p_translators, '[]'::jsonb));
  perform public.catalog_write_role_credits(p_book_id, 'publisher', v_publisher);
end;
$admin$;

create or replace function public.set_own_pending_book_credits(
  p_book_id bigint,
  p_authors jsonb,
  p_translators jsonb,
  p_publisher text
)
returns void
language plpgsql
security definer
set search_path = public
as $staff$
declare
  v_owner uuid;
  v_status text;
  v_publisher jsonb;
begin
  if not public.is_kutadgu_book_staff() then
    raise exception 'Book staff permission required' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;
  select submitted_by, submission_status
  into v_owner, v_status
  from public.books
  where id = p_book_id
  for update;
  if v_owner is distinct from auth.uid() or v_status is distinct from 'pending' then
    raise exception 'Pending book permission required' using errcode = '42501';
  end if;
  if p_publisher is null or btrim(p_publisher) = '' then
    v_publisher := '[]'::jsonb;
  else
    v_publisher := jsonb_build_array(p_publisher);
  end if;
  perform public.catalog_write_role_credits(p_book_id, 'author', coalesce(p_authors, '[]'::jsonb));
  perform public.catalog_write_role_credits(p_book_id, 'translator', coalesce(p_translators, '[]'::jsonb));
  perform public.catalog_write_role_credits(p_book_id, 'publisher', v_publisher);
end;
$staff$;

revoke all on function public.catalog_identity_key(text) from public, anon, authenticated;
revoke all on function public.catalog_credit_legacy_ambiguous(text) from public, anon, authenticated;
revoke all on function public.catalog_credit_legacy_join(text[]) from public, anon, authenticated;
revoke all on function public.catalog_write_role_credits(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.catalog_sync_role_from_legacy(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.books_catalog_credits_sync() from public, anon, authenticated;
revoke all on function public.set_book_credits(bigint, jsonb, jsonb, text) from public, anon;
revoke all on function public.set_own_pending_book_credits(bigint, jsonb, jsonb, text) from public, anon;
grant execute on function public.set_book_credits(bigint, jsonb, jsonb, text) to authenticated;
grant execute on function public.set_own_pending_book_credits(bigint, jsonb, jsonb, text) to authenticated;

insert into public.catalog_identities (display_name, name_key)
select distinct on (keyed.name_key) keyed.name_key, keyed.name_key
from (
  select public.catalog_identity_key(author) as name_key from public.books
  union all
  select public.catalog_identity_key(translator) from public.books
  union all
  select public.catalog_identity_key(publisher) from public.books
) keyed
where keyed.name_key is not null
order by keyed.name_key
on conflict (name_key) do nothing;

insert into public.book_credits (book_id, identity_id, role, position)
select b.id, i.id, 'author', 0
from public.books b
join public.catalog_identities i on i.name_key = public.catalog_identity_key(b.author)
where public.catalog_identity_key(b.author) is not null
  and not exists (
    select 1 from public.book_credits c
    where c.book_id = b.id and c.role = 'author'
  );

insert into public.book_credits (book_id, identity_id, role, position)
select b.id, i.id, 'translator', 0
from public.books b
join public.catalog_identities i on i.name_key = public.catalog_identity_key(b.translator)
where public.catalog_identity_key(b.translator) is not null
  and not exists (
    select 1 from public.book_credits c
    where c.book_id = b.id and c.role = 'translator'
  );

insert into public.book_credits (book_id, identity_id, role, position)
select b.id, i.id, 'publisher', 0
from public.books b
join public.catalog_identities i on i.name_key = public.catalog_identity_key(b.publisher)
where public.catalog_identity_key(b.publisher) is not null
  and not exists (
    select 1 from public.book_credits c
    where c.book_id = b.id and c.role = 'publisher'
  );

insert into public.catalog_credit_review (book_id, role, legacy_value, reason)
select b.id, 'author', public.catalog_identity_key(b.author), 'legacy-value-not-split'
from public.books b
where public.catalog_credit_legacy_ambiguous(b.author)
on conflict (book_id, role, legacy_value) do nothing;

insert into public.catalog_credit_review (book_id, role, legacy_value, reason)
select b.id, 'translator', public.catalog_identity_key(b.translator), 'legacy-value-not-split'
from public.books b
where public.catalog_credit_legacy_ambiguous(b.translator)
on conflict (book_id, role, legacy_value) do nothing;

insert into public.catalog_credit_review (book_id, role, legacy_value, reason)
select b.id, 'publisher', public.catalog_identity_key(b.publisher), 'legacy-value-not-split'
from public.books b
where public.catalog_credit_legacy_ambiguous(b.publisher)
on conflict (book_id, role, legacy_value) do nothing;

drop trigger if exists books_catalog_credits_sync on public.books;
create trigger books_catalog_credits_sync
after insert or update of author, translator, publisher on public.books
for each row
execute function public.books_catalog_credits_sync();

alter table public.catalog_identities enable row level security;
alter table public.catalog_identities force row level security;
alter table public.book_credits enable row level security;
alter table public.book_credits force row level security;
alter table public.catalog_credit_review enable row level security;
alter table public.catalog_credit_review force row level security;

drop policy if exists "public reads linked catalog identities" on public.catalog_identities;
create policy "public reads linked catalog identities"
on public.catalog_identities
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.book_credits c
    join public.books b on b.id = c.book_id
    where c.identity_id = catalog_identities.id
      and b.is_active = true
  )
);

-- Anonymous users cannot execute is_kutadgu_admin(). Keep the admin-only
-- predicate in a policy restricted to authenticated so public reads work.
drop policy if exists "admin aal2 reads all catalog identities" on public.catalog_identities;
create policy "admin aal2 reads all catalog identities"
on public.catalog_identities
for select
to authenticated
using (
  public.is_kutadgu_admin()
  and (select auth.jwt()->>'aal') = 'aal2'
);

drop policy if exists "public reads credits of active books" on public.book_credits;
create policy "public reads credits of active books"
on public.book_credits
for select
to anon, authenticated
using (
  exists (
    select 1 from public.books b
    where b.id = book_credits.book_id
      and b.is_active = true
  )
);

drop policy if exists "admin aal2 reads all book credits" on public.book_credits;
create policy "admin aal2 reads all book credits"
on public.book_credits
for select
to authenticated
using (
  public.is_kutadgu_admin()
  and (select auth.jwt()->>'aal') = 'aal2'
);

drop policy if exists "admin aal2 reads credit review" on public.catalog_credit_review;
create policy "admin aal2 reads credit review"
on public.catalog_credit_review
for select
to authenticated
using (
  public.is_kutadgu_admin()
  and (select auth.jwt()->>'aal') = 'aal2'
);

revoke all on table public.catalog_identities from public, anon, authenticated;
revoke all on table public.book_credits from public, anon, authenticated;
revoke all on table public.catalog_credit_review from public, anon, authenticated;
grant select on table public.catalog_identities to anon, authenticated;
grant select on table public.book_credits to anon, authenticated;
grant select on table public.catalog_credit_review to authenticated;

commit;
