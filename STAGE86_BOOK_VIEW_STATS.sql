-- ============================================================================
-- Kutadgu Bilig — Stage 86 public book view counts (aggregates)
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI or the browser.
-- Repeat-safe. Does NOT delete or rewrite public.analytics_events.
-- Does NOT change stock, search, cart, orders, or books columns.
-- ============================================================================
--
-- Purpose:
--   Keep cheap per-book counters for the storefront:
--     public.book_view_stats.total_views
--     public.book_view_stats.unique_views
--   Counters are backfilled from historical book_view analytics rows, then
--   kept in sync by an AFTER INSERT trigger on public.analytics_events.
--
-- Privacy:
--   Raw session_id values stay in analytics_events (admin-only SELECT).
--   Session hashes live only in private.book_view_sessions (not API-exposed).
--   Anon/authenticated may SELECT aggregate counters, not analytics rows.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.book_view_stats (
  book_id bigint PRIMARY KEY REFERENCES public.books(id) ON DELETE CASCADE,
  total_views bigint NOT NULL DEFAULT 0,
  unique_views bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT book_view_stats_total_nonnegative_chk CHECK (total_views >= 0),
  CONSTRAINT book_view_stats_unique_nonnegative_chk CHECK (unique_views >= 0)
);

COMMENT ON TABLE public.book_view_stats IS
  'Per-book view aggregates for public display (total_views) and future admin analytics (unique_views). Not a perfect unique-person count.';

CREATE TABLE IF NOT EXISTS private.book_view_sessions (
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, session_hash)
);

COMMENT ON TABLE private.book_view_sessions IS
  'Private hashed session keys for unique_views. Never expose to anon. Not a fingerprint.';

ALTER TABLE public.book_view_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.book_view_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.book_view_stats FROM PUBLIC;
REVOKE ALL ON TABLE public.book_view_stats FROM anon;
REVOKE ALL ON TABLE public.book_view_stats FROM authenticated;
-- Public storefront needs only the key and display counter. Keep unique_views
-- and updated_at backend-only via column-level privileges.
GRANT SELECT (book_id, total_views) ON TABLE public.book_view_stats TO anon, authenticated;

DROP POLICY IF EXISTS "public can read book view stats" ON public.book_view_stats;
CREATE POLICY "public can read book view stats"
  ON public.book_view_stats
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE private.book_view_sessions FROM PUBLIC;
REVOKE ALL ON TABLE private.book_view_sessions FROM anon;
REVOKE ALL ON TABLE private.book_view_sessions FROM authenticated;

DROP TRIGGER IF EXISTS analytics_events_apply_book_view ON public.analytics_events;
DROP FUNCTION IF EXISTS public.kutadgu_apply_book_view();
DROP FUNCTION IF EXISTS public.kutadgu_resolve_analytics_book_id(text, text);
DROP FUNCTION IF EXISTS private.kutadgu_apply_book_view();
DROP FUNCTION IF EXISTS private.kutadgu_resolve_analytics_book_id(text, text);

