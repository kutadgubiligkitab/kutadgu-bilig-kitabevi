-- Reviewed migration. Do not apply this to production until it has been reviewed separately.
-- Production still settles with LEAST(actual, reserved), which can hide a charge above the reservation.
-- This replacement records the full actual charge without changing the daily or monthly caps.

CREATE OR REPLACE FUNCTION private.settle_book_advisor_spend(
  p_id uuid,
  p_actual_micro_usd bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $settle_actual$
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
  v_actual := p_actual_micro_usd;
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
$settle_actual$;
