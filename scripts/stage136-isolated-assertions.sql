-- @stage136 applied
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.book_categories) <> (SELECT count(*) FROM stage136_categories) THEN
    RAISE EXCEPTION 'stage136 changed the category count';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM stage136_categories AS before
    JOIN public.book_categories AS after ON after.id = before.id
    WHERE before.slug IS DISTINCT FROM after.slug
       OR before.source IS DISTINCT FROM after.source
       OR before.label IS DISTINCT FROM after.label
       OR before.summary IS DISTINCT FROM after.summary
       OR before.icon IS DISTINCT FROM after.icon
       OR before.sort_order IS DISTINCT FROM after.sort_order
       OR before.is_hidden IS DISTINCT FROM after.is_hidden
       OR before.retired_at IS DISTINCT FROM after.retired_at
       OR before.redirect_category_id IS DISTINCT FROM after.redirect_category_id
       OR before.revision IS DISTINCT FROM after.revision
  ) THEN
    RAISE EXCEPTION 'stage136 rewrote an existing category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.book_categories WHERE admin_group IS NOT NULL) THEN
    RAISE EXCEPTION 'stage136 assigned a group to an existing category';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM stage136_books AS before
    JOIN public.books AS after ON after.id = before.id
    WHERE before.title IS DISTINCT FROM after.title
       OR before.author IS DISTINCT FROM after.author
       OR before.category IS DISTINCT FROM after.category
       OR before.source IS DISTINCT FROM after.source
       OR before.price IS DISTINCT FROM after.price
       OR before.image_url IS DISTINCT FROM after.image_url
       OR before.stock IS DISTINCT FROM after.stock
       OR before.is_active IS DISTINCT FROM after.is_active
       OR before.submission_status IS DISTINCT FROM after.submission_status
  ) OR (SELECT count(*) FROM public.books) <> (SELECT count(*) FROM stage136_books) THEN
    RAISE EXCEPTION 'stage136 rewrote a book';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM stage136_groups AS before
    JOIN public.book_volume_groups AS after ON after.id = before.id
    WHERE before.slug IS DISTINCT FROM after.slug
       OR before.title IS DISTINCT FROM after.title
       OR before.category IS DISTINCT FROM after.category
       OR before.source IS DISTINCT FROM after.source
       OR before.complete_set_price IS DISTINCT FROM after.complete_set_price
       OR before.revision IS DISTINCT FROM after.revision
  ) THEN
    RAISE EXCEPTION 'stage136 rewrote a volume group';
  END IF;
  IF position('admin_group' IN public.list_public_book_categories()::text) > 0 THEN
    RAISE EXCEPTION 'storefront directory includes admin_group';
  END IF;
  IF (
    SELECT value->>'admin_group'
    FROM jsonb_array_elements(public.admin_list_book_categories()) AS value
    WHERE value->>'slug' = 'romanlar'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'admin list assigned romanlar a group';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","aal":"aal1","role":"authenticated"}', false);
DO $$
BEGIN
  PERFORM public.admin_create_book_category(
    '13600000-0000-4000-8000-000000000010', 'يېڭى', 'aal-tur', '', '📚', 'literature'
  );
  RAISE EXCEPTION 'aal1 create was accepted';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
BEGIN
  PERFORM public.admin_create_book_category(
    '13600000-0000-4000-8000-000000000011', 'خاتا', 'xata-tur', '', '📚', 'both'
  );
  RAISE EXCEPTION 'invalid group was accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'invalid_admin_group' THEN
    RAISE;
  END IF;
END;
$$;
DO $$
BEGIN
  PERFORM public.admin_create_book_category(
    '13600000-0000-4000-8000-000000000012', 'خاتا', 'xata-tur', '', '📚', NULL
  );
  RAISE EXCEPTION 'missing group was accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'invalid_admin_group' THEN
    RAISE;
  END IF;
END;
$$;
DO $$
BEGIN
  PERFORM public.admin_create_book_category(
    '13600000-0000-4000-8000-000000000013', 'خاتا', 'not an slug', '', '📚', 'literature'
  );
  RAISE EXCEPTION 'invalid slug was accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'invalid_category' THEN
    RAISE;
  END IF;
END;
$$;

SELECT public.admin_create_book_category(
  '13600000-0000-4000-8000-000000000001', 'گۇرۇپپا تۈر', 'gruppa-tur', 'قىسقىچە', '📚', 'literature'
);
SELECT public.admin_create_book_category(
  '13600000-0000-4000-8000-000000000001', 'باشقا', 'gruppa-tur-2', 'باشقا', '📚', 'history'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.book_categories WHERE slug = 'gruppa-tur') <> 1 THEN
    RAISE EXCEPTION 'create was not idempotent';
  END IF;
  IF (SELECT count(*) FROM public.book_categories WHERE slug = 'gruppa-tur-2') <> 0 THEN
    RAISE EXCEPTION 'idempotent replay inserted another category';
  END IF;
  IF (SELECT admin_group FROM public.book_categories WHERE slug = 'gruppa-tur') <> 'literature' THEN
    RAISE EXCEPTION 'create did not keep the selected group';
  END IF;
  IF (
    SELECT result->>'admin_group'
    FROM public.book_category_operations
    WHERE request_id = '13600000-0000-4000-8000-000000000001'
  ) <> 'literature' THEN
    RAISE EXCEPTION 'stored create result lost the group';
  END IF;
  IF EXISTS (SELECT 1 FROM public.book_categories WHERE slug IN ('xata-tur', 'aal-tur')) THEN
    RAISE EXCEPTION 'rejected create inserted a row';
  END IF;
  BEGIN
    PERFORM public.admin_create_book_category(
      '13600000-0000-4000-8000-000000000014', 'گۇرۇپپا تۈر', 'gruppa-tur', '', '📚', 'religion'
    );
    RAISE EXCEPTION 'duplicate slug was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'slug_in_use' THEN
      RAISE;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_preview jsonb;
  v_children bigint;
  v_hidden bigint;
  v_retired bigint;
BEGIN
  SELECT id INTO v_children FROM public.book_categories WHERE slug = 'children';
  SELECT id INTO v_hidden FROM public.book_categories WHERE slug = 'tibb';
  SELECT id INTO v_retired FROM public.book_categories WHERE slug = 'dictionary';
  PERFORM public.admin_set_book_category_hidden(
    '13600000-0000-4000-8000-000000000021',
    v_hidden,
    (SELECT revision FROM public.book_categories WHERE id = v_hidden),
    true
  );
  PERFORM public.admin_retire_book_category(
    '13600000-0000-4000-8000-000000000022',
    v_retired,
    (SELECT revision FROM public.book_categories WHERE id = v_retired),
    (SELECT id FROM public.book_categories WHERE slug = 'grammar')
  );
  BEGIN
    PERFORM public.admin_preview_book_category_move(ARRAY[2]::bigint[], v_hidden);
    RAISE EXCEPTION 'hidden destination was previewed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'destination_unavailable' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_move_books_to_category(
      '13600000-0000-4000-8000-000000000023',
      ARRAY[2]::bigint[],
      v_hidden,
      ARRAY[2]::bigint[]
    );
    RAISE EXCEPTION 'hidden destination accepted a move';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'destination_unavailable' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_preview_book_category_move(ARRAY[2]::bigint[], v_retired);
    RAISE EXCEPTION 'retired destination was previewed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'destination_unavailable' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT source FROM public.books WHERE id = 2) <> 'romanlar.html'
     OR (SELECT price FROM public.books WHERE id = 2) <> 370 THEN
    RAISE EXCEPTION 'rejected destination changed the book';
  END IF;
  v_preview := public.admin_preview_book_category_move(ARRAY[1]::bigint[], v_children);
  IF (v_preview->>'book_count')::integer <> 2
     OR (v_preview->>'added_book_count')::integer <> 1
     OR NOT (v_preview->'book_ids' @> '[1,4]'::jsonb AND v_preview->'book_ids' <@ '[1,4]'::jsonb) THEN
    RAISE EXCEPTION 'preview did not expand the volume group: %', v_preview;
  END IF;
  PERFORM public.admin_move_books_to_category(
    '13600000-0000-4000-8000-000000000024',
    ARRAY[1]::bigint[],
    v_children,
    ARRAY[1,4]::bigint[]
  );
  IF (SELECT source FROM public.books WHERE id = 1) <> 'children.html'
     OR (SELECT category FROM public.books WHERE id = 1) <> 'بالىلار كىتابلىرى'
     OR (SELECT price FROM public.books WHERE id = 1) <> 10
     OR (SELECT stock FROM public.books WHERE id = 1) <> 3
     OR (SELECT is_active FROM public.books WHERE id = 1) IS NOT FALSE THEN
    RAISE EXCEPTION 'volume move changed more than the category on book 1';
  END IF;
  IF (SELECT source FROM public.books WHERE id = 4) <> 'children.html'
     OR (SELECT category FROM public.books WHERE id = 4) <> 'بالىلار كىتابلىرى'
     OR (SELECT price FROM public.books WHERE id = 4) <> 8
     OR (SELECT submission_status FROM public.books WHERE id = 4) <> 'draft' THEN
    RAISE EXCEPTION 'volume move missed a member or rewrote book 4';
  END IF;
  IF (SELECT source FROM public.book_volume_groups WHERE id = 9) <> 'children.html'
     OR (SELECT complete_set_price FROM public.book_volume_groups WHERE id = 9) <> 750
     OR (SELECT revision FROM public.book_volume_groups WHERE id = 9) <> 4 THEN
    RAISE EXCEPTION 'volume move changed the set price or missed the group';
  END IF;
  IF (SELECT source FROM public.books WHERE id = 3) <> 'other.html'
     OR (SELECT category FROM public.books WHERE id = 3) <> 'Custom'
     OR (SELECT book_id FROM public.orders WHERE id = 70) <> 1 THEN
    RAISE EXCEPTION 'volume move touched an unrelated book or order';
  END IF;
  IF (SELECT count(*) FROM public.book_volume_group_members WHERE group_id = 9) <> 2 THEN
    RAISE EXCEPTION 'volume move changed membership';
  END IF;
