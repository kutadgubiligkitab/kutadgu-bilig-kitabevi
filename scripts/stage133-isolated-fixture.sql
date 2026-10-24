-- Throwaway schema shaped like production public.books. Never production.
-- There is no address, language, or publish_date column. publish_year and pages
-- are nullable integers. isbn is NOT NULL text and defaults to ''.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id) VALUES
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY
);
INSERT INTO public.admin_users (user_id)
VALUES ('22222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_kutadgu_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) $$;
REVOKE ALL ON FUNCTION public.is_kutadgu_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_kutadgu_admin() TO authenticated;

CREATE TABLE public.books (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  author text,
  category text,
  price numeric NOT NULL DEFAULT 0,
  image_url text,
  description text,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'universal.html',
  is_active boolean NOT NULL DEFAULT true,
  is_new boolean NOT NULL DEFAULT false,
  isbn text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  gallery_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  translator text,
  publisher text,
  publish_year integer,
  pages integer,
  original_price numeric,
  stock integer NOT NULL DEFAULT 0,
  submission_status text NOT NULL DEFAULT 'approved',
  CONSTRAINT books_publish_year_chk CHECK (publish_year IS NULL OR publish_year BETWEEN 1000 AND 2100),
  CONSTRAINT books_pages_chk CHECK (pages IS NULL OR pages >= 1),
  CONSTRAINT books_original_price_chk CHECK (original_price IS NULL OR original_price >= 0),
  CONSTRAINT books_stock_chk CHECK (stock >= 0),
  CONSTRAINT books_submission_status_chk CHECK (submission_status IN ('approved', 'pending', 'rejected', 'series_draft')),
  CONSTRAINT books_gallery_images_chk CHECK (jsonb_typeof(gallery_images) = 'array' AND jsonb_array_length(gallery_images) <= 4)
);

CREATE TABLE public.book_categories (
  source text PRIMARY KEY,
  label text NOT NULL,
  retired_at timestamptz
);
INSERT INTO public.book_categories (source, label, retired_at) VALUES
  ('tarikhiy-romanlar.html', 'تارىخىي رومانلار', NULL),
  ('retired.html', 'يوشۇرۇن', now());

CREATE OR REPLACE FUNCTION public.book_categories_guard_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $guard_source$
DECLARE
  v_retired timestamptz;
  v_label text;
BEGIN
  IF NEW.source IS NULL OR btrim(NEW.source) = '' THEN
    RETURN NEW;
  END IF;
  SELECT retired_at, label INTO v_retired, v_label
  FROM public.book_categories
  WHERE source = NEW.source
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_retired IS NOT NULL THEN
    RAISE EXCEPTION 'category_retired' USING ERRCODE = '55000';
  END IF;
  NEW.category := v_label;
  RETURN NEW;
END;
$guard_source$;

CREATE TRIGGER zzz_book_categories_books_source_guard
BEFORE INSERT OR UPDATE OF source, category ON public.books
FOR EACH ROW EXECUTE FUNCTION public.book_categories_guard_source();

CREATE TABLE public.credit_sync_log (
  book_id bigint NOT NULL,
  role text NOT NULL,
  value text
);

CREATE OR REPLACE FUNCTION public.catalog_sync_role_from_legacy(
  p_book_id bigint, p_role text, p_old text, p_new text
) RETURNS void
LANGUAGE plpgsql
AS $sync_role$
BEGIN
  IF nullif(btrim(coalesce(p_new, '')), '') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.credit_sync_log (book_id, role, value)
  VALUES (p_book_id, lower(btrim(p_role)), btrim(p_new));
END;
$sync_role$;

CREATE OR REPLACE FUNCTION public.books_catalog_credits_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $credits_sync$
BEGIN
  IF coalesce(current_setting('kutadgu.credit_write', true), '') = 'explicit' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.catalog_sync_role_from_legacy(NEW.id, 'author', NULL, NEW.author);
    PERFORM public.catalog_sync_role_from_legacy(NEW.id, 'translator', NULL, NEW.translator);
    PERFORM public.catalog_sync_role_from_legacy(NEW.id, 'publisher', NULL, NEW.publisher);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$credits_sync$;

CREATE TRIGGER books_catalog_credits_sync
AFTER INSERT OR UPDATE OF author, translator, publisher ON public.books
FOR EACH ROW EXECUTE FUNCTION public.books_catalog_credits_sync();

CREATE TABLE public.book_volume_groups (
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

CREATE TABLE public.book_volume_group_members (
  group_id bigint NOT NULL REFERENCES public.book_volume_groups(id) ON DELETE RESTRICT,
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 100),
  volume_label text NOT NULL DEFAULT '' CHECK (char_length(volume_label) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, book_id),
  CONSTRAINT book_volume_group_members_group_position_key UNIQUE (group_id, position),
  CONSTRAINT book_volume_group_members_book_key UNIQUE (book_id)
);

CREATE TRIGGER zzz_book_categories_groups_source_guard
BEFORE INSERT OR UPDATE OF source, category ON public.book_volume_groups
FOR EACH ROW EXECUTE FUNCTION public.book_categories_guard_source();

CREATE TABLE public.book_volume_series_requests (
  request_id uuid PRIMARY KEY,
  payload_sha256 text NOT NULL,
  group_id bigint REFERENCES public.book_volume_groups(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.kutadgu_book_volume_quote_revision(p_group_id bigint)
RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT 1::bigint $$;

CREATE OR REPLACE FUNCTION public.admin_get_book_volume_group(p_group_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
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
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'book_id', b.id,
        'position', m.position,
        'volume_label', m.volume_label,
        'title', b.title,
        'price', b.price,
        'stock', b.stock,
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

CREATE OR REPLACE FUNCTION public.admin_save_book_volume_group(
  p_group_id bigint,
  p_expected_revision bigint,
  p_group jsonb,
  p_members jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_save$
DECLARE
  v_id bigint;
  v_member jsonb;
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'stage133 fixture saves a new series only' USING ERRCODE = '0A000';
  END IF;
  INSERT INTO public.book_volume_groups (
    slug, title, author, category, source, description, complete_set_price,
    representative_book_id, is_active, is_public
  ) VALUES (
    p_group->>'slug',
    p_group->>'title',
    left(btrim(coalesce(p_group->>'author', '')), 500),
    left(btrim(coalesce(p_group->>'category', '')), 200),
    left(btrim(coalesce(p_group->>'source', '')), 300),
    left(btrim(coalesce(p_group->>'description', '')), 10000),
    nullif(p_group->>'complete_set_price', '')::numeric(12,2),
    NULL,
    coalesce((p_group->>'is_active')::boolean, true),
    false
  )
  RETURNING id INTO v_id;
  FOR v_member IN SELECT value FROM jsonb_array_elements(p_members) LOOP
    INSERT INTO public.book_volume_group_members (group_id, book_id, position, volume_label)
    VALUES (
      v_id,
      (v_member->>'book_id')::bigint,
      (v_member->>'position')::smallint,
      left(coalesce(v_member->>'volume_label', ''), 120)
    );
  END LOOP;
  UPDATE public.book_volume_groups
  SET representative_book_id = nullif(p_group->>'representative_book_id', '')::bigint
  WHERE id = v_id;
  RETURN public.admin_get_book_volume_group(v_id);
END;
$admin_save$;
