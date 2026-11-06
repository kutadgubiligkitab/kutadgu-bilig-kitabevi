-- Stage AI Search 2 — bounded public catalog lookup.
-- REVIEWED LOCAL FILE ONLY. Do not apply this to production in this stage.
-- It does not alter existing functions, tables, policies, or grants.
--
-- search_public_catalog_lexical returns at most 24 active, approved books.
-- A description is included only for a matched row, and only its first 2500
-- characters. Published series come from the existing public-series function.
-- Comparisons are literal substring tests. Percent, underscore, and backslash
-- are ordinary characters. NFC matches the worker query normalization and
-- does not change Uyghur case or spelling.
-- EXECUTE is granted to service_role only.
--
-- Release order. Do not run this from the application or from CI.
-- 1. Verify this file and STAGE_AI_SEARCH_2_QUERY_BUDGET.sql on an isolated database.
-- 2. Apply those two files only after that verification. They add new objects.
-- 3. Deploy the AI Search backend only after both functions answer correctly.
--    A missing catalog or budget function refuses paid calls.
-- Rollback: redeploy the previous backend first. These new objects can stay.

BEGIN;

DROP FUNCTION IF EXISTS public.search_public_catalog_lexical(text[], text[], integer);

CREATE FUNCTION public.search_public_catalog_lexical(
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
  series_member_count integer,
  series_group_id bigint,
  series_lowest_price numeric,
  series_image_url text,
  series_representative_id bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $lexical$
  WITH variants AS (
    SELECT DISTINCT left(normalize(btrim(q), NFC), 120) AS q
    FROM unnest(COALESCE(p_queries, ARRAY[]::text[])) AS q
    WHERE char_length(normalize(btrim(q), NFC)) BETWEEN 2 AND 120
    LIMIT 4
  ),
  categories AS (
    SELECT DISTINCT left(normalize(btrim(cat), NFC), 80) AS cat
    FROM unnest(COALESCE(p_categories, ARRAY[]::text[])) AS cat
    WHERE char_length(normalize(btrim(cat), NFC)) BETWEEN 2 AND 80
    LIMIT 8
  ),
  visible_series AS (
    SELECT
      vis.group_id,
      g.public_slug,
      vis.title AS series_title,
      vis.author AS series_author,
      vis.member_count,
      vis.member_book_ids,
      vis.lowest_price,
      vis.representative_book_id,
      vis.representative_image_url
    FROM private.kutadgu_public_volume_groups() AS vis
    JOIN public.book_volume_groups AS g ON g.id = vis.group_id
    WHERE g.public_slug IS NOT NULL
      AND btrim(g.public_slug) <> ''
  ),
  membership AS (
    SELECT
      vs.group_id,
      vs.series_title,
      vs.series_author,
      vs.public_slug AS series_slug,
      vs.member_count,
      vs.lowest_price,
      vs.representative_book_id,
      vs.representative_image_url,
      member_id
    FROM visible_series AS vs
    CROSS JOIN LATERAL unnest(vs.member_book_ids) AS member_id
  ),
  hits AS (
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
      m.member_count AS series_member_count,
      m.group_id AS series_group_id,
      m.lowest_price AS series_lowest_price,
      m.representative_image_url AS series_image_url,
      m.representative_book_id AS series_representative_id,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM variants AS v
          WHERE normalize(b.title, NFC) = v.q
        ) THEN 1
        WHEN EXISTS (
          SELECT 1 FROM variants AS v
          WHERE m.series_title IS NOT NULL
            AND normalize(m.series_title, NFC) = v.q
        ) THEN 2
        WHEN EXISTS (
          SELECT 1 FROM variants AS v
          WHERE char_length(v.q) >= 4
            AND char_length(normalize(b.author, NFC)) >= 4
            AND (
              strpos(normalize(b.author, NFC), v.q) > 0
              OR strpos(v.q, normalize(b.author, NFC)) > 0
            )
        ) THEN 3
        WHEN EXISTS (
          SELECT 1 FROM variants AS v
          WHERE (
              char_length(v.q) >= 3
              AND strpos(normalize(b.title, NFC), v.q) > 0
            )
            OR (
              char_length(normalize(b.title, NFC)) >= 6
              AND strpos(v.q, normalize(b.title, NFC)) > 0
            )
        ) THEN 4
        WHEN EXISTS (
          SELECT 1 FROM variants AS v
          WHERE m.series_title IS NOT NULL
            AND (
              (
                char_length(v.q) >= 3
                AND strpos(normalize(m.series_title, NFC), v.q) > 0
              )
              OR (
                char_length(normalize(m.series_title, NFC)) >= 6
                AND strpos(v.q, normalize(m.series_title, NFC)) > 0
              )
            )
        ) THEN 5
        WHEN EXISTS (
          SELECT 1 FROM variants AS v
          WHERE char_length(v.q) >= 8
            AND strpos(normalize(COALESCE(b.description, ''), NFC), v.q) > 0
        ) THEN 6
        WHEN EXISTS (SELECT 1 FROM categories)
          AND normalize(b.category, NFC) IN (SELECT cat FROM categories) THEN 7
        ELSE NULL
      END AS tier
    FROM public.books AS b
    LEFT JOIN membership AS m ON m.member_id = b.id
    WHERE b.is_active IS TRUE
      AND b.submission_status = 'approved'
  ),
  chosen AS (
    SELECT DISTINCT ON (
      CASE
        WHEN hits.tier = 1 OR hits.series_group_id IS NULL THEN hits.id
        ELSE hits.series_group_id
      END
    )
      hits.*
    FROM hits
    WHERE hits.tier IS NOT NULL
    ORDER BY
      CASE
        WHEN hits.tier = 1 OR hits.series_group_id IS NULL THEN hits.id
        ELSE hits.series_group_id
      END,
      hits.tier,
      (hits.id = hits.series_representative_id) DESC,
      hits.id
  )
  SELECT
    chosen.id,
    chosen.title,
    chosen.author,
    chosen.category,
    chosen.price,
    chosen.image_url,
    chosen.stock,
    chosen.description,
    chosen.series_title,
    chosen.series_slug,
    chosen.series_member_count,
    chosen.series_group_id,
    chosen.series_lowest_price,
    chosen.series_image_url,
    chosen.series_representative_id
  FROM chosen
  ORDER BY chosen.tier, char_length(chosen.title), chosen.id
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
