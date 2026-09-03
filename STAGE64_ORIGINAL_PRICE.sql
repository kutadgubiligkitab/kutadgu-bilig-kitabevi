-- ============================================================================
-- Kutadgu Bilig — Stage 64 original_price
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT copy price into original_price.
-- Does not rewrite book rows, covers, IDs, sales_count, or RLS/AAL2.
-- ============================================================================
--
-- Purpose:
--   Add public.books.original_price as a nullable numeric(12,2) base price.
--   Existing rows stay NULL until an Admin explicitly initializes them
--   through a safe create/edit save. Current catalog prices are untrusted
--   after accidental bulk zeros and MUST NOT be backfilled here.
--
-- After apply:
--   books.price is unchanged.
--   books.original_price is NULL for every existing row.
--   INSERT/UPDATE still require is_kutadgu_admin() + AAL2.
-- ============================================================================

BEGIN;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS original_price numeric(12,2);

ALTER TABLE public.books ALTER COLUMN original_price DROP NOT NULL;
ALTER TABLE public.books ALTER COLUMN original_price DROP DEFAULT;

COMMENT ON COLUMN public.books.original_price IS
  'Stable/base price. NULL until safely initialized. Never backfilled from current price.';

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_original_price_chk;
ALTER TABLE public.books
  ADD CONSTRAINT books_original_price_chk
  CHECK (original_price IS NULL OR original_price >= 0);

COMMIT;

-- RLS: no new policies. books writes remain authenticated Admin + AAL2.
