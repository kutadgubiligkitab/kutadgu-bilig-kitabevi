-- Removes only the Stage 112 admin cart read function.
-- member_cart_items, its owner policy, and member cart writes stay in place.

begin;

drop function if exists public.admin_member_cart_page(uuid, text);

commit;
