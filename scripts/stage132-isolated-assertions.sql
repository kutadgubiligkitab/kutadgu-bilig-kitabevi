-- Stage 132 isolated checks. The runner sets the admin JWT first.
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","aal":"aal2","role":"authenticated"}', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.books WHERE id = 3 AND source = 'other.html' AND category = 'Custom') <> 1 THEN
    RAISE EXCEPTION 'seed reclassified an unknown book';
  END IF;
  IF (SELECT source FROM public.books WHERE id = 1) <> 'universal.html' THEN
    RAISE EXCEPTION 'seed moved a universal book';
  END IF;
  IF (SELECT count(*) FROM public.book_categories) <> 18 THEN
    RAISE EXCEPTION 'seed count %', (SELECT count(*) FROM public.book_categories);
  END IF;
  IF (SELECT count(*) FROM public.book_categories) <> 18 THEN
    RAISE EXCEPTION 'seed was not idempotent';
  END IF;
END;
$$;

-- Applying the seed statement again must not change labels.
INSERT INTO public.book_categories (slug, source, label, summary, icon, sort_order)
VALUES ('romanlar', 'romanlar.html', 'CHANGED', '', '📚', 1)
ON CONFLICT (slug) DO NOTHING;
DO $$
BEGIN
  IF (SELECT label FROM public.book_categories WHERE slug = 'romanlar') <> 'رومانلار' THEN
    RAISE EXCEPTION 'seed overwrite changed a label';
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM public.admin_create_book_category('10000000-0000-4000-8000-000000000001', 'يېڭى', 'not an slug', '', '📚');
  RAISE EXCEPTION 'invalid slug was accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT IN ('invalid_category') THEN
    RAISE;
  END IF;
END;
$$;

SELECT public.admin_create_book_category(
  '10000000-0000-4000-8000-000000000002', 'يېڭى تۈر', 'yeni-tur', 'يېڭى قىسقىچە', '📚'
);

SELECT public.admin_rename_book_category(
  '10000000-0000-4000-8000-000000000003',
  (SELECT id FROM public.book_categories WHERE slug = 'romanlar'),
  1,
  'رومانلار يېڭى'
);

DO $$
DECLARE
  v_book public.books%ROWTYPE;
  v_group public.book_volume_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_book FROM public.books WHERE id = 2;
  IF v_book.source <> 'romanlar.html' OR v_book.category <> 'رومانلار يېڭى' OR v_book.price <> 370 OR v_book.stock <> 4 THEN
    RAISE EXCEPTION 'rename changed more than the label';
  END IF;
  IF (SELECT category FROM public.books WHERE id = 3) <> 'Custom' THEN
    RAISE EXCEPTION 'rename touched a different source';
  END IF;
  SELECT * INTO v_group FROM public.book_volume_groups WHERE id = 9;
  IF v_group.complete_set_price <> 750 OR v_group.slug <> 'series-holding' THEN
    RAISE EXCEPTION 'rename changed the group price or url';
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM public.admin_rename_book_category(
    '10000000-0000-4000-8000-000000000004',
    (SELECT id FROM public.book_categories WHERE slug = 'romanlar'),
    1,
    'قايتا'
  );
  RAISE EXCEPTION 'stale revision was accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'category_revision_conflict' THEN
    RAISE;
  END IF;
END;
$$;

SELECT public.admin_set_book_category_hidden(
  '10000000-0000-4000-8000-000000000005',
  (SELECT id FROM public.book_categories WHERE slug = 'tibb'),
  1,
  true
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.books WHERE source = 'tibb.html') <> 0 THEN
    RAISE EXCEPTION 'hide touched books';
  END IF;
  IF (SELECT jsonb_path_exists(public.list_public_book_categories(), '$.categories[*] ? (@.slug == "tibb")')) THEN
    RAISE EXCEPTION 'hidden category stayed public';
  END IF;
  IF NOT (SELECT jsonb_path_exists(public.list_public_book_categories(), '$.direct[*] ? (@.slug == "tibb" && @.is_hidden == true)')) THEN
    RAISE EXCEPTION 'hidden category lost its direct link';
  END IF;
  IF NOT (SELECT jsonb_path_exists(public.list_public_book_categories(), '$.categories[*] ? (@.slug == "romanlar")')) THEN
    RAISE EXCEPTION 'visible category disappeared';
  END IF;
END;
$$;

SELECT public.admin_set_book_category_hidden(
  '10000000-0000-4000-8000-000000000006',
  (SELECT id FROM public.book_categories WHERE slug = 'tibb'),
  (SELECT revision FROM public.book_categories WHERE slug = 'tibb'),
  false
);

