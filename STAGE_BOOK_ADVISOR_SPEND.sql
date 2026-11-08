-- GPT Book Advisor spend ledger.
-- Not applied to production. Does not alter AI Search tables, catalog rows, or series rows.
-- Limits live in private.book_advisor_policy. Callers cannot pass a remaining balance or a cap.
-- Reservation ids are generated in the database.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.book_advisor_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_limit_micro_usd bigint NOT NULL CHECK (daily_limit_micro_usd > 0),
  monthly_limit_micro_usd bigint NOT NULL CHECK (monthly_limit_micro_usd > 0),
  per_minute integer NOT NULL CHECK (per_minute > 0),
  minimum_reserve_micro_usd bigint NOT NULL CHECK (minimum_reserve_micro_usd > 0)
);

INSERT INTO private.book_advisor_policy (
  id, daily_limit_micro_usd, monthly_limit_micro_usd, per_minute, minimum_reserve_micro_usd
) VALUES (true, 2000000, 20000000, 6, 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.book_advisor_spend (
  period_kind text NOT NULL CHECK (period_kind IN ('day', 'month')),
  period_key text NOT NULL,
  spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
  reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
  PRIMARY KEY (period_kind, period_key)
);

CREATE TABLE IF NOT EXISTS private.book_advisor_reservations (
  id uuid PRIMARY KEY,
  client_hash text NOT NULL,
  reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd > 0),
  actual_micro_usd bigint,
  state text NOT NULL CHECK (state IN ('reserved', 'settled', 'released')),
  day_key text NOT NULL,
  month_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS private.book_advisor_rate (
  client_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests >= 0),
  PRIMARY KEY (client_hash, window_start)
);

