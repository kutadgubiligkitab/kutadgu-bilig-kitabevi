-- Drops only the admin member directory page function.
-- profiles, orders, member_cart_items, and their policies stay in place.

begin;

drop function if exists public.admin_member_directory_page(text, text, text, integer);

commit;
