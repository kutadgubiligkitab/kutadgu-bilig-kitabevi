-- Rolls back STAGE122_GIFT_BOOK_OFFERS.sql.
-- Drops the gift-offer table and the two gift functions.
-- Does not drop public.books, book policies, profiles, or admin helpers.
-- Reapplying STAGE122 after this rollback starts from an empty offer list.

begin;

-- Drop the table first. Its policies depend on gift_book_is_requestable,
-- and dropping the table removes those policies and the touch trigger.
drop table if exists public.gift_book_offers;
drop function if exists public.gift_book_is_requestable(bigint);
drop function if exists public.gift_book_offers_touch();

commit;
