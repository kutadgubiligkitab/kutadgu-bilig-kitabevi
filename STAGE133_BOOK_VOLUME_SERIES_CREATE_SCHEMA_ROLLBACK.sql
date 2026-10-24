-- Stage 133 rollback — restore the function body that was installed by Stage 131.
-- MANUAL / REVIEWED APPLY ONLY. This does not add or drop columns.
-- Restoring that body returns the production failure: the INSERT names columns
-- public.books does not have. Use it only to reverse Stage 133 after review.

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

  v_url_prefix := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/' || lower(p_request_id::text) || '/part-';
  v_canonical := concat_ws(E'\x1f', v_title, v_author, v_category, v_source, v_description, coalesce(v_price::text, ''), v_representative::text);

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
    v_part_url := btrim(coalesce(v_part->>'image_url', ''));
    v_part_label := left(coalesce(nullif(btrim(coalesce(v_part->>'volume_label', '')), ''), v_position::text || '-قىسىم'), 120);
    IF left(v_part_url, char_length(v_url_prefix || v_position::text || '-'))
         IS DISTINCT FROM v_url_prefix || v_position::text || '-'
       OR v_part_url !~ '^https://www\.kutadgubilik\.com/__r2/book-covers/series-new/[0-9a-f-]{36}/part-[1-9][0-9]{0,2}-[A-Za-z0-9._-]+\.(webp|jpg|jpeg|png)$'
       OR position(v_part_url IN v_canonical) > 0 THEN
      RAISE EXCEPTION 'invalid_series_cover' USING ERRCODE = '22023';
    END IF;
    v_canonical := concat_ws(E'\x1f', v_canonical, v_position::text, v_part_title, v_part_price::text, v_part_stock::text, v_part_isbn, v_part_url, v_part_label);
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
    PERFORM pg_advisory_xact_lock(hashtextextended(v_part_url, 0));
    IF EXISTS (SELECT 1 FROM public.books AS b WHERE b.image_url = v_part_url) THEN
      RAISE EXCEPTION 'series_cover_already_used' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.books (
      title, author, price, original_price, category, source, image_url, href,
      description, stock, is_active, is_new, language, publish_date, publish_year,
      translator, publisher
    ) VALUES (
      v_part_title, v_author, v_part_price, v_part_price, v_category, v_source, v_part_url, '',
      v_description, v_part_stock, false, true, '', '', '',
      '', ''
    )
    RETURNING id INTO v_book_id;

    UPDATE public.books
    SET href = '/book/' || v_book_id::text
    WHERE id = v_book_id;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'books' AND column_name = 'isbn'
    ) THEN
      EXECUTE 'UPDATE public.books SET isbn = $1 WHERE id = $2'
      USING v_part_isbn, v_book_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'books' AND column_name = 'submission_status'
    ) THEN
      EXECUTE 'UPDATE public.books SET submission_status = $1 WHERE id = $2'
      USING 'series_draft', v_book_id;
    END IF;

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
