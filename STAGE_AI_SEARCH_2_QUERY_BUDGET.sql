-- Stage AI Search 2 — persistent paid-query budget.
-- REVIEWED LOCAL FILE ONLY. Do not apply this to production in this stage.
-- It does not alter existing catalog functions, policies, or grants.
--
-- One query embedding reserves 100 micro-USD ($0.0001), inside a $1.00
-- lifetime query budget. That leaves the rest of the about $5 credit untouched
-- by search. The reserve is one locked row, plus five calls per IP hash in ten
-- minutes and 200 calls per UTC day. A missing row or invalid hash is refused.
--
-- Release order. Do not run this from the application or from CI.
-- 1. Confirm Stage 132 categories and Stage 138 public series routes are already
--    installed. Do not reapply those files.
-- 2. Verify this file and STAGE_AI_SEARCH_2_PUBLIC_CATALOG_LEXICAL.sql together
--    on an isolated database.
-- 3. Apply this budget file first. It adds only new private ledger objects.
-- 4. Apply the catalog file second. Its series-directory grant needs Stage 138.
-- 5. Set the Worker server key, OpenAI key, and IP hash secret. Leave the daily
--    embedding refresh flag unset.
-- 6. Deploy the AI Search backend only after both functions answer correctly.
-- Rollback: redeploy the previous backend first. Paid calls then stop using
-- this ledger. Dropping these new objects does not change the older search RPCs.

BEGIN;

CREATE TABLE IF NOT EXISTS private.ai_search_query_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  remaining_micro_usd bigint NOT NULL CHECK (remaining_micro_usd >= 0),
  spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
  day_utc date NOT NULL DEFAULT (timezone('utc', now()))::date,
  calls_today integer NOT NULL DEFAULT 0 CHECK (calls_today >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.ai_search_query_budget (singleton, remaining_micro_usd)
VALUES (true, 1000000)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.ai_search_ip_windows (
  ip_hash text PRIMARY KEY CHECK (ip_hash ~ '^[a-f0-9]{32}$'),
  window_start timestamptz NOT NULL,
  calls integer NOT NULL CHECK (calls >= 0)
);

REVOKE ALL ON TABLE private.ai_search_query_budget FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.ai_search_ip_windows FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_ai_search_paid_call(p_ip_hash text)
RETURNS TABLE (
  allowed boolean,
  remaining_micro_usd bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $budget$
DECLARE
  v_cost constant bigint := 100;
  v_daily_cap constant integer := 200;
  v_ip_cap constant integer := 5;
  v_remaining bigint;
  v_day date;
  v_calls integer;
  v_window timestamptz;
  v_ip_calls integer;
BEGIN
  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[a-f0-9]{32}$' THEN
    allowed := false;
    remaining_micro_usd := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT budget.remaining_micro_usd, budget.day_utc, budget.calls_today
    INTO v_remaining, v_day, v_calls
  FROM private.ai_search_query_budget AS budget
  WHERE budget.singleton
  FOR UPDATE;

  IF NOT FOUND THEN
    allowed := false;
    remaining_micro_usd := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_day IS DISTINCT FROM (timezone('utc', now()))::date THEN
    v_day := (timezone('utc', now()))::date;
    v_calls := 0;
  END IF;

  DELETE FROM private.ai_search_ip_windows AS windows
  WHERE windows.window_start < now() - interval '10 minutes';

  IF v_remaining < v_cost OR v_calls >= v_daily_cap THEN
    UPDATE private.ai_search_query_budget AS budget
      SET day_utc = v_day,
          calls_today = v_calls,
          updated_at = now()
      WHERE budget.singleton;
    allowed := false;
    remaining_micro_usd := v_remaining;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT windows.window_start, windows.calls
    INTO v_window, v_ip_calls
  FROM private.ai_search_ip_windows AS windows
  WHERE windows.ip_hash = p_ip_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO private.ai_search_ip_windows (ip_hash, window_start, calls)
    VALUES (p_ip_hash, now(), 1);
  ELSIF now() - v_window >= interval '10 minutes' THEN
    UPDATE private.ai_search_ip_windows AS windows
      SET window_start = now(),
          calls = 1
      WHERE windows.ip_hash = p_ip_hash;
  ELSIF v_ip_calls >= v_ip_cap THEN
    allowed := false;
    remaining_micro_usd := v_remaining;
    RETURN NEXT;
    RETURN;
  ELSE
    UPDATE private.ai_search_ip_windows AS windows
      SET calls = windows.calls + 1
      WHERE windows.ip_hash = p_ip_hash;
  END IF;

  UPDATE private.ai_search_query_budget AS budget
    SET remaining_micro_usd = budget.remaining_micro_usd - v_cost,
        spent_micro_usd = budget.spent_micro_usd + v_cost,
        day_utc = v_day,
        calls_today = v_calls + 1,
        updated_at = now()
    WHERE budget.singleton
    RETURNING budget.remaining_micro_usd INTO v_remaining;

  allowed := true;
  remaining_micro_usd := v_remaining;
  RETURN NEXT;
END;
$budget$;

REVOKE ALL ON FUNCTION public.reserve_ai_search_paid_call(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_search_paid_call(text)
  TO service_role;

COMMENT ON FUNCTION public.reserve_ai_search_paid_call(text) IS
  'Atomically reserves one paid AI Search query. Refuses when the ledger, daily cap, or IP window is exhausted.';

NOTIFY pgrst, 'reload schema';

COMMIT;
