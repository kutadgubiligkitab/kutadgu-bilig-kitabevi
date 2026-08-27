-- قۇتادغۇبىلىك — Stage 4.6 analytics title join (legacy_id)
-- Supabase > SQL Editor. ئاگېنت ئىجرا قىلمايدۇ.
-- Repeat-safe: CREATE OR REPLACE function only.
-- analytics_events قۇرلىرى يېزىلمايدۇ / ئۆچۈرۈلمەيدۇ.
--
-- بۇنى STAGE45_LEGACY_ID_MIGRATION.sql دىن كېيىن Run قىلىڭ
-- (books.legacy_id ستونى بولسۇن).
-- STAGE4_ANALYTICS_RPC_FIX.sql دىكى RLS/GRANT ئۆزگەرمەيدۇ.
--
-- يېڭى ھادىسە book_id = books.id::text بولسۇن.
-- كونا slug ھادىسىلىرى books.legacy_id ئارقىلىق ماسلىشىدۇ.

create or replace function public.get_kutadgu_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_result jsonb;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'page_views', (
      select count(*)::bigint
      from public.analytics_events
      where created_at >= v_since and event_name = 'page_view'
    ),
    'book_views', (
      select count(*)::bigint
      from public.analytics_events
      where created_at >= v_since and event_name = 'book_view'
    ),
    'cart_adds', (
      select count(*)::bigint
      from public.analytics_events
      where created_at >= v_since and event_name = 'add_to_cart'
    ),
    'whatsapp_clicks', (
      select count(*)::bigint
      from public.analytics_events
      where created_at >= v_since and event_name = 'whatsapp_order_click'
    ),
    'top_books', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.views desc)
      from (
        select e.book_id,
               coalesce(b.title, e.book_id) as title,
               count(*)::integer as views
        from public.analytics_events e
        left join public.books b
          on b.id::text = e.book_id
          or (
            b.legacy_id is not null
            and b.legacy_id <> ''
            and b.legacy_id = e.book_id
          )
        where e.created_at >= v_since
          and e.event_name = 'book_view'
          and e.book_id is not null
          and e.book_id <> ''
        group by e.book_id, b.title
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'zero_searches', coalesce((
      select jsonb_agg(to_jsonb(z) order by z.searches desc)
      from (
        select search_query as query,
               count(*)::integer as searches
        from public.analytics_events
        where created_at >= v_since
          and event_name = 'search'
          and coalesce(result_count, 0) = 0
          and search_query is not null
          and search_query <> ''
        group by search_query
        order by count(*) desc
        limit 10
      ) z
    ), '[]'::jsonb)
  ) into v_result;

  return coalesce(v_result, jsonb_build_object(
    'page_views', 0,
    'book_views', 0,
    'cart_adds', 0,
    'whatsapp_clicks', 0,
    'top_books', '[]'::jsonb,
    'zero_searches', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_kutadgu_analytics(integer) from public;
revoke all on function public.get_kutadgu_analytics(integer) from anon;
grant execute on function public.get_kutadgu_analytics(integer) to authenticated;
