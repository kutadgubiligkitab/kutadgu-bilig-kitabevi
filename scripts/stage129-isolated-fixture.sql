CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.shared_cart_links (
  code text PRIMARY KEY,
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION public.shared_cart_items_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $legacy$
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
        OR (elem.value ->> 'qty')::numeric NOT BETWEEN 1 AND 99
    );
$legacy$;

ALTER TABLE public.shared_cart_links
  ADD CONSTRAINT shared_cart_links_items_shape
  CHECK (public.shared_cart_items_valid(items));
