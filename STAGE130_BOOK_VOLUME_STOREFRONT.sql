-- Stage 130 — grouped storefront and explicit group publication.
-- MANUAL / REVIEWED APPLY ONLY. Apply after Stages 106, 127, and 128.
--
-- Catalog rule: valid public groups and remaining direct books are materialized
-- as catalog units before search, filters, sorting, or pagination. A public
-- group is valid only when it has a slug, contiguous 2..100 membership, a
-- member representative (NULL means position 1), and every member is active,
-- approved, and nonnegative-priced. An invalid/private group never hides an
-- otherwise public direct book.
--
-- Storefront price rule: group price filtering/sorting uses the lowest member
-- price. set_price remains the complete-set quote price (explicit override or
-- member sum). Discovery order is a deterministic hash of seed + unit_id.
--
-- Admin rule: Stage 127 admin_save_book_volume_group remains the only
-- link/unlink/reorder mutation. This stage adds exact ID/ISBN preview and a
-- separate optimistic publication mutation. Publication never updates books.
--
-- Data-preserving rollback: STAGE130_BOOK_VOLUME_STOREFRONT_ROLLBACK.sql.

BEGIN;

DO $preflight$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
  INTO v_missing
  FROM (
    VALUES
      ('id'), ('title'), ('author'), ('price'), ('category'), ('source'),
      ('description'), ('image_url'), ('stock'), ('stock_status'), ('isbn'),
      ('legacy_id'), ('is_active'), ('submission_status'), ('is_new'),
      ('is_featured'), ('is_recommended'), ('is_bestseller'), ('sales_count'),
      ('created_at'), ('updated_at')
  ) AS required(column_name)
  LEFT JOIN information_schema.columns AS c
    ON c.table_schema = 'public'
   AND c.table_name = 'books'
   AND c.column_name = required.column_name
  WHERE c.column_name IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'public.books is missing Stage 130 columns: %', v_missing;
  END IF;
  IF to_regclass('public.book_credits') IS NULL OR EXISTS (
    SELECT 1
    FROM (VALUES ('book_id'), ('identity_id'), ('role')) AS required(column_name)
    LEFT JOIN information_schema.columns AS c
      ON c.table_schema = 'public'
     AND c.table_name = 'book_credits'
     AND c.column_name = required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'public.book_credits Stage 106 contract is required';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.kutadgu_public_volume_groups()
RETURNS TABLE(
  group_id bigint,
  slug text,
  title text,
  author text,
  category text,
  source text,
  description text,
  lowest_price numeric,
  complete_set_price numeric,
  set_price numeric,
  revision bigint,
  representative_book_id bigint,
  representative_image_url text,
  member_book_ids bigint[],
  member_count integer,
  is_new boolean,
  is_featured boolean,
  is_recommended boolean,
  is_bestseller boolean,
  sales_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  search_text text
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $groups$
  WITH aggregated AS (
    SELECT
      g.id AS group_id,
      g.slug,
      g.title,
      g.author,
      g.category,
      g.source,
      g.description,
      g.complete_set_price,
      g.revision,
      g.representative_book_id,
      g.created_at AS group_created_at,
      g.updated_at AS group_updated_at,
      count(*)::integer AS member_count,
      count(DISTINCT m.position)::integer AS distinct_positions,
      min(m.position)::integer AS first_position,
      max(m.position)::integer AS last_position,
      max(m.book_id) FILTER (WHERE m.position = 1) AS first_book_id,
      bool_or(m.book_id = g.representative_book_id) AS representative_is_member,
      bool_and(
        b.is_active
        AND b.submission_status = 'approved'
        AND b.price IS NOT NULL
        AND b.price >= 0
      ) AS all_members_public,
      min(b.price) AS lowest_price,
      sum(b.price) AS member_price_sum,
      array_agg(m.book_id ORDER BY m.position) AS member_book_ids,
      bool_or(b.is_new) AS is_new,
      bool_or(b.is_featured) AS is_featured,
      bool_or(b.is_recommended) AS is_recommended,
      bool_or(b.is_bestseller) AS is_bestseller,
      sum(b.sales_count)::bigint AS sales_count,
      max(b.created_at) AS newest_member_at,
      max(b.updated_at) AS latest_member_at,
      concat_ws(
        ' ',
        g.title,
        g.author,
        g.category,
        g.source,
        g.description,
        string_agg(
          concat_ws(' ', b.title, b.author, b.category, b.isbn),
          ' ' ORDER BY m.position
        )
      ) AS search_text
    FROM public.book_volume_groups AS g
    JOIN public.book_volume_group_members AS m ON m.group_id = g.id
    JOIN public.books AS b ON b.id = m.book_id
    WHERE g.is_public
      AND g.is_active
      AND g.slug IS NOT NULL
      AND btrim(g.slug) <> ''
    GROUP BY
      g.id, g.slug, g.title, g.author, g.category, g.source, g.description,
      g.complete_set_price, g.revision, g.representative_book_id, g.created_at, g.updated_at
  )
  SELECT
    a.group_id,
    a.slug,
    a.title,
    a.author,
    a.category,
    a.source,
    a.description,
    a.lowest_price,
    a.complete_set_price,
    CASE
      WHEN a.complete_set_price IS NOT NULL THEN a.complete_set_price
      ELSE a.member_price_sum
    END AS set_price,
    a.revision,
    coalesce(a.representative_book_id, a.first_book_id) AS representative_book_id,
    representative.image_url AS representative_image_url,
    a.member_book_ids,
    a.member_count,
    a.is_new,
    a.is_featured,
    a.is_recommended,
    a.is_bestseller,
    a.sales_count,
    greatest(a.group_created_at, a.newest_member_at) AS created_at,
    greatest(a.group_updated_at, a.latest_member_at) AS updated_at,
    a.search_text
  FROM aggregated AS a
  JOIN public.books AS representative
    ON representative.id = coalesce(a.representative_book_id, a.first_book_id)
  WHERE a.member_count BETWEEN 2 AND 100
    AND a.distinct_positions = a.member_count
    AND a.first_position = 1
    AND a.last_position = a.member_count
    AND a.all_members_public
    AND (
      a.representative_book_id IS NULL
      OR coalesce(a.representative_is_member, false)
    );
$groups$;

REVOKE ALL ON FUNCTION private.kutadgu_public_volume_groups()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.kutadgu_public_catalog_units()
RETURNS TABLE(
  unit_id text,
  kind text,
  book_id bigint,
  group_id bigint,
  slug text,
  title text,
  author text,
  category text,
  source text,
  description text,
  price numeric,
  complete_set_price numeric,
  set_price numeric,
  image_url text,
  stock integer,
  stock_status text,
  representative_book_id bigint,
  member_count integer,
  member_book_ids bigint[],
  is_new boolean,
  is_featured boolean,
  is_recommended boolean,
  is_bestseller boolean,
  sales_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  search_text text
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $units$
  WITH valid_groups AS MATERIALIZED (
    SELECT * FROM private.kutadgu_public_volume_groups()
  )
  SELECT
    'book:' || b.id::text AS unit_id,
    'book'::text AS kind,
    b.id AS book_id,
    NULL::bigint AS group_id,
    nullif(btrim(b.legacy_id), '') AS slug,
    b.title,
    b.author,
    b.category,
    b.source,
    b.description,
    b.price AS price,
    NULL::numeric AS complete_set_price,
    b.price AS set_price,
    b.image_url,
    b.stock,
    b.stock_status,
    b.id AS representative_book_id,
    1 AS member_count,
    ARRAY[b.id]::bigint[] AS member_book_ids,
    b.is_new,
    b.is_featured,
    b.is_recommended,
    b.is_bestseller,
    b.sales_count::bigint,
    b.created_at,
    b.updated_at,
    concat_ws(' ', b.title, b.author, b.category, b.source, b.description, b.isbn) AS search_text
  FROM public.books AS b
  WHERE b.is_active
    AND b.submission_status = 'approved'
    AND b.price IS NOT NULL
    AND b.price >= 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.book_volume_group_members AS m
      JOIN valid_groups AS vg ON vg.group_id = m.group_id
      WHERE m.book_id = b.id
    )

  UNION ALL

  SELECT
    'group:' || vg.group_id::text AS unit_id,
    'group'::text AS kind,
    NULL::bigint AS book_id,
    vg.group_id,
    vg.slug,
    vg.title,
    vg.author,
    vg.category,
    vg.source,
    vg.description,
    vg.lowest_price AS price,
    vg.complete_set_price,
    vg.set_price,
    vg.representative_image_url AS image_url,
    NULL::integer AS stock,
    NULL::text AS stock_status,
    vg.representative_book_id,
    vg.member_count,
    vg.member_book_ids,
    vg.is_new,
    vg.is_featured,
    vg.is_recommended,
    vg.is_bestseller,
    vg.sales_count,
    vg.created_at,
    vg.updated_at,
    vg.search_text
  FROM valid_groups AS vg;
$units$;

REVOKE ALL ON FUNCTION private.kutadgu_public_catalog_units()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.kutadgu_public_volume_group_json(p_group_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $group_json$
  SELECT jsonb_build_object(
    'id', vg.group_id,
    'group_id', vg.group_id,
    'unit_id', 'group:' || vg.group_id::text,
    'kind', 'group',
    'slug', vg.slug,
    'title', vg.title,
    'author', vg.author,
    'category', vg.category,
    'source', vg.source,
    'description', vg.description,
    'price', vg.lowest_price,
    'lowest_member_price', vg.lowest_price,
    'complete_set_price', vg.complete_set_price,
    'set_price', vg.set_price,
    'effective_set_price', vg.set_price,
    'revision', vg.revision,
    'quote_revision', public.kutadgu_book_volume_quote_revision(vg.group_id),
    'representative_book_id', vg.representative_book_id,
    'image_url', vg.representative_image_url,
    'member_count', vg.member_count,
    'member_book_ids', to_jsonb(vg.member_book_ids),
    'created_at', vg.created_at,
    'updated_at', vg.updated_at,
    'members', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'book_id', b.id,
          'position', m.position,
          'volume_label', m.volume_label,
          'title', b.title,
          'author', b.author,
          'price', b.price,
          'image_url', b.image_url,
          'stock', b.stock,
          'stock_status', b.stock_status,
          'is_active', b.is_active
        )
        ORDER BY m.position
      )
      FROM public.book_volume_group_members AS m
      JOIN public.books AS b ON b.id = m.book_id
      WHERE m.group_id = vg.group_id
    )
  )
  FROM private.kutadgu_public_volume_groups() AS vg
  WHERE vg.group_id = p_group_id;
