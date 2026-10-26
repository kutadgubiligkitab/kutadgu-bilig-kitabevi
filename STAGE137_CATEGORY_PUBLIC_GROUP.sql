-- Stage 137 — public category group for categories created in Admin.
-- MANUAL / REVIEWED APPLY ONLY. Do not run from the application or CI.
-- Do not edit STAGE136_CATEGORY_ADMIN_GROUP.sql. That migration is already applied.
--
-- The stored book_categories.admin_group value stays the source. Its allowed
-- keys become the six groups the public category navigation already shows:
-- literature, religion, history, language, family, knowledge.
-- Old Stage 136 keys are mapped before the new check is installed:
-- children and parenting become family, textbooks becomes language.
-- literature, religion, and history stay. Null stays null.
-- Category identity, books, volume groups, prices, stock, orders, and URLs
-- are not rewritten.
--
-- list_public_book_categories gains group_key only. It does not return
-- admin_group or other admin-only fields. An unrecognized stored value
-- becomes a null group_key.
--
-- Rollback is STAGE137_CATEGORY_PUBLIC_GROUP_ROLLBACK.sql.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.book_categories') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'book_categories'
         AND column_name = 'admin_group'
     )
     OR to_regprocedure('public.admin_create_book_category(uuid,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.list_public_book_categories()') IS NULL THEN
    RAISE EXCEPTION 'stage137_preflight_failed'
      USING ERRCODE = '55000',
            DETAIL = 'Stage 136 admin_group and the public category list are required';
  END IF;
END;
$$;

ALTER TABLE public.book_categories
  DROP CONSTRAINT IF EXISTS book_categories_admin_group_chk;

UPDATE public.book_categories
SET admin_group = CASE admin_group
  WHEN 'children' THEN 'family'
  WHEN 'parenting' THEN 'family'
  WHEN 'textbooks' THEN 'language'
  ELSE admin_group
END
WHERE admin_group IN ('children', 'parenting', 'textbooks');

ALTER TABLE public.book_categories
  ADD CONSTRAINT book_categories_admin_group_chk
  CHECK (
    admin_group IS NULL
    OR admin_group IN (
      'literature', 'religion', 'history', 'language', 'family', 'knowledge'
    )
  );

CREATE OR REPLACE FUNCTION public.list_public_book_categories()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $public_categories$
  SELECT jsonb_build_object(
    'categories', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'slug', c.slug,
        'source', c.source,
        'label', c.label,
        'summary', c.summary,
        'icon', c.icon,
        'sort_order', c.sort_order,
        'group_key', CASE
          WHEN c.admin_group IN ('literature', 'religion', 'history', 'language', 'family', 'knowledge')
          THEN c.admin_group
          ELSE NULL
        END
      ) ORDER BY c.sort_order, c.id)
      FROM public.book_categories AS c
      WHERE c.retired_at IS NULL AND c.is_hidden IS FALSE
    ), '[]'::jsonb),
    'direct', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'slug', c.slug,
        'source', c.source,
        'label', c.label,
        'summary', c.summary,
        'icon', c.icon,
        'sort_order', c.sort_order,
        'is_hidden', c.is_hidden,
        'group_key', CASE
          WHEN c.admin_group IN ('literature', 'religion', 'history', 'language', 'family', 'knowledge')
          THEN c.admin_group
          ELSE NULL
        END
      ) ORDER BY c.sort_order, c.id)
      FROM public.book_categories AS c
      WHERE c.retired_at IS NULL
    ), '[]'::jsonb),
    'redirects', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', c.slug,
        'source', c.source,
        'target_slug', dest.slug,
        'target_source', dest.source
      ) ORDER BY c.slug)
      FROM public.book_categories AS c
      JOIN public.book_categories AS dest ON dest.id = c.redirect_category_id
      WHERE c.retired_at IS NOT NULL
        AND dest.retired_at IS NULL
    ), '[]'::jsonb)
  );
$public_categories$;

CREATE OR REPLACE FUNCTION public.admin_create_book_category(
  p_request_id uuid,
  p_label text,
  p_slug text,
  p_summary text DEFAULT '',
  p_icon text DEFAULT '📚',
  p_admin_group text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_create_category$
DECLARE
  v_saved jsonb;
  v_label text := btrim(coalesce(p_label, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_summary text := btrim(coalesce(p_summary, ''));
  v_icon text := btrim(coalesce(p_icon, ''));
  v_group text := btrim(coalesce(p_admin_group, ''));
  v_id bigint;
  v_order integer;
  v_result jsonb;
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = '22023';
  END IF;
  SELECT result INTO v_saved
  FROM public.book_category_operations
  WHERE request_id = p_request_id;
  IF FOUND THEN
    RETURN v_saved;
  END IF;
  IF char_length(v_label) < 1 OR char_length(v_label) > 80
     OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     OR v_slug IN (
       'adabiyat', 'books', 'book', 'cart', 'admin', 'author', 'translator',
       'publisher', 'api', 'sitemap', 'order-info', 'privacy', 'returns',
       'delete-account', 'feedback', 'account', 'favorites', 'my-books', 'search'
     ) THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_summary) > 240 THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF v_icon = '' THEN
    v_icon := '📚';
  END IF;
  IF char_length(v_icon) > 16 THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF v_group NOT IN (
    'literature', 'religion', 'history', 'language', 'family', 'knowledge'
  ) THEN
    RAISE EXCEPTION 'invalid_admin_group' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.book_categories
    WHERE slug = v_slug OR source = v_slug || '.html'
  ) THEN
    RAISE EXCEPTION 'slug_in_use' USING ERRCODE = '23505';
  END IF;
  SELECT coalesce(max(sort_order), 0) + 10 INTO v_order FROM public.book_categories;
  INSERT INTO public.book_categories (slug, source, label, summary, icon, sort_order, admin_group)
  VALUES (v_slug, v_slug || '.html', v_label, v_summary, v_icon, v_order, v_group)
  RETURNING id INTO v_id;
  v_result := jsonb_build_object(
    'id', v_id,
    'slug', v_slug,
    'source', v_slug || '.html',
    'label', v_label,
    'sort_order', v_order,
    'revision', 1,
    'admin_group', v_group
  );
  INSERT INTO public.book_category_operations (request_id, result)
  VALUES (p_request_id, v_result);
  RETURN v_result;
END;
$admin_create_category$;

REVOKE ALL ON FUNCTION public.list_public_book_categories()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_book_category(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_public_book_categories() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_book_category(uuid, text, text, text, text, text) TO authenticated;

COMMIT;
