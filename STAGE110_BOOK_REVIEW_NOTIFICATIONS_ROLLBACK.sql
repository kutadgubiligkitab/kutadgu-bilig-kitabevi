-- Removes reply notifications and restores the Stage 109 reply moderation function.
-- Does not drop reviews, replies, or hearts.

begin;

drop function if exists public.mark_book_review_notification_read(uuid);
drop function if exists public.my_book_review_notifications();
drop table if exists public.book_review_notifications cascade;

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

revoke all on function public.moderate_book_review_reply(uuid, text) from public, anon;
grant execute on function public.moderate_book_review_reply(uuid, text) to authenticated;

commit;
