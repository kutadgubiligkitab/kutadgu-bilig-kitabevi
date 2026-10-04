-- Persistent notifications for the author of a review when an admin approves a reply.
-- Apply after STAGE109_BOOK_REVIEW_HEARTS_REPLIES.sql.
-- The notification is inserted in the same approval transaction. A repeated approval does not insert another row.

begin;

create table if not exists public.book_review_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  review_id uuid not null references public.book_reviews (id) on delete cascade,
  reply_id uuid not null unique references public.book_review_replies (id) on delete cascade,
  book_id bigint not null,
  book_title text not null default '',
  excerpt text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists book_review_notifications_recipient_idx
  on public.book_review_notifications (recipient_id, created_at desc);

alter table public.book_review_notifications enable row level security;
alter table public.book_review_notifications force row level security;
revoke all on table public.book_review_notifications from public, anon, authenticated;

drop policy if exists "member reads own reply notifications" on public.book_review_notifications;
create policy "member reads own reply notifications"
on public.book_review_notifications
for select
to authenticated
using (recipient_id = (select auth.uid()));

grant select (
  id,
  review_id,
  reply_id,
  book_id,
  book_title,
  excerpt,
  read_at,
  created_at
) on table public.book_review_notifications to authenticated;

create or replace function public.moderate_book_review_reply(p_reply_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_review uuid;
  reply_user uuid;
  reply_body text;
  parent_user uuid;
  parent_book bigint;
  parent_title text;
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
     and status = 'pending'
   returning review_id, user_id, body
   into parent_review, reply_user, reply_body;
  if not found then
    raise exception 'Reply not pending' using errcode = '02000';
  end if;
  if decision is distinct from 'approved' then
    return;
  end if;
  select parent.user_id, parent.book_id, b.title
    into parent_user, parent_book, parent_title
  from public.book_reviews parent
  join public.books b on b.id = parent.book_id
  where parent.id = parent_review;
  if parent_user is null or parent_user is not distinct from reply_user then
    return;
  end if;
  insert into public.book_review_notifications (
    recipient_id, review_id, reply_id, book_id, book_title, excerpt
  ) values (
    parent_user,
    parent_review,
    p_reply_id,
    parent_book,
    coalesce(parent_title, ''),
    left(coalesce(reply_body, ''), 80)
  )
  on conflict (reply_id) do nothing;
end;
$$;

create or replace function public.my_book_review_notifications()
returns table (
  id uuid,
  review_id uuid,
  reply_id uuid,
  book_id bigint,
  book_title text,
  excerpt text,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.review_id, n.reply_id, n.book_id, n.book_title, n.excerpt, n.read_at, n.created_at
  from public.book_review_notifications n
  where n.recipient_id = (select auth.uid())
  order by n.created_at desc, n.id desc;
$$;

create or replace function public.mark_book_review_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  update public.book_review_notifications
     set read_at = coalesce(read_at, now())
   where id = p_id
     and recipient_id = auth.uid();
end;
$$;

revoke all on function public.moderate_book_review_reply(uuid, text) from public, anon;
revoke all on function public.my_book_review_notifications() from public, anon;
revoke all on function public.mark_book_review_notification_read(uuid) from public, anon;
grant execute on function public.moderate_book_review_reply(uuid, text) to authenticated;
grant execute on function public.my_book_review_notifications() to authenticated;
grant execute on function public.mark_book_review_notification_read(uuid) to authenticated;

commit;