$group_json$;

REVOKE ALL ON FUNCTION private.kutadgu_public_volume_group_json(bigint)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_public_book_volume_catalog(
  p_search text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_featured boolean DEFAULT false,
  p_recommended boolean DEFAULT false,
  p_bestseller boolean DEFAULT false,
  p_new_only boolean DEFAULT false,
  p_sort text DEFAULT 'new',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $catalog$
DECLARE
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_sort text := lower(btrim(coalesce(p_sort, 'new')));
  v_offset integer := coalesce(p_offset, 0);
  v_limit integer := coalesce(p_limit, 24);
  v_total bigint;
  v_items jsonb;
BEGIN
  IF v_offset < 0 OR v_offset > 1000000 THEN
    RAISE EXCEPTION 'invalid_catalog_offset' USING ERRCODE = '22023';
  END IF;
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'invalid_catalog_limit' USING ERRCODE = '22023';
  END IF;
  IF p_min_price IS NOT NULL AND p_min_price < 0
     OR p_max_price IS NOT NULL AND p_max_price < 0
     OR p_min_price IS NOT NULL AND p_max_price IS NOT NULL AND p_min_price > p_max_price THEN
    RAISE EXCEPTION 'invalid_catalog_price_range' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN (
    'new', 'title', 'author', 'price_low', 'pricelow', 'price_high',
    'pricehigh', 'bestseller', 'recommended', 'relevance'
  ) THEN
    RAISE EXCEPTION 'invalid_catalog_sort' USING ERRCODE = '22023';
  END IF;

  WITH units AS MATERIALIZED (
    SELECT * FROM private.kutadgu_public_catalog_units()
  ),
  filtered AS MATERIALIZED (
    SELECT u.*
    FROM units AS u
    WHERE (v_search IS NULL OR u.search_text ILIKE '%' || v_search || '%')
      AND (v_category IS NULL OR u.category = v_category)
      AND (v_source IS NULL OR u.source = v_source)
      AND (p_min_price IS NULL OR u.price >= p_min_price)
      AND (p_max_price IS NULL OR u.price <= p_max_price)
      AND (coalesce(p_featured, false) IS NOT TRUE OR u.is_featured)
      AND (coalesce(p_recommended, false) IS NOT TRUE OR u.is_recommended)
      AND (coalesce(p_bestseller, false) IS NOT TRUE OR u.is_bestseller)
      AND (coalesce(p_new_only, false) IS NOT TRUE OR u.is_new)
  ),
  ordered AS (
    SELECT
      f.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_sort IN ('price_low', 'pricelow') THEN f.price END ASC NULLS LAST,
          CASE WHEN v_sort IN ('price_high', 'pricehigh') THEN f.price END DESC NULLS LAST,
          CASE WHEN v_sort = 'title' THEN lower(f.title) END ASC NULLS LAST,
          CASE WHEN v_sort = 'author' THEN lower(f.author) END ASC NULLS LAST,
          CASE WHEN v_sort = 'bestseller' THEN f.is_bestseller END DESC NULLS LAST,
          CASE WHEN v_sort = 'bestseller' THEN f.sales_count END DESC NULLS LAST,
          CASE WHEN v_sort = 'recommended' THEN f.is_recommended END DESC NULLS LAST,
          CASE WHEN v_sort = 'relevance' AND v_search IS NOT NULL
            THEN lower(f.title) = lower(v_search) END DESC NULLS LAST,
          CASE WHEN v_sort IN ('new', 'bestseller', 'recommended', 'relevance')
            THEN f.created_at END DESC NULLS LAST,
          f.unit_id ASC
      ) AS catalog_ordinal
    FROM filtered AS f
  ),
  page AS (
    SELECT *
    FROM ordered
    WHERE catalog_ordinal > v_offset
      AND catalog_ordinal <= v_offset + v_limit
  )
  SELECT
    (SELECT count(*) FROM filtered),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'unit_id', p.unit_id,
        'kind', p.kind,
        'id', coalesce(p.book_id, p.group_id),
        'book_id', p.book_id,
        'group_id', p.group_id,
        'slug', p.slug,
        'group_slug', CASE WHEN p.kind = 'group' THEN p.slug ELSE NULL END,
        'title', p.title,
        'author', p.author,
        'category', p.category,
        'source', p.source,
        'description', p.description,
        'price', p.price,
        'lowest_member_price', p.price,
        'complete_set_price', p.complete_set_price,
        'set_price', p.set_price,
        'effective_set_price', p.set_price,
        'image_url', p.image_url,
        'stock', p.stock,
        'stock_status', p.stock_status,
        'representative_book_id', p.representative_book_id,
        'member_count', p.member_count,
        'member_book_ids', to_jsonb(p.member_book_ids),
        'is_new', p.is_new,
        'is_featured', p.is_featured,
        'is_recommended', p.is_recommended,
        'is_bestseller', p.is_bestseller,
        'sales_count', p.sales_count,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      ORDER BY p.catalog_ordinal
    ), '[]'::jsonb)
  INTO v_total, v_items
  FROM page AS p;

  RETURN jsonb_build_object(
    'total', v_total,
    'offset', v_offset,
    'limit', v_limit,
    'has_more', v_offset + jsonb_array_length(v_items) < v_total,
    'items', v_items
  );
