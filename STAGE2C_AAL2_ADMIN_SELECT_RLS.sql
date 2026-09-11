-- ============================================================================
-- Kutadgu Bilig — Admin SELECT / Admin RPC AAL2 (read path)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify rows, covers, IDs, grants, or write policies.
-- Does not change public.is_kutadgu_admin() or member/public SELECT policies.
-- Does not recreate PR #133 "aal2 required ..." RESTRICTIVE write policies.
-- ============================================================================
--
-- Problem:
--   Admin MFA is UI-gated. Admin-only SELECT policies and some SECURITY
--   DEFINER RPCs only checked public.is_kutadgu_admin(). An Admin AAL1
--   session can call PostgREST/RPC and read Admin-only data.
--
-- Fix:
--   Harden the Admin-specific permissive SELECT policy:
--     is_kutadgu_admin() AND (select auth.jwt()->>'aal') = 'aal2'
--   Do NOT add table-wide RESTRICTIVE SELECT AAL2 (that would force MFA
--   on member/public reads).
--   Admin RPCs get the same fail-closed AAL2 check used by set_member_status.
--
-- After apply:
--   member/public AAL1 reads of own/public rows: unchanged
--   admin_users own-row SELECT: unchanged (needed before MFA)
--   Admin-only/hidden reads: Admin + AAL2
--   get_kutadgu_analytics / get_kutadgu_book_stock_sum: Admin + AAL2
-- ============================================================================

BEGIN;

-- profiles: member own-row SELECT stays AAL1. Admin SELECT-all needs AAL2.
DROP POLICY IF EXISTS "admin can read all profiles" ON public.profiles;
CREATE POLICY "admin can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

-- orders: member own-order SELECT stays AAL1. Admin SELECT-all needs AAL2.
DROP POLICY IF EXISTS "admin can read all orders" ON public.orders;
CREATE POLICY "admin can read all orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

-- analytics_events: Admin SELECT only.
DROP POLICY IF EXISTS "admin can read analytics" ON public.analytics_events;
CREATE POLICY "admin can read analytics"
  ON public.analytics_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

-- books: public active SELECT unchanged. Inactive/hidden rows need Admin + AAL2.
DROP POLICY IF EXISTS "admin can read all books" ON public.books;
CREATE POLICY "admin can read all books"
  ON public.books
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

-- store announcements: public enabled window unchanged. Hidden/disabled need AAL2.
DROP POLICY IF EXISTS store_announcements_select_admin ON public.store_announcements;
CREATE POLICY store_announcements_select_admin
  ON public.store_announcements
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

-- hero: public enabled/current rows unchanged. Admin draft/disabled need AAL2.
DROP POLICY IF EXISTS store_hero_settings_select_admin ON public.store_hero_settings;
CREATE POLICY store_hero_settings_select_admin
  ON public.store_hero_settings
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

DROP POLICY IF EXISTS store_hero_store_slides_select_admin ON public.store_hero_store_slides;
CREATE POLICY store_hero_store_slides_select_admin
  ON public.store_hero_store_slides
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

DROP POLICY IF EXISTS store_hero_campaigns_select_admin ON public.store_hero_campaigns;
CREATE POLICY store_hero_campaigns_select_admin
  ON public.store_hero_campaigns
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (select auth.jwt()->>'aal') = 'aal2'
  );

-- SECURITY DEFINER Admin RPCs. Body matches STAGE8 + STAGE91 with AAL2 after admin.
CREATE OR REPLACE FUNCTION public.get_kutadgu_book_stock_sum()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  total bigint;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;

  if to_regclass('public.books') is null then
    return 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'books'
      and column_name = 'stock'
  ) then
    return null;
  end if;

  execute 'select coalesce(sum(stock), 0)::bigint from public.books' into total;
  return coalesce(total, 0);
end;
$$;