END;
$$;

-- @stage136 rolled
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'book_categories' AND column_name = 'admin_group'
  ) THEN
    RAISE EXCEPTION 'rollback left admin_group in place';
  END IF;
  IF (SELECT label FROM public.book_categories WHERE slug = 'gruppa-tur') <> 'گۇرۇپپا تۈر' THEN
    RAISE EXCEPTION 'rollback lost the created category';
  END IF;
  IF EXISTS (
    SELECT 1 FROM stage136_categories AS seeded
    WHERE NOT EXISTS (SELECT 1 FROM public.book_categories AS live WHERE live.id = seeded.id)
  ) THEN
    RAISE EXCEPTION 'rollback deleted a category';
  END IF;
  IF (SELECT count(*) FROM public.book_categories b WHERE NOT EXISTS (
    SELECT 1 FROM stage136_categories s WHERE s.id = b.id
  )) <> 1 THEN
    RAISE EXCEPTION 'rollback lost the category created with a group';
  END IF;
  IF (SELECT source FROM public.books WHERE id = 1) <> 'children.html'
     OR (SELECT source FROM public.books WHERE id = 2) <> 'romanlar.html'
     OR (SELECT price FROM public.books WHERE id = 2) <> 370
     OR (SELECT count(*) FROM public.books) <> (SELECT count(*) FROM stage136_books) THEN
    RAISE EXCEPTION 'rollback changed book rows';
  END IF;
  IF position('romanlar' IN public.list_public_book_categories()::text) = 0 THEN
    RAISE EXCEPTION 'rollback broke the public directory';
  END IF;
  BEGIN
    PERFORM public.admin_create_book_category(
      '13600000-0000-4000-8000-000000000031', 'يېڭى', 'six-arg-tur', '', '📚', 'literature'
    );
    RAISE EXCEPTION 'rolled-back create still accepted a group';
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;
END;
$$;

