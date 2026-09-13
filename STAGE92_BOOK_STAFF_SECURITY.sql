-- ============================================================================
-- Kutadgu Bilig — Stage Admin 1A Book Staff security foundation
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify production until a human applies it.
-- Does not rewrite existing catalog rows, covers, IDs, or Admin policies.
-- Does not change public.is_kutadgu_admin() or public.admin_users.
-- Does not grant Book Staff UPDATE/DELETE on books or storage objects.
-- ============================================================================
--
-- Purpose:
--   Dedicated book_staff_users table (not admin_users) plus
--   is_kutadgu_book_staff() for a future restricted submitter role.
--   Staff create NEW books only via submit_book_for_approval(jsonb).
--   Submissions are forced pending + inactive. Admin+AAL2 approve/reject.
--   Staff may INSERT covers only under staff/<auth.uid()>/ in book-covers.
--
-- Existing books:
--   New submission_status defaults to 'approved'. ADD COLUMN fills that
--   default; title, is_active, sales_count, and other catalog fields are
--   not rewritten.
--
-- Depends on:
--   public.books, public.admin_users, public.is_kutadgu_admin()
--   STAGE2B / STAGE2C books + book-covers AAL2 policies
--   existing book-covers bucket
-- ============================================================================

BEGIN;

-- 1) Dedicated staff table. A row here is not Admin.
CREATE TABLE IF NOT EXISTS public.book_staff_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);

ALTER TABLE public.book_staff_users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.book_staff_users FROM PUBLIC;
REVOKE ALL ON TABLE public.book_staff_users FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.book_staff_users FROM authenticated;
GRANT SELECT ON TABLE public.book_staff_users TO authenticated;

DROP POLICY IF EXISTS "book staff can read own staff row" ON public.book_staff_users;
CREATE POLICY "book staff can read own staff row"
  ON public.book_staff_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "admin aal2 can read book staff users" ON public.book_staff_users;
CREATE POLICY "admin aal2 can read book staff users"
  ON public.book_staff_users
  FOR SELECT
  TO authenticated
  USING (
    public.is_kutadgu_admin()
    AND (SELECT auth.jwt()->>'aal') = 'aal2'
  );

-- 2) Staff helper. Does not replace or call is_kutadgu_admin().
CREATE OR REPLACE FUNCTION public.is_kutadgu_book_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.book_staff_users
    WHERE user_id = auth.uid()
      AND active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_kutadgu_book_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_kutadgu_book_staff() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_kutadgu_book_staff() TO authenticated;

-- 3) Backwards-compatible submission metadata. Existing rows stay approved.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS submission_status text NOT NULL DEFAULT 'approved';

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS submitted_by uuid NULL;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NULL;

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_submission_status_chk;
ALTER TABLE public.books
  ADD CONSTRAINT books_submission_status_chk
  CHECK (submission_status IN ('approved', 'pending', 'rejected'));

CREATE INDEX IF NOT EXISTS books_submission_status_pending_idx
  ON public.books (submission_status, submitted_at desc)
  WHERE submission_status = 'pending';

