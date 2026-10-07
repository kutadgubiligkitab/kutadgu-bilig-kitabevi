#!/bin/bash
# Prove the public analytics insert against PostgREST 14.5.
# Uses a throwaway database and the anon role. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_analytics_insert_$$"
PORT="${ANALYTICS_INSERT_PORT:-3015}"
POSTGREST_BIN="${POSTGREST_BIN:-}"
if [[ -z "$POSTGREST_BIN" ]]; then
  if command -v postgrest >/dev/null 2>&1; then
    POSTGREST_BIN="$(command -v postgrest)"
  elif [[ -x /tmp/postgrest ]]; then
    POSTGREST_BIN=/tmp/postgrest
  else
    echo "PostgREST 14.5 is required (POSTGREST_BIN)" >&2
    exit 1
  fi
fi
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
END $$;
SQL
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/stage114-isolated-fixture.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE114_THREE_HOUR_VISITS.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q <<SQL
GRANT CONNECT ON DATABASE "${DB}" TO authenticator;
GRANT anon, authenticated TO authenticator;
GRANT USAGE ON SCHEMA public TO authenticator;
SQL
psql_db() { sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -tA "$@"; }
if [[ "$(psql_db -c "SELECT has_table_privilege('anon','public.analytics_events','insert')")" != "t" ]]; then
  echo "anon insert privilege missing" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT has_table_privilege('anon','public.analytics_events','select')")" != "f" ]]; then
  echo "anon select privilege must stay absent" >&2
  exit 1
fi
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
started="$(psql_db -c "SELECT started_at FROM private.analytics_visit_counter")"
historical="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
python3 - "$PORT" <<'PY'
import json, sys, urllib.error, urllib.request
port = sys.argv[1]
base = f"http://127.0.0.1:{port}"
visitor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
first = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
second = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
book = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
cart = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

def call(method, path, payload=None, prefer=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()

def row(event, event_id, **extra):
    body = {
        "event_name": event,
        "book_id": None,
        "search_query": None,
        "category": None,
        "result_count": None,
        "item_count": None,
        "order_total": None,
        "path": "/",
        "session_id": "probe-session",
        "visitor_id": visitor,
        "event_id": event_id,
    }
    body.update(extra)
    return body

status, text = call("POST", "/analytics_events", row("page_view", first), "return=minimal,resolution=ignore-duplicates")
assert status == 401 and "42501" in text and "permission denied for table analytics_events" in text, (status, text)
open("/tmp/analytics-insert-before.json", "w").write(json.dumps({"status": status, "body": text}))

status, text = call("POST", "/analytics_events", row("page_view", first), "return=minimal")
assert status == 201, (status, text)
status, text = call("POST", "/analytics_events", row("add_to_cart", cart, book_id="15", item_count=1, path="/book/15"), "return=minimal")
assert status == 201, (status, text)
status, text = call("POST", "/analytics_events", row("not_allowed", book), "return=minimal")
assert status == 401 and "row-level security policy" in text, (status, text)
status, text = call("GET", "/analytics_events?select=id&limit=1")
assert status == 401 and "permission denied for table analytics_events" in text, (status, text)
status, text = call("POST", "/rpc/get_kutadgu_analytics", {"p_days": 7})
assert status == 401, (status, text)
status, text = call("GET", "/analytics_visit_receipts?select=event_id&limit=1")
assert status == 404, (status, text)
print("before-index checks passed")
PY
if [[ "$(psql_db -c "SELECT count(*) FROM public.analytics_events WHERE event_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")" != "1" ]]; then
  echo "identified page view was not stored" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT counted FROM private.analytics_visit_receipts WHERE event_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")" != "t" ]]; then
  echo "first page view did not count" >&2
  exit 1
fi
gate="$(psql_db -c "SELECT last_counted_at FROM private.analytics_visit_gate WHERE visitor_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE115_ANALYTICS_EVENT_ID.sql"
if [[ "$(psql_db -c "SELECT started_at FROM private.analytics_visit_counter")" != "$started" ]]; then
  echo "unique index moved collection start" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT count(*) FROM public.analytics_events")" != "$(psql_db -c "SELECT count(*) FROM public.analytics_events WHERE event_id IS NULL") + 2" ]]; then
  :
fi
now_rows="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
expected=$((historical + 2))
if [[ "$now_rows" != "$expected" ]]; then
  echo "index apply changed row count ${historical} -> ${now_rows}, expected ${expected}" >&2
  exit 1
fi
python3 - "$PORT" <<'PY'
import json, sys, urllib.error, urllib.request
port = sys.argv[1]
base = f"http://127.0.0.1:{port}"
visitor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
first = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
second = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
book = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

