-- Stage 128 — authoritative complete-set quotes, carts, orders, and inventory.
-- MANUAL / REVIEWED APPLY ONLY. Apply after Stage 127. Do not run from CI.
-- No group is made public by this migration.
--
-- Quote contract:
--   * schema_version 1
--   * 5-minute validity
--   * at most 50 cart intents
--   * each set has 2..100 components
--   * complete_set_price overrides the sum; NULL sums current member prices
--   * fingerprint changes when effective price or membership changes
--
-- Existing create_member_order and flat order JSON remain supported.
-- New set-aware orders use create_member_volume_order. Saved set components,
-- not later membership edits, drive confirmation, cancellation, and deletion
-- protection.
--
-- Rollback: STAGE128_BOOK_VOLUME_COMMERCE_ROLLBACK.sql. The component-aware
-- inventory functions deliberately remain installed while set orders exist.

BEGIN;

CREATE TABLE IF NOT EXISTS public.member_volume_set_cart_items (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id bigint NOT NULL REFERENCES public.book_volume_groups(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  quote_revision text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

COMMENT ON TABLE public.member_volume_set_cart_items IS
  'Explicit complete-set cart intents. Ordinary volume lines remain in member_cart_items.';

ALTER TABLE public.member_volume_set_cart_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "set cart owner access" ON public.member_volume_set_cart_items;
CREATE POLICY "set cart owner access"
  ON public.member_volume_set_cart_items
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_member_active())
  WITH CHECK (user_id = auth.uid() AND public.is_member_active());

REVOKE ALL ON TABLE public.member_volume_set_cart_items FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_volume_set_cart_items TO authenticated;

CREATE OR REPLACE FUNCTION public.kutadgu_order_inventory_lines(p_items jsonb)
RETURNS TABLE(book_id bigint, qty integer)
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $inventory$
  SELECT expanded.book_id, sum(expanded.qty)::integer AS qty
  FROM (
    SELECT
      (item.value->>'book_id')::bigint AS book_id,
      (item.value->>'qty')::integer AS qty
    FROM jsonb_array_elements(p_items) AS item(value)
    WHERE coalesce(item.value->>'kind', 'book') <> 'set'
      AND coalesce(item.value->>'book_id', '') ~ '^[1-9][0-9]*$'
      AND coalesce(item.value->>'qty', '') ~ '^[1-9][0-9]*$'

    UNION ALL

    SELECT
      (component.value->>'book_id')::bigint AS book_id,
      (component.value->>'qty')::integer AS qty
    FROM jsonb_array_elements(p_items) AS item(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(item.value->'components') = 'array' THEN item.value->'components'
        ELSE '[]'::jsonb
      END
    ) AS component(value)
    WHERE item.value->>'kind' = 'set'
      AND coalesce(component.value->>'book_id', '') ~ '^[1-9][0-9]*$'
      AND coalesce(component.value->>'qty', '') ~ '^[1-9][0-9]*$'
  ) AS expanded
  GROUP BY expanded.book_id
  HAVING sum(expanded.qty) BETWEEN 1 AND 9900
  ORDER BY expanded.book_id;
$inventory$;

REVOKE ALL ON FUNCTION public.kutadgu_order_inventory_lines(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_book_volume_cart(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $quote$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz;
  v_n integer;
  v_i integer;
  v_input jsonb;
  v_kind text;
  v_qty integer;
  v_id_text text;
  v_book_id bigint;
  v_group_id bigint;
  v_book public.books%rowtype;
  v_group public.book_volume_groups%rowtype;
  v_members integer;
  v_components jsonb;
  v_items jsonb := '[]'::jsonb;
  v_unit numeric(12,2);
  v_line numeric(12,2);
  v_total numeric(12,2) := 0;
  v_total_qty integer := 0;
  v_revision text;
  v_inventory record;
  v_fingerprint text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'empty_items' USING ERRCODE = '22023';
  END IF;
  IF v_n > 50 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023';
  END IF;
  v_expires := v_now + interval '5 minutes';

  FOR v_i IN 0 .. v_n - 1 LOOP
    v_input := p_items->v_i;
    IF jsonb_typeof(v_input) <> 'object' THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    v_kind := lower(btrim(coalesce(v_input->>'kind', 'book')));
    IF coalesce(v_input->>'qty', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
    END IF;
    v_qty := (v_input->>'qty')::integer;
    IF v_qty NOT BETWEEN 1 AND 99 THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
    END IF;

    IF v_kind = 'book' THEN
      v_id_text := btrim(coalesce(v_input->>'book_id', v_input->>'id', ''));
      IF v_id_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'invalid_book_id' USING ERRCODE = '22023';
      END IF;
      v_book_id := v_id_text::bigint;
      SELECT * INTO v_book
      FROM public.books
      WHERE id = v_book_id
        AND is_active
        AND submission_status = 'approved';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'book_not_found' USING ERRCODE = 'P0002';
      END IF;
      IF v_book.price IS NULL OR v_book.price < 0 THEN
        RAISE EXCEPTION 'invalid_book_price' USING ERRCODE = '22023';
      END IF;
      v_unit := v_book.price;
      v_line := round(v_unit * v_qty, 2);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', 'book',
        'schema_version', 1,
        'book_id', v_book.id,
        'title', coalesce(v_book.title, ''),
        'author', coalesce(v_book.author, ''),
        'price', v_unit,
        'qty', v_qty,
        'physical_qty', v_qty,
        'line_total', v_line
      ));
      v_total := v_total + v_line;
      v_total_qty := v_total_qty + v_qty;
    ELSIF v_kind = 'set' THEN
      v_id_text := btrim(coalesce(v_input->>'group_id', ''));
      IF v_id_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'invalid_group_id' USING ERRCODE = '22023';
      END IF;
      v_group_id := v_id_text::bigint;
      SELECT * INTO v_group
      FROM public.book_volume_groups
      WHERE id = v_group_id AND is_public AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'volume_group_not_found' USING ERRCODE = 'P0002';
      END IF;

      SELECT count(*)::integer,
             coalesce(jsonb_agg(jsonb_build_object(
               'book_id', b.id,
               'position', m.position,
               'volume_label', m.volume_label,
               'title', b.title,
               'author', b.author,
               'price', b.price,
               'qty', v_qty,
               'image_url', b.image_url
             ) ORDER BY m.position), '[]'::jsonb),
             CASE
               WHEN v_group.complete_set_price IS NOT NULL THEN v_group.complete_set_price
               ELSE sum(b.price)
             END
      INTO v_members, v_components, v_unit
      FROM public.book_volume_group_members AS m
      JOIN public.books AS b ON b.id = m.book_id
      WHERE m.group_id = v_group_id
        AND b.is_active
        AND b.submission_status = 'approved'
        AND b.price IS NOT NULL
        AND b.price >= 0;

      IF v_members NOT BETWEEN 2 AND 100
         OR v_members <> (SELECT count(*) FROM public.book_volume_group_members WHERE group_id = v_group_id) THEN
        RAISE EXCEPTION 'volume_group_unavailable' USING ERRCODE = '55000';
      END IF;
      v_revision := public.kutadgu_book_volume_quote_revision(v_group_id);
      v_line := round(v_unit * v_qty, 2);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', 'set',
        'schema_version', 1,
        'group_id', v_group.id,
        'group_revision', v_group.revision,
        'quote_revision', v_revision,
        'title', v_group.title,
        'author', v_group.author,
        'price', v_unit,
        'price_source', CASE WHEN v_group.complete_set_price IS NULL THEN 'sum' ELSE 'explicit' END,
        'qty', v_qty,
        'physical_qty', v_members * v_qty,
        'line_total', v_line,
        'components', v_components
      ));
      v_total := v_total + v_line;
      v_total_qty := v_total_qty + (v_members * v_qty);
    ELSE
      RAISE EXCEPTION 'unsupported_item_kind' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_inventory IN
    SELECT inventory.book_id, inventory.qty, b.stock, b.stock_status
    FROM public.kutadgu_order_inventory_lines(v_items) AS inventory
    LEFT JOIN public.books AS b ON b.id = inventory.book_id
    ORDER BY inventory.book_id
  LOOP
    IF v_inventory.stock IS NULL THEN
      RAISE EXCEPTION 'stock_unconfigured'
        USING DETAIL = 'book_id=' || v_inventory.book_id::text;
    END IF;
    IF btrim(coalesce(v_inventory.stock_status, '')) = 'out_of_stock'
       OR v_inventory.stock < v_inventory.qty THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_inventory.book_id::text ||
                       ' requested=' || v_inventory.qty::text ||
                       ' available=' || v_inventory.stock::text,
              HINT = 'not_enough_stock';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.kutadgu_order_inventory_lines(v_items)) < 1 THEN
    RAISE EXCEPTION 'empty_items' USING ERRCODE = '22023';
  END IF;
  v_fingerprint := md5(v_items::text || '|' || v_total::text || '|' || v_total_qty::text);
  RETURN jsonb_build_object(
    'schema_version', 1,
    'quoted_at', v_now,
    'expires_at', v_expires,
    'fingerprint', v_fingerprint,
    'items', v_items,
    'total', v_total,
    'total_qty', v_total_qty
  );
