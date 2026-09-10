-- قۇتادغۇبىلىك — Stage 9 analytics INSERT RLS hardening
-- Supabase > SQL Editor دا بىر قېتىم Run قىلىڭ. بۇ ھۆججەتنى كود ئىجرا قىلمايدۇ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE POLICY.
-- INSERT/UPDATE/DELETE يوق. analytics_events قۇرلىرى ئۆچۈرۈلمەيدۇ.
-- get_kutadgu_analytics ئۆزگەرمەيدۇ. service_role ئاچىلمايدۇ.
--
-- نېمە ئۈچۈن: "public can insert analytics" WITH CHECK (true) Advisor ئاگاھلاندۇرۇشى.
-- ئاممىۋى INSERT ساقلىنىدۇ؛ قۇر شەكلى چەكلىنىدۇ. anon SELECT يوق.
--
-- بۇنى STAGE8_STORE_ANALYTICS.sql دىن كېيىن Run قىلىڭ (legacy_id / meta ستونلىرى).

begin;

alter table public.analytics_events add column if not exists legacy_id text;
alter table public.analytics_events add column if not exists meta jsonb;

alter table public.analytics_events enable row level security;

grant insert on public.analytics_events to anon, authenticated;
grant select on public.analytics_events to authenticated;

drop policy if exists "public can insert analytics" on public.analytics_events;
create policy "public can insert analytics"
  on public.analytics_events
  for insert
  to anon, authenticated
  with check (
    event_name in (
      'page_view',
      'book_view',
      'add_to_cart',
      'whatsapp_order_click',
      'search',
      'zero_result_search',
      'add_to_favorite',
      'remove_from_favorite',
      'contact_click',
      'filter_apply'
    )
    and (book_id is null or char_length(book_id) <= 32)
    and (search_query is null or char_length(search_query) <= 80)
    and (category is null or char_length(category) <= 100)
    and (path is null or char_length(path) <= 180)
    and (session_id is null or char_length(session_id) <= 100)
    and (legacy_id is null or char_length(legacy_id) <= 120)
    and (result_count is null or (result_count >= 0 and result_count <= 100000))
    and (item_count is null or (item_count >= 0 and item_count <= 200))
    and (order_total is null or (order_total >= 0 and order_total <= 9999999.99))
    and case
      when meta is null then true
      when event_name <> 'whatsapp_order_click' then false
      when jsonb_typeof(meta) <> 'object' then false
      when (meta - 'book_ids') <> '{}'::jsonb then false
      when jsonb_typeof(meta -> 'book_ids') <> 'array' then false
      when jsonb_array_length(meta -> 'book_ids') > 200 then false
      else not exists (
        select 1
        from jsonb_array_elements_text(meta -> 'book_ids') as book_id_elem
        where char_length(book_id_elem) > 32
           or book_id_elem !~ '^\d+$'
      )
    end
    and created_at >= (now() - interval '5 minutes')
    and created_at <= (now() + interval '5 minutes')
  );

commit;
