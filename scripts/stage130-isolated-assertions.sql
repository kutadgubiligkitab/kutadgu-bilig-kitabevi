-- Isolated Stage 130 assertions. Never production.

CREATE TEMP TABLE stage130_groups (
  member_count integer PRIMARY KEY,
  group_id bigint NOT NULL UNIQUE,
  revision bigint NOT NULL,
  first_book_id bigint NOT NULL
);

DO $security$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}',
    true
  );
  BEGIN
    PERFORM public.admin_preview_book_volume_members(1, NULL);
    RAISE EXCEPTION 'admin AAL1 unexpectedly used exact preview';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}',
    true
  );
  BEGIN
    PERFORM public.admin_set_book_volume_group_publication(1, 1, true);
    RAISE EXCEPTION 'ordinary AAL2 member unexpectedly published';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$security$;

DO $groups$
DECLARE
  v_count integer;
  v_base integer;
  v_group jsonb;
  v_published jsonb;
  v_members jsonb;
  v_before text;
  v_after text;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}',
    true
  );

  FOREACH v_count IN ARRAY ARRAY[2, 3, 8, 9, 10, 12] LOOP
    v_base := CASE v_count
      WHEN 2 THEN 1
      WHEN 3 THEN 3
      WHEN 8 THEN 6
      WHEN 9 THEN 14
      WHEN 10 THEN 23
      ELSE 33
    END;
    SELECT jsonb_agg(
      jsonb_build_object(
        'book_id', v_base + n - 1,
        'position', n,
        'volume_label', 'Volume ' || n
      )
      ORDER BY n
    )
    INTO v_members
    FROM generate_series(1, v_count) AS n;

    v_group := public.admin_save_book_volume_group(
      NULL,
      NULL,
      jsonb_build_object(
        'slug', 'storefront-set-' || v_count,
        'title', 'Storefront Set ' || v_count,
        'author', 'Grouped Author',
        'category', 'Grouped',
        'source', 'sets.html',
        'description', 'Variable member group ' || v_count,
        'complete_set_price', CASE
          WHEN v_count = 2 THEN to_jsonb(999)
          ELSE 'null'::jsonb
        END
      ),
      v_members
    );
    IF jsonb_array_length(v_group->'members') <> v_count THEN
      RAISE EXCEPTION 'Stage 127 save lost % members: %', v_count, v_group;
    END IF;
    IF (v_group->>'representative_book_id')::bigint <> v_base THEN
      RAISE EXCEPTION 'representative did not default to position 1: %', v_group;
    END IF;

    SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY b.id))
    INTO v_before
    FROM public.books AS b;
    v_published := public.admin_set_book_volume_group_publication(
      (v_group->>'id')::bigint,
      (v_group->>'revision')::bigint,
      true
    );
    SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY b.id))
    INTO v_after
    FROM public.books AS b;
    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'publication modified books for count %', v_count;
    END IF;
    IF v_published->>'is_public' <> 'true'
       OR (v_published->>'revision')::bigint <> (v_group->>'revision')::bigint + 1 THEN
      RAISE EXCEPTION 'publication state/revision failed: %', v_published;
    END IF;

    INSERT INTO stage130_groups(member_count, group_id, revision, first_book_id)
    VALUES (
      v_count,
      (v_published->>'id')::bigint,
      (v_published->>'revision')::bigint,
      v_base
    );
  END LOOP;
END
$groups$;

DO $public_surface$
DECLARE
  v_row record;
  v_by_id jsonb;
  v_by_slug jsonb;
  v_by_child jsonb;
  v_context jsonb;
  v_direct jsonb;
  v_catalog jsonb;
  v_filtered jsonb;
  v_first jsonb;
  v_page_one jsonb;
  v_page_two jsonb;
  v_sitemap jsonb;
  v_discovery_a jsonb;
  v_discovery_b jsonb;
  v_discovery_other jsonb;
  v_query jsonb;
  v_mapped jsonb;
