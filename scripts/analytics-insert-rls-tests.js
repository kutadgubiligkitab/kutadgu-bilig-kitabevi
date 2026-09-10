#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const A = require("../kutadgu-analytics-core.js");

const root = path.join(__dirname, "..");
const SQL_FILES = [
  "STAGE9_ANALYTICS_INSERT_RLS.sql",
  "STAGE4_ANALYTICS_RPC_FIX.sql",
  "SUPABASE_SETUP.sql",
  "DATABASE_UPGRADE_V10.sql"
];

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function extractInsertPolicy(sql) {
  const match = sql.match(/create policy "public can insert analytics"[\s\S]*?;/i);
  assert.ok(match, "missing public can insert analytics policy");
  return match[0];
}

function extractWithCheck(policy) {
  const match = policy.match(/with check\s*\(([\s\S]*)\)\s*;/i);
  assert.ok(match, "missing WITH CHECK");
  return match[1].replace(/\s+/g, " ").trim();
}

const ALLOWED = [
  "page_view",
  "book_view",
  "add_to_cart",
  "whatsapp_order_click",
  "search",
  "zero_result_search",
  "add_to_favorite",
  "remove_from_favorite",
  "contact_click",
  "filter_apply"
];

const SQL_NULL = Symbol("sql-null");

function pgJsonbTypeof(value) {
  if (value === SQL_NULL || value === undefined) return SQL_NULL;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return SQL_NULL;
}

function pgIsDistinctFrom(left, right) {
  if (left === SQL_NULL && right === SQL_NULL) return false;
  if (left === SQL_NULL || right === SQL_NULL) return true;
  return left !== right;
}

function pgIsTrue(value) {
  return value === true;
}

function pgOr(a, b) {
  if (a === true || b === true) return true;
  if (a === false && b === false) return false;
  return SQL_NULL;
}

function pgGt(left, right) {
  if (left === SQL_NULL || right === SQL_NULL) return SQL_NULL;
  return left > right;
}

function pgNotMatch(text, re) {
  if (text === SQL_NULL || text == null) return SQL_NULL;
  return !re.test(text);
}

function pgCharLength(text) {
  if (text === SQL_NULL || text == null) return SQL_NULL;
  return String(text).length;
}

function pgArrow(meta, key) {
  if (meta === SQL_NULL || meta == null || typeof meta !== "object" || Array.isArray(meta)) return SQL_NULL;
  if (!Object.prototype.hasOwnProperty.call(meta, key)) return SQL_NULL;
  return meta[key];
}

function pgHasKey(meta, key) {
  if (meta === SQL_NULL || meta == null || typeof meta !== "object" || Array.isArray(meta)) return false;
  return Object.prototype.hasOwnProperty.call(meta, key);
}

function pgMinusKey(meta, key) {
  if (meta === SQL_NULL || meta == null || typeof meta !== "object" || Array.isArray(meta)) return SQL_NULL;
  const out = {};
  Object.keys(meta).forEach((k) => {
    if (k !== key) out[k] = meta[k];
  });
  return out;
}

function pgCase(branches, fallback) {
  for (let i = 0; i < branches.length; i += 1) {
    if (pgIsTrue(branches[i][0])) return branches[i][1];
  }
  return fallback;
}

function pgJsonText(value) {
  if (value === SQL_NULL || value === undefined) return SQL_NULL;
  if (value === null) return SQL_NULL;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return SQL_NULL;
}

function pgMetaExistsBadElement(ids) {
  if (!Array.isArray(ids)) return false;
  return ids.some((elem) => {
    const where = pgOr(
      pgOr(
        pgIsDistinctFrom(pgJsonbTypeof(elem), "string"),
        pgGt(pgCharLength(pgJsonText(elem)), 32)
      ),
      pgNotMatch(pgJsonText(elem), /^\d+$/)
    );
    return pgIsTrue(where);
  });
}

