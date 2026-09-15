-- ============================================================================
-- Kutadgu Bilig — Stage AI Search 1C vector foundation
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT rewrite book rows, covers, IDs, or catalog data.
-- Does NOT alter public.books columns, indexes, or RLS policies.
-- Does NOT call OpenAI. Does NOT write embeddings. Does NOT change Search 1A/1B.
-- ============================================================================
--
-- Purpose:
--   Additive pgvector storage for a future AI semantic search path.
--   Keep the live catalog isolated in public.books. Store vectors only in
--   public.book_embeddings. Public clients must not dump raw vectors.
--
-- Design:
--   - vector(1536) so later embedding calls can request
--     model text-embedding-3-large with dimensions: 1536
--     (lower storage/cost vs the model's native 3072).
--   - Exact cosine search (<=>). No HNSW / IVFFLAT.
--     Catalog size is ~147 active books; ANN indexes add operational
--     complexity without a measurable benefit at this scale.
--   - Public match RPC re-applies production publication rules because
--     SECURITY DEFINER bypasses RLS.
--
-- Production publication rules used by this RPC (verified in-repo):
--   Storefront / REST: is_active = true
--     (shop.js remoteBooksUrl, kutadgu-public-book.js, STAGE2B SELECT RLS)
--   Staff submissions: is_active = false AND submission_status = 'pending'
--     until Admin+AAL2 approve (STAGE92).
--   This RPC requires BOTH:
--     books.is_active IS TRUE
--     books.submission_status = 'approved'
--   is_available is NOT used: it is not part of public books SELECT RLS
--   and STAGE92 did not backfill it on existing catalog rows. Filtering
--   on it could hide books the storefront currently shows.
--
-- After apply:
--   extensions.vector is available.
--   public.book_embeddings exists, RLS enabled, no public SELECT policy.
--   public.match_active_books_ai(query_embedding, match_count) exists.
--   books table, Search 1A/1B, cart, wishlist, auth, Admin, Book Staff
--   are unchanged.
--
-- Depends on:
--   public.books.id bigint
--   public.books.is_active
--   public.books.submission_status  (STAGE92)
--   public.books.title, author, category, price, image_url, stock
--   Supabase extensions schema (standard hosted projects)
-- ============================================================================

BEGIN;

-- Pre-flight: books identity and publication columns must already exist.
-- Do not ALTER public.books. Fail closed if production schema is unexpected.
DO $$
DECLARE
  v_id_udt text;
  v_missing text;
BEGIN
  SELECT c.udt_name
    INTO v_id_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'books'
    AND c.column_name = 'id';

  IF v_id_udt IS NULL THEN
    RAISE EXCEPTION 'public.books.id is missing';
  END IF;
  IF v_id_udt IS DISTINCT FROM 'int8' THEN
    RAISE EXCEPTION 'public.books.id must be bigint/int8, found %', v_id_udt;
  END IF;

  SELECT string_agg(req.col, ', ' ORDER BY req.col)
    INTO v_missing
  FROM (
    VALUES
      ('is_active'),
      ('submission_status'),
      ('title'),
      ('author'),
      ('category'),
      ('price'),
      ('image_url'),
      ('stock')
  ) AS req(col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'books'
   AND c.column_name = req.col
  WHERE c.column_name IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'public.books is missing columns required by match_active_books_ai: %', v_missing;
  END IF;
END
$$;

-- A) pgvector in the Supabase-supported extensions schema (not public).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- B) AI-only embeddings table. Isolated from the catalog row.
CREATE TABLE IF NOT EXISTS public.book_embeddings (
  book_id bigint PRIMARY KEY
    REFERENCES public.books(id) ON DELETE CASCADE,
  embedding extensions.vector(1536) NOT NULL,
  embedding_model text NOT NULL,
  source_text_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT book_embeddings_embedding_model_nonempty_chk
    CHECK (btrim(embedding_model) <> ''),
  CONSTRAINT book_embeddings_source_text_hash_nonempty_chk
    CHECK (btrim(source_text_hash) <> '')
);

COMMENT ON TABLE public.book_embeddings IS
  'AI Search 1C: per-book embedding vectors. Isolated from public.books. Do not SELECT from the browser. No ANN index at ~147 active books; exact cosine (<=>) is enough.';