BEGIN
  FOR v_row IN SELECT * FROM stage130_groups ORDER BY member_count LOOP
    v_by_id := public.get_public_book_volume_group_storefront(
      p_group_id => v_row.group_id
    );
    IF jsonb_array_length(v_by_id->'members') <> v_row.member_count
       OR (v_by_id->>'member_count')::integer <> v_row.member_count THEN
      RAISE EXCEPTION 'public variable count % failed: %', v_row.member_count, v_by_id;
    END IF;
  END LOOP;

  SELECT * INTO v_row FROM stage130_groups WHERE member_count = 2;
  v_by_id := public.get_public_book_volume_group_storefront(p_group_id => v_row.group_id);
  v_by_slug := public.get_public_book_volume_group_storefront(p_slug => 'storefront-set-2');
  v_by_child := public.get_public_book_volume_group_storefront(p_child_book_id => 2);
  IF v_by_id->>'unit_id' IS DISTINCT FROM v_by_slug->>'unit_id'
     OR v_by_id->>'unit_id' IS DISTINCT FROM v_by_child->>'unit_id' THEN
    RAISE EXCEPTION 'slug/id/child lookup disagreed: % / % / %', v_by_id, v_by_slug, v_by_child;
  END IF;
  IF v_by_id->>'price' <> '5.00'
     OR v_by_id->>'set_price' <> '999.00'
     OR v_by_id->>'representative_book_id' <> '1'
     OR v_by_id->>'image_url' <> '/cover-1.webp' THEN
    RAISE EXCEPTION 'lowest price or representative selection failed: %', v_by_id;
  END IF;

  v_context := public.resolve_public_book_volume_context(2);
  IF v_context->>'kind' <> 'group_child'
     OR v_context->>'book_id' <> '2'
     OR v_context#>>'{book,title}' <> 'Book 2'
     OR v_context#>>'{group,unit_id}' <> v_by_id->>'unit_id' THEN
    RAISE EXCEPTION 'child context did not preserve child and group: %', v_context;
  END IF;
  v_direct := public.resolve_public_book_volume_context(45);
  IF v_direct->>'kind' <> 'book'
     OR v_direct->>'unit_id' <> 'book:45'
     OR v_direct#>>'{book,title}' <> 'Book 45' THEN
    RAISE EXCEPTION 'direct book context was not preserved: %', v_direct;
  END IF;

  v_catalog := public.list_public_book_volume_catalog(p_limit => 24);
  IF v_catalog->>'total' <> '142' THEN
    RAISE EXCEPTION 'group-before-pagination total should be 180-44+6=142: %', v_catalog;
  END IF;
  IF jsonb_array_length(v_catalog->'items') <> 24
     OR v_catalog->>'has_more' <> 'true' THEN
    RAISE EXCEPTION 'catalog first page metadata failed: %', v_catalog;
  END IF;

  v_filtered := public.list_public_book_volume_catalog(
    p_max_price => 5,
    p_sort => 'price_low',
    p_limit => 10
  );
  IF v_filtered->>'total' <> '1'
     OR v_filtered#>>'{items,0,kind}' <> 'group'
     OR v_filtered#>>'{items,0,price}' <> '5.00'
     OR v_filtered#>>'{items,0,set_price}' <> '999.00' THEN
    RAISE EXCEPTION 'lowest member price filter failed: %', v_filtered;
  END IF;
  v_first := public.list_public_book_volume_catalog(p_sort => 'price_low', p_limit => 1);
  IF v_first#>>'{items,0,unit_id}' <> v_by_id->>'unit_id' THEN
    RAISE EXCEPTION 'lowest member price sort failed: %', v_first;
  END IF;

  v_query := public.query_public_book_catalog(jsonb_build_object(
    'ids', jsonb_build_array('book:45', v_by_id->>'unit_id'),
    'sort', 'new',
    'offset', 0,
    'limit', 10
  ));
  IF v_query->>'total' <> '2'
     OR v_query#>>'{items,0,unit_id}' <> 'book:45'
     OR v_query#>>'{items,1,unit_id}' <> v_by_id->>'unit_id'
     OR v_query#>>'{items,1,member_count}' <> '2'
     OR jsonb_array_length(v_query#>'{items,1,member_book_ids}') <> 2 THEN
    RAISE EXCEPTION 'typed unit lookup/order failed: %', v_query;
  END IF;
  v_query := public.query_public_book_catalog(jsonb_build_object(
    'credit_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'credit_role', 'author',
    'offset', 0,
    'limit', 10
  ));
  IF v_query->>'total' <> '1'
     OR v_query#>>'{items,0,unit_id}' <> v_by_id->>'unit_id' THEN
    RAISE EXCEPTION 'group member credit filter failed: %', v_query;
  END IF;
  v_mapped := public.map_public_books_to_catalog_units(ARRAY[1, 2, 45]);
  IF jsonb_array_length(v_mapped) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_mapped) AS e(value)
       WHERE e.value->>'kind' = 'group'
         AND jsonb_array_length(e.value->'matched_book_ids') = 2
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_mapped) AS e(value)
       WHERE e.value->>'unit_id' = 'book:45'
     ) THEN
    RAISE EXCEPTION 'AI/catalog unit mapping failed: %', v_mapped;
  END IF;

  v_page_one := public.list_public_book_volume_catalog(
    p_sort => 'title', p_offset => 0, p_limit => 5
  );
  v_page_two := public.list_public_book_volume_catalog(
    p_sort => 'title', p_offset => 5, p_limit => 5
  );
  IF jsonb_array_length(v_page_one->'items') <> 5
     OR jsonb_array_length(v_page_two->'items') <> 5
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_page_one->'items') AS a(value)
       JOIN jsonb_array_elements(v_page_two->'items') AS b(value)
         ON a.value->>'unit_id' = b.value->>'unit_id'
     ) THEN
    RAISE EXCEPTION 'stable catalog pagination failed: % / %', v_page_one, v_page_two;
  END IF;

  v_sitemap := public.list_public_book_volume_sitemap_entries(0, 1000);
  IF v_sitemap->>'total' <> '142'
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_sitemap->'items') AS e(value)
       WHERE e.value->>'unit_id' = v_by_id->>'unit_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_sitemap->'items') AS e(value)
       WHERE e.value->>'unit_id' = 'book:45'
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_sitemap->'items') AS e(value)
       WHERE e.value->>'unit_id' IN ('book:1', 'book:2')
     ) THEN
    RAISE EXCEPTION 'grouped sitemap entries failed: %', v_sitemap;
  END IF;

  v_discovery_a := public.list_public_book_volume_discovery_unit_ids('visit-a', 0, 1000);
  v_discovery_b := public.list_public_book_volume_discovery_unit_ids('visit-a', 0, 1000);
  v_discovery_other := public.list_public_book_volume_discovery_unit_ids('visit-b', 0, 1000);
  IF v_discovery_a->'unit_ids' IS DISTINCT FROM v_discovery_b->'unit_ids'
     OR v_discovery_a->>'total' <> '142'
     OR jsonb_array_length(v_discovery_a->'unit_ids') <> 142
     OR (
       SELECT count(DISTINCT value #>> '{}')
       FROM jsonb_array_elements(v_discovery_a->'unit_ids')
     ) <> 142
     OR NOT (v_discovery_a->'unit_ids' ? (v_by_id->>'unit_id'))
     OR v_discovery_a->'unit_ids' ? 'book:1'
     OR v_discovery_a->'unit_ids' IS NOT DISTINCT FROM v_discovery_other->'unit_ids' THEN
    RAISE EXCEPTION 'deterministic discovery IDs failed';
  END IF;
END
$public_surface$;

DO $admin_surface$
DECLARE
  v_preview jsonb;
  v_group jsonb;
  v_invalid_id bigint;
  v_revision bigint;
  v_books_before text;
  v_books_after text;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}',
    true
  );

  v_preview := public.admin_preview_book_volume_members(150, 'DUPLICATE-ISBN');
  IF jsonb_array_length(v_preview) <> 2
     OR (SELECT count(DISTINCT (e.value->>'book_id')::bigint)
         FROM jsonb_array_elements(v_preview) AS e(value)) <> 2 THEN
    RAISE EXCEPTION 'exact ID/ISBN preview duplicated or lost rows: %', v_preview;
  END IF;
  IF jsonb_array_length(public.admin_preview_book_volume_members(1, NULL)) <> 1
     OR public.admin_preview_book_volume_members(1, NULL)#>>'{0,group_slug}' <> 'storefront-set-2' THEN
    RAISE EXCEPTION 'exact ID preview omitted current group';
  END IF;

  SELECT group_id, revision INTO v_invalid_id, v_revision
  FROM stage130_groups WHERE member_count = 3;
  BEGIN
    PERFORM public.admin_set_book_volume_group_publication(
      v_invalid_id, v_revision - 1, false
    );
    RAISE EXCEPTION 'stale publication revision was accepted';
  EXCEPTION WHEN serialization_failure THEN
    NULL;
  END;

  BEGIN
    PERFORM public.admin_save_book_volume_group(
      NULL,
      NULL,
      '{"slug":"duplicate-input","title":"Duplicate input"}'::jsonb,
      '[{"book_id":152,"position":1},{"book_id":152,"position":2}]'::jsonb
    );
    RAISE EXCEPTION 'duplicate member input was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.admin_save_book_volume_group(
      NULL,
      NULL,
      '{"slug":"duplicate-membership","title":"Duplicate membership"}'::jsonb,
      '[{"book_id":1,"position":1},{"book_id":152,"position":2}]'::jsonb
    );
    RAISE EXCEPTION 'book already grouped was accepted into another group';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  v_group := public.admin_save_book_volume_group(
    NULL,
    NULL,
    '{"slug":"publication-guard","title":"Publication guard","category":"Guard","source":"guard.html"}'::jsonb,
    '[{"book_id":120,"position":1},{"book_id":121,"position":2}]'::jsonb
  );
  v_invalid_id := (v_group->>'id')::bigint;
  v_revision := (v_group->>'revision')::bigint;

  UPDATE public.books SET price = NULL WHERE id = 121;
  BEGIN
    PERFORM public.admin_set_book_volume_group_publication(v_invalid_id, v_revision, true);
    RAISE EXCEPTION 'unpriced member publication was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
  UPDATE public.book_volume_groups SET is_public = true WHERE id = v_invalid_id;
  IF public.get_public_book_volume_group_storefront(p_group_id => v_invalid_id) IS NOT NULL THEN
    RAISE EXCEPTION 'forced public group leaked an unpriced member';
  END IF;
  UPDATE public.book_volume_groups SET is_public = false WHERE id = v_invalid_id;
  UPDATE public.books SET price = 1210 WHERE id = 121;

  UPDATE public.books SET is_active = false WHERE id = 121;
  BEGIN
    PERFORM public.admin_set_book_volume_group_publication(v_invalid_id, v_revision, true);
    RAISE EXCEPTION 'inactive member publication was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
  UPDATE public.books SET is_active = true WHERE id = 121;

  UPDATE public.books SET submission_status = 'pending' WHERE id = 121;
  BEGIN
    PERFORM public.admin_set_book_volume_group_publication(v_invalid_id, v_revision, true);
    RAISE EXCEPTION 'unapproved member publication was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
  UPDATE public.books SET submission_status = 'approved' WHERE id = 121;

  SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY b.id))
  INTO v_books_before
  FROM public.books AS b;
  v_group := public.admin_set_book_volume_group_publication(v_invalid_id, v_revision, true);
  SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY b.id))
  INTO v_books_after
  FROM public.books AS b;
  IF v_books_before IS DISTINCT FROM v_books_after
     OR v_group->>'is_public' <> 'true' THEN
    RAISE EXCEPTION 'valid publication changed books or did not publish: %', v_group;
  END IF;
END
$admin_surface$;

DO $grants$
BEGIN
  IF NOT has_function_privilege(
       'anon',
       'public.list_public_book_volume_catalog(text,text,text,numeric,numeric,boolean,boolean,boolean,boolean,text,integer,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.get_public_book_volume_group_storefront(bigint,text,bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'anon',
       'public.query_public_book_catalog(jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.admin_preview_book_volume_members(bigint,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.admin_set_book_volume_group_publication(bigint,bigint,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'public/admin function grants are not distinguished';
  END IF;
END
$grants$;
