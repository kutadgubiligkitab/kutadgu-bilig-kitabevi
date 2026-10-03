-- Kutadgu Bilig — Stage 106 catalog credits rollback
-- MANUAL / REVIEWED APPLY ONLY. Run this file by itself.
-- Drops the Stage 106 trigger, functions, and tables.
-- Does not change books.author, books.translator, books.publisher, book rows,
-- books RLS, or the mobile-app text columns.

begin;

drop trigger if exists books_catalog_credits_sync on public.books;

drop function if exists public.set_own_pending_book_credits(bigint, jsonb, jsonb, text);
drop function if exists public.set_book_credits(bigint, jsonb, jsonb, text);
drop function if exists public.books_catalog_credits_sync();
drop function if exists public.catalog_sync_role_from_legacy(bigint, text, text, text);
drop function if exists public.catalog_write_role_credits(bigint, text, jsonb);
drop function if exists public.catalog_credit_legacy_join(text[]);
drop function if exists public.catalog_credit_legacy_ambiguous(text);
drop function if exists public.catalog_identity_key(text);

drop table if exists public.catalog_credit_review;
drop table if exists public.book_credits;
drop table if exists public.catalog_identities;

commit;