SELECT public.admin_move_book_category_order(
  '10000000-0000-4000-8000-000000000007',
  (SELECT id FROM public.book_categories WHERE slug = 'taamlar'),
  (SELECT revision FROM public.book_categories WHERE slug = 'taamlar'),
  'up'
);

DO $$
DECLARE
  v_preview jsonb;
  v_ids bigint[];
  v_moved jsonb;
  v_book public.books%ROWTYPE;
BEGIN
  v_preview := public.admin_preview_book_category_move(
    ARRAY[1]::bigint[],
    (SELECT id FROM public.book_categories WHERE slug = 'children')
  );
  IF (v_preview->>'book_count')::int <> 2 OR (v_preview->>'group_count')::int <> 1 OR (v_preview->>'selected_book_count')::int <> 1 THEN
    RAISE EXCEPTION 'preview did not expand the volume group: %', v_preview;
  END IF;
  IF (v_preview->'destination'->>'label') <> 'بالىلار كىتابلىرى' OR (v_preview->'source'->>'source') <> 'universal.html' THEN
    RAISE EXCEPTION 'preview source or destination was wrong';
  END IF;
  SELECT array_agg(value::bigint ORDER BY value::bigint) INTO v_ids
  FROM jsonb_array_elements(v_preview->'book_ids') AS value;
  v_moved := public.admin_move_books_to_category(
    '10000000-0000-4000-8000-000000000008',
    ARRAY[1]::bigint[],
    (v_preview->'destination'->>'id')::bigint,
    v_ids
  );
  SELECT * INTO v_book FROM public.books WHERE id = 1;
  IF v_book.source <> 'children.html' OR v_book.category <> 'بالىلار كىتابلىرى' OR v_book.price <> 10 OR v_book.stock <> 3 OR v_book.is_active IS NOT FALSE OR v_book.submission_status <> 'pending' OR v_book.image_url <> '/cover-1.webp' THEN
    RAISE EXCEPTION 'move changed book identity or commerce fields';
  END IF;
  SELECT * INTO v_book FROM public.books WHERE id = 4;
  IF v_book.source <> 'children.html' OR v_book.id <> 4 OR v_book.price <> 8 THEN
    RAISE EXCEPTION 'expanded member was not moved intact';
  END IF;
  IF (SELECT source FROM public.book_volume_groups WHERE id = 9) <> 'children.html'
     OR (SELECT complete_set_price FROM public.book_volume_groups WHERE id = 9) <> 750
     OR (SELECT slug FROM public.book_volume_groups WHERE id = 9) <> 'series-holding' THEN
    RAISE EXCEPTION 'group url or price changed';
  END IF;
  IF (SELECT book_id FROM public.orders WHERE id = 70) <> 1 THEN
    RAISE EXCEPTION 'order history changed';
  END IF;
  v_preview := public.admin_preview_book_category_move(
    ARRAY[2]::bigint[],
    (SELECT id FROM public.book_categories WHERE slug = 'iqtisad')
  );
  IF (v_preview->'source'->>'source') <> 'romanlar.html'
     OR (v_preview->>'added_book_count')::int <> 0
     OR (v_preview->'origins'->0->>'label') <> 'رومانلار يېڭى' THEN
    RAISE EXCEPTION 'a non-universal category could not be previewed: %', v_preview;
  END IF;
  PERFORM public.admin_move_books_to_category(
    '10000000-0000-4000-8000-000000000018',
    ARRAY[2]::bigint[],
    (v_preview->'destination'->>'id')::bigint,
    ARRAY[2]::bigint[]
  );
  IF (SELECT source FROM public.books WHERE id = 2) <> 'iqtisad.html' OR (SELECT price FROM public.books WHERE id = 2) <> 370 THEN
    RAISE EXCEPTION 'moving a Romanlar book changed more than its category';
  END IF;
  PERFORM public.admin_move_books_to_category(
    '10000000-0000-4000-8000-000000000008',
    ARRAY[1]::bigint[],
    (v_preview->'destination'->>'id')::bigint,
    v_ids
  );
  IF (SELECT price FROM public.books WHERE id = 1) <> 10 THEN
    RAISE EXCEPTION 'retry changed the book';
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM public.admin_retire_book_category(
    '10000000-0000-4000-8000-000000000009',
    (SELECT id FROM public.book_categories WHERE slug = 'dictionary'),
    (SELECT revision FROM public.book_categories WHERE slug = 'dictionary'),
    (SELECT id FROM public.book_categories WHERE slug = 'grammar')
  );
  IF (SELECT count(*) FROM public.books WHERE source = 'dictionary.html') <> 0 THEN
    RAISE EXCEPTION 'empty check was wrong';
  END IF;
  IF NOT (SELECT jsonb_path_exists(public.list_public_book_categories(), '$.redirects[*] ? (@.slug == "dictionary" && @.target_slug == "grammar")')) THEN
    RAISE EXCEPTION 'retired url was not kept';
  END IF;
  BEGIN
    PERFORM public.admin_create_book_category('10000000-0000-4000-8000-000000000010', 'قايتا', 'dictionary', '', '📚');
    RAISE EXCEPTION 'retired slug was reused';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'slug_in_use' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_retire_book_category(
      '10000000-0000-4000-8000-000000000011',
      (SELECT id FROM public.book_categories WHERE slug = 'children'),
      (SELECT revision FROM public.book_categories WHERE slug = 'children'),
      (SELECT id FROM public.book_categories WHERE slug = 'grammar')
    );
    RAISE EXCEPTION 'occupied category was retired';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'category_not_empty' THEN
      RAISE;
    END IF;
  END;
