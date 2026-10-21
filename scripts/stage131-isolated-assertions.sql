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
END;
$$;
