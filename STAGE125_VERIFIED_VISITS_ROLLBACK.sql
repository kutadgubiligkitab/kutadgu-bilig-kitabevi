-- Stage 125 rollback. Run by itself after review.
-- Drops only the verified-visit objects. Leaves analytics_events, legacy
-- receipts, the legacy gate, and private.analytics_visit_counter in place.
-- Restores public.get_kutadgu_analytics to the Stage 117 body, which has
-- counted_visits and visit_countries and no verified keys.

BEGIN;

DROP FUNCTION IF EXISTS public.get_kutadgu_verified_visit_history(integer, integer, integer, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.kutadgu_note_verified_outage();
DROP FUNCTION IF EXISTS public.kutadgu_consume_visit_proof(text);
DROP FUNCTION IF EXISTS public.kutadgu_accept_verified_visit(uuid, uuid, text);
DROP FUNCTION IF EXISTS private.kutadgu_verified_country_report(integer);
DROP FUNCTION IF EXISTS private.kutadgu_verified_visit_report(integer);
DROP FUNCTION IF EXISTS private.kutadgu_verified_window_status(timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS private.kutadgu_verified_outage_overlaps(timestamptz, timestamptz, timestamptz);
DROP TRIGGER IF EXISTS analytics_verified_signals_coverage ON private.analytics_verified_signals;
DROP FUNCTION IF EXISTS private.kutadgu_verified_signal_coverage();
DROP FUNCTION IF EXISTS private.kutadgu_accept_verified_visit(uuid, uuid, text, timestamptz);

DROP TABLE IF EXISTS private.kutadgu_verified_history_members;
DROP TABLE IF EXISTS private.kutadgu_verified_history_snapshots;
DROP TABLE IF EXISTS private.analytics_verified_signals;
DROP TABLE IF EXISTS private.analytics_verified_proofs;
DROP TABLE IF EXISTS private.analytics_verified_receipts;
DROP TABLE IF EXISTS private.analytics_verified_gate;
DROP TABLE IF EXISTS private.analytics_verified_counter;

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
    'counted_visits', private.kutadgu_counted_visit_report(p_days),
    'visit_countries', private.kutadgu_country_visit_report(p_days)
  );
  return v_result;
end
$function$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;

COMMIT;
