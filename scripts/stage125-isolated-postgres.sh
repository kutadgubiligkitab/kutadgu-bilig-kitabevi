#!/bin/bash
# Apply Stage 125 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage125_$$"
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
psql_db -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END \$\$;" >/dev/null
psql_db -f "$ROOT/STAGE114_THREE_HOUR_VISITS.sql" >/dev/null
psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql" >/dev/null
before="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE125_VERIFIED_VISITS.sql" >/dev/null
started="$(psql_db -tA -c "SELECT started_at FROM private.analytics_verified_counter")"
psql_db -f "$ROOT/STAGE125_VERIFIED_VISITS.sql" >/dev/null
started_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_verified_counter")"
after="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$before" != "$after" || "$started" != "$started_again" ]]; then
  echo "repeat apply changed rows ${before}->${after} or collection start" >&2
  exit 1
fi
psql_db -f "$ROOT/scripts/stage125-isolated-assertions.sql" >/dev/null

visitor="22222222-2222-4222-8222-222222222222"
e1="23232323-2323-4232-8232-232323232323"
e2="24242424-2424-4242-8242-242424242424"
same="25252525-2525-4252-8252-252525252525"
stamp="2026-10-05 14:00:00+03"
psql_db -tA -c "SELECT private.kutadgu_accept_verified_visit('${visitor}', '${e1}', 'TR', timestamptz '${stamp}')" >/tmp/stage125-a.out &
psql_db -tA -c "SELECT private.kutadgu_accept_verified_visit('${visitor}', '${e2}', 'DE', timestamptz '${stamp}')" >/tmp/stage125-b.out &
wait
counted="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_verified_receipts WHERE visitor_id='${visitor}' AND counted")"
receipts="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_verified_receipts WHERE visitor_id='${visitor}'")"
if [[ "$counted" != "1" || "$receipts" != "2" ]]; then
  echo "simultaneous tabs counted ${counted} visits across ${receipts} receipts" >&2
  exit 1
fi
psql_db -tA -c "SELECT private.kutadgu_accept_verified_visit('${visitor}', '${same}', 'TR', timestamptz '2026-10-05 18:00:00+03')" >/tmp/stage125-c.out &
psql_db -tA -c "SELECT private.kutadgu_accept_verified_visit('${visitor}', '${same}', 'TR', timestamptz '2026-10-05 18:00:00+03')" >/tmp/stage125-d.out &
wait
dup="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_verified_receipts WHERE event_id='${same}'")"
if [[ "$dup" != "1" ]]; then
  echo "duplicate delivery created ${dup} receipts" >&2
  exit 1
fi

preserved="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
legacy="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts")"
psql_db -f "$ROOT/STAGE125_VERIFIED_VISITS_ROLLBACK.sql" >/dev/null
if psql_db -tA -c "SELECT to_regclass('private.analytics_verified_receipts')" | grep -q analytics; then
  echo "rollback left verified receipts" >&2
  exit 1
fi
restored="$(psql_db -tA -c "SELECT pg_get_functiondef('public.get_kutadgu_analytics(integer)'::regprocedure)")"
if [[ "$restored" == *verified_visits* ]]; then
  echo "rollback left the verified analytics key" >&2
  exit 1
fi
after_rollback="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
legacy_after="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts")"
if [[ "$preserved" != "$after_rollback" || "$legacy" != "$legacy_after" ]]; then
  echo "rollback changed historical rows" >&2
  exit 1
fi
echo "STAGE125 isolated postgres: PASS rows=${after_rollback}"
