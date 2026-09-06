-- ============================================================================
-- Kutadgu Bilig — Stage 84 order-number format compatibility
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe: CREATE OR REPLACE of public.create_member_order only.
-- ============================================================================
--
-- Purpose:
--   Production create_member_order currently accepts ONLY:
--     ^KB-[0-9]{6}-[0-9]{4}$
--   The storefront now also generates:
--     KB-YYMMDD-XXXXXXXX
--   with XXXXXXXX from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ.
--
--   This migration replaces ONLY the order-number validation so the RPC
--   accepts BOTH historical 4-digit IDs and new 8-character IDs.
--
-- Production preflight (read-only, already confirmed):
--   - orders.order_no is text, NOT NULL, UNIQUE
--   - create_member_order is SECURITY DEFINER and still takes p_order_no
--   - live RPC regex is still the 4-digit-only pattern above
--
-- This file does NOT:
--   - change orders / books schema
--   - add/drop UNIQUE constraints or indexes
--   - change RLS, policies, grants, or EXECUTE privileges
--   - change stock helpers, stock triggers, or stock_committed rules
--   - generate order numbers in SQL
--   - rewrite existing order rows
--   - add guest/anonymous persistence
--
-- Privileges: CREATE OR REPLACE with the exact existing signature so
-- existing EXECUTE grants are preserved. No GRANT/REVOKE here.
--
-- Do NOT execute the footer post-check queries as part of apply.
-- ============================================================================

BEGIN;

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
  IF v_order_no !~ '^KB-[0-9]{6}-([0-9]{4}|[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8})$' THEN
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
    IF v_book.stock IS NULL THEN
      RAISE EXCEPTION 'stock_unconfigured';
    END IF;
    IF v_book.stock < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_book.id::text || ' requested=' || v_qty::text || ' available=' || v_book.stock::text,
              HINT = 'not_enough_stock';
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

COMMIT;

-- ============================================================================
-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply.
-- ============================================================================
--
-- 1) function is SECURITY DEFINER with search_path = public
-- SELECT p.prosecdef,
--        pg_get_functiondef(p.oid) AS def
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'create_member_order';
-- -- expect: prosecdef true
-- -- expect: SET search_path TO 'public' (or search_path = public)
-- -- expect: body contains BOTH:
-- --   ([0-9]{4}|[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8})
-- -- expect: body still contains insufficient_stock and stock < v_qty
-- -- expect: body does NOT decrement stock
--
-- 2) exact signature unchanged (p_order_no still client-supplied)
-- SELECT pg_get_function_identity_arguments(p.oid)
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'create_member_order';
-- -- expect: p_order_no text, p_items jsonb, p_customer_name text, ...
--
-- 3) authenticated can execute; anon and PUBLIC cannot
-- SELECT grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public' AND routine_name = 'create_member_order'
-- ORDER BY grantee, privilege_type;
-- -- expect: authenticated EXECUTE
-- -- expect: no EXECUTE for anon
-- -- expect: no EXECUTE for PUBLIC
--
-- 4) orders.order_no UNIQUE protection unchanged
-- SELECT conname, pg_get_constraintdef(oid) AS def
-- FROM pg_constraint
-- WHERE conrelid = 'public.orders'::regclass
--   AND contype = 'u'
-- ORDER BY conname;
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'orders'
-- ORDER BY indexname;
-- -- expect: UNIQUE on order_no still present; no extra uniqueness mechanism
--
-- 5) no new stock/order triggers from this migration
-- SELECT tgname, pg_get_triggerdef(t.oid) AS def
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname IN ('orders', 'books')
--   AND NOT t.tgisinternal
-- ORDER BY c.relname, tgname;
-- -- expect: same trigger set as before Stage 84 (no new names)
--
-- 6) policy counts unchanged
-- SELECT tablename, COUNT(*)
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('books', 'orders')
-- GROUP BY tablename
-- ORDER BY tablename;
-- -- expect: books = 8, orders = 4
--
-- SELECT policyname, cmd, roles, permissive
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('books', 'orders')
-- ORDER BY tablename, policyname;
--
-- 7) orders.order_no type unchanged
-- SELECT data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_no';
-- -- expect: text, NO
--
-- Do not INSERT/UPDATE/DELETE as part of these checks.
