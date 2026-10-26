-- Stage 136 — admin-only primary group for book categories.
-- MANUAL / REVIEWED APPLY ONLY. Do not run from the application, CI, or this
-- change set.
--
-- Adds nullable book_categories.admin_group and teaches the admin list and
-- create functions about it. The value is one of the six stable keys already
-- used by app-config.js discoveryGroups: literature, history, religion,
-- children, parenting, textbooks. Those discovery groups stay a storefront
-- display list. This column is not a parent category, not a many-to-many
-- link, and is not read by list_public_book_categories.
--
-- Existing rows stay unassigned. Some current categories appear in more than
-- one discovery group, and others appear in none, so this file does not guess
-- a primary group and does not update books, volume groups, prices, stock,
-- flags, or orders.
--
-- Rollback is STAGE136_CATEGORY_ADMIN_GROUP_ROLLBACK.sql. It restores the
-- Stage 132 list and create functions and drops only this column. Category
-- rows, redirects, and book or group source and label values stay.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.book_categories') IS NULL
     OR to_regclass('public.book_category_operations') IS NULL
     OR (
       to_regprocedure('public.admin_create_book_category(uuid,text,text,text,text)') IS NULL
       AND to_regprocedure('public.admin_create_book_category(uuid,text,text,text,text,text)') IS NULL
     ) THEN
    RAISE EXCEPTION 'stage136_preflight_failed'
      USING ERRCODE = '55000',
            DETAIL = 'Stage 132 book_categories and admin_create_book_category are required';
  END IF;
END;
$$;

ALTER TABLE public.book_categories
  ADD COLUMN IF NOT EXISTS admin_group text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'book_categories_admin_group_chk'
      AND conrelid = 'public.book_categories'::regclass
  ) THEN
    ALTER TABLE public.book_categories
      ADD CONSTRAINT book_categories_admin_group_chk
      CHECK (
        admin_group IS NULL
        OR admin_group IN (
          'literature', 'history', 'religion', 'children', 'parenting', 'textbooks'
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_book_categories()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_list_categories$
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'source', c.source,
      'label', c.label,
      'summary', c.summary,
      'icon', c.icon,
      'sort_order', c.sort_order,
      'is_hidden', c.is_hidden,
      'retired', c.retired_at IS NOT NULL,
      'redirect_category_id', c.redirect_category_id,
      'revision', c.revision,
      'admin_group', c.admin_group,
      'book_count', (
        SELECT count(*) FROM public.books AS b WHERE b.source = c.source
      ),
      'group_count', (
        SELECT count(*) FROM public.book_volume_groups AS g WHERE g.source = c.source
      )
    ) ORDER BY c.sort_order, c.id)
    FROM public.book_categories AS c
  ), '[]'::jsonb);
END;
$admin_list_categories$;

DROP FUNCTION IF EXISTS public.admin_create_book_category(uuid, text, text, text, text);

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
    'literature', 'history', 'religion', 'children', 'parenting', 'textbooks'
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

REVOKE ALL ON FUNCTION public.admin_list_book_categories()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_book_category(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_book_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_book_category(uuid, text, text, text, text, text) TO authenticated;

COMMIT;
