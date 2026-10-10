-- Stage 116 — restore the admin cart, WhatsApp, and search lists.
-- MANUAL APPLY ONLY. This file was not executed against production.
-- It does not rerun Stage 114 or Stage 115, and it does not delete,
-- rewrite, or backfill analytics_events.
--
-- get_kutadgu_analytics keeps its rolling window and its existing keys:
-- page_views, book_views, cart_adds, whatsapp_clicks, top_books,
-- zero_searches, and counted_visits. The zero_searches key is unchanged,
-- including its treatment of a null result_count. counted_visits is still
-- private.kutadgu_counted_visit_report. This file only adds
-- top_cart_books, top_whatsapp_books, and unknown_result_searches.
--
-- The two paginated lists use Europe/Istanbul calendar days derived from
-- the snapshot as_of. That boundary is not the rolling event-total window
-- and not the counted-visit window. The three-hour rule stays inside the
-- page-view counter. It does not apply to search events.
--
-- get_kutadgu_searches counts stored search events once the selected
-- snapshot contains any search event. A paired zero_result_search is not
-- a second customer search. A window with no search event can still list
-- legacy zero_result_search terms. A mixed window does not reconstruct
-- unpaired legacy terms. result_count = 0 is a confirmed zero.
-- result_count NULL is unknown, not zero. A positive count stays a hit.
-- Terms use the browser normalization: trim, collapse whitespace, and the
-- first 80 characters. Case is not folded. Order is search count
-- descending, then last searched time descending, then the query ascending.
-- A repeated completed search counts again. The same event_id counts once.
-- Rows with a null event_id still count once per stored row.
--
-- get_kutadgu_zero_searches is the reviewed Stage 101 contract. Confirmed
-- zeros are search events with result_count = 0. Unknown stays out of
-- that list. The legacy event is used only when the window has no search
-- event at all.
--
-- Cart rankings count add_to_cart events and expose adds. WhatsApp
-- rankings count clicks and expose clicks. One click counts each distinct
-- book once, from book_id and from meta.book_ids together.
--
-- Rollback: run STAGE116_ADMIN_ANALYTICS_LISTS_ROLLBACK.sql by itself.

BEGIN;

CREATE INDEX IF NOT EXISTS analytics_events_zero_search_recent_idx
  ON public.analytics_events (created_at DESC, search_query)
  WHERE event_name = 'search'
    AND result_count = 0
    AND search_query IS NOT NULL
    AND btrim(search_query) <> '';

CREATE INDEX IF NOT EXISTS analytics_events_search_terms_idx
  ON public.analytics_events (created_at DESC, search_query)
  WHERE event_name = 'search'
    AND search_query IS NOT NULL
    AND btrim(search_query) <> '';

CREATE OR REPLACE FUNCTION public.get_kutadgu_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
    ),'[]'::jsonb),
    'top_cart_books',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.adds desc, t.book_id asc)
      from (
        select e.book_id,
               coalesce(b.title, e.book_id) as title,
               count(distinct coalesce(e.event_id::text, 'id:' || e.id::text))::integer as adds
        from public.analytics_events e
        left join public.books b on b.id::text = e.book_id
        where e.created_at >= v_since
          and e.event_name = 'add_to_cart'
          and e.book_id is not null
          and btrim(e.book_id) <> ''
        group by e.book_id, b.title
        order by count(distinct coalesce(e.event_id::text, 'id:' || e.id::text)) desc, e.book_id asc
        limit 10
      ) t
    ),'[]'::jsonb),
    'top_whatsapp_books',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.clicks desc, t.book_id asc)
      from (
        select x.book_id,
               coalesce(b.title, x.book_id) as title,
               count(distinct x.event_key)::integer as clicks
        from (
          select distinct
            coalesce(e.event_id::text, 'id:' || e.id::text) as event_key,
            tok.book_id
          from public.analytics_events e
          cross join lateral (
            select distinct nullif(btrim(raw.token), '') as book_id
            from (
              select e.book_id as token
              union
              select item
              from jsonb_array_elements_text(
                case
                  when jsonb_typeof(e.meta -> 'book_ids') = 'array' then e.meta -> 'book_ids'
                  else '[]'::jsonb
                end
              ) as item
            ) raw(token)
          ) tok
          where e.created_at >= v_since
            and e.event_name = 'whatsapp_order_click'
            and tok.book_id is not null
        ) x
        left join public.books b on b.id::text = x.book_id
        group by x.book_id, b.title
        order by count(distinct x.event_key) desc, x.book_id asc
        limit 10
      ) t
    ),'[]'::jsonb),
    'unknown_result_searches',(
      select count(distinct coalesce(event_id::text, 'id:' || id::text))
      from public.analytics_events
      where created_at >= v_since
        and event_name = 'search'
        and result_count is null
        and search_query is not null
        and btrim(search_query) <> ''
    )
  ) into v_result;
  v_result := v_result || jsonb_build_object(
    'counted_visits', private.kutadgu_counted_visit_report(p_days)
  );
  return v_result;
end
$function$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;