END;
$$;

INSERT INTO public.books (id, title, author, category, source, price, stock, is_active, submission_status)
VALUES
  (5, 'Held', 'Author', 'ئۇنىۋېرسال', 'universal.html', 12, 6, true, 'approved'),
  (6, 'BOOM', 'Author', 'باشقا', 'three.html', 9, 7, false, 'draft');
INSERT INTO public.book_volume_groups (id, slug, title, category, source, complete_set_price, revision)
VALUES (10, 'series-boom', 'Boom set', 'ئۇنىۋېرسال', 'universal.html', 21, 1);
INSERT INTO public.book_volume_group_members (group_id, book_id, position)
VALUES (10, 5, 1), (10, 6, 2);

CREATE OR REPLACE FUNCTION public.stage132_boom()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.title = 'BOOM' THEN
    RAISE EXCEPTION 'boom';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS stage132_boom ON public.books;
CREATE TRIGGER stage132_boom BEFORE UPDATE ON public.books
FOR EACH ROW EXECUTE FUNCTION public.stage132_boom();

DO $$
BEGIN
  BEGIN
    PERFORM public.admin_move_books_to_category(
      '10000000-0000-4000-8000-000000000012',
      ARRAY[5]::bigint[],
      (SELECT id FROM public.book_categories WHERE slug = 'grammar'),
      ARRAY[5, 6]::bigint[]
    );
    RAISE EXCEPTION 'failed move was committed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'boom' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT source FROM public.books WHERE id = 5) <> 'universal.html'
     OR (SELECT source FROM public.books WHERE id = 6) <> 'three.html'
     OR (SELECT source FROM public.book_volume_groups WHERE id = 10) <> 'universal.html' THEN
    RAISE EXCEPTION 'failed move left a partial category change';
  END IF;
END;
$$;

DO $$
BEGIN
  UPDATE public.books SET source = 'dictionary.html', category = 'لۇغەت' WHERE id = 3;
  RAISE EXCEPTION 'a retired source accepted a later assignment';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'category_retired' THEN
    RAISE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage132_inject_retire()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = 'grammar.html' THEN
    UPDATE public.book_categories
    SET retired_at = now(),
        is_hidden = true,
        redirect_category_id = (SELECT id FROM public.book_categories WHERE slug = 'romanlar')
    WHERE slug = 'grammar'
      AND retired_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zzz_inject_retire ON public.books;
CREATE TRIGGER zzz_inject_retire
BEFORE UPDATE OF source ON public.books
FOR EACH ROW EXECUTE FUNCTION public.stage132_inject_retire();

DO $$
BEGIN
  BEGIN
    PERFORM public.admin_move_books_to_category(
      '10000000-0000-4000-8000-000000000019',
      ARRAY[3]::bigint[],
      (SELECT id FROM public.book_categories WHERE slug = 'grammar'),
      ARRAY[3]::bigint[]
    );
    RAISE EXCEPTION 'a destination retired during the move was committed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'category_retired' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT source FROM public.books WHERE id = 3) <> 'other.html'
     OR (SELECT retired_at FROM public.book_categories WHERE slug = 'grammar') IS NOT NULL THEN
    RAISE EXCEPTION 'the injected retirement left a partial assignment';
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS zzz_inject_retire ON public.books;

SET ROLE anon;
SELECT public.list_public_book_categories();
DO $$
BEGIN
  PERFORM public.admin_list_book_categories();
  RAISE EXCEPTION 'anon called an admin function';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","aal":"aal1"}', false);
DO $$
BEGIN
  PERFORM public.admin_list_book_categories();
  RAISE EXCEPTION 'aal1 admin call was accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Admin AAL2 required' THEN
    RAISE;
  END IF;
END;
$$;
