-- ============================================================================
-- Kutadgu Bilig — Stage AI Search 1G-2 category lookup
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT rewrite book rows, embeddings, or catalog data.
-- Does NOT alter public.books columns, indexes, or RLS policies.
-- Does NOT replace public.match_active_books_ai.
-- ============================================================================
--
-- Purpose:
--   Read-only exact-category lookup for AI Search strong-intent recovery.
--   Lets the backend include active+approved books whose category matches
--   an explicit intent list even if they were omitted from vector top-24.
--
-- Security:
--   SECURITY INVOKER so table RLS still applies.
--   Function also requires is_active = true AND submission_status = 'approved'.
--   Exact category equality only. Hard cap 24. Public fields only.
--   No embeddings. No writes. No service_role.
--
-- After apply:
--   public.list_active_books_by_categories_ai(categories text[], match_count integer)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(req.col, ', ' ORDER BY req.col)
    INTO v_missing
  FROM (
    VALUES
      ('id'),
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
    RAISE EXCEPTION 'public.books is missing columns required by list_active_books_by_categories_ai: %', v_missing;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.list_active_books_by_categories_ai(
  categories text[],
  match_count integer DEFAULT 24
)
RETURNS TABLE (
  id bigint,
  title text,
  author text,
  category text,
  price numeric,
  image_url text,
  stock integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    b.id,
    b.title,
    b.author,
    b.category,
    b.price,
    b.image_url,
    b.stock
  FROM public.books AS b
  WHERE categories IS NOT NULL
    AND cardinality(categories) > 0
    AND b.is_active IS TRUE
    AND b.submission_status = 'approved'
    AND b.category = ANY (categories)
  ORDER BY b.id
  LIMIT LEAST(GREATEST(COALESCE(match_count, 24), 1), 24);
$$;

COMMENT ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) IS
  'AI Search 1G-2: read-only exact category lookup of active approved books. Public fields only. Cap 24. Does not return embeddings or write data.';

REVOKE ALL ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) TO anon;
GRANT EXECUTE ON FUNCTION public.list_active_books_by_categories_ai(text[], integer) TO authenticated;

COMMIT;