CREATE OR REPLACE FUNCTION public.get_kutadgu_analytics(p_days integer default 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_book_views bigint := 0;
  v_cart_adds bigint := 0;
  v_whatsapp bigint := 0;
  v_search_zeros bigint := 0;
  v_zero_events bigint := 0;
  v_page_views bigint := 0;
  v_zero_total bigint := 0;
  v_result jsonb;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'admin only';
  end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;

  select
    count(*) filter (where event_name = 'page_view'),
    count(*) filter (where event_name = 'book_view'),
    count(*) filter (where event_name = 'add_to_cart'),
    count(*) filter (where event_name = 'whatsapp_order_click'),
    count(*) filter (where event_name = 'search' and coalesce(result_count, 0) = 0),
    count(*) filter (where event_name = 'zero_result_search')
  into v_page_views, v_book_views, v_cart_adds, v_whatsapp, v_search_zeros, v_zero_events
  from public.analytics_events
  where created_at >= v_since;

  v_zero_total := case when v_search_zeros > 0 then v_search_zeros else v_zero_events end;

  select jsonb_build_object(
    'page_views', v_page_views,
    'book_views', v_book_views,
    'cart_adds', v_cart_adds,
    'whatsapp_clicks', v_whatsapp,
    'zero_result_searches', v_zero_total,
    'funnel', jsonb_build_object(
      'views', v_book_views,
      'cart_adds', v_cart_adds,
      'whatsapp_clicks', v_whatsapp,
      'view_to_cart_pct', case when v_book_views > 0 then round((v_cart_adds::numeric * 100) / v_book_views, 1) else null end,
      'cart_to_whatsapp_pct', case when v_cart_adds > 0 then round((v_whatsapp::numeric * 100) / v_cart_adds, 1) else null end,
      'view_to_whatsapp_pct', case when v_book_views > 0 then round((v_whatsapp::numeric * 100) / v_book_views, 1) else null end
    ),
    'top_books', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.views desc)
      from (
        select coalesce(b.id::text, e.book_id) as book_id,
               coalesce(b.title, e.book_id) as title,
               count(*)::integer as views
        from public.analytics_events e
        left join public.books b
          on b.id::text = e.book_id
          or (
            b.legacy_id is not null
            and b.legacy_id <> ''
            and (b.legacy_id = e.book_id or b.legacy_id = e.legacy_id)
          )
        where e.created_at >= v_since
          and e.event_name = 'book_view'
          and e.book_id is not null
          and e.book_id <> ''
        group by coalesce(b.id::text, e.book_id), coalesce(b.title, e.book_id)
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'top_cart_books', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.adds desc)
      from (
        select coalesce(b.id::text, e.book_id) as book_id,
               coalesce(b.title, e.book_id) as title,
               count(*)::integer as adds
        from public.analytics_events e
        left join public.books b
          on b.id::text = e.book_id
          or (
            b.legacy_id is not null
            and b.legacy_id <> ''
            and (b.legacy_id = e.book_id or b.legacy_id = e.legacy_id)
          )
        where e.created_at >= v_since
          and e.event_name = 'add_to_cart'
          and e.book_id is not null
          and e.book_id <> ''
        group by coalesce(b.id::text, e.book_id), coalesce(b.title, e.book_id)
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'top_whatsapp_books', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.clicks desc)
      from (
        select coalesce(b.id::text, x.book_id) as book_id,
               coalesce(b.title, x.book_id) as title,
               count(*)::integer as clicks
        from (
          select coalesce(ids.book_id, e.book_id) as book_id
          from public.analytics_events e
          left join lateral (
            select jsonb_array_elements_text(e.meta->'book_ids') as book_id
            where e.meta is not null
              and jsonb_typeof(e.meta->'book_ids') = 'array'
          ) ids on true
          where e.created_at >= v_since
            and e.event_name = 'whatsapp_order_click'
        ) x
        left join public.books b
          on b.id::text = x.book_id
          or (
            b.legacy_id is not null
            and b.legacy_id <> ''
            and b.legacy_id = x.book_id
          )
        where x.book_id is not null and x.book_id <> ''
        group by coalesce(b.id::text, x.book_id), coalesce(b.title, x.book_id)
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'top_searches', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.searches desc)
      from (
        select search_query as query,
               count(*)::integer as searches
        from public.analytics_events
        where created_at >= v_since
          and event_name = 'search'
          and search_query is not null
          and search_query <> ''
        group by search_query
        order by count(*) desc
        limit 10
      ) s
    ), '[]'::jsonb),
    'zero_searches', coalesce((
      select jsonb_agg(to_jsonb(z) order by z.searches desc)
      from (
        select search_query as query,
               count(*)::integer as searches
        from public.analytics_events
        where created_at >= v_since
          and search_query is not null
          and search_query <> ''
          and (
            (v_search_zeros > 0 and event_name = 'search' and coalesce(result_count, 0) = 0)
            or
            (v_search_zeros = 0 and event_name = 'zero_result_search')
          )
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
    'zero_result_searches', 0,
    'funnel', jsonb_build_object(
      'views', 0,
      'cart_adds', 0,
      'whatsapp_clicks', 0,
      'view_to_cart_pct', null,
      'cart_to_whatsapp_pct', null,
      'view_to_whatsapp_pct', null
    ),
    'top_books', '[]'::jsonb,
    'top_cart_books', '[]'::jsonb,
    'top_whatsapp_books', '[]'::jsonb,
    'top_searches', '[]'::jsonb,
    'zero_searches', '[]'::jsonb
  ));
end;
$$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM public;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_kutadgu_book_stock_sum() FROM public;
REVOKE ALL ON FUNCTION public.get_kutadgu_book_stock_sum() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_book_stock_sum() TO authenticated;

COMMIT;