/* PostgreSQL CASE / IS DISTINCT FROM / EXISTS (WHERE is TRUE only). */
function pgMetaCheck(eventName, meta) {
  if (meta === undefined) meta = null;
  const eventDistinct = pgIsDistinctFrom(eventName, "whatsapp_order_click");
  const typeDistinct = pgIsDistinctFrom(pgJsonbTypeof(meta), "object");
  const missingKey = meta !== null && !pgHasKey(meta, "book_ids");
  const extraKeys = meta !== null && pgHasKey(meta, "book_ids")
    && pgIsDistinctFrom(JSON.stringify(pgMinusKey(meta, "book_ids")), "{}");
  const bookIds = meta === null ? SQL_NULL : pgArrow(meta, "book_ids");
  const typeArr = pgIsDistinctFrom(pgJsonbTypeof(bookIds), "array");
  const tooLong = Array.isArray(bookIds) && bookIds.length > 200;

  return pgCase([
    [meta === null, true],
    [eventDistinct, false],
    [typeDistinct, false],
    [missingKey, false],
    [extraKeys, false],
    [typeArr, false],
    [tooLong, false]
  ], !pgMetaExistsBadElement(Array.isArray(bookIds) ? bookIds : []));
}

function passesInsertCheck(row, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  if (!ALLOWED.includes(row.event_name)) return false;
  const lenOk = (value, max) => value == null || String(value).length <= max;
  if (!lenOk(row.book_id, 32)) return false;
  if (!lenOk(row.search_query, 80)) return false;
  if (!lenOk(row.category, 100)) return false;
  if (!lenOk(row.path, 180)) return false;
  if (!lenOk(row.session_id, 100)) return false;
  if (!lenOk(row.legacy_id, 120)) return false;
  const inRange = (value, min, max) => value == null || (Number(value) >= min && Number(value) <= max);
  if (!inRange(row.result_count, 0, 100000)) return false;
  if (!inRange(row.item_count, 0, 200)) return false;
  if (!inRange(row.order_total, 0, 9999999.99)) return false;
  if (!pgMetaCheck(row.event_name, row.meta === undefined ? null : row.meta)) return false;
  const created = row.created_at == null ? now : Date.parse(row.created_at);
  if (!Number.isFinite(created)) return false;
  const fiveMin = 5 * 60 * 1000;
  if (created < now - fiveMin || created > now + fiveMin) return false;
  return true;
}

const policies = SQL_FILES.map((rel) => ({ rel, sql: read(rel), policy: extractInsertPolicy(read(rel)) }));
const checks = policies.map((item) => extractWithCheck(item.policy));

test("all canonical SQL copies share the same INSERT WITH CHECK body", () => {
  checks.forEach((body, index) => {
    assert.strictEqual(body, checks[0], SQL_FILES[index]);
  });
});

test("policy keeps anon+authenticated INSERT and is not WITH CHECK (true)", () => {
  policies.forEach((item) => {
    assert.match(item.policy, /for insert/i);
    assert.match(item.policy, /to anon,\s*authenticated/i);
    assert.doesNotMatch(item.policy, /with check \(true\)/i);
    assert.doesNotMatch(item.policy, /aal2/i);
    assert.doesNotMatch(item.sql, /grant select on public\.analytics_events to anon/i);
    assert.match(item.sql, /grant insert on public\.analytics_events to anon/i);
  });
});