CREATE OR REPLACE FUNCTION private.kutadgu_resolve_analytics_book_id(p_book_id text, p_legacy_id text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $stage86$
DECLARE
  v_id bigint;
  v_text text;
BEGIN
  v_text := btrim(coalesce(p_book_id, ''));
  IF v_text ~ '^[1-9][0-9]*$' THEN
    BEGIN
      SELECT b.id INTO v_id
      FROM public.books AS b
      WHERE b.id = v_text::bigint;
      IF FOUND THEN
        RETURN v_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_id := NULL;
    END;
  END IF;
  IF v_text <> '' THEN
    SELECT b.id INTO v_id
    FROM public.books AS b
    WHERE b.legacy_id IS NOT NULL
      AND b.legacy_id <> ''
      AND b.legacy_id = v_text
    LIMIT 1;
    IF FOUND THEN
      RETURN v_id;
    END IF;
  END IF;
  v_text := btrim(coalesce(p_legacy_id, ''));
  IF v_text = '' THEN
    RETURN NULL;
  END IF;
  IF v_text ~ '^[1-9][0-9]*$' THEN
    BEGIN
      SELECT b.id INTO v_id
      FROM public.books AS b
      WHERE b.id = v_text::bigint;
      IF FOUND THEN
        RETURN v_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_id := NULL;
    END;
  END IF;
  SELECT b.id INTO v_id
  FROM public.books AS b
  WHERE b.legacy_id IS NOT NULL
    AND b.legacy_id <> ''
    AND b.legacy_id = v_text
  LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  RETURN NULL;
END;
$stage86$;

CREATE OR REPLACE FUNCTION private.kutadgu_apply_book_view()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $stage86$
DECLARE
  v_book_id bigint;
  v_session text;
  v_hash text;
  v_inserted integer := 0;
BEGIN
  IF NEW.event_name IS DISTINCT FROM 'book_view' THEN
    RETURN NEW;
  END IF;
  v_book_id := private.kutadgu_resolve_analytics_book_id(NEW.book_id, NEW.legacy_id);
  IF v_book_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_session := btrim(coalesce(NEW.session_id, ''));
  IF v_session <> '' THEN
    v_hash := md5(v_session);
    INSERT INTO private.book_view_sessions AS s (book_id, session_hash)
    VALUES (v_book_id, v_hash)
    ON CONFLICT (book_id, session_hash) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;
  INSERT INTO public.book_view_stats AS t (book_id, total_views, unique_views, updated_at)
  VALUES (v_book_id, 1, CASE WHEN v_inserted > 0 THEN 1 ELSE 0 END, now())
  ON CONFLICT (book_id) DO UPDATE
    SET total_views = t.total_views + 1,
        unique_views = t.unique_views + CASE WHEN v_inserted > 0 THEN 1 ELSE 0 END,
        updated_at = now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$stage86$;

REVOKE ALL ON FUNCTION private.kutadgu_resolve_analytics_book_id(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kutadgu_resolve_analytics_book_id(text, text) FROM anon;
REVOKE ALL ON FUNCTION private.kutadgu_resolve_analytics_book_id(text, text) FROM authenticated;
REVOKE ALL ON FUNCTION private.kutadgu_apply_book_view() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kutadgu_apply_book_view() FROM anon;
REVOKE ALL ON FUNCTION private.kutadgu_apply_book_view() FROM authenticated;

CREATE TRIGGER analytics_events_apply_book_view
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW
  WHEN (NEW.event_name = 'book_view')
  EXECUTE FUNCTION private.kutadgu_apply_book_view();

-- Historical backfill. Does not DELETE/UPDATE analytics_events.
-- Canonical numeric book_id first, then analytics.legacy_id / slug book_id → books.legacy_id.
INSERT INTO public.book_view_stats (book_id, total_views, unique_views, updated_at)
SELECT
  mapped.book_id,
  count(*)::bigint AS total_views,
  count(DISTINCT mapped.session_id) FILTER (
    WHERE mapped.session_id IS NOT NULL AND mapped.session_id <> ''
  )::bigint AS unique_views,
  now()
FROM (
  SELECT
    private.kutadgu_resolve_analytics_book_id(e.book_id, e.legacy_id) AS book_id,
    NULLIF(btrim(coalesce(e.session_id, '')), '') AS session_id
  FROM public.analytics_events AS e
  WHERE e.event_name = 'book_view'
) AS mapped
WHERE mapped.book_id IS NOT NULL
GROUP BY mapped.book_id
ON CONFLICT (book_id) DO UPDATE
  SET total_views = GREATEST(public.book_view_stats.total_views, EXCLUDED.total_views),
      unique_views = GREATEST(public.book_view_stats.unique_views, EXCLUDED.unique_views),
      updated_at = now();

INSERT INTO private.book_view_sessions (book_id, session_hash)
SELECT DISTINCT
  mapped.book_id,
  md5(mapped.session_id)
FROM (
  SELECT
    private.kutadgu_resolve_analytics_book_id(e.book_id, e.legacy_id) AS book_id,
    NULLIF(btrim(coalesce(e.session_id, '')), '') AS session_id
  FROM public.analytics_events AS e
  WHERE e.event_name = 'book_view'
) AS mapped
WHERE mapped.book_id IS NOT NULL
  AND mapped.session_id IS NOT NULL
ON CONFLICT (book_id, session_hash) DO NOTHING;

COMMIT;

-- RLS: analytics_events policies unchanged (anon INSERT only; no public SELECT).
-- books / stock / orders unchanged.

-- ============================================================================
-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply.
-- ============================================================================
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'book_view_stats'
-- ORDER BY ordinal_position;
--
-- SELECT n.nspname, p.proname, p.prosecdef, p.proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE p.proname IN ('kutadgu_apply_book_view', 'kutadgu_resolve_analytics_book_id');
-- -- expect schema_name = private and search_path = ""
--
-- SELECT count(*) FROM public.analytics_events WHERE event_name = 'book_view';
-- SELECT coalesce(sum(total_views),0) FROM public.book_view_stats;
-- ============================================================================
