-- Stage 129 — versioned shared-cart lines for complete-set intent.
-- MANUAL / REVIEWED APPLY ONLY. Apply after Stages 127 and 128.
-- Existing v1 rows ({id,qty}) remain valid and readable.
-- New v2 rows use exact typed shapes:
--   {kind:"book",id:"...",qty:N}
--   {kind:"set",group_id:"...",qty:N}
-- No title, price, customer information, component list, or client total is stored.

BEGIN;

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
         OR jsonb_typeof(elem.value -> 'qty') IS DISTINCT FROM 'number'
         OR (elem.value ->> 'qty')::numeric <> trunc((elem.value ->> 'qty')::numeric)
         OR (elem.value ->> 'qty')::numeric NOT BETWEEN 1 AND 99
         OR NOT (
           (
             (elem.value - 'id' - 'qty') IS NOT DISTINCT FROM '{}'::jsonb
             AND jsonb_typeof(elem.value -> 'id') IS NOT DISTINCT FROM 'string'
             AND (elem.value ->> 'id') ~ '^[0-9]{1,18}$'
           )
           OR
           (
             (elem.value - 'kind' - 'id' - 'qty') IS NOT DISTINCT FROM '{}'::jsonb
             AND elem.value ->> 'kind' = 'book'
             AND jsonb_typeof(elem.value -> 'id') IS NOT DISTINCT FROM 'string'
             AND (elem.value ->> 'id') ~ '^[1-9][0-9]{0,17}$'
           )
           OR
           (
             (elem.value - 'kind' - 'group_id' - 'qty') IS NOT DISTINCT FROM '{}'::jsonb
             AND elem.value ->> 'kind' = 'set'
             AND jsonb_typeof(elem.value -> 'group_id') IS NOT DISTINCT FROM 'string'
             AND (elem.value ->> 'group_id') ~ '^[1-9][0-9]{0,17}$'
           )
         )
    );
$shared_cart_items$;

REVOKE ALL ON FUNCTION public.shared_cart_items_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_items_valid(jsonb) TO service_role;

COMMENT ON FUNCTION public.shared_cart_items_valid(jsonb) IS
  'Validates legacy v1 book lines and exact v2 typed book/set intents. Prices and components are never accepted.';

COMMIT;
