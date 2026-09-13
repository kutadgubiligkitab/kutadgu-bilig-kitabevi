-- ============================================================================
-- Kutadgu Bilig — Stage Admin 1G Book Staff gallery images
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe CREATE OR REPLACE of submit_book_for_approval(jsonb) only.
-- Does not apply itself to production. Agents must not execute this file.
-- Does not rewrite existing catalog rows, covers, gallery files, IDs,
-- storage policies, books RLS, or Admin approve/reject RPCs.
-- Does not change books_gallery_images_array_chk (max 4 remains).
-- Does not create a new bucket. Staff storage INSERT prefix stays
-- staff/<auth.uid()>/... (gallery/ is a subpath of the existing policy).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_book_for_approval(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $submit$
DECLARE
  v_uid uuid := auth.uid();
  v_id bigint;
  v_title text;
  v_author text;
  v_price numeric(12,2);
  v_original_price numeric(12,2);
  v_category text;
  v_source text;
  v_image_url text;
  v_pages integer;
  v_translator text;
  v_publish_year integer;
  v_publisher text;
  v_cover_type text;
  v_book_size text;
  v_dimensions text;
  v_description text;
  v_stock integer;
  v_isbn text;
  v_is_color_print boolean;
  v_interior_print_type text;
  v_gallery jsonb := '[]'::jsonb;
  v_gallery_url text;
  v_gallery_rest text;
  v_gallery_prefix text;
  v_gallery_item jsonb;
  v_gallery_len integer;
  v_gallery_i integer;
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
    'legacy_id'
  ];
  v_allowed text[] := ARRAY[
    'title',
    'author',
    'category',
    'price',
    'image_url',
    'description',
    'source',
    'original_price',
    'stock',
    'isbn',
    'translator',
    'publisher',
    'publish_year',
    'pages',
    'cover_type',
    'book_size',
    'dimensions',
    'is_color_print',
    'interior_print_type',
    'gallery_images'
  ];
  v_staff_path text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_kutadgu_book_staff() THEN
    RAISE EXCEPTION 'Book staff permission required' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required' USING ERRCODE = '42501';
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

  v_title := btrim(COALESCE(payload->>'title', ''));
  v_author := btrim(COALESCE(payload->>'author', ''));
  v_category := btrim(COALESCE(payload->>'category', ''));
  v_source := btrim(COALESCE(payload->>'source', ''));
  IF v_title = '' OR v_author = '' OR v_category = '' OR v_source = '' THEN
    RAISE EXCEPTION 'title, author, category and source are required' USING ERRCODE = '22023';
  END IF;

  IF payload ? 'price' AND jsonb_typeof(payload->'price') = 'number' THEN
    v_price := (payload->>'price')::numeric;
  ELSIF payload ? 'price' AND jsonb_typeof(payload->'price') = 'string' AND btrim(payload->>'price') ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_price := btrim(payload->>'price')::numeric;
  ELSE
    RAISE EXCEPTION 'price is required and must be a non-negative number' USING ERRCODE = '22023';
  END IF;
  IF v_price < 0 THEN
    RAISE EXCEPTION 'price must be non-negative' USING ERRCODE = '22023';
  END IF;

  IF payload ? 'original_price' AND payload->'original_price' IS NOT NULL AND jsonb_typeof(payload->'original_price') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(payload->'original_price') = 'number' THEN
      v_original_price := (payload->>'original_price')::numeric;
    ELSIF jsonb_typeof(payload->'original_price') = 'string' AND btrim(payload->>'original_price') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_original_price := btrim(payload->>'original_price')::numeric;
    ELSE
      RAISE EXCEPTION 'original_price must be a non-negative number' USING ERRCODE = '22023';
    END IF;
    IF v_original_price < 0 THEN
      RAISE EXCEPTION 'original_price must be non-negative' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_original_price := NULL;
  END IF;

  IF payload ? 'stock' AND payload->'stock' IS NOT NULL AND jsonb_typeof(payload->'stock') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(payload->'stock') = 'number' AND (payload->>'stock') ~ '^[0-9]+$' THEN
      v_stock := (payload->>'stock')::integer;
    ELSIF jsonb_typeof(payload->'stock') = 'string' AND btrim(payload->>'stock') ~ '^[0-9]+$' THEN
      v_stock := btrim(payload->>'stock')::integer;
    ELSE
      RAISE EXCEPTION 'stock must be a non-negative integer' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_stock := 0;
  END IF;
  IF v_stock < 0 THEN
    RAISE EXCEPTION 'stock must be non-negative' USING ERRCODE = '22023';
  END IF;

  IF payload ? 'pages' AND payload->'pages' IS NOT NULL AND jsonb_typeof(payload->'pages') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(payload->'pages') = 'number' AND (payload->>'pages') ~ '^[0-9]+$' THEN
      v_pages := (payload->>'pages')::integer;
    ELSIF jsonb_typeof(payload->'pages') = 'string' AND btrim(payload->>'pages') ~ '^[0-9]+$' THEN
      v_pages := btrim(payload->>'pages')::integer;
    ELSE
      RAISE EXCEPTION 'pages must be a positive integer' USING ERRCODE = '22023';
    END IF;
    IF v_pages < 1 THEN
      RAISE EXCEPTION 'pages must be a positive integer' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_pages := NULL;
  END IF;

  IF payload ? 'publish_year' AND payload->'publish_year' IS NOT NULL AND jsonb_typeof(payload->'publish_year') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(payload->'publish_year') = 'number' AND (payload->>'publish_year') ~ '^[0-9]+$' THEN
      v_publish_year := (payload->>'publish_year')::integer;
    ELSIF jsonb_typeof(payload->'publish_year') = 'string' AND btrim(payload->>'publish_year') ~ '^[0-9]+$' THEN
      v_publish_year := btrim(payload->>'publish_year')::integer;
    ELSE
      RAISE EXCEPTION 'publish_year must be an integer year' USING ERRCODE = '22023';
    END IF;
    IF v_publish_year < 1000 OR v_publish_year > 2100 THEN
      RAISE EXCEPTION 'publish_year is out of range' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_publish_year := NULL;
  END IF;

  v_author := left(v_author, 500);
  v_image_url := left(btrim(COALESCE(payload->>'image_url', '')), 2000);
  v_translator := left(btrim(COALESCE(payload->>'translator', '')), 500);
  v_publisher := left(btrim(COALESCE(payload->>'publisher', '')), 500);
  v_dimensions := left(btrim(COALESCE(payload->>'dimensions', '')), 120);
  v_description := left(btrim(COALESCE(payload->>'description', '')), 20000);
  v_isbn := left(btrim(COALESCE(payload->>'isbn', '')), 32);
  v_title := left(v_title, 500);
  v_category := left(v_category, 200);
  v_source := left(v_source, 200);

  v_staff_path := 'staff/' || v_uid::text || '/';
  IF v_image_url = '' THEN
    NULL;
  ELSIF position('..' in v_image_url) > 0
     OR v_image_url ~* '^(javascript|data|vbscript|file):' THEN
    RAISE EXCEPTION 'image_url must be empty or a book-covers staff path for this user' USING ERRCODE = '42501';
  ELSIF v_image_url LIKE (v_staff_path || '%')
     AND v_image_url !~* '^https?://'
     AND v_image_url !~ '^/' THEN
    NULL;
  ELSIF v_image_url LIKE (
      'https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/'
      || v_staff_path
      || '%'
    )
     AND v_image_url !~ '[?#@]' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'image_url must be empty or a book-covers staff path for this user' USING ERRCODE = '42501';
  END IF;

  IF payload ? 'cover_type' AND payload->>'cover_type' IS NOT NULL THEN
    v_cover_type := btrim(payload->>'cover_type');
    IF v_cover_type = '' THEN
      v_cover_type := NULL;
    ELSIF v_cover_type NOT IN ('hardcover', 'paperback', 'other') THEN
      RAISE EXCEPTION 'invalid cover_type' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_cover_type := NULL;
  END IF;

  IF payload ? 'book_size' AND payload->>'book_size' IS NOT NULL THEN
    v_book_size := btrim(payload->>'book_size');
    IF v_book_size = '' THEN
      v_book_size := NULL;
    ELSIF v_book_size NOT IN ('A4', 'A5', 'B5', 'other') THEN
      RAISE EXCEPTION 'invalid book_size' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_book_size := NULL;
  END IF;

  IF payload ? 'interior_print_type' AND payload->>'interior_print_type' IS NOT NULL THEN
    v_interior_print_type := btrim(payload->>'interior_print_type');
    IF v_interior_print_type = '' THEN
      v_interior_print_type := NULL;
    ELSIF v_interior_print_type NOT IN ('color', 'bw') THEN
      RAISE EXCEPTION 'invalid interior_print_type' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_interior_print_type := NULL;
  END IF;

  IF payload ? 'is_color_print' AND jsonb_typeof(payload->'is_color_print') = 'boolean' THEN
    v_is_color_print := (payload->>'is_color_print')::boolean;
  ELSE
    v_is_color_print := false;
  END IF;

  IF payload ? 'gallery_images'
     AND payload->'gallery_images' IS NOT NULL
     AND jsonb_typeof(payload->'gallery_images') IS DISTINCT FROM 'null' THEN
    IF jsonb_typeof(payload->'gallery_images') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'gallery_images must be a JSON array' USING ERRCODE = '22023';
    END IF;
    v_gallery_len := jsonb_array_length(payload->'gallery_images');
    IF v_gallery_len > 4 THEN
      RAISE EXCEPTION 'gallery_images may contain at most 4 items' USING ERRCODE = '22023';
    END IF;
    v_gallery_prefix :=
      'https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/'
      || v_uid::text
      || '/gallery/';
    FOR v_gallery_i IN 0 .. v_gallery_len - 1 LOOP
      v_gallery_item := payload->'gallery_images'->v_gallery_i;
      IF jsonb_typeof(v_gallery_item) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'gallery_images items must be strings' USING ERRCODE = '22023';
      END IF;
      v_gallery_url := btrim(v_gallery_item #>> '{}');
      IF v_gallery_url = '' OR length(v_gallery_url) > 2000 THEN
        RAISE EXCEPTION 'gallery_images URL is invalid' USING ERRCODE = '22023';
      END IF;
      IF position('..' in v_gallery_url) > 0
         OR v_gallery_url ~ '[?#@]'
         OR v_gallery_url ~* '^(javascript|data|vbscript|file):'
         OR v_gallery_url NOT LIKE (v_gallery_prefix || '%') THEN
        RAISE EXCEPTION 'gallery_images must be book-covers staff gallery URLs for this user' USING ERRCODE = '42501';
      END IF;
      v_gallery_rest := substr(v_gallery_url, length(v_gallery_prefix) + 1);
      IF v_gallery_rest = ''
         OR position('/' in v_gallery_rest) > 0
         OR v_gallery_rest !~ '^[A-Za-z0-9._-]+$'
         OR v_gallery_rest !~* '\.(jpe?g|png|webp|gif)$' THEN
        RAISE EXCEPTION 'gallery_images must be book-covers staff gallery URLs for this user' USING ERRCODE = '42501';
      END IF;
      v_gallery := v_gallery || jsonb_build_array(v_gallery_url);
    END LOOP;
  ELSE
    v_gallery := '[]'::jsonb;
  END IF;

  INSERT INTO public.books (
    title,
    author,
    price,
    original_price,
    category,
    source,
    image_url,
    pages,
    translator,
    publish_year,
    publisher,
    cover_type,
    book_size,
    dimensions,
    description,
    stock,
    isbn,
    is_color_print,
    interior_print_type,
    gallery_images,
    is_active,
    is_available,
    is_new,
    is_featured,
    is_recommended,
    is_bestseller,
    sales_count,
    submission_status,
    submitted_by,
    submitted_at
  ) VALUES (
    v_title,
    v_author,
    v_price,
    v_original_price,
    v_category,
    v_source,
    v_image_url,
    v_pages,
    v_translator,
    v_publish_year,
    v_publisher,
    v_cover_type,
    v_book_size,
    v_dimensions,
    v_description,
    v_stock,
    v_isbn,
    v_is_color_print,
    v_interior_print_type,
    v_gallery,
    false,
    false,
    false,
    false,
    false,
    false,
    0,
    'pending',
    v_uid,
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$submit$;

REVOKE ALL ON FUNCTION public.submit_book_for_approval(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_book_for_approval(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_book_for_approval(jsonb) TO authenticated;
