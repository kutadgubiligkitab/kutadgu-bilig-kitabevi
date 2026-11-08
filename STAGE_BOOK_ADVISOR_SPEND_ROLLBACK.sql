-- Removes only the GPT Book Advisor ledger. Does not drop the private schema
-- and does not alter AI Search, catalog, or series objects.

BEGIN;

DROP FUNCTION IF EXISTS public.book_advisor_session_save(uuid, text, bigint[]);
DROP FUNCTION IF EXISTS public.book_advisor_session_read(uuid, text);
DROP FUNCTION IF EXISTS public.book_advisor_session_create(text, bigint[]);
DROP FUNCTION IF EXISTS public.release_book_advisor_spend(uuid);
DROP FUNCTION IF EXISTS public.settle_book_advisor_spend(uuid, bigint);
DROP FUNCTION IF EXISTS public.reserve_book_advisor_spend(text, bigint);

DROP FUNCTION IF EXISTS private.book_advisor_session_save(uuid, text, bigint[]);
DROP FUNCTION IF EXISTS private.book_advisor_session_read(uuid, text);
DROP FUNCTION IF EXISTS private.book_advisor_session_create(text, bigint[]);
DROP FUNCTION IF EXISTS private.release_book_advisor_spend(uuid);
DROP FUNCTION IF EXISTS private.settle_book_advisor_spend(uuid, bigint);
DROP FUNCTION IF EXISTS private.reserve_book_advisor_spend(text, bigint);

DROP TABLE IF EXISTS private.book_advisor_sessions;
DROP TABLE IF EXISTS private.book_advisor_rate;
DROP TABLE IF EXISTS private.book_advisor_reservations;
DROP TABLE IF EXISTS private.book_advisor_spend;
DROP TABLE IF EXISTS private.book_advisor_policy;

COMMIT;
