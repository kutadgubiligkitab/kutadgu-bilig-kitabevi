-- Stage AI Search 2 — bounded public catalog lookup.
-- REVIEWED LOCAL FILE ONLY. Do not apply this to production in this stage.
-- It does not alter existing functions, tables, policies, or grants.
--
-- search_public_catalog_lexical returns at most 24 active, approved books.
-- A description is included only for a matched row, and only its first 2500
-- characters. Published series come from the existing public-series function.
-- EXECUTE is granted to service_role only.

BEGIN;

CREATE OR REPLACE FUNCTION public.search_public_catalog_lexical(
  p_queries text[],
  p_categories text[],
  p_limit integer
)
RETURNS TABLE (
  id bigint,
  title text,
  author text,
  category text,
  price numeric,
  image_url text,
  stock integer,
  description text,
  series_title text,
  series_slug text,
  series_member_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $lexical$
  -- safe removes LIKE wildcards. A query made only of % or _ must not match every row.
  WITH variants AS (
    SELECT DISTINCT
      left(btrim(q), 120) AS q,
      replace(replace(left(btrim(q), 120), '%', ''), '_', '') AS safe
    FROM unnest(COALESCE(p_queries, ARRAY[]::text[])) AS q
    WHERE char_length(btrim(q)) BETWEEN 2 AND 120
    LIMIT 4
  ),
  categories AS (
    SELECT DISTINCT left(btrim(cat), 80) AS cat
    FROM unnest(COALESCE(p_categories, ARRAY[]::text[])) AS cat
    WHERE btrim(cat) <> ''
    LIMIT 8
  ),
  visible_series AS (
    SELECT
      g.public_slug,
      vis.title AS series_title,
      vis.member_count,
      vis.member_book_ids
    FROM private.kutadgu_public_volume_groups() AS vis
    JOIN public.book_volume_groups AS g ON g.id = vis.group_id
  ),
  membership AS (
    SELECT
      vs.series_title,
      vs.public_slug AS series_slug,
      vs.member_count,
      member_id
    FROM visible_series AS vs
    CROSS JOIN LATERAL unnest(vs.member_book_ids) AS member_id
  )
  SELECT
    b.id,
    b.title,
    b.author,
    b.category,
    b.price,
    b.image_url,
    b.stock,
    left(b.description, 2500) AS description,
    m.series_title,
    m.series_slug,
    m.member_count AS series_member_count
  FROM public.books AS b
  LEFT JOIN membership AS m ON m.member_id = b.id
  WHERE b.is_active IS TRUE
    AND b.submission_status = 'approved'
    AND (
      EXISTS (
        SELECT 1
        FROM variants AS v
        WHERE b.title = v.q
          OR (
            char_length(v.safe) >= 3
            AND b.title ILIKE '%' || v.safe || '%'
          )
          OR (
            char_length(v.safe) >= 4
            AND b.author ILIKE '%' || v.safe || '%'
          )
          OR (
            char_length(v.safe) >= 8
            AND COALESCE(b.description, '') ILIKE '%' || v.safe || '%'
          )
          OR (
            char_length(v.safe) >= 3
            AND m.series_title ILIKE '%' || v.safe || '%'
          )
      )
      OR (
        EXISTS (SELECT 1 FROM categories)
        AND b.category IN (SELECT cat FROM categories)
      )
    )
  ORDER BY (
    EXISTS (SELECT 1 FROM variants AS v WHERE b.title = v.q)
  ) DESC, b.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 24);
$lexical$;

REVOKE ALL ON FUNCTION public.search_public_catalog_lexical(text[], text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_public_catalog_lexical(text[], text[], integer)
  TO service_role;

COMMENT ON FUNCTION public.search_public_catalog_lexical(text[], text[], integer) IS
  'Bounded read of active approved books and published series for the trusted AI Search worker. Not granted to anon or authenticated.';

NOTIFY pgrst, 'reload schema';

COMMIT;