END;
$catalog$;

CREATE OR REPLACE FUNCTION public.get_public_book_volume_group_storefront(
  p_group_id bigint DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_child_book_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $lookup$
DECLARE
  v_slug text := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  v_key_count integer;
  v_group_id bigint;
BEGIN
  v_key_count :=
    CASE WHEN p_group_id IS NULL THEN 0 ELSE 1 END
    + CASE WHEN v_slug IS NULL THEN 0 ELSE 1 END
    + CASE WHEN p_child_book_id IS NULL THEN 0 ELSE 1 END;
  IF v_key_count <> 1 THEN
    RAISE EXCEPTION 'exactly_one_volume_group_lookup_key_required' USING ERRCODE = '22023';
  END IF;
  IF p_group_id IS NOT NULL AND p_group_id < 1
     OR p_child_book_id IS NOT NULL AND p_child_book_id < 1 THEN
    RAISE EXCEPTION 'invalid_volume_group_lookup_key' USING ERRCODE = '22023';
  END IF;

  IF p_group_id IS NOT NULL THEN
    v_group_id := p_group_id;
  ELSIF v_slug IS NOT NULL THEN
    SELECT vg.group_id INTO v_group_id
    FROM private.kutadgu_public_volume_groups() AS vg
    WHERE vg.slug = v_slug;
  ELSE
    SELECT vg.group_id INTO v_group_id
    FROM private.kutadgu_public_volume_groups() AS vg
    JOIN public.book_volume_group_members AS m ON m.group_id = vg.group_id
    WHERE m.book_id = p_child_book_id;
  END IF;

  RETURN private.kutadgu_public_volume_group_json(v_group_id);
END;
$lookup$;

CREATE OR REPLACE FUNCTION public.resolve_public_book_volume_context(p_book_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $resolve$
DECLARE
  v_group jsonb;
  v_child jsonb;
  v_book jsonb;
BEGIN
  IF p_book_id IS NULL OR p_book_id < 1 THEN
    RAISE EXCEPTION 'invalid_book_id' USING ERRCODE = '22023';
  END IF;

  v_group := public.get_public_book_volume_group_storefront(
    p_group_id => NULL,
    p_slug => NULL,
    p_child_book_id => p_book_id
  );
  IF v_group IS NOT NULL THEN
    SELECT member.value INTO v_child
    FROM jsonb_array_elements(v_group->'members') AS member(value)
    WHERE (member.value->>'book_id')::bigint = p_book_id;
    RETURN jsonb_build_object(
      'kind', 'group_child',
      'unit_id', v_group->>'unit_id',
      'book_id', p_book_id,
      'group_id', (v_group->>'group_id')::bigint,
      'position', (v_child->>'position')::integer,
      'book', v_child,
      'group', v_group
    );
  END IF;

  SELECT jsonb_build_object(
    'kind', 'book',
    'unit_id', 'book:' || b.id::text,
    'book_id', b.id,
    'group_id', NULL,
    'book', jsonb_build_object(
      'book_id', b.id,
      'title', b.title,
      'author', b.author,
      'price', b.price,
      'category', b.category,
      'source', b.source,
      'description', b.description,
      'image_url', b.image_url,
      'stock', b.stock,
      'stock_status', b.stock_status
    )
  )
  INTO v_book
  FROM public.books AS b
  WHERE b.id = p_book_id
    AND b.is_active
    AND b.submission_status = 'approved'
    AND b.price IS NOT NULL
    AND b.price >= 0;

  RETURN v_book;
END;
$resolve$;

CREATE OR REPLACE FUNCTION public.list_public_book_volume_sitemap_entries(
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $sitemap$
DECLARE
  v_offset integer := coalesce(p_offset, 0);
  v_limit integer := coalesce(p_limit, 1000);
  v_total bigint;
  v_items jsonb;
BEGIN
  IF v_offset < 0 OR v_offset > 1000000 OR v_limit < 1 OR v_limit > 1000 THEN
    RAISE EXCEPTION 'invalid_sitemap_page' USING ERRCODE = '22023';
  END IF;

  WITH units AS MATERIALIZED (
    SELECT * FROM private.kutadgu_public_catalog_units()
  ),
  ordered AS (
    SELECT u.*, row_number() OVER (ORDER BY u.unit_id) AS sitemap_ordinal
    FROM units AS u
  ),
  page AS (
    SELECT * FROM ordered
    WHERE sitemap_ordinal > v_offset
      AND sitemap_ordinal <= v_offset + v_limit
  )
  SELECT
    (SELECT count(*) FROM units),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'unit_id', p.unit_id,
        'kind', p.kind,
        'book_id', p.book_id,
        'group_id', p.group_id,
        'slug', p.slug,
        'updated_at', p.updated_at
      )
      ORDER BY p.sitemap_ordinal
    ), '[]'::jsonb)
  INTO v_total, v_items
  FROM page AS p;

  RETURN jsonb_build_object(
    'total', v_total,
    'offset', v_offset,
    'limit', v_limit,
    'has_more', v_offset + jsonb_array_length(v_items) < v_total,
    'items', v_items
  );
