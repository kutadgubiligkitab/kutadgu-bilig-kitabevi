-- Roll back Stage 117 only.
-- Restores get_kutadgu_analytics to the Stage 116 body and
-- kutadgu_accept_page_visit to the Stage 114 body. Drops the country
-- columns, the country counter, and the country report. Does not delete
-- analytics_events. Does not change the three-hour gate or
-- private.analytics_visit_counter.started_at. Do not run Stage 8, 100,
-- 114, or 116 as this rollback.

BEGIN;

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

CREATE OR REPLACE FUNCTION private.kutadgu_accept_page_visit(
  p_visitor_id text,
  p_event_id uuid,
  p_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $accept$
DECLARE
  v_visitor text := lower(coalesce(p_visitor_id, ''));
  v_at timestamptz := coalesce(p_at, now());
  v_existing boolean;
  v_counted boolean := false;
BEGIN
  IF p_event_id IS NULL OR NOT private.kutadgu_visitor_id_ok(v_visitor) THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_visitor, 0));

  SELECT counted INTO v_existing
  FROM private.analytics_visit_receipts
  WHERE event_id = p_event_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO private.analytics_visit_gate AS g (visitor_id, last_counted_at)
  VALUES (v_visitor, v_at)
  ON CONFLICT (visitor_id) DO UPDATE
    SET last_counted_at = EXCLUDED.last_counted_at
    WHERE g.last_counted_at <= v_at - interval '3 hours'
  RETURNING true INTO v_counted;
  IF NOT FOUND THEN
    v_counted := false;
  END IF;

  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at)
  VALUES (
    p_event_id,
    v_visitor,
    v_counted,
    CASE WHEN v_counted THEN v_at ELSE NULL END
  );

  RETURN v_counted;
EXCEPTION
  WHEN unique_violation THEN
    SELECT counted INTO v_existing
    FROM private.analytics_visit_receipts
    WHERE event_id = p_event_id;
    RETURN coalesce(v_existing, false);
END;
$accept$;

REVOKE ALL ON FUNCTION private.kutadgu_accept_page_visit(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS analytics_events_trust_country ON public.analytics_events;
DROP FUNCTION IF EXISTS public.kutadgu_strip_untrusted_country();
DROP FUNCTION IF EXISTS private.kutadgu_country_visit_report(integer);
DROP FUNCTION IF EXISTS private.kutadgu_normalize_country(text);

ALTER TABLE public.analytics_events DROP COLUMN IF EXISTS country;
ALTER TABLE private.analytics_visit_receipts DROP COLUMN IF EXISTS country;
DROP TABLE IF EXISTS private.analytics_country_counter;

COMMIT;
