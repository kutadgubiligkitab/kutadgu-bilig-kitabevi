-- Rolls back STAGE120_WEBSITE_FEEDBACK.sql.
-- Dropping public.website_feedback deletes every stored suggestion.
-- Profiles, reviews, replies, carts, favorites, and analytics stay.
-- Run this file alone. Do not run it against production unless that deletion is intended.

begin;

drop function if exists public.submit_website_feedback(uuid, text);
drop function if exists public.admin_website_feedback_page(integer);
drop table if exists public.website_feedback;

commit;
