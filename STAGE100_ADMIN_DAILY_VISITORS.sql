-- Stage 100 — admin daily visitors and calendar analytics.
-- MANUAL APPLY ONLY. This file was not executed against production.
--
-- Deployment order:
--   1. Apply this file once in the Supabase SQL editor. It is repeat-safe.
--   2. Deploy the site after that so admin.js reads schema_version 2.
-- Compatibility before this file is applied:
--   The site can ship first. Inserts omit visitor_id, event_id, host,
--   occurred_at, and action_seq when PostgREST reports those columns are
--   missing, and the admin page shows missing visitor fields as unavailable
--   rather than zero.
--   Applying this file before the site deploy is also safe. New columns are
--   nullable, the function name and argument stay get_kutadgu_analytics(integer),
--   and the previous admin page ignores JSON keys it does not read.
-- Rollback: run STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql by itself.
--   It restores the previous rolling-window function and the Stage 99 insert
--   policy, drops the timing trigger, and leaves the new columns in place.
--   Do not delete analytics_events. Do not run the rollback in the same batch
--   as this file.
-- Do not apply STAGE8_STORE_ANALYTICS.sql over this function. Its legacy-id
-- OR join can multiply rows, and its funnel is an aggregate ratio.
--
-- The user-action funnel orders by action_seq, which the browser assigns once
-- when the person acts and reuses on retry. occurred_at is accepted only inside
-- now() - 5 minutes through now() + 1 minute; otherwise both ordering fields
-- are cleared and the event is still stored. Equal action_seq is not a later
-- step. arrival_funnel uses server receipt time (created_at) and is not
-- user-action order.
--
-- Visitors are distinct anonymous browser identities (visitor_id), not verified
-- humans. A person with several page views on one Europe/Istanbul day counts
-- once. Period distinct visitors are counted again across the selected range.
-- They are not the sum of the daily counts. Rows without visitor_id stay
-- unavailable and are not reconstructed from page views.
-- WhatsApp clicks stay intent events. This file does not update book sale counters.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS visitor_id text;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS event_id uuid;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS host text;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS action_seq integer;

CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_event_id_uidx
  ON public.analytics_events (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS analytics_events_created_visitor_idx
  ON public.analytics_events (created_at DESC, visitor_id)
  WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS analytics_events_session_action_idx
  ON public.analytics_events (session_id, action_seq)
  WHERE session_id IS NOT NULL AND action_seq IS NOT NULL;

-- Keep a client timestamp only inside the server window. A half-valid pair
-- cannot order the funnel: if either field fails, both become null. The row
-- is still inserted so page and book counts continue.
CREATE OR REPLACE FUNCTION private.kutadgu_validate_analytics_timing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $timing$
BEGIN
  IF NEW.occurred_at IS NOT NULL AND (
    NEW.occurred_at < now() - interval '5 minutes'
    OR NEW.occurred_at > now() + interval '1 minute'
  ) THEN
    NEW.occurred_at := NULL;
  END IF;
  IF NEW.action_seq IS NULL OR NEW.action_seq < 0 OR NEW.action_seq > 1000000 THEN
    NEW.action_seq := NULL;
  END IF;
  IF NEW.occurred_at IS NULL OR NEW.action_seq IS NULL THEN
    NEW.occurred_at := NULL;
    NEW.action_seq := NULL;
  END IF;
  RETURN NEW;
END;
$timing$;

REVOKE ALL ON FUNCTION private.kutadgu_validate_analytics_timing() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kutadgu_validate_analytics_timing() FROM anon;
REVOKE ALL ON FUNCTION private.kutadgu_validate_analytics_timing() FROM authenticated;

DROP TRIGGER IF EXISTS analytics_events_validate_timing ON public.analytics_events;
CREATE TRIGGER analytics_events_validate_timing
  BEFORE INSERT ON public.analytics_events
  FOR EACH ROW
  EXECUTE FUNCTION private.kutadgu_validate_analytics_timing();

CREATE OR REPLACE FUNCTION private.kutadgu_resolve_book_id(raw text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $resolve$
  SELECT CASE
    WHEN raw IS NULL OR btrim(raw) = '' THEN NULL
    ELSE COALESCE(
      (SELECT b.id::text FROM public.books b WHERE b.id::text = btrim(raw) LIMIT 1),
      (SELECT b.id::text FROM public.books b WHERE b.legacy_id = btrim(raw) ORDER BY b.id ASC LIMIT 1),
      btrim(raw)
    )
  END;
$resolve$;

REVOKE ALL ON FUNCTION private.kutadgu_resolve_book_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kutadgu_resolve_book_id(text) FROM anon;
REVOKE ALL ON FUNCTION private.kutadgu_resolve_book_id(text) FROM authenticated;

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
    and (path is null or (
      path !~* '(^|/)admin\.html$'
      and path !~* '(^|/)book-staff\.html$'
    ))
    and (session_id is null or char_length(session_id) <= 100)
    and (legacy_id is null or char_length(legacy_id) <= 120)
    and (visitor_id is null or visitor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    and (host is null or host in (
      'www.kutadgubilik.com',
      'kutadgubilik.com',
      'kutadgu-bilig-kitab.vercel.app'
    ))
    and (
      (occurred_at is null and action_seq is null)
      or (
        occurred_at is not null
        and action_seq is not null
        and occurred_at >= (now() - interval '5 minutes')
        and occurred_at <= (now() + interval '1 minute')
        and action_seq >= 0
        and action_seq <= 1000000
      )
    )
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
AS $fn$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_yesterday date := v_today - 1;
  v_range_start date := v_today - (v_days - 1);
  v_chart_start date := v_today - 6;
  v_scan_start date := least(v_range_start, v_chart_start);
  v_range_ts timestamptz := v_range_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_scan_ts timestamptz := v_scan_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_end_ts timestamptz := (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_result jsonb;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;

  WITH eligible AS (
    SELECT *
    FROM public.analytics_events e
    WHERE e.created_at >= v_scan_ts
      AND e.created_at < v_end_ts
      AND (e.host IS NULL OR e.host IN (
        'www.kutadgubilik.com',
        'kutadgubilik.com',
        'kutadgu-bilig-kitab.vercel.app'
      ))
      AND coalesce(e.path, '') !~* '(^|/)admin\.html$'
      AND coalesce(e.path, '') !~* '(^|/)book-staff\.html$'
  ),
  search_flags AS (
    SELECT
      count(*) FILTER (WHERE event_name = 'search') AS search_rows,
      count(*) FILTER (WHERE event_name = 'search' AND result_count = 0) AS search_zeros,
      count(*) FILTER (WHERE event_name = 'search' AND result_count IS NULL) AS search_unknown,
      count(*) FILTER (WHERE event_name = 'zero_result_search') AS legacy_zeros
    FROM eligible
    WHERE created_at >= v_range_ts
  ),
  user_funnel_events AS (
    SELECT session_id, event_name, action_seq
    FROM eligible
    WHERE created_at >= v_range_ts
      AND event_name IN ('book_view', 'add_to_cart', 'whatsapp_order_click')
      AND nullif(btrim(session_id), '') IS NOT NULL
      AND occurred_at IS NOT NULL
      AND action_seq IS NOT NULL
  ),
  user_funnel_views AS (
    SELECT session_id, min(action_seq) AS first_view
    FROM user_funnel_events
    WHERE event_name = 'book_view'
    GROUP BY session_id
  ),
  user_funnel_carts AS (
    SELECT v.session_id, min(e.action_seq) AS first_cart
    FROM user_funnel_views v
    JOIN user_funnel_events e
      ON e.session_id = v.session_id
     AND e.event_name = 'add_to_cart'
     AND e.action_seq > v.first_view
    GROUP BY v.session_id
  ),
  user_funnel_counts AS (
    SELECT
      (SELECT count(*) FROM user_funnel_views) AS views,
      (SELECT count(*) FROM user_funnel_carts) AS cart_adds,
      (
        SELECT count(*)
        FROM user_funnel_carts c
        WHERE EXISTS (
          SELECT 1
          FROM user_funnel_events e
          WHERE e.session_id = c.session_id
            AND e.event_name = 'whatsapp_order_click'
            AND e.action_seq > c.first_cart
        )
      ) AS whatsapp_clicks,
      (
        SELECT count(*)
        FROM eligible
        WHERE created_at >= v_range_ts
          AND event_name IN ('book_view', 'add_to_cart', 'whatsapp_order_click')
          AND nullif(btrim(session_id), '') IS NULL
      ) AS excluded_without_session,
      (
        SELECT count(*)
        FROM eligible
        WHERE created_at >= v_range_ts
          AND event_name IN ('book_view', 'add_to_cart', 'whatsapp_order_click')
          AND nullif(btrim(session_id), '') IS NOT NULL
          AND (occurred_at IS NULL OR action_seq IS NULL)
      ) AS excluded_without_action_seq
  ),
  arrival_funnel_views AS (
    SELECT session_id, min(created_at) AS first_view
    FROM eligible
    WHERE created_at >= v_range_ts
      AND event_name = 'book_view'
      AND nullif(btrim(session_id), '') IS NOT NULL
    GROUP BY session_id
  ),
  arrival_funnel_carts AS (
    SELECT v.session_id, min(e.created_at) AS first_cart
    FROM arrival_funnel_views v
    JOIN eligible e
      ON e.session_id = v.session_id
     AND e.event_name = 'add_to_cart'
     AND e.created_at >= v.first_view
     AND e.created_at >= v_range_ts
    GROUP BY v.session_id
  ),
  arrival_funnel_counts AS (
    SELECT
      (SELECT count(*) FROM arrival_funnel_views) AS views,
      (SELECT count(*) FROM arrival_funnel_carts) AS cart_adds,
      (
        SELECT count(*)
        FROM arrival_funnel_carts c
        WHERE EXISTS (
          SELECT 1
          FROM eligible e
          WHERE e.session_id = c.session_id
            AND e.event_name = 'whatsapp_order_click'
            AND e.created_at >= c.first_cart
            AND e.created_at >= v_range_ts
        )
      ) AS whatsapp_clicks,
      (
        SELECT count(*)
        FROM eligible
        WHERE created_at >= v_range_ts
          AND event_name IN ('book_view', 'add_to_cart', 'whatsapp_order_click')
          AND nullif(btrim(session_id), '') IS NULL
      ) AS excluded_without_session
  )
  SELECT jsonb_build_object(
    'schema_version', 2,
    'timezone', 'Europe/Istanbul',
    'p_days', v_days,
    'range_start', to_char(v_range_start, 'YYYY-MM-DD'),
    'range_end', to_char(v_today, 'YYYY-MM-DD'),
    'generated_at', now(),
    'page_views', (SELECT count(*) FROM eligible WHERE created_at >= v_range_ts AND event_name = 'page_view'),
    'book_views', (SELECT count(*) FROM eligible WHERE created_at >= v_range_ts AND event_name = 'book_view'),
    'cart_adds', (SELECT count(*) FROM eligible WHERE created_at >= v_range_ts AND event_name = 'add_to_cart'),
    'whatsapp_clicks', (SELECT count(*) FROM eligible WHERE created_at >= v_range_ts AND event_name = 'whatsapp_order_click'),
    'book_engagement_detail', (SELECT count(*) FROM eligible WHERE created_at >= v_range_ts AND event_name = 'book_engagement_detail'),
    'book_engagement_cart', (SELECT count(*) FROM eligible WHERE created_at >= v_range_ts AND event_name = 'book_engagement_cart'),
    'zero_result_searches', (
      SELECT CASE WHEN search_rows > 0 THEN search_zeros ELSE legacy_zeros END
      FROM search_flags
    ),
    'unknown_result_searches', (
      SELECT CASE WHEN search_rows > 0 THEN search_unknown ELSE NULL END
      FROM search_flags
    ),
    'top_books', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.views DESC, t.book_id)
      FROM (
        SELECT resolved.book_id, coalesce(b.title, resolved.book_id) AS title, resolved.views
        FROM (
          SELECT private.kutadgu_resolve_book_id(
            CASE
              WHEN e.book_id ~ '^\d+$' THEN e.book_id
              WHEN nullif(btrim(e.legacy_id), '') IS NOT NULL THEN e.legacy_id
              ELSE e.book_id
            END
          ) AS book_id, count(*)::integer AS views
          FROM eligible e
          WHERE e.created_at >= v_range_ts
            AND e.event_name = 'book_view'
            AND (e.book_id IS NOT NULL OR nullif(btrim(e.legacy_id), '') IS NOT NULL)
          GROUP BY 1
          ORDER BY count(*) DESC, 1
          LIMIT 10
        ) resolved
        LEFT JOIN LATERAL (
          SELECT books.title
          FROM public.books
          WHERE books.id::text = resolved.book_id
          LIMIT 1
        ) b ON true
        WHERE resolved.book_id IS NOT NULL
      ) t
    ), '[]'::jsonb),
    'top_cart_books', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.adds DESC, t.book_id)
      FROM (
        SELECT resolved.book_id, coalesce(b.title, resolved.book_id) AS title, resolved.adds
        FROM (
          SELECT private.kutadgu_resolve_book_id(
            CASE
              WHEN e.book_id ~ '^\d+$' THEN e.book_id
              WHEN nullif(btrim(e.legacy_id), '') IS NOT NULL THEN e.legacy_id
              ELSE e.book_id
            END
          ) AS book_id, count(*)::integer AS adds
          FROM eligible e
          WHERE e.created_at >= v_range_ts
            AND e.event_name = 'add_to_cart'
            AND (e.book_id IS NOT NULL OR nullif(btrim(e.legacy_id), '') IS NOT NULL)
          GROUP BY 1
          ORDER BY count(*) DESC, 1
          LIMIT 10
        ) resolved
        LEFT JOIN LATERAL (
          SELECT books.title FROM public.books WHERE books.id::text = resolved.book_id LIMIT 1
        ) b ON true
        WHERE resolved.book_id IS NOT NULL
      ) t
    ), '[]'::jsonb),
    'top_whatsapp_books', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.clicks DESC, t.book_id)
      FROM (
        SELECT resolved.book_id, coalesce(b.title, resolved.book_id) AS title, resolved.clicks
        FROM (
          SELECT private.kutadgu_resolve_book_id(tok.token) AS book_id,
                 count(DISTINCT e.id)::integer AS clicks
          FROM eligible e
          CROSS JOIN LATERAL (
            SELECT DISTINCT btrim(token) AS token
            FROM (
              SELECT elem #>> '{}' AS token
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(e.meta -> 'book_ids') = 'array' THEN e.meta -> 'book_ids'
                  ELSE '[]'::jsonb
                END
              ) AS elem
              UNION ALL
              SELECT e.book_id
              WHERE jsonb_typeof(e.meta -> 'book_ids') IS DISTINCT FROM 'array'
            ) raw
            WHERE nullif(btrim(token), '') IS NOT NULL
          ) tok
          WHERE e.created_at >= v_range_ts
            AND e.event_name = 'whatsapp_order_click'
          GROUP BY 1
          ORDER BY count(DISTINCT e.id) DESC, 1
          LIMIT 10
        ) resolved
        LEFT JOIN LATERAL (
          SELECT books.title FROM public.books WHERE books.id::text = resolved.book_id LIMIT 1
        ) b ON true
        WHERE resolved.book_id IS NOT NULL
      ) t
    ), '[]'::jsonb),
    'top_searches', coalesce((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.searches DESC, s.query)
      FROM (
        SELECT search_query AS query, count(*)::integer AS searches
        FROM eligible
        WHERE created_at >= v_range_ts
          AND search_query IS NOT NULL
          AND btrim(search_query) <> ''
          AND (
            event_name = 'search'
            OR (
              event_name = 'zero_result_search'
              AND NOT EXISTS (
                SELECT 1 FROM eligible look
                WHERE look.created_at >= v_range_ts AND look.event_name = 'search'
              )
            )
          )
        GROUP BY search_query
        ORDER BY count(*) DESC, search_query
        LIMIT 10
      ) s
    ), '[]'::jsonb),
    'zero_searches', coalesce((
      SELECT jsonb_agg(to_jsonb(z) ORDER BY z.searches DESC, z.query)
      FROM (
        SELECT search_query AS query, count(*)::integer AS searches
        FROM eligible
        WHERE created_at >= v_range_ts
          AND search_query IS NOT NULL
          AND btrim(search_query) <> ''
          AND (
            (
              event_name = 'search'
              AND result_count = 0
              AND EXISTS (
                SELECT 1 FROM search_flags flags WHERE flags.search_rows > 0
              )
            )
            OR (
              event_name = 'zero_result_search'
              AND EXISTS (
                SELECT 1 FROM search_flags flags WHERE flags.search_rows = 0
              )
            )
          )
        GROUP BY search_query
        ORDER BY count(*) DESC, search_query
        LIMIT 10
      ) z
    ), '[]'::jsonb),
    'visitors', jsonb_build_object(
      'definition', 'distinct_recorded_browser_identity',
      'timezone', 'Europe/Istanbul',
      'note', 'period_distinct_is_not_the_sum_of_daily_counts',
      'today', (
        SELECT jsonb_build_object(
          'date', to_char(v_today, 'YYYY-MM-DD'),
          'events', count(*)::integer,
          'identified_events', count(*) FILTER (WHERE visitor_id IS NOT NULL)::integer,
          'visitors', CASE
            WHEN count(*) = 0 THEN 0
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) = 0 THEN NULL
            ELSE count(DISTINCT visitor_id)::integer
          END,
          'status', CASE
            WHEN count(*) = 0 THEN 'zero'
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) = 0 THEN 'unavailable'
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) < count(*) THEN 'partial'
            ELSE 'complete'
          END
        )
        FROM eligible
        WHERE created_at >= (v_today::timestamp AT TIME ZONE 'Europe/Istanbul')
      ),
      'yesterday', (
        SELECT jsonb_build_object(
          'date', to_char(v_yesterday, 'YYYY-MM-DD'),
          'events', count(*)::integer,
          'identified_events', count(*) FILTER (WHERE visitor_id IS NOT NULL)::integer,
          'visitors', CASE
            WHEN count(*) = 0 THEN 0
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) = 0 THEN NULL
            ELSE count(DISTINCT visitor_id)::integer
          END,
          'status', CASE
            WHEN count(*) = 0 THEN 'zero'
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) = 0 THEN 'unavailable'
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) < count(*) THEN 'partial'
            ELSE 'complete'
          END
        )
        FROM eligible
        WHERE created_at >= (v_yesterday::timestamp AT TIME ZONE 'Europe/Istanbul')
          AND created_at < (v_today::timestamp AT TIME ZONE 'Europe/Istanbul')
      ),
      'period', (
        SELECT jsonb_build_object(
          'start', to_char(v_range_start, 'YYYY-MM-DD'),
          'end', to_char(v_today, 'YYYY-MM-DD'),
          'events', count(*)::integer,
          'identified_events', count(*) FILTER (WHERE visitor_id IS NOT NULL)::integer,
          'visitors', CASE
            WHEN count(*) = 0 THEN 0
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) = 0 THEN NULL
            ELSE count(DISTINCT visitor_id)::integer
          END,
          'status', CASE
            WHEN count(*) = 0 THEN 'zero'
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) = 0 THEN 'unavailable'
            WHEN count(*) FILTER (WHERE visitor_id IS NOT NULL) < count(*) THEN 'partial'
            ELSE 'complete'
          END
        )
        FROM eligible
        WHERE created_at >= v_range_ts
      ),
      'daily', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'date', to_char(d.day::date, 'YYYY-MM-DD'),
            'events', coalesce(a.events, 0),
            'identified_events', coalesce(a.identified_events, 0),
            'visitors', CASE
              WHEN coalesce(a.events, 0) = 0 THEN 0
              WHEN coalesce(a.identified_events, 0) = 0 THEN NULL
              ELSE a.visitors
            END,
            'status', CASE
              WHEN coalesce(a.events, 0) = 0 THEN 'zero'
              WHEN coalesce(a.identified_events, 0) = 0 THEN 'unavailable'
              WHEN a.identified_events < a.events THEN 'partial'
              ELSE 'complete'
            END
          )
          ORDER BY d.day
        )
        FROM generate_series(v_chart_start::timestamp, v_today::timestamp, interval '1 day') AS d(day)
        LEFT JOIN (
          SELECT (timezone('Europe/Istanbul', created_at))::date AS day,
                 count(*)::integer AS events,
                 count(*) FILTER (WHERE visitor_id IS NOT NULL)::integer AS identified_events,
                 count(DISTINCT visitor_id)::integer AS visitors
          FROM eligible
          WHERE created_at >= (v_chart_start::timestamp AT TIME ZONE 'Europe/Istanbul')
          GROUP BY 1
        ) a ON a.day = d.day::date
      ), '[]'::jsonb)
    ),
    'funnel', (
      SELECT jsonb_build_object(
        'kind', 'ordered_user_action',
        'order', 'validated_client_action_seq',
        'accurate_user_action_order', true,
        'scope', 'sessions_with_validated_action_seq',
        'whatsapp_is', 'intent_not_purchase',
        'views', views,
        'cart_adds', cart_adds,
        'whatsapp_clicks', whatsapp_clicks,
        'view_to_cart_pct', CASE WHEN views > 0 THEN round((100.0 * cart_adds) / views, 1) ELSE NULL END,
        'cart_to_whatsapp_pct', CASE WHEN cart_adds > 0 THEN round((100.0 * whatsapp_clicks) / cart_adds, 1) ELSE NULL END,
        'view_to_whatsapp_pct', CASE WHEN views > 0 THEN round((100.0 * whatsapp_clicks) / views, 1) ELSE NULL END,
        'excluded_without_session', excluded_without_session,
        'excluded_without_action_seq', excluded_without_action_seq
      )
      FROM user_funnel_counts
    ),
    'arrival_funnel', (
      SELECT jsonb_build_object(
        'kind', 'recorded_arrival',
        'order', 'server_receipt_time',
        'accurate_user_action_order', false,
        'scope', 'sessions_with_session_id',
        'whatsapp_is', 'intent_not_purchase',
        'views', views,
        'cart_adds', cart_adds,
        'whatsapp_clicks', whatsapp_clicks,
        'view_to_cart_pct', CASE WHEN views > 0 THEN round((100.0 * cart_adds) / views, 1) ELSE NULL END,
        'cart_to_whatsapp_pct', CASE WHEN cart_adds > 0 THEN round((100.0 * whatsapp_clicks) / cart_adds, 1) ELSE NULL END,
        'view_to_whatsapp_pct', CASE WHEN views > 0 THEN round((100.0 * whatsapp_clicks) / views, 1) ELSE NULL END,
        'excluded_without_session', excluded_without_session,
        'excluded_without_action_seq', 0
      )
      FROM arrival_funnel_counts
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;

COMMIT;

-- Rollback is STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql.
-- Run that file alone. Do not append it here.
