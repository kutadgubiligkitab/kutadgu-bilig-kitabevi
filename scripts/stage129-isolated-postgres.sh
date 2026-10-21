#!/bin/bash
# Apply Stage 129 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage129_$$"
cleanup() {
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null || true
}
trap cleanup EXIT
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${DB}\";" >/dev/null
psql_db() {
  sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

psql_db -f "$ROOT/scripts/stage129-isolated-fixture.sql" >/dev/null
psql_db -f "$ROOT/STAGE129_SHARED_CART_TYPED_LINES.sql" >/dev/null
psql_db -f "$ROOT/STAGE129_SHARED_CART_TYPED_LINES.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage129-isolated-assertions.sql" >/dev/null
psql_db -f "$ROOT/STAGE129_SHARED_CART_TYPED_LINES_ROLLBACK.sql" >/dev/null

kept="$(psql_db -tA -c "SELECT public.shared_cart_items_valid(items) FROM public.shared_cart_links WHERE code='ABCDEFGH'")"
if [[ "$kept" != "t" ]]; then
  echo "rollback invalidated an existing typed shared cart" >&2
  exit 1
fi

psql_db -c "DELETE FROM public.shared_cart_links" >/dev/null
psql_db -f "$ROOT/STAGE129_SHARED_CART_TYPED_LINES_ROLLBACK.sql" >/dev/null
legacy="$(psql_db -tA -c "SELECT public.shared_cart_items_valid('[{\"id\":\"12\",\"qty\":2}]'::jsonb)")"
typed="$(psql_db -tA -c "SELECT public.shared_cart_items_valid('[{\"kind\":\"set\",\"group_id\":\"7\",\"qty\":1}]'::jsonb)")"
if [[ "$legacy" != "t" || "$typed" != "f" ]]; then
  echo "empty-table rollback did not restore the v1-only validator" >&2
  exit 1
fi

echo "STAGE129 isolated postgres: PASS typed_rows_preserved=1"
