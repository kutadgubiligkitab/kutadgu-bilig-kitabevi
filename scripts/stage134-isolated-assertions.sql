-- Executes the Stage 134 function on the isolated schema. A mocked RPC does not satisfy this file.

DO $$
DECLARE
  v_saved jsonb;
  v_replay jsonb;
  v_changed jsonb;
  v_part1 public.books%rowtype;
  v_part2 public.books%rowtype;
  v_request uuid := '33333333-3333-4333-8333-333333333333';
  v_prefix text := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/33333333-3333-4333-8333-333333333333/';
  v_payload jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE authenticated;
  v_payload := jsonb_build_object(
    'title', 'يېڭى يۈرۈشلۈك',
    'author', 'بىرىنچى ئاپتور، ئىككىنچى ئاپتور',
    'authors', jsonb_build_array('بىرىنچى ئاپتور', 'ئىككىنچى ئاپتور'),
    'translators', jsonb_build_array('تەرجىمان ئالىم'),
    'publisher', 'ئورتاق نەشرىيات',
    'publish_year', '2020',
    'pages', '240',
    'cover_type', 'paperback',
    'book_size', 'A5',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', 'ئورتاق چۈشەندۈرۈش',
    'complete_set_price', NULL,
    'representative_position', 1,
    'parts', jsonb_build_array(
      jsonb_build_object(
        'title', 'بىرىنچى قىسىم',
        'price', '10',
        'stock', '4',
        'isbn', '',
        'image_url', v_prefix || 'part-1-stamp.webp',
        'volume_label', '1-قىسىم'
      ),
      jsonb_build_object(
        'title', 'ئىككىنچى قىسىم',
        'price', '12',
        'stock', '0',
        'isbn', '',
        'image_url', v_prefix || 'part-2-stamp.webp',
        'publisher', 'باشقا نەشرىيات',
        'pages', '88',
        'publish_year', '2024',
        'cover_type', 'hardcover',
        'book_size', 'A4',
        'stock_status', 'out_of_stock'
      )
    )
  );
  v_saved := public.admin_create_book_volume_series(v_request, v_payload);
  IF coalesce((v_saved->>'replayed')::boolean, true) OR coalesce((v_saved->>'is_public')::boolean, true) THEN
    RAISE EXCEPTION 'stage134 create was not a private first save %', v_saved;
  END IF;
  RESET ROLE;
  SELECT * INTO v_part1 FROM public.books WHERE id = (v_saved->'members'->0->>'book_id')::bigint;
  SELECT * INTO v_part2 FROM public.books WHERE id = (v_saved->'members'->1->>'book_id')::bigint;
  IF v_part1.pages IS DISTINCT FROM 240 OR v_part1.publisher IS DISTINCT FROM 'ئورتاق نەشرىيات'
     OR v_part1.publish_year IS DISTINCT FROM 2020 OR v_part1.cover_type IS DISTINCT FROM 'paperback'
     OR v_part1.book_size IS DISTINCT FROM 'A5' OR v_part1.author IS DISTINCT FROM 'بىرىنچى ئاپتور، ئىككىنچى ئاپتور'
     OR v_part1.translator IS DISTINCT FROM 'تەرجىمان ئالىم' OR v_part1.stock_status IS NOT NULL
     OR v_part1.original_price IS DISTINCT FROM v_part1.price OR v_part1.submission_status IS DISTINCT FROM 'series_draft' THEN
    RAISE EXCEPTION 'stage134 shared metadata was not stored on part 1 %', to_jsonb(v_part1);
  END IF;
  IF v_part2.pages IS DISTINCT FROM 88 OR v_part2.publisher IS DISTINCT FROM 'باشقا نەشرىيات'
     OR v_part2.publish_year IS DISTINCT FROM 2024 OR v_part2.cover_type IS DISTINCT FROM 'hardcover'
     OR v_part2.book_size IS DISTINCT FROM 'A4' OR v_part2.stock_status IS DISTINCT FROM 'out_of_stock'
     OR v_part2.description IS DISTINCT FROM 'ئورتاق چۈشەندۈرۈش' THEN
    RAISE EXCEPTION 'stage134 explicit part metadata was replaced %', to_jsonb(v_part2);
  END IF;
  v_replay := public.admin_create_book_volume_series(v_request, v_payload);
  IF coalesce((v_replay->>'replayed')::boolean, false) IS NOT TRUE
     OR (SELECT count(*) FROM public.books WHERE image_url LIKE v_prefix || '%') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'stage134 replay created another series %', v_replay;
  END IF;
  BEGIN
    v_changed := public.admin_create_book_volume_series(v_request, jsonb_set(v_payload, '{parts,1,pages}', '90'::jsonb));
    RAISE EXCEPTION 'stage134 changed payload replayed %', v_changed;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

