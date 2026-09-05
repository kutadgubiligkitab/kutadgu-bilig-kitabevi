-- ============================================================================
-- Kutadgu Bilig — Stage 82 stock foundation (PHASE 1)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT backfill stock. Does NOT rewrite book rows.
-- Does NOT change RLS, grants, order functions, or order triggers.
-- ============================================================================
--
-- Purpose:
--   Add public.books.stock as a nullable integer so Admin can enter the real
--   physical quantity of existing production books.
--
-- Semantics (application-derived; NOT a database column):
--   NULL  = stock quantity has not been configured yet (NOT out of stock)
--   0     = out of stock
--   1–3   = low stock
--   4+    = in stock
--
-- Existing production rows MUST remain stock IS NULL after this migration.
-- Do NOT default existing books to 0, 1, 10, or any inferred quantity.
-- Do NOT persist stock_status. Status is derived from stock in application code.
--
-- After apply:
--   books.stock exists, is integer, is nullable, has no default.
--   All pre-existing rows stay NULL until Admin saves a real quantity.
--   INSERT/UPDATE still require is_kutadgu_admin() + AAL2.
--   create_member_order() is unchanged (no stock check / decrement).
-- ============================================================================

BEGIN;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS stock integer;

ALTER TABLE public.books ALTER COLUMN stock DROP NOT NULL;
ALTER TABLE public.books ALTER COLUMN stock DROP DEFAULT;

COMMENT ON COLUMN public.books.stock IS
  'Physical quantity. NULL = not configured yet (NOT out of stock). 0 = out of stock. 1–3 = low stock. 4+ = in stock. Never backfilled.';

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_stock_nonnegative_chk;
ALTER TABLE public.books
  ADD CONSTRAINT books_stock_nonnegative_chk
  CHECK (stock IS NULL OR stock >= 0);

COMMIT;

-- RLS: no new policies. books writes remain authenticated Admin + AAL2.
-- Grants: unchanged.
-- Orders: create_member_order() / order triggers / order status UPDATE unchanged.
-- No stock_status column. No backfill UPDATE.

-- ============================================================================
-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply. Review, then
-- execute these SELECTs in the SQL Editor after applying the migration above.
-- ============================================================================
--
-- 1) stock column exists
-- SELECT EXISTS (
--   SELECT 1
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'books'
--     AND column_name = 'stock'
-- ) AS stock_column_exists;
--
-- 2) stock data type = integer
-- SELECT data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'books'
--   AND column_name = 'stock';
-- -- expect: integer
--
-- 3) stock is nullable
-- SELECT is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'books'
--   AND column_name = 'stock';
-- -- expect: YES
--
-- 4) all pre-existing active books are still stock IS NULL immediately after migration
-- SELECT COUNT(*) AS active_books,
--        COUNT(*) FILTER (WHERE stock IS NULL) AS active_stock_null,
--        COUNT(*) FILTER (WHERE stock IS NOT NULL) AS active_stock_set
-- FROM public.books
-- WHERE is_active = true;
-- -- expect: active_stock_set = 0 (26 active books remain NULL)
--
-- 5) nonnegative CHECK constraint exists
-- SELECT conname, pg_get_constraintdef(oid) AS def
-- FROM pg_constraint
-- WHERE conrelid = 'public.books'::regclass
--   AND conname = 'books_stock_nonnegative_chk';
-- -- expect: CHECK (stock IS NULL OR stock >= 0)
--
-- 6) no RLS policies changed (compare to pre-apply snapshot)
-- SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('books', 'orders')
-- ORDER BY tablename, policyname;
--
-- 7) no order functions / triggers changed
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname = 'create_member_order';
--
-- SELECT tgname, tgtype, pg_get_triggerdef(t.oid) AS def
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname IN ('books', 'orders')
--   AND NOT t.tgisinternal
-- ORDER BY c.relname, tgname;
--
-- ============================================================================
