-- Stage AI Search 2 — bounded public catalog lookup.
-- REVIEWED LOCAL FILE ONLY. Do not apply this to production in this stage.
-- It does not alter existing function bodies, tables, or policies.
--
-- search_public_catalog_lexical returns at most 24 active, approved books.
-- A description is included only for a matched row, and only its first 2500
-- characters. description_matched says whether the full description contained
-- a submitted query variant, or at least two meaningful query terms in the
-- title or description. A term shorter than five characters does not count
-- toward that two-stem score. A stem of three or four characters counts only
-- when it occurs in at most six active approved titles, and only together
-- with a stem of at least six characters that itself occurs in at most forty
-- active approved books. The pair has to be in the same book. That extra row
-- scores below the existing two-stem matches. A short stem by itself, or a
-- short stem plus only a common or five-character word, still matches nothing.
-- One closed set of Uyghur endings is removed from a longer word, and a final
-- ە/ى on that stem is treated as the same stem. Two closed families also share
-- one key: تەربىيەسى / تەربىيىسى / تەربىيلەش, and ئاتا-ئانا / ئاتا-ئانىلار.
-- Common function words do not
-- count. Two short common words are not enough: one matched stem must be at
-- least six characters. Term matches are scored by title evidence, match
-- count, and stem length, and that score is applied before the 24-row cap.
-- The worker uses that flag internally and does not
-- send it, or the rest of the description, to the browser.
-- category_matched says the query is exactly a visible category label from
-- public.book_categories. Hidden and retired labels do not match. The worker
-- uses that flag internally and does not send it to the browser. An exact
-- label is ranked after an exact title, exact series title, or author, and
-- before a partial title or a broader category phrase. This file does not
-- grant a new table privilege and does not change the category directory.
-- Published series come from the existing public-series function.
-- Comparisons are literal substring tests. Percent, underscore, and backslash
-- are ordinary characters. NFC matches the worker query normalization and
-- does not change Uyghur case or spelling.
-- EXECUTE on the new catalog function is granted to service_role only.
--
-- Release note: the AI Search worker also calls the existing
-- public.list_public_book_series_routes() with the server key. Stage 138
-- already grants that read-only directory to anon and authenticated. It does
-- not grant service_role. This file adds only that missing EXECUTE privilege.
-- The function body and its public-series filter stay as Stage 138 defined
-- them, so the grant exposes the same published directory and no private group.
-- Stage 138 must already be installed. This file does not reapply it.
--
-- Release order. Do not run this from the application or from CI.
-- 1. Confirm Stage 132 categories and Stage 138 public series routes are already
--    installed. Do not reapply those files.
-- 2. Verify this file and STAGE_AI_SEARCH_2_QUERY_BUDGET.sql on an isolated database.
-- 3. Apply STAGE_AI_SEARCH_2_QUERY_BUDGET.sql first. It does not read this function.
-- 4. Apply this catalog file second. The series-directory grant needs Stage 138.
-- 5. Set the Worker server key, OpenAI key, and IP hash secret. Leave the daily
--    embedding refresh flag unset.
-- 6. Deploy the AI Search backend only after both functions answer correctly.
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
  description_matched boolean,
  category_matched boolean,
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
  active_labels AS (
    SELECT DISTINCT normalize(btrim(c.label), NFC) AS label
    FROM public.book_categories AS c
    WHERE c.retired_at IS NULL
      AND c.is_hidden IS FALSE
      AND char_length(normalize(btrim(c.label), NFC)) BETWEEN 1 AND 80
  ),
  exact_labels AS (
    SELECT v.q AS label
    FROM variants AS v
    JOIN active_labels AS active ON active.label = v.q
  ),
  raw_terms AS (
    SELECT 'query' AS field, 0::bigint AS id, left(normalize(btrim(tok), NFC), 40) AS surface
    FROM variants AS v
    CROSS JOIN LATERAL regexp_split_to_table(v.q, '[[:space:]،,.;:!?()«»"/]+') AS tok
    UNION ALL
    SELECT 'title', b.id, left(normalize(btrim(tok), NFC), 40)
    FROM public.books AS b
    CROSS JOIN LATERAL regexp_split_to_table(normalize(COALESCE(b.title, ''), NFC), '[[:space:]،,.;:!?()«»"/]+') AS tok
    WHERE b.is_active IS TRUE
      AND b.submission_status = 'approved'
    UNION ALL
    SELECT 'description', b.id, left(normalize(btrim(tok), NFC), 40)
    FROM public.books AS b
    CROSS JOIN LATERAL regexp_split_to_table(normalize(COALESCE(b.description, ''), NFC), '[[:space:]،,.;:!?()«»"/]+') AS tok
    WHERE b.is_active IS TRUE
      AND b.submission_status = 'approved'
  ),
  stemmed_terms AS (
    SELECT
      field,
      id,
      surface,
      CASE
        WHEN char_length(surface) >= 9 AND right(surface, 4) = 'لىرى'
          THEN left(surface, char_length(surface) - 4)
        WHEN char_length(surface) >= 8 AND right(surface, 3) IN ('نىڭ', 'دىن', 'تىن', 'لار', 'لەر')
          THEN left(surface, char_length(surface) - 3)
        WHEN char_length(surface) >= 7 AND right(surface, 2) IN ('نى', 'دا', 'دە', 'غا', 'گە', 'قا', 'كە')
          THEN left(surface, char_length(surface) - 2)
        ELSE surface
      END AS stem
    FROM raw_terms
    WHERE char_length(surface) BETWEEN 5 AND 40
      AND surface NOT IN (
        'بىلەن', 'ئۈچۈن', 'بولىدۇ', 'قىلىش', 'قىلىشى', 'كېرەك', 'باشقا',
        'ھەققىدە', 'بويىچە', 'ئارقىلىق', 'دېگەن', 'بولغان',
        'بولسا', 'ئىكەن', 'ئۇيغۇر', 'كىتاب', 'كىتابى', 'كىتابلىرى'
      )
  ),
  keyed_terms AS (
    SELECT
      field,
      id,
      CASE
        WHEN stem IN (
          'تەربىيە', 'تەربىيى', 'تەربىيەسى', 'تەربىيىسى',
          'تەربىيلەش', 'تەربىيەلەش', 'تەربىيىلەش'
        ) THEN 'تەربىيە'
        WHEN stem IN ('ئاتا-ئانا', 'ئاتا-ئانى', 'ئاتا-ئانىلار', 'ئاتا-ئانىلەر')
          THEN 'ئاتا-ئانا'
        WHEN char_length(stem) >= 6 AND right(stem, 1) = 'ە'
          THEN left(stem, char_length(stem) - 1) || 'ى'
        ELSE stem
      END AS term_key
    FROM stemmed_terms
    WHERE char_length(stem) >= 5
  ),
  query_keys AS (
    SELECT DISTINCT term_key
    FROM keyed_terms
    WHERE field = 'query'
    LIMIT 12
  ),
  matched_keys AS (
    SELECT book.field, book.id, book.term_key
    FROM keyed_terms AS book
    JOIN query_keys AS query_term ON query_term.term_key = book.term_key
    WHERE book.field IN ('title', 'description')
  ),
  term_support AS (
    SELECT
      id,
      (
        sum(in_title) * 100
        + count(*) * 10
        + sum(key_length)
      )::integer AS lexical_score
    FROM (
      SELECT
        id,
        term_key,
        max(CASE WHEN field = 'title' THEN 1 ELSE 0 END) AS in_title,
        max(char_length(term_key)) AS key_length
      FROM matched_keys
      GROUP BY id, term_key
    ) AS per_key
    GROUP BY id
    HAVING count(*) >= 2
      AND max(key_length) >= 6
      AND sum(key_length) >= 11
  ),
  short_raw AS (
    SELECT 'query' AS field, 0::bigint AS id, left(normalize(btrim(tok), NFC), 40) AS surface
    FROM variants AS v
    CROSS JOIN LATERAL regexp_split_to_table(v.q, '[[:space:]،,.;:!?()«»"/]+') AS tok
    UNION ALL
    SELECT 'title', b.id, left(normalize(btrim(tok), NFC), 40)
    FROM public.books AS b
    CROSS JOIN LATERAL regexp_split_to_table(normalize(COALESCE(b.title, ''), NFC), '[[:space:]،,.;:!?()«»"/]+') AS tok
    WHERE b.is_active IS TRUE
      AND b.submission_status = 'approved'
    UNION ALL
    SELECT 'description', b.id, left(normalize(btrim(tok), NFC), 40)
    FROM public.books AS b
    CROSS JOIN LATERAL regexp_split_to_table(normalize(COALESCE(b.description, ''), NFC), '[[:space:]،,.;:!?()«»"/]+') AS tok
    WHERE b.is_active IS TRUE
      AND b.submission_status = 'approved'
  ),
  short_stems AS (
    SELECT
      field,
      id,
      CASE
        WHEN char_length(surface) BETWEEN 5 AND 6
          AND right(surface, 2) IN ('نى', 'دا', 'دە', 'غا', 'گە', 'قا', 'كە')
          AND char_length(surface) - 2 >= 3
          THEN left(surface, char_length(surface) - 2)
        ELSE surface
      END AS stem
    FROM short_raw
    WHERE char_length(surface) BETWEEN 3 AND 6
  ),
  short_keys AS (
    SELECT field, id, stem AS term_key
    FROM short_stems
    WHERE char_length(stem) BETWEEN 3 AND 4
      AND stem NOT IN (
        'بىر', 'بۇ', 'ئۇ', 'مەن', 'سەن', 'ئۇل', 'ھەر', 'ئەڭ', 'بار', 'يوق',
        'كۆپ', 'ئاز', 'نېمە', 'ياكى', 'شۇ', 'دەپ'
      )
  ),
  rare_short_keys AS (
    SELECT term_key
    FROM short_keys
    WHERE field = 'title'
    GROUP BY term_key
    HAVING count(DISTINCT id) <= 6
  ),
  short_query_keys AS (
    SELECT DISTINCT sk.term_key
    FROM short_keys AS sk
    JOIN rare_short_keys AS rare ON rare.term_key = sk.term_key
    WHERE sk.field = 'query'
  ),
  long_query_keys AS (
    SELECT qk.term_key
    FROM query_keys AS qk
    JOIN (
      SELECT term_key
      FROM keyed_terms
      WHERE field IN ('title', 'description')
        AND char_length(term_key) >= 6
      GROUP BY term_key
      HAVING count(DISTINCT id) <= 40
    ) AS uncommon ON uncommon.term_key = qk.term_key
    WHERE char_length(qk.term_key) >= 6
  ),
  short_book_hits AS (
    SELECT book.id, book.term_key, max(CASE WHEN book.field = 'title' THEN 1 ELSE 0 END) AS in_title
    FROM short_keys AS book
    JOIN short_query_keys AS qk ON qk.term_key = book.term_key
    WHERE book.field IN ('title', 'description')
    GROUP BY book.id, book.term_key
  ),
  long_book_hits AS (
    SELECT book.id, book.term_key
    FROM keyed_terms AS book
    JOIN long_query_keys AS qk ON qk.term_key = book.term_key
    WHERE book.field IN ('title', 'description')
    GROUP BY book.id, book.term_key
  ),
  paired_support AS (
    SELECT s.id, 9 AS lexical_score
    FROM short_book_hits AS s
    JOIN long_book_hits AS l ON l.id = s.id
    GROUP BY s.id
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
      (
        EXISTS (
          SELECT 1 FROM variants AS v
          WHERE char_length(v.q) >= 8
            AND strpos(normalize(COALESCE(b.description, ''), NFC), v.q) > 0
        )
        OR EXISTS (
          SELECT 1 FROM term_support AS support
          WHERE support.id = b.id
        )
        OR EXISTS (
          SELECT 1 FROM paired_support AS paired
          WHERE paired.id = b.id
        )
      ) AS description_matched,
      EXISTS (
        SELECT 1 FROM exact_labels AS exact
        WHERE exact.label = normalize(b.category, NFC)
      ) AS category_matched,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM variants AS v
          WHERE char_length(v.q) >= 8
            AND strpos(normalize(COALESCE(b.description, ''), NFC), v.q) > 0
        ) THEN 1000
        ELSE COALESCE(support.lexical_score, paired.lexical_score, 0)
      END AS lexical_score,
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
          SELECT 1 FROM exact_labels AS exact
          WHERE exact.label = normalize(b.category, NFC)
        ) THEN 4
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
        ) THEN 5
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
        ) THEN 6
        WHEN NOT EXISTS (SELECT 1 FROM exact_labels)
          AND EXISTS (
            SELECT 1 FROM categories AS requested
            JOIN active_labels AS active ON active.label = requested.cat
            WHERE active.label = normalize(b.category, NFC)
          ) THEN 7
        WHEN (
          EXISTS (
            SELECT 1 FROM variants AS v
            WHERE char_length(v.q) >= 8
              AND strpos(normalize(COALESCE(b.description, ''), NFC), v.q) > 0
          )
          OR EXISTS (
            SELECT 1 FROM term_support AS support
            WHERE support.id = b.id
          )
          OR EXISTS (
            SELECT 1 FROM paired_support AS paired
            WHERE paired.id = b.id
          )
        ) THEN 8
        ELSE NULL
      END AS tier
    FROM public.books AS b
    LEFT JOIN membership AS m ON m.member_id = b.id
    LEFT JOIN term_support AS support ON support.id = b.id
    LEFT JOIN paired_support AS paired ON paired.id = b.id
    WHERE b.is_active IS TRUE
      AND b.submission_status = 'approved'
  ),
  chosen AS (
    SELECT DISTINCT ON (
      CASE
        WHEN hits.tier = 1 OR hits.series_group_id IS NULL THEN 'book:' || hits.id::text
        ELSE 'group:' || hits.series_group_id::text
      END
    )
      hits.*
    FROM hits
    WHERE hits.tier IS NOT NULL
    ORDER BY
      CASE
        WHEN hits.tier = 1 OR hits.series_group_id IS NULL THEN 'book:' || hits.id::text
        ELSE 'group:' || hits.series_group_id::text
      END,
      hits.tier,
      hits.lexical_score DESC,
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
    chosen.description_matched,
    chosen.category_matched,
    chosen.series_title,
    chosen.series_slug,
    chosen.series_member_count,
    chosen.series_group_id,
    chosen.series_lowest_price,
    chosen.series_image_url,
    chosen.series_representative_id
  FROM chosen
  ORDER BY chosen.tier, chosen.lexical_score DESC, char_length(chosen.title), chosen.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 24);
$lexical$;

REVOKE ALL ON FUNCTION public.search_public_catalog_lexical(text[], text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_public_catalog_lexical(text[], text[], integer)
  TO service_role;

COMMENT ON FUNCTION public.search_public_catalog_lexical(text[], text[], integer) IS
  'Bounded read of active approved books and published series for the trusted AI Search worker. Not granted to anon or authenticated.';

-- Existing public directory. Do not change its body or its anon and authenticated grants.
GRANT EXECUTE ON FUNCTION public.list_public_book_series_routes() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