END;
$quote$;

REVOKE ALL ON FUNCTION public.quote_book_volume_cart(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_book_volume_cart(jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_member_volume_order(
  p_order_no text,
  p_quote jsonb,
  p_customer_name text DEFAULT '',
  p_customer_phone text DEFAULT '',
  p_customer_city text DEFAULT '',
  p_customer_address text DEFAULT '',
  p_delivery_method text DEFAULT '',
  p_customer_note text DEFAULT ''
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $create_volume_order$
DECLARE
  v_uid uuid := auth.uid();
  v_order_no text;
  v_submitted_items jsonb;
  v_fresh jsonb;
  v_submitted_fingerprint text;
  v_expires timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF public.is_member_active() IS NOT TRUE THEN
    RAISE EXCEPTION 'Active member required' USING ERRCODE = '42501';
  END IF;
  v_order_no := btrim(coalesce(p_order_no, ''));
  IF v_order_no !~ '^KB-[0-9]{6}-([0-9]{4}|[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8})$' THEN
    RAISE EXCEPTION 'invalid_order_no' USING ERRCODE = '22023';
  END IF;
  IF p_quote IS NULL OR jsonb_typeof(p_quote) <> 'object'
     OR coalesce((p_quote->>'schema_version')::integer, 0) <> 1
     OR jsonb_typeof(p_quote->'items') <> 'array' THEN
    RAISE EXCEPTION 'invalid_quote' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_expires := (p_quote->>'expires_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_quote' USING ERRCODE = '22023';
  END;
  IF v_expires IS NULL OR v_expires <= clock_timestamp()
     OR v_expires > clock_timestamp() + interval '5 minutes 30 seconds' THEN
    RAISE EXCEPTION 'expired_quote' USING ERRCODE = '40001';
  END IF;

  v_submitted_items := p_quote->'items';
  v_submitted_fingerprint := btrim(coalesce(p_quote->>'fingerprint', ''));
  v_fresh := public.quote_book_volume_cart(v_submitted_items);
  IF v_submitted_fingerprint = ''
     OR v_submitted_fingerprint IS DISTINCT FROM v_fresh->>'fingerprint' THEN
    RAISE EXCEPTION 'stale_quote' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
  INSERT INTO public.orders (
    order_no, user_id, status, items, total, total_qty,
    customer_name, customer_phone, customer_city, customer_address,
    delivery_method, customer_note
  ) VALUES (
    v_order_no,
    v_uid,
    'prepared',
    v_fresh->'items',
    (v_fresh->>'total')::numeric(12,2),
    (v_fresh->>'total_qty')::integer,
    left(btrim(coalesce(p_customer_name, '')), 200),
    left(btrim(coalesce(p_customer_phone, '')), 200),
    left(btrim(coalesce(p_customer_city, '')), 200),
    left(btrim(coalesce(p_customer_address, '')), 500),
    left(btrim(coalesce(p_delivery_method, '')), 200),
    left(btrim(coalesce(p_customer_note, '')), 1000)
  )
  RETURNING *;
END;
$create_volume_order$;

REVOKE ALL ON FUNCTION public.create_member_volume_order(text, jsonb, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_member_volume_order(text, jsonb, text, text, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.kutadgu_apply_order_stock_delta(p_items jsonb, p_sign integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $stock_delta$
DECLARE
  v_line record;
  v_locked integer := 0;
  v_needed integer;
  v_rows integer;
BEGIN
  IF p_sign IS DISTINCT FROM -1 AND p_sign IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'invalid_stock_sign';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_order_items';
  END IF;
  SELECT count(*) INTO v_needed FROM public.kutadgu_order_inventory_lines(p_items);
  IF v_needed < 1 THEN
    RAISE EXCEPTION 'empty_order_items';
  END IF;

  FOR v_line IN
    SELECT inventory.book_id, inventory.qty, b.stock
    FROM public.kutadgu_order_inventory_lines(p_items) AS inventory
    JOIN public.books AS b ON b.id = inventory.book_id
    ORDER BY b.id
    FOR UPDATE OF b
  LOOP
    v_locked := v_locked + 1;
    IF p_sign = -1 AND v_line.stock < v_line.qty THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_line.book_id::text ||
                       ' requested=' || v_line.qty::text ||
                       ' available=' || v_line.stock::text,
              HINT = 'not_enough_stock';
    END IF;
    UPDATE public.books
    SET stock = stock + (p_sign * v_line.qty)
    WHERE id = v_line.book_id
      AND stock + (p_sign * v_line.qty) >= 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_line.book_id::text,
              HINT = 'not_enough_stock';
    END IF;
  END LOOP;
  IF v_locked <> v_needed THEN
    RAISE EXCEPTION 'book_not_found';
  END IF;
END;
$stock_delta$;

REVOKE ALL ON FUNCTION public.kutadgu_apply_order_stock_delta(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kutadgu_prevent_delete_committed_book()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $prevent_delete$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders AS o
    CROSS JOIN LATERAL public.kutadgu_order_inventory_lines(o.items) AS inventory
    WHERE o.stock_committed
      AND inventory.book_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'book_has_committed_stock'
      USING DETAIL = 'book_id=' || OLD.id::text;
  END IF;
  RETURN OLD;
END;
$prevent_delete$;

REVOKE ALL ON FUNCTION public.kutadgu_prevent_delete_committed_book()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS books_prevent_delete_committed_stock ON public.books;
CREATE TRIGGER books_prevent_delete_committed_stock
  BEFORE DELETE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.kutadgu_prevent_delete_committed_book();

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.kutadgu_orders_reject_manual_sold_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $manual_sold_out$
DECLARE
  v_line record;
BEGIN
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN
    RETURN NEW;
  END IF;
  FOR v_line IN
    SELECT inventory.book_id, b.stock_status
    FROM public.kutadgu_order_inventory_lines(NEW.items) AS inventory
    JOIN public.books AS b ON b.id = inventory.book_id
  LOOP
    IF btrim(coalesce(v_line.stock_status, '')) = 'out_of_stock' THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_line.book_id::text,
              HINT = 'manual_sold_out';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$manual_sold_out$;

REVOKE ALL ON FUNCTION private.kutadgu_orders_reject_manual_sold_out()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS orders_reject_manual_sold_out ON public.orders;
CREATE TRIGGER orders_reject_manual_sold_out
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.kutadgu_orders_reject_manual_sold_out();

COMMIT;
