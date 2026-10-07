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
ANALYTICS_CLIENT_PORT="$PORT" ANALYTICS_CLIENT_DB="$DB" ANALYTICS_CLIENT_ROOT="$ROOT" node <<'JS'
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const port = process.env.ANALYTICS_CLIENT_PORT;
const db = process.env.ANALYTICS_CLIENT_DB;
const root = process.env.ANALYTICS_CLIENT_ROOT;
const jwtSecret = "01234567890123456789012345678901";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const absent = ["host", "occurred_at", "action_seq"];

function fail(message) {
  throw new Error(message);
}

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function anonJwt() {
  const data = b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url({
    role: "anon",
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  return data + "." + crypto.createHmac("sha256", jwtSecret).update(data).digest("base64url");
}

function psql(sql) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql], {
    encoding: "utf8"
  }).trim();
}

function qid(value) {
  const id = String(value || "").toLowerCase();
  if (!UUID.test(id)) fail("unexpected id " + id);
  return id;
}

function memoryStorage() {
  const data = Object.create(null);
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function startProxy() {
  const server = http.createServer(async (req, res) => {
    try {
      const dest = req.url.replace(/^\/rest\/v1(?=\/|\?|$)/, "") || "/";
      const body = await readBody(req);
      const headers = {};
      ["authorization", "apikey", "content-type", "prefer", "accept"].forEach((name) => {
        if (req.headers[name]) headers[name] = req.headers[name];
      });
      const upstream = await fetch("http://127.0.0.1:" + port + dest, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      const type = upstream.headers.get("content-type");
      res.writeHead(upstream.status, type ? { "content-type": type } : {});
      res.end(buf);
    } catch (err) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(String(err && err.message || err));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function loadClient(origin, fetchImpl, storage) {
  const listeners = {};
  const document = {
    readyState: "loading",
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    dispatchEvent() {}
  };
  const sandbox = {
    console,
    crypto: globalThis.crypto,
    fetch: fetchImpl,
    sessionStorage: storage.session,
    localStorage: storage.local,
    document,
    location: { hostname: "www.kutadgubilik.com", pathname: "/index.html" },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "kutadgu-analytics-core.js"), "utf8"), sandbox, { filename: "kutadgu-analytics-core.js" });
  sandbox.KUTADGU_SUPABASE_CONFIG = { url: origin, anonKey: anonJwt() };
  vm.runInContext(fs.readFileSync(path.join(root, "analytics.js"), "utf8"), sandbox, { filename: "analytics.js" });
  return { sandbox, listeners };
}

async function openPage(loaded) {
  const fns = loaded.listeners.DOMContentLoaded || [];
  if (fns.length !== 1) fail("page listener count " + fns.length);
  await fns[0]();
}

function assertShape(body) {
  absent.forEach((col) => {
    if (Object.prototype.hasOwnProperty.call(body, col)) fail("sent " + col);
  });
  if (!UUID.test(String(body.visitor_id || ""))) fail("visitor_id missing");
  if (!UUID.test(String(body.event_id || ""))) fail("event_id missing");
  if (body.event_name !== "page_view") fail("event " + body.event_name);
}

function recordingFetch(posts) {
  return async function (url, init) {
    const method = String((init && init.method) || "GET").toUpperCase();
    const headers = (init && init.headers) || {};
    let slot = null;
    if (method === "POST") {
      slot = { body: JSON.parse(init.body), prefer: headers.Prefer || headers.prefer || "" };
      posts.push(slot);
    }
    const res = await fetch(url, init);
    if (slot) slot.status = res.status;
    return res;
  };
}

async function main() {
  const proxy = await startProxy();
  const origin = "http://127.0.0.1:" + proxy.address().port;
  try {
    const posts = [];
    const storage = { local: memoryStorage(), session: memoryStorage() };
    const client = loadClient(origin, recordingFetch(posts), storage);
    await openPage(client);
    if (posts.length !== 1) fail("first page_view requests " + posts.length + " " + JSON.stringify(posts));
    const first = posts[0];
    if (first.status !== 201) fail("first page_view status " + first.status);
    if (first.prefer !== "return=minimal") fail("prefer " + first.prefer);
    assertShape(first.body);
    const eventId = qid(first.body.event_id);
    const visitorId = qid(first.body.visitor_id);
    if (psql("SELECT count(*) FROM public.analytics_events WHERE event_id='" + eventId + "'") !== "1") fail("first row count");
    if (psql("SELECT visitor_id FROM public.analytics_events WHERE event_id='" + eventId + "'") !== visitorId) fail("stored visitor_id");
    if (psql("SELECT event_id FROM public.analytics_events WHERE event_id='" + eventId + "'") !== eventId) fail("stored event_id");
    if (psql("SELECT counted FROM private.analytics_visit_receipts WHERE event_id='" + eventId + "'") !== "t") fail("first page view did not count");
    const gate = psql("SELECT last_counted_at FROM private.analytics_visit_gate WHERE visitor_id='" + visitorId + "'");
    if (!gate) fail("gate missing");

    await client.sandbox.KutadguAnalytics.track("page_view", {});
    if (posts.length !== 2) fail("second page_view requests " + posts.length);
    const second = posts[1];
    if (second.status !== 201) fail("second page_view status " + second.status);
    assertShape(second.body);
    if (second.body.visitor_id !== visitorId) fail("visitor changed inside three hours");
    const secondId = qid(second.body.event_id);
    if (secondId === eventId) fail("second page view reused event_id");
    if (psql("SELECT count(*) FROM public.analytics_events WHERE event_id='" + secondId + "'") !== "1") fail("second row count");
    if (psql("SELECT counted FROM private.analytics_visit_receipts WHERE event_id='" + secondId + "'") !== "f") fail("three-hour visit counted again");
    if (psql("SELECT last_counted_at FROM private.analytics_visit_gate WHERE visitor_id='" + visitorId + "'") !== gate) fail("three-hour gate moved");
    if (psql("SELECT count(*) FROM public.analytics_events WHERE event_id='" + eventId + "'") !== "1") fail("first row duplicated");

    const lostPosts = [];
    let lostSeen = 0;
    let lostStore = "";
    const lost = loadClient(origin, async (url, init) => {
      const method = String((init && init.method) || "GET").toUpperCase();
      if (method !== "POST") return fetch(url, init);
      lostSeen += 1;
      const body = JSON.parse(init.body);
      lostPosts.push(body);
      if (lostSeen === 1) {
        const res = await fetch(url, init);
        const text = await res.text();
        lostStore = res.status + " " + text;
        throw new Error("response lost");
      }
      return fetch(url, init);
    }, { local: memoryStorage(), session: memoryStorage() });
    await openPage(lost);
    if (!lostStore.startsWith("201")) fail("lost-response store " + lostStore);
    if (lostSeen !== 2) fail("duplicate retry attempts " + lostSeen);
    if (lostPosts[0].event_id !== lostPosts[1].event_id) fail("duplicate retry changed event_id");
    const lostId = qid(lostPosts[0].event_id);
    if (psql("SELECT count(*) FROM public.analytics_events WHERE event_id='" + lostId + "'") !== "1") fail("duplicate stored another row");

    const retryPosts = [];
    let retrySeen = 0;
    let retryStatus = 0;
    const retry = loadClient(origin, async (url, init) => {
      const method = String((init && init.method) || "GET").toUpperCase();
      if (method !== "POST") return fetch(url, init);
      retrySeen += 1;
      retryPosts.push(JSON.parse(init.body));
      if (retrySeen === 1) throw new Error("offline");
      const res = await fetch(url, init);
      retryStatus = res.status;
      return res;
    }, { local: memoryStorage(), session: memoryStorage() });
    await openPage(retry);
    if (retrySeen !== 2) fail("network retry attempts " + retrySeen);
    if (retryStatus !== 201) fail("network retry status " + retryStatus);
    if (retryPosts[0].event_id !== retryPosts[1].event_id) fail("network retry changed event_id");
    const retryId = qid(retryPosts[0].event_id);
    if (psql("SELECT count(*) FROM public.analytics_events WHERE event_id='" + retryId + "'") !== "1") fail("network retry row count");

    const token = anonJwt();
    const denied = await fetch(origin + "/rest/v1/analytics_events?select=id&limit=1", {
      headers: { Authorization: "Bearer " + token, apikey: token, Accept: "application/json" }
    });
    const deniedText = await denied.text();
    if (denied.status !== 401 || !deniedText.includes("permission denied for table analytics_events")) {
      fail("anon select " + denied.status + " " + deniedText);
    }
    const bare = await fetch(origin + "/rest/v1/analytics_events?select=id&limit=1");
    const bareText = await bare.text();
    if (bare.status !== 401 || !bareText.includes("permission denied for table analytics_events")) {
      fail("anonymous select " + bare.status + " " + bareText);
    }
    if (psql("SELECT has_table_privilege('anon','public.analytics_events','select')") !== "f") fail("anon select privilege");
    console.log("real analytics client postgrest: PASS");
    await cachedRecorderNavigation();
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
  }
}

async function cachedRecorderNavigation() {
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
  const oldJs = execFileSync("git", ["show", "origin/main:analytics.js"], { cwd: root, encoding: "utf8" });
  const newJs = fs.readFileSync(path.join(root, "analytics.js"), "utf8");
  if (!oldJs.includes("host:false,occurred_at:false,action_seq:false")) fail("old recorder shape");
  if (!newJs.includes("host:true,occurred_at:true,action_seq:true")) fail("new recorder shape");
  const cache = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
  const hits = { v6: 0, v7: 0 };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/analytics.js?v=6")) {
      hits.v6 += 1;
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": cache });
      res.end(oldJs);
      return;
    }
    if (req.url.startsWith("/analytics.js?v=7")) {
      hits.v7 += 1;
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": cache });
      res.end(newJs);
      return;
    }
    const pin = req.url.startsWith("/corrected") ? "v=7" : "v=6";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><script src=\"/kutadgu-analytics-core.js?v=5\"></script><script src=\"/analytics.js?" + pin + "\"></script>");
  });
  // The core file is requested by the document. Serve it from the same handler.
  const core = fs.readFileSync(path.join(root, "kutadgu-analytics-core.js"));
  const wrapped = http.createServer((req, res) => {
    if (req.url.startsWith("/kutadgu-analytics-core.js")) {
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
      res.end(core);
      return;
    }
    server.emit("request", req, res);
  });
  const leaked = [];
  const browser = await chromium.launch();
  try {
    await new Promise((resolve) => wrapped.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + wrapped.address().port;
    const page = await browser.newPage();
    page.on("request", (req) => {
      if (req.url().includes("supabase.co")) leaked.push(req.url());
    });
    const receivedBody = new Promise((resolve, reject) => {
      page.on("response", (res) => {
        if (res.url().includes("/analytics.js?v=7")) res.text().then(resolve, reject);
      });
    });
    const scriptSrc = () => page.evaluate(() => [...document.scripts].map((script) => script.src).find((src) => src.includes("analytics.js")) || "");
    await page.goto(base + "/cached.html");
    const firstSrc = await scriptSrc();
    await page.goto(base + "/still-old.html");
    const secondSrc = await scriptSrc();
    await page.goto(base + "/corrected.html");
    const thirdSrc = await scriptSrc();
    const received = await receivedBody;
    if (leaked.length) fail("browser called production " + leaked.join(","));
    if (!firstSrc.endsWith("/analytics.js?v=6") || !secondSrc.endsWith("/analytics.js?v=6")) fail("old src " + secondSrc);
    if (!thirdSrc.endsWith("/analytics.js?v=7")) fail("new src " + thirdSrc);
    if (hits.v6 !== 1) fail("old recorder was fetched " + hits.v6 + " times");
    if (hits.v7 !== 1) fail("corrected recorder was fetched " + hits.v7 + " times");
    if (!received.includes("host:true,occurred_at:true,action_seq:true")) fail("browser did not receive the corrected recorder");
    console.log("cached analytics.js?v=6 then first navigation to ?v=7: PASS");
  } finally {
    await browser.close();
    await new Promise((resolve) => wrapped.close(resolve));
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
JS
echo "analytics insert postgrest: PASS"
