-- @stage137 applied
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
DECLARE
  v_public jsonb;
  v_created jsonb;
BEGIN
  IF (SELECT count(*) FROM public.book_categories) <> (SELECT count(*) FROM stage137_categories) THEN
    RAISE EXCEPTION 'stage137 changed the category count';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM stage137_categories AS before
    JOIN public.book_categories AS after ON after.id = before.id
    WHERE before.slug IS DISTINCT FROM after.slug
       OR before.source IS DISTINCT FROM after.source
       OR before.label IS DISTINCT FROM after.label
       OR before.summary IS DISTINCT FROM after.summary
       OR before.revision IS DISTINCT FROM after.revision
  ) THEN
    RAISE EXCEPTION 'stage137 rewrote category identity';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM stage137_books AS before
    JOIN public.books AS after ON after.id = before.id
    WHERE before.source IS DISTINCT FROM after.source
       OR before.category IS DISTINCT FROM after.category
       OR before.price IS DISTINCT FROM after.price
       OR before.stock IS DISTINCT FROM after.stock
  ) OR (SELECT count(*) FROM public.books) <> (SELECT count(*) FROM stage137_books) THEN
    RAISE EXCEPTION 'stage137 rewrote books';
  END IF;
  IF (SELECT admin_group FROM public.book_categories WHERE slug = 'children') <> 'family'
     OR (SELECT admin_group FROM public.book_categories WHERE slug = 'terbiye') <> 'family'
     OR (SELECT admin_group FROM public.book_categories WHERE slug = 'derslik') <> 'language'
     OR (SELECT admin_group FROM public.book_categories WHERE slug = 'romanlar') <> 'literature' THEN
    RAISE EXCEPTION 'stage137 group mapping mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.book_categories WHERE admin_group IN ('children', 'parenting', 'textbooks')) THEN
    RAISE EXCEPTION 'stage137 left an old group key';
  END IF;

  v_public := public.list_public_book_categories();
  IF (v_public->'categories'->0) ? 'admin_group'
     OR NOT ((v_public->'categories'->0) ? 'group_key') THEN
    RAISE EXCEPTION 'public list exposed the wrong group field';
  END IF;
  IF (
    SELECT value->>'group_key'
    FROM jsonb_array_elements(v_public->'categories') AS value
    WHERE value->>'slug' = 'romanlar'
  ) IS DISTINCT FROM 'literature' THEN
    RAISE EXCEPTION 'public literature group_key missing';
  END IF;
  IF (
    SELECT value->>'group_key'
    FROM jsonb_array_elements(v_public->'categories') AS value
    WHERE value->>'slug' = 'children'
  ) IS DISTINCT FROM 'family' THEN
    RAISE EXCEPTION 'public family group_key missing';
  END IF;

  BEGIN
    PERFORM public.admin_create_book_category(
      '13700000-0000-4000-8000-000000000001'::uuid,
      'بولماسلىق', 'bolmasliq', '', '📚', 'children'
    );
    RAISE EXCEPTION 'old children key was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%invalid_admin_group%' THEN
      RAISE;
    END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.book_categories WHERE slug = 'bolmasliq') THEN
    RAISE EXCEPTION 'rejected create inserted a category';
  END IF;

  v_created := public.admin_create_book_category(
    '13700000-0000-4000-8000-000000000002'::uuid,
    'يېڭى ئەدەبىيات', 'yengi-edebiyat', '', '📚', 'literature'
  );
  IF v_created->>'admin_group' IS DISTINCT FROM 'literature' THEN
    RAISE EXCEPTION 'create did not keep literature';
  END IF;
  IF (
    SELECT value->>'group_key'
    FROM jsonb_array_elements(public.list_public_book_categories()->'categories') AS value
    WHERE value->>'slug' = 'yengi-edebiyat'
  ) IS DISTINCT FROM 'literature' THEN
    RAISE EXCEPTION 'new category has no public literature group';
  END IF;
END;
$$;

-- @stage137 rolled
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
DECLARE
  v_public jsonb;
BEGIN
  IF (SELECT admin_group FROM public.book_categories WHERE slug = 'romanlar') IS DISTINCT FROM 'literature' THEN
    RAISE EXCEPTION 'rollback cleared literature';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.book_categories
    WHERE slug IN ('children', 'terbiye', 'derslik')
      AND admin_group IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'rollback kept an unmappable group';
  END IF;
  IF (SELECT count(*) FROM public.books) <> (SELECT count(*) FROM stage137_books) THEN
    RAISE EXCEPTION 'rollback changed books';
  END IF;
  v_public := public.list_public_book_categories();
  IF (v_public->'categories'->0) ? 'group_key'
     OR (v_public->'categories'->0) ? 'admin_group' THEN
    RAISE EXCEPTION 'rollback public list still exposes a group';
  END IF;
  BEGIN
    PERFORM public.admin_create_book_category(
      '13700000-0000-4000-8000-000000000003'::uuid,
      'بولماسلىق', 'bolmasliq-2', '', '📚', 'family'
    );
    RAISE EXCEPTION 'rollback accepted family';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%invalid_admin_group%' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- @stage137 restored
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
BEGIN
  IF (
    SELECT value->>'group_key'
    FROM jsonb_array_elements(public.list_public_book_categories()->'categories') AS value
    WHERE value->>'slug' = 'yengi-edebiyat'
  ) IS DISTINCT FROM 'literature' THEN
    RAISE EXCEPTION 'reapply lost the public literature group';
  END IF;
  IF (
    SELECT value->>'group_key'
    FROM jsonb_array_elements(public.list_public_book_categories()->'categories') AS value
    WHERE value->>'slug' = 'romanlar'
  ) IS DISTINCT FROM 'literature' THEN
    RAISE EXCEPTION 'reapply lost the stored literature group';
  END IF;
  IF EXISTS (SELECT 1 FROM public.book_categories WHERE slug = 'bolmasliq' OR slug = 'bolmasliq-2') THEN
    RAISE EXCEPTION 'rejected keys inserted rows';
  END IF;
END;
$$;
