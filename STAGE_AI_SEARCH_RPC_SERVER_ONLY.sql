-- Server-only execute grants for the AI search RPCs.
-- The Cloudflare production Worker calls these with SUPABASE_SECRET_KEY,
-- which authenticates as service_role. Browser and mobile clients keep
-- calling /api/ai-search and never receive that key.
-- Idempotent. Does not change function bodies, RLS, Storage, or catalog rows.

BEGIN;

REVOKE ALL ON FUNCTION public.match_active_books_ai(extensions.vector, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_active_books_ai(extensions.vector, integer) FROM anon;
REVOKE ALL ON FUNCTION public.match_active_books_ai(extensions.vector, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_active_books_ai(extensions.vector, integer) TO service_role;

REVOKE ALL ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) FROM anon;
REVOKE ALL ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) TO service_role;

COMMIT;
