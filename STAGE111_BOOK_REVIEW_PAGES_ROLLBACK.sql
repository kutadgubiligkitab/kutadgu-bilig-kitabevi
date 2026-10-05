-- Removes the Stage 111 page and target functions.
-- The one-argument admin list functions from Stage 108 and Stage 109 remain.

begin;

drop function if exists public.public_book_review_reply_target(uuid);
drop function if exists public.admin_list_book_review_replies(text, timestamptz, uuid);
drop function if exists public.admin_list_book_reviews(text, timestamptz, uuid);

commit;
