-- ============================================================================
-- Kutadgu Bilig — Stage Admin 1J pending book edit (Full Admin review)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe CREATE OR REPLACE of update_pending_staff_book_submission.
-- Does not apply itself to production. Agents must not execute this file.
-- Does not rewrite catalog rows, covers, gallery files, IDs, books RLS,
-- storage policies, admin_users, Book Staff roles, or approve/reject RPCs.
-- Save cannot publish: submission_status stays pending; is_active and
-- is_available are never assigned.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_pending_staff_book_submission(p_book_id bigint, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pending_edit$
DECLARE
  v_updated integer;
  v_title text;
  v_author text;
  v_price numeric(12,2);
  v_category text;
  v_source text;
  v_image_url text;
  v_pages integer;
  v_translator text;
  v_publish_year integer;
  v_publisher text;
  v_cover_type text;
  v_book_size text;
  v_description text;
  v_stock integer;
  v_isbn text;
  v_original_price numeric(12,2);
  v_dimensions text := '';
  v_is_color_print boolean;
  v_interior_print_type text;
  v_gallery jsonb := NULL;
  v_gallery_url text;
  v_gallery_item jsonb;
  v_gallery_len integer;
  v_gallery_i integer;
  v_cover_root text := 'https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/';
  v_path_rest text;
  v_forbidden text[] := ARRAY[
    'id',
    'created_at',
    'updated_at',
    'sales_count',
    'is_active',
    'is_available',
    'is_recommended',
    'is_new',
    'is_bestseller',
    'is_featured',
    'submission_status',
    'submitted_by',
    'submitted_at',
    'legacy_id',
    'href',
    'language',
    'publish_date'
  ];
  v_allowed text[] := ARRAY[
    'title',
    'author',
    'category',
    'price',
    'image_url',
    'description',
    'source',
    'stock',
    'isbn',
    'translator',
    'publisher',
    'publish_year',
    'pages',
    'cover_type',
    'book_size',
    'gallery_images',
    'original_price',
    'dimensions',
    'is_color_print',
    'interior_print_type'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_kutadgu_admin() THEN
    RAISE EXCEPTION 'Admin permission required' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_book_id IS NULL THEN
    RAISE EXCEPTION 'book id is required' USING ERRCODE = '22023';
  END IF;
  IF payload IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid book payload' USING ERRCODE = '22023';
  END IF;
  IF payload ?| v_forbidden THEN
    RAISE EXCEPTION 'Client may not set publication or identity fields' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(payload) AS k(key)
    WHERE NOT (k.key = ANY (v_allowed))
  ) THEN
    RAISE EXCEPTION 'Unsupported book field' USING ERRCODE = '22023';
  END IF;

  v_title := NULLIF(btrim(COALESCE(payload->>'title', '')), '');
  v_author := NULLIF(btrim(COALESCE(payload->>'author', '')), '');
  v_category := NULLIF(btrim(COALESCE(payload->>'category', '')), '');
  v_source := NULLIF(btrim(COALESCE(payload->>'source', '')), '');
  IF payload ? 'title' AND v_title IS NULL THEN
    RAISE EXCEPTION 'title is required' USING ERRCODE = '22023';
  END IF;
  IF payload ? 'author' AND v_author IS NULL THEN
    RAISE EXCEPTION 'author is required' USING ERRCODE = '22023';
  END IF;
  IF payload ? 'category' AND v_category IS NULL THEN
    RAISE EXCEPTION 'category is required' USING ERRCODE = '22023';
  END IF;
  IF payload ? 'source' AND v_source IS NULL THEN
    RAISE EXCEPTION 'source is required' USING ERRCODE = '22023';
  END IF;

  IF payload ? 'price' THEN
    IF jsonb_typeof(payload->'price') = 'number' THEN
      v_price := (payload->>'price')::numeric;
    ELSIF jsonb_typeof(payload->'price') = 'string' AND btrim(payload->>'price') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_price := btrim(payload->>'price')::numeric;
    ELSIF payload->'price' IS NULL OR jsonb_typeof(payload->'price') = 'null' THEN
      v_price := NULL;
    ELSE
      RAISE EXCEPTION 'price must be a non-negative number' USING ERRCODE = '22023';
    END IF;
    IF v_price IS NOT NULL AND v_price < 0 THEN
      RAISE EXCEPTION 'price must be non-negative' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF payload ? 'stock' THEN
    IF payload->'stock' IS NULL OR jsonb_typeof(payload->'stock') = 'null' THEN
      v_stock := NULL;
    ELSIF jsonb_typeof(payload->'stock') = 'number' AND (payload->>'stock') ~ '^[0-9]+$' THEN
      v_stock := (payload->>'stock')::integer;
    ELSIF jsonb_typeof(payload->'stock') = 'string' AND btrim(payload->>'stock') ~ '^[0-9]+$' THEN
      v_stock := btrim(payload->>'stock')::integer;
    ELSE
      RAISE EXCEPTION 'stock must be a non-negative integer' USING ERRCODE = '22023';
    END IF;
    IF v_stock IS NOT NULL AND v_stock < 0 THEN
      RAISE EXCEPTION 'stock must be non-negative' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF payload ? 'pages' THEN
    IF payload->'pages' IS NULL OR jsonb_typeof(payload->'pages') = 'null' OR btrim(COALESCE(payload->>'pages', '')) = '' THEN
      v_pages := NULL;
    ELSIF jsonb_typeof(payload->'pages') = 'number' AND (payload->>'pages') ~ '^[0-9]+$' THEN
      v_pages := (payload->>'pages')::integer;
    ELSIF jsonb_typeof(payload->'pages') = 'string' AND btrim(payload->>'pages') ~ '^[0-9]+$' THEN
      v_pages := btrim(payload->>'pages')::integer;
    ELSE
      RAISE EXCEPTION 'pages must be a positive integer' USING ERRCODE = '22023';
    END IF;
    IF v_pages IS NOT NULL AND v_pages < 1 THEN
      RAISE EXCEPTION 'pages must be a positive integer' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF payload ? 'publish_year' THEN
    IF payload->'publish_year' IS NULL OR jsonb_typeof(payload->'publish_year') = 'null' OR btrim(COALESCE(payload->>'publish_year', '')) = '' THEN
      v_publish_year := NULL;
    ELSIF jsonb_typeof(payload->'publish_year') = 'number' AND (payload->>'publish_year') ~ '^[0-9]+$' THEN
      v_publish_year := (payload->>'publish_year')::integer;
    ELSIF jsonb_typeof(payload->'publish_year') = 'string' AND btrim(payload->>'publish_year') ~ '^[0-9]+$' THEN
      v_publish_year := btrim(payload->>'publish_year')::integer;
    ELSE
      RAISE EXCEPTION 'publish_year must be a year' USING ERRCODE = '22023';
    END IF;
    IF v_publish_year IS NOT NULL AND (v_publish_year < 1000 OR v_publish_year > 2100) THEN
      RAISE EXCEPTION 'publish_year must be a year' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF payload ? 'isbn' THEN
    v_isbn := NULLIF(btrim(COALESCE(payload->>'isbn', '')), '');
  END IF;
  IF payload ? 'translator' THEN
    v_translator := NULLIF(btrim(COALESCE(payload->>'translator', '')), '');
  END IF;
  IF payload ? 'publisher' THEN
    v_publisher := NULLIF(btrim(COALESCE(payload->>'publisher', '')), '');
  END IF;
  IF payload ? 'description' THEN
    v_description := NULLIF(btrim(COALESCE(payload->>'description', '')), '');
  END IF;

  IF payload ? 'cover_type' THEN
    v_cover_type := NULLIF(btrim(COALESCE(payload->>'cover_type', '')), '');
    IF v_cover_type IS NOT NULL AND v_cover_type NOT IN ('hardcover', 'paperback', 'other') THEN
      RAISE EXCEPTION 'invalid cover_type' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF payload ? 'book_size' THEN
    v_book_size := NULLIF(btrim(COALESCE(payload->>'book_size', '')), '');
    IF v_book_size IS NOT NULL AND v_book_size NOT IN ('A4', 'A5', 'B5', 'other') THEN
      RAISE EXCEPTION 'invalid book_size' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF payload ? 'original_price' THEN
    IF payload->'original_price' IS NULL OR jsonb_typeof(payload->'original_price') = 'null' OR btrim(COALESCE(payload->>'original_price', '')) = '' THEN
      v_original_price := NULL;
    ELSIF jsonb_typeof(payload->'original_price') = 'number' THEN
      v_original_price := (payload->>'original_price')::numeric;
    ELSIF jsonb_typeof(payload->'original_price') = 'string' AND btrim(payload->>'original_price') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_original_price := btrim(payload->>'original_price')::numeric;
    ELSE
      RAISE EXCEPTION 'original_price must be a non-negative number' USING ERRCODE = '22023';
    END IF;
    IF v_original_price IS NOT NULL AND v_original_price < 0 THEN
      RAISE EXCEPTION 'original_price must be non-negative' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF payload ? 'dimensions' THEN
    v_dimensions := left(btrim(COALESCE(payload->>'dimensions', '')), 120);
  END IF;

  IF payload ? 'is_color_print' THEN
    IF jsonb_typeof(payload->'is_color_print') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'is_color_print must be a boolean' USING ERRCODE = '22023';
    END IF;
    v_is_color_print := (payload->>'is_color_print')::boolean;
  END IF;

  IF payload ? 'interior_print_type' THEN
    IF payload->'interior_print_type' IS NULL OR jsonb_typeof(payload->'interior_print_type') = 'null' THEN
      v_interior_print_type := NULL;
    ELSE
      v_interior_print_type := NULLIF(btrim(COALESCE(payload->>'interior_print_type', '')), '');
      IF v_interior_print_type IS NOT NULL AND v_interior_print_type NOT IN ('color', 'bw') THEN
        RAISE EXCEPTION 'invalid interior_print_type' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF payload ? 'image_url' AND payload->'image_url' IS NOT NULL AND jsonb_typeof(payload->'image_url') IS DISTINCT FROM 'null' THEN
    v_image_url := btrim(payload->>'image_url');
    IF v_image_url = '' THEN
      v_image_url := NULL;
    ELSE
      IF position('..' in v_image_url) > 0
         OR v_image_url ~ '[?#@<>[:space:]]'
         OR v_image_url ~* '^(javascript|data|vbscript|file):'
         OR v_image_url NOT LIKE (v_cover_root || '%') THEN
        RAISE EXCEPTION 'image_url must be a book-covers public URL' USING ERRCODE = '42501';
      END IF;
      v_path_rest := substr(v_image_url, length(v_cover_root) + 1);
      IF v_path_rest = ''
         OR v_path_rest !~ '^[A-Za-z0-9._/-]+$'
         OR v_path_rest !~* '\.(jpe?g|png|webp|gif)$' THEN
        RAISE EXCEPTION 'image_url must be a book-covers public URL' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF payload ? 'gallery_images' THEN
    IF payload->'gallery_images' IS NULL OR jsonb_typeof(payload->'gallery_images') = 'null' THEN
      v_gallery := '[]'::jsonb;
    ELSE
      IF jsonb_typeof(payload->'gallery_images') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'gallery_images must be a JSON array' USING ERRCODE = '22023';
      END IF;
      v_gallery_len := jsonb_array_length(payload->'gallery_images');
      IF v_gallery_len > 4 THEN
        RAISE EXCEPTION 'gallery_images may contain at most 4 items' USING ERRCODE = '22023';
      END IF;
      v_gallery := '[]'::jsonb;
      FOR v_gallery_i IN 0 .. GREATEST(v_gallery_len - 1, -1) LOOP
        EXIT WHEN v_gallery_len = 0;
        v_gallery_item := payload->'gallery_images'->v_gallery_i;
        IF jsonb_typeof(v_gallery_item) IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'gallery_images items must be strings' USING ERRCODE = '22023';
        END IF;
        v_gallery_url := btrim(v_gallery_item #>> '{}');
        IF v_gallery_url = '' OR length(v_gallery_url) > 2000 THEN
          RAISE EXCEPTION 'gallery_images URL is invalid' USING ERRCODE = '22023';
        END IF;
        IF position('..' in v_gallery_url) > 0
           OR v_gallery_url ~ '[?#@<>[:space:]]'
           OR v_gallery_url ~* '^(javascript|data|vbscript|file):'
           OR v_gallery_url NOT LIKE (v_cover_root || '%') THEN
          RAISE EXCEPTION 'gallery_images must be book-covers public URLs' USING ERRCODE = '42501';
        END IF;
        v_path_rest := substr(v_gallery_url, length(v_cover_root) + 1);
        IF v_path_rest = ''
           OR v_path_rest !~ '^[A-Za-z0-9._/-]+$'
           OR v_path_rest !~* '\.(jpe?g|png|webp|gif)$' THEN
          RAISE EXCEPTION 'gallery_images must be book-covers public URLs' USING ERRCODE = '42501';
        END IF;
        v_gallery := v_gallery || jsonb_build_array(v_gallery_url);
      END LOOP;
    END IF;
  END IF;

  UPDATE public.books
     SET title = CASE WHEN payload ? 'title' THEN v_title ELSE title END,
         author = CASE WHEN payload ? 'author' THEN v_author ELSE author END,
         category = CASE WHEN payload ? 'category' THEN v_category ELSE category END,
         source = CASE WHEN payload ? 'source' THEN v_source ELSE source END,
         price = CASE WHEN payload ? 'price' THEN v_price ELSE price END,
         stock = CASE WHEN payload ? 'stock' THEN v_stock ELSE stock END,
         isbn = CASE WHEN payload ? 'isbn' THEN v_isbn ELSE isbn END,
         translator = CASE WHEN payload ? 'translator' THEN v_translator ELSE translator END,
         publisher = CASE WHEN payload ? 'publisher' THEN v_publisher ELSE publisher END,
         publish_year = CASE WHEN payload ? 'publish_year' THEN v_publish_year ELSE publish_year END,
         pages = CASE WHEN payload ? 'pages' THEN v_pages ELSE pages END,
         cover_type = CASE WHEN payload ? 'cover_type' THEN v_cover_type ELSE cover_type END,
         book_size = CASE WHEN payload ? 'book_size' THEN v_book_size ELSE book_size END,
         description = CASE WHEN payload ? 'description' THEN v_description ELSE description END,
         image_url = CASE WHEN payload ? 'image_url' THEN COALESCE(v_image_url, image_url) ELSE image_url END,
         gallery_images = CASE WHEN payload ? 'gallery_images' THEN v_gallery ELSE gallery_images END,
         original_price = CASE WHEN payload ? 'original_price' THEN v_original_price ELSE original_price END,
         dimensions = CASE WHEN payload ? 'dimensions' THEN v_dimensions ELSE dimensions END,
         is_color_print = CASE WHEN payload ? 'is_color_print' THEN v_is_color_print ELSE is_color_print END,
         interior_print_type = CASE WHEN payload ? 'interior_print_type' THEN v_interior_print_type ELSE interior_print_type END,
         submission_status = 'pending'
   WHERE id = p_book_id
     AND submission_status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Only pending staff submissions can be edited' USING ERRCODE = 'P0002';
  END IF;
END;
$pending_edit$;

REVOKE ALL ON FUNCTION public.update_pending_staff_book_submission(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_pending_staff_book_submission(bigint, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_pending_staff_book_submission(bigint, jsonb) TO authenticated;
