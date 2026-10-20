-- Stage 127 — multi-volume group foundation.
-- MANUAL / REVIEWED APPLY ONLY. Do not run from the application or CI.
-- This migration is additive and does not link, rewrite, or delete any book.
-- Public catalog exposure defaults off for every group. Stage 128 adds commerce
-- quotes and set order support; the storefront must not expose groups before the
-- complete application flow is released.
--
-- Server limits:
--   * 2..100 ordered member volumes per group
--   * one group per existing books.id
--   * positions are contiguous 1..N
--
-- Data-preserving rollback: STAGE127_BOOK_VOLUME_GROUPS_ROLLBACK.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.book_volume_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  author text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  complete_set_price numeric(12,2),
  representative_book_id bigint REFERENCES public.books(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT book_volume_groups_slug_format CHECK (
    slug IS NULL OR slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT book_volume_groups_complete_set_price_check CHECK (
    complete_set_price IS NULL OR complete_set_price >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS book_volume_groups_slug_uidx
  ON public.book_volume_groups (slug)
  WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.book_volume_group_members (
  group_id bigint NOT NULL REFERENCES public.book_volume_groups(id) ON DELETE RESTRICT,
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 100),
  volume_label text NOT NULL DEFAULT '' CHECK (char_length(volume_label) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, book_id),
  CONSTRAINT book_volume_group_members_group_position_key UNIQUE (group_id, position),
  CONSTRAINT book_volume_group_members_book_key UNIQUE (book_id)
);

CREATE INDEX IF NOT EXISTS book_volume_group_members_group_order_idx
  ON public.book_volume_group_members (group_id, position, book_id);

COMMENT ON TABLE public.book_volume_groups IS
  'One public catalog identity for ordered existing book rows. is_public defaults false.';
COMMENT ON TABLE public.book_volume_group_members IS
  'Ordered membership only. Linking never rewrites the referenced books row.';
COMMENT ON COLUMN public.book_volume_groups.complete_set_price IS
  'Explicit complete-set price. NULL means sum current member prices at quote time.';
COMMENT ON COLUMN public.book_volume_groups.representative_book_id IS
  'Cover source chosen by admin. Must be a member; defaults to position 1 in the admin RPC.';
COMMENT ON COLUMN public.book_volume_groups.revision IS
  'Optimistic mutation revision. Quote revision additionally includes effective member prices.';

ALTER TABLE public.book_volume_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_volume_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.book_volume_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_volume_group_members FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.book_volume_groups FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.book_volume_group_members FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.book_volume_groups_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kutadgu_book_volume_quote_revision(p_group_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $revision$
  SELECT md5(
    concat_ws(
      '|',
      g.id::text,
      g.revision::text,
      coalesce(g.complete_set_price::text, 'sum'),
      coalesce(
        string_agg(
          concat_ws(
            ':',
            m.position::text,
            m.book_id::text,
            CASE WHEN g.complete_set_price IS NULL THEN coalesce(b.price::text, 'null') ELSE 'explicit' END
          ),
          ',' ORDER BY m.position
        ),
        ''
      )
    )
  )
  FROM public.book_volume_groups AS g
  LEFT JOIN public.book_volume_group_members AS m ON m.group_id = g.id
  LEFT JOIN public.books AS b ON b.id = m.book_id
  WHERE g.id = p_group_id
  GROUP BY g.id, g.revision, g.complete_set_price;
$revision$;

REVOKE ALL ON FUNCTION public.kutadgu_book_volume_quote_revision(bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_book_volume_group(p_group_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $public_group$
  SELECT jsonb_build_object(
    'id', g.id,
    'slug', g.slug,
    'title', g.title,
    'author', g.author,
    'category', g.category,
    'source', g.source,
    'description', g.description,
    'complete_set_price', g.complete_set_price,
    'representative_book_id', coalesce(
      g.representative_book_id,
      (SELECT first_m.book_id
       FROM public.book_volume_group_members AS first_m
       WHERE first_m.group_id = g.id
       ORDER BY first_m.position
       LIMIT 1)
    ),
    'revision', g.revision,
    'quote_revision', public.kutadgu_book_volume_quote_revision(g.id),
    'members', jsonb_agg(
      jsonb_build_object(
        'book_id', b.id,
        'position', m.position,
        'volume_label', m.volume_label,
        'title', b.title,
        'author', b.author,
        'price', b.price,
        'image_url', b.image_url,
        'stock', b.stock,
        'stock_status', b.stock_status,
        'is_active', b.is_active
      )
      ORDER BY m.position
    )
  )
  FROM public.book_volume_groups AS g
  JOIN public.book_volume_group_members AS m ON m.group_id = g.id
  JOIN public.books AS b ON b.id = m.book_id
  WHERE g.id = p_group_id
    AND g.is_public
    AND g.is_active
    AND b.is_active
    AND b.submission_status = 'approved'
  GROUP BY g.id
  HAVING count(*) BETWEEN 2 AND 100
     AND count(*) = (SELECT count(*) FROM public.book_volume_group_members AS all_m WHERE all_m.group_id = g.id);
$public_group$;

REVOKE ALL ON FUNCTION public.get_public_book_volume_group(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_book_volume_group(bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_book_volume_group(p_group_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_get$
DECLARE
  v_result jsonb;
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', g.id,
    'slug', g.slug,
    'title', g.title,
    'author', g.author,
    'category', g.category,
    'source', g.source,
    'description', g.description,
    'complete_set_price', g.complete_set_price,
    'representative_book_id', g.representative_book_id,
    'is_active', g.is_active,
    'is_public', g.is_public,
    'revision', g.revision,
    'quote_revision', public.kutadgu_book_volume_quote_revision(g.id),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'book_id', b.id,
        'position', m.position,
        'volume_label', m.volume_label,
        'title', b.title,
        'author', b.author,
        'price', b.price,
        'stock', b.stock,
        'stock_status', b.stock_status,
        'image_url', b.image_url,
        'is_active', b.is_active
      ) ORDER BY m.position)
      FROM public.book_volume_group_members AS m
      JOIN public.books AS b ON b.id = m.book_id
      WHERE m.group_id = g.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.book_volume_groups AS g
  WHERE g.id = p_group_id;

  RETURN v_result;
END;
$admin_get$;

CREATE OR REPLACE FUNCTION public.admin_list_book_volume_groups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_list$
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id,
      'slug', g.slug,
      'title', g.title,
      'complete_set_price', g.complete_set_price,
      'representative_book_id', g.representative_book_id,
      'is_active', g.is_active,
      'is_public', g.is_public,
      'revision', g.revision,
      'member_count', (SELECT count(*) FROM public.book_volume_group_members AS m WHERE m.group_id = g.id)
    ) ORDER BY g.updated_at DESC, g.id DESC)
    FROM public.book_volume_groups AS g
  ), '[]'::jsonb);
END;
$admin_list$;

CREATE OR REPLACE FUNCTION public.admin_save_book_volume_group(
  p_group_id bigint,
  p_expected_revision bigint,
  p_group jsonb,
  p_members jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_save$
DECLARE
  v_id bigint;
  v_current_revision bigint;
  v_new_revision bigint;
  v_member_count integer;
  v_representative bigint;
  v_member jsonb;
  v_book_id bigint;
  v_position integer;
  v_label text;
  v_title text;
  v_slug text;
  v_price numeric(12,2);
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_group IS NULL OR jsonb_typeof(p_group) <> 'object'
     OR p_members IS NULL OR jsonb_typeof(p_members) <> 'array' THEN
    RAISE EXCEPTION 'invalid_volume_group_payload' USING ERRCODE = '22023';
  END IF;

  v_member_count := jsonb_array_length(p_members);
  IF v_member_count < 2 OR v_member_count > 100 THEN
    RAISE EXCEPTION 'invalid_volume_count' USING ERRCODE = '22023',
      DETAIL = 'member_count=' || v_member_count::text;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_members) AS elem(value)
    WHERE jsonb_typeof(elem.value) <> 'object'
       OR coalesce(elem.value->>'book_id', '') !~ '^[1-9][0-9]*$'
       OR coalesce(elem.value->>'position', '') !~ '^[1-9][0-9]*$'
       OR (elem.value->>'position')::integer > 100
       OR char_length(coalesce(elem.value->>'volume_label', '')) > 120
  ) THEN
    RAISE EXCEPTION 'invalid_volume_member' USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(DISTINCT (elem.value->>'book_id')::bigint)
    FROM jsonb_array_elements(p_members) AS elem(value)
  ) <> v_member_count THEN
    RAISE EXCEPTION 'duplicate_volume_book' USING ERRCODE = '23505';
  END IF;
  IF (
    SELECT count(DISTINCT (elem.value->>'position')::integer)
    FROM jsonb_array_elements(p_members) AS elem(value)
  ) <> v_member_count THEN
    RAISE EXCEPTION 'duplicate_volume_position' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM generate_series(1, v_member_count) AS expected(position)
    LEFT JOIN jsonb_array_elements(p_members) AS elem(value)
      ON (elem.value->>'position')::integer = expected.position
    WHERE elem.value IS NULL
  ) THEN
    RAISE EXCEPTION 'non_contiguous_volume_positions' USING ERRCODE = '22023';
  END IF;

  v_title := btrim(coalesce(p_group->>'title', ''));
  v_slug := nullif(lower(btrim(coalesce(p_group->>'slug', ''))), '');
  IF char_length(v_title) < 1 OR char_length(v_title) > 500 THEN
    RAISE EXCEPTION 'invalid_volume_group_title' USING ERRCODE = '22023';
  END IF;
  IF v_slug IS NOT NULL AND v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid_volume_group_slug' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_price := nullif(btrim(coalesce(p_group->>'complete_set_price', '')), '')::numeric(12,2);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_complete_set_price' USING ERRCODE = '22023';
  END;
  IF v_price IS NOT NULL AND v_price < 0 THEN
    RAISE EXCEPTION 'invalid_complete_set_price' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.books AS b
  JOIN (
    SELECT (elem.value->>'book_id')::bigint AS book_id
    FROM jsonb_array_elements(p_members) AS elem(value)
  ) AS wanted ON wanted.book_id = b.id
  ORDER BY b.id
  FOR UPDATE OF b;
  IF NOT FOUND OR (
    SELECT count(*)
    FROM public.books AS b
    WHERE b.id IN (
      SELECT (elem.value->>'book_id')::bigint
      FROM jsonb_array_elements(p_members) AS elem(value)
    )
  ) <> v_member_count THEN
    RAISE EXCEPTION 'volume_book_not_found' USING ERRCODE = '23503';
  END IF;

  IF p_group_id IS NULL THEN
    IF p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'unexpected_volume_group_revision' USING ERRCODE = '40001';
    END IF;
    INSERT INTO public.book_volume_groups (
      slug, title, author, category, source, description, complete_set_price,
      representative_book_id, is_active, is_public
    ) VALUES (
      v_slug,
      v_title,
      left(btrim(coalesce(p_group->>'author', '')), 500),
      left(btrim(coalesce(p_group->>'category', '')), 200),
      left(btrim(coalesce(p_group->>'source', '')), 300),
      left(btrim(coalesce(p_group->>'description', '')), 10000),
      v_price,
      NULL,
      coalesce((p_group->>'is_active')::boolean, true),
      false
    )
    RETURNING id, revision INTO v_id, v_new_revision;
  ELSE
    SELECT revision INTO v_current_revision
    FROM public.book_volume_groups
    WHERE id = p_group_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'volume_group_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_revision IS NULL OR p_expected_revision <> v_current_revision THEN
      RAISE EXCEPTION 'stale_volume_group_revision' USING ERRCODE = '40001',
        DETAIL = 'expected=' || coalesce(p_expected_revision::text, 'null') ||
                 ' current=' || v_current_revision::text;
    END IF;
    v_id := p_group_id;
    UPDATE public.book_volume_groups
    SET slug = v_slug,
        title = v_title,
        author = left(btrim(coalesce(p_group->>'author', '')), 500),
        category = left(btrim(coalesce(p_group->>'category', '')), 200),
        source = left(btrim(coalesce(p_group->>'source', '')), 300),
        description = left(btrim(coalesce(p_group->>'description', '')), 10000),
        complete_set_price = v_price,
        is_active = coalesce((p_group->>'is_active')::boolean, true),
        is_public = false,
        revision = revision + 1,
        updated_at = now()
    WHERE id = v_id
    RETURNING revision INTO v_new_revision;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.book_volume_group_members AS existing
    JOIN jsonb_array_elements(p_members) AS elem(value)
      ON existing.book_id = (elem.value->>'book_id')::bigint
    WHERE existing.group_id <> v_id
  ) THEN
    RAISE EXCEPTION 'volume_already_grouped' USING ERRCODE = '23505';
  END IF;

  DELETE FROM public.book_volume_group_members WHERE group_id = v_id;
  FOR v_member IN SELECT value FROM jsonb_array_elements(p_members) LOOP
    v_book_id := (v_member->>'book_id')::bigint;
    v_position := (v_member->>'position')::integer;
    v_label := left(btrim(coalesce(v_member->>'volume_label', '')), 120);
    INSERT INTO public.book_volume_group_members (group_id, book_id, position, volume_label)
    VALUES (v_id, v_book_id, v_position, v_label);
  END LOOP;

  BEGIN
    v_representative := nullif(btrim(coalesce(p_group->>'representative_book_id', '')), '')::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_representative_volume' USING ERRCODE = '22023';
  END;
  IF v_representative IS NULL THEN
    SELECT book_id INTO v_representative
    FROM public.book_volume_group_members
    WHERE group_id = v_id AND position = 1;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_volume_group_members
    WHERE group_id = v_id AND book_id = v_representative
  ) THEN
    RAISE EXCEPTION 'representative_not_a_member' USING ERRCODE = '22023';
  END IF;
  UPDATE public.book_volume_groups
  SET representative_book_id = v_representative, updated_at = now()
  WHERE id = v_id;

  RETURN public.admin_get_book_volume_group(v_id);
END;
$admin_save$;

REVOKE ALL ON FUNCTION public.admin_get_book_volume_group(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_book_volume_groups() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_save_book_volume_group(bigint, bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_book_volume_group(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_book_volume_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_book_volume_group(bigint, bigint, jsonb, jsonb) TO authenticated;

COMMIT;
