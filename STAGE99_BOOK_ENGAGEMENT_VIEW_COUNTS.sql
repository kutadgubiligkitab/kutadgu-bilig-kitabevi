-- ============================================================================
-- Kutadgu Bilig — Stage 99 book engagement view counts
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI, the browser, or this task.
-- PRODUCTION MIGRATION NOT APPLIED by the agent that added this file.
--
-- Repeat-safe and additive. Does NOT edit STAGE86_BOOK_VIEW_STATS.sql.
-- Does NOT reset public.book_view_stats.total_views.
-- Does NOT delete analytics rows, books, orders, stock, or covers.
-- Does NOT backfill historical add_to_cart events into the display total.
-- New cart engagement counts begin only after this migration is applied.
-- ============================================================================
--
-- Displayed total_views increases only when a dedicated engagement event
-- passes a 3-hour cooldown for the same book, session hash, and action:
--   book_engagement_detail  -> action detail (may also raise unique_views)
--   book_engagement_cart    -> action cart   (does not raise unique_views)
-- Normal book_view and add_to_cart analytics continue to insert, but the
-- Stage 86 book_view trigger no longer increments the public total.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS private.book_view_engagement_cooldowns (
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  action text NOT NULL,
  last_counted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, session_hash, action),
  CONSTRAINT book_view_engagement_action_chk CHECK (action IN ('detail', 'cart'))
);

COMMENT ON TABLE private.book_view_engagement_cooldowns IS
  'Private 3-hour cooldown per book, session hash, and action (detail or cart). Not a fingerprint. Never expose to anon or authenticated.';

ALTER TABLE private.book_view_engagement_cooldowns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.book_view_engagement_cooldowns FROM PUBLIC;
REVOKE ALL ON TABLE private.book_view_engagement_cooldowns FROM anon;
REVOKE ALL ON TABLE private.book_view_engagement_cooldowns FROM authenticated;

-- Keep the public storefront on aggregate columns only. Does not rewrite totals.
REVOKE ALL ON TABLE public.book_view_stats FROM PUBLIC;
REVOKE ALL ON TABLE public.book_view_stats FROM anon;
REVOKE ALL ON TABLE public.book_view_stats FROM authenticated;
GRANT SELECT (book_id, total_views) ON TABLE public.book_view_stats TO anon, authenticated;

-- Stop uncooled book_view increments. Existing totals stay where they are.
DROP TRIGGER IF EXISTS analytics_events_apply_book_view ON public.analytics_events;

CREATE OR REPLACE FUNCTION private.kutadgu_apply_book_engagement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $stage99$
DECLARE
  v_book_id bigint;
  v_session text;
  v_hash text;
  v_action text;
  v_counted bigint;
  v_inserted integer := 0;
BEGIN
  IF NEW.event_name = 'book_engagement_detail' THEN
    v_action := 'detail';
  ELSIF NEW.event_name = 'book_engagement_cart' THEN
    v_action := 'cart';
  ELSE
    RETURN NEW;
  END IF;

  v_book_id := private.kutadgu_resolve_analytics_book_id(NEW.book_id, NEW.legacy_id);
  IF v_book_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_session := btrim(coalesce(NEW.session_id, ''));
  IF v_session = '' THEN
    RETURN NEW;
  END IF;
  v_hash := md5(v_session);

  INSERT INTO private.book_view_engagement_cooldowns AS c (book_id, session_hash, action, last_counted_at)
  VALUES (v_book_id, v_hash, v_action, now())
  ON CONFLICT (book_id, session_hash, action) DO UPDATE
    SET last_counted_at = excluded.last_counted_at
    WHERE c.last_counted_at <= (now() - interval '3 hours')
  RETURNING book_id INTO v_counted;

  IF NOT FOUND OR v_counted IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_action = 'detail' THEN
    INSERT INTO private.book_view_sessions AS s (book_id, session_hash)
    VALUES (v_book_id, v_hash)
    ON CONFLICT (book_id, session_hash) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  INSERT INTO public.book_view_stats AS t (book_id, total_views, unique_views, updated_at)
  VALUES (
    v_book_id,
    1,
    CASE WHEN v_inserted > 0 THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (book_id) DO UPDATE
    SET total_views = t.total_views + 1,
        unique_views = t.unique_views + CASE WHEN v_inserted > 0 THEN 1 ELSE 0 END,
        updated_at = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$stage99$;

REVOKE ALL ON FUNCTION private.kutadgu_apply_book_engagement() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kutadgu_apply_book_engagement() FROM anon;
REVOKE ALL ON FUNCTION private.kutadgu_apply_book_engagement() FROM authenticated;

DROP TRIGGER IF EXISTS analytics_events_apply_book_engagement ON public.analytics_events;
CREATE TRIGGER analytics_events_apply_book_engagement
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW
  WHEN (NEW.event_name = 'book_engagement_detail' OR NEW.event_name = 'book_engagement_cart')
  EXECUTE FUNCTION private.kutadgu_apply_book_engagement();

-- Allow the two engagement names without widening WhatsApp meta rules.
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

COMMIT;

-- No historical add_to_cart backfill.
-- No UPDATE/DELETE of existing book_view_stats rows in this migration body
-- except future +1 increments inside private.kutadgu_apply_book_engagement().
-- books, stock, orders, covers, auth, and search ranking are untouched.
