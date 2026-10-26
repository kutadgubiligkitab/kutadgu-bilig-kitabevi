-- Stage 135 rollback — restore the pre-fix Stage 134 creation function.
-- MANUAL / REVIEWED APPLY ONLY. Do not run from the application, CI, or this
-- change set. This file replaces only admin_create_book_volume_series(uuid, jsonb).
-- It does not add columns and it does not rewrite existing books or flags.
--
-- This is the complete Stage 134 function, including member metadata and
-- is_new=true on insert. It is not STAGE134_SERIES_VOLUME_METADATA_ROLLBACK.sql.
-- That file restores the Stage 133 function and would stop storing the
-- Stage 134 metadata columns.

CREATE OR REPLACE FUNCTION public.admin_create_book_volume_series(
  p_request_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $create_series$
DECLARE
  v_existing_group bigint;
  v_existing_hash text;
  v_hash text;
  v_title text;
  v_author text;
  v_category text;
  v_source text;
  v_description text;
  v_price numeric(12,2);
  v_count integer;
  v_representative integer;
  v_part jsonb;
  v_position integer;
  v_part_title text;
  v_part_price numeric(12,2);
  v_part_stock integer;
  v_part_isbn text;
  v_part_url text;
  v_part_label text;
  v_part_year integer;
  v_part_pages integer;
  v_part_years integer[] := ARRAY[]::integer[];
  v_part_pages_list integer[] := ARRAY[]::integer[];
  v_shared_publisher text;
  v_shared_translator text;
  v_shared_year integer;
  v_shared_pages integer;
  v_shared_cover text;
  v_shared_size text;
  v_part_author text;
  v_part_translator text;
  v_part_publisher text;
  v_part_cover text;
  v_part_size text;
  v_part_status text;
  v_part_authors text[] := ARRAY[]::text[];
  v_part_translators text[] := ARRAY[]::text[];
  v_part_publishers text[] := ARRAY[]::text[];
  v_part_covers text[] := ARRAY[]::text[];
  v_part_sizes text[] := ARRAY[]::text[];
  v_part_statuses text[] := ARRAY[]::text[];
  v_url_prefix text;
  v_book_id bigint;
  v_book_ids bigint[] := ARRAY[]::bigint[];
  v_members jsonb := '[]'::jsonb;
  v_saved jsonb;
  v_group_id bigint;
  v_canonical text;
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(p_payload->'parts') <> 'array' THEN
    RAISE EXCEPTION 'invalid_series_payload' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_payload->'parts');
  IF v_count < 2 OR v_count > 100 THEN
    RAISE EXCEPTION 'invalid_volume_count' USING ERRCODE = '22023';
  END IF;

  v_title := btrim(coalesce(p_payload->>'title', ''));
  v_author := left(btrim(coalesce(p_payload->>'author', '')), 500);
  v_category := left(btrim(coalesce(p_payload->>'category', '')), 200);
  v_source := left(btrim(coalesce(p_payload->>'source', '')), 300);
  v_description := left(btrim(coalesce(p_payload->>'description', '')), 10000);
  IF char_length(v_title) < 1 OR char_length(v_title) > 500 OR char_length(v_category) < 1 OR char_length(v_source) < 1 THEN
    RAISE EXCEPTION 'invalid_series_shared_fields' USING ERRCODE = '22023';
  END IF;
  IF v_source !~ '^[a-z0-9.-]+\.html$' THEN
    RAISE EXCEPTION 'invalid_series_source' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_price := nullif(btrim(coalesce(p_payload->>'complete_set_price', '')), '')::numeric(12,2);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_complete_set_price' USING ERRCODE = '22023';
  END;
  IF v_price IS NOT NULL AND v_price < 0 THEN
    RAISE EXCEPTION 'invalid_complete_set_price' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_representative := coalesce(nullif(btrim(coalesce(p_payload->>'representative_position', '')), '')::integer, 1);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_representative_volume' USING ERRCODE = '22023';
  END;
  IF v_representative < 1 OR v_representative > v_count THEN
    RAISE EXCEPTION 'invalid_representative_volume' USING ERRCODE = '22023';
  END IF;

  v_shared_publisher := nullif(left(btrim(coalesce(p_payload->>'publisher', '')), 500), '');
  v_shared_translator := nullif(left(btrim(coalesce(p_payload->>'translator', '')), 500), '');
  v_shared_cover := nullif(btrim(coalesce(p_payload->>'cover_type', '')), '');
  v_shared_size := nullif(btrim(coalesce(p_payload->>'book_size', '')), '');
  IF v_shared_cover IS NOT NULL AND v_shared_cover NOT IN ('hardcover', 'paperback', 'other') THEN
    RAISE EXCEPTION 'invalid_series_cover_type' USING ERRCODE = '22023';
  END IF;
  IF v_shared_size IS NOT NULL AND v_shared_size NOT IN ('A4', 'A5', 'B5', 'other') THEN
    RAISE EXCEPTION 'invalid_series_book_size' USING ERRCODE = '22023';
  END IF;
  v_shared_year := NULL;
  v_shared_pages := NULL;
  IF jsonb_exists(p_payload, 'publish_year') AND nullif(btrim(p_payload->>'publish_year'), '') IS NOT NULL THEN
    BEGIN
      v_shared_year := btrim(p_payload->>'publish_year')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_series_shared_fields' USING ERRCODE = '22023';
    END;
    IF v_shared_year < 1000 OR v_shared_year > 2100 THEN
      RAISE EXCEPTION 'invalid_series_shared_fields' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF jsonb_exists(p_payload, 'pages') AND nullif(btrim(p_payload->>'pages'), '') IS NOT NULL THEN
    BEGIN
      v_shared_pages := btrim(p_payload->>'pages')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_series_shared_fields' USING ERRCODE = '22023';
    END;
    IF v_shared_pages < 1 THEN
      RAISE EXCEPTION 'invalid_series_shared_fields' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_payload ? 'authors' THEN
    IF jsonb_typeof(p_payload->'authors') <> 'array' OR jsonb_array_length(p_payload->'authors') > 8 THEN
      RAISE EXCEPTION 'invalid_series_authors' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_payload->'authors') AS name
      WHERE char_length(btrim(name)) < 1 OR char_length(btrim(name)) > 500
    ) THEN
      RAISE EXCEPTION 'invalid_series_authors' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_payload ? 'translators' THEN
    IF jsonb_typeof(p_payload->'translators') <> 'array' OR jsonb_array_length(p_payload->'translators') > 8 THEN
      RAISE EXCEPTION 'invalid_series_translators' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_payload->'translators') AS name
      WHERE char_length(btrim(name)) < 1 OR char_length(btrim(name)) > 500
    ) THEN
      RAISE EXCEPTION 'invalid_series_translators' USING ERRCODE = '22023';
    END IF;
    IF v_shared_translator IS NULL THEN
      SELECT nullif(left(string_agg(btrim(name), '، ' ORDER BY ordinality), 500), '')
      INTO v_shared_translator
      FROM jsonb_array_elements_text(p_payload->'translators') WITH ORDINALITY AS names(name, ordinality);
    END IF;
  END IF;

  v_url_prefix := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/' || lower(p_request_id::text) || '/part-';
  v_canonical := concat_ws(E'\x1f', v_title, v_author, v_category, v_source, v_description, coalesce(v_price::text, ''), v_representative::text);
  IF p_payload ? 'authors' THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'authors', (SELECT string_agg(btrim(name), E'\x1f' ORDER BY ordinality) FROM jsonb_array_elements_text(p_payload->'authors') WITH ORDINALITY AS names(name, ordinality)));
  END IF;
  IF p_payload ? 'translators' THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'translators', (SELECT string_agg(btrim(name), E'\x1f' ORDER BY ordinality) FROM jsonb_array_elements_text(p_payload->'translators') WITH ORDINALITY AS names(name, ordinality)));
  END IF;
  IF v_shared_translator IS NOT NULL AND NOT (p_payload ? 'translators') THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'translator', v_shared_translator);
  END IF;
  IF v_shared_publisher IS NOT NULL THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'publisher', v_shared_publisher);
  END IF;
  IF v_shared_year IS NOT NULL THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'shared_publish_year', v_shared_year::text);
  END IF;
  IF v_shared_pages IS NOT NULL THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'shared_pages', v_shared_pages::text);
  END IF;
  IF v_shared_cover IS NOT NULL THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'cover_type', v_shared_cover);
  END IF;
  IF v_shared_size IS NOT NULL THEN
    v_canonical := concat_ws(E'\x1f', v_canonical, 'book_size', v_shared_size);
  END IF;

  FOR v_part, v_position IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_payload->'parts') WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_part) <> 'object' THEN
      RAISE EXCEPTION 'invalid_series_part' USING ERRCODE = '22023';
    END IF;
    v_part_title := left(btrim(coalesce(v_part->>'title', '')), 500);
    IF v_part_title = '' THEN
      v_part_title := left(v_title || ' ' || v_position::text || '. قىسىم', 500);
    END IF;
    BEGIN
      v_part_price := btrim(coalesce(v_part->>'price', ''))::numeric(12,2);
      v_part_stock := btrim(coalesce(v_part->>'stock', ''))::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_series_part' USING ERRCODE = '22023';
    END;
    IF v_part_price IS NULL OR v_part_price < 0 OR v_part_stock IS NULL OR v_part_stock < 0 THEN
      RAISE EXCEPTION 'invalid_series_part' USING ERRCODE = '22023';
    END IF;
    v_part_isbn := left(regexp_replace(coalesce(v_part->>'isbn', ''), '[^0-9Xx]', '', 'g'), 13);
    IF v_part_isbn <> '' AND char_length(v_part_isbn) NOT IN (10, 13) THEN
      RAISE EXCEPTION 'invalid_series_isbn' USING ERRCODE = '22023';
    END IF;
    v_part_year := NULL;
    v_part_pages := NULL;
    IF jsonb_exists(v_part, 'publish_year') AND nullif(btrim(v_part->>'publish_year'), '') IS NOT NULL THEN
      BEGIN
        v_part_year := btrim(v_part->>'publish_year')::integer;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid_series_part' USING ERRCODE = '22023';
      END;
      IF v_part_year < 1000 OR v_part_year > 2100 THEN
        RAISE EXCEPTION 'invalid_series_part' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF jsonb_exists(v_part, 'pages') AND nullif(btrim(v_part->>'pages'), '') IS NOT NULL THEN
      BEGIN
        v_part_pages := btrim(v_part->>'pages')::integer;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid_series_part' USING ERRCODE = '22023';
      END;
      IF v_part_pages < 1 THEN
        RAISE EXCEPTION 'invalid_series_part' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_part_year IS NULL THEN
      v_part_year := v_shared_year;
    END IF;
    IF v_part_pages IS NULL THEN
      v_part_pages := v_shared_pages;
    END IF;
    v_part_author := v_author;
    IF jsonb_exists(v_part, 'author') AND nullif(btrim(v_part->>'author'), '') IS NOT NULL THEN
      v_part_author := left(btrim(v_part->>'author'), 500);
      v_canonical := concat_ws(E'\x1f', v_canonical, 'part_author', v_position::text, v_part_author);
    END IF;
    v_part_translator := v_shared_translator;
    IF jsonb_exists(v_part, 'translator') AND nullif(btrim(v_part->>'translator'), '') IS NOT NULL THEN
      v_part_translator := left(btrim(v_part->>'translator'), 500);
      v_canonical := concat_ws(E'\x1f', v_canonical, 'part_translator', v_position::text, v_part_translator);
    END IF;
    v_part_publisher := v_shared_publisher;
    IF jsonb_exists(v_part, 'publisher') AND nullif(btrim(v_part->>'publisher'), '') IS NOT NULL THEN
      v_part_publisher := left(btrim(v_part->>'publisher'), 500);
      v_canonical := concat_ws(E'\x1f', v_canonical, 'part_publisher', v_position::text, v_part_publisher);
    END IF;
    v_part_cover := v_shared_cover;
    IF jsonb_exists(v_part, 'cover_type') AND nullif(btrim(v_part->>'cover_type'), '') IS NOT NULL THEN
      v_part_cover := btrim(v_part->>'cover_type');
      IF v_part_cover NOT IN ('hardcover', 'paperback', 'other') THEN
        RAISE EXCEPTION 'invalid_series_cover_type' USING ERRCODE = '22023';
      END IF;
      v_canonical := concat_ws(E'\x1f', v_canonical, 'part_cover_type', v_position::text, v_part_cover);
    END IF;
    v_part_size := v_shared_size;
    IF jsonb_exists(v_part, 'book_size') AND nullif(btrim(v_part->>'book_size'), '') IS NOT NULL THEN
      v_part_size := btrim(v_part->>'book_size');
      IF v_part_size NOT IN ('A4', 'A5', 'B5', 'other') THEN
        RAISE EXCEPTION 'invalid_series_book_size' USING ERRCODE = '22023';
      END IF;
      v_canonical := concat_ws(E'\x1f', v_canonical, 'part_book_size', v_position::text, v_part_size);
    END IF;
    v_part_status := NULL;
    IF jsonb_exists(v_part, 'stock_status') AND nullif(btrim(v_part->>'stock_status'), '') IS NOT NULL THEN
      v_part_status := btrim(v_part->>'stock_status');
      IF v_part_status NOT IN ('in_stock', 'low_stock', 'out_of_stock') THEN
        RAISE EXCEPTION 'invalid_series_stock_status' USING ERRCODE = '22023';
      END IF;
      v_canonical := concat_ws(E'\x1f', v_canonical, 'stock_status', v_position::text, v_part_status);
    END IF;
    v_part_url := btrim(coalesce(v_part->>'image_url', ''));
    v_part_label := left(coalesce(nullif(btrim(coalesce(v_part->>'volume_label', '')), ''), v_position::text || '-قىسىم'), 120);
    IF left(v_part_url, char_length(v_url_prefix || v_position::text || '-'))
         IS DISTINCT FROM v_url_prefix || v_position::text || '-'
       OR v_part_url !~ '^https://www\.kutadgubilik\.com/__r2/book-covers/series-new/[0-9a-f-]{36}/part-[1-9][0-9]{0,2}-[A-Za-z0-9._-]+\.(webp|jpg|jpeg|png)$'
       OR position(v_part_url IN v_canonical) > 0 THEN
      RAISE EXCEPTION 'invalid_series_cover' USING ERRCODE = '22023';
    END IF;
    v_part_years := v_part_years || v_part_year;
    v_part_pages_list := v_part_pages_list || v_part_pages;
    v_part_authors := array_append(v_part_authors, v_part_author);
    v_part_translators := array_append(v_part_translators, v_part_translator);
    v_part_publishers := array_append(v_part_publishers, v_part_publisher);
    v_part_covers := array_append(v_part_covers, v_part_cover);
    v_part_sizes := array_append(v_part_sizes, v_part_size);
    v_part_statuses := array_append(v_part_statuses, v_part_status);
    v_canonical := concat_ws(E'\x1f', v_canonical, v_position::text, v_part_title, v_part_price::text, v_part_stock::text, v_part_isbn, v_part_url, v_part_label);
    -- Optional integers stay out of the canonical hash when they are absent or
    -- blank, so a retry of a payload saved before those keys existed still matches.
    IF v_part_year IS NOT NULL THEN
      v_canonical := concat_ws(E'\x1f', v_canonical, 'publish_year', v_part_year::text);
    END IF;
    IF v_part_pages IS NOT NULL THEN
      v_canonical := concat_ws(E'\x1f', v_canonical, 'pages', v_part_pages::text);
    END IF;
  END LOOP;

  v_hash := md5(v_canonical);

  SELECT group_id, payload_sha256
    INTO v_existing_group, v_existing_hash
  FROM public.book_volume_series_requests
  WHERE request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash IS DISTINCT FROM v_hash OR v_existing_group IS NULL THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN public.admin_get_book_volume_group(v_existing_group) || jsonb_build_object('replayed', true);
  END IF;

  BEGIN
    INSERT INTO public.book_volume_series_requests (request_id, payload_sha256, group_id)
    VALUES (p_request_id, v_hash, NULL);
  EXCEPTION WHEN unique_violation THEN
    SELECT group_id, payload_sha256
      INTO v_existing_group, v_existing_hash
    FROM public.book_volume_series_requests
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF v_existing_hash IS DISTINCT FROM v_hash OR v_existing_group IS NULL THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN public.admin_get_book_volume_group(v_existing_group) || jsonb_build_object('replayed', true);
  END;

  FOR v_part, v_position IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_payload->'parts') WITH ORDINALITY
  LOOP
    v_part_title := left(btrim(coalesce(v_part->>'title', '')), 500);
    IF v_part_title = '' THEN
      v_part_title := left(v_title || ' ' || v_position::text || '. قىسىم', 500);
    END IF;
    v_part_price := btrim(v_part->>'price')::numeric(12,2);
    v_part_stock := btrim(v_part->>'stock')::integer;
    v_part_isbn := left(regexp_replace(coalesce(v_part->>'isbn', ''), '[^0-9Xx]', '', 'g'), 13);
    v_part_url := btrim(v_part->>'image_url');
    v_part_label := left(coalesce(nullif(btrim(coalesce(v_part->>'volume_label', '')), ''), v_position::text || '-قىسىم'), 120);
    v_part_year := v_part_years[v_position];
    v_part_pages := v_part_pages_list[v_position];
    v_part_author := v_part_authors[v_position];
    v_part_translator := v_part_translators[v_position];
    v_part_publisher := v_part_publishers[v_position];
    v_part_cover := v_part_covers[v_position];
    v_part_size := v_part_sizes[v_position];
    v_part_status := v_part_statuses[v_position];
    PERFORM pg_advisory_xact_lock(hashtextextended(v_part_url, 0));
    IF EXISTS (SELECT 1 FROM public.books AS b WHERE b.image_url = v_part_url) THEN
      RAISE EXCEPTION 'series_cover_already_used' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.books (
      title, author, translator, publisher, price, original_price, category, source, image_url,
      description, stock, stock_status, is_active, is_new, isbn, submission_status,
      publish_year, pages, cover_type, book_size
    ) VALUES (
      v_part_title, v_part_author, v_part_translator, v_part_publisher, v_part_price, v_part_price, v_category, v_source, v_part_url,
      v_description, v_part_stock, v_part_status, false, true, v_part_isbn, 'series_draft',
      v_part_year, v_part_pages, v_part_cover, v_part_size
    )
    RETURNING id INTO v_book_id;

    v_book_ids := v_book_ids || v_book_id;
    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'book_id', v_book_id,
      'position', v_position,
      'volume_label', v_part_label
    ));
  END LOOP;

  v_saved := public.admin_save_book_volume_group(
    NULL,
    NULL,
    jsonb_build_object(
      'slug', 'series-' || v_book_ids[1]::text,
      'title', v_title,
      'author', v_author,
      'category', v_category,
      'source', v_source,
      'description', v_description,
      'complete_set_price', v_price,
      'representative_book_id', v_book_ids[v_representative],
      'is_active', true
    ),
    v_members
  );
  v_group_id := (v_saved->>'id')::bigint;
  IF v_group_id IS NULL OR coalesce((v_saved->>'is_public')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'series_not_private' USING ERRCODE = '23514';
  END IF;
  IF v_price IS NULL THEN
    IF v_saved->>'complete_set_price' IS NOT NULL THEN
      RAISE EXCEPTION 'explicit_price_replaced' USING ERRCODE = '23514';
    END IF;
  ELSIF (v_saved->>'complete_set_price')::numeric IS DISTINCT FROM v_price THEN
    RAISE EXCEPTION 'explicit_price_replaced' USING ERRCODE = '23514';
  END IF;

  UPDATE public.book_volume_series_requests
  SET group_id = v_group_id
  WHERE request_id = p_request_id;

  RETURN v_saved || jsonb_build_object('replayed', false);
END;
$create_series$;

REVOKE ALL ON FUNCTION public.admin_create_book_volume_series(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_book_volume_series(uuid, jsonb) TO authenticated;
