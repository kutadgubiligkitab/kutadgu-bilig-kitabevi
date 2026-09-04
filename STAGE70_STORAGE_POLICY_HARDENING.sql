-- ============================================================================
-- Kutadgu Bilig — Stage 70 Storage policy hardening
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does not modify Storage objects, book rows, or bucket flags.
-- Does not change table privileges, privileged roles, or rewrite
-- Admin or AAL2 write policies.
-- ============================================================================
--
-- Purpose:
--   Drop five legacy/broad storage.objects policies on the public
--   book-covers bucket. Public object GET via known URLs does not need a
--   storage.objects SELECT policy. Authenticated non-admins must not write.
--
-- Drops only:
--   "Public can view book covers"          SELECT  anon, authenticated
--   "public can read book covers"          SELECT  anon, authenticated
--   "Authenticated can upload book covers" INSERT  authenticated
--   "Authenticated can update book covers" UPDATE  authenticated
--   "Authenticated can delete book covers" DELETE  authenticated
--
-- Requires (abort if missing or semantically wrong; do not recreate):
--   "admin can upload book covers"
--   "admin can update book covers"
--   "admin can delete book covers"
--   "aal2 required to insert book covers"
--   "aal2 required to update book covers"
--   "aal2 required to delete book covers"
--
-- Do not silently recreate missing protective policies in this migration.
-- Abort instead.
-- Name-only fakes are rejected: a policy with the expected name but
-- unrestricted USING/WITH CHECK, the wrong command, PERMISSIVE AAL2,
-- RESTRICTIVE Admin, missing is_kutadgu_admin(), or missing JWT aal2
-- aborts before any DROP.
--
-- Catalog checks use pg_policy + pg_get_expr. Expressions are normalized
-- (lowercase, casts stripped) and matched by invariants, not by brittle
-- exact full-expression string equality.
--
-- Depends on:
--   SUPABASE_SETUP.sql storage.buckets + Admin/AAL2 storage.objects policies
--   STAGE2C_AAL2_STORE_STORAGE_RLS.sql
--
-- After apply:
--   book-covers stays public=true.
--   Known public object URLs still load.
--   Bucket-wide list via storage.objects SELECT is gone.
--   Admin INSERT/UPDATE/DELETE remain is_kutadgu_admin() + AAL2.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.stage70_norm(p_expr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $stage70$
  SELECT btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(p_expr, '')), '::[a-z0-9_.]+', '', 'g'),
      '\s+', ' ', 'g'
    )
  );
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_is_unrestricted(p_norm text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $stage70$
  SELECT p_norm IS NULL OR p_norm IN ('', 'true');
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_is_public_roles(p_roles oid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $stage70$
  SELECT
    COALESCE(p_roles, ARRAY[]::oid[]) = '{}'::oid[]
    OR 0 = ANY(COALESCE(p_roles, ARRAY[]::oid[]));
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_has_explicit_role(p_roles oid[], p_rolename text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $stage70$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles r
    WHERE r.oid = ANY(COALESCE(p_roles, ARRAY[]::oid[]))
      AND r.rolname = p_rolename
  );
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_applies_to_role(p_roles oid[], p_rolename text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $stage70$
  SELECT
    pg_temp.stage70_is_public_roles(p_roles)
    OR pg_temp.stage70_has_explicit_role(p_roles, p_rolename);
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_applies_to_book_covers(p_norm text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $stage70$
  SELECT
    CASE
      WHEN p_norm IS NULL OR p_norm IN ('', 'true') THEN true
      WHEN p_norm ~ 'bucket_id\s*=\s*''book-covers''' THEN true
      WHEN p_norm ~ 'bucket_id' AND p_norm !~ 'book-covers' THEN false
      WHEN p_norm !~ 'bucket_id' THEN true
      ELSE false
    END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_is_bucket_wide_book_covers_select(p_norm text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $stage70$
  SELECT
    CASE
      WHEN p_norm IS NULL OR p_norm IN ('', 'true') THEN true
      WHEN p_norm ~ '\mname\s*=\s*''' AND p_norm !~ 'name\s*=\s*name' THEN false
      WHEN pg_temp.stage70_applies_to_book_covers(p_norm) THEN true
      ELSE false
    END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_load_objects_policy(p_name text)
RETURNS TABLE (
  polcmd "char",
  polpermissive boolean,
  using_expr text,
  check_expr text,
  polroles oid[]
)
LANGUAGE sql
STABLE
AS $stage70$
  SELECT
    pol.polcmd,
    pol.polpermissive,
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
    pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid),
    pol.polroles
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'storage'
    AND rel.relname = 'objects'
    AND pol.polname = p_name;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_policy_roles(p_prefix text, p_name text, p_roles oid[])
RETURNS void
LANGUAGE plpgsql
AS $stage70$
BEGIN
  IF pg_temp.stage70_is_public_roles(p_roles)
     OR pg_temp.stage70_has_explicit_role(p_roles, 'anon')
     OR NOT pg_temp.stage70_has_explicit_role(p_roles, 'authenticated') THEN
    RAISE EXCEPTION
      '% required protective policy "%" is not granted to authenticated.',
      p_prefix, p_name;
  END IF;
END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_admin_expr(p_prefix text, p_name text, p_label text, p_expr text)
RETURNS void
LANGUAGE plpgsql
AS $stage70$
DECLARE
  n text := pg_temp.stage70_norm(p_expr);
BEGIN
  IF pg_temp.stage70_is_unrestricted(n) THEN
    RAISE EXCEPTION
      '% required protective policy "%" % is a name-only fake (unrestricted).',
      p_prefix, p_name, p_label;
  END IF;
  IF n !~ 'bucket_id\s*=\s*''book-covers''' THEN
    RAISE EXCEPTION
      '% required protective policy "%" % is not scoped to bucket_id = ''book-covers''.',
      p_prefix, p_name, p_label;
  END IF;
  IF n !~ 'is_kutadgu_admin\s*\(\s*\)' THEN
    RAISE EXCEPTION
      '% required protective policy "%" % does not require is_kutadgu_admin().',
      p_prefix, p_name, p_label;
  END IF;
  IF n ~ 'is distinct from' THEN
    RAISE EXCEPTION
      '% required protective policy "%" % must stay scoped to book-covers.',
      p_prefix, p_name, p_label;
  END IF;
END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_aal2_expr(p_prefix text, p_name text, p_label text, p_expr text)
RETURNS void
LANGUAGE plpgsql
AS $stage70$
DECLARE
  n text := pg_temp.stage70_norm(p_expr);
BEGIN
  IF pg_temp.stage70_is_unrestricted(n) THEN
    RAISE EXCEPTION
      '% required protective policy "%" % is a name-only fake (unrestricted).',
      p_prefix, p_name, p_label;
  END IF;
  IF n !~ 'bucket_id\s*=\s*''book-covers''' THEN
    RAISE EXCEPTION
      '% required protective policy "%" % is not scoped to book-covers.',
      p_prefix, p_name, p_label;
  END IF;
  IF position('auth.jwt()' in n) = 0
     OR n !~ '->>\s*''aal'''
     OR position('''aal2''' in n) = 0 THEN
    RAISE EXCEPTION
      '% required protective policy "%" % does not require JWT aal2 for book-covers.',
      p_prefix, p_name, p_label;
  END IF;
  IF n !~ 'bucket_id\s+is distinct from\s+''book-covers''' THEN
    RAISE EXCEPTION
      '% required protective policy "%" % weakens outside-bucket behavior.',
      p_prefix, p_name, p_label;
  END IF;
END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_admin_policy(
  p_prefix text,
  p_name text,
  p_expected_cmd "char",
  p_need_using boolean,
  p_need_check boolean
)
RETURNS void
LANGUAGE plpgsql
AS $stage70$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM pg_temp.stage70_load_objects_policy(p_name);
  IF NOT FOUND THEN
    RAISE EXCEPTION
      '% required protective policy "%" is missing.',
      p_prefix, p_name;
  END IF;
  IF r.polcmd IS DISTINCT FROM p_expected_cmd THEN
    RAISE EXCEPTION
      '% required protective policy "%" has unexpected command.',
      p_prefix, p_name;
  END IF;
  IF r.polpermissive IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      '% required protective policy "%" is not PERMISSIVE.',
      p_prefix, p_name;
  END IF;
  PERFORM pg_temp.stage70_assert_policy_roles(p_prefix, p_name, r.polroles);
  IF p_need_using THEN
    IF r.using_expr IS NULL THEN
      RAISE EXCEPTION
        '% required protective policy "%" is missing USING.',
        p_prefix, p_name;
    END IF;
    PERFORM pg_temp.stage70_assert_admin_expr(p_prefix, p_name, 'USING', r.using_expr);
  ELSIF r.using_expr IS NOT NULL THEN
    RAISE EXCEPTION
      '% required protective policy "%" has unexpected USING.',
      p_prefix, p_name;
  END IF;
  IF p_need_check THEN
    IF r.check_expr IS NULL THEN
      RAISE EXCEPTION
        '% required protective policy "%" is missing WITH CHECK.',
        p_prefix, p_name;
    END IF;
    PERFORM pg_temp.stage70_assert_admin_expr(p_prefix, p_name, 'WITH CHECK', r.check_expr);
  ELSIF r.check_expr IS NOT NULL THEN
    RAISE EXCEPTION
      '% required protective policy "%" has unexpected WITH CHECK.',
      p_prefix, p_name;
  END IF;
END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_aal2_policy(
  p_prefix text,
  p_name text,
  p_expected_cmd "char",
  p_need_using boolean,
  p_need_check boolean
)
RETURNS void
LANGUAGE plpgsql
AS $stage70$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM pg_temp.stage70_load_objects_policy(p_name);
  IF NOT FOUND THEN
    RAISE EXCEPTION
      '% required protective policy "%" is missing.',
      p_prefix, p_name;
  END IF;
  IF r.polcmd IS DISTINCT FROM p_expected_cmd THEN
    RAISE EXCEPTION
      '% required protective policy "%" has unexpected command.',
      p_prefix, p_name;
  END IF;
  IF r.polpermissive IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION
      '% required protective policy "%" is not RESTRICTIVE.',
      p_prefix, p_name;
  END IF;
  PERFORM pg_temp.stage70_assert_policy_roles(p_prefix, p_name, r.polroles);
  IF p_need_using THEN
    IF r.using_expr IS NULL THEN
      RAISE EXCEPTION
        '% required protective policy "%" is missing USING.',
        p_prefix, p_name;
    END IF;
    PERFORM pg_temp.stage70_assert_aal2_expr(p_prefix, p_name, 'USING', r.using_expr);
  ELSIF r.using_expr IS NOT NULL THEN
    RAISE EXCEPTION
      '% required protective policy "%" has unexpected USING.',
      p_prefix, p_name;
  END IF;
  IF p_need_check THEN
    IF r.check_expr IS NULL THEN
      RAISE EXCEPTION
        '% required protective policy "%" is missing WITH CHECK.',
        p_prefix, p_name;
    END IF;
    PERFORM pg_temp.stage70_assert_aal2_expr(p_prefix, p_name, 'WITH CHECK', r.check_expr);
  ELSIF r.check_expr IS NOT NULL THEN
    RAISE EXCEPTION
      '% required protective policy "%" has unexpected WITH CHECK.',
      p_prefix, p_name;
  END IF;
END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_protective_semantics(p_prefix text)
RETURNS void
LANGUAGE plpgsql
AS $stage70$
BEGIN
  PERFORM pg_temp.stage70_assert_admin_policy(p_prefix, 'admin can upload book covers', 'a', false, true);
  PERFORM pg_temp.stage70_assert_admin_policy(p_prefix, 'admin can update book covers', 'w', true, true);
  PERFORM pg_temp.stage70_assert_admin_policy(p_prefix, 'admin can delete book covers', 'd', true, false);
  PERFORM pg_temp.stage70_assert_aal2_policy(p_prefix, 'aal2 required to insert book covers', 'a', false, true);
  PERFORM pg_temp.stage70_assert_aal2_policy(p_prefix, 'aal2 required to update book covers', 'w', true, true);
  PERFORM pg_temp.stage70_assert_aal2_policy(p_prefix, 'aal2 required to delete book covers', 'd', true, false);
END;
$stage70$;

CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_remaining_invariants()
RETURNS void
LANGUAGE plpgsql
AS $stage70$
DECLARE
  r record;
  n_using text;
  n_check text;
  v_public boolean;
BEGIN
  SELECT b.public
    INTO v_public
  FROM storage.buckets b
  WHERE b.id = 'book-covers';

  IF v_public IS NULL THEN
    RAISE EXCEPTION
      'Stage 70 aborted after drop: book-covers bucket does not exist.';
  END IF;

  IF v_public IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Stage 70 aborted after drop: book-covers public is %, expected true.',
      v_public;
  END IF;

  FOR r IN
    SELECT
      pol.polname,
      pol.polcmd,
      pol.polpermissive,
      pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
      pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
      pol.polroles
    FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class rel ON rel.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'storage'
      AND rel.relname = 'objects'
  LOOP
    n_using := pg_temp.stage70_norm(r.using_expr);
    n_check := pg_temp.stage70_norm(r.check_expr);

    IF r.polcmd IN ('r', '*')
       AND (
         pg_temp.stage70_applies_to_role(r.polroles, 'anon')
         OR pg_temp.stage70_applies_to_role(r.polroles, 'authenticated')
       )
       AND pg_temp.stage70_is_bucket_wide_book_covers_select(
         CASE WHEN r.using_expr IS NULL THEN 'true' ELSE n_using END
       ) THEN
      RAISE EXCEPTION
        'Stage 70 aborted after drop: SELECT policy "%" still grants bucket-wide book-covers access.',
        r.polname;
    END IF;

    IF r.polpermissive
       AND r.polcmd IN ('a', 'w', 'd', '*')
       AND pg_temp.stage70_applies_to_role(r.polroles, 'authenticated') THEN
      IF r.polcmd IN ('a', '*') THEN
        IF pg_temp.stage70_applies_to_book_covers(
             CASE WHEN r.check_expr IS NULL THEN 'true' ELSE n_check END
           )
           AND coalesce(n_check, '') !~ 'is_kutadgu_admin\s*\(\s*\)' THEN
          RAISE EXCEPTION
            'Stage 70 aborted after drop: PERMISSIVE write policy "%" on book-covers bypasses is_kutadgu_admin().',
            r.polname;
        END IF;
      END IF;

      IF r.polcmd IN ('w', 'd', '*') THEN
        IF pg_temp.stage70_applies_to_book_covers(
             CASE WHEN r.using_expr IS NULL THEN 'true' ELSE n_using END
           )
           AND coalesce(n_using, '') !~ 'is_kutadgu_admin\s*\(\s*\)' THEN
          RAISE EXCEPTION
            'Stage 70 aborted after drop: PERMISSIVE write policy "%" on book-covers bypasses is_kutadgu_admin().',
            r.polname;
        END IF;
      END IF;

      IF r.polcmd IN ('w', '*') THEN
        IF pg_temp.stage70_applies_to_book_covers(
             CASE WHEN r.check_expr IS NULL THEN 'true' ELSE n_check END
           )
           AND coalesce(n_check, '') !~ 'is_kutadgu_admin\s*\(\s*\)' THEN
          RAISE EXCEPTION
            'Stage 70 aborted after drop: PERMISSIVE write policy "%" on book-covers bypasses is_kutadgu_admin().',
            r.polname;
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$stage70$;

DO $$
DECLARE
  v_public boolean;
  v_name text;
  v_required constant text[] := ARRAY[
    'admin can upload book covers',
    'admin can update book covers',
    'admin can delete book covers',
    'aal2 required to insert book covers',
    'aal2 required to update book covers',
    'aal2 required to delete book covers'
  ];
BEGIN
  SELECT b.public
    INTO v_public
  FROM storage.buckets b
  WHERE b.id = 'book-covers';

  IF v_public IS NULL THEN
    RAISE EXCEPTION
      'Stage 70 aborted: book-covers bucket does not exist. No policies were dropped.';
  END IF;

  IF v_public IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Stage 70 aborted: book-covers public is %, expected true. No policies were dropped.',
      v_public;
  END IF;

  FOREACH v_name IN ARRAY v_required LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'storage'
        AND p.tablename = 'objects'
        AND p.policyname = v_name
    ) THEN
      RAISE EXCEPTION
        'Stage 70 aborted: required protective policy "%" is missing. No policies were dropped.',
        v_name;
    END IF;
  END LOOP;

  PERFORM pg_temp.stage70_assert_protective_semantics('Stage 70 aborted:');
END
$$;

DROP POLICY IF EXISTS "Public can view book covers" ON storage.objects;
DROP POLICY IF EXISTS "public can read book covers" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload book covers" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update book covers" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete book covers" ON storage.objects;

DO $$
DECLARE
  v_name text;
  v_legacy constant text[] := ARRAY[
    'Public can view book covers',
    'public can read book covers',
    'Authenticated can upload book covers',
    'Authenticated can update book covers',
    'Authenticated can delete book covers'
  ];
  v_required constant text[] := ARRAY[
    'admin can upload book covers',
    'admin can update book covers',
    'admin can delete book covers',
    'aal2 required to insert book covers',
    'aal2 required to update book covers',
    'aal2 required to delete book covers'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_legacy LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'storage'
        AND p.tablename = 'objects'
        AND p.policyname = v_name
    ) THEN
      RAISE EXCEPTION
        'Stage 70 aborted after drop: legacy policy "%" still exists.',
        v_name;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY v_required LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'storage'
        AND p.tablename = 'objects'
        AND p.policyname = v_name
    ) THEN
      RAISE EXCEPTION
        'Stage 70 aborted after drop: required protective policy "%" is missing.',
        v_name;
    END IF;
  END LOOP;

  PERFORM pg_temp.stage70_assert_protective_semantics('Stage 70 aborted after drop:');
  PERFORM pg_temp.stage70_assert_remaining_invariants();
END
$$;

COMMIT;
