-- Shared cart short links.
-- Run once by hand in the Supabase SQL editor. The app does not apply this file.
-- A link stays valid for 30 days. The create function deletes expired rows
-- in the same transaction as a successful insert, so the table does not keep them.
-- Stores an 8-character code and normalized book id/qty pairs only.
-- No customer name, phone, address, email, account id, price, title, or image.
-- No IP address, account id, user id, fingerprint, or cookie is stored.
-- At most 300 creates in any 10 minutes, and 1000 creates in any 24 hours.
-- Both counts use created_at. Expired rows are deleted only on a successful insert.
-- The Cloudflare Worker calls create_shared_cart_link with SUPABASE_SECRET_KEY.
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

ALTER TABLE public.shared_cart_links DROP CONSTRAINT IF EXISTS shared_cart_links_expires_after_create;
ALTER TABLE public.shared_cart_links
  ADD CONSTRAINT shared_cart_links_expires_after_create
  CHECK (expires_at > created_at);

CREATE OR REPLACE FUNCTION public.shared_cart_items_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $shared_cart_items$
  SELECT
    jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) BETWEEN 1 AND 80
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value) AS elem(value)
      WHERE jsonb_typeof(elem.value) IS DISTINCT FROM 'object'
        OR (elem.value - 'id' - 'qty') IS DISTINCT FROM '{}'::jsonb
        OR jsonb_typeof(elem.value -> 'id') IS DISTINCT FROM 'string'
        OR (elem.value ->> 'id') !~ '^[0-9]{1,18}$'
        OR jsonb_typeof(elem.value -> 'qty') IS DISTINCT FROM 'number'
        OR (elem.value ->> 'qty')::numeric <> trunc((elem.value ->> 'qty')::numeric)
        OR (elem.value ->> 'qty')::numeric < 1
        OR (elem.value ->> 'qty')::numeric > 99
    );
$shared_cart_items$;

ALTER TABLE public.shared_cart_links DROP CONSTRAINT IF EXISTS shared_cart_links_items_shape;
ALTER TABLE public.shared_cart_links
  ADD CONSTRAINT shared_cart_links_items_shape
  CHECK (public.shared_cart_items_valid(items));

CREATE INDEX IF NOT EXISTS shared_cart_links_created_at_idx
ON public.shared_cart_links (created_at);

CREATE INDEX IF NOT EXISTS shared_cart_links_expires_at_idx
ON public.shared_cart_links (expires_at);

ALTER TABLE public.shared_cart_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_cart_links FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shared_cart_links FROM PUBLIC;
REVOKE ALL ON TABLE public.shared_cart_links FROM anon;
REVOKE ALL ON TABLE public.shared_cart_links FROM authenticated;
REVOKE ALL ON TABLE public.shared_cart_links FROM service_role;

GRANT SELECT, INSERT, DELETE ON TABLE public.shared_cart_links TO service_role;

CREATE OR REPLACE FUNCTION public.create_shared_cart_link(
  p_code text,
  p_items jsonb,
  p_expires_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $shared_cart_create$
DECLARE
  recent_count integer;
  day_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(841050105);

  IF p_code IS NULL
    OR p_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$'
    OR p_expires_at IS NULL
    OR p_expires_at <= now()
    OR NOT public.shared_cart_items_valid(p_items) THEN
    RETURN 'invalid';
  END IF;

  SELECT count(*)::integer INTO recent_count
    FROM public.shared_cart_links
   WHERE created_at > now() - interval '10 minutes';

  IF recent_count >= 300 THEN
    RETURN 'rate_limited';
  END IF;

  SELECT count(*)::integer INTO day_count
    FROM public.shared_cart_links
   WHERE created_at > now() - interval '24 hours';

  IF day_count >= 1000 THEN
    RETURN 'rate_limited';
  END IF;

  DELETE FROM public.shared_cart_links
   WHERE expires_at <= now();

  INSERT INTO public.shared_cart_links (code, items, expires_at)
  VALUES (p_code, p_items, p_expires_at);

  RETURN 'ok';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'conflict';
END;
$shared_cart_create$;

REVOKE ALL ON FUNCTION public.shared_cart_items_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_cart_items_valid(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.shared_cart_items_valid(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_items_valid(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.create_shared_cart_link(text, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_shared_cart_link(text, jsonb, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.create_shared_cart_link(text, jsonb, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_shared_cart_link(text, jsonb, timestamptz) TO service_role;

COMMIT;