def call(method, path, payload=None, prefer=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()

def row(event, event_id, **extra):
    body = {
        "event_name": event,
        "book_id": None,
        "search_query": None,
        "category": None,
        "result_count": None,
        "item_count": None,
        "order_total": None,
        "path": "/book/15",
        "session_id": "probe-session",
        "visitor_id": visitor,
        "event_id": event_id,
    }
    body.update(extra)
    return body

status, text = call("POST", "/analytics_events", row("page_view", first, path="/"), "return=minimal")
assert status == 409, (status, text)
status, text = call("POST", "/analytics_events", row("page_view", second), "return=minimal")
assert status == 201, (status, text)
status, text = call("POST", "/analytics_events", row("book_view", book, book_id="15"), "return=minimal")
assert status == 201, (status, text)
status, text = call("POST", "/analytics_events", row("page_view", "ffffffff-ffff-4fff-8fff-ffffffffffff", created_at="2020-01-01T00:00:00Z"), "return=minimal")
assert status == 401 and "row-level security policy" in text, (status, text)
open("/tmp/analytics-insert-after.json", "w").write(json.dumps({
    "retry": 409,
    "navigation": 201,
    "book_view": 201
}))
print("after-index checks passed")
PY
if [[ "$(psql_db -c "SELECT count(*) FROM public.analytics_events WHERE event_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")" != "1" ]]; then
  echo "event id retry stored another row" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")" != "1" ]]; then
  echo "event id retry stored another receipt" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT counted FROM private.analytics_visit_receipts WHERE event_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'")" != "f" ]]; then
  echo "same-browser navigation counted again" >&2
  exit 1
fi
gate_again="$(psql_db -c "SELECT last_counted_at FROM private.analytics_visit_gate WHERE visitor_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")"
if [[ "$gate" != "$gate_again" ]]; then
  echo "suppressed visit moved the gate" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'")" != "0" ]]; then
  echo "book view opened a counted visit" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT count(*) FROM public.analytics_events WHERE event_name='book_view' AND event_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'")" != "1" ]]; then
  echo "book view was not stored" >&2
  exit 1
fi
python3 - "$PORT" <<'PY'
import json, sys, urllib.error, urllib.request
port = sys.argv[1]
base = f"http://127.0.0.1:{port}"
visitor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
absent_id = "12121212-1212-4212-8212-121212121212"
plain_id = "13131313-1313-4313-8313-131313131313"

def call(payload, prefer="return=minimal"):
    data = json.dumps(payload).encode()
    headers = {"Accept": "application/json", "Content-Type": "application/json", "Prefer": prefer}
    req = urllib.request.Request(base + "/analytics_events", data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()

def row(event_id, **extra):
    body = {
        "event_name": "page_view",
        "book_id": None,
        "search_query": None,
        "category": None,
        "result_count": None,
        "item_count": None,
        "order_total": None,
        "path": "/",
        "session_id": "probe-session",
        "visitor_id": visitor,
        "event_id": event_id,
    }
    body.update(extra)
    return body

status, text = call(row(absent_id, host="www.kutadgubilik.com", action_seq=1, occurred_at="2026-10-07T12:00:00.000Z"))
assert status == 400 and "PGRST204" in text and "action_seq" in text, (status, text)
status, text = call(row(absent_id, host="www.kutadgubilik.com", occurred_at="2026-10-07T12:00:00.000Z"))
assert status == 400 and "PGRST204" in text and "host" in text, (status, text)
status, text = call(row(absent_id, occurred_at="2026-10-07T12:00:00.000Z"))
assert status == 400 and "PGRST204" in text and "occurred_at" in text, (status, text)
status, text = call(row(absent_id))
assert status == 201, (status, text)
status, text = call(row(plain_id))
assert status == 201, (status, text)
req = urllib.request.Request(base + "/analytics_events?select=id&limit=1", method="GET")
try:
    with urllib.request.urlopen(req, timeout=10) as res:
        get_status, get_text = res.status, res.read().decode()
except urllib.error.HTTPError as err:
    get_status, get_text = err.code, err.read().decode()
assert get_status == 401 and "permission denied for table analytics_events" in get_text, (get_status, get_text)
print("absent-column checks passed")
PY
if [[ "$(psql_db -c "SELECT count(*) FROM public.analytics_events WHERE event_id='12121212-1212-4212-8212-121212121212'")" != "1" ]]; then
  echo "missing-column retries stored more than the final insert" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT has_table_privilege('anon','public.analytics_events','select')")" != "f" ]]; then
  echo "anon select privilege appeared" >&2
  exit 1
fi
echo "analytics insert postgrest: PASS"
