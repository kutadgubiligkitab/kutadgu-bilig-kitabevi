-- Data-preserving rollback for Stage 129.
-- Typed rows may remain reachable for 30 days. While any exist, retain the
-- typed validator so the table constraint and old/new readers keep working.
-- If none exist, restore the exact legacy-v1 validator.

BEGIN;

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.shared_cart_links AS link
    CROSS JOIN LATERAL jsonb_array_elements(link.items) AS item(value)
    WHERE item.value ? 'kind'
  ) THEN
    RAISE NOTICE 'Typed shared-cart rows exist; retaining component-aware validator.';
  ELSE
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.shared_cart_items_valid(value jsonb)
      RETURNS boolean
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      SET search_path = pg_catalog
      AS $body$
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
      $body$
    $function$;
    REVOKE ALL ON FUNCTION public.shared_cart_items_valid(jsonb) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.shared_cart_items_valid(jsonb) TO service_role;
  END IF;
END;
$rollback$;

COMMIT;