END;
$sitemap$;

CREATE OR REPLACE FUNCTION public.list_public_book_volume_discovery_unit_ids(
  p_seed text,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $discovery$
DECLARE
  v_seed text := btrim(coalesce(p_seed, ''));
  v_offset integer := coalesce(p_offset, 0);
  v_limit integer := coalesce(p_limit, 1000);
  v_total bigint;
  v_ids jsonb;
BEGIN
  IF v_seed = '' OR char_length(v_seed) > 200 THEN
    RAISE EXCEPTION 'invalid_discovery_seed' USING ERRCODE = '22023';
  END IF;
  IF v_offset < 0 OR v_offset > 1000000 OR v_limit < 1 OR v_limit > 5000 THEN
    RAISE EXCEPTION 'invalid_discovery_page' USING ERRCODE = '22023';
  END IF;

  WITH units AS MATERIALIZED (
    SELECT * FROM private.kutadgu_public_catalog_units()
  ),
  ordered AS (
    SELECT
      u.unit_id,
      row_number() OVER (
        ORDER BY md5(v_seed || chr(31) || u.unit_id), u.unit_id
      ) AS discovery_ordinal
    FROM units AS u
  ),
  page AS (
    SELECT * FROM ordered
    WHERE discovery_ordinal > v_offset
      AND discovery_ordinal <= v_offset + v_limit
  )
  SELECT
    (SELECT count(*) FROM units),
    coalesce(jsonb_agg(to_jsonb(p.unit_id) ORDER BY p.discovery_ordinal), '[]'::jsonb)
  INTO v_total, v_ids
  FROM page AS p;

  RETURN jsonb_build_object(
    'total', v_total,
    'offset', v_offset,
    'limit', v_limit,
    'has_more', v_offset + jsonb_array_length(v_ids) < v_total,
    'unit_ids', v_ids
  );
END;
$discovery$;

CREATE OR REPLACE FUNCTION public.query_public_book_catalog(p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $query_catalog$
DECLARE
  v_search text;
  v_category text;
  v_source text;
  v_sort text;
  v_credit_id text;
  v_credit_role text;
  v_min_price numeric;
  v_max_price numeric;
  v_offset integer;
  v_limit integer;
  v_sources jsonb;
  v_ids jsonb;
  v_total bigint;
  v_items jsonb;
BEGIN
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'invalid_catalog_query' USING ERRCODE = '22023';
  END IF;
  v_search := nullif(btrim(coalesce(p_query->>'search', '')), '');
  v_category := nullif(btrim(coalesce(p_query->>'category', '')), '');
  v_source := nullif(btrim(coalesce(p_query->>'source', '')), '');
  v_sort := lower(btrim(coalesce(p_query->>'sort', 'new')));
  v_credit_id := nullif(btrim(coalesce(p_query->>'credit_id', '')), '');
  v_credit_role := nullif(btrim(coalesce(p_query->>'credit_role', '')), '');
  v_sources := p_query->'sources';
  v_ids := p_query->'ids';
  BEGIN
    v_min_price := nullif(p_query->>'min_price', '')::numeric;
    v_max_price := nullif(p_query->>'max_price', '')::numeric;
    v_offset := coalesce((p_query->>'offset')::integer, 0);
    v_limit := coalesce((p_query->>'limit')::integer, 24);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_catalog_query' USING ERRCODE = '22023';
  END;
  IF v_offset < 0 OR v_offset > 1000000 OR v_limit < 1 OR v_limit > 100
     OR v_min_price < 0 OR v_max_price < 0
     OR v_min_price IS NOT NULL AND v_max_price IS NOT NULL AND v_min_price > v_max_price THEN
    RAISE EXCEPTION 'invalid_catalog_query' USING ERRCODE = '22023';
  END IF;
  IF v_sources IS NOT NULL AND jsonb_typeof(v_sources) <> 'array'
     OR v_ids IS NOT NULL AND jsonb_typeof(v_ids) <> 'array' THEN
    RAISE EXCEPTION 'invalid_catalog_query' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_search, '')) > 300
     OR v_sources IS NOT NULL AND jsonb_array_length(v_sources) > 50
     OR v_ids IS NOT NULL AND jsonb_array_length(v_ids) > 100 THEN
    RAISE EXCEPTION 'invalid_catalog_query' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN (
    'new', 'title', 'author', 'pricelow', 'price_low', 'pricehigh', 'price_high',
    'bestseller', 'recommended', 'relevance', 'discover'
  ) THEN
    RAISE EXCEPTION 'invalid_catalog_sort' USING ERRCODE = '22023';
  END IF;
  IF v_credit_role IS NOT NULL AND v_credit_role NOT IN ('author', 'translator', 'publisher') THEN
    RAISE EXCEPTION 'invalid_catalog_credit_role' USING ERRCODE = '22023';
  END IF;

  WITH units AS MATERIALIZED (
    SELECT * FROM private.kutadgu_public_catalog_units()
  ),
  filtered AS MATERIALIZED (
    SELECT u.*
    FROM units AS u
    WHERE (v_search IS NULL OR u.search_text ILIKE '%' || v_search || '%')
      AND (v_category IS NULL OR u.category = v_category)
      AND (v_source IS NULL OR u.source = v_source)
      AND (
        v_sources IS NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_sources) AS wanted(source)
          WHERE wanted.source = u.source
        )
      )
      AND (v_min_price IS NULL OR u.price >= v_min_price)
      AND (v_max_price IS NULL OR u.price <= v_max_price)
      AND (coalesce((p_query->>'recommended')::boolean, false) IS NOT TRUE OR u.is_recommended)
      AND (coalesce((p_query->>'bestseller')::boolean, false) IS NOT TRUE OR u.is_bestseller)
      AND (coalesce((p_query->>'new_only')::boolean, false) IS NOT TRUE OR u.is_new)
      AND (
        v_ids IS NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_ids) AS wanted(id)
          WHERE wanted.id = u.unit_id
             OR wanted.id = coalesce(u.book_id, u.representative_book_id)::text
        )
      )
      AND (
        v_credit_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.book_credits AS bc
          WHERE bc.identity_id::text = v_credit_id
            AND (v_credit_role IS NULL OR bc.role = v_credit_role)
            AND (
              bc.book_id = u.book_id
              OR u.group_id IS NOT NULL AND EXISTS (
                SELECT 1
                FROM public.book_volume_group_members AS gm
                WHERE gm.group_id = u.group_id AND gm.book_id = bc.book_id
              )
            )
        )
      )
  ),
  ordered AS (
    SELECT
      f.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_ids IS NOT NULL THEN (
            SELECT min(wanted.ordinality)
            FROM jsonb_array_elements_text(v_ids) WITH ORDINALITY AS wanted(id, ordinality)
            WHERE wanted.id = f.unit_id
               OR wanted.id = coalesce(f.book_id, f.representative_book_id)::text
          ) END ASC NULLS LAST,
          CASE WHEN v_sort IN ('pricelow', 'price_low') THEN f.price END ASC NULLS LAST,
          CASE WHEN v_sort IN ('pricehigh', 'price_high') THEN f.price END DESC NULLS LAST,
          CASE WHEN v_sort = 'title' THEN lower(f.title) END ASC NULLS LAST,
          CASE WHEN v_sort = 'author' THEN lower(f.author) END ASC NULLS LAST,
          CASE WHEN v_sort = 'bestseller' THEN f.sales_count END DESC NULLS LAST,
          CASE WHEN v_sort = 'recommended' THEN f.is_recommended END DESC NULLS LAST,
          CASE WHEN v_sort = 'relevance' AND v_search IS NOT NULL THEN lower(f.title) = lower(v_search) END DESC NULLS LAST,
          CASE WHEN v_sort IN ('new', 'bestseller', 'recommended', 'relevance', 'discover') THEN f.created_at END DESC NULLS LAST,
          f.unit_id
      ) AS catalog_ordinal
    FROM filtered AS f
  ),
  page AS (
    SELECT * FROM ordered
    WHERE catalog_ordinal > v_offset AND catalog_ordinal <= v_offset + v_limit
  )
  SELECT
    (SELECT count(*) FROM filtered),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'unit_id', p.unit_id,
        'unit_key', p.unit_id,
        'kind', p.kind,
        'id', coalesce(p.book_id, p.representative_book_id),
        'book_id', p.book_id,
        'group_id', p.group_id,
        'slug', p.slug,
        'group_slug', CASE WHEN p.kind = 'group' THEN p.slug ELSE NULL END,
        'title', p.title,
        'author', p.author,
        'category', p.category,
        'source', p.source,
        'description', p.description,
        'price', p.price,
        'complete_set_price', p.complete_set_price,
        'set_price', p.set_price,
        'effective_set_price', p.set_price,
        'image_url', p.image_url,
        'stock', p.stock,
        'stock_status', p.stock_status,
        'representative_book_id', p.representative_book_id,
        'member_count', p.member_count,
        'member_book_ids', to_jsonb(p.member_book_ids),
        'is_active', true,
        'is_new', p.is_new,
        'is_featured', p.is_featured,
        'is_recommended', p.is_recommended,
        'is_bestseller', p.is_bestseller,
        'sales_count', p.sales_count,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      ) ORDER BY p.catalog_ordinal
    ), '[]'::jsonb)
  INTO v_total, v_items
  FROM page AS p;

  RETURN jsonb_build_object(
    'total', v_total,
    'offset', v_offset,
    'limit', v_limit,
    'has_more', v_offset + jsonb_array_length(v_items) < v_total,
    'items', v_items
  );
