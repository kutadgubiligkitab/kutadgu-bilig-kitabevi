-- Removes the Stage 108 review deletion helpers and restores the Stage 107 insert length.
-- Does not drop book_reviews and does not delete review rows.

begin;

drop function if exists public.admin_book_review_exists(uuid);
drop function if exists public.admin_list_book_reviews(text);
drop function if exists public.delete_book_review(uuid);

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
  if new.body is null or char_length(new.body) < 1 or char_length(new.body) > 2000 then
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
  return new;
end;
$$;

commit;
