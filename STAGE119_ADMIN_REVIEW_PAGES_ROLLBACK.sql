-- Remove only the STAGE119 admin review page functions.
-- Reviews, replies, older list functions, and moderation functions stay.

begin;

drop function if exists public.admin_book_review_reply_page(text, text, integer);
drop function if exists public.admin_book_review_page(text, text, integer);
drop function if exists public.admin_review_search_pattern(text);

commit;
