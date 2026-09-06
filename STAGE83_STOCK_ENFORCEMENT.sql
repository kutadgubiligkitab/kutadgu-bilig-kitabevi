-- ============================================================================
-- Kutadgu Bilig — Stage 83 stock enforcement (PHASE 2)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe after successful installation.
-- Does NOT weaken RLS, grants, AAL2, or create anonymous order APIs.
-- Does NOT backfill book quantities. Does NOT rewrite the historical
-- cancelled order beyond the new column default (stock_committed = false).
-- ============================================================================
--
-- Purpose:
--   Finalize public.books.stock as NOT NULL now that live quantities exist.
--   Enforce race-safe inventory on Admin order status transitions:
--     NOT COMMITTED: prepared, cancelled
--     COMMITTED:     confirmed, processing, shipped, completed
--   prepared member orders remain intention-only (no reservation).
--   Stock is deducted/restored only when crossing those groups.
--
-- Historical first-apply rule:
--   If stock_committed does not yet exist and any order is not prepared
--   or cancelled, abort. Current production has exactly one cancelled order.
--   After the column exists, later committed orders must not abort re-runs.
--
-- Do NOT execute the footer post-check queries as part of apply.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Hard preflight
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_stock_udt text;
  v_stock_nullable text;
  v_null_stock integer;
  v_neg_stock integer;
  v_has_committed_col boolean;
  v_ambiguous_orders integer;
BEGIN
  SELECT c.udt_name, c.is_nullable
    INTO v_stock_udt, v_stock_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'books'
    AND c.column_name = 'stock';

  IF v_stock_udt IS NULL THEN
    RAISE EXCEPTION
      'Stage 83 aborted: public.books.stock was not found. Apply STAGE82_STOCK_FOUNDATION.sql first. This migration will not alter stock or orders.';
  END IF;

  IF v_stock_udt IS DISTINCT FROM 'int4' THEN
    RAISE EXCEPTION
      'Stage 83 aborted: public.books.stock must be integer/int4 (found %). This migration will not alter stock or orders.',
      v_stock_udt;
  END IF;

  SELECT COUNT(*)::integer INTO v_null_stock
  FROM public.books
  WHERE stock IS NULL;

  IF v_null_stock > 0 THEN
    RAISE EXCEPTION
      'Stage 83 aborted: % public.books row(s) still have stock IS NULL. Configure every book quantity before NOT NULL finalization. This migration will not alter stock or orders.',
      v_null_stock;
  END IF;

  SELECT COUNT(*)::integer INTO v_neg_stock
  FROM public.books
  WHERE stock < 0;

  IF v_neg_stock > 0 THEN
    RAISE EXCEPTION
      'Stage 83 aborted: % public.books row(s) have negative stock. This migration will not alter stock or orders.',
      v_neg_stock;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'orders'
      AND c.column_name = 'stock_committed'
  ) INTO v_has_committed_col;

  IF NOT v_has_committed_col THEN
    SELECT COUNT(*)::integer INTO v_ambiguous_orders
    FROM public.orders
    WHERE status IS DISTINCT FROM 'prepared'
      AND status IS DISTINCT FROM 'cancelled';

    IF v_ambiguous_orders > 0 THEN
      RAISE EXCEPTION
        'Stage 83 aborted: public.orders contains % non-cancelled/non-prepared row(s) while stock_committed does not yet exist. Historical inventory state is ambiguous. This migration will not alter stock or orders.',
        v_ambiguous_orders;
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Book stock finalization (NOT NULL, default 0 for future omitted inserts)
-- ---------------------------------------------------------------------------
ALTER TABLE public.books ALTER COLUMN stock SET DEFAULT 0;
ALTER TABLE public.books ALTER COLUMN stock SET NOT NULL;

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_stock_nonnegative_chk;
ALTER TABLE public.books
  ADD CONSTRAINT books_stock_nonnegative_chk
  CHECK (stock >= 0);

COMMENT ON COLUMN public.books.stock IS
  'Physical quantity. 0 = out of stock. 1–3 = low stock. 4+ = in stock. NOT NULL after Stage 83. Status is derived in application code; do not persist stock_status.';

-- ---------------------------------------------------------------------------
-- Internal order inventory state
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stock_committed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.stock_committed IS
  'Trigger-owned inventory flag. false = prepared/cancelled (not committed). true = confirmed/processing/shipped/completed. Clients must not forge this value.';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_stock_committed_matches_status_chk;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_stock_committed_matches_status_chk
  CHECK (
    (
      status IN ('prepared', 'cancelled')
      AND stock_committed = false
    )
    OR (
      status IN ('confirmed', 'processing', 'shipped', 'completed')
      AND stock_committed = true
    )
  );

