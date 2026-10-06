-- Stage 114 rollback. Run this file by itself.
-- Restores the rolling-window analytics function from before counted visits.
-- Drops the page-visit trigger and the private visit tables.
-- Does not delete analytics_events. Leaves visitor_id and event_id columns
-- so an already-shipped browser can keep sending them. Counted-visit rows
-- are removed with the private tables. Applying the forward file again
-- starts a new collection and does not rebuild visits from old page views.

BEGIN;

DROP TRIGGER IF EXISTS analytics_events_count_page_visit ON public.analytics_events;

DROP FUNCTION IF EXISTS private.kutadgu_count_page_visit();
DROP FUNCTION IF EXISTS private.kutadgu_counted_visit_report(integer);
DROP FUNCTION IF EXISTS private.kutadgu_visit_window_status(timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS private.kutadgu_accept_page_visit(text, uuid, timestamptz);
DROP FUNCTION IF EXISTS private.kutadgu_visit_status_json(text, integer);
DROP FUNCTION IF EXISTS private.kutadgu_visitor_id_ok(text);
DROP FUNCTION IF EXISTS private.kutadgu_analytics_public_path(text);

DROP TABLE IF EXISTS private.analytics_visit_receipts;
DROP TABLE IF EXISTS private.analytics_visit_gate;
DROP TABLE IF EXISTS private.analytics_visit_counter;

ALTER TABLE public.analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_visitor_id_shape;

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
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;

REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kutadgu_analytics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_kutadgu_analytics(integer) TO authenticated;

COMMIT;
