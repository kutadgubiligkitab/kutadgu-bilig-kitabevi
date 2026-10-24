-- Executes public.admin_create_book_volume_series against the production-like schema.
-- A mocked RPC does not satisfy this file.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'books'
      AND column_name IN ('href', 'language', 'publish_date')
  ) THEN
    RAISE EXCEPTION 'stage133 schema still has an obsolete books column';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'books'
      AND column_name = 'publish_year' AND data_type <> 'integer'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'books'
      AND column_name = 'isbn' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'stage133 schema does not match production integer and isbn columns';
  END IF;
  IF position('href' IN pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure)) > 0
     OR position('language' IN pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure)) > 0
     OR position('publish_date' IN pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'stage133 function still names an obsolete books column';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.books (title, href) VALUES ('obsolete', '');
    RAISE EXCEPTION 'expected undefined_column';
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;
END $$;

INSERT INTO public.books (title, price, source, image_url, isbn, stock)
VALUES (
  'planted',
  1,
  'tarikhiy-romanlar.html',
  'https://www.kutadgubilik.com/__r2/book-covers/series-new/22222222-2222-4222-8222-222222222222/part-2-stamp.webp',
  '',
  0
);

DO $$
DECLARE
  v_saved jsonb;
  v_replay jsonb;
  v_part1 public.books%rowtype;
  v_part2 public.books%rowtype;
  v_request uuid := '11111111-1111-4111-8111-111111111111';
  v_prefix text := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/11111111-1111-4111-8111-111111111111/';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE authenticated;
  v_saved := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title', 'ئويغانغان زېمىن',
    'author', 'ئابدۇرېھىم ئۆتكۈر',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', '',
    'complete_set_price', '750.75',
    'representative_position', 1,
    'parts', jsonb_build_array(
      jsonb_build_object(
        'title', '',
        'price', '370.50',
        'stock', '8',
        'isbn', '',
        'image_url', v_prefix || 'part-1-stamp.webp',
        'volume_label', '1-قىسىم',
        'publish_year', '',
        'pages', ''
      ),
      jsonb_build_object(
        'title', 'ئىككىنچى قىسىم',
        'price', '0.25',
        'stock', '0',
        'isbn', '978-1234567890',
        'image_url', v_prefix || 'part-2-stamp.webp',
        'publish_year', '1998',
        'pages', '128'
      )
    )
  ));
  IF coalesce((v_saved->>'replayed')::boolean, true) IS TRUE
     OR coalesce((v_saved->>'is_public')::boolean, true) IS TRUE
     OR (v_saved->>'complete_set_price')::numeric IS DISTINCT FROM 750.75
     OR v_saved->>'slug' IS DISTINCT FROM 'series-' || (v_saved->'members'->0->>'book_id')
     OR jsonb_array_length(v_saved->'members') <> 2 THEN
    RAISE EXCEPTION 'stage133 create result %', v_saved;
  END IF;
  IF (v_saved->'members'->0->>'book_id') IS NULL
     OR (v_saved->'members'->1->>'book_id') IS NULL
     OR (v_saved->'members'->0->>'image_url') IS DISTINCT FROM v_prefix || 'part-1-stamp.webp'
     OR (v_saved->'members'->1->>'image_url') IS DISTINCT FROM v_prefix || 'part-2-stamp.webp' THEN
    RAISE EXCEPTION 'stage133 members missing ids needed for interiors %', v_saved->'members';
  END IF;

  v_replay := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title', 'ئويغانغان زېمىن',
    'author', 'ئابدۇرېھىم ئۆتكۈر',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', '',
    'complete_set_price', '750.75',
    'representative_position', 1,
    'parts', jsonb_build_array(
      jsonb_build_object(
        'title', '',
        'price', '370.50',
        'stock', '8',
        'isbn', '',
        'image_url', v_prefix || 'part-1-stamp.webp',
        'volume_label', '1-قىسىم',
        'publish_year', '',
        'pages', ''
      ),
      jsonb_build_object(
        'title', 'ئىككىنچى قىسىم',
        'price', '0.25',
        'stock', '0',
        'isbn', '978-1234567890',
        'image_url', v_prefix || 'part-2-stamp.webp',
        'publish_year', '1998',
        'pages', '128'
      )
    )
  ));
  IF coalesce((v_replay->>'replayed')::boolean, false) IS NOT TRUE
     OR v_replay->'members'->0->>'book_id' IS DISTINCT FROM v_saved->'members'->0->>'book_id'
     OR v_replay->'members'->1->>'book_id' IS DISTINCT FROM v_saved->'members'->1->>'book_id' THEN
    RAISE EXCEPTION 'stage133 replay changed member ids %', v_replay;
  END IF;
  RESET ROLE;
  SELECT * INTO v_part1 FROM public.books WHERE id = (v_saved->'members'->0->>'book_id')::bigint;
  SELECT * INTO v_part2 FROM public.books WHERE id = (v_saved->'members'->1->>'book_id')::bigint;
  IF v_part1.price IS DISTINCT FROM 370.50 OR v_part1.original_price IS DISTINCT FROM 370.50
     OR v_part1.stock <> 8 OR v_part1.isbn <> '' OR v_part1.publish_year IS NOT NULL
     OR v_part1.pages IS NOT NULL OR v_part1.submission_status <> 'series_draft'
     OR v_part1.is_active IS TRUE OR v_part1.is_new IS NOT TRUE
     OR v_part1.category <> 'تارىخىي رومانلار' OR v_part1.title <> 'ئويغانغان زېمىن 1. قىسىم' THEN
    RAISE EXCEPTION 'stage133 part 1 stored %', to_jsonb(v_part1);
  END IF;
  IF v_part2.price IS DISTINCT FROM 0.25 OR v_part2.isbn <> '9781234567890'
     OR v_part2.publish_year <> 1998 OR v_part2.pages <> 128 OR v_part2.stock <> 0
     OR v_part2.submission_status <> 'series_draft' OR v_part2.is_active IS TRUE THEN
    RAISE EXCEPTION 'stage133 part 2 stored %', to_jsonb(v_part2);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.credit_sync_log
    WHERE book_id IN (v_part1.id, v_part2.id) AND role <> 'author'
  ) OR (
    SELECT count(*) FROM public.credit_sync_log
    WHERE book_id IN (v_part1.id, v_part2.id) AND role = 'author'
  ) <> 2 THEN
    RAISE EXCEPTION 'stage133 credit sync wrote an empty optional role';
  END IF;
  IF (SELECT count(*) FROM public.books) <> 3
     OR (SELECT count(*) FROM public.book_volume_groups) <> 1
     OR (SELECT count(*) FROM public.book_volume_series_requests) <> 1 THEN
    RAISE EXCEPTION 'stage133 replay duplicated rows';
  END IF;