test("policy allowlists current storefront event names and bounds", () => {
  const body = checks[0];
  ALLOWED.forEach((name) => assert.ok(body.includes(`'${name}'`), name));
  assert.match(body, /char_length\(book_id\) <= 32/);
  assert.match(body, /char_length\(search_query\) <= 80/);
  assert.match(body, /char_length\(category\) <= 100/);
  assert.match(body, /char_length\(path\) <= 180/);
  assert.match(body, /char_length\(session_id\) <= 100/);
  assert.match(body, /char_length\(legacy_id\) <= 120/);
  assert.match(body, /result_count <= 100000/);
  assert.match(body, /item_count <= 200/);
  assert.match(body, /order_total <= 9999999\.99/);
  assert.match(body, /coalesce\(jsonb_array_length\(meta -> 'book_ids'\), 0\) > 200/);
  assert.match(body, /interval '5 minutes'/);
  assert.doesNotMatch(body, /created_at\s*=\s*now\(\)/);
  assert.doesNotMatch(body, /book_id ~ '/);
});

test("meta CASE is NULL-safe (IS DISTINCT FROM, required book_ids, JSON string elements)", () => {
  const body = checks[0];
  assert.match(body, /event_name is distinct from 'whatsapp_order_click'/);
  assert.match(body, /jsonb_typeof\(meta\) is distinct from 'object'/);
  assert.match(body, /not \(meta \? 'book_ids'\)/);
  assert.match(body, /\(meta - 'book_ids'\) is distinct from '\{\}'::jsonb/);
  assert.match(body, /jsonb_typeof\(meta -> 'book_ids'\) is distinct from 'array'/);
  assert.match(body, /jsonb_array_elements\(meta -> 'book_ids'\)/);
  assert.match(body, /jsonb_typeof\(elem\.value\) is distinct from 'string'/);
  assert.match(body, /elem\.value #>> '\{\}'/);
  assert.doesNotMatch(body, /jsonb_array_elements_text/);
  assert.doesNotMatch(body, /jsonb_typeof\(meta -> 'book_ids'\) <> 'array'/);
  assert.doesNotMatch(body, /jsonb_typeof\(meta\) <> 'object'/);
});

test("new migration is repeat-safe and does not rewrite Admin RPC or execute from CI", () => {
  const sql = read("STAGE9_ANALYTICS_INSERT_RLS.sql");
  assert.match(sql, /DROP POLICY IF EXISTS/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS/i);
  assert.match(sql, /كود ئىجرا قىلمايدۇ/);
  assert.doesNotMatch(sql, /create or replace function public\.get_kutadgu_analytics/i);
  assert.doesNotMatch(sql, /delete from public\.analytics_events/i);
  assert.doesNotMatch(sql.replace(/service_role ئاچىلمايدۇ/g, ""), /service_role/i);
});

test("A: current valid storefront payloads are accepted", () => {
  const ctx = { path: "/book/108", sessionId: "s-test" };
  const rows = [
    A.buildRow("page_view", {}, { path: "/", sessionId: "s1" }),
    A.buildRow("book_view", { bookId: "108", legacyId: "children-3", category: "بالىلار" }, ctx),
    A.buildRow("book_view", { bookId: "romanlar-2" }, ctx),
    A.buildRow("add_to_cart", { bookId: "88", qty: 2 }, ctx),
    A.buildRow("add_to_favorite", { bookId: "88", legacyId: "old-slug" }, ctx),
    A.buildRow("remove_from_favorite", { bookId: "88" }, ctx),
    A.buildRow("search", { query: "قۇتادغۇ بىلىك", results: 4 }, { path: "/index.html", sessionId: "s1" }),
    A.buildRow("zero_result_search", { query: "تېپىلمىغان", results: 0 }, { path: "/", sessionId: "s1" }),
    A.buildRow("contact_click", { category: "whatsapp" }, { path: "/", sessionId: "s1" }),
    A.buildRow("filter_apply", { results: 12 }, { path: "/adabiyat", sessionId: "s1" }),
    A.buildRow("whatsapp_order_click", { bookId: "102", bookIds: ["102", "103"], items: 2, total: 80 }, { path: "/cart.html", sessionId: "s1" }),
    A.buildRow("whatsapp_order_click", { bookIds: Array.from({ length: 200 }, (_, i) => String(i + 1)), items: 200, total: 1 }, { path: "/cart.html", sessionId: "s1" })
  ];
  rows.forEach((row, index) => {
    assert.ok(row, "row " + index);
    assert.ok(passesInsertCheck(row), "accepted " + index + " " + row.event_name);
  });
});

test("B: unknown event names are rejected", () => {
  assert.strictEqual(A.buildRow("book_view_spam", { bookId: "1" }, { path: "/" }), null);
  assert.ok(!passesInsertCheck({ event_name: "book_view_spam", created_at: null }));
  assert.ok(!passesInsertCheck({ event_name: "drop_table", created_at: null }));
});

test("C: oversized strings are rejected", () => {
  const base = { event_name: "page_view" };
  assert.ok(!passesInsertCheck({ ...base, book_id: "1".repeat(33) }));
  assert.ok(!passesInsertCheck({ ...base, search_query: "ك".repeat(81) }));
  assert.ok(!passesInsertCheck({ ...base, category: "x".repeat(101) }));
  assert.ok(!passesInsertCheck({ ...base, path: "/".repeat(181) }));
  assert.ok(!passesInsertCheck({ ...base, session_id: "s".repeat(101) }));
  assert.ok(!passesInsertCheck({ ...base, legacy_id: "l".repeat(121) }));
  assert.ok(passesInsertCheck({ ...base, book_id: "1".repeat(32) }));
});

test("D: negative and excessive numeric values are rejected", () => {
  const base = { event_name: "add_to_cart", book_id: "1" };
  assert.ok(!passesInsertCheck({ ...base, result_count: -1 }));
  assert.ok(!passesInsertCheck({ ...base, result_count: 100001 }));
  assert.ok(!passesInsertCheck({ ...base, item_count: -1 }));
  assert.ok(!passesInsertCheck({ ...base, item_count: 201 }));
  assert.ok(!passesInsertCheck({ ...base, order_total: -0.01 }));
  assert.ok(!passesInsertCheck({ ...base, order_total: 10000000 }));
  assert.ok(passesInsertCheck({ ...base, item_count: 200, result_count: 100000, order_total: 9999999.99 }));
});

test("E: PostgreSQL NULL-semantics meta regressions", () => {
  const wa = "whatsapp_order_click";
  assert.strictEqual(pgMetaCheck(wa, null), true, "NULL meta");
  assert.strictEqual(pgMetaCheck(wa, {}), false, "meta = {}");
  assert.strictEqual(pgMetaCheck(wa, { extra: 1 }), false, "missing book_ids");
  assert.strictEqual(pgMetaCheck(wa, { book_ids: null }), false, "book_ids JSON null");
  assert.strictEqual(pgMetaCheck(wa, { book_ids: [null] }), false, "array JSON null element");
  assert.strictEqual(pgMetaCheck(wa, { book_ids: [123] }), false, "numeric JSON element");
  assert.strictEqual(pgMetaCheck(wa, { book_ids: ["123"] }), true, "string digit ids");
  assert.strictEqual(pgMetaCheck(wa, { book_ids: ["102"], extra: 1 }), false, "extra key");
  assert.strictEqual(pgMetaCheck(wa, { book_ids: Array.from({ length: 201 }, (_, i) => String(i + 1)) }), false, ">200 ids");

  const row = (meta) => ({ event_name: wa, book_id: "102", meta });
  assert.ok(passesInsertCheck(row(null)));
  assert.ok(!passesInsertCheck(row({})));
  assert.ok(!passesInsertCheck(row({ extra: 1 })));
  assert.ok(!passesInsertCheck(row({ book_ids: null })));
  assert.ok(!passesInsertCheck(row({ book_ids: [null] })));
  assert.ok(!passesInsertCheck(row({ book_ids: [123] })));
  assert.ok(passesInsertCheck(row({ book_ids: ["123"] })));
  assert.ok(!passesInsertCheck(row({ book_ids: ["102"], extra: 1 })));
  assert.ok(!passesInsertCheck(row({ book_ids: Array.from({ length: 201 }, (_, i) => String(i + 1)) })));
  assert.ok(!passesInsertCheck({ event_name: "page_view", meta: { book_ids: ["1"] } }));

  assert.ok(pgIsTrue(pgIsDistinctFrom(SQL_NULL, "array")), "NULL IS DISTINCT FROM 'array' is TRUE");
  assert.strictEqual(pgJsonbTypeof(pgArrow({}, "book_ids")), SQL_NULL, "missing key -> SQL NULL");
  assert.ok(!pgIsTrue(SQL_NULL), "CASE WHEN does not take a SQL NULL condition");
});

test("F: far-past created_at is rejected; omitted created_at (DB default) is accepted", () => {
  assert.ok(passesInsertCheck({ event_name: "page_view" }));
  assert.ok(!passesInsertCheck({ event_name: "page_view", created_at: "2020-01-01T00:00:00.000Z" }));
});

test("G: Admin SELECT/RPC and storefront INSERT path are unchanged", () => {
  const stage8 = read("STAGE8_STORE_ANALYTICS.sql");
  assert.match(stage8, /create or replace function public\.get_kutadgu_analytics/i);
  assert.match(stage8, /if not public\.is_kutadgu_admin\(\)/);
  assert.match(stage8, /grant execute on function public\.get_kutadgu_analytics\(integer\) to authenticated/);
  assert.match(stage8, /revoke all on function public\.get_kutadgu_analytics\(integer\) from anon/);
  const admin = read("admin.js");
  assert.ok(admin.includes('rpc("get_kutadgu_analytics"'));
  assert.ok(!admin.includes('from("analytics_events")'));
  const analytics = read("analytics.js");
  assert.ok(analytics.includes("/rest/v1/analytics_events"));
  assert.ok(analytics.includes("analytics must never block the shop"));
  assert.ok(analytics.includes("Authorization:\"Bearer \"+key"));
  assert.doesNotMatch(read("shop.js"), /from\("analytics_events"\)/);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("analytics-insert-rls-tests ok");
