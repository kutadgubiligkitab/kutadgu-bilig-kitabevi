-- ============================================================================
-- Kutadgu Bilig — rewrite current book image URLs to private R2
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Rewrites books.image_url and books.gallery_images from the public Supabase
-- book-covers prefix to https://www.kutadgubilik.com/__r2/book-covers/<path>.
-- The path after the prefix is unchanged. Gallery order and length stay.
-- This file does not delete Storage objects, R2 objects, or any other column.
-- books_touch_updated_at is disabled only for this statement so updated_at
-- stays put, and it is enabled again before the statement commits.
-- If a post-check fails, the statement raises and the transaction rolls back.
-- ============================================================================

DO $rewrite$
DECLARE
  prefix constant text := 'https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/';
  target constant text := 'https://www.kutadgubilik.com/__r2/book-covers/';
  cover_before integer;
  gallery_before integer;
  missing integer;
  unsafe integer;
  cover_after integer;
  gallery_after integer;
  cover_left integer;
  gallery_left integer;
  double_prefix integer;
  gallery_len_mismatch integer;
  meta_mismatch integer;
  row_count integer;
BEGIN
  SELECT count(*) INTO cover_before
    FROM public.books
   WHERE left(image_url, char_length(prefix)) = prefix;

  SELECT count(*) INTO gallery_before
    FROM public.books b
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.gallery_images, '[]'::jsonb)) elem(value)
   WHERE left(elem.value, char_length(prefix)) = prefix;

  IF cover_before <> 341 OR gallery_before <> 679 THEN
    RAISE EXCEPTION 'precondition counts cover % gallery %', cover_before, gallery_before;
  END IF;

  SELECT count(*) INTO missing
    FROM (
      SELECT substr(image_url, char_length(prefix) + 1) AS object_path
        FROM public.books
       WHERE left(image_url, char_length(prefix)) = prefix
      UNION
      SELECT substr(elem.value, char_length(prefix) + 1)
        FROM public.books b
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.gallery_images, '[]'::jsonb)) elem(value)
       WHERE left(elem.value, char_length(prefix)) = prefix
    ) paths
   WHERE NOT EXISTS (
     SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'book-covers' AND o.name = paths.object_path
   );

  IF missing <> 0 THEN
    RAISE EXCEPTION 'missing storage objects %', missing;
  END IF;

  SELECT count(*) INTO unsafe
    FROM (
      SELECT substr(image_url, char_length(prefix) + 1) AS object_path
        FROM public.books
       WHERE left(image_url, char_length(prefix)) = prefix
      UNION ALL
      SELECT substr(elem.value, char_length(prefix) + 1)
        FROM public.books b
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.gallery_images, '[]'::jsonb)) elem(value)
       WHERE left(elem.value, char_length(prefix)) = prefix
    ) paths
   WHERE object_path !~ '^[A-Za-z0-9._/-]+$'
      OR position('..' in object_path) > 0
      OR left(object_path, 12) = 'book-covers/';

  IF unsafe <> 0 THEN
    RAISE EXCEPTION 'unsafe paths %', unsafe;
  END IF;

  CREATE TEMP TABLE book_image_rollback ON COMMIT DROP AS
  SELECT id, image_url, gallery_images, updated_at, title, price, stock, category, description, cover_sha256
    FROM public.books;

  ALTER TABLE public.books DISABLE TRIGGER books_touch_updated_at;

  UPDATE public.books b
     SET image_url = CASE
           WHEN left(b.image_url, char_length(prefix)) = prefix
           THEN target || substr(b.image_url, char_length(prefix) + 1)
           ELSE b.image_url
         END,
         gallery_images = CASE
           WHEN b.gallery_images IS NULL THEN NULL
           ELSE (
             SELECT COALESCE(jsonb_agg(
               to_jsonb(
                 CASE
                   WHEN left(elem.value, char_length(prefix)) = prefix
                   THEN target || substr(elem.value, char_length(prefix) + 1)
                   ELSE elem.value
                 END
               ) ORDER BY elem.ord
             ), '[]'::jsonb)
               FROM jsonb_array_elements_text(b.gallery_images) WITH ORDINALITY AS elem(value, ord)
           )
         END
   WHERE left(b.image_url, char_length(prefix)) = prefix
      OR position(prefix in COALESCE(b.gallery_images::text, '')) > 0;

  GET DIAGNOSTICS row_count = ROW_COUNT;

  ALTER TABLE public.books ENABLE TRIGGER books_touch_updated_at;

  SELECT count(*) INTO cover_after
    FROM public.books
   WHERE left(image_url, char_length(target)) = target;

  SELECT count(*) INTO cover_left
    FROM public.books
   WHERE position('supabase.co/storage/v1/object/public/book-covers/' in COALESCE(image_url, '')) > 0;

  SELECT count(*) INTO gallery_after
    FROM public.books b
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.gallery_images, '[]'::jsonb)) elem(value)
   WHERE left(elem.value, char_length(target)) = target;

  SELECT count(*) INTO gallery_left
    FROM public.books b
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.gallery_images, '[]'::jsonb)) elem(value)
   WHERE position('supabase.co/storage/v1/object/public/book-covers/' in elem.value) > 0;

  SELECT count(*) INTO double_prefix
    FROM public.books
   WHERE position('book-covers/book-covers/' in COALESCE(image_url, '')) > 0
      OR position('book-covers/book-covers/' in COALESCE(gallery_images::text, '')) > 0;

  SELECT count(*) INTO gallery_len_mismatch
    FROM public.books b
    JOIN book_image_rollback r ON r.id = b.id
   WHERE COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.gallery_images) = 'array' THEN b.gallery_images END), -1)
         IS DISTINCT FROM
         COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(r.gallery_images) = 'array' THEN r.gallery_images END), -1);

  SELECT count(*) INTO meta_mismatch
    FROM public.books b
    JOIN book_image_rollback r ON r.id = b.id
   WHERE b.updated_at IS DISTINCT FROM r.updated_at
      OR b.title IS DISTINCT FROM r.title
      OR b.price IS DISTINCT FROM r.price
      OR b.stock IS DISTINCT FROM r.stock
      OR b.category IS DISTINCT FROM r.category
      OR b.description IS DISTINCT FROM r.description
      OR b.cover_sha256 IS DISTINCT FROM r.cover_sha256;

  IF row_count <> 341
     OR cover_after <> 341
     OR cover_left <> 0
     OR gallery_after <> 679
     OR gallery_left <> 0
     OR double_prefix <> 0
     OR gallery_len_mismatch <> 0
     OR meta_mismatch <> 0 THEN
    RAISE EXCEPTION 'postcondition rows % cover_r2 % cover_left % gallery_r2 % gallery_left % double % len % meta %',
      row_count, cover_after, cover_left, gallery_after, gallery_left, double_prefix, gallery_len_mismatch, meta_mismatch;
  END IF;
END
$rewrite$;
