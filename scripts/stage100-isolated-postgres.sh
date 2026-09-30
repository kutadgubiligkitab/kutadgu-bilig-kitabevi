#!/bin/bash
# Apply STAGE100 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage100_$$"
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
psql_db -f "$ROOT/STAGE100_ADMIN_DAILY_VISITORS.sql" >/dev/null
psql_db -f "$ROOT/STAGE100_ADMIN_DAILY_VISITORS.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage100-isolated-load.sql" >/dev/null
before="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE100_ADMIN_DAILY_VISITORS.sql" >/dev/null
after="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$before" != "$after" ]]; then
  echo "repeat apply changed row count from $before to $after" >&2
  exit 1
fi
psql_db -f "$ROOT/scripts/stage100-isolated-assertions.sql"
psql_db -f "$ROOT/STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage100-isolated-rollback-assertions.sql"
psql_db -f "$ROOT/STAGE100_ADMIN_DAILY_VISITORS.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage100-isolated-reapply-assertions.sql"
echo "STAGE100 isolated postgres: PASS rows=${after}"
