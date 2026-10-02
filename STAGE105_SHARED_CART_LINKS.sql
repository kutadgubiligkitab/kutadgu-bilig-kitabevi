-- Shared cart short links.
-- Run once by hand in the Supabase SQL editor. The app does not apply this file.
-- Stores an 8-character code and normalized book id/qty pairs for 30 days.
-- No customer name, phone, address, email, account id, price, title, or image.
-- The Cloudflare Worker reads and inserts with SUPABASE_SECRET_KEY (service_role).
-- Repeat-safe. Does not change books, auth, orders, storage, or other grants.

BEGIN;

CREATE TABLE IF NOT EXISTS public.shared_cart_links (
  code text PRIMARY KEY,
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.shared_cart_links DROP CONSTRAINT IF EXISTS shared_cart_links_code_format;
ALTER TABLE public.shared_cart_links
  ADD CONSTRAINT shared_cart_links_code_format
  CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$');

ALTER TABLE public.shared_cart_links DROP CONSTRAINT IF EXISTS shared_cart_links_items_shape;
ALTER TABLE public.shared_cart_links
  ADD CONSTRAINT shared_cart_links_items_shape
  CHECK (
    jsonb_typeof(items) = 'array'
    AND jsonb_array_length(items) BETWEEN 1 AND 80
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(items) AS elem(value)
      WHERE jsonb_typeof(elem.value) IS DISTINCT FROM 'object'
        OR (elem.value - 'id' - 'qty') IS DISTINCT FROM '{}'::jsonb
        OR jsonb_typeof(elem.value -> 'id') IS DISTINCT FROM 'string'
        OR (elem.value ->> 'id') !~ '^[0-9]{1,18}$'
        OR jsonb_typeof(elem.value -> 'qty') IS DISTINCT FROM 'number'
        OR (elem.value ->> 'qty') !~ '^[0-9]+$'
        OR (elem.value ->> 'qty')::numeric <> trunc((elem.value ->> 'qty')::numeric)
        OR (elem.value ->> 'qty')::numeric < 1
        OR (elem.value ->> 'qty')::numeric > 99
    )
  );

ALTER TABLE public.shared_cart_links DROP CONSTRAINT IF EXISTS shared_cart_links_expires_after_create;
ALTER TABLE public.shared_cart_links
  ADD CONSTRAINT shared_cart_links_expires_after_create
  CHECK (expires_at > created_at);

ALTER TABLE public.shared_cart_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_cart_links FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shared_cart_links FROM PUBLIC;
REVOKE ALL ON TABLE public.shared_cart_links FROM anon;
REVOKE ALL ON TABLE public.shared_cart_links FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.shared_cart_links TO service_role;

COMMIT;
