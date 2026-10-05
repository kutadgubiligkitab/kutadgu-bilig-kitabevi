-- Hearts, one-level replies, and the shared 30-second submission interval.
-- Apply after STAGE108_BOOK_REVIEW_LIMITS_DELETE.sql.
-- A failed insert rolls back its interval claim.

begin;

create table if not exists public.book_review_submission_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  submitted_at timestamptz not null default clock_timestamp()
);

create index if not exists book_review_submission_log_member_idx
  on public.book_review_submission_log (user_id, submitted_at desc);

alter table public.book_review_submission_log enable row level security;
alter table public.book_review_submission_log force row level security;
revoke all on table public.book_review_submission_log from public, anon, authenticated;

create or replace function public.book_review_claim_submission_slot()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(88109, hashtext(auth.uid()::text));
  if exists (
    select 1
    from public.book_review_submission_log
    where user_id = auth.uid()
      and submitted_at > clock_timestamp() - interval '30 seconds'
  ) then
    raise exception 'submission interval' using errcode = 'P0501';
  end if;
  insert into public.book_review_submission_log (user_id) values (auth.uid());
end;
$$;

revoke all on function public.book_review_claim_submission_slot() from public, anon, authenticated;

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
  perform public.book_review_claim_submission_slot();
  return new;
end;
$$;

