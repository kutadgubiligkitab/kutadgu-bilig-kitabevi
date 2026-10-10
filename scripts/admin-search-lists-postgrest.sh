#!/bin/bash
# Prove the admin search, cart, and WhatsApp lists against PostgREST 14.5.
# Uses a throwaway database. Does not connect to production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_search_lists_$$"
PORT="${SEARCH_LISTS_PORT:-3016}"
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
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE115_ANALYTICS_EVENT_ID.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE116_ADMIN_ANALYTICS_LISTS.sql"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q <<SQL
GRANT CONNECT ON DATABASE "${DB}" TO authenticator;
GRANT anon, authenticated TO authenticator;
GRANT USAGE ON SCHEMA public TO authenticator;
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
psql_db() { sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -tA "$@"; }
if [[ "$(psql_db -c "SELECT has_table_privilege('anon','public.analytics_events','select')")" != "f" ]]; then
  echo "anon select must stay absent" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT has_function_privilege('anon','public.get_kutadgu_searches(integer,integer,integer,timestamptz)','execute')")" != "f" ]]; then
  echo "anon must not execute get_kutadgu_searches" >&2
  exit 1
fi
if [[ "$(psql_db -c "SELECT has_function_privilege('authenticated','public.get_kutadgu_searches(integer,integer,integer,timestamptz)','execute')")" != "t" ]]; then
  echo "authenticated execute missing" >&2
  exit 1
fi
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO public.books (id, title) VALUES (16, 'Other'), (17, 'Third');

INSERT INTO public.analytics_events (event_name, path, visitor_id, event_id)
VALUES
  ('page_view', '/', '22222222-2222-4222-8222-222222222223', '22222222-2222-4222-8222-222222222221'),
  ('page_view', '/', '22222222-2222-4222-8222-222222222223', '22222222-2222-4222-8222-222222222222');