END;
$query_catalog$;

CREATE OR REPLACE FUNCTION public.map_public_books_to_catalog_units(p_book_ids bigint[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $map_units$
BEGIN
  IF p_book_ids IS NULL OR cardinality(p_book_ids) < 1 OR cardinality(p_book_ids) > 100
     OR EXISTS (SELECT 1 FROM unnest(p_book_ids) AS id WHERE id IS NULL OR id < 1) THEN
    RAISE EXCEPTION 'invalid_book_ids' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'unit_id', u.unit_id,
        'kind', u.kind,
        'id', coalesce(u.book_id, u.representative_book_id),
        'book_id', u.book_id,
        'group_id', u.group_id,
        'group_slug', CASE WHEN u.kind = 'group' THEN u.slug ELSE NULL END,
        'title', u.title,
        'author', u.author,
        'category', u.category,
        'price', u.price,
        'image_url', u.image_url,
        'stock', u.stock,
        'representative_book_id', u.representative_book_id,
        'member_count', u.member_count,
        'matched_book_ids', (
          SELECT to_jsonb(array_agg(input_id ORDER BY input_ordinal))
          FROM unnest(p_book_ids) WITH ORDINALITY AS input(input_id, input_ordinal)
          WHERE input.input_id = ANY(u.member_book_ids)
        )
      )
      ORDER BY (
        SELECT min(input_ordinal)
        FROM unnest(p_book_ids) WITH ORDINALITY AS input(input_id, input_ordinal)
        WHERE input.input_id = ANY(u.member_book_ids)
      )
    )
    FROM private.kutadgu_public_catalog_units() AS u
    WHERE u.member_book_ids && p_book_ids
  ), '[]'::jsonb);