SELECT public.admin_create_book_category(
  '13600000-0000-4000-8000-000000000032', 'قايتۇرۇلغان', 'rollback-tur', '', '📚'
);

-- @stage136 restored
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
BEGIN
  IF (SELECT admin_group FROM public.book_categories WHERE slug = 'gruppa-tur') IS NOT NULL THEN
    RAISE EXCEPTION 'reapply guessed a group for an existing category';
  END IF;
  IF (SELECT admin_group FROM public.book_categories WHERE slug = 'rollback-tur') IS NOT NULL THEN
    RAISE EXCEPTION 'reapply guessed a group for a category created without one';
  END IF;
  IF (SELECT admin_group FROM public.book_categories WHERE slug = 'romanlar') IS NOT NULL THEN
    RAISE EXCEPTION 'reapply assigned a seeded category';
  END IF;
  IF (SELECT label FROM public.book_categories WHERE slug = 'rollback-tur') <> 'قايتۇرۇلغان' THEN
    RAISE EXCEPTION 'reapply lost the rollback-era category';
  END IF;
  IF (SELECT source FROM public.books WHERE id = 1) <> 'children.html'
     OR (SELECT source FROM public.books WHERE id = 4) <> 'children.html'
     OR (SELECT price FROM public.books WHERE id = 1) <> 10 THEN
    RAISE EXCEPTION 'reapply changed moved books';
  END IF;
  BEGIN
    PERFORM public.admin_create_book_category(
      '13600000-0000-4000-8000-000000000041', 'يېڭى', 'missing-group', '', '📚'
    );
    RAISE EXCEPTION 'missing group was accepted after reapply';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'invalid_admin_group' THEN
      RAISE;
    END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.book_categories WHERE slug = 'missing-group') THEN
    RAISE EXCEPTION 'missing group inserted a row after reapply';
  END IF;
END;
$$;

SELECT public.admin_create_book_category(
  '13600000-0000-4000-8000-000000000042', 'يېڭى گۇرۇپپا', 'yengi-gruppa', '', '📚', 'parenting'
);

DO $$
BEGIN
  IF (SELECT admin_group FROM public.book_categories WHERE slug = 'yengi-gruppa') <> 'parenting' THEN
    RAISE EXCEPTION 'reapplied create did not store the group';
  END IF;
  IF position('admin_group' IN public.list_public_book_categories()::text) > 0 THEN
    RAISE EXCEPTION 'storefront directory includes admin_group after reapply';
  END IF;
END;
$$;
