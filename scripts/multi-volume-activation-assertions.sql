-- Isolated activation checks after Stages 127, 128, 130, 131 and the Stage 131
-- assertions. Not production. series-156 is the fixture stand-in for the owner
-- group: books 156 then 157, explicit set price 750, part prices 370 and 399.
DO $$
DECLARE
  v_group_id bigint;
  v_quote jsonb;
  v_units integer;
BEGIN
  SELECT id INTO v_group_id
  FROM public.book_volume_groups
  WHERE slug = 'series-156';
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'series-156 missing after Stage 131';
  END IF;

  IF (SELECT price FROM public.books WHERE id = 156) <> 370
     OR (SELECT price FROM public.books WHERE id = 157) <> 399
     OR (SELECT stock FROM public.books WHERE id = 156) <> 20
     OR (SELECT stock FROM public.books WHERE id = 157) <> 20
     OR (SELECT image_url FROM public.books WHERE id = 156) IS DISTINCT FROM '/cover-156.webp'
     OR (SELECT image_url FROM public.books WHERE id = 157) IS DISTINCT FROM '/cover-157.webp'
     OR (SELECT is_active FROM public.books WHERE id = 156) IS NOT TRUE
     OR (SELECT is_active FROM public.books WHERE id = 157) IS NOT TRUE
     OR (SELECT submission_status FROM public.books WHERE id = 156) IS DISTINCT FROM 'approved'
     OR (SELECT submission_status FROM public.books WHERE id = 157) IS DISTINCT FROM 'approved'
     OR (SELECT complete_set_price FROM public.book_volume_groups WHERE id = v_group_id) <> 750
     OR (SELECT is_public FROM public.book_volume_groups WHERE id = v_group_id) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'owner series price, stock, cover, or publication state changed';
  END IF;

  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'group' AND u.slug = 'series-156' AND u.set_price = 750;
  IF v_units <> 1 THEN
    RAISE EXCEPTION 'expected one grouped catalog entry for series-156, found %', v_units;
  END IF;
  SELECT count(*) INTO v_units
  FROM private.kutadgu_public_catalog_units() AS u
  WHERE u.kind = 'book' AND u.book_id IN (156, 157);
  IF v_units <> 0 THEN
    RAISE EXCEPTION 'books 156 and 157 remained ordinary catalog cards';
  END IF;

  v_quote := public.quote_book_volume_cart(jsonb_build_array(
    jsonb_build_object('kind', 'set', 'group_id', v_group_id, 'qty', 1)
  ));
  IF (v_quote->>'total')::numeric <> 750
     OR v_quote->'items'->0->>'price_source' IS DISTINCT FROM 'explicit'
     OR (v_quote->'items'->0->>'line_total')::numeric <> 750
     OR (v_quote->'items'->0->'components'->0->>'price')::numeric <> 370
     OR (v_quote->'items'->0->'components'->1->>'price')::numeric <> 399
     OR v_quote->'items'->0->'components'->0->>'image_url' IS DISTINCT FROM '/cover-156.webp'
     OR v_quote->'items'->0->'components'->1->>'image_url' IS DISTINCT FROM '/cover-157.webp'
  THEN
    RAISE EXCEPTION 'set cart did not keep 750 and both covers: %', v_quote;
  END IF;

  v_quote := public.quote_book_volume_cart(jsonb_build_array(
    jsonb_build_object('kind', 'book', 'book_id', 156, 'qty', 1)
  ));
  IF (v_quote->>'total')::numeric <> 370 THEN
    RAISE EXCEPTION 'selected part 156 totaled %', v_quote->>'total';
  END IF;
  v_quote := public.quote_book_volume_cart(jsonb_build_array(
    jsonb_build_object('kind', 'book', 'book_id', 157, 'qty', 1)
  ));
  IF (v_quote->>'total')::numeric <> 399 THEN
    RAISE EXCEPTION 'selected part 157 totaled %', v_quote->>'total';
  END IF;
  v_quote := public.quote_book_volume_cart(jsonb_build_array(
    jsonb_build_object('kind', 'book', 'book_id', 156, 'qty', 1),
    jsonb_build_object('kind', 'book', 'book_id', 157, 'qty', 1)
  ));
  IF (v_quote->>'total')::numeric <> 769 THEN
    RAISE EXCEPTION 'individual selection totaled %', v_quote->>'total';
  END IF;
END;
$$;
