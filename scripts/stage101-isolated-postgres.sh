#!/bin/bash
# Apply Stage 101 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage101_$$"
cleanup() {
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null || true
}
trap cleanup EXIT
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${DB}\";" >/dev/null
psql_db() {
  sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}
psql_db -f "$ROOT/scripts/stage100-isolated-fixture.sql" >/dev/null
if psql_db -tA -c "SELECT count(*) FROM pg_proc WHERE proname = 'get_kutadgu_analytics'" | grep -qx '1'; then
  echo "fixture unexpectedly created get_kutadgu_analytics" >&2
  exit 1
fi
psql_db -f "$ROOT/STAGE101_ADMIN_ZERO_SEARCHES.sql" >/dev/null
psql_db -f "$ROOT/STAGE101_ADMIN_ZERO_SEARCHES.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage101-isolated-assertions.sql"
legacy_rows="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE100_ADMIN_DAILY_VISITORS.sql" >/dev/null
after_stage100="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$legacy_rows" != "$after_stage100" ]]; then
  echo "STAGE100 changed analytics row count from $legacy_rows to $after_stage100" >&2
  exit 1
fi
psql_db -f "$ROOT/scripts/stage101-isolated-assertions.sql"
psql_db -f "$ROOT/STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage101-isolated-rollback-assertions.sql"
psql_db -f "$ROOT/STAGE101_ADMIN_ZERO_SEARCHES.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage101-isolated-assertions.sql"
final_rows="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
echo "STAGE101 isolated postgres: PASS legacy_rows=${legacy_rows} final_rows=${final_rows}"
