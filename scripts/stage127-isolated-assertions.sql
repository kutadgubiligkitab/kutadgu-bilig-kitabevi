-- Isolated Stage 127 assertions. Not production.
DO $$
DECLARE
  g jsonb;
  updated jsonb;
  members jsonb;
  group_id bigint;
  revision bigint;
  quote_before text;
  quote_after text;
  explicit_before text;
  explicit_after text;
  n integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}', true);
  BEGIN
    PERFORM public.admin_list_book_volume_groups();
    RAISE EXCEPTION 'admin AAL1 unexpectedly listed groups';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}', true);
  BEGIN
    PERFORM public.admin_list_book_volume_groups();
    RAISE EXCEPTION 'ordinary member unexpectedly listed groups';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}', true);
  CREATE TEMP TABLE protected_books AS
    SELECT id, title, author, price, image_url, stock FROM public.books ORDER BY id;

  FOREACH n IN ARRAY ARRAY[2,3,8,9,10] LOOP
    SELECT jsonb_agg(jsonb_build_object(
      'book_id', base_id + offset_no,
      'position', offset_no + 1,
      'volume_label', 'Volume ' || (offset_no + 1)
    ) ORDER BY offset_no)
    INTO members
    FROM generate_series(0, n - 1) AS offset_no
    CROSS JOIN LATERAL (
      SELECT CASE n WHEN 2 THEN 1 WHEN 3 THEN 3 WHEN 8 THEN 6 WHEN 9 THEN 14 ELSE 23 END AS base_id
    ) AS chosen;

    g := public.admin_save_book_volume_group(
      NULL,
      NULL,
      jsonb_build_object(
        'slug', 'set-' || n,
        'title', 'Set ' || n,
        'author', 'Shared Author',
        'category', 'Test',
        'source', 'test.html',
        'description', 'Shared once',
        'complete_set_price', CASE WHEN n = 9 THEN to_jsonb(777) ELSE 'null'::jsonb END
      ),
      members
    );
    IF jsonb_array_length(g->'members') <> n THEN
      RAISE EXCEPTION 'member count % failed: %', n, g;
    END IF;
    IF (g->>'representative_book_id')::bigint <> (members->0->>'book_id')::bigint THEN
      RAISE EXCEPTION 'representative did not default to volume 1: %', g;
    END IF;
    IF g->>'is_public' <> 'false' THEN
      RAISE EXCEPTION 'new group became public: %', g;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM protected_books AS before
    FULL JOIN (
      SELECT id, title, author, price, image_url, stock FROM public.books
    ) AS after USING (id, title, author, price, image_url, stock)
    WHERE before.id IS NULL OR after.id IS NULL
  ) THEN
    RAISE EXCEPTION 'linking rewrote protected book fields';
  END IF;

  SELECT id, revision INTO group_id, revision
  FROM public.book_volume_groups WHERE slug = 'set-3';

  BEGIN
    PERFORM public.admin_save_book_volume_group(
      group_id,
      revision - 1,
      '{"slug":"set-3","title":"Set 3","is_active":true}'::jsonb,
      '[{"book_id":3,"position":1},{"book_id":4,"position":2},{"book_id":5,"position":3}]'::jsonb
    );
    RAISE EXCEPTION 'stale revision was accepted';
  EXCEPTION WHEN serialization_failure THEN
    NULL;
  END;

  BEGIN
    PERFORM public.admin_save_book_volume_group(
      group_id,
      revision,
      '{"slug":"set-3","title":"Set 3","is_active":true}'::jsonb,
      '[{"book_id":3,"position":1},{"book_id":3,"position":2},{"book_id":5,"position":3}]'::jsonb
    );
    RAISE EXCEPTION 'duplicate member was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    PERFORM public.admin_save_book_volume_group(
      group_id,
      revision,
      '{"slug":"set-3","title":"Set 3","is_active":true}'::jsonb,
      '[{"book_id":3,"position":1},{"book_id":4,"position":3},{"book_id":5,"position":4}]'::jsonb
    );
    RAISE EXCEPTION 'non-contiguous positions were accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  updated := public.admin_save_book_volume_group(
    group_id,
    revision,
    '{"slug":"set-3","title":"Set 3 reordered","is_active":true,"representative_book_id":5}'::jsonb,
    '[{"book_id":5,"position":1,"volume_label":"Third"},{"book_id":3,"position":2,"volume_label":"First"}]'::jsonb
  );
  IF jsonb_array_length(updated->'members') <> 2
     OR updated#>>'{members,0,book_id}' <> '5'
     OR updated->>'representative_book_id' <> '5' THEN
    RAISE EXCEPTION 'transactional unlink/reorder failed: %', updated;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.book_volume_group_members
    WHERE group_id = group_id AND book_id = 4
  ) THEN
    RAISE EXCEPTION 'unlinked member survived';
  END IF;

  SELECT id INTO group_id FROM public.book_volume_groups WHERE slug = 'set-2';
  quote_before := public.kutadgu_book_volume_quote_revision(group_id);
  UPDATE public.books SET price = price + 1 WHERE id = 1;
  quote_after := public.kutadgu_book_volume_quote_revision(group_id);
  IF quote_before = quote_after THEN
    RAISE EXCEPTION 'fallback quote revision ignored child price';
  END IF;

  SELECT id INTO group_id FROM public.book_volume_groups WHERE slug = 'set-9';
  explicit_before := public.kutadgu_book_volume_quote_revision(group_id);
  UPDATE public.books SET price = price + 1 WHERE id = 14;
  explicit_after := public.kutadgu_book_volume_quote_revision(group_id);
  IF explicit_before <> explicit_after THEN
    RAISE EXCEPTION 'explicit set quote revision depended on child price';
  END IF;

  IF public.get_public_book_volume_group(group_id) IS NOT NULL THEN
    RAISE EXCEPTION 'disabled group was publicly readable';
  END IF;
END;
$$;

DO $$
DECLARE
  privileges text;
BEGIN
  SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
  INTO privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('book_volume_groups', 'book_volume_group_members')
    AND grantee IN ('anon', 'authenticated', 'service_role');
  IF privileges <> '' THEN
    RAISE EXCEPTION 'group tables have direct grants: %', privileges;
  END IF;
END;
$$;