INSERT INTO public.analytics_events (event_name, search_query, result_count, path, visitor_id, event_id, created_at)
VALUES
  ('search', 'ئۈچ قېتىم', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111101', now() - interval '2 hours'),
  ('search', 'ئۈچ قېتىم', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111102', now() - interval '90 minutes'),
  ('search', 'ئۈچ قېتىم', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111103', now() - interval '30 minutes'),
  ('search', 'قايتا-سۆز', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111104', now() - interval '20 minutes'),
  ('search', 'نۆل-سۆز', 0, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111105', now() - interval '50 minutes'),
  ('zero_result_search', 'نۆل-سۆز', 0, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111106', now() - interval '50 minutes'),
  ('search', 'بار-سۆز', 4, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111107', now() - interval '40 minutes'),
  ('search', 'نامەلۇم-سۆز', NULL, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111108', now() - interval '35 minutes'),
  ('search', '  قوش   بوشلۇق  ', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111109', now() - interval '8 hours'),
  ('search', 'قوش بوشلۇق', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111110', now() - interval '8 hours 5 minutes'),
  ('search', 'LatinCase', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', now() - interval '6 hours'),
  ('search', 'latincase', 1, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111112', now() - interval '6 hours'),
  ('search', '   ', 0, '/', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111113', now() - interval '15 minutes'),
  ('book_view', 'كۆرۈش-سۆز', NULL, '/book/15', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111114', now() - interval '15 minutes');

UPDATE public.analytics_events
SET book_id = '15'
WHERE event_id = '31111111-1111-4111-8111-111111111114';

INSERT INTO public.analytics_events (event_name, search_query, result_count, path, event_id, created_at)
SELECT
  'search',
  'گامما',
  1,
  '/',
  ('41111111-1111-4111-8111-' || lpad(to_hex(g), 12, '0'))::uuid,
  now() - interval '10 minutes' - (g || ' minutes')::interval
FROM generate_series(1, 3) AS g;

INSERT INTO public.analytics_events (event_name, search_query, result_count, path, event_id, created_at)
SELECT
  'search',
  CASE WHEN g <= 2 THEN 'ئالفا' ELSE 'بېتا' END,
  1,
  '/',
  ('51111111-1111-4111-8111-' || lpad(to_hex(g), 12, '0'))::uuid,
  now() - interval '5 hours' - ((g % 2) || ' minutes')::interval
FROM generate_series(1, 4) AS g;

INSERT INTO public.analytics_events (event_name, search_query, result_count, path, event_id, created_at)
SELECT
  'search',
  'سۆز-' || lpad(g::text, 2, '0'),
  1,
  '/',
  ('61111111-1111-4111-8111-' || lpad(to_hex(g), 12, '0'))::uuid,
  now() - interval '20 hours' - (g || ' minutes')::interval
FROM generate_series(1, 22) AS g;

INSERT INTO public.analytics_events (event_name, book_id, path, event_id, created_at)
VALUES
  ('add_to_cart', '15', '/book/15', '71111111-1111-4111-8111-111111111101', now() - interval '1 hour'),
  ('add_to_cart', '15', '/book/15', '71111111-1111-4111-8111-111111111102', now() - interval '2 hours'),
  ('add_to_cart', '16', '/book/16', '71111111-1111-4111-8111-111111111103', now() - interval '3 hours'),
  ('whatsapp_order_click', '15', '/cart.html', '81111111-1111-4111-8111-111111111101', now() - interval '1 hour'),
  ('whatsapp_order_click', '16', '/cart.html', '81111111-1111-4111-8111-111111111102', now() - interval '2 hours');

UPDATE public.analytics_events
SET meta = '{"book_ids":["15","15","16"]}'::jsonb
WHERE event_id = '81111111-1111-4111-8111-111111111101';

UPDATE public.analytics_events
SET meta = '{"book_ids":["16","17"]}'::jsonb
WHERE event_id = '81111111-1111-4111-8111-111111111102';

INSERT INTO public.analytics_events (event_name, search_query, result_count, path, event_id, created_at)
VALUES
  ('zero_result_search', 'كونا-نۆل', 0, '/', '91111111-1111-4111-8111-111111111101', timestamptz '2026-01-15 12:00:00+03'),
  ('zero_result_search', 'كونا-بار', 5, '/', '91111111-1111-4111-8111-111111111102', timestamptz '2026-01-15 13:00:00+03'),
  ('search', 'يانۋار-ئىزدەش', 2, '/', '91111111-1111-4111-8111-111111111103', timestamptz '2026-01-16 12:00:00+03');

DO $$
BEGIN
  INSERT INTO public.analytics_events (event_name, search_query, result_count, path, event_id, created_at)
  VALUES ('search', 'قايتا-سۆز', 1, '/', '31111111-1111-4111-8111-111111111104', now() - interval '10 minutes');
  RAISE EXCEPTION 'duplicate event_id was stored';
EXCEPTION
  WHEN unique_violation THEN
    NULL;
END $$;
SQL
rows_before="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
SELECT set_config('test.admin', 'on', true);
SELECT set_config('test.aal', 'aal2', true);
DO $check$
DECLARE
  v jsonb;
  z jsonb;
  a jsonb;
  page jsonb;
  visits_before jsonb;
  views_before bigint;
  carts_before bigint;
  clicks_before bigint;
  events_before bigint;
BEGIN
  IF (SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id = '22222222-2222-4222-8222-222222222223' AND counted) <> 1 THEN
    RAISE EXCEPTION 'three-hour gate counted % page views',
      (SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id = '22222222-2222-4222-8222-222222222223' AND counted);
  END IF;
  IF (SELECT count(*) FROM private.analytics_visit_receipts WHERE visitor_id = '22222222-2222-4222-8222-222222222223' AND NOT counted) <> 1 THEN
    RAISE EXCEPTION 'suppressed page view was not stored as counted=false';
  END IF;

  v := public.get_kutadgu_searches(30, 0, 50, NULL);
  IF (v->>'representation') IS DISTINCT FROM 'search' THEN
    RAISE EXCEPTION 'expected search representation, got %', v->>'representation';
  END IF;
  IF (v->>'timezone') IS DISTINCT FROM 'Europe/Istanbul' THEN
    RAISE EXCEPTION 'search timezone %', v->>'timezone';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'ئۈچ قېتىم' AND (q->>'searches')::int = 3) <> 1 THEN
    RAISE EXCEPTION 'three searches did not stay 3: %', v->'queries';
  END IF;
  IF (SELECT q->>'last_searched_at' FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'ئۈچ قېتىم')
     IS DISTINCT FROM (
       SELECT max(created_at)::text FROM public.analytics_events WHERE search_query = 'ئۈچ قېتىم'
     ) AND (SELECT q->>'last_searched_at' FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'ئۈچ قېتىم')::timestamptz
     IS DISTINCT FROM (
       SELECT max(created_at) FROM public.analytics_events WHERE search_query = 'ئۈچ قېتىم'
     ) THEN
    RAISE EXCEPTION 'latest search time mismatch';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'قايتا-سۆز' AND (q->>'searches')::int = 1) <> 1 THEN
    RAISE EXCEPTION 'retried event_id counted more than once';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'نۆل-سۆز' AND (q->>'searches')::int = 1) <> 1 THEN
    RAISE EXCEPTION 'confirmed zero was double-counted with zero_result_search';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' IN ('بار-سۆز', 'نامەلۇم-سۆز', 'قوش بوشلۇق', 'LatinCase', 'latincase')) <> 5 THEN
    RAISE EXCEPTION 'result classes or normalization collapsed: %', v->'queries';
  END IF;
  IF (SELECT (q->>'searches')::int FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'قوش بوشلۇق') <> 2 THEN
    RAISE EXCEPTION 'whitespace variants did not group';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' IN ('كۆرۈش-سۆز', 'كونا-نۆل', 'يانۋار-ئىزدەش') OR btrim(q->>'query') = '') <> 0 THEN
    RAISE EXCEPTION 'book view, blank, or out-of-window term leaked into the search list';
  END IF;

  page := public.get_kutadgu_searches(30, 0, 2, NULL);
  IF (page#>>'{queries,0,query}') IS DISTINCT FROM 'گامما' OR (page#>>'{queries,1,query}') IS DISTINCT FROM 'ئۈچ قېتىم' THEN
    RAISE EXCEPTION 'first page order %', page->'queries';
  END IF;
  IF (page->>'has_more')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'first page hid the remaining terms';
  END IF;
  page := public.get_kutadgu_searches(30, (page->>'next_offset')::int, 2, (page->>'as_of')::timestamptz);
  IF (page#>>'{queries,0,query}') IS DISTINCT FROM 'ئالفا' OR (page#>>'{queries,1,query}') IS DISTINCT FROM 'بېتا' THEN
    RAISE EXCEPTION 'tie order %', page->'queries';
  END IF;

  z := public.get_kutadgu_zero_searches(30, 0, 50, NULL);
  IF (SELECT count(*) FROM jsonb_array_elements(z->'queries') q WHERE q->>'query' = 'نۆل-سۆز') <> 1 THEN
    RAISE EXCEPTION 'confirmed zero missing from zero list';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(z->'queries') q WHERE q->>'query' IN ('نامەلۇم-سۆز', 'بار-سۆز', 'ئۈچ قېتىم')) <> 0 THEN
    RAISE EXCEPTION 'unknown or positive search entered the zero list';
  END IF;

  v := public.get_kutadgu_searches(1, 0, 20, timestamptz '2026-01-15 18:00:00+03');
  IF (v->>'representation') IS DISTINCT FROM 'zero_result_search' THEN
    RAISE EXCEPTION 'legacy window representation %', v->>'representation';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' IN ('كونا-نۆل', 'كونا-بار')) <> 2 THEN
    RAISE EXCEPTION 'legacy-only terms missing %', v->'queries';
  END IF;
  z := public.get_kutadgu_zero_searches(1, 0, 20, timestamptz '2026-01-15 18:00:00+03');
  IF (SELECT count(*) FROM jsonb_array_elements(z->'queries') q WHERE q->>'query' = 'كونا-نۆل') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(z->'queries') q WHERE q->>'query' = 'كونا-بار') <> 0 THEN
    RAISE EXCEPTION 'legacy zero contract changed %', z->'queries';
  END IF;
  v := public.get_kutadgu_searches(2, 0, 20, timestamptz '2026-01-16 18:00:00+03');
  IF (v->>'representation') IS DISTINCT FROM 'search'
     OR (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'يانۋار-ئىزدەش') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(v->'queries') q WHERE q->>'query' = 'كونا-نۆل') <> 0 THEN
    RAISE EXCEPTION 'mixed window reconstructed a legacy term %', v->'queries';
  END IF;

  a := public.get_kutadgu_analytics(30);
  IF (SELECT count(*) FROM jsonb_array_elements(a->'top_cart_books') b WHERE b->>'book_id' = '15' AND (b->>'adds')::int = 2) <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(a->'top_cart_books') b WHERE b->>'book_id' = '16' AND (b->>'adds')::int = 1) <> 1 THEN
    RAISE EXCEPTION 'cart ranking %', a->'top_cart_books';
  END IF;
  IF (a#>>'{top_whatsapp_books,0,book_id}') IS DISTINCT FROM '16'
     OR (a#>>'{top_whatsapp_books,0,clicks}')::int IS DISTINCT FROM 2
     OR (a#>>'{top_whatsapp_books,1,book_id}') IS DISTINCT FROM '15'
     OR (a#>>'{top_whatsapp_books,2,book_id}') IS DISTINCT FROM '17'
     OR (a#>>'{top_whatsapp_books,1,clicks}')::int IS DISTINCT FROM 1
     OR (a#>>'{top_whatsapp_books,2,clicks}')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'whatsapp ranking %', a->'top_whatsapp_books';
  END IF;
  IF (a->>'unknown_result_searches')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'unknown results %', a->>'unknown_result_searches';
  END IF;
  IF a->'counted_visits' IS NULL OR a->'page_views' IS NULL OR a->'zero_searches' IS NULL OR a->'top_books' IS NULL THEN
    RAISE EXCEPTION 'existing analytics keys missing';
  END IF;
  visits_before := a->'counted_visits';
  views_before := (a->>'page_views')::bigint;
  carts_before := (a->>'cart_adds')::bigint;
  clicks_before := (a->>'whatsapp_clicks')::bigint;
  events_before := (public.get_kutadgu_searches(30, 0, 1, NULL)->>'total_events')::bigint;

  INSERT INTO public.analytics_events (event_name, search_query, result_count, path, event_id)
  VALUES ('search', 'قوشۇمچە', 1, '/', '31111111-1111-4111-8111-111111111199');

  a := public.get_kutadgu_analytics(30);
  IF a->'counted_visits' IS DISTINCT FROM visits_before
     OR (a->>'page_views')::bigint IS DISTINCT FROM views_before
     OR (a->>'cart_adds')::bigint IS DISTINCT FROM carts_before
     OR (a->>'whatsapp_clicks')::bigint IS DISTINCT FROM clicks_before THEN
    RAISE EXCEPTION 'search insert changed visits or event totals';
  END IF;
  IF (public.get_kutadgu_searches(30, 0, 50, NULL)->>'total_events')::bigint <> events_before + 1 THEN
    RAISE EXCEPTION 'additional search did not count once';
  END IF;
END
$check$;
COMMIT;
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
python3 - "$PORT" <<'PY'
import base64, hashlib, hmac, json, sys, time, urllib.error, urllib.request
port = sys.argv[1]
base = f"http://127.0.0.1:{port}"
secret = b"01234567890123456789012345678901"

def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=")

def token(payload):
    body = dict(payload)
    body["exp"] = int(time.time()) + 3600
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    data = b64(json.dumps(body, separators=(",", ":")).encode())
    sig = b64(hmac.new(secret, header + b"." + data, hashlib.sha256).digest())
    return (header + b"." + data + b"." + sig).decode()

def call(method, path, payload=None, auth=None, prefer=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = "Bearer " + auth
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()

def rpc(name, payload, auth=None):
    status, text = call("POST", "/rpc/" + name, payload, auth)
    body = json.loads(text) if text else None
    return status, body, text

admin = token({"role": "authenticated", "aal": "aal2", "admin": "yes"})
aal1 = token({"role": "authenticated", "aal": "aal1", "admin": "yes"})
member = token({"role": "authenticated", "aal": "aal2", "admin": "no"})

for name in ("get_kutadgu_searches", "get_kutadgu_zero_searches", "get_kutadgu_analytics"):
    status, body, text = rpc(name, {"p_days": 30})
    assert status == 401, (name, status, text)
    status, body, text = rpc(name, {"p_days": 30}, aal1)
    assert status in (401, 403) and ("42501" in text or "AAL2" in text), (name, status, text)
    status, body, text = rpc(name, {"p_days": 30}, member)
    assert status >= 400 and "admin only" in text, (name, status, text)

status, before, text = rpc("get_kutadgu_analytics", {"p_days": 30}, admin)
assert status == 200, text
status, text = call("POST", "/analytics_events", {
    "event_name": "search",
    "book_id": None,
    "search_query": "http-قايتا",
    "category": None,
    "result_count": 1,
    "item_count": None,
    "order_total": None,
    "path": "/",
    "session_id": "local-probe",
    "visitor_id": "11111111-1111-4111-8111-111111111111",
    "event_id": "31111111-1111-4111-8111-111111111188"
}, prefer="return=minimal")
assert status == 201, (status, text)
status, text = call("POST", "/analytics_events", {
    "event_name": "search",
    "book_id": None,
    "search_query": "http-قايتا",
    "category": None,
    "result_count": 1,
    "item_count": None,
    "order_total": None,
    "path": "/",
    "session_id": "local-probe",
    "visitor_id": "11111111-1111-4111-8111-111111111111",
    "event_id": "31111111-1111-4111-8111-111111111188"
}, prefer="return=minimal")
assert status == 409, (status, text)
status, text = call("GET", "/analytics_events?select=id&limit=1")
assert status == 401 and "permission denied for table analytics_events" in text, (status, text)

status, after, text = rpc("get_kutadgu_analytics", {"p_days": 30}, admin)
assert status == 200, text
for key in ("page_views", "book_views", "cart_adds", "whatsapp_clicks", "counted_visits"):
    assert before[key] == after[key], (key, before[key], after[key])
assert after["unknown_result_searches"] == 1, after["unknown_result_searches"]
cart = {row["book_id"]: row["adds"] for row in after["top_cart_books"]}
assert cart["15"] == 2 and cart["16"] == 1, cart
whatsapp = [(row["book_id"], row["clicks"]) for row in after["top_whatsapp_books"]]
assert whatsapp == [("16", 2), ("15", 1), ("17", 1)], whatsapp

status, page, text = rpc("get_kutadgu_searches", {"p_days": 30, "p_limit": 50}, admin)
assert status == 200, text
found = {row["query"]: row for row in page["queries"]}
assert found["ئۈچ قېتىم"]["searches"] == 3, found["ئۈچ قېتىم"]
assert found["قايتا-سۆز"]["searches"] == 1
assert found["نۆل-سۆز"]["searches"] == 1
assert found["بار-سۆز"]["searches"] == 1
assert found["نامەلۇم-سۆز"]["searches"] == 1
assert found["قوش بوشلۇق"]["searches"] == 2
assert found["LatinCase"]["searches"] == 1 and found["latincase"]["searches"] == 1
assert found["http-قايتا"]["searches"] == 1
assert "كۆرۈش-سۆز" not in found
queries = [row["query"] for row in page["queries"]]
assert queries.index("گامما") < queries.index("ئۈچ قېتىم") < queries.index("ئالفا") < queries.index("بېتا")
first = rpc("get_kutadgu_searches", {"p_days": 30, "p_limit": 2, "p_offset": 0}, admin)[1]
second = rpc("get_kutadgu_searches", {
    "p_days": 30,
    "p_limit": 2,
    "p_offset": first["next_offset"],
    "p_as_of": first["as_of"]
}, admin)[1]
assert [row["query"] for row in first["queries"]] == ["گامما", "ئۈچ قېتىم"], first["queries"]
assert [row["query"] for row in second["queries"]] == ["ئالفا", "بېتا"], second["queries"]
assert first["total_queries"] == second["total_queries"] == page["total_queries"]
assert first["as_of"] == second["as_of"]
status, zeros, text = rpc("get_kutadgu_zero_searches", {"p_days": 30, "p_limit": 50}, admin)
assert status == 200, text
zero_queries = {row["query"] for row in zeros["queries"]}
assert "نۆل-سۆز" in zero_queries
assert "نامەلۇم-سۆز" not in zero_queries and "بار-سۆز" not in zero_queries
print("postgrest admin search lists passed")
PY
rows_mid="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE116_ADMIN_ANALYTICS_LISTS_ROLLBACK.sql" >/dev/null
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "NOTIFY pgrst, 'reload schema';" >/dev/null
sleep 0.4
python3 - "$PORT" <<'PY'
import base64, hashlib, hmac, json, sys, time, urllib.error, urllib.request
port = sys.argv[1]
base = f"http://127.0.0.1:{port}"
secret = b"01234567890123456789012345678901"

def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=")

def token():
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    data = b64(json.dumps({"role": "authenticated", "aal": "aal2", "admin": "yes", "exp": int(time.time()) + 3600}, separators=(",", ":")).encode())
    sig = b64(hmac.new(secret, header + b"." + data, hashlib.sha256).digest())
    return (header + b"." + data + b"." + sig).decode()

def call(path, payload):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode(),
        headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": "Bearer " + token()},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()

status, text = call("/rpc/get_kutadgu_searches", {"p_days": 30})
assert status == 404 and "PGRST202" in text, (status, text)
status, text = call("/rpc/get_kutadgu_analytics", {"p_days": 30})
assert status == 200, text
body = json.loads(text)
assert "top_cart_books" not in body and "top_whatsapp_books" not in body, body.keys()
assert "counted_visits" in body and "page_views" in body
print("rollback restored the stage 114 analytics body")
PY
if [[ "$(psql_db -c "SELECT count(*) FROM public.analytics_events")" != "$rows_mid" ]]; then
  echo "rollback changed analytics rows" >&2
  exit 1
fi
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/STAGE116_ADMIN_ANALYTICS_LISTS.sql" >/dev/null
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "NOTIFY pgrst, 'reload schema';" >/dev/null
sleep 0.4
python3 - "$PORT" <<'PY'
import base64, hashlib, hmac, json, sys, time, urllib.error, urllib.request
port = sys.argv[1]
base = f"http://127.0.0.1:{port}"
secret = b"01234567890123456789012345678901"

def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=")

header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
data = b64(json.dumps({"role": "authenticated", "aal": "aal2", "admin": "yes", "exp": int(time.time()) + 3600}, separators=(",", ":")).encode())
sig = b64(hmac.new(secret, header + b"." + data, hashlib.sha256).digest())
token = (header + b"." + data + b"." + sig).decode()
req = urllib.request.Request(
    base + "/rpc/get_kutadgu_searches",
    data=json.dumps({"p_days": 30, "p_limit": 50}).encode(),
    headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": "Bearer " + token},
    method="POST",
)
with urllib.request.urlopen(req, timeout=15) as res:
    body = json.loads(res.read().decode())
found = {row["query"]: row["searches"] for row in body["queries"]}
assert found["ئۈچ قېتىم"] == 3, found
print("reapply restored search counts")
PY
rows_after="$(psql_db -c "SELECT count(*) FROM public.analytics_events")"
if [[ "$rows_after" != "$rows_mid" ]]; then
  echo "reapply changed analytics rows ${rows_mid} -> ${rows_after}" >&2
  exit 1
fi
echo "admin-search-lists-postgrest ok rows_before=${rows_before} rows_after=${rows_after}"
