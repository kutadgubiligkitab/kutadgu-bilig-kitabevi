-- Stage 131 — create a new multi-part series in one admin+AAL2 transaction.
-- MANUAL / REVIEWED APPLY ONLY. Do not run from the application, CI, or this
-- change set. Stages 127–130 are already installed. Do not reapply them.
-- This file does not update, regroup, or republish any existing series.
-- A failed call rolls back every new book and the private series together.
-- Saving stays private. Publishing remains admin_set_book_volume_group_publication.
-- New parts are inserted inactive, with submission_status series_draft.
-- Public reads cannot see them until that publication promotes only those
-- member rows and marks the group public in the same transaction.
-- Linking books that already exist does not rewrite their visibility or price.
--
-- Data-preserving rollback: STAGE131_BOOK_VOLUME_SERIES_ENTRY_ROLLBACK.sql.

CREATE TABLE IF NOT EXISTS public.book_volume_series_requests (
  request_id uuid PRIMARY KEY,
  payload_sha256 text NOT NULL,
  group_id bigint REFERENCES public.book_volume_groups(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.book_volume_series_requests IS
  'Idempotency keys for admin_create_book_volume_series. A repeated key returns the same private series and does not insert more books.';

ALTER TABLE public.book_volume_series_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_submission_status_chk;
ALTER TABLE public.books
  ADD CONSTRAINT books_submission_status_chk
  CHECK (submission_status IN ('approved', 'pending', 'rejected', 'series_draft'));

REVOKE ALL ON TABLE public.book_volume_series_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_public_book_volume_part_prices(p_group_ids bigint[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $part_prices$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'group_id', g.id,
    'complete_set_price', g.complete_set_price,
    'effective_set_price', CASE
      WHEN g.complete_set_price IS NOT NULL THEN g.complete_set_price
      ELSE (
        SELECT sum(b.price)
        FROM public.book_volume_group_members AS m
        JOIN public.books AS b ON b.id = m.book_id
        WHERE m.group_id = g.id
      )
    END,
    'prices', (
      SELECT coalesce(jsonb_agg(b.price ORDER BY m.position), '[]'::jsonb)
      FROM public.book_volume_group_members AS m
      JOIN public.books AS b ON b.id = m.book_id
      WHERE m.group_id = g.id
    )
  ) ORDER BY g.id), '[]'::jsonb)
  FROM public.book_volume_groups AS g
  WHERE g.is_public
    AND g.is_active
    AND p_group_ids IS NOT NULL
    AND cardinality(p_group_ids) BETWEEN 1 AND 100
    AND g.id = ANY(p_group_ids);
$part_prices$;

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

CREATE OR REPLACE FUNCTION public.admin_get_book_volume_series_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $get_series_request$
DECLARE
  v_group_id bigint;
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_series_payload' USING ERRCODE = '22023';
  END IF;
  SELECT group_id INTO v_group_id
  FROM public.book_volume_series_requests
  WHERE request_id = p_request_id;
  IF NOT FOUND OR v_group_id IS NULL THEN
    RAISE EXCEPTION 'series_request_not_committed' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.admin_get_book_volume_group(v_group_id) || jsonb_build_object('replayed', true);
END;
$get_series_request$;

CREATE OR REPLACE FUNCTION public.series_draft_cover_is_referenced(p_image_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $cover_referenced$
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_image_url IS NULL OR btrim(p_image_url) = '' THEN
    RAISE EXCEPTION 'invalid_series_cover' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_image_url, 0));
  RETURN EXISTS (
    SELECT 1 FROM public.books AS b WHERE b.image_url = p_image_url
  );
END;
$cover_referenced$;

-- Stage 130 publication stays the admin action. This replacement promotes only
-- series_draft members, then uses the same completeness checks. Already
-- approved books, including a private link such as books 156 and 157, are not
-- updated. Unpublishing does not rewrite member rows.
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
    UPDATE public.books AS b
    SET is_active = true,
        submission_status = 'approved'
    WHERE b.submission_status = 'series_draft'
      AND b.id IN (
        SELECT m.book_id
        FROM public.book_volume_group_members AS m
        WHERE m.group_id = p_group_id
      );

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

REVOKE ALL ON FUNCTION public.list_public_book_volume_part_prices(bigint[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_book_volume_series(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_book_volume_series_request(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.series_draft_cover_is_referenced(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_public_book_volume_part_prices(bigint[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_book_volume_series(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_book_volume_series_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.series_draft_cover_is_referenced(text) TO authenticated;
