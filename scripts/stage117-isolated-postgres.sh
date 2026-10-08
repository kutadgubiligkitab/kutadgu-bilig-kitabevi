#!/bin/bash
# Apply Stage 117 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage117_$$"
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
psql_db -f "$ROOT/STAGE114_THREE_HOUR_VISITS.sql" >/dev/null
psql_db -f "$ROOT/STAGE115_ANALYTICS_EVENT_ID.sql" >/dev/null
psql_db -f "$ROOT/STAGE116_ADMIN_ANALYTICS_LISTS.sql" >/dev/null
visit_started="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
events_before="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END \$\$;"
psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql" >/dev/null
country_started="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql" >/dev/null
country_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
visit_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
events_again="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$country_started" != "$country_again" || "$visit_started" != "$visit_again" || "$events_before" != "$events_again" ]]; then
  echo "repeat apply moved country start ${country_started}->${country_again}, visit start ${visit_started}->${visit_again}, or rows ${events_before}->${events_again}" >&2
  exit 1
fi

visitor="12121212-1212-4121-8121-121212121212"
e1="13131313-1313-4131-8131-131313131313"
e2="14141414-1414-4141-8141-141414141414"
same="15151515-1515-4151-8151-151515151515"
stamp="2026-10-05 14:00:00+03"
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${e1}', timestamptz '${stamp}')" >/tmp/stage117-a.out &
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${e2}', timestamptz '${stamp}')" >/tmp/stage117-b.out &
wait
counted="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id='${visitor}' AND counted")"
receipts="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id='${visitor}'")"
if [[ "$counted" != "1" || "$receipts" != "2" ]]; then
  echo "simultaneous tabs counted ${counted} visits across ${receipts} receipts" >&2
  exit 1
fi
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${same}', timestamptz '2026-10-05 18:00:00+03')" >/tmp/stage117-c.out &
psql_db -tA -c "SELECT private.kutadgu_accept_page_visit('${visitor}', '${same}', timestamptz '2026-10-05 18:00:00+03')" >/tmp/stage117-d.out &
wait
dup="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id='${same}'")"
if [[ "$dup" != "1" ]]; then
  echo "duplicate delivery created ${dup} receipts" >&2
  exit 1
fi

psql_db -f "$ROOT/scripts/stage117-isolated-assertions.sql" >/dev/null
country_before_gap="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
psql_db -f "$ROOT/scripts/stage117-isolated-coverage-failure.sql" >/dev/null
psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql" >/dev/null
country_after_gap="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
if [[ "$country_before_gap" != "$country_after_gap" ]]; then
  echo "counter recovery reapply moved country start ${country_before_gap}->${country_after_gap}" >&2
  exit 1
fi
psql_db -f "$ROOT/scripts/stage117-isolated-coverage-recovery.sql" >/dev/null

preserved="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES_ROLLBACK.sql" >/dev/null
after_rollback="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
visit_after="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
country_gone="$(psql_db -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='analytics_events' AND column_name='country'")"
counter_gone="$(psql_db -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='private' AND table_name='analytics_country_counter'")"
report="$(psql_db -tA -c "WITH cfg AS (SELECT set_config('test.admin','on',true) AS admin_on, set_config('test.aal','aal2',true) AS aal) SELECT (public.get_kutadgu_analytics(30) ? 'visit_countries')::text || '|' || (public.get_kutadgu_analytics(30) ? 'counted_visits')::text FROM cfg")"
country_key="${report%%|*}"
counted_key="${report##*|}"
if [[ "$preserved" != "$after_rollback" || "$visit_started" != "$visit_after" || "$country_gone" != "0" || "$counter_gone" != "0" || "$country_key" != "false" || "$counted_key" != "true" ]]; then
  echo "rollback changed rows ${preserved}->${after_rollback}, visit start ${visit_started}->${visit_after}, country column ${country_gone}, counter ${counter_gone}, visit_countries ${country_key}, counted_visits ${counted_key}" >&2
  exit 1
fi

psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql" >/dev/null
reapplied="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql" >/dev/null
reapplied_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
visit_final="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
events_final="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$reapplied" != "$reapplied_again" || "$reapplied" == "$country_started" || "$visit_final" != "$visit_started" || "$events_final" != "$after_rollback" ]]; then
  echo "reapply moved the new country start ${reapplied}->${reapplied_again} or restored the rolled-back start ${country_started}; visit ${visit_final}; rows ${events_final}" >&2
  exit 1
fi
echo "STAGE117 isolated postgres: PASS rows=${events_final}"
