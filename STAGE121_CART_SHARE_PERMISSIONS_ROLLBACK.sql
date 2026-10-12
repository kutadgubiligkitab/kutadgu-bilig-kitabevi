-- Rolls back STAGE121_CART_SHARE_PERMISSIONS.sql.
-- Drops the cart-share permission functions and both permission tables.
-- Saved individual grants and the global flag are deleted.
-- Does not drop public.shared_cart_links, create_shared_cart_link, profiles,
-- admin helpers, feedback, reviews, or analytics.
-- Existing short links remain readable. New authenticated creation stops
-- because create_member_shared_cart_link is gone. That function stores
-- database now() plus 30 days and rejects a longer caller timestamp.
-- Reapplying STAGE121 after this rollback starts again from global off and
-- no grants. Link rows are not restored or deleted by either file.

begin;

drop function if exists public.create_member_shared_cart_link(text, jsonb, timestamptz);
drop function if exists public.admin_set_cart_share_grant(uuid, boolean);
drop function if exists public.admin_set_cart_share_global(boolean);
drop function if exists public.admin_cart_share_state(uuid[]);
drop function if exists public.my_cart_share_permission();

drop table if exists public.cart_share_grants;
drop table if exists public.cart_share_settings;

commit;