-- ---------------------------------------------------------------------------
-- Race-safe inventory apply (trigger-only; not a public API)
-- p_sign = -1 deduct, +1 restore
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kutadgu_apply_order_stock_delta(p_items jsonb, p_sign integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem jsonb;
  v_n integer;
  v_i integer;
  v_book_id bigint;
  v_id_text text;
  v_qty integer;
  v_merged integer;
  v_qty_map jsonb := '{}'::jsonb;
  v_ids bigint[] := '{}'::bigint[];
  v_lock record;
  v_locked integer := 0;
  v_needed integer;
  v_avail integer;
  v_rows integer;
BEGIN
  IF p_sign IS DISTINCT FROM -1 AND p_sign IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'invalid_stock_sign';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_order_items';
  END IF;

  v_n := jsonb_array_length(p_items);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'empty_order_items';
  END IF;
  IF v_n > 50 THEN
    RAISE EXCEPTION 'too_many_order_items';
  END IF;

  FOR v_i IN 0 .. v_n - 1 LOOP
    v_elem := p_items -> v_i;
    IF v_elem IS NULL OR jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_order_items';
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
      v_ids := array_append(v_ids, v_book_id);
    END IF;
  END LOOP;

  v_ids := ARRAY(SELECT DISTINCT unnest(v_ids) ORDER BY 1);
  v_needed := coalesce(array_length(v_ids, 1), 0);
  IF v_needed < 1 THEN
    RAISE EXCEPTION 'empty_order_items';
  END IF;

  FOR v_lock IN
    SELECT b.id, b.stock
    FROM public.books AS b
    WHERE b.id = ANY (v_ids)
    ORDER BY b.id
    FOR UPDATE OF b
  LOOP
    v_locked := v_locked + 1;
    v_id_text := v_lock.id::text;
    v_qty := (v_qty_map ->> v_id_text)::integer;
    IF v_lock.stock IS NULL THEN
      RAISE EXCEPTION 'stock_unconfigured'
        USING DETAIL = 'book_id=' || v_lock.id::text;
    END IF;
    v_avail := v_lock.stock;
    IF p_sign = -1 AND v_avail < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_lock.id::text || ' requested=' || v_qty::text || ' available=' || v_avail::text,
              HINT = 'not_enough_stock';
    END IF;
    UPDATE public.books
      SET stock = stock + (p_sign * v_qty)
      WHERE id = v_lock.id
        AND stock + (p_sign * v_qty) >= 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_lock.id::text || ' requested=' || v_qty::text || ' available=' || v_avail::text,
              HINT = 'not_enough_stock';
    END IF;
  END LOOP;

  IF v_locked <> v_needed THEN
    RAISE EXCEPTION 'book_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kutadgu_apply_order_stock_delta(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kutadgu_apply_order_stock_delta(jsonb, integer) FROM anon;
REVOKE ALL ON FUNCTION public.kutadgu_apply_order_stock_delta(jsonb, integer) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Order status trigger: owns stock_committed; same transaction as status change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kutadgu_orders_stock_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_committed boolean;
  v_new_committed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('confirmed', 'processing', 'shipped', 'completed') THEN
      RAISE EXCEPTION 'committed_insert_forbidden';
    END IF;
    NEW.stock_committed := false;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('prepared', 'cancelled', 'confirmed', 'processing', 'shipped', 'completed') THEN
    RAISE EXCEPTION 'invalid_order_status';
  END IF;

  v_old_committed := coalesce(OLD.stock_committed, false);
  v_new_committed := NEW.status IN ('confirmed', 'processing', 'shipped', 'completed');

  IF NEW.items IS DISTINCT FROM OLD.items THEN
    IF v_old_committed OR v_new_committed THEN
      RAISE EXCEPTION 'order_items_immutable';
    END IF;
  END IF;

  IF v_old_committed = v_new_committed THEN
    NEW.stock_committed := v_old_committed;
    RETURN NEW;
  END IF;

  IF (NOT v_old_committed) AND v_new_committed THEN
    PERFORM public.kutadgu_apply_order_stock_delta(OLD.items, -1);
    NEW.stock_committed := true;
    RETURN NEW;
  END IF;

  PERFORM public.kutadgu_apply_order_stock_delta(OLD.items, 1);
  NEW.stock_committed := false;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.kutadgu_orders_stock_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kutadgu_orders_stock_transition() FROM anon;
REVOKE ALL ON FUNCTION public.kutadgu_orders_stock_transition() FROM authenticated;

DROP TRIGGER IF EXISTS orders_stock_transition ON public.orders;
CREATE TRIGGER orders_stock_transition
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.kutadgu_orders_stock_transition();

-- ---------------------------------------------------------------------------
-- Book delete protection: cannot delete a book whose qty is currently committed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kutadgu_prevent_delete_committed_book()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.orders AS o
    CROSS JOIN LATERAL jsonb_array_elements(o.items) AS elem
    WHERE o.stock_committed = true
      AND btrim(elem ->> 'book_id') ~ '^[1-9][0-9]*$'
      AND (btrim(elem ->> 'book_id'))::bigint = OLD.id
  ) INTO v_hit;

  IF v_hit THEN
    RAISE EXCEPTION 'book_has_committed_stock'
      USING DETAIL = 'book_id=' || OLD.id::text;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.kutadgu_prevent_delete_committed_book() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kutadgu_prevent_delete_committed_book() FROM anon;