DO $$
DECLARE
  v_saved jsonb;
  v_request uuid := '44444444-4444-4444-8444-444444444444';
  v_prefix text := 'https://www.kutadgubilik.com/__r2/book-covers/series-new/44444444-4444-4444-8444-444444444444/';
  v_part1 public.books%rowtype;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2"}', true);
  SET LOCAL ROLE authenticated;
  v_saved := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title', 'بوش ئۇچۇر',
    'author', '',
    'category', 'تارىخىي رومانلار',
    'source', 'tarikhiy-romanlar.html',
    'description', '',
    'parts', jsonb_build_array(
      jsonb_build_object('price', '1', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-1-blank.webp', 'pages', '', 'publish_year', ''),
      jsonb_build_object('price', '1', 'stock', '1', 'isbn', '', 'image_url', v_prefix || 'part-2-blank.webp')
    )
  ));
  RESET ROLE;
  SELECT * INTO v_part1 FROM public.books WHERE id = (v_saved->'members'->0->>'book_id')::bigint;
  IF v_part1.pages IS NOT NULL OR v_part1.publish_year IS NOT NULL OR v_part1.publisher IS NOT NULL
     OR v_part1.cover_type IS NOT NULL OR v_part1.book_size IS NOT NULL OR v_part1.translator IS NOT NULL THEN
    RAISE EXCEPTION 'stage134 invented optional metadata %', to_jsonb(v_part1);
  END IF;
END $$;

DO $$
DECLARE
  v_group_id bigint;
  v_public jsonb;
  v_pages jsonb;
BEGIN
  SELECT id INTO v_group_id FROM public.book_volume_groups WHERE title = 'يېڭى يۈرۈشلۈك';
  IF private.kutadgu_public_volume_group_json(v_group_id) IS NOT NULL THEN
    RAISE EXCEPTION 'stage134 private draft was publicly readable';
  END IF;
  UPDATE public.books
  SET is_active = true, submission_status = 'approved'
  WHERE id IN (
    SELECT book_id FROM public.book_volume_group_members WHERE group_id = v_group_id
  );
  UPDATE public.book_volume_groups
  SET is_public = true, is_active = true
  WHERE id = v_group_id;
  v_public := private.kutadgu_public_volume_group_json(v_group_id);
  SELECT jsonb_agg(member->'pages' ORDER BY (member->>'position')::integer)
  INTO v_pages
  FROM jsonb_array_elements(v_public->'members') AS member;
  IF v_pages IS DISTINCT FROM '[240, 88]'::jsonb THEN
    RAISE EXCEPTION 'stage134 public member pages %', v_public->'members';
  END IF;

  SELECT id INTO v_group_id FROM public.book_volume_groups WHERE title = 'بوش ئۇچۇر';
  UPDATE public.books
  SET is_active = true, submission_status = 'approved'
  WHERE id IN (
    SELECT book_id FROM public.book_volume_group_members WHERE group_id = v_group_id
  );
  UPDATE public.book_volume_groups
  SET is_public = true, is_active = true
  WHERE id = v_group_id;
  v_public := private.kutadgu_public_volume_group_json(v_group_id);
  SELECT jsonb_agg(member->'pages' ORDER BY (member->>'position')::integer)
  INTO v_pages
  FROM jsonb_array_elements(v_public->'members') AS member;
  IF v_pages IS DISTINCT FROM '[null, null]'::jsonb THEN
    RAISE EXCEPTION 'stage134 public missing pages became %', v_pages;
  END IF;
END $$;
