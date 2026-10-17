#!/bin/bash
# Apply Stage 126 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage126_$$"
cleanup() {
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null || true
}
trap cleanup EXIT
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${DB}\";" >/dev/null
psql_db() {
  sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}
psql_db -f "$ROOT/scripts/stage114-isolated-fixture.sql" >/dev/null
psql_db -c "ALTER TABLE public.analytics_events ADD COLUMN IF NOT EXISTS event_id uuid;" >/dev/null
psql_db -c "ALTER TABLE public.analytics_events ADD COLUMN IF NOT EXISTS visitor_id uuid;" >/dev/null
psql_db -c "ALTER TABLE public.analytics_events ADD COLUMN IF NOT EXISTS meta jsonb;" >/dev/null
psql_db -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END \$\$;" >/dev/null
before="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE126_ANALYTICS_ACTIVITY.sql" >/dev/null
started="$(psql_db -tA -c "SELECT started_at FROM private.analytics_action_attestation_counter")"
psql_db -f "$ROOT/STAGE126_ANALYTICS_ACTIVITY.sql" >/dev/null
started_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_action_attestation_counter")"
after="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$before" != "$after" || "$started" != "$started_again" ]]; then
  echo "repeat apply changed rows ${before}->${after} or the collection marker" >&2
  exit 1
fi
psql_db -f "$ROOT/scripts/stage126-isolated-assertions.sql" >/dev/null
preserved="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE126_ANALYTICS_ACTIVITY_ROLLBACK.sql" >/dev/null
if psql_db -tA -c "SELECT to_regclass('private.analytics_action_attestations')" | grep -q attestations; then
  echo "rollback left attestations" >&2
  exit 1
fi
after_rollback="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$preserved" != "$after_rollback" ]]; then
  echo "rollback changed analytics_events ${preserved}->${after_rollback}" >&2
  exit 1
fi
echo "STAGE126 isolated postgres: PASS rows=${after_rollback}"
