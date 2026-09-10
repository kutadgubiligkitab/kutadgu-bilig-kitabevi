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

function jsonbTypeof(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "null";
}

function bookIdsValid(ids) {
  if (!Array.isArray(ids) || ids.length > 200) return false;
  return ids.every((id) => {
    const text = String(id);
    return text.length <= 32 && /^\d+$/.test(text);
  });
}

function extraMetaKeys(meta) {
  return Object.keys(meta).filter((key) => key !== "book_ids");
}

/* Mirrors STAGE9 WITH CHECK. created_at omitted = DB default now() in the same transaction. */
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
  if (row.meta != null) {
    if (row.event_name !== "whatsapp_order_click") return false;
    if (jsonbTypeof(row.meta) !== "object") return false;
    if (extraMetaKeys(row.meta).length) return false;
    if (jsonbTypeof(row.meta.book_ids) !== "array") return false;
    if (!bookIdsValid(row.meta.book_ids)) return false;
  }
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
  assert.match(body, /jsonb_array_length\(meta -> 'book_ids'\) > 200/);
  assert.match(body, /interval '5 minutes'/);
  assert.doesNotMatch(body, /created_at\s*=\s*now\(\)/);
  assert.doesNotMatch(body, /book_id ~ '/);
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

test("E: malformed meta is rejected; valid whatsapp meta is accepted", () => {
  const wa = { event_name: "whatsapp_order_click", book_id: "102" };
  assert.ok(passesInsertCheck({ ...wa, meta: { book_ids: ["102", "103"] } }));
  assert.ok(passesInsertCheck({ ...wa, meta: null }));
  assert.ok(!passesInsertCheck({ event_name: "page_view", meta: { book_ids: ["1"] } }));
  assert.ok(!passesInsertCheck({ ...wa, meta: ["102"] }));
  assert.ok(!passesInsertCheck({ ...wa, meta: { book_ids: ["102"], extra: 1 } }));
  assert.ok(!passesInsertCheck({ ...wa, meta: { book_ids: "102" } }));
  assert.ok(!passesInsertCheck({ ...wa, meta: { book_ids: ["abc"] } }));
  assert.ok(!passesInsertCheck({ ...wa, meta: { book_ids: ["1".repeat(33)] } }));
  assert.ok(!passesInsertCheck({ ...wa, meta: { book_ids: Array.from({ length: 201 }, (_, i) => String(i + 1)) } }));
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