DROP FUNCTION IF EXISTS public.get_kutadgu_zero_searches(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.get_kutadgu_zero_searches(
  p_days integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20,
  p_as_of timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_as_of timestamptz := least(coalesce(p_as_of, now()), now());
  v_today date := (timezone('Europe/Istanbul', v_as_of))::date;
  v_start date := v_today - (v_days - 1);
  v_since timestamptz := v_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_until timestamptz := (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_has_search boolean := false;
  v_total_events bigint := 0;
  v_total_queries bigint := 0;
  v_queries jsonb := '[]'::jsonb;
  v_page_count integer := 0;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.analytics_events
    WHERE created_at >= v_since
      AND created_at < v_until
      AND created_at <= v_as_of
      AND event_name = 'search'
  ) INTO v_has_search;

  WITH qualifying AS (
    SELECT
      left(regexp_replace(btrim(search_query), '[[:space:]]+', ' ', 'g'), 80) AS query,
      created_at
    FROM public.analytics_events
    WHERE created_at >= v_since
      AND created_at < v_until
      AND created_at <= v_as_of
      AND search_query IS NOT NULL
      AND btrim(search_query) <> ''
      AND (
        (
          v_has_search
          AND event_name = 'search'
          AND result_count = 0
        )
        OR (
          NOT v_has_search
          AND event_name = 'zero_result_search'
          AND (result_count IS NULL OR result_count = 0)
        )
      )
  ),
  grouped AS (
    SELECT query, count(*)::integer AS searches, max(created_at) AS last_searched_at
    FROM qualifying
    WHERE query <> ''
    GROUP BY query
  )
  SELECT
    coalesce(sum(searches), 0),
    count(*),
    coalesce((
      SELECT jsonb_agg(to_jsonb(page) ORDER BY page.last_searched_at DESC, page.query ASC)
      FROM (
        SELECT query, searches, last_searched_at
        FROM grouped
        ORDER BY last_searched_at DESC, query ASC
        OFFSET v_offset
        LIMIT v_limit
      ) page
    ), '[]'::jsonb)
  INTO v_total_events, v_total_queries, v_queries
  FROM grouped;

  v_page_count := coalesce(jsonb_array_length(v_queries), 0);

  RETURN jsonb_build_object(
    'schema_version', 2,
    'timezone', 'Europe/Istanbul',
    'range_start', v_start,
    'range_end', v_today,
    'days', v_days,
    'as_of', v_as_of,
    'offset', v_offset,
    'next_offset', v_offset + v_page_count,
    'limit', v_limit,
    'total_events', v_total_events,
    'total_queries', v_total_queries,
    'has_more', (v_offset + v_page_count) < v_total_queries,
    'representation', CASE WHEN v_has_search THEN 'search' ELSE 'zero_result_search' END,
    'queries', v_queries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_kutadgu_zero_searches(integer, integer, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_zero_searches(integer, integer, integer, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_zero_searches(integer, integer, integer, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_kutadgu_searches(
  p_days integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20,
  p_as_of timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_as_of timestamptz := least(coalesce(p_as_of, now()), now());
  v_today date := (timezone('Europe/Istanbul', v_as_of))::date;
  v_start date := v_today - (v_days - 1);
  v_since timestamptz := v_start::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_until timestamptz := (v_today + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_has_search boolean := false;
  v_total_events bigint := 0;
  v_total_queries bigint := 0;
  v_queries jsonb := '[]'::jsonb;
  v_page_count integer := 0;
BEGIN
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.analytics_events
    WHERE created_at >= v_since
      AND created_at < v_until
      AND created_at <= v_as_of
      AND event_name = 'search'
  ) INTO v_has_search;

  WITH qualifying AS (
    SELECT
      left(regexp_replace(btrim(search_query), '[[:space:]]+', ' ', 'g'), 80) AS query,
      created_at,
      coalesce(event_id::text, 'id:' || id::text) AS event_key
    FROM public.analytics_events
    WHERE created_at >= v_since
      AND created_at < v_until
      AND created_at <= v_as_of
      AND search_query IS NOT NULL
      AND btrim(search_query) <> ''
      AND (
        (v_has_search AND event_name = 'search')
        OR (NOT v_has_search AND event_name = 'zero_result_search')
      )
  ),
  grouped AS (
    SELECT query,
           count(DISTINCT event_key)::integer AS searches,
           max(created_at) AS last_searched_at
    FROM qualifying
    WHERE query <> ''
    GROUP BY query
  )
  SELECT
    coalesce(sum(searches), 0),
    count(*),
    coalesce((
      SELECT jsonb_agg(to_jsonb(page) ORDER BY page.searches DESC, page.last_searched_at DESC, page.query ASC)
      FROM (
        SELECT query, searches, last_searched_at
        FROM grouped
        ORDER BY searches DESC, last_searched_at DESC, query ASC
        OFFSET v_offset
        LIMIT v_limit
      ) page
    ), '[]'::jsonb)
  INTO v_total_events, v_total_queries, v_queries
  FROM grouped;

  v_page_count := coalesce(jsonb_array_length(v_queries), 0);

  RETURN jsonb_build_object(
    'schema_version', 2,
    'timezone', 'Europe/Istanbul',
    'range_start', v_start,
    'range_end', v_today,
    'days', v_days,
    'as_of', v_as_of,
    'offset', v_offset,
    'next_offset', v_offset + v_page_count,
    'limit', v_limit,
    'total_events', v_total_events,
    'total_queries', v_total_queries,
    'has_more', (v_offset + v_page_count) < v_total_queries,
    'representation', CASE WHEN v_has_search THEN 'search' ELSE 'zero_result_search' END,
    'queries', v_queries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_kutadgu_searches(integer, integer, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_searches(integer, integer, integer, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_searches(integer, integer, integer, timestamptz) TO authenticated;

COMMIT;
