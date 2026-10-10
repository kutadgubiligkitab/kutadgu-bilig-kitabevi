#!/bin/bash
# Apply Stage 118 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage118_$$"
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
psql_db -q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END \$\$;"
visit_started="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
psql_db -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql" >/dev/null
country_started="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
events_before="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
receipts_before="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts")"
psql_db -f "$ROOT/STAGE118_VISIT_COUNTRY_HISTORY.sql" >/dev/null
psql_db -f "$ROOT/STAGE118_VISIT_COUNTRY_HISTORY.sql" >/dev/null
country_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
visit_again="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
events_again="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
receipts_again="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts")"
if [[ "$country_started" != "$country_again" || "$visit_started" != "$visit_again" || "$events_before" != "$events_again" || "$receipts_before" != "$receipts_again" ]]; then
  echo "repeat apply moved markers or rows" >&2
  exit 1
fi
if psql_db -tA -c "SET ROLE anon; SELECT public.get_kutadgu_visit_country_history(7);" >/tmp/stage118-anon.out 2>/tmp/stage118-anon.err; then
  echo "anon executed history" >&2
  exit 1
fi
if psql_db -tA -c "SET ROLE service_role; SELECT public.get_kutadgu_visit_country_history(7);" >/tmp/stage118-service.out 2>/tmp/stage118-service.err; then
  echo "service_role executed history" >&2
  exit 1
fi
if psql_db -tA -c "SELECT set_config('test.admin','',false); SELECT set_config('test.aal','aal2',false); SET ROLE authenticated; SELECT public.get_kutadgu_visit_country_history(7);" >/tmp/stage118-member.out 2>/tmp/stage118-member.err; then
  echo "ordinary member executed history" >&2
  exit 1
fi
if psql_db -tA -c "SELECT set_config('test.admin','on',false); SELECT set_config('test.aal','aal1',false); SET ROLE authenticated; SELECT public.get_kutadgu_visit_country_history(7);" >/tmp/stage118-aal1.out 2>/tmp/stage118-aal1.err; then
  echo "admin AAL1 executed history" >&2
  exit 1
fi
psql_db -f "$ROOT/scripts/stage118-isolated-assertions.sql" >/dev/null
"$ROOT/scripts/stage118-snapshot-race.sh" "$DB"
events_mid="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
receipts_mid="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts")"
visit_mid="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
country_mid="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
psql_db -f "$ROOT/STAGE118_VISIT_COUNTRY_HISTORY_ROLLBACK.sql" >/dev/null
if psql_db -tA -c "SELECT to_regprocedure('public.get_kutadgu_visit_country_history(integer,integer,integer,timestamptz,uuid)')" | grep -q get_kutadgu; then
  echo "rollback left the history function" >&2
  exit 1
fi
if psql_db -tA -c "SELECT to_regclass('private.kutadgu_visit_history_snapshots')" | grep -q kutadgu_visit_history_snapshots; then
  echo "rollback left the history snapshot table" >&2
  exit 1
fi
if psql_db -tA -c "SELECT to_regclass('private.kutadgu_visit_history_snapshot_members')" | grep -q kutadgu_visit_history_snapshot_members; then
  echo "rollback left the history snapshot members" >&2
  exit 1
fi
events_after="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
receipts_after="$(psql_db -tA -c "SELECT count(*) FROM private.analytics_visit_receipts")"
visit_after="$(psql_db -tA -c "SELECT started_at FROM private.analytics_visit_counter")"
country_after="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
report="$(psql_db -tA -c "SELECT (public.get_kutadgu_analytics(30) ? 'visit_countries')::text FROM (SELECT set_config('test.admin','on',true), set_config('test.aal','aal2',true)) AS ready")"
if [[ "$events_mid" != "$events_after" || "$receipts_mid" != "$receipts_after" || "$visit_mid" != "$visit_after" || "$country_mid" != "$country_after" || "$report" != "true" ]]; then
  echo "rollback changed rows, markers, or the country report events ${events_mid}->${events_after} receipts ${receipts_mid}->${receipts_after} visit ${visit_mid}->${visit_after} country ${country_mid}->${country_after} report ${report}" >&2
  exit 1
fi
psql_db -f "$ROOT/STAGE118_VISIT_COUNTRY_HISTORY.sql" >/dev/null
reapplied="$(psql_db -tA -c "SELECT public.get_kutadgu_visit_country_history(7,0,20,timestamptz '2026-09-15 12:00:00+03')->>'total' FROM (SELECT set_config('test.admin','on',true), set_config('test.aal','aal2',true)) AS ready")"
if [[ "$reapplied" != "21" ]]; then
  echo "reapply history total ${reapplied}" >&2
  exit 1
fi
events_final="$(psql_db -tA -c "SELECT count(*) FROM public.analytics_events")"
country_final="$(psql_db -tA -c "SELECT started_at FROM private.analytics_country_counter")"
if [[ "$events_final" != "$events_after" || "$country_final" != "$country_after" ]]; then
  echo "reapply changed events or the country marker" >&2
  exit 1
fi
echo "stage118-isolated-postgres ok"