END;
$map_units$;

CREATE OR REPLACE FUNCTION public.admin_preview_book_volume_members(
  p_book_id bigint DEFAULT NULL,
  p_isbn text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_preview$
DECLARE
  v_isbn text := nullif(btrim(coalesce(p_isbn, '')), '');
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_book_id IS NULL AND v_isbn IS NULL THEN
    RAISE EXCEPTION 'book_id_or_isbn_required' USING ERRCODE = '22023';
  END IF;
  IF p_book_id IS NOT NULL AND p_book_id < 1 THEN
    RAISE EXCEPTION 'invalid_book_id' USING ERRCODE = '22023';
  END IF;
  IF v_isbn IS NOT NULL AND char_length(v_isbn) > 32 THEN
    RAISE EXCEPTION 'invalid_isbn' USING ERRCODE = '22023';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'book_id', b.id,
        'isbn', b.isbn,
        'title', b.title,
        'author', b.author,
        'price', b.price,
        'image_url', b.image_url,
        'stock', b.stock,
        'stock_status', b.stock_status,
        'url', '/book/' || b.id::text,
        'is_active', b.is_active,
        'submission_status', b.submission_status,
        'group_id', m.group_id,
        'position', m.position,
        'volume_label', m.volume_label,
        'group_slug', g.slug,
        'group_title', g.title,
        'group_revision', g.revision,
        'group_is_public', g.is_public
      )
      ORDER BY b.id
    )
    FROM public.books AS b
    LEFT JOIN public.book_volume_group_members AS m ON m.book_id = b.id
    LEFT JOIN public.book_volume_groups AS g ON g.id = m.group_id
    WHERE (p_book_id IS NOT NULL AND b.id = p_book_id)
       OR (v_isbn IS NOT NULL AND b.isbn = v_isbn)
  ), '[]'::jsonb);
