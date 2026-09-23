-- ============================================================================
-- Kutadgu Bilig — Stage 85 optional storefront stock-status override
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT backfill. Does NOT rewrite book rows or stock quantities.
-- Does NOT change RLS, grants, or authentication.
-- ============================================================================
--
-- Purpose:
--   Add public.books.stock_status as a nullable text override for public badges
--   and buying. Numeric books.stock remains the source of quantity.
--
-- Allowed values:
--   NULL or ''     = Automatic (derive from books.stock)
--   in_stock       = show in stock (blocked if stock = 0)
--   low_stock      = show ئاز قالدى (blocked if stock = 0)
--   out_of_stock   = sold out even when stock > 0
--
-- Backward compatible: existing rows stay NULL/''. Mobile apps that ignore
-- unknown columns continue to work.
-- ============================================================================

BEGIN;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS stock_status text;

ALTER TABLE public.books ALTER COLUMN stock_status DROP NOT NULL;
ALTER TABLE public.books ALTER COLUMN stock_status DROP DEFAULT;

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_stock_status_allowed_chk;
ALTER TABLE public.books
  ADD CONSTRAINT books_stock_status_allowed_chk
  CHECK (
    stock_status IS NULL
    OR btrim(stock_status) = ''
    OR stock_status IN ('in_stock', 'low_stock', 'out_of_stock')
  );

COMMENT ON COLUMN public.books.stock_status IS
  'Optional public stock-status override. NULL/blank = Automatic from books.stock. in_stock / low_stock / out_of_stock. stock = 0 always sold out in application and new-order checks.';

CREATE SCHEMA IF NOT EXISTS private;

-- Internal trigger function: keep SECURITY DEFINER code out of the API-exposed
-- public schema, use an empty search_path, and fully qualify table references.
DROP TRIGGER IF EXISTS orders_reject_manual_sold_out ON public.orders;
DROP FUNCTION IF EXISTS public.kutadgu_orders_reject_manual_sold_out();

CREATE OR REPLACE FUNCTION private.kutadgu_orders_reject_manual_sold_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $stage85$
DECLARE
  v_elem jsonb;
  v_i integer;
  v_n integer;
  v_id_text text;
  v_book_id bigint;
  v_status text;
BEGIN
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;
  v_n := jsonb_array_length(NEW.items);
  IF v_n < 1 THEN
    RETURN NEW;
  END IF;
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_elem := NEW.items -> v_i;
    IF v_elem IS NULL OR jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
      CONTINUE;
    END IF;
    v_id_text := btrim(v_elem ->> 'book_id');
    IF v_id_text IS NULL OR v_id_text !~ '^[1-9][0-9]*$' THEN
      CONTINUE;
    END IF;
    BEGIN
      v_book_id := v_id_text::bigint;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
    SELECT b.stock_status INTO v_status
    FROM public.books AS b
    WHERE b.id = v_book_id;
    IF FOUND AND btrim(coalesce(v_status, '')) = 'out_of_stock' THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING DETAIL = 'book_id=' || v_book_id::text,
              HINT = 'manual_sold_out';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$stage85$;

REVOKE ALL ON FUNCTION private.kutadgu_orders_reject_manual_sold_out() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kutadgu_orders_reject_manual_sold_out() FROM anon;
REVOKE ALL ON FUNCTION private.kutadgu_orders_reject_manual_sold_out() FROM authenticated;

CREATE TRIGGER orders_reject_manual_sold_out
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.kutadgu_orders_reject_manual_sold_out();

COMMIT;

-- RLS: unchanged.
-- No UPDATE of public.books rows. No stock quantity rewrite. No DELETE.

-- ============================================================================
-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply.
-- ============================================================================
--
-- SELECT column_name, is_nullable, column_default, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'books' AND column_name = 'stock_status';
-- -- expect: text, YES, NULL default
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.books'::regclass AND conname = 'books_stock_status_allowed_chk';
--
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
-- WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal
--   AND tgname = 'orders_reject_manual_sold_out';
--
-- SELECT n.nspname AS schema_name, p.proname, p.prosecdef, p.proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE p.proname = 'kutadgu_orders_reject_manual_sold_out';
-- -- expect schema_name = private and search_path = ""
-- ============================================================================