END $$;

DO $$
DECLARE
  v_books integer;
  v_requests integer;
  v_groups integer;
  v_prefix text := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/22222222-2222-4222-8222-222222222222/';
BEGIN
  SELECT count(*) INTO v_books FROM public.books;
  SELECT count(*) INTO v_requests FROM public.book_volume_series_requests;
  SELECT count(*) INTO v_groups FROM public.book_volume_groups;
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_create_book_volume_series('22222222-2222-4222-8222-222222222222', jsonb_build_object(
      'title', 'يېڭى يۈرۈشلۈك',
      'author', 'ئابدۇرېھىم ئۆتكۈر',
      'category', 'تارىخىي رومانلار',
      'source', 'tarikhiy-romanlar.html',
      'complete_set_price', '',
      'parts', jsonb_build_array(
        jsonb_build_object('price', '10.50', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-1-stamp.webp'),
        jsonb_build_object('price', '11', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-2-stamp.webp', 'publish_year', '999')
      )
    ));
    RAISE EXCEPTION 'expected invalid_series_part';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'invalid_series_part' THEN
        RAISE;
      END IF;
  END;
  IF (SELECT count(*) FROM public.books) <> v_books
     OR (SELECT count(*) FROM public.book_volume_series_requests) <> v_requests
     OR (SELECT count(*) FROM public.book_volume_groups) <> v_groups THEN
    RAISE EXCEPTION 'stage133 invalid year left rows behind';
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_create_book_volume_series('22222222-2222-4222-8222-222222222222', jsonb_build_object(
      'title', 'يېڭى يۈرۈشلۈك',
      'author', 'ئابدۇرېھىم ئۆتكۈر',
      'category', 'تارىخىي رومانلار',
      'source', 'tarikhiy-romanlar.html',
      'complete_set_price', '',
      'parts', jsonb_build_array(
        jsonb_build_object('price', '10.50', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-1-other.webp'),
        jsonb_build_object('price', '11', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-2-stamp.webp')
      )
    ));
    RAISE EXCEPTION 'expected series_cover_already_used';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'series_cover_already_used' THEN
        RAISE;
      END IF;
  END;
  IF (SELECT count(*) FROM public.books) <> v_books
     OR (SELECT count(*) FROM public.book_volume_series_requests) <> v_requests
     OR (SELECT count(*) FROM public.book_volume_groups) <> v_groups THEN
    RAISE EXCEPTION 'stage133 cover collision left a partial series';
  END IF;
END $$;

DO $$
DECLARE
  v_books integer;
BEGIN
  SELECT count(*) INTO v_books FROM public.books;
  PERFORM set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","aal":"aal1"}', true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_create_book_volume_series('33333333-3333-4333-8333-333333333333', '{}'::jsonb);
    RAISE EXCEPTION 'expected Admin AAL2 required';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM IS DISTINCT FROM 'Admin AAL2 required' THEN
        RAISE;
      END IF;
  END;
  IF (SELECT count(*) FROM public.books) <> v_books THEN
    RAISE EXCEPTION 'stage133 denied call inserted a book';
  END IF;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.admin_create_book_volume_series('33333333-3333-4333-8333-333333333333', '{}'::jsonb);
    RAISE EXCEPTION 'anon was able to execute the function';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

SELECT 'stage133 isolated: PASS' AS result;
