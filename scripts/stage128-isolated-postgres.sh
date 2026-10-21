#!/bin/bash
# Apply Stages 127/128 on a throwaway local database. Never production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage128_$$"
TMP_A="/tmp/${DB}-a.log"
TMP_B="/tmp/${DB}-b.log"
cleanup() {
  rm -f "$TMP_A" "$TMP_B"
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null || true
}
trap cleanup EXIT
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${DB}\";" >/dev/null
psql_db() {
  sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

psql_db -f "$ROOT/scripts/stage127-isolated-fixture.sql" >/dev/null
psql_db -f "$ROOT/STAGE127_BOOK_VOLUME_GROUPS.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage128-isolated-fixture.sql" >/dev/null
psql_db -f "$ROOT/STAGE128_BOOK_VOLUME_COMMERCE.sql" >/dev/null
psql_db -f "$ROOT/STAGE128_BOOK_VOLUME_COMMERCE.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage128-isolated-assertions.sql" >/dev/null

# Two independently prepared orders compete for 15 of the same 20 copies.
# Deterministic row locking permits exactly one commit.
psql_db -q -c "
  INSERT INTO public.orders (order_no,user_id,status,items,total,total_qty)
  VALUES
    ('KB-261020-EFGHJKLM','11111111-1111-4111-8111-111111111111','prepared',
     '[{\"book_id\":40,\"title\":\"Concurrent A\",\"price\":400,\"qty\":15,\"line_total\":6000}]',6000,15),
    ('KB-261020-FGHJKLMN','11111111-1111-4111-8111-111111111111','prepared',
     '[{\"book_id\":40,\"title\":\"Concurrent B\",\"price\":400,\"qty\":15,\"line_total\":6000}]',6000,15);
" >/dev/null

set +e
psql_db -q -c "BEGIN; UPDATE public.orders SET status='confirmed' WHERE order_no='KB-261020-EFGHJKLM'; SELECT pg_sleep(1); COMMIT;" >"$TMP_A" 2>&1 &
pid_a=$!
psql_db -q -c "UPDATE public.orders SET status='confirmed' WHERE order_no='KB-261020-FGHJKLMN';" >"$TMP_B" 2>&1 &
pid_b=$!
wait "$pid_a"; code_a=$?
wait "$pid_b"; code_b=$?
set -e
if [[ $(( (code_a == 0) + (code_b == 0) )) -ne 1 ]]; then
  echo "concurrent confirmation expected one success: a=${code_a} b=${code_b}" >&2
  cat "$TMP_A" "$TMP_B" >&2
  exit 1
fi
stock="$(psql_db -tA -c "SELECT stock FROM public.books WHERE id=40")"
committed="$(psql_db -tA -c "SELECT count(*) FROM public.orders WHERE order_no IN ('KB-261020-EFGHJKLM','KB-261020-FGHJKLMN') AND stock_committed")"
if [[ "$stock" != "5" || "$committed" != "1" ]]; then
  echo "concurrent stock mismatch stock=${stock} committed=${committed}" >&2
  exit 1
fi
psql_db -q -c "UPDATE public.orders SET status='cancelled' WHERE order_no IN ('KB-261020-EFGHJKLM','KB-261020-FGHJKLMN') AND stock_committed;" >/dev/null
if [[ "$(psql_db -tA -c "SELECT stock FROM public.books WHERE id=40")" != "20" ]]; then
  echo "concurrent winner cancellation did not restore stock" >&2
  exit 1
fi

orders_before="$(psql_db -tA -c "SELECT count(*) FROM public.orders")"
groups_before="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_groups")"
psql_db -f "$ROOT/STAGE128_BOOK_VOLUME_COMMERCE_ROLLBACK.sql" >/dev/null
if [[ "$(psql_db -tA -c "SELECT count(*) FROM public.orders")" != "$orders_before" ||
      "$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_groups")" != "$groups_before" ]]; then
  echo "rollback removed commerce data" >&2
  exit 1
fi
if [[ -z "$(psql_db -tA -c "SELECT to_regprocedure('public.kutadgu_order_inventory_lines(jsonb)')")" ]]; then
  echo "rollback removed component-aware inventory parser" >&2
  exit 1
fi
echo "STAGE128 isolated postgres: PASS orders=${orders_before} groups=${groups_before}"
