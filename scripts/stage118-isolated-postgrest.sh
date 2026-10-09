#!/bin/bash
# Prove the admin country-history RPC through PostgREST 14.5 and the client helper.
# Uses a throwaway database. Does not connect to production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage118_rest_$$"
PORT="${STAGE118_PORT:-3018}"
POSTGREST_BIN="${POSTGREST_BIN:-/tmp/postgrest}"
version="$("$POSTGREST_BIN" --version 2>/dev/null || true)"
case "$version" in
  *"14.5"*) ;;
  *) echo "expected PostgREST 14.5, got: $version" >&2; exit 1 ;;
esac
CONF="/tmp/${DB}.conf"
LOG="/tmp/${DB}.log"
PID=""
cleanup() {
  if [[ -n "$PID" ]]; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null || true
  rm -f "$CONF"
}
trap cleanup EXIT
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN PASSWORD 'postgrest-local' NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;
ALTER ROLE service_role NOLOGIN BYPASSRLS;
SQL
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/stage114-isolated-fixture.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE114_THREE_HOUR_VISITS.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE115_ANALYTICS_EVENT_ID.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE116_ADMIN_ANALYTICS_LISTS.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE117_VISIT_COUNTRIES.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE118_VISIT_COUNTRY_HISTORY.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/stage118-isolated-assertions.sql"
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "GRANT service_role TO authenticator;"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q <<SQL
GRANT CONNECT ON DATABASE "${DB}" TO authenticator;
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO authenticator, service_role;
SQL
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN coalesce(current_setting('request.jwt.claims', true), '') <> ''
      THEN current_setting('request.jwt.claims', true)::jsonb
    ELSE jsonb_build_object('aal', nullif(current_setting('test.aal', true), ''))
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_kutadgu_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    current_setting('test.admin', true) = 'on'
    OR coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'admin' = 'yes',
    false
  );
$$;
SQL
cat > "$CONF" <<EOF
db-uri = "postgres://authenticator:postgrest-local@127.0.0.1:5432/${DB}"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public"
jwt-secret = "01234567890123456789012345678901"
server-port = ${PORT}
EOF
"$POSTGREST_BIN" "$CONF" > "$LOG" 2>&1 &
PID=$!
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ "$ready" != "1" ]]; then
  echo "PostgREST did not start" >&2
  cat "$LOG" >&2
  exit 1