-- 4) Staff submission RPC. No direct staff INSERT/UPDATE/DELETE policy on books.
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
  v_href text;
  v_pages integer;
  v_translator text;
  v_language text;
  v_publish_date text;
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
    'gallery_images'
  ];
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

  v_title := btrim(COALESCE(payload->>'title', ''));
  v_category := btrim(COALESCE(payload->>'category', ''));
  v_source := btrim(COALESCE(payload->>'source', ''));
  IF v_title = '' OR v_category = '' OR v_source = '' THEN
    RAISE EXCEPTION 'title, category and source are required' USING ERRCODE = '22023';
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

  v_author := left(btrim(COALESCE(payload->>'author', '')), 500);
  v_image_url := left(btrim(COALESCE(payload->>'image_url', '')), 2000);
  v_href := left(btrim(COALESCE(payload->>'href', '')), 2000);
  v_translator := left(btrim(COALESCE(payload->>'translator', '')), 500);
  v_language := left(btrim(COALESCE(payload->>'language', '')), 120);
  v_publish_date := left(btrim(COALESCE(payload->>'publish_date', '')), 120);
  v_publisher := left(btrim(COALESCE(payload->>'publisher', '')), 500);
  v_dimensions := left(btrim(COALESCE(payload->>'dimensions', '')), 120);
  v_description := left(btrim(COALESCE(payload->>'description', '')), 20000);
  v_isbn := left(btrim(COALESCE(payload->>'isbn', '')), 32);
  v_title := left(v_title, 500);
  v_category := left(v_category, 200);
  v_source := left(v_source, 200);

  IF v_image_url <> '' AND (
    position('..' in v_image_url) > 0
    OR (
      v_image_url ~* 'book-covers|storage/v1/object'
      AND position(('staff/' || v_uid::text || '/') in v_image_url) = 0
    )
  ) THEN
    RAISE EXCEPTION 'image_url must stay on the submitting staff cover path' USING ERRCODE = '42501';
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

  INSERT INTO public.books (
    title,
    author,
    price,
    original_price,
    category,
    source,
    image_url,
    href,
    pages,
    translator,
    language,
    publish_date,
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
    is_active,
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
    v_href,
    v_pages,
    v_translator,
    v_language,
    v_publish_date,
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

-- 5) Staff cover INSERT only under staff/<auth.uid()>/ . No UPDATE/DELETE.
-- Existing Admin and AAL2 storage policies are not dropped or rewritten.
DROP POLICY IF EXISTS "book staff can upload own covers" ON storage.objects;
CREATE POLICY "book staff can upload own covers"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'book-covers'
    AND public.is_kutadgu_book_staff()
    AND name LIKE ('staff/' || auth.uid()::text || '/%')
    AND position('..' in name) = 0
  );

-- 6) Admin+AAL2 staff management. Does not insert into admin_users.
CREATE OR REPLACE FUNCTION public.add_kutadgu_book_staff(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $addstaff$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_user_id uuid;
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
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Valid email is required' USING ERRCODE = '22023';
  END IF;

  SELECT u.id
    INTO v_user_id
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.book_staff_users (user_id, active, created_by)
  VALUES (v_user_id, true, auth.uid())
  ON CONFLICT (user_id) DO UPDATE
    SET active = true;

  RETURN v_user_id;
END;
$addstaff$;

CREATE OR REPLACE FUNCTION public.set_kutadgu_book_staff_active(p_user_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $setstaff$
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
  IF p_user_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'user_id and active are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_staff_users WHERE user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Book staff user not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.book_staff_users
     SET active = p_active
   WHERE user_id = p_user_id;
END;
$setstaff$;

REVOKE ALL ON FUNCTION public.add_kutadgu_book_staff(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_kutadgu_book_staff(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_kutadgu_book_staff(text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_kutadgu_book_staff_active(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_kutadgu_book_staff_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_kutadgu_book_staff_active(uuid, boolean) TO authenticated;

-- 7) Admin+AAL2 approval / rejection. No Admin UI in this stage.
CREATE OR REPLACE FUNCTION public.approve_staff_book_submission(p_book_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $approve$
DECLARE
  v_updated integer;
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

  UPDATE public.books
     SET submission_status = 'approved',
         is_active = true
   WHERE id = p_book_id
     AND submission_status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Only pending staff submissions can be approved' USING ERRCODE = 'P0002';
  END IF;
END;
$approve$;

CREATE OR REPLACE FUNCTION public.reject_staff_book_submission(p_book_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reject$
DECLARE
  v_updated integer;
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

  UPDATE public.books
     SET submission_status = 'rejected',
         is_active = false
   WHERE id = p_book_id
     AND submission_status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Only pending staff submissions can be rejected' USING ERRCODE = 'P0002';
  END IF;
END;
$reject$;

REVOKE ALL ON FUNCTION public.approve_staff_book_submission(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_staff_book_submission(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_staff_book_submission(bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_staff_book_submission(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_staff_book_submission(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_staff_book_submission(bigint) TO authenticated;

COMMIT;
