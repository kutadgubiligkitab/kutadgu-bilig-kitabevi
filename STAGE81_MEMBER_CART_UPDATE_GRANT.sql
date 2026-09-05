-- ============================================================================
-- Kutadgu Bilig — Stage 81 member_cart_items UPDATE grant
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT rewrite cart rows. Does NOT alter RLS.
-- ============================================================================
--
-- Purpose:
--   Authenticated members already have SELECT/INSERT/DELETE on
--   public.member_cart_items. Table-level UPDATE is missing, so quantity
--   changes had to DELETE the row and INSERT it again. A failure between
--   those two statements could drop the item from the cloud cart.
--
--   Grant UPDATE so quantity can be changed in place.
--
-- This migration ONLY:
--   GRANT UPDATE ON public.member_cart_items TO authenticated;
--
-- This migration does NOT:
--   - drop or recreate "cart owner access"
--   - change is_member_active()
--   - change user_id ownership checks
--   - grant UPDATE on member_favorites
--   - change orders privileges
--   - change Admin privileges
--   - rewrite, delete, or backfill cart rows
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.member_cart_items') IS NULL THEN
    RAISE EXCEPTION
      'Stage 81 aborted: public.member_cart_items was not found. This migration will not create or alter cart rows.';
  END IF;
END
$$;

-- Confirm owner RLS is already present. Do not drop, recreate, or loosen it.
DO $$
DECLARE
  v_pol oid;
BEGIN
  SELECT p.oid
    INTO v_pol
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'member_cart_items'
    AND p.polname = 'cart owner access';

  IF v_pol IS NULL THEN
    RAISE EXCEPTION
      'Stage 81 aborted: policy "cart owner access" is missing. This migration will not recreate or loosen RLS.';
  END IF;
END
$$;

GRANT UPDATE ON public.member_cart_items TO authenticated;

COMMIT;