CREATE TABLE IF NOT EXISTS private.book_advisor_sessions (
  id uuid PRIMARY KEY,
  client_hash text NOT NULL,
  book_ids bigint[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

REVOKE ALL ON TABLE private.book_advisor_policy FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.book_advisor_spend FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.book_advisor_reservations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.book_advisor_rate FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.book_advisor_sessions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reserve_book_advisor_spend(
  p_client_hash text,
  p_micro_usd bigint
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $reserve$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_month text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM');
  v_window timestamptz := date_trunc('minute', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_daily bigint;
  v_monthly bigint;
  v_per_minute integer;
  v_minimum bigint;
  v_count integer;
  v_day_used bigint;
  v_month_used bigint;
  v_id uuid;
BEGIN
  IF p_client_hash IS NULL OR p_client_hash !~ '^[a-f0-9]{64}$' OR p_micro_usd IS NULL OR p_micro_usd <= 0 THEN
    RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT daily_limit_micro_usd, monthly_limit_micro_usd, per_minute, minimum_reserve_micro_usd
  INTO v_daily, v_monthly, v_per_minute, v_minimum
  FROM private.book_advisor_policy
  WHERE id
  FOR UPDATE;
  IF NOT FOUND OR p_micro_usd < v_minimum THEN
    RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO private.book_advisor_spend (period_kind, period_key)
  VALUES ('day', v_day)
  ON CONFLICT DO NOTHING;
  INSERT INTO private.book_advisor_spend (period_kind, period_key)
  VALUES ('month', v_month)
  ON CONFLICT DO NOTHING;
  PERFORM 1
  FROM private.book_advisor_spend
  WHERE (period_kind = 'day' AND period_key = v_day)
     OR (period_kind = 'month' AND period_key = v_month)
  ORDER BY period_kind
  FOR UPDATE;
  INSERT INTO private.book_advisor_rate (client_hash, window_start, requests)
  VALUES (p_client_hash, v_window, 0)
  ON CONFLICT DO NOTHING;
  SELECT requests INTO v_count
  FROM private.book_advisor_rate
  WHERE client_hash = p_client_hash AND window_start = v_window
  FOR UPDATE;
  IF v_count >= v_per_minute THEN
    RAISE EXCEPTION 'advisor_rate_limit' USING ERRCODE = 'P0001';
  END IF;
  SELECT spent_micro_usd + reserved_micro_usd INTO v_day_used
  FROM private.book_advisor_spend
  WHERE period_kind = 'day' AND period_key = v_day;
  SELECT spent_micro_usd + reserved_micro_usd INTO v_month_used
  FROM private.book_advisor_spend
  WHERE period_kind = 'month' AND period_key = v_month;
  IF v_day_used + p_micro_usd > v_daily OR v_month_used + p_micro_usd > v_monthly THEN
    RAISE EXCEPTION 'advisor_budget' USING ERRCODE = 'P0001';
  END IF;
  UPDATE private.book_advisor_rate
  SET requests = requests + 1
  WHERE client_hash = p_client_hash AND window_start = v_window;
  UPDATE private.book_advisor_spend
  SET reserved_micro_usd = reserved_micro_usd + p_micro_usd
  WHERE period_kind = 'day' AND period_key = v_day;
  UPDATE private.book_advisor_spend
  SET reserved_micro_usd = reserved_micro_usd + p_micro_usd
  WHERE period_kind = 'month' AND period_key = v_month;
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO private.book_advisor_reservations (
    id, client_hash, reserved_micro_usd, state, day_key, month_key
  ) VALUES (
    v_id, p_client_hash, p_micro_usd, 'reserved', v_day, v_month
  );
  RETURN v_id;
END;
$reserve$;

CREATE OR REPLACE FUNCTION private.settle_book_advisor_spend(
  p_id uuid,
  p_actual_micro_usd bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $settle$
DECLARE
  v_row private.book_advisor_reservations%ROWTYPE;
  v_actual bigint;
BEGIN
  IF p_id IS NULL OR p_actual_micro_usd IS NULL OR p_actual_micro_usd < 0 THEN
    RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_row
  FROM private.book_advisor_reservations
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
  END IF;
  v_actual := least(p_actual_micro_usd, v_row.reserved_micro_usd);
  IF v_row.state = 'settled' THEN
    IF v_row.actual_micro_usd IS DISTINCT FROM v_actual THEN
      RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_row.actual_micro_usd;
  END IF;
  IF v_row.state <> 'reserved' THEN
    RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
  END IF;
  UPDATE private.book_advisor_spend
  SET reserved_micro_usd = reserved_micro_usd - v_row.reserved_micro_usd,
      spent_micro_usd = spent_micro_usd + v_actual
  WHERE period_kind = 'day' AND period_key = v_row.day_key;
  UPDATE private.book_advisor_spend
  SET reserved_micro_usd = reserved_micro_usd - v_row.reserved_micro_usd,
      spent_micro_usd = spent_micro_usd + v_actual
  WHERE period_kind = 'month' AND period_key = v_row.month_key;
  UPDATE private.book_advisor_reservations
  SET state = 'settled', actual_micro_usd = v_actual
  WHERE id = p_id;
  RETURN v_actual;
END;
$settle$;

CREATE OR REPLACE FUNCTION private.release_book_advisor_spend(p_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $release$
DECLARE
  v_row private.book_advisor_reservations%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_row
  FROM private.book_advisor_reservations
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND OR v_row.state = 'settled' THEN
    RAISE EXCEPTION 'advisor_budget_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.state = 'released' THEN
    RETURN v_row.reserved_micro_usd;
  END IF;
  UPDATE private.book_advisor_spend
  SET reserved_micro_usd = reserved_micro_usd - v_row.reserved_micro_usd
  WHERE period_kind = 'day' AND period_key = v_row.day_key;
  UPDATE private.book_advisor_spend
  SET reserved_micro_usd = reserved_micro_usd - v_row.reserved_micro_usd
  WHERE period_kind = 'month' AND period_key = v_row.month_key;
  UPDATE private.book_advisor_reservations
  SET state = 'released', actual_micro_usd = 0
  WHERE id = p_id;
  RETURN v_row.reserved_micro_usd;
END;
$release$;

CREATE OR REPLACE FUNCTION private.book_advisor_session_create(
  p_client_hash text,
  p_book_ids bigint[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $create_session$
DECLARE
  v_id uuid;
  v_ids bigint[];
BEGIN
  IF p_client_hash IS NULL OR p_client_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'advisor_unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(DISTINCT id), ARRAY[]::bigint[]) INTO v_ids
  FROM unnest(coalesce(p_book_ids, ARRAY[]::bigint[])) AS id
  WHERE id > 0;
  IF coalesce(cardinality(v_ids), 0) > 12 THEN
    RAISE EXCEPTION 'advisor_unavailable' USING ERRCODE = 'P0001';
  END IF;
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO private.book_advisor_sessions (id, client_hash, book_ids)
  VALUES (v_id, p_client_hash, coalesce(v_ids, ARRAY[]::bigint[]));
  RETURN v_id;
END;
$create_session$;

CREATE OR REPLACE FUNCTION private.book_advisor_session_read(
  p_session_id uuid,
  p_client_hash text
) RETURNS bigint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $read_session$
DECLARE
  v_ids bigint[];
BEGIN
  IF p_client_hash IS NULL OR p_client_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN ARRAY[]::bigint[];
  END IF;
  SELECT book_ids INTO v_ids
  FROM private.book_advisor_sessions
  WHERE id = p_session_id AND client_hash = p_client_hash;
  RETURN coalesce(v_ids, ARRAY[]::bigint[]);
END;
$read_session$;

CREATE OR REPLACE FUNCTION private.book_advisor_session_save(
  p_session_id uuid,
  p_client_hash text,
  p_book_ids bigint[]
) RETURNS bigint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $save_session$
DECLARE
  v_ids bigint[];
BEGIN
  IF p_client_hash IS NULL OR p_client_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'advisor_unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(DISTINCT id), ARRAY[]::bigint[]) INTO v_ids
  FROM unnest(coalesce(p_book_ids, ARRAY[]::bigint[])) AS id
  WHERE id > 0;
  IF coalesce(cardinality(v_ids), 0) > 12 THEN
    RAISE EXCEPTION 'advisor_unavailable' USING ERRCODE = 'P0001';
  END IF;
  UPDATE private.book_advisor_sessions
  SET book_ids = coalesce(v_ids, ARRAY[]::bigint[]), updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_session_id AND client_hash = p_client_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'advisor_unavailable' USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(v_ids, ARRAY[]::bigint[]);
END;
$save_session$;

REVOKE ALL ON FUNCTION private.reserve_book_advisor_spend(text, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.settle_book_advisor_spend(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.release_book_advisor_spend(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.book_advisor_session_create(text, bigint[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.book_advisor_session_read(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.book_advisor_session_save(uuid, text, bigint[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_book_advisor_spend(
  p_client_hash text,
  p_micro_usd bigint
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $public_reserve$
  SELECT private.reserve_book_advisor_spend(p_client_hash, p_micro_usd);
$public_reserve$;

CREATE OR REPLACE FUNCTION public.settle_book_advisor_spend(
  p_id uuid,
  p_actual_micro_usd bigint
) RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $public_settle$
  SELECT private.settle_book_advisor_spend(p_id, p_actual_micro_usd);
$public_settle$;

CREATE OR REPLACE FUNCTION public.release_book_advisor_spend(p_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $public_release$
  SELECT private.release_book_advisor_spend(p_id);
$public_release$;

CREATE OR REPLACE FUNCTION public.book_advisor_session_create(
  p_client_hash text,
  p_book_ids bigint[]
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $public_create$
  SELECT private.book_advisor_session_create(p_client_hash, p_book_ids);
$public_create$;

CREATE OR REPLACE FUNCTION public.book_advisor_session_read(
  p_session_id uuid,
  p_client_hash text
) RETURNS bigint[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $public_read$
  SELECT private.book_advisor_session_read(p_session_id, p_client_hash);
$public_read$;

CREATE OR REPLACE FUNCTION public.book_advisor_session_save(
  p_session_id uuid,
  p_client_hash text,
  p_book_ids bigint[]
) RETURNS bigint[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $public_save$
  SELECT private.book_advisor_session_save(p_session_id, p_client_hash, p_book_ids);
$public_save$;

REVOKE ALL ON FUNCTION public.reserve_book_advisor_spend(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_book_advisor_spend(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_book_advisor_spend(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_advisor_session_create(text, bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_advisor_session_read(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_advisor_session_save(uuid, text, bigint[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_book_advisor_spend(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_book_advisor_spend(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_book_advisor_spend(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_advisor_session_create(text, bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_advisor_session_read(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_advisor_session_save(uuid, text, bigint[]) TO service_role;

COMMIT;
