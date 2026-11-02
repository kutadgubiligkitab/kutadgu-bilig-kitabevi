-- Stage 138: readable, persistent public series URLs. MANUAL REVIEW/APPLY ONLY.
-- No production application/CI may execute this migration.
-- Keep legacy slug and group IDs intact. Do not regenerate slugs on title edits.
-- Public visibility continues through the existing private public-volume filter.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.book_volume_groups IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.book_volume_groups ADD COLUMN IF NOT EXISTS public_slug text;
CREATE UNIQUE INDEX IF NOT EXISTS book_volume_groups_public_slug_uidx
  ON public.book_volume_groups(public_slug) WHERE public_slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.kutadgu_series_slug_base(p_title text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, public
AS $fold$
DECLARE
  v_map constant jsonb := '{"ا": "a", "آ": "a", "ب": "b", "پ": "p", "ت": "t", "ث": "s", "ج": "j", "چ": "ch", "ح": "h", "خ": "x", "د": "d", "ذ": "z", "ر": "r", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z", "ع": "", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ک": "k", "گ": "g", "ڭ": "ng", "ل": "l", "م": "m", "ن": "n", "ھ": "h", "ه": "h", "و": "o", "ۇ": "u", "ۆ": "o", "ۈ": "u", "ۋ": "w", "ې": "e", "ى": "i", "ي": "y", "ئ": "", "ە": "e", "ة": "e"}'::jsonb;
  v_title text := lower(normalize(p_title, NFKC));
  v_out text := '';
  v_char text;
  i integer;
BEGIN
  FOR i IN 1..char_length(v_title) LOOP
    v_char := substr(v_title, i, 1);
    IF v_char ~ '^[a-z0-9]$' THEN v_out := v_out || v_char;
    ELSIF v_char IN (' ', '-', '_', '/') OR v_char ~ '[[:space:]]' THEN v_out := v_out || '-';
    ELSE v_out := v_out || coalesce(v_map->>v_char, '');
    END IF;
  END LOOP;
  v_out := btrim(regexp_replace(v_out, '-+', '-', 'g'), '-');
  v_out := rtrim(left(v_out, 48), '-');
  RETURN coalesce(nullif(v_out, ''), 'series');
END;
$fold$;
REVOKE ALL ON FUNCTION public.kutadgu_series_slug_base(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kutadgu_assign_series_slug()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $assign$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix text;
  v_attempt integer := 0;
BEGIN
  -- Inserts and all title/slug updates share a transaction lock. The unique
  -- index remains the final guard against concurrent direct database writes.
  PERFORM pg_advisory_xact_lock(138, 1);
  IF TG_OP = 'UPDATE' AND OLD.public_slug IS NOT NULL THEN
    NEW.public_slug := OLD.public_slug;
    NEW.slug := OLD.slug;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.slug := OLD.slug; END IF;
  -- New recovery aliases must not shadow an already published URL.
  IF EXISTS (SELECT 1 FROM public.book_volume_groups g WHERE g.id <> NEW.id AND g.public_slug = NEW.slug) THEN
    RAISE EXCEPTION 'Legacy group alias conflicts with a published series URL' USING ERRCODE = '23505';
  END IF;
  v_base := public.kutadgu_series_slug_base(NEW.title);
  v_candidate := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.book_volume_groups AS g
      WHERE g.id <> NEW.id AND (g.public_slug = v_candidate OR g.slug = v_candidate)
    );
    v_attempt := v_attempt + 1;
    v_suffix := '-' || NEW.id::text || CASE WHEN v_attempt > 1 THEN '-' || v_attempt::text ELSE '' END;
    v_candidate := rtrim(left(v_base, greatest(1, 80 - char_length(v_suffix))), '-') || v_suffix;
  END LOOP;
  NEW.public_slug := v_candidate;
  RETURN NEW;
END;
$assign$;
REVOKE ALL ON FUNCTION public.kutadgu_assign_series_slug() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS book_volume_groups_public_slug ON public.book_volume_groups;
CREATE TRIGGER book_volume_groups_public_slug
  BEFORE INSERT OR UPDATE OF title, slug, public_slug ON public.book_volume_groups
  FOR EACH ROW EXECUTE FUNCTION public.kutadgu_assign_series_slug();

-- Stable deterministic backfill: lowest ID wins the unsuffixed title.
DO $backfill$
DECLARE v_id bigint;
BEGIN
  FOR v_id IN SELECT id FROM public.book_volume_groups WHERE public_slug IS NULL ORDER BY id LOOP
    UPDATE public.book_volume_groups SET public_slug = NULL WHERE id = v_id;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.book_volume_groups'::regclass AND conname='book_volume_groups_public_slug_format') THEN
    ALTER TABLE public.book_volume_groups ADD CONSTRAINT book_volume_groups_public_slug_format
      CHECK (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(public_slug) <= 80);
  END IF;
END;
$backfill$;
ALTER TABLE public.book_volume_groups ALTER COLUMN public_slug SET NOT NULL;
COMMENT ON COLUMN public.book_volume_groups.public_slug IS
  'Automatically allocated immutable title-based public /series/ slug. Legacy slug remains the Admin recovery key and redirect alias.';

-- Existing public RPCs and private projections deliberately stay unchanged.
CREATE OR REPLACE FUNCTION public.list_public_book_series_routes()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $routes$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'group_id', visible.group_id,
    'legacy_slug', visible.slug,
    'public_slug', g.public_slug
  ) ORDER BY visible.group_id), '[]'::jsonb)
  FROM private.kutadgu_public_volume_groups() visible
  JOIN public.book_volume_groups g ON g.id=visible.group_id;
$routes$;
REVOKE ALL ON FUNCTION public.list_public_book_series_routes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_public_book_series_routes() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
