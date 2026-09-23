-- ============================================================================
-- Kutadgu Bilig — Stage 87 cover integrity guard
-- Additive / backward-compatible. Does not rewrite existing cover URLs.
-- ============================================================================

BEGIN;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS cover_sha256 text NULL;

ALTER TABLE public.books
  DROP CONSTRAINT IF EXISTS books_cover_sha256_format_chk;

ALTER TABLE public.books
  ADD CONSTRAINT books_cover_sha256_format_chk
  CHECK (
    cover_sha256 IS NULL
    OR cover_sha256 ~ '^[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS books_cover_sha256_unique_idx
  ON public.books (cover_sha256)
  WHERE cover_sha256 IS NOT NULL;

COMMENT ON COLUMN public.books.cover_sha256 IS
  'SHA-256 fingerprint of the explicitly selected cover file. Used to prevent the same uploaded cover from being assigned to multiple books. Existing rows may be NULL until their cover is replaced/repaired.';

COMMIT;