END;
$admin_preview$;

CREATE OR REPLACE FUNCTION public.admin_set_book_volume_group_publication(
  p_group_id bigint,
  p_expected_revision bigint,
  p_is_public boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_publish$
DECLARE
  v_group public.book_volume_groups%rowtype;
  v_member_count integer;
  v_distinct_positions integer;
  v_first_position integer;
  v_last_position integer;
  v_invalid_members integer;
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_group_id < 1 OR p_is_public IS NULL THEN
    RAISE EXCEPTION 'invalid_publication_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.book_volume_groups
  WHERE id = p_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'volume_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_group.revision THEN
    RAISE EXCEPTION 'stale_volume_group_revision' USING ERRCODE = '40001',
      DETAIL = 'expected=' || coalesce(p_expected_revision::text, 'null')
        || ' current=' || v_group.revision::text;
  END IF;

  IF p_is_public THEN
    IF NOT v_group.is_active
       OR v_group.slug IS NULL
       OR btrim(v_group.slug) = '' THEN
      RAISE EXCEPTION 'volume_group_incomplete' USING ERRCODE = '55000',
        DETAIL = 'active group and slug are required';
    END IF;

    SELECT
      count(*)::integer,
      count(DISTINCT m.position)::integer,
      min(m.position)::integer,
      max(m.position)::integer,
      count(*) FILTER (
        WHERE NOT b.is_active
           OR b.submission_status <> 'approved'
           OR b.price IS NULL
           OR b.price < 0
      )::integer
    INTO
      v_member_count,
      v_distinct_positions,
      v_first_position,
      v_last_position,
      v_invalid_members
    FROM public.book_volume_group_members AS m
    JOIN public.books AS b ON b.id = m.book_id
    WHERE m.group_id = p_group_id;

    IF v_member_count NOT BETWEEN 2 AND 100
       OR v_distinct_positions <> v_member_count
       OR v_first_position <> 1
       OR v_last_position <> v_member_count
       OR v_invalid_members <> 0 THEN
      RAISE EXCEPTION 'volume_group_incomplete' USING ERRCODE = '55000',
        DETAIL = 'members must be contiguous 2..100 and every member active, approved, and priced';
    END IF;
    IF v_group.representative_book_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.book_volume_group_members AS m
         WHERE m.group_id = p_group_id
           AND m.book_id = v_group.representative_book_id
       ) THEN
      RAISE EXCEPTION 'volume_group_incomplete' USING ERRCODE = '55000',
        DETAIL = 'representative must be a member';
    END IF;
  END IF;

  UPDATE public.book_volume_groups
  SET is_public = p_is_public,
      revision = revision + 1,
      updated_at = now()
  WHERE id = p_group_id;

  RETURN public.admin_get_book_volume_group(p_group_id);
END;
$admin_publish$;

REVOKE ALL ON FUNCTION public.query_public_book_catalog(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.map_public_books_to_catalog_units(bigint[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_catalog(
  text, text, text, numeric, numeric, boolean, boolean, boolean, boolean, text, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_book_volume_group_storefront(bigint, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_public_book_volume_context(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_sitemap_entries(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_discovery_unit_ids(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_preview_book_volume_members(bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_book_volume_group_publication(bigint, bigint, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_public_book_volume_catalog(
  text, text, text, numeric, numeric, boolean, boolean, boolean, boolean, text, integer, integer
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.query_public_book_catalog(jsonb)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.map_public_books_to_catalog_units(bigint[])
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_book_volume_group_storefront(bigint, text, bigint)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_book_volume_context(bigint)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_book_volume_sitemap_entries(integer, integer)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_book_volume_discovery_unit_ids(text, integer, integer)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_preview_book_volume_members(bigint, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_book_volume_group_publication(bigint, bigint, boolean)
  TO authenticated;

COMMIT;
