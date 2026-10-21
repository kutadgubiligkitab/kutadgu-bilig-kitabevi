-- Isolated Stage 131 assertions. Not production.
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS original_price numeric(12,2);
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'universal.html';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS href text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS is_new boolean NOT NULL DEFAULT true;
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS publish_date text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS publish_year text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS translator text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS publisher text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS isbn text NOT NULL DEFAULT '';

DO $$
DECLARE
  v_before integer;
  v_after integer;
  v_request uuid := 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  v_sum uuid := 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  v_bad uuid := 'cccccccc-dddd-4eee-8fff-000000000000';
  v_nine uuid := 'dddddddd-eeee-4fff-8aaa-111111111111';
  v_saved jsonb;
  v_replay jsonb;
  v_summed jsonb;
  v_nine_saved jsonb;
  v_price numeric;
  v_effective numeric;
  v_books integer;
  v_public boolean;
  v_slug text;
  v_part_a bigint;
  v_part_b bigint;
  v_visible integer;
  v_catalog jsonb;
  v_direct jsonb;
  v_owner jsonb;
  v_published jsonb;
  v_units integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}', true);
  BEGIN
    PERFORM public.admin_create_book_volume_series(v_request, '{}'::jsonb);
    RAISE EXCEPTION 'admin AAL1 unexpectedly created a series';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}', true);
  BEGIN
    PERFORM public.admin_create_book_volume_series(v_request, '{}'::jsonb);
    RAISE EXCEPTION 'ordinary member unexpectedly created a series';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}', true);
  SELECT count(*) INTO v_before FROM public.books;

  BEGIN
    PERFORM public.admin_create_book_volume_series(v_bad, jsonb_build_object(
      'title','خاتا','author','','category','تارىخ','source','tarikhiy-romanlar.html','description','',
      'complete_set_price',750,'representative_position',1,
      'parts', jsonb_build_array(
        jsonb_build_object('price',370,'stock',4,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_bad::text||'/part-1-a.webp'),
        jsonb_build_object('price',399,'stock',4,'image_url','https://evil.example/cover.webp')
      )
    ));
    RAISE EXCEPTION 'bad cover unexpectedly committed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'bad cover unexpectedly committed' OR SQLERRM IS DISTINCT FROM 'invalid_series_cover' THEN
      RAISE;
    END IF;
  END;
  SELECT count(*) INTO v_after FROM public.books;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'failed series left books: % -> %', v_before, v_after;
  END IF;
  IF EXISTS (SELECT 1 FROM public.book_volume_series_requests WHERE request_id = v_bad) THEN
    RAISE EXCEPTION 'failed series left an idempotency row';
  END IF;

  v_saved := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title','ئويغانغان زېمىن','author','ئابدۇرېھىم ئۆتكۈر','category','تارىخىي رومانلار',
    'source','tarikhiy-romanlar.html','description','',
    'complete_set_price',750,'representative_position',1,
    'parts', jsonb_build_array(
      jsonb_build_object('price',370,'stock',20,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_request::text||'/part-1-a.webp'),
      jsonb_build_object('price',399,'stock',20,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_request::text||'/part-2-b.webp')
    )
  ));
  IF (v_saved->>'complete_set_price')::numeric <> 750 THEN
    RAISE EXCEPTION 'explicit 750 was replaced: %', v_saved->>'complete_set_price';
  END IF;
  IF coalesce((v_saved->>'is_public')::boolean, true) THEN
    RAISE EXCEPTION 'new series was public';
  END IF;
  IF jsonb_array_length(v_saved->'members') <> 2 THEN
    RAISE EXCEPTION 'expected 2 members';
  END IF;
  IF (v_saved->'members'->0->>'price')::numeric <> 370 OR (v_saved->'members'->1->>'price')::numeric <> 399 THEN
    RAISE EXCEPTION 'part prices changed: %', v_saved->'members';
  END IF;
  SELECT slug, is_public, complete_set_price INTO v_slug, v_public, v_price
  FROM public.book_volume_groups WHERE id = (v_saved->>'id')::bigint;
  IF v_public OR v_price <> 750 OR v_slug IS NULL THEN
    RAISE EXCEPTION 'stored series mismatch % % %', v_slug, v_public, v_price;
  END IF;
  SELECT CASE WHEN g.complete_set_price IS NOT NULL THEN g.complete_set_price ELSE (
    SELECT sum(b.price) FROM public.book_volume_group_members m JOIN public.books b ON b.id = m.book_id WHERE m.group_id = g.id
  ) END INTO v_effective
  FROM public.book_volume_groups g WHERE g.id = (v_saved->>'id')::bigint;
  IF v_effective <> 750 THEN
    RAISE EXCEPTION 'effective price became the sum: %', v_effective;
  END IF;

  SELECT count(*) INTO v_books FROM public.books;
  v_replay := public.admin_create_book_volume_series(v_request, jsonb_build_object(
    'title','ئويغانغان زېمىن','author','ئابدۇرېھىم ئۆتكۈر','category','تارىخىي رومانلار',
    'source','tarikhiy-romanlar.html','description','',
    'complete_set_price',750,'representative_position',1,
    'parts', jsonb_build_array(
      jsonb_build_object('price',370,'stock',20,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_request::text||'/part-1-a.webp'),
      jsonb_build_object('price',399,'stock',20,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_request::text||'/part-2-b.webp')
    )
  ));
  IF coalesce((v_replay->>'replayed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'retry did not replay';
  END IF;
  IF (SELECT count(*) FROM public.books) <> v_books THEN
    RAISE EXCEPTION 'retry duplicated books';
  END IF;

  v_summed := public.admin_create_book_volume_series(v_sum, jsonb_build_object(
    'title','يىغىندا','author','','category','تارىخ','source','romanlar.html','description','',
    'representative_position',1,
    'parts', jsonb_build_array(
      jsonb_build_object('price',370,'stock',1,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_sum::text||'/part-1-a.webp'),
      jsonb_build_object('price',399,'stock',1,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_sum::text||'/part-2-b.webp'),
      jsonb_build_object('price',10,'stock',1,'image_url','https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_sum::text||'/part-3-c.webp')
    )
  ));
  IF v_summed->>'complete_set_price' IS NOT NULL THEN
    RAISE EXCEPTION 'blank set price was stored as %', v_summed->>'complete_set_price';
  END IF;
  IF jsonb_array_length(v_summed->'members') <> 3 THEN
    RAISE EXCEPTION 'expected 3 parts';
  END IF;

  v_nine_saved := public.admin_create_book_volume_series(v_nine, jsonb_build_object(
    'title','توققۇز','author','','category','تارىخ','source','romanlar.html','description','',
    'complete_set_price',90,'representative_position',9,
    'parts', (
      SELECT jsonb_agg(jsonb_build_object(
        'price', 10,
        'stock', 2,
        'image_url', 'https://www.kutadgubilik.com/__r2/book-covers/series-new/'||v_nine::text||'/part-'||n::text||'-a.webp'
      ) ORDER BY n)
      FROM generate_series(1, 9) AS n
    )
  ));
  IF jsonb_array_length(v_nine_saved->'members') <> 9 THEN
    RAISE EXCEPTION 'expected 9 parts';
  END IF;
  IF (v_nine_saved->>'representative_book_id')::bigint <> (v_nine_saved->'members'->8->>'book_id')::bigint THEN
    RAISE EXCEPTION 'main cover was not the ninth part';
  END IF;
  IF (v_nine_saved->>'complete_set_price')::numeric <> 90 THEN
    RAISE EXCEPTION 'nine-part explicit price changed';
  END IF;

  v_part_a := (v_saved->'members'->0->>'book_id')::bigint;
  v_part_b := (v_saved->'members'->1->>'book_id')::bigint;
  IF (v_saved->'members'->0->>'is_active')::boolean IS DISTINCT FROM false
     OR (v_saved->'members'->1->>'is_active')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'new draft parts were active';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.books AS b
    WHERE b.id IN (v_part_a, v_part_b)
      AND (b.is_active OR b.submission_status IS DISTINCT FROM 'series_draft')
  ) THEN
    RAISE EXCEPTION 'draft parts were publicly eligible';
  END IF;
  IF public.series_draft_cover_is_referenced('https://www.kutadgubilik.com/__r2/book-covers/series-new/' || v_request::text || '/part-1-a.webp') IS NOT TRUE THEN
    RAISE EXCEPTION 'committed cover was not referenced';
  END IF;
  IF public.series_draft_cover_is_referenced('https://www.kutadgubilik.com/__r2/book-covers/series-new/' || v_request::text || '/part-9-missing.webp') IS NOT FALSE THEN
    RAISE EXCEPTION 'missing cover looked referenced';
  END IF;
  IF (public.admin_get_book_volume_series_request(v_request)->>'id')::bigint <> (v_saved->>'id')::bigint THEN
    RAISE EXCEPTION 'request recovery did not return the committed series';
  END IF;

  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.book_id IN (v_part_a, v_part_b)
     OR v_part_a = ANY(u.member_book_ids)
     OR u.group_id = (v_saved->>'id')::bigint;
  IF v_units <> 0 THEN
    RAISE EXCEPTION 'private draft appeared in the public catalog';
  END IF;
  v_catalog := public.list_public_book_volume_catalog(p_search => 'ئويغانغان زېمىن', p_limit => 20);
  IF (v_catalog->>'total')::integer <> 0 THEN
    RAISE EXCEPTION 'ordinary/grouped search listed a private draft: %', v_catalog->>'total';
  END IF;
  IF public.get_public_book_volume_group_storefront(p_group_id => (v_saved->>'id')::bigint) IS NOT NULL
     OR public.resolve_public_book_volume_context(v_part_a) IS NOT NULL
     OR public.resolve_public_book_volume_context(v_part_b) IS NOT NULL THEN
    RAISE EXCEPTION 'private draft was reachable by group or direct URL';
  END IF;

  UPDATE public.books
  SET price = 370, is_active = true, submission_status = 'approved'
  WHERE id = 156;
  UPDATE public.books
  SET price = 399, is_active = true, submission_status = 'approved'
  WHERE id = 157;
  v_owner := public.admin_save_book_volume_group(
    NULL,
    NULL,
    jsonb_build_object(
      'slug', 'series-156',
      'title', 'ئويغانغان زېمىن',
      'author', 'ئابدۇرېھىم ئۆتكۈر',
      'category', 'تارىخىي رومانلار',
      'source', 'tarikhiy-romanlar.html',
      'complete_set_price', 750,
      'representative_book_id', 156,
      'is_active', true
    ),
    jsonb_build_array(
      jsonb_build_object('book_id', 156, 'position', 1, 'volume_label', '1-قىسىم'),
      jsonb_build_object('book_id', 157, 'position', 2, 'volume_label', '2-قىسىم')
    )
  );
  IF (v_owner->>'complete_set_price')::numeric <> 750 OR coalesce((v_owner->>'is_public')::boolean, true) THEN
    RAISE EXCEPTION 'existing-book link changed price or privacy: %', v_owner;
  END IF;
  IF (SELECT price FROM public.books WHERE id = 156) <> 370
     OR (SELECT price FROM public.books WHERE id = 157) <> 399 THEN
    RAISE EXCEPTION 'linking existing books rewrote part prices';
  END IF;
  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'book' AND u.book_id IN (156, 157);
  IF v_units <> 2 THEN
    RAISE EXCEPTION 'private link hid existing books: %', v_units;
  END IF;
  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'group' AND u.group_id = (v_owner->>'id')::bigint;
  IF v_units <> 0 THEN
    RAISE EXCEPTION 'private existing-book group entered the grouped catalog';
  END IF;

  UPDATE public.books
  SET is_active = false, submission_status = 'pending'
  WHERE id = 158;
  BEGIN
    PERFORM public.admin_set_book_volume_group_publication(
      (public.admin_save_book_volume_group(
        NULL,
        NULL,
        jsonb_build_object(
          'slug', 'pending-link',
          'title', 'تەستىقسىز',
          'author', '',
          'category', 'تارىخ',
          'source', 'romanlar.html',
          'representative_book_id', 159,
          'is_active', true
        ),
        jsonb_build_array(
          jsonb_build_object('book_id', 158, 'position', 1, 'volume_label', '1-قىسىم'),
          jsonb_build_object('book_id', 159, 'position', 2, 'volume_label', '2-قىسىم')
        )
      )->>'id')::bigint,
      1,
      true
    );
    RAISE EXCEPTION 'pending member was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'pending member was published' OR SQLERRM IS DISTINCT FROM 'volume_group_incomplete' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT submission_status FROM public.books WHERE id = 158) IS DISTINCT FROM 'pending'
     OR (SELECT is_active FROM public.books WHERE id = 158) IS NOT FALSE THEN
    RAISE EXCEPTION 'publication rewrote a pending book that was not a series draft';
  END IF;

  GRANT USAGE ON SCHEMA public TO anon;
  GRANT SELECT ON public.books TO anon;
  ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "public can read active books" ON public.books;
  CREATE POLICY "public can read active books"
    ON public.books
    FOR SELECT
    TO anon, authenticated
    USING (is_active = true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_visible FROM public.books WHERE id IN (v_part_a, v_part_b);
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'anon read draft parts: %', v_visible;
  END IF;
  SELECT count(*) INTO v_visible FROM public.books WHERE id IN (156, 157);
  IF v_visible <> 2 THEN
    RAISE EXCEPTION 'anon could not read existing linked books: %', v_visible;
  END IF;
  RESET ROLE;

  v_published := public.admin_set_book_volume_group_publication(
    (v_saved->>'id')::bigint,
    (v_saved->>'revision')::bigint,
    true
  );
  IF coalesce((v_published->>'is_public')::boolean, false) IS NOT TRUE
     OR (v_published->>'complete_set_price')::numeric <> 750
     OR (v_published->'members'->0->>'price')::numeric <> 370
     OR (v_published->'members'->1->>'price')::numeric <> 399 THEN
    RAISE EXCEPTION 'publication changed the explicit series price: %', v_published;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.books AS b
    WHERE b.id IN (v_part_a, v_part_b)
      AND (b.is_active IS NOT TRUE OR b.submission_status IS DISTINCT FROM 'approved')
  ) THEN
    RAISE EXCEPTION 'publication did not promote draft parts atomically';
  END IF;
  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'book' AND u.book_id IN (v_part_a, v_part_b);
  IF v_units <> 0 THEN
    RAISE EXCEPTION 'published parts remained ordinary catalog cards';
  END IF;
  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'group'
    AND u.group_id = (v_saved->>'id')::bigint
    AND u.set_price = 750;
  IF v_units <> 1 THEN
    RAISE EXCEPTION 'published series was not one grouped catalog unit';
  END IF;
  v_direct := public.resolve_public_book_volume_context(v_part_a);
  IF v_direct->>'kind' IS DISTINCT FROM 'group_child'
     OR (v_direct->'group'->>'set_price')::numeric <> 750 THEN
    RAISE EXCEPTION 'direct part URL did not open the published series: %', v_direct;
  END IF;
  IF public.resolve_public_book_volume_context(v_part_b)->>'kind' IS DISTINCT FROM 'group_child' THEN
    RAISE EXCEPTION 'second part URL stayed outside the published series';
  END IF;
  v_catalog := public.list_public_book_volume_catalog(p_search => 'ئويغانغان زېمىن', p_limit => 20);
  IF (v_catalog->>'total')::integer <> 1
     OR v_catalog->'items'->0->>'kind' IS DISTINCT FROM 'group'
     OR (v_catalog->'items'->0->>'set_price')::numeric <> 750 THEN
    RAISE EXCEPTION 'grouped search did not return the published 750 series: %', v_catalog;
  END IF;

  v_published := public.admin_set_book_volume_group_publication(
    (v_owner->>'id')::bigint,
    (v_owner->>'revision')::bigint,
    true
  );
  IF (SELECT price FROM public.books WHERE id = 156) <> 370
     OR (SELECT price FROM public.books WHERE id = 157) <> 399
     OR (v_published->>'complete_set_price')::numeric <> 750 THEN
    RAISE EXCEPTION 'publishing the existing series rewrote 156/157 or 750';
  END IF;
  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'book' AND u.book_id IN (156, 157);
  IF v_units <> 0 THEN
    RAISE EXCEPTION 'published existing books stayed duplicated in the ordinary catalog';
  END IF;
  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'group' AND u.slug = 'series-156' AND u.set_price = 750;
  IF v_units <> 1 THEN
    RAISE EXCEPTION 'owner series 156/157 was not the explicit 750 group';
  END IF;
END;
$$;
