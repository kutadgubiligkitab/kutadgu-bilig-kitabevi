-- Removes the book-review table, policies, and functions from STAGE107_BOOK_REVIEWS.sql.
-- Apply by hand only. This does not change books, profiles, or admin_users.

begin;

drop trigger if exists book_reviews_before_insert on public.book_reviews;
drop function if exists public.moderate_book_review(uuid, text);
drop function if exists public.my_book_review_status(bigint);
drop function if exists public.book_reviews_before_insert();
drop table if exists public.book_reviews;

commit;
