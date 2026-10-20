-- Isolated Stage 128 assertions. Not production.
DO $$
DECLARE
  g9 jsonb;
  g3 jsonb;
  q9 jsonb;
  q3 jsonb;
  mixed jsonb;
  forged jsonb;
  stale jsonb;
  saved public.orders%rowtype;
  flat_order public.orders%rowtype;
  g9_id bigint;
  g3_id bigint;
  g9_revision bigint;
  demand integer;
  before_stock integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}', true);

  g9 := public.admin_save_book_volume_group(
    NULL, NULL,
    '{"slug":"nine-volume-set","title":"Nine Volume Set","author":"Shared","category":"Test","source":"test.html"}'::jsonb,
    (SELECT jsonb_agg(jsonb_build_object('book_id', n, 'position', n, 'volume_label', 'V' || n) ORDER BY n)
     FROM generate_series(1, 9) AS n)
  );
  g3 := public.admin_save_book_volume_group(
    NULL, NULL,
    '{"slug":"three-volume-set","title":"Three Volume Set","author":"Shared","category":"Test","source":"test.html","complete_set_price":250}'::jsonb,
    '[{"book_id":10,"position":1},{"book_id":11,"position":2},{"book_id":12,"position":3}]'::jsonb
  );
  g9_id := (g9->>'id')::bigint;
  g3_id := (g3->>'id')::bigint;
  UPDATE public.book_volume_groups SET is_public = true WHERE id IN (g9_id, g3_id);

  q9 := public.quote_book_volume_cart(jsonb_build_array(jsonb_build_object(
    'kind', 'set', 'group_id', g9_id, 'qty', 1
  )));
  IF q9->>'total' <> '450.00' OR q9->>'total_qty' <> '9'
     OR q9#>>'{items,0,price_source}' <> 'sum'
     OR jsonb_array_length(q9#>'{items,0,components}') <> 9 THEN
    RAISE EXCEPTION 'nine-volume fallback quote failed: %', q9;
  END IF;

  q3 := public.quote_book_volume_cart(jsonb_build_array(jsonb_build_object(
    'kind', 'set', 'group_id', g3_id, 'qty', 1
  )));
  IF q3->>'total' <> '250.00' OR q3->>'total_qty' <> '3'
     OR q3#>>'{items,0,price_source}' <> 'explicit' THEN
    RAISE EXCEPTION 'explicit set quote failed: %', q3;
  END IF;
  UPDATE public.books SET price = price + 100 WHERE id = 10;
  IF (public.quote_book_volume_cart(jsonb_build_array(jsonb_build_object(
    'kind', 'set', 'group_id', g3_id, 'qty', 1
  )))->>'total') <> '250.00' THEN
    RAISE EXCEPTION 'child price changed explicit set price';
  END IF;

  mixed := public.quote_book_volume_cart(jsonb_build_array(
    jsonb_build_object('kind', 'set', 'group_id', g9_id, 'qty', 2),
    jsonb_build_object('kind', 'book', 'book_id', 1, 'qty', 1)
  ));
  IF mixed->>'total_qty' <> '19' THEN
    RAISE EXCEPTION 'physical quantity did not count 2x9 + 1: %', mixed;
  END IF;
  SELECT qty INTO demand
  FROM public.kutadgu_order_inventory_lines(mixed->'items')
  WHERE book_id = 1;
  IF demand <> 3 THEN
    RAISE EXCEPTION 'volume 1 demand was %, expected 3', demand;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.kutadgu_order_inventory_lines(mixed->'items')
    WHERE book_id BETWEEN 2 AND 9 AND qty <> 2
  ) THEN
    RAISE EXCEPTION 'other set components did not demand 2';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}', true);
  forged := jsonb_set(mixed, '{total}', '1'::jsonb);
  forged := jsonb_set(forged, '{items,0,price}', '1'::jsonb);
  SELECT * INTO saved
  FROM public.create_member_volume_order(
    'KB-261020-ABCDEFGH', forged, '', '', '', '', '', ''
  );
  IF saved.total <> 910 OR saved.total_qty <> 19
     OR saved.items#>>'{0,kind}' <> 'set'
     OR saved.items#>>'{0,schema_version}' <> '1' THEN
    RAISE EXCEPTION 'server accepted forged totals or lost snapshot: %', row_to_json(saved);
  END IF;

  stale := public.quote_book_volume_cart(jsonb_build_array(jsonb_build_object(
    'kind', 'set', 'group_id', g9_id, 'qty', 1
  )));
  UPDATE public.books SET price = price + 1 WHERE id = 2;
  BEGIN
    PERFORM public.create_member_volume_order(
      'KB-261020-BCDEFGHJ', stale, '', '', '', '', '', ''
    );
    RAISE EXCEPTION 'child price change did not invalidate fallback quote';
  EXCEPTION WHEN serialization_failure THEN
    NULL;
  END;
  BEGIN
    PERFORM public.create_member_volume_order(
      'KB-261020-CDEFGHJK',
      jsonb_set(stale, '{expires_at}', to_jsonb(clock_timestamp() - interval '1 second')),
      '', '', '', '', '', ''
    );
    RAISE EXCEPTION 'expired quote was accepted';
  EXCEPTION WHEN serialization_failure THEN
    NULL;
  END;

  UPDATE public.books SET stock = 0 WHERE id = 3;
  BEGIN
    PERFORM public.quote_book_volume_cart(jsonb_build_array(jsonb_build_object(
      'kind', 'set', 'group_id', g9_id, 'qty', 1
    )));
    RAISE EXCEPTION 'unavailable required volume did not disable set';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'insufficient_stock' THEN RAISE; END IF;
  END;
  UPDATE public.books SET stock = 20 WHERE id = 3;

  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}', true);
  SELECT revision INTO g9_revision FROM public.book_volume_groups WHERE id = g9_id;
  PERFORM public.admin_save_book_volume_group(
    g9_id, g9_revision,
    '{"slug":"nine-volume-set","title":"Nine Volume Set","author":"Shared","category":"Test","source":"test.html"}'::jsonb,
    (SELECT jsonb_agg(jsonb_build_object(
      'book_id', CASE WHEN n = 9 THEN 30 ELSE n END,
      'position', n,
      'volume_label', 'V' || n
    ) ORDER BY n) FROM generate_series(1, 9) AS n)
  );

  SELECT stock INTO before_stock FROM public.books WHERE id = 9;
  UPDATE public.orders SET status = 'confirmed' WHERE id = saved.id;
  IF (SELECT stock FROM public.books WHERE id = 1) <> 17
     OR (SELECT stock FROM public.books WHERE id = 9) <> before_stock - 2
     OR (SELECT stock FROM public.books WHERE id = 30) <> 20 THEN
    RAISE EXCEPTION 'saved components did not remain authoritative';
  END IF;
  UPDATE public.orders SET status = 'processing' WHERE id = saved.id;
  IF (SELECT stock FROM public.books WHERE id = 1) <> 17 THEN
    RAISE EXCEPTION 'committed retry decremented twice';
  END IF;
  BEGIN
    DELETE FROM public.books WHERE id = 9;
    RAISE EXCEPTION 'committed set component was deletable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'book_has_committed_stock' THEN RAISE; END IF;
  END;
  UPDATE public.orders SET status = 'cancelled' WHERE id = saved.id;
  IF (SELECT stock FROM public.books WHERE id = 1) <> 20
     OR (SELECT stock FROM public.books WHERE id = 9) <> before_stock THEN
    RAISE EXCEPTION 'set cancellation did not restore exact stock';
  END IF;

  INSERT INTO public.orders (
    order_no, user_id, status, items, total, total_qty
  ) VALUES (
    'KB-261020-DEFGHJKL',
    '11111111-1111-4111-8111-111111111111',
    'prepared',
    '[{"book_id":20,"title":"Legacy","price":200,"qty":2,"line_total":400}]'::jsonb,
    400,
    2
  ) RETURNING * INTO flat_order;
  UPDATE public.orders SET status = 'confirmed' WHERE id = flat_order.id;
  IF (SELECT stock FROM public.books WHERE id = 20) <> 18 THEN
    RAISE EXCEPTION 'legacy flat order no longer decremented';
  END IF;
  UPDATE public.orders SET status = 'cancelled' WHERE id = flat_order.id;
  IF (SELECT stock FROM public.books WHERE id = 20) <> 20 THEN
    RAISE EXCEPTION 'legacy flat order no longer restored';
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1"}', true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    INSERT INTO public.member_volume_set_cart_items (user_id, group_id, quantity)
    SELECT auth.uid(), id, 1 FROM public.book_volume_groups LIMIT 1;
    RAISE EXCEPTION 'suspended member wrote set cart';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
END;
$$;