COMMENT ON COLUMN public.book_embeddings.embedding IS
  'text-embedding-3-large truncated/requested at 1536 dimensions.';

COMMENT ON COLUMN public.book_embeddings.embedding_model IS
  'Expected writer value: text-embedding-3-large. No default so writers must record the real model.';

COMMENT ON COLUMN public.book_embeddings.source_text_hash IS
  'Hash of the text that was embedded, for later cache invalidation. Not a secret.';

-- No HNSW / IVFFLAT / ANN index on embedding. Exact <=> scan is acceptable
-- for ~147 active books and avoids index build/maintenance on an empty table.

DROP TRIGGER IF EXISTS book_embeddings_touch_updated_at ON public.book_embeddings;
CREATE TRIGGER book_embeddings_touch_updated_at
  BEFORE UPDATE ON public.book_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- C) SECURITY: RLS on, no public SELECT of raw vectors.
ALTER TABLE public.book_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_embeddings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.book_embeddings FROM PUBLIC;
REVOKE ALL ON TABLE public.book_embeddings FROM anon;
REVOKE ALL ON TABLE public.book_embeddings FROM authenticated;

DROP POLICY IF EXISTS "public can read book embeddings" ON public.book_embeddings;
DROP POLICY IF EXISTS "anon can read book embeddings" ON public.book_embeddings;
DROP POLICY IF EXISTS "authenticated can read book embeddings" ON public.book_embeddings;

-- Intentionally no SELECT/INSERT/UPDATE/DELETE policies.
-- Anon and authenticated cannot read or write rows through PostgREST.
-- service_role (future embedding writer) bypasses RLS by design.
-- Do not add a broad public SELECT policy.

-- D) Narrow public match RPC. Never returns embedding.
CREATE OR REPLACE FUNCTION public.match_active_books_ai(
  query_embedding extensions.vector(1536),
  match_count integer DEFAULT 12
)
RETURNS TABLE (
  id bigint,
  title text,
  author text,
  category text,
  price numeric,
  image_url text,
  stock integer,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    b.id,
    b.title,
    b.author,
    b.category,
    b.price,
    b.image_url,
    b.stock,
    (1 - (e.embedding <=> query_embedding))::double precision AS similarity
  FROM public.book_embeddings AS e
  INNER JOIN public.books AS b
    ON b.id = e.book_id
  WHERE query_embedding IS NOT NULL
    AND b.is_active IS TRUE
    AND b.submission_status = 'approved'
  ORDER BY e.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(COALESCE(match_count, 12), 1), 24);
$$;

COMMENT ON FUNCTION public.match_active_books_ai(extensions.vector, integer) IS
  'AI Search 1C foundation: exact cosine match against book_embeddings joined to public/active approved books only. Does not return raw vectors. match_count is capped at 24. Not wired to the storefront in this stage.';

REVOKE ALL ON FUNCTION public.match_active_books_ai(extensions.vector, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_active_books_ai(extensions.vector, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.match_active_books_ai(extensions.vector, integer) TO authenticated;

COMMIT;

-- ============================================================================
-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply.
-- ============================================================================
--
-- 1) vector extension
-- SELECT extname, nspname
-- FROM pg_extension e
-- JOIN pg_namespace n ON n.oid = e.extnamespace
-- WHERE extname = 'vector';
-- -- expect: vector | extensions
--
-- 2) table + RLS
-- SELECT c.relrowsecurity, c.relforcerowsecurity
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname = 'book_embeddings';
-- -- expect: true, true
--
-- 3) no public SELECT policy
-- SELECT polname, polcmd, polroles::regrole[]
-- FROM pg_policy
-- WHERE polrelid = 'public.book_embeddings'::regclass;
-- -- expect: 0 rows
--
-- 4) RPC filter
-- SELECT pg_get_functiondef('public.match_active_books_ai(extensions.vector, integer)'::regprocedure);
-- -- expect: is_active IS TRUE AND submission_status = 'approved'
-- -- expect: no embedding column in RETURNS
-- -- expect: SET search_path TO 'public, extensions, pg_temp' (or equivalent)
-- -- expect: no hnsw / ivfflat
-- ============================================================================