create table if not exists public.book_review_hearts (
  review_id uuid not null references public.book_reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

alter table public.book_review_hearts enable row level security;
alter table public.book_review_hearts force row level security;
revoke all on table public.book_review_hearts from public, anon, authenticated;

create or replace function public.add_book_review_heart(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.book_reviews r
    join public.books b on b.id = r.book_id
    where r.id = p_review_id
      and r.status = 'approved'
      and b.is_active = true
  ) then
    raise exception 'Review is not public' using errcode = '42501';
  end if;
  insert into public.book_review_hearts (review_id, user_id)
  values (p_review_id, auth.uid())
  on conflict (review_id, user_id) do nothing;
end;
$$;

create or replace function public.remove_book_review_heart(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  delete from public.book_review_hearts
  where review_id = p_review_id
    and user_id = auth.uid();
end;
$$;

create or replace function public.book_review_heart_summary(p_review_ids uuid[])
returns table (review_id uuid, heart_count bigint, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
    coalesce((
      select count(*)
      from public.book_review_hearts h
      where h.review_id = r.id
    ), 0),
    exists (
      select 1
      from public.book_review_hearts h
      where h.review_id = r.id
        and h.user_id = (select auth.uid())
    )
  from public.book_reviews r
  join public.books b on b.id = r.book_id
  where r.id = any(p_review_ids)
    and r.status = 'approved'
    and b.is_active = true;
$$;

revoke all on function public.add_book_review_heart(uuid) from public, anon;
revoke all on function public.remove_book_review_heart(uuid) from public, anon;
revoke all on function public.book_review_heart_summary(uuid[]) from public;
grant execute on function public.add_book_review_heart(uuid) to authenticated;
grant execute on function public.remove_book_review_heart(uuid) to authenticated;
grant execute on function public.book_review_heart_summary(uuid[]) to anon, authenticated;

create table if not exists public.book_review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.book_reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default 'ئەزا',
  body text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  constraint book_review_replies_status_chk check (status in ('pending', 'approved', 'rejected')),
  constraint book_review_replies_body_chk check (char_length(btrim(body)) between 1 and 500),
  constraint book_review_replies_display_name_chk check (
    char_length(btrim(display_name)) between 1 and 80
    and position('@' in display_name) = 0
  )
);

create index if not exists book_review_replies_review_idx
  on public.book_review_replies (review_id, created_at asc, id asc);

create or replace function public.book_review_replies_before_insert()
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
    select 1
    from public.book_reviews r
    join public.books b on b.id = r.book_id
    where r.id = new.review_id
      and r.status = 'approved'
      and b.is_active = true
  ) then
    raise exception 'Review is not public' using errcode = '42501';
  end if;
  new.user_id := auth.uid();
  new.status := 'pending';
  new.moderated_at := null;
  new.created_at := now();
  new.body := btrim(new.body);
  if new.body is null or char_length(new.body) < 1 or char_length(new.body) > 500 then
    raise exception 'Reply text is empty or too long' using errcode = '22023';
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
  perform public.book_review_claim_submission_slot();
  return new;
end;
$$;

drop trigger if exists book_review_replies_before_insert on public.book_review_replies;
create trigger book_review_replies_before_insert
before insert on public.book_review_replies
for each row
execute function public.book_review_replies_before_insert();

revoke all on function public.book_review_replies_before_insert() from public, anon;
grant execute on function public.book_review_replies_before_insert() to authenticated;

create or replace function public.moderate_book_review_reply(p_reply_id uuid, decision text)
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
  if decision is distinct from 'approved' and decision is distinct from 'rejected' then
    raise exception 'Invalid review decision' using errcode = '22023';
  end if;
  update public.book_review_replies
     set status = decision,
         moderated_at = now()
   where id = p_reply_id
     and status = 'pending';
  if not found then
    raise exception 'Reply not pending' using errcode = '02000';
  end if;
end;
$$;

create or replace function public.delete_book_review_reply(p_reply_id uuid)
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
  delete from public.book_review_replies where id = p_reply_id;
  if not found then
    raise exception 'Reply not found' using errcode = '02000';
  end if;
end;
$$;

create or replace function public.my_book_review_replies(p_book_id bigint)
returns table (
  id uuid,
  review_id uuid,
  body text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.review_id, r.body, r.status, r.created_at
  from public.book_review_replies r
  join public.book_reviews parent on parent.id = r.review_id
  where parent.book_id = p_book_id
    and r.user_id = (select auth.uid())
    and r.status in ('pending', 'rejected')
  order by r.created_at asc, r.id asc;
$$;

create or replace function public.admin_list_book_review_replies(p_status text)
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
  order by rp.created_at asc, rp.id asc
  limit 100;
end;
$$;

create or replace function public.admin_book_review_reply_exists(p_reply_id uuid)
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
  return exists (select 1 from public.book_review_replies where id = p_reply_id);
end;
$$;

create or replace function public.admin_approval_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  submissions bigint;
  reviews bigint;
  replies bigint;
begin
  if coalesce(public.is_kutadgu_admin(), false) is not true
     or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  select count(*) into submissions from public.books where submission_status = 'pending';
  select count(*) into reviews from public.book_reviews where status = 'pending';
  select count(*) into replies from public.book_review_replies where status = 'pending';
  return jsonb_build_object('submissions', submissions, 'reviews', reviews, 'replies', replies);
end;
$$;

revoke all on function public.moderate_book_review_reply(uuid, text) from public, anon;
revoke all on function public.delete_book_review_reply(uuid) from public, anon;
revoke all on function public.my_book_review_replies(bigint) from public, anon;
revoke all on function public.admin_list_book_review_replies(text) from public, anon;
revoke all on function public.admin_book_review_reply_exists(uuid) from public, anon;
revoke all on function public.admin_approval_counts() from public, anon;
grant execute on function public.moderate_book_review_reply(uuid, text) to authenticated;
grant execute on function public.delete_book_review_reply(uuid) to authenticated;
grant execute on function public.my_book_review_replies(bigint) to authenticated;
grant execute on function public.admin_list_book_review_replies(text) to authenticated;
grant execute on function public.admin_book_review_reply_exists(uuid) to authenticated;
grant execute on function public.admin_approval_counts() to authenticated;

alter table public.book_review_replies enable row level security;
alter table public.book_review_replies force row level security;

drop policy if exists "public reads approved replies of public reviews" on public.book_review_replies;
create policy "public reads approved replies of public reviews"
on public.book_review_replies
for select
to anon, authenticated
using (
  status = 'approved'
  and exists (
    select 1
    from public.book_reviews parent
    join public.books b on b.id = parent.book_id
    where parent.id = book_review_replies.review_id
      and parent.status = 'approved'
      and b.is_active = true
  )
);

drop policy if exists "member reads own book review replies" on public.book_review_replies;
create policy "member reads own book review replies"
on public.book_review_replies
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "admin aal2 reads book review replies" on public.book_review_replies;
create policy "admin aal2 reads book review replies"
on public.book_review_replies
for select
to authenticated
using (
  public.is_kutadgu_admin()
  and (select auth.jwt()->>'aal') = 'aal2'
);

drop policy if exists "member inserts own pending reply" on public.book_review_replies;
create policy "member inserts own pending reply"
on public.book_review_replies
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and char_length(btrim(body)) between 1 and 500
);

revoke all on table public.book_review_replies from public, anon, authenticated;
grant select (
  id,
  review_id,
  display_name,
  body,
  status,
  created_at,
  moderated_at
) on table public.book_review_replies to anon, authenticated;
grant insert (review_id, body) on table public.book_review_replies to authenticated;

commit;
