#!/bin/bash
# Apply Stage 114 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage114_$$"
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
before="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE114_THREE_HOUR_VISITS.sql" >/dev/null
started="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
psql_db -f "$ROOT/STAGE114_THREE_HOUR_VISITS.sql" >/dev/null
started_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
after="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$before" != "$after" || "$started" != "$started_again" ]]; then
  echo "repeat apply changed rows ${before}->${after} or collection start" >&2
  exit 1
fi
psql_db -f "$ROOT/scripts/stage114-isolated-assertions.sql" >/dev/null

visitor="12121212-1212-4121-8121-121212121212"
e1="13131313-1313-4131-8131-131313131313"
e2="14141414-1414-4141-8141-141414141414"
same="15151515-1515-4151-8151-151515151515"
stamp="2026-10-05 14:00:00+03"
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${e1}', timestamptz '${stamp}')" >/tmp/stage114-a.out &
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${e2}', timestamptz '${stamp}')" >/tmp/stage114-b.out &
wait
counted="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id='${visitor}' AND counted")"
receipts="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id='${visitor}'")"
if [[ "$counted" != "1" || "$receipts" != "2" ]]; then
  echo "simultaneous tabs counted ${counted} visits across ${receipts} receipts" >&2
  exit 1
fi
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${same}', timestamptz '2026-10-05 18:00:00+03')" >/tmp/stage114-c.out &
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${same}', timestamptz '2026-10-05 18:00:00+03')" >/tmp/stage114-d.out &
wait
dup="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id='${same}'")"
if [[ "$dup" != "1" ]]; then
  echo "duplicate delivery created ${dup} receipts" >&2
  exit 1
fi

preserved="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE114_THREE_HOUR_VISITS_ROLLBACK.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage114-isolated-rollback-assertions.sql" >/dev/null
after_rollback="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$preserved" != "$after_rollback" ]]; then
  echo "rollback changed analytics rows ${preserved}->${after_rollback}" >&2
  exit 1
fi
psql_db -f "$ROOT/STAGE114_THREE_HOUR_VISITS.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage114-isolated-reapply-assertions.sql" >/dev/null
echo "STAGE114 isolated postgres: PASS rows=${after_rollback}"