REVOKE ALL ON FUNCTION public.kutadgu_prevent_delete_committed_book() FROM authenticated;

DROP TRIGGER IF EXISTS books_prevent_delete_committed_stock ON public.books;
CREATE TRIGGER books_prevent_delete_committed_stock
  BEFORE DELETE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.kutadgu_prevent_delete_committed_book();

-- ---------------------------------------------------------------------------
-- create_member_order: stock availability check, NO decrement
-- ---------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.create_member_order(text, jsonb, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_member_order(text, jsonb, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_member_order(text, jsonb, text, text, text, text, text, text) TO authenticated;

COMMIT;

-- RLS: unchanged. books writes remain authenticated Admin + AAL2.
-- Orders UPDATE remains Admin + AAL2 restrictive policy.
-- Direct INSERT on orders remains revoked.
-- No anonymous EXECUTE. No stock_status column. No order-number changes.

-- ============================================================================
-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply.
-- ============================================================================
--
-- 1) books.stock is NOT NULL integer
-- SELECT data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'books' AND column_name = 'stock';
-- -- expect: integer, NO, 0
--
-- 2) no stock NULL rows
-- SELECT COUNT(*) FILTER (WHERE stock IS NULL) AS stock_null
-- FROM public.books;
-- -- expect: 0
--
-- 3) nonnegative constraint
-- SELECT conname, pg_get_constraintdef(oid) AS def
-- FROM pg_constraint
-- WHERE conrelid = 'public.books'::regclass
--   AND conname = 'books_stock_nonnegative_chk';
-- -- expect: CHECK (stock >= 0)
--
-- 4) stock transition trigger exists
-- SELECT tgname, pg_get_triggerdef(t.oid) AS def
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname = 'orders' AND NOT t.tgisinternal
-- ORDER BY tgname;
-- -- expect: orders_stock_transition BEFORE INSERT OR UPDATE
--
-- 5) internal stock state column exists
-- SELECT data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'stock_committed';
-- -- expect: boolean, NO, false
--
-- 6) historical cancelled order has stock_committed=false
-- SELECT id, status, stock_committed
-- FROM public.orders
-- ORDER BY created_at;
-- -- the pre-existing cancelled row must be stock_committed=false
--
-- 7) create_member_order mentions stock, still SECURITY DEFINER
-- SELECT p.prosecdef, pg_get_functiondef(p.oid) AS def
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'create_member_order';
-- -- expect: prosecdef true, body contains insufficient_stock and stock < v_qty
-- -- expect: body does NOT decrement stock
--
-- 8) authenticated execute true / anon execute false
-- SELECT grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public' AND routine_name = 'create_member_order';
--
-- 9) trigger/function uses FOR UPDATE
-- SELECT pg_get_functiondef(p.oid)
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'kutadgu_apply_order_stock_delta';
-- -- expect: ORDER BY b.id / FOR UPDATE OF b
--
-- 10) books/order RLS policy names and counts unchanged
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
-- 11) no anonymous order write grant
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'orders';
-- -- expect: no INSERT to anon/authenticated; no EXECUTE of stock delta to anon
--
-- 12) trigger-only stock functions are not granted to anon/authenticated
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'kutadgu_apply_order_stock_delta',
--     'kutadgu_orders_stock_transition',
--     'kutadgu_prevent_delete_committed_book'
--   );
-- -- expect: anon_exec false, auth_exec false
--
-- ============================================================================
