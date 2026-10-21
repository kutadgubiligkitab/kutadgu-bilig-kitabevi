-- Data-preserving rollback for Stage 131.
-- Drops the series-create function, its recovery/read helpers, and the
-- idempotency table. Books and series created through that function stay.
-- Publication returns to the Stage 130 function, which does not rewrite books.
-- The submission check keeps series_draft when such rows still exist, so the
-- rollback does not fail on books this stage created. Does not reverse
-- Stages 127–130.

REVOKE ALL ON FUNCTION public.admin_create_book_volume_series(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_book_volume_series_request(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.series_draft_cover_is_referenced(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_public_book_volume_part_prices(bigint[]) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.admin_create_book_volume_series(uuid, jsonb);
DROP FUNCTION IF EXISTS public.admin_get_book_volume_series_request(uuid);
DROP FUNCTION IF EXISTS public.series_draft_cover_is_referenced(text);
DROP FUNCTION IF EXISTS public.list_public_book_volume_part_prices(bigint[]);
DROP TABLE IF EXISTS public.book_volume_series_requests;

CREATE OR REPLACE FUNCTION public.admin_set_book_volume_group_publication(
  p_group_id bigint,
  p_expected_revision bigint,
  p_is_public boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $admin_publish$
DECLARE
  v_group public.book_volume_groups%rowtype;
  v_member_count integer;
  v_distinct_positions integer;
  v_first_position integer;
  v_last_position integer;
  v_invalid_members integer;
BEGIN
  IF coalesce(public.is_kutadgu_admin(), false) IS NOT TRUE
     OR (SELECT auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Admin AAL2 required' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_group_id < 1 OR p_is_public IS NULL THEN
    RAISE EXCEPTION 'invalid_publication_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.book_volume_groups
  WHERE id = p_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'volume_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_group.revision THEN
    RAISE EXCEPTION 'stale_volume_group_revision' USING ERRCODE = '40001',
      DETAIL = 'expected=' || coalesce(p_expected_revision::text, 'null')
        || ' current=' || v_group.revision::text;
  END IF;

  IF p_is_public THEN
    IF NOT v_group.is_active
       OR v_group.slug IS NULL
       OR btrim(v_group.slug) = '' THEN
      RAISE EXCEPTION 'volume_group_incomplete' USING ERRCODE = '55000',
        DETAIL = 'active group and slug are required';
    END IF;

    SELECT
      count(*)::integer,
      count(DISTINCT m.position)::integer,
      min(m.position)::integer,
      max(m.position)::integer,
      count(*) FILTER (
        WHERE NOT b.is_active
           OR b.submission_status <> 'approved'
           OR b.price IS NULL
           OR b.price < 0
      )::integer
    INTO
      v_member_count,
      v_distinct_positions,
      v_first_position,
      v_last_position,
      v_invalid_members
    FROM public.book_volume_group_members AS m
    JOIN public.books AS b ON b.id = m.book_id
    WHERE m.group_id = p_group_id;

    IF v_member_count NOT BETWEEN 2 AND 100
       OR v_distinct_positions <> v_member_count
       OR v_first_position <> 1
       OR v_last_position <> v_member_count
       OR v_invalid_members <> 0 THEN
      RAISE EXCEPTION 'volume_group_incomplete' USING ERRCODE = '55000',
        DETAIL = 'members must be contiguous 2..100 and every member active, approved, and priced';
    END IF;
    IF v_group.representative_book_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.book_volume_group_members AS m
         WHERE m.group_id = p_group_id
           AND m.book_id = v_group.representative_book_id
       ) THEN
      RAISE EXCEPTION 'volume_group_incomplete' USING ERRCODE = '55000',
        DETAIL = 'representative must be a member';
    END IF;
  END IF;

  UPDATE public.book_volume_groups
  SET is_public = p_is_public,
      revision = revision + 1,
      updated_at = now()
  WHERE id = p_group_id;

  RETURN public.admin_get_book_volume_group(p_group_id);
END;
$admin_publish$;

DO $$
BEGIN
  IF to_regclass('public.books') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.books WHERE submission_status = 'series_draft'
  ) THEN
    ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_submission_status_chk;
    ALTER TABLE public.books
      ADD CONSTRAINT books_submission_status_chk
      CHECK (submission_status IN ('approved', 'pending', 'rejected'));
  END IF;
END;
$$;
