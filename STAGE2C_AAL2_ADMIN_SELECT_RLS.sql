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

-- SECURITY DEFINER Admin RPCs.
-- get_kutadgu_book_stock_sum: STAGE91 body + AAL2 after admin.
-- get_kutadgu_analytics: production v10 body (SUPABASE_SETUP / DATABASE_UPGRADE_V10)
-- plus AAL2 after admin. Do not ship Stage 8 analytics shape from this repair.
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

create or replace function public.get_kutadgu_analytics(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1,least(coalesce(p_days,30),365)));
  v_result jsonb;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'admin only';
  end if;
  if (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AAL2 required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'page_views',(select count(*) from public.analytics_events where created_at>=v_since and event_name='page_view'),
    'book_views',(select count(*) from public.analytics_events where created_at>=v_since and event_name='book_view'),
    'cart_adds',(select count(*) from public.analytics_events where created_at>=v_since and event_name='add_to_cart'),
    'whatsapp_clicks',(select count(*) from public.analytics_events where created_at>=v_since and event_name='whatsapp_order_click'),
    'top_books',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select e.book_id,coalesce(b.title,e.book_id) as title,count(*)::integer as views
        from public.analytics_events e left join public.books b on b.id::text=e.book_id
        where e.created_at>=v_since and e.event_name='book_view' and e.book_id is not null
        group by e.book_id,b.title order by count(*) desc limit 10
      ) t
    ),'[]'::jsonb),
    'zero_searches',coalesce((
      select jsonb_agg(to_jsonb(z)) from (
        select search_query as query,count(*)::integer as searches
        from public.analytics_events
        where created_at>=v_since and event_name='search' and coalesce(result_count,0)=0 and search_query is not null and search_query<>''
        group by search_query order by count(*) desc limit 10
      ) z
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM public;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_kutadgu_book_stock_sum() FROM public;
REVOKE ALL ON FUNCTION public.get_kutadgu_book_stock_sum() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_book_stock_sum() TO authenticated;

COMMIT;
