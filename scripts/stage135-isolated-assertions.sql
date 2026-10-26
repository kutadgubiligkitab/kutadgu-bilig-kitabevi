-- Isolated checks for Stage 135. Never production.
-- The runner applies the forward file, this first block, the Stage 134
-- rollback body, the second block, the forward file again, and the third block.

-- @stage135 forward
DO $$
DECLARE
  v_historical bigint[];
  v_saved jsonb;
  v_replay jsonb;
  v_published jsonb;
  v_request uuid := '55555555-5555-4555-8555-555555555555';
  v_prefix text := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/55555555-5555-4555-8555-555555555555/';
  v_payload jsonb;
  v_part1 public.books%rowtype;
  v_part2 public.books%rowtype;
  v_group_id bigint;
  v_revision bigint;
  v_created timestamptz;
  v_seen timestamptz;
  v_group_new boolean;
BEGIN
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'books' AND column_name = 'is_new')
     IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'stage135 changed the is_new column default';
  END IF;
  IF position('false, false, v_part_isbn' IN pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure)) = 0
     OR position('false, true, v_part_isbn' IN pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure)) > 0
     OR position('SECURITY DEFINER' IN pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure)) = 0
     OR position('pages' IN pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'stage135 forward function is not the Stage 134 body with is_new false';
  END IF;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]) INTO v_historical
  FROM public.books WHERE is_new IS TRUE;
  IF coalesce(array_length(v_historical, 1), 0) < 1 THEN
    RAISE EXCEPTION 'stage135 had no historical is_new row to preserve';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal1"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_create_book_volume_series(v_request, '{}'::jsonb);
    RAISE EXCEPTION 'stage135 AAL1 create was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.admin_create_book_volume_series(v_request, '{}'::jsonb);
    RAISE EXCEPTION 'stage135 anon create was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  v_payload := jsonb_build_object(
    'title', 'قولدا تاللانمايدىغان يۈرۈشلۈك',
    'author', 'ئاپتور',
    'publisher', 'ئورتاق نەشرىيات',
    'publish_year', '2021',
    'pages', '180',
    'cover_type', 'paperback',
    'book_size', 'A5',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', 'يېڭى كەلگەنلەرگە ئۆزى كىرمەيدۇ',
    'representative_position', 1,
    'parts', jsonb_build_array(
      jsonb_build_object('price', '15', 'stock', '3', 'isbn', '', 'image_url', v_prefix || 'part-1-manual.webp', 'volume_label', '1-قىسىم'),
      jsonb_build_object('title', 'ئىككىنچى قىسىم', 'price', '16', 'stock', '2', 'isbn', '', 'image_url', v_prefix || 'part-2-manual.webp', 'pages', '64', 'publisher', 'باشقا نەشرىيات')
    )
  );
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE authenticated;
  v_saved := public.admin_create_book_volume_series(v_request, v_payload);
  v_replay := public.admin_create_book_volume_series(v_request, v_payload);
  RESET ROLE;
  IF coalesce((v_saved->>'replayed')::boolean, true) OR coalesce((v_saved->>'is_public')::boolean, true) THEN
    RAISE EXCEPTION 'stage135 create was not a private first save %', v_saved;
  END IF;
  IF coalesce((v_replay->>'replayed')::boolean, false) IS NOT TRUE
     OR v_replay->'members'->0->>'book_id' IS DISTINCT FROM v_saved->'members'->0->>'book_id' THEN
    RAISE EXCEPTION 'stage135 replay changed the series %', v_replay;
  END IF;
  SELECT * INTO v_part1 FROM public.books WHERE id = (v_saved->'members'->0->>'book_id')::bigint;
  SELECT * INTO v_part2 FROM public.books WHERE id = (v_saved->'members'->1->>'book_id')::bigint;
  IF v_part1.is_new IS NOT FALSE OR v_part2.is_new IS NOT FALSE
     OR v_part1.is_active IS TRUE OR v_part1.submission_status IS DISTINCT FROM 'series_draft'
     OR v_part1.pages IS DISTINCT FROM 180 OR v_part1.publisher IS DISTINCT FROM 'ئورتاق نەشرىيات'
     OR v_part2.pages IS DISTINCT FROM 64 OR v_part2.publisher IS DISTINCT FROM 'باشقا نەشرىيات' THEN
    RAISE EXCEPTION 'stage135 new parts were selected or lost metadata % %', to_jsonb(v_part1), to_jsonb(v_part2);
  END IF;
  IF EXISTS (SELECT 1 FROM public.books WHERE id = ANY(v_historical) AND is_new IS NOT TRUE) THEN
    RAISE EXCEPTION 'stage135 rewrote a historical is_new flag';
  END IF;

  v_group_id := (v_saved->>'id')::bigint;
  v_revision := (v_saved->>'revision')::bigint;
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE authenticated;
  v_published := public.admin_set_book_volume_group_publication(v_group_id, v_revision, true);
  RESET ROLE;
  SELECT * INTO v_part1 FROM public.books WHERE id = v_part1.id;
  SELECT * INTO v_part2 FROM public.books WHERE id = v_part2.id;
  IF coalesce((v_published->>'is_public')::boolean, false) IS NOT TRUE
     OR v_part1.is_active IS NOT TRUE OR v_part1.submission_status IS DISTINCT FROM 'approved'
     OR v_part1.is_new IS NOT FALSE OR v_part2.is_new IS NOT FALSE THEN
    RAISE EXCEPTION 'stage135 publication selected the series %', v_published;
  END IF;
  SELECT g.is_new, g.created_at INTO v_group_new, v_created
  FROM private.kutadgu_public_volume_groups() AS g
  WHERE g.group_id = v_group_id;
  IF v_group_new IS NOT FALSE OR v_created IS NULL THEN
    RAISE EXCEPTION 'stage135 published series entered New Arrivals';
  END IF;
  UPDATE public.books SET is_new = true WHERE id = v_part1.id;
  SELECT g.is_new, g.created_at INTO v_group_new, v_seen
  FROM private.kutadgu_public_volume_groups() AS g
  WHERE g.group_id = v_group_id;
  IF v_group_new IS NOT TRUE OR v_seen IS DISTINCT FROM v_created
     OR (SELECT is_new FROM public.books WHERE id = v_part2.id) IS NOT FALSE THEN
    RAISE EXCEPTION 'stage135 manual New Arrivals selection failed';
  END IF;
