#!/bin/bash
# Prove country collection through the Worker handler and PostgREST 14.5.
# Uses a throwaway database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage117_rest_$$"
PORT="${STAGE117_PORT:-3017}"
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
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "GRANT service_role TO authenticator;"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q <<SQL
GRANT CONNECT ON DATABASE "${DB}" TO authenticator;
GRANT anon, authenticated TO authenticator;
GRANT USAGE ON SCHEMA public TO authenticator, service_role;
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
STAGE117_PORT="$PORT" STAGE117_DB="$DB" STAGE117_ROOT="$ROOT" node <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const preview = require(path.join(process.env.STAGE117_ROOT, "cloudflare/preview-dispatch.js"));
const port = process.env.STAGE117_PORT;
const db = process.env.STAGE117_DB;
const jwtSecret = "01234567890123456789012345678901";
const visitor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fail(message) { throw new Error(message); }
function b64url(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function jwt(role) {
  const data = b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url({
    role,
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  return data + "." + crypto.createHmac("sha256", jwtSecret).update(data).digest("base64url");
}
function psql(sql) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql], {
    encoding: "utf8"
  }).trim();
}
function q(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
async function fetchImpl(url, opts) {
  if (!String(url).endsWith("/rest/v1/analytics_events")) fail("unexpected insert url " + url);
  const target = "http://127.0.0.1:" + port + "/analytics_events";
  return fetch(target, opts);
}
function wrap(body, cf, headers) {
  const request = new Request("https://www.kutadgubilik.com/api/analytics-event", {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, headers || {}),
    body: JSON.stringify(body)
  });
  return new Proxy(request, {
    get(target, prop) {
      if (prop === "cf") return cf || {};
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
async function post(body, cf, env, headers) {
  const response = await preview.dispatch(wrap(body, cf, headers), env, { fetchImpl });
  const cache = response.headers.get("cache-control") || "";
  return { status: response.status, cache, text: await response.text() };
}
function row(eventId, extra) {
  return Object.assign({
    event_name: "page_view",
    path: "/",
    visitor_id: visitor,
    event_id: eventId,
    country: "DE",
    ip: "203.0.113.10"
  }, extra || {});
}
const service = jwt("service_role");
const anon = jwt("anon");
const env = { hostMode: "production", SUPABASE_SECRET_KEY: service };

(async () => {
  const denied = await preview.dispatch(new Request("https://www.kutadgubilik.com/api/analytics-event"), env, { fetchImpl });
  if (denied.status !== 405) fail("GET status " + denied.status);

  const firstId = "11111111-1111-4111-8111-111111111111";
  const stored = await post(row(firstId), { country: "tr" }, env, { "cf-ipcountry": "FR" });
  if (stored.status !== 204) fail("trusted insert status " + stored.status + " " + stored.text);
  if (!/private/.test(stored.cache) || !/no-store/.test(stored.cache)) fail("cache " + stored.cache);
  const country = psql("SELECT country FROM public.analytics_events WHERE event_id = " + q(firstId));
  const receipt = psql("SELECT counted::text || '|' || coalesce(country,'') FROM private.analytics_visit_receipts WHERE event_id = " + q(firstId));
  if (country !== "TR" || receipt !== "true|TR") fail("trusted country stored " + country + " receipt " + receipt);

  const again = await post(row(firstId, { country: "US" }), { country: "US" }, env, { "cf-ipcountry": "DE" });
  if (again.status !== 409) fail("duplicate status " + again.status);
  const still = psql("SELECT country FROM public.analytics_events WHERE event_id = " + q(firstId));
  const receipts = psql("SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id = " + q(firstId));
  if (still !== "TR" || receipts !== "1") fail("duplicate changed country " + still + " receipts " + receipts);

  const unknownId = "22222222-2222-4222-8222-222222222222";
  const unknown = await post(row(unknownId, { visitor_id: other }), { country: "XX" }, env);
  if (unknown.status !== 204) fail("unknown status " + unknown.status + " " + unknown.text);
  const unknownCountry = psql("SELECT coalesce(country,'') FROM public.analytics_events WHERE event_id = " + q(unknownId));
  const unknownReceipt = psql("SELECT counted::text || '|' || coalesce(country,'') FROM private.analytics_visit_receipts WHERE event_id = " + q(unknownId));
  if (unknownCountry !== "" || unknownReceipt !== "true|") fail("unknown metadata " + unknownCountry + " " + unknownReceipt);

  const lostId = "33333333-3333-4333-8333-333333333333";
  const lost = await post(row(lostId, { visitor_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }), { country: "JP" }, { hostMode: "production" });
  if (lost.status !== 503) fail("missing secret status " + lost.status);
  const beforeLost = psql("SELECT count(*) FROM public.analytics_events WHERE event_id = " + q(lostId));
  if (beforeLost !== "0") fail("failed worker insert stored a row");
  const direct = await fetch("http://127.0.0.1:" + port + "/analytics_events", {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: "Bearer " + anon,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      event_name: "page_view",
      path: "/",
      visitor_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      event_id: lostId,
      country: "JP"
    })
  });
  if (direct.status !== 201 && direct.status !== 204) fail("anon fallback status " + direct.status + " " + await direct.text());
  const fallback = psql("SELECT coalesce(country,'') FROM public.analytics_events WHERE event_id = " + q(lostId));
  const fallbackReceipt = psql("SELECT counted::text || '|' || coalesce(country,'') FROM private.analytics_visit_receipts WHERE event_id = " + q(lostId));
  if (fallback !== "" || fallbackReceipt !== "true|") fail("fallback lost the visit " + fallback + " " + fallbackReceipt);

  const cartId = "44444444-4444-4444-8444-444444444444";
  const cart = await post({
    event_name: "add_to_cart",
    path: "/book/15",
    book_id: "15",
    visitor_id: visitor,
    event_id: cartId,
    country: "TR",
    ip: "203.0.113.10"
  }, { country: "TR" }, env);
  if (cart.status !== 204) fail("cart status " + cart.status + " " + cart.text);
  const cartCountry = psql("SELECT coalesce(country,'') FROM public.analytics_events WHERE event_id = " + q(cartId));
  const cartReceipt = psql("SELECT count(*) FROM private.analytics_visit_receipts WHERE event_id = " + q(cartId));
  if (cartCountry !== "" || cartReceipt !== "0") fail("cart stored country " + cartCountry + " receipts " + cartReceipt);

  psql("UPDATE private.analytics_visit_gate SET last_counted_at = now() - interval '3 hours' WHERE visitor_id = " + q(visitor));
  const laterId = "55555555-5555-4555-8555-555555555555";
  const later = await post(row(laterId), { country: "de" }, env, { "cf-ipcountry": "TR" });
  if (later.status !== 204) fail("later visit status " + later.status + " " + later.text);
  const laterCountry = psql("SELECT country FROM private.analytics_visit_receipts WHERE event_id = " + q(laterId) + " AND counted");
  const original = psql("SELECT country FROM private.analytics_visit_receipts WHERE event_id = " + q(firstId) + " AND counted");
  if (laterCountry !== "DE" || original !== "TR") fail("later country " + laterCountry + " original " + original);

  const sameA = "66666666-6666-4666-8666-666666666666";
  const sameB = "77777777-7777-4777-8777-777777777777";
  const parallelVisitor = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const pair = await Promise.all([
    post(row(sameA, { visitor_id: parallelVisitor }), { country: "FR" }, env),
    post(row(sameB, { visitor_id: parallelVisitor }), { country: "FR" }, env)
  ]);
  if (pair.some((item) => item.status !== 204)) fail("parallel status " + pair.map((item) => item.status).join(","));
  const parallelCounted = psql("SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id = " + q(parallelVisitor) + " AND counted");
  if (parallelCounted !== "1") fail("parallel tabs counted " + parallelCounted);

  const report = psql("SELECT private.kutadgu_country_visit_report(7)::text");
  const parsed = JSON.parse(report);
  if (parsed.status !== "partial") fail("fresh collection should be partial, got " + parsed.status);
  const visits = new Map((parsed.countries || []).map((item) => [item.code, item.visits]));
  if (visits.get("TR") !== 1 || visits.get("DE") !== 1 || visits.get("FR") !== 1) fail("totals " + JSON.stringify(parsed.countries));
  if (parsed.unknown_visits < 2) fail("unknown " + parsed.unknown_visits);
  if (!Array.isArray(parsed.latest) || parsed.latest.length > 20 || parsed.latest.length < 1) fail("latest " + JSON.stringify(parsed.latest));
  if (/visitor_id|event_id|(?:\d{1,3}\.){3}\d{1,3}/.test(report)) fail("report leaked a private value");

  const calls = [];
  const listeners = {};
  const document = {
    readyState: "complete",
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach((fn) => fn(event)); }
  };
  const window = {
    KutadguAnalyticsCore: require(path.join(process.env.STAGE117_ROOT, "kutadgu-analytics-core.js")),
    KUTADGU_SUPABASE_CONFIG: { url: "http://127.0.0.1:" + port, anonKey: anon }
  };
  const context = vm.createContext({
    window,
    document,
    location: { hostname: "www.kutadgubilik.com", pathname: "/books" },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    fetch: async (url, opts) => {
      calls.push(String(url));
      if (String(url).includes("/api/analytics-event")) {
        const request = wrap(JSON.parse(opts.body), { country: "JP" });
        return preview.dispatch(request, env, { fetchImpl });
      }
      return fetch(String(url).replace("/rest/v1/", "/"), opts);
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    localStorage: { getItem() { return "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; }, setItem() {}, removeItem() {} },
    crypto,
    console
  });
  vm.runInContext(fs.readFileSync(path.join(process.env.STAGE117_ROOT, "analytics.js"), "utf8"), context);
  await window.KutadguAnalytics.track("page_view", { country: "US" });
  if (calls.some((url) => url.includes("/rest/v1/analytics_events"))) fail("stored worker response also inserted directly " + calls.join(","));
  const clientCountry = psql("SELECT coalesce(string_agg(DISTINCT country, ','), '') FROM public.analytics_events WHERE visitor_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND event_name = 'page_view'");
  if (clientCountry !== "JP") fail("client path stored " + clientCountry);
  console.log("STAGE117 postgrest: PASS");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
NODE
echo "STAGE117 isolated postgrest: PASS"