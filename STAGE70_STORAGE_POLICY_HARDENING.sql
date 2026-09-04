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
-- Requires (abort if missing; do not recreate):
--   "admin can upload book covers"
--   "admin can update book covers"
--   "admin can delete book covers"
--   "aal2 required to insert book covers"
--   "aal2 required to update book covers"
--   "aal2 required to delete book covers"
--
-- Do not silently recreate missing protective policies in this migration.
-- Abort instead.
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
END
$$;

COMMIT;
