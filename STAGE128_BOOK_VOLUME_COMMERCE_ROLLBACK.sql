-- Stage 128 data-preserving rollback.
-- Run by itself. It disables new set quotes/orders and member set-cart writes,
-- but retains all data and the component-aware inventory/deletion functions.
-- Never restore the pre-Stage-128 stock parser while any set order exists.

BEGIN;

UPDATE public.book_volume_groups SET is_public = false WHERE is_public;

REVOKE ALL ON FUNCTION public.quote_book_volume_cart(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_member_volume_order(text, jsonb, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.member_volume_set_cart_items
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep:
--   public.kutadgu_order_inventory_lines(jsonb)
--   public.kutadgu_apply_order_stock_delta(jsonb, integer)
--   public.kutadgu_prevent_delete_committed_book()
--   private.kutadgu_orders_reject_manual_sold_out()
--   member_volume_set_cart_items rows
--   book_volume_groups and memberships
-- Existing prepared/committed set orders must remain confirmable, cancellable,
-- restorable, and protected from component deletion.

COMMIT;