END $$;

-- @stage135 rollback
DO $$
DECLARE
  v_saved jsonb;
  v_request uuid := '66666666-6666-4666-8666-666666666666';
  v_prefix text := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/66666666-6666-4666-8666-666666666666/';
  v_part1 public.books%rowtype;
  v_forward public.books%rowtype;
  v_definition text := pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure);
BEGIN
  IF position('false, true, v_part_isbn' IN v_definition) = 0
     OR position('publish_year, pages, cover_type, book_size' IN v_definition) = 0
     OR position('href' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'stage135 rollback did not restore the Stage 134 function';
  END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE authenticated;
  v_saved := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title', 'ئەسلىگە قايتۇرۇلغان يۈرۈشلۈك',
    'author', 'ئاپتور',
    'publisher', 'نەشرىيات',
    'pages', '77',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', '',
    'parts', jsonb_build_array(
      jsonb_build_object('price', '9', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-1-rollback.webp'),
      jsonb_build_object('price', '9', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-2-rollback.webp', 'pages', '41')
    )
  ));
  RESET ROLE;
  SELECT * INTO v_part1 FROM public.books WHERE id = (v_saved->'members'->0->>'book_id')::bigint;
  IF v_part1.is_new IS NOT TRUE OR v_part1.pages IS DISTINCT FROM 77
     OR v_part1.publisher IS DISTINCT FROM 'نەشرىيات' OR v_part1.submission_status IS DISTINCT FROM 'series_draft' THEN
    RAISE EXCEPTION 'stage135 rollback lost Stage 134 metadata or the old flag %', to_jsonb(v_part1);
  END IF;
  SELECT * INTO v_forward FROM public.books
  WHERE image_url LIKE 'https://www.kutadgubilik.com/__r2/book-covers/series-new/55555555-5555-4555-8555-555555555555/%'
    AND title LIKE 'ئىككىنچى%';
  IF v_forward.is_new IS NOT FALSE OR v_forward.pages IS DISTINCT FROM 64 THEN
    RAISE EXCEPTION 'stage135 rollback rewrote the already created series %', to_jsonb(v_forward);
  END IF;
END $$;

-- @stage135 forward-again
DO $$
DECLARE
  v_saved jsonb;
  v_replay jsonb;
  v_request uuid := '77777777-7777-4777-8777-777777777777';
  v_prefix text := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/77777777-7777-4777-8777-777777777777/';
  v_part1 public.books%rowtype;
  v_definition text := pg_get_functiondef('public.admin_create_book_volume_series(uuid,jsonb)'::regprocedure);
BEGIN
  IF position('false, false, v_part_isbn' IN v_definition) = 0
     OR position('publish_year, pages, cover_type, book_size' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'stage135 second forward did not keep Stage 134 metadata';
  END IF;
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE authenticated;
  v_saved := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title', 'قايتا قوللانغان يۈرۈشلۈك',
    'author', 'ئاپتور',
    'pages', '90',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', '',
    'parts', jsonb_build_array(
      jsonb_build_object('price', '8', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-1-again.webp'),
      jsonb_build_object('price', '8', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-2-again.webp')
    )
  ));
  v_replay := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title', 'قايتا قوللانغان يۈرۈشلۈك',
    'author', 'ئاپتور',
    'pages', '90',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', '',
    'parts', jsonb_build_array(
      jsonb_build_object('price', '8', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-1-again.webp'),
      jsonb_build_object('price', '8', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-2-again.webp')
    )
  ));
  RESET ROLE;
  SELECT * INTO v_part1 FROM public.books WHERE id = (v_saved->'members'->0->>'book_id')::bigint;
  IF coalesce((v_replay->>'replayed')::boolean, false) IS NOT TRUE
     OR v_part1.is_new IS NOT FALSE OR v_part1.pages IS DISTINCT FROM 90
     OR (SELECT is_new FROM public.books WHERE image_url = 'https://www.kutadgubilik.com/__r2/book-covers/series-new/66666666-6666-4666-8666-666666666666/part-1-rollback.webp') IS NOT TRUE
     OR EXISTS (
       SELECT 1 FROM public.books
       WHERE image_url LIKE 'https://www.kutadgubilik.com/__r2/book-covers/series-new/55555555-5555-4555-8555-555555555555/part-2-%'
         AND is_new IS NOT FALSE
     ) THEN
    RAISE EXCEPTION 'stage135 second forward changed an earlier series %', to_jsonb(v_part1);
  END IF;
END $$;
