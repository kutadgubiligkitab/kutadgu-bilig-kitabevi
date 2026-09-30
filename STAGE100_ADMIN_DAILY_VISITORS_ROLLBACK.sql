-- Stage 100 rollback. MANUAL APPLY ONLY. Do not run this against production
-- from an agent task, and do not run it in the same batch as
-- STAGE100_ADMIN_DAILY_VISITORS.sql.
--
-- This restores the function that was deployed before Stage 100:
-- rolling now() - N days, admin + AAL2, an id-only book join, and only
-- page_views, book_views, cart_adds, whatsapp_clicks, top_books, and
-- zero_searches. It is not STAGE8_STORE_ANALYTICS.sql.
--
-- The insert policy returns to the Stage 99 body so engagement event names
-- stay allowed. visitor_id, event_id, host, occurred_at, and action_seq
-- stay in place. This file does not delete analytics_events and does not
-- change book sale counters.

BEGIN;

DROP TRIGGER IF EXISTS analytics_events_validate_timing ON public.analytics_events;
DROP FUNCTION IF EXISTS private.kutadgu_validate_analytics_timing();

DROP POLICY IF EXISTS "public can insert analytics" ON public.analytics_events;
CREATE POLICY "public can insert analytics"
  ON public.analytics_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    event_name in (
      'page_view',
      'book_view',
      'book_engagement_detail',
      'book_engagement_cart',
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
      when event_name is distinct from 'whatsapp_order_click' then false
      when jsonb_typeof(meta) is distinct from 'object' then false
      when not (meta ? 'book_ids') then false
      when (meta - 'book_ids') is distinct from '{}'::jsonb then false
      when jsonb_typeof(meta -> 'book_ids') is distinct from 'array' then false
      when coalesce(jsonb_array_length(meta -> 'book_ids'), 0) > 200 then false
      else not exists (
        select 1
        from jsonb_array_elements(meta -> 'book_ids') as elem(value)
        where jsonb_typeof(elem.value) is distinct from 'string'
           or char_length(elem.value #>> '{}') > 32
           or (elem.value #>> '{}') !~ '^\d+$'
      )
    end
    and created_at >= (now() - interval '5 minutes')
    and created_at <= (now() + interval '5 minutes')
  );

CREATE OR REPLACE FUNCTION public.get_kutadgu_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $rollback$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_result jsonb;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'page_views', (
      SELECT count(*)::bigint
      FROM public.analytics_events
      WHERE created_at >= v_since AND event_name = 'page_view'
    ),
    'book_views', (
      SELECT count(*)::bigint
      FROM public.analytics_events
      WHERE created_at >= v_since AND event_name = 'book_view'
    ),
    'cart_adds', (
      SELECT count(*)::bigint
      FROM public.analytics_events
      WHERE created_at >= v_since AND event_name = 'add_to_cart'
    ),
    'whatsapp_clicks', (
      SELECT count(*)::bigint
      FROM public.analytics_events
      WHERE created_at >= v_since AND event_name = 'whatsapp_order_click'
    ),
    'top_books', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.views DESC)
      FROM (
        SELECT e.book_id,
               coalesce(b.title, e.book_id) AS title,
               count(*)::integer AS views
        FROM public.analytics_events e
        LEFT JOIN public.books b ON b.id::text = e.book_id
        WHERE e.created_at >= v_since
          AND e.event_name = 'book_view'
          AND e.book_id IS NOT NULL
          AND e.book_id <> ''
        GROUP BY e.book_id, b.title
        ORDER BY count(*) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'zero_searches', coalesce((
      SELECT jsonb_agg(to_jsonb(z) ORDER BY z.searches DESC)
      FROM (
        SELECT search_query AS query,
               count(*)::integer AS searches
        FROM public.analytics_events
        WHERE created_at >= v_since
          AND event_name = 'search'
          AND coalesce(result_count, 0) = 0
          AND search_query IS NOT NULL
          AND search_query <> ''
        GROUP BY search_query
        ORDER BY count(*) DESC
        LIMIT 10
      ) z
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN coalesce(v_result, jsonb_build_object(
    'page_views', 0,
    'book_views', 0,
    'cart_adds', 0,
    'whatsapp_clicks', 0,
    'top_books', '[]'::jsonb,
    'zero_searches', '[]'::jsonb
  ));
END;
$rollback$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;

COMMIT;
