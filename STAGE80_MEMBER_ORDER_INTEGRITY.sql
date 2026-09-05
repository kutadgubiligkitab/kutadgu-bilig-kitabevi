-- ============================================================================
-- Kutadgu Bilig — Stage 80 member order integrity
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT delete, rewrite, backfill, or change existing orders.
-- Does NOT change order statuses, totals, items, or customer fields on
-- existing rows. Does NOT alter public.orders / public.books schema.
-- Does NOT weaken Admin AAL2 UPDATE protection.
-- ============================================================================
--
-- Purpose:
--   Authenticated members currently have a direct INSERT policy on
--   public.orders that only checks user_id = auth.uid() AND is_member_active().
--   That does not constrain status, total, total_qty, or item prices, so a
--   browser can forge counted-status / revenue rows.
--
--   Replace member INSERT with public.create_member_order():
--     - auth.uid() required
--     - public.is_member_active() required
--     - user_id always auth.uid()
--     - status always 'prepared'
--     - total / total_qty derived from public.books
--     - item snapshot built from authoritative book rows
--     - client-generated order_no validated (WhatsApp/history reference only)
--
-- After apply:
--   Direct authenticated INSERT on public.orders is revoked.
--   Member SELECT of own orders is unchanged.
--   Admin SELECT / Admin UPDATE / AAL2 restrictive UPDATE are unchanged.
--   Existing order rows are untouched.
-- ============================================================================

BEGIN;

-- Pre-flight: required tables/types exist. Do not alter them.
DO $$
DECLARE
  v_orders_reg regclass;
  v_books_udt text;
