-- Throwaway Stage 130 fixture layered on the Stage 127 fixture. Never production.
-- These are the actual public.books columns read by Stage 130; the migration
-- preflight fails instead of inventing a fallback when one is absent.

ALTER TABLE public.books ADD COLUMN category text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN source text NOT NULL DEFAULT 'universal.html';
ALTER TABLE public.books ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN isbn text NOT NULL DEFAULT '';
ALTER TABLE public.books ADD COLUMN legacy_id text;
ALTER TABLE public.books ADD COLUMN is_new boolean NOT NULL DEFAULT true;
ALTER TABLE public.books ADD COLUMN is_featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.books ADD COLUMN is_recommended boolean NOT NULL DEFAULT false;
ALTER TABLE public.books ADD COLUMN is_bestseller boolean NOT NULL DEFAULT false;
ALTER TABLE public.books ADD COLUMN sales_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.books ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.books ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE public.book_credits (
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('author', 'translator', 'publisher')),
  position smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, role, position)
);

INSERT INTO public.books (
  title, author, price, image_url, stock, category, source, description,
  isbn, legacy_id, is_new, is_featured, is_recommended, is_bestseller,
  sales_count, created_at, updated_at
)
SELECT
  'Book ' || n,
  'Author ' || n,
  n * 10,
  '/cover-' || n || '.webp',
  20,
  CASE WHEN n % 2 = 0 THEN 'Even' ELSE 'Odd' END,
  CASE WHEN n % 3 = 0 THEN 'three.html' ELSE 'universal.html' END,
  'Description ' || n,
  'ISBN-' || n,
  'book-' || n,
  n % 4 = 0,
  n % 5 = 0,
  n % 6 = 0,
  n % 7 = 0,
  n,
  timestamptz '2026-01-01 00:00:00+00' + (n || ' hours')::interval,
  timestamptz '2026-02-01 00:00:00+00' + (n || ' hours')::interval
FROM generate_series(51, 180) AS n;

UPDATE public.books
SET category = CASE WHEN id % 2 = 0 THEN 'Even' ELSE 'Odd' END,
    source = CASE WHEN id % 3 = 0 THEN 'three.html' ELSE 'universal.html' END,
    description = 'Description ' || id,
    isbn = 'ISBN-' || id,
    legacy_id = 'book-' || id,
    is_new = id % 4 = 0,
    is_featured = id % 5 = 0,
    is_recommended = id % 6 = 0,
    is_bestseller = id % 7 = 0,
    sales_count = id,
    created_at = timestamptz '2026-01-01 00:00:00+00' + (id || ' hours')::interval,
    updated_at = timestamptz '2026-02-01 00:00:00+00' + (id || ' hours')::interval;

-- Lowest member price must drive group filtering/sorting even when the complete
-- set has an explicit, much higher price.
UPDATE public.books SET price = 90 WHERE id = 1;
UPDATE public.books SET price = 5 WHERE id = 2;

-- ISBN is intentionally non-unique in production. Admin exact preview must
-- return both rows once, even if one also matches p_book_id.
UPDATE public.books SET isbn = 'DUPLICATE-ISBN' WHERE id IN (150, 151);

INSERT INTO public.book_credits (book_id, identity_id, role, position) VALUES
  (1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'author', 0),
  (45, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'translator', 0);