fi
psql_db() { sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -tA "$@"; }
events_before="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
receipts_before="$(psql_db -c "SELECT count(*) FROM private.analytics_visit_receipts")"
visit_before="$(psql_db -c "SELECT started_at FROM private.analytics_visit_counter")"
country_before="$(psql_db -c "SELECT started_at FROM private.analytics_country_counter")"
STAGE118_PORT="$PORT" STAGE118_DB="$DB" STAGE118_ROOT="$ROOT" node <<'NODE'
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const path = require("path");
const core = require(path.join(process.env.STAGE118_ROOT, "kutadgu-analytics-core.js"));
const port = process.env.STAGE118_PORT;
const db = process.env.STAGE118_DB;
const secret = "01234567890123456789012345678901";
function fail(message) { throw new Error(message); }
function b64url(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function jwt(claims) {
  const data = b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url(Object.assign({
    exp: Math.floor(Date.now() / 1000) + 3600
  }, claims));
  return data + "." + crypto.createHmac("sha256", secret).update(data).digest("base64url");
}
function psql(sql) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql], {
    encoding: "utf8"
  }).trim();
}
async function rpc(body, token) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch("http://127.0.0.1:" + port + "/rpc/get_kutadgu_visit_country_history", {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  return { status: response.status, text };
}
function parsed(text) {
  const value = JSON.parse(text);
  return typeof value === "string" ? JSON.parse(value) : value;
}
(async () => {
  const anon = await rpc({ p_days: 7 }, jwt({ role: "anon" }));
  if (anon.status === 200) fail("anon executed history " + anon.text);
  const member = await rpc({ p_days: 7 }, jwt({ role: "authenticated", aal: "aal2" }));
  if (member.status === 200) fail("ordinary member executed history " + member.text);
  const aal1 = await rpc({ p_days: 7 }, jwt({ role: "authenticated", aal: "aal1", admin: "yes" }));
  if (aal1.status === 200) fail("admin AAL1 executed history " + aal1.text);
  const service = await rpc({ p_days: 7 }, jwt({ role: "service_role", aal: "aal2", admin: "yes" }));
  if (service.status === 200) fail("service_role executed history " + service.text);
  const hidden = await fetch("http://127.0.0.1:" + port + "/analytics_visit_receipts", {
    headers: { Accept: "application/json", Authorization: "Bearer " + jwt({ role: "anon" }) }
  });
  if (hidden.status === 200) fail("anon read the receipt table");
  const admin = jwt({ role: "authenticated", aal: "aal2", admin: "yes" });
  const septemberBody = {
    p_days: 7,
    p_offset: 0,
    p_limit: 20,
    p_as_of: "2026-09-15T09:00:00Z"
  };
  const firstCall = await rpc(septemberBody, admin);
  if (firstCall.status !== 200) fail("admin AAL2 status " + firstCall.status + " " + firstCall.text);
  if (/event_id|visitor_id|"ip"/i.test(firstCall.text)) fail("history payload exposed a private identifier");
  const first = core.normalizeVisitCountryHistory(parsed(firstCall.text));
  if (!first || first.total !== 21 || first.rows.length !== 20 || !first.hasMore) fail("first page " + firstCall.text);
  if (first.rows[0].label !== "نامەلۇم" || first.rows[0].stamp !== "2026-09-12 09:00") fail("unknown row " + JSON.stringify(first.rows[0]));
  if (first.rows[1].label !== "گېرمانىيە" || first.rows[2].label !== "فرانسىيە") fail("tie order " + first.rows[1].label + " " + first.rows[2].label);
  if (first.rows[1].stamp !== first.rows[2].stamp) fail("equal timestamps diverged");
  const session = {
    mode: "history",
    days: first.days,
    asOf: first.asOf,
    total: first.total,
    rangeStart: first.rangeStart,
    rangeEnd: first.rangeEnd
  };
  const pageRequest = core.visitCountryHistoryRequest({
    kind: "page",
    selectedDays: 90,
    session,
    offset: 20,
    limit: 20
  });
  if (!pageRequest || pageRequest.p_days !== 7 || pageRequest.p_offset !== 20 || pageRequest.p_as_of !== first.asOf) {
    fail("client page request " + JSON.stringify(pageRequest));
  }
  const secondCall = await rpc(pageRequest, admin);
  if (secondCall.status !== 200) fail("second page status " + secondCall.text);
  const second = core.normalizeVisitCountryHistory(parsed(secondCall.text));
  if (!second || second.total !== 21 || second.rows.length !== 1 || second.hasMore) fail("second page " + secondCall.text);
  if (!core.visitCountryHistoryPageMatches(session, second, 20)) fail("second page left the snapshot");
  if (second.rows[0].stamp !== "2026-09-10 10:00") fail("oldest row " + second.rows[0].stamp);
  if (/JP|ئىتالىيە|ياپونىيە/.test(secondCall.text)) fail("later row entered the open snapshot");
  const currentRequest = core.visitCountryHistoryRequest({ kind: "initial", selectedDays: 7, limit: 20 });
  if (currentRequest.p_as_of) fail("initial request sent a snapshot");
  const currentCall = await rpc(currentRequest, admin);
  if (currentCall.status !== 200) fail("current window " + currentCall.text);
  const current = core.normalizeVisitCountryHistory(parsed(currentCall.text));
  if (!current || current.total !== 2) fail("current total " + (current && current.total));
  const arrivalAt = new Date(Date.parse(current.asOf) + 1000).toISOString();
  psql("INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country) VALUES ('40000000-0000-4000-8000-000000000001', 'hist-arrival', true, '" + arrivalAt + "'::timestamptz, 'US')");
  const retained = core.visitCountryHistoryRequest({
    kind: "page",
    selectedDays: 90,
    session: {
      mode: "history",
      days: current.days,
      asOf: current.asOf,
      total: current.total,
      rangeStart: current.rangeStart,
      rangeEnd: current.rangeEnd
    },
    offset: 0,
    limit: 20
  });
  const retainedCall = await rpc(retained, admin);
  const retainedPage = core.normalizeVisitCountryHistory(parsed(retainedCall.text));
  if (!retainedPage || retainedPage.total !== 2) fail("open snapshot shifted to " + retainedCall.text);
  if (retainedPage.rows.some((row) => row.label === "ئامېرىكا")) fail("new arrival entered the open snapshot");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const refreshRequest = core.visitCountryHistoryRequest({ kind: "refresh", selectedDays: 7, limit: 20 });
  if (Object.prototype.hasOwnProperty.call(refreshRequest, "p_as_of")) fail("refresh reused a snapshot");
  const refreshCall = await rpc(refreshRequest, admin);
  const refresh = core.normalizeVisitCountryHistory(parsed(refreshCall.text));
  if (!refresh || refresh.total !== 3 || refresh.rows[0].label !== "ئامېرىكا") fail("refresh missed the arrival " + refreshCall.text);
  if (refresh.asOf === current.asOf) fail("refresh kept the old snapshot");
  const quietCall = await rpc({ p_days: 1, p_offset: 0, p_limit: 20, p_as_of: "2026-09-02T09:00:00Z" }, admin);
  const quiet = core.normalizeVisitCountryHistory(parsed(quietCall.text));
  if (!quiet || quiet.status !== "zero" || quiet.total !== 0 || quiet.rows.length !== 0) fail("quiet interval " + quietCall.text);
  const unavailableCall = await rpc({ p_days: 7, p_offset: 0, p_limit: 20, p_as_of: "2026-08-20T09:00:00Z" }, admin);
  const unavailable = core.normalizeVisitCountryHistory(parsed(unavailableCall.text));
  if (!unavailable || unavailable.status !== "unavailable" || unavailable.rows !== null || unavailable.total !== null) {
    fail("unavailable " + unavailableCall.text);
  }
  console.log("stage118-postgrest client path ok");
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
NODE
events_mid="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
receipts_mid="$(psql_db -c "SELECT count(*) FROM private.analytics_visit_receipts")"
visit_mid="$(psql_db -c "SELECT started_at FROM private.analytics_visit_counter")"
country_mid="$(psql_db -c "SELECT started_at FROM private.analytics_country_counter")"
if [[ "$events_mid" -lt "$events_before" || "$receipts_mid" -lt "$receipts_before" || "$visit_mid" != "$visit_before" || "$country_mid" != "$country_before" ]]; then
  echo "history reads changed stored rows or markers" >&2
  exit 1
fi
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE118_VISIT_COUNTRY_HISTORY_ROLLBACK.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "NOTIFY pgrst, 'reload schema';"
sleep 0.4
STAGE118_PORT="$PORT" node <<'NODE'
const crypto = require("crypto");
const port = process.env.STAGE118_PORT;
const secret = "01234567890123456789012345678901";
function b64url(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
const data = b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url({
  role: "authenticated",
  aal: "aal2",
  admin: "yes",
  exp: Math.floor(Date.now() / 1000) + 3600
});
const token = data + "." + crypto.createHmac("sha256", secret).update(data).digest("base64url");
fetch("http://127.0.0.1:" + port + "/rpc/get_kutadgu_visit_country_history", {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: "Bearer " + token
  },
  body: JSON.stringify({ p_days: 7 })
}).then(async (response) => {
  const text = await response.text();
  const core = require(process.env.STAGE118_ROOT ? process.env.STAGE118_ROOT + "/kutadgu-analytics-core.js" : "/workspace/kutadgu-analytics-core.js");
  let body = {};
  try { body = JSON.parse(text); } catch (err) { body = { message: text }; }
  if (response.status === 200) throw new Error("rollback left the history RPC " + text);
  if (!core.missingVisitCountryHistoryRpc(body)) throw new Error("rollback error was not a missing RPC " + text);
  console.log("stage118-postgrest rollback hides the RPC");
}).catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
NODE
events_after="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
receipts_after="$(psql_db -c "SELECT count(*) FROM private.analytics_visit_receipts")"
visit_after="$(psql_db -c "SELECT started_at FROM private.analytics_visit_counter")"
country_after="$(psql_db -c "SELECT started_at FROM private.analytics_country_counter")"
report="$(psql_db -c "SELECT (public.get_kutadgu_analytics(30) ? 'visit_countries')::text FROM (SELECT set_config('test.admin','on',true), set_config('test.aal','aal2',true)) AS ready")"
if [[ "$events_after" != "$events_mid" || "$receipts_after" != "$receipts_mid" || "$visit_after" != "$visit_mid" || "$country_after" != "$country_mid" || "$report" != "true" ]]; then
  echo "rollback changed rows, markers, or the country report" >&2
  exit 1
fi
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE118_VISIT_COUNTRY_HISTORY.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "NOTIFY pgrst, 'reload schema';"
sleep 0.4
reapplied="$(psql_db -c "SELECT public.get_kutadgu_visit_country_history(7,0,20,timestamptz '2026-09-15 12:00:00+03')->>'total' FROM (SELECT set_config('test.admin','on',true), set_config('test.aal','aal2',true)) AS ready")"
if [[ "$reapplied" != "21" ]]; then
  echo "reapply history total ${reapplied}" >&2
  exit 1
fi
events_final="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
country_final="$(psql_db -c "SELECT started_at FROM private.analytics_country_counter")"
if [[ "$events_final" != "$events_after" || "$country_final" != "$country_after" ]]; then
  echo "reapply changed events or the country marker" >&2
  exit 1
fi
echo "stage118-isolated-postgrest ok"
