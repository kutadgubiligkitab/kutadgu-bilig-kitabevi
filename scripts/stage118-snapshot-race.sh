#!/bin/bash
# Two-session proof that an analytics insert started before a history page,
# and committed after it, does not enter that page's snapshot.
# The insert uses the real counting trigger, so counted_at is the inserting
# transaction's now(). Optional second argument is a PostgREST port; the
# page reads then go through the admin client helper.
set -euo pipefail
DB="${1:?database name}"
PORT="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export STAGE118_RACE_DB="$DB"
export STAGE118_RACE_PORT="$PORT"
export STAGE118_RACE_ROOT="$ROOT"
python3 - << 'PY'
import base64, hashlib, hmac, json, os, select, subprocess, time, urllib.request

db = os.environ["STAGE118_RACE_DB"]
port = os.environ.get("STAGE118_RACE_PORT") or ""
root = os.environ["STAGE118_RACE_ROOT"]
secret = "01234567890123456789012345678901"
late_event = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
late_visitor = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

def fail(message):
    raise SystemExit(message)

class Psql:
    def __init__(self):
        self.proc = subprocess.Popen(
            ["sudo", "-u", "postgres", "stdbuf", "-o0", "-e0", "psql", "-d", db, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=0,
        )
    def write(self, sql):
        self.proc.stdin.write(sql.strip().rstrip(";") + ";\n")
        self.proc.stdin.flush()
    def read(self, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            ready, _, _ = select.select([self.proc.stdout], [], [], 0.2)
            if not ready:
                if self.proc.poll() is not None:
                    fail("psql exited")
                continue
            line = self.proc.stdout.readline()
            if not line:
                fail("psql closed")
            text = line.rstrip("\n")
            if text.startswith("ERROR") or text.startswith("LINE") or text.startswith("HINT"):
                extra = []
                while True:
                    ready, _, _ = select.select([self.proc.stdout], [], [], 0.2)
                    if not ready:
                        break
                    extra.append(self.proc.stdout.readline().rstrip("\n"))
                fail(text + " | " + " | ".join(extra))
            return text
        fail("psql timed out")
    def query(self, sql, timeout=30):
        self.write(sql)
        return self.read(timeout)
    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass

def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

def admin_jwt():
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64url(json.dumps({
        "role": "authenticated",
        "aal": "aal2",
        "admin": "yes",
        "exp": int(time.time()) + 3600
    }, separators=(",", ":")).encode())
    data = f"{header}.{body}".encode()
    sig = b64url(hmac.new(secret.encode(), data, hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"

def node_json(script, payload):
    proc = subprocess.run(
        ["node", "-e", script, json.dumps(payload)],
        cwd=root,
        text=True,
        capture_output=True,
        env=dict(os.environ, STAGE118_RACE_ROOT=root),
    )
    if proc.returncode != 0:
        fail(proc.stderr or proc.stdout or "node helper failed")
    return json.loads(proc.stdout)

def normalize(payload):
    return node_json(
        """
const core = require(process.env.STAGE118_RACE_ROOT + "/kutadgu-analytics-core.js");
const page = core.normalizeVisitCountryHistory(JSON.parse(process.argv[1]));
if (!page) process.exit(2);
process.stdout.write(JSON.stringify(page));
""",
        payload,
    )

def page_request(session, offset):
    return node_json(
        """
const core = require(process.env.STAGE118_RACE_ROOT + "/kutadgu-analytics-core.js");
const input = JSON.parse(process.argv[1]);
const request = core.visitCountryHistoryRequest({
  kind: "page",
  selectedDays: 90,
  session: input.session,
  offset: input.offset,
  limit: 20
});
if (!request) process.exit(2);
process.stdout.write(JSON.stringify(request));
""",
        {"session": session, "offset": offset},
    )

def matches(session, page, offset):
    result = node_json(
        """
const core = require(process.env.STAGE118_RACE_ROOT + "/kutadgu-analytics-core.js");
const input = JSON.parse(process.argv[1]);
process.stdout.write(JSON.stringify(core.visitCountryHistoryPageMatches(input.session, input.page, input.offset)));
""",
        {"session": session, "page": page, "offset": offset},
    )
    return result is True

def http_history(body):
    data = json.dumps(body).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/rpc/get_kutadgu_visit_country_history",
        data=data,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": "Bearer " + admin_jwt(),
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read().decode()
    value = json.loads(text)
    if isinstance(value, str):
        value = json.loads(value)
    if "db_snapshot" in value or "xmin" in value or "event_id" in text or "visitor_id" in text:
        fail("history response exposed a private identifier")
    return value

def sql_history(conn, offset, snapshot_id):
    snap = "NULL::uuid" if snapshot_id is None else "'" + snapshot_id + "'::uuid"
    raw = conn.query(f"""
SELECT public.get_kutadgu_visit_country_history(7, {int(offset)}, 20, NULL::timestamptz, {snap})::text
""")
    value = json.loads(raw)
    if "db_snapshot" in value or "xmin" in value or "event_id" in raw or "visitor_id" in raw:
        fail("history response exposed a private identifier")
    return value

reader = Psql()
writer = Psql()
try:
    reader.query("SELECT set_config('test.admin','on', false)")
    reader.query("SELECT set_config('test.aal','aal2', false)")
    seeded = reader.query("""
WITH inserted AS (
  INSERT INTO private.analytics_visit_receipts (event_id, visitor_id, counted, counted_at, country)
  SELECT
    ('13000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
    'race-seed-' || i,
    true,
    LEAST(
      clock_timestamp() - interval '1 second',
      GREATEST(
        (SELECT started_at FROM private.analytics_country_counter) + (i || ' milliseconds')::interval,
        clock_timestamp() - interval '3 hours' + (i || ' seconds')::interval
      )
    ),
    'TR'
  FROM generate_series(1, 21) AS i
  ON CONFLICT (event_id) DO NOTHING
  RETURNING 1
)
SELECT count(*)::text FROM inserted
""")
    if seeded != "21":
        fail("race seed inserted " + seeded)
    reader.write("GRANT INSERT, SELECT ON public.analytics_events TO service_role")
    reader.write("GRANT USAGE, SELECT ON SEQUENCE public.analytics_events_id_seq TO service_role")
    if reader.query("SELECT 'granted'") != "granted":
        fail("could not grant the analytics insert")
    writer.write("BEGIN")
    txn_now = writer.query("SELECT now()::text")
    writer.write("SET LOCAL ROLE service_role")
    country = writer.query(f"""
INSERT INTO public.analytics_events (event_name, path, session_id, visitor_id, event_id, country)
VALUES (
  'page_view', '/index.html', 'race-session',
  '{late_visitor}', '{late_event}', 'CA'
)
RETURNING country
""")
    if country != "CA":
        fail("counting insert did not keep CA, got " + country)
    hidden = reader.query(f"SELECT count(*)::text FROM private.analytics_visit_receipts WHERE event_id = '{late_event}'")
    if hidden != "0":
        fail("uncommitted receipt was visible")
    if port:
        first_raw = http_history({"p_days": 7, "p_offset": 0, "p_limit": 20})
    else:
        first_raw = sql_history(reader, 0, None)
    first = normalize(first_raw)
    if first["total"] < 21 or len(first["rows"]) != 20 or not first["hasMore"] or not first["snapshotId"]:
        fail("open first page " + json.dumps(first_raw))
    if any(row.get("country") == "CA" for row in first_raw.get("rows") or []):
        fail("uncommitted visit was on page one")
    writer.write("RESET ROLE")
    writer.write("COMMIT")
    writer.query("SELECT 'committed'")
    receipt = reader.query(f"""
SELECT counted_at::text || '|' || coalesce(country, 'NULL') || '|' || (counted_at <= timestamptz '{first['asOf']}')::text
FROM private.analytics_visit_receipts
WHERE event_id = '{late_event}'
""")
    counted_at, receipt_country, inside = receipt.split("|")
    if receipt_country != "CA" or inside != "true":
        fail("committed receipt was outside the window anchor " + receipt + " txn " + txn_now)
    if counted_at != txn_now:
        fail("counted_at " + counted_at + " was not the inserting transaction now() " + txn_now)
    session = {
        "mode": "history",
        "days": first["days"],
        "asOf": first["asOf"],
        "snapshotId": first["snapshotId"],
        "total": first["total"],
        "rangeStart": first["rangeStart"],
        "rangeEnd": first["rangeEnd"],
    }
    seen = []
    keys = set()
    offset = 0
    pages = 0
    while pages < 10:
        request = page_request(session, offset)
        if request.get("p_snapshot") != first["snapshotId"] or request.get("p_days") != first["days"]:
            fail("client dropped the retained snapshot " + json.dumps(request))
        if port:
            raw = http_history(request)
        else:
            raw = sql_history(reader, offset, first["snapshotId"])
        page = normalize(raw)
        if not matches(session, page, offset):
            fail("page left the snapshot at " + str(offset) + " " + json.dumps(raw))
        if any(row.get("country") == "CA" for row in raw.get("rows") or []):
            fail("late commit entered the retained snapshot")
        for row in page["rows"]:
            key = (row.get("country") or "") + "|" + (row.get("countedAt") or "")
            if key in keys:
                fail("duplicate history row " + key)
            keys.add(key)
            seen.append(row)
        pages += 1
        if not page["hasMore"]:
            break
        offset = page["nextOffset"]
    else:
        fail("history pages did not end")
    if len(seen) != first["total"]:
        fail("retained pages returned " + str(len(seen)) + " of " + str(first["total"]))
    if port:
        fresh_raw = http_history({"p_days": 7, "p_offset": 0, "p_limit": 20})
    else:
        fresh_raw = sql_history(reader, 0, None)
    fresh = normalize(fresh_raw)
    if fresh["snapshotId"] == first["snapshotId"] or fresh["total"] != first["total"] + 1:
        fail("new snapshot did not see the committed visit " + json.dumps(fresh_raw)[:500])
    if not any(row.get("country") == "CA" for row in fresh_raw.get("rows") or []):
        fail("new snapshot omitted CA")
    print("stage118 snapshot race ok", "postgrest" if port else "sql", "total", first["total"], "pages", pages)
finally:
    reader.close()
    writer.close()
PY