BEGIN
  SELECT to_regclass('public.orders') INTO v_orders_reg;
  IF v_orders_reg IS NULL THEN
    RAISE EXCEPTION
      'Stage 80 aborted: public.orders was not found. This migration will not create or alter order rows.';
  END IF;

  SELECT c.udt_name
    INTO v_books_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'books'
    AND c.column_name = 'id';

  IF v_books_udt IS DISTINCT FROM 'int8' THEN
    RAISE EXCEPTION
      'Stage 80 aborted: public.books.id must be bigint/int8 for member order integrity (found %). This migration will not alter books.id.',
      coalesce(v_books_udt, 'missing');
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.create_member_order(text, jsonb, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_member_order(
  p_order_no text,
  p_items jsonb,
  p_customer_name text default '',
  p_customer_phone text default '',
  p_customer_city text default '',
  p_customer_address text default '',
  p_delivery_method text default '',
  p_customer_note text default ''
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_order_no text;
  v_elem jsonb;
  v_n integer;
  v_i integer;
  v_book_id bigint;
  v_id_text text;
  v_qty integer;
  v_merged integer;
  v_qty_map jsonb := '{}'::jsonb;
  v_id_order bigint[] := '{}'::bigint[];
  v_book public.books%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_total numeric(12,2) := 0;
  v_total_qty integer := 0;
  v_line_total numeric(12,2);
  v_name text;
  v_phone text;
  v_city text;
  v_address text;
  v_delivery text;
  v_note text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.is_member_active() IS NOT TRUE THEN
    RAISE EXCEPTION 'Active member required';
  END IF;

  v_order_no := btrim(coalesce(p_order_no, ''));
  IF v_order_no !~ '^KB-[0-9]{6}-[0-9]{4}$' THEN
    RAISE EXCEPTION 'invalid_order_no';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'empty_items';
  END IF;
  IF v_n > 50 THEN
    RAISE EXCEPTION 'too_many_items';
  END IF;

  FOR v_i IN 0 .. v_n - 1 LOOP
    v_elem := p_items -> v_i;
    IF v_elem IS NULL OR jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_items';
    END IF;

    IF jsonb_typeof(v_elem -> 'book_id') IS DISTINCT FROM 'number'
       AND jsonb_typeof(v_elem -> 'book_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_book_id';
    END IF;
    v_id_text := btrim(v_elem ->> 'book_id');
    IF v_id_text IS NULL OR v_id_text !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'invalid_book_id';
    END IF;
    BEGIN
      v_book_id := v_id_text::bigint;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_book_id';
    END;
    IF v_book_id IS NULL OR v_book_id <= 0 THEN
      RAISE EXCEPTION 'invalid_book_id';
    END IF;

    IF jsonb_typeof(v_elem -> 'qty') IS DISTINCT FROM 'number'
       AND jsonb_typeof(v_elem -> 'qty') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_quantity';
    END IF;
    IF btrim(v_elem ->> 'qty') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'invalid_quantity';
    END IF;
    BEGIN
      v_qty := btrim(v_elem ->> 'qty')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_quantity';
    END;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'invalid_quantity';
    END IF;

    IF v_qty_map ? v_id_text THEN
      v_merged := (v_qty_map ->> v_id_text)::integer + v_qty;
      IF v_merged > 99 THEN
        RAISE EXCEPTION 'quantity_too_large';
      END IF;
      v_qty_map := jsonb_set(v_qty_map, ARRAY[v_id_text], to_jsonb(v_merged));
    ELSE
      v_qty_map := v_qty_map || jsonb_build_object(v_id_text, v_qty);
      v_id_order := array_append(v_id_order, v_book_id);
    END IF;
  END LOOP;

  FOREACH v_book_id IN ARRAY v_id_order LOOP
    v_id_text := v_book_id::text;
    v_qty := (v_qty_map ->> v_id_text)::integer;

    SELECT * INTO v_book
    FROM public.books
    WHERE public.books.id = v_book_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'book_not_found';
    END IF;
    IF v_book.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'book_inactive';
    END IF;
    IF v_book.price IS NULL OR v_book.price < 0 THEN
      RAISE EXCEPTION 'invalid_book_price';
    END IF;

    v_line_total := round(v_book.price * v_qty, 2);
    v_total := v_total + v_line_total;
    v_total_qty := v_total_qty + v_qty;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'book_id', v_book.id,
        'title', coalesce(v_book.title, ''),
        'author', coalesce(v_book.author, ''),
        'price', v_book.price,
        'qty', v_qty,
        'line_total', v_line_total
      )
    );
  END LOOP;

  IF jsonb_array_length(v_items) < 1 OR v_total_qty < 1 THEN
    RAISE EXCEPTION 'empty_items';
  END IF;

  v_name := left(btrim(coalesce(p_customer_name, '')), 200);
  v_phone := left(btrim(coalesce(p_customer_phone, '')), 200);
  v_city := left(btrim(coalesce(p_customer_city, '')), 200);
  v_address := left(btrim(coalesce(p_customer_address, '')), 500);
  v_delivery := left(btrim(coalesce(p_delivery_method, '')), 200);
  v_note := left(btrim(coalesce(p_customer_note, '')), 1000);

  RETURN QUERY
  INSERT INTO public.orders (
    order_no,
    user_id,
    status,
    items,
    total,
    total_qty,
    customer_name,
    customer_phone,
    customer_city,
    customer_address,
    delivery_method,
    customer_note
  ) VALUES (
    v_order_no,
    v_uid,
    'prepared',
    v_items,
    v_total,
    v_total_qty,
    v_name,
    v_phone,
    v_city,
    v_address,
    v_delivery,
    v_note
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.create_member_order(text, jsonb, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_member_order(text, jsonb, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_member_order(text, jsonb, text, text, text, text, text, text) TO authenticated;

DROP POLICY IF EXISTS "member can create own orders" ON public.orders;

REVOKE INSERT ON public.orders FROM PUBLIC;
REVOKE INSERT ON public.orders FROM anon;
REVOKE INSERT ON public.orders FROM authenticated;
GRANT SELECT, UPDATE ON public.orders TO authenticated;

COMMIT;
