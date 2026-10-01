-- ============================================================================
-- Kutadgu Bilig — stop browser writes to the book-covers Storage bucket
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Drops the permissive INSERT, UPDATE, and DELETE policies that let an
-- authenticated admin or book-staff session mutate storage.objects in
-- book-covers. Public object reads stay available because the bucket remains
-- public. This file does not delete objects, rewrite image URLs, change RLS
-- on tables, or touch any other bucket.
-- Restrictive AAL2 policies are left in place. They do not grant writes.
-- ============================================================================

DROP POLICY IF EXISTS "admin can upload book covers" ON storage.objects;
DROP POLICY IF EXISTS "admin can update book covers" ON storage.objects;
DROP POLICY IF EXISTS "admin can delete book covers" ON storage.objects;
DROP POLICY IF EXISTS "book staff can upload own covers" ON storage.objects;
