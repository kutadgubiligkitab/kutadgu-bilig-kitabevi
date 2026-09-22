-- ============================================================================
-- Kutadgu Bilig — Stage 100 public book views + manual stock-status override
-- Repeat-safe. Adds no fake stock quantities and does not rewrite existing stock.
-- ============================================================================
--
-- 1) books.stock_status is an OPTIONAL manual storefront override:
--      NULL         = derive status from books.stock (default / automatic)
--      in_stock     = manual "available" display (still never bypasses stock=0 safety)
--      low_stock    = manual "low stock" display (still never bypasses stock=0 safety)
--      out_of_stock = manual "sold out" override; storefront buying is blocked
--
-- 2) book_view_stats stores aggregate public counters only.
--    total_views  = raw book_view events
--    unique_views = distinct browser-session ids; refresh in the same tab/session
--                   does not increment this counter again.
--    Raw session ids stay in private.book_view_sessions and are never public.
--
-- Existing analytics_events rows are backfilled once into the counters.
-- No analytics rows are deleted or modified.
-- ============================================================================

begin;

alter table public.books
  add column if not exists stock_status text;

alter table public.books
  drop constraint if exists books_stock_status_chk;

alter table public.books
  add constraint books_stock_status_chk
  check (
    stock_status is null
    or stock_status in ('in_stock', 'low_stock', 'out_of_stock')
  );

comment on column public.books.stock_status is
  'Optional manual storefront override. NULL = derive from stock. Allowed: in_stock, low_stock, out_of_stock. out_of_stock blocks buying; in/low never bypass stock=0 safety.';

create schema if not exists private;

-- Defense in depth: storefront already blocks a manual sold-out book. Also
-- reject NEW/edited prepared orders at the database boundary so a direct RPC
-- or stale client cannot create an order for a manually sold-out book.
create or replace function private.kutadgu_block_manual_sold_out_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  if exists (
    select 1
    from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) as elem(value)
    join public.books b
      on b.id::text = btrim(elem.value ->> 'book_id')
    where b.stock_status = 'out_of_stock'
  ) then
    raise exception 'book_out_of_stock'
      using hint = 'manual_stock_status';
  end if;
  return new;
end;
$;

revoke all on function private.kutadgu_block_manual_sold_out_order() from public, anon, authenticated;

drop trigger if exists orders_block_manual_sold_out on public.orders;
create trigger orders_block_manual_sold_out
  before insert or update of items on public.orders
  for each row
  execute function private.kutadgu_block_manual_sold_out_order();


create table if not exists private.book_view_sessions (
  book_id bigint not null references public.books(id) on delete cascade,
  session_id text not null,
  first_seen_at timestamptz not null default now(),
  primary key (book_id, session_id)
);

revoke all on table private.book_view_sessions from public, anon, authenticated;

create table if not exists public.book_view_stats (
  book_id bigint primary key references public.books(id) on delete cascade,
  total_views bigint not null default 0 check (total_views >= 0),
  unique_views bigint not null default 0 check (unique_views >= 0),
  updated_at timestamptz not null default now()
);

alter table public.book_view_stats enable row level security;

revoke all on table public.book_view_stats from anon, authenticated;
grant select on table public.book_view_stats to anon, authenticated;

drop policy if exists "public can read book view stats" on public.book_view_stats;
create policy "public can read book view stats"
  on public.book_view_stats
  for select
  to anon, authenticated
  using (true);

insert into private.book_view_sessions (book_id, session_id, first_seen_at)
select
  b.id,
  btrim(e.session_id),
  min(e.created_at)
from public.analytics_events e
join public.books b
  on b.id::text = e.book_id
  or (
    nullif(btrim(coalesce(b.legacy_id, '')), '') is not null
    and (
      b.legacy_id = e.book_id
      or b.legacy_id = e.legacy_id
    )
  )
where e.event_name = 'book_view'
  and nullif(btrim(coalesce(e.session_id, '')), '') is not null
group by b.id, btrim(e.session_id)
on conflict (book_id, session_id) do nothing;

insert into public.book_view_stats (book_id, total_views, unique_views, updated_at)
select
  b.id,
  count(*)::bigint,
  count(distinct nullif(btrim(coalesce(e.session_id, '')), ''))::bigint,
  now()
from public.analytics_events e
join public.books b
  on b.id::text = e.book_id
  or (
    nullif(btrim(coalesce(b.legacy_id, '')), '') is not null
    and (
      b.legacy_id = e.book_id
      or b.legacy_id = e.legacy_id
    )
  )
where e.event_name = 'book_view'
group by b.id
on conflict (book_id) do update
set total_views = excluded.total_views,
    unique_views = excluded.unique_views,
    updated_at = excluded.updated_at;

create or replace function private.kutadgu_capture_book_view()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book_id bigint;
  v_session text;
  v_is_unique boolean := false;
begin
  if new.event_name is distinct from 'book_view' then
    return new;
  end if;

  select b.id
    into v_book_id
  from public.books b
  where b.id::text = nullif(btrim(coalesce(new.book_id, '')), '')
     or (
       nullif(btrim(coalesce(b.legacy_id, '')), '') is not null
       and (
         b.legacy_id = nullif(btrim(coalesce(new.book_id, '')), '')
         or b.legacy_id = nullif(btrim(coalesce(new.legacy_id, '')), '')
       )
     )
  order by case when b.id::text = nullif(btrim(coalesce(new.book_id, '')), '') then 0 else 1 end,
           b.id
  limit 1;

  if v_book_id is null then
    return new;
  end if;

  insert into public.book_view_stats (book_id, total_views, unique_views, updated_at)
  values (v_book_id, 1, 0, now())
  on conflict (book_id) do update
  set total_views = public.book_view_stats.total_views + 1,
      updated_at = now();

  v_session := nullif(btrim(coalesce(new.session_id, '')), '');
  if v_session is not null then
    insert into private.book_view_sessions (book_id, session_id)
    values (v_book_id, v_session)
    on conflict (book_id, session_id) do nothing;

    v_is_unique := found;
    if v_is_unique then
      update public.book_view_stats
      set unique_views = unique_views + 1,
          updated_at = now()
      where book_id = v_book_id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.kutadgu_capture_book_view() from public, anon, authenticated;

drop trigger if exists analytics_events_book_view_stats on public.analytics_events;
create trigger analytics_events_book_view_stats
  after insert on public.analytics_events
  for each row
  when (new.event_name = 'book_view')
  execute function private.kutadgu_capture_book_view();

commit;

-- ============================================================================
-- READ-ONLY POST-CHECKS
-- ============================================================================
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema='public' and table_name='books' and column_name='stock_status';
--
-- select count(*) as stat_rows, sum(total_views) as raw_views, sum(unique_views) as unique_views
-- from public.book_view_stats;
--
-- select * from public.book_view_stats order by unique_views desc limit 10;
-- ============================================================================
