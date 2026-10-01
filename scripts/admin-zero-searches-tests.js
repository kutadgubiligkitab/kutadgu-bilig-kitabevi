#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const A = require("../kutadgu-analytics-core.js");

const root = path.join(__dirname, "..");
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

test("confirmed zero is distinct from an unknown total", () => {
  assert.strictEqual(A.confirmedResultCount(null), null);
  assert.strictEqual(A.confirmedResultCount({ source: "static", total: 0 }), 0);
  assert.strictEqual(A.confirmedResultCount({ source: "static", total: 3 }), 3);
  assert.strictEqual(A.confirmedResultCount({ discovery: true, source: "static", total: 0 }), null);
  assert.strictEqual(A.confirmedResultCount({ source: "supabase", status: 200, offset: 0, rowCount: 0, total: 0, contentRange: "" }), 0);
  assert.strictEqual(A.confirmedResultCount({ source: "supabase", status: 200, offset: 0, rowCount: 2, total: 3, contentRange: "" }), null);
  assert.strictEqual(A.confirmedResultCount({ source: "supabase", status: 200, contentRange: "0-0/4", total: 4, offset: 0, rowCount: 1 }), 4);
  assert.strictEqual(A.confirmedResultCount({ source: "supabase", status: 416, contentRange: "*/0", total: 0, offset: 0, rowCount: 0 }), 0);
  assert.strictEqual(A.confirmedResultCount({ source: "supabase", status: 416, contentRange: "*/*", total: 0, offset: 0, rowCount: 0 }), null);
  assert.strictEqual(A.confirmedResultCount({ source: "supabase", total: 0, offset: 0, pageSize: 24 }), 0);
  assert.strictEqual(A.confirmedResultCount({ source: "supabase", total: 6, offset: 0, pageSize: 24 }), 6);
  assert.deepStrictEqual(A.searchEvents("q", A.confirmedResultCount({ source: "supabase", status: 200, offset: 0, rowCount: 2, contentRange: "" })).map((ev) => ev.name), ["search"]);
  const zero = A.searchEvents("q", 0);
  assert.deepStrictEqual(zero.map((ev) => ev.name), ["search", "zero_result_search"]);
  assert.strictEqual(zero[0].data.results, 0);
  assert.strictEqual(A.searchEvents("q", null)[0].data.results, null);
  assert.strictEqual(A.searchEvents("q", null).length, 1);
});

test("short ISBN blank and sensitive queries keep the existing filter", () => {
  assert.strictEqual(A.searchEvents("ن", 0).length, 2);
  assert.strictEqual(A.searchEvents("9780306406157", 0)[0].data.query, "9780306406157");
  assert.strictEqual(A.searchEvents("0306406152", 0).length, 2);
  assert.deepStrictEqual(A.searchEvents("", 0), []);
  assert.deepStrictEqual(A.searchEvents("   ", 0), []);
  assert.deepStrictEqual(A.searchEvents("user@example.com", 0), []);
  assert.deepStrictEqual(A.searchEvents("پارول", 0), []);
  const long = A.searchEvents("ك".repeat(200), 0);
  assert.strictEqual(long[0].data.query.length, A.QUERY_MAX);
});

test("zero-search pages keep order, duplicates, and a missing function distinct from failure", () => {
  const page = A.normalizeZeroSearchPage({
    total_queries: 12,
    total_events: 40,
    offset: 0,
    limit: 10,
    has_more: false,
    range_start: "2026-09-02",
    range_end: "2026-10-01",
    representation: "search",
    queries: [
      { query: "  new   once  ", searches: 1, last_searched_at: "2026-10-01T12:00:00Z" },
      { query: "new once", searches: 4, last_searched_at: "2026-10-01T11:00:00Z" },
      { query: "<b>bold</b>", searches: 2, last_searched_at: "2026-10-01T10:00:00Z" }
    ]
  });
  assert.strictEqual(page.queries.length, 2);
  assert.strictEqual(page.queries[0].query, "new once");
  assert.strictEqual(page.queries[1].query, "<b>bold</b>");
  assert.strictEqual(page.has_more, true);
  assert.strictEqual(page.timezone, "Europe/Istanbul");
  const more = A.appendZeroSearchRows(page.queries, [
    { query: "new once", searches: 1 },
    { query: "older", searches: 9 }
  ]);
  assert.deepStrictEqual(more.map((row) => row.query), ["new once", "<b>bold</b>", "older"]);
  assert.strictEqual(A.normalizeZeroSearchPage({ total_queries: "nope" }), null);
  assert.strictEqual(A.missingZeroSearchRpc({ code: "PGRST202", message: "Could not find the function" }), true);
  assert.strictEqual(A.missingZeroSearchRpc({ code: "42883", message: "undefined function" }), true);
  assert.strictEqual(A.missingZeroSearchRpc({ message: "Could not find the function public.get_kutadgu_zero_searches in the schema cache" }), true);
  assert.strictEqual(A.missingZeroSearchRpc({ code: "500", message: "network down" }), false);
  assert.strictEqual(A.missingZeroSearchRpc(null), false);
});

test("shop records the captured query only after a completed non-append search", () => {
  const shop = read("shop.js");
  const home = shop.slice(shop.indexOf("async function run(append=false)"), shop.indexOf("function dynamicListingCard"));
  const catalog = shop.slice(shop.indexOf("async function apply(append=false)"), shop.indexOf("function myBooksData"));
  assert.strictEqual((home.match(/trackCompletedSearch\(state\.search,result\)/g) || []).length, 1);
  assert.strictEqual((catalog.match(/trackCompletedSearch\(state\.search,result\)/g) || []).length, 1);
  assert.ok(!home.includes("trackSearchQuery(text.value"));
  assert.ok(!catalog.includes("trackSearchQuery(text.value"));
  assert.ok(home.includes("if(token!==requestId)return"));
  assert.ok(catalog.includes("if(token!==requestId||signal.aborted)return"));
  assert.ok(home.includes("if(!append)trackCompletedSearch"));
  assert.ok(catalog.includes("if(!append)trackCompletedSearch"));
  assert.ok(shop.includes("function confirmedCatalogTotal"));
});

test("header search still completes through the homepage field or the q parameter", () => {
  const header = read("public-header.js");
  assert.match(header, /event\.preventDefault\(\)/);
  assert.match(header, /homeInput\.value = q/);
  assert.match(header, /btn\.click\(\)/);
  assert.match(header, /\/\?q=/);
});

test("admin zero-search section is paginated and does not paint the summary top ten", () => {
  const admin = read("admin.js");
  const html = read("admin.html");
  assert.match(admin, /rpc\("get_kutadgu_zero_searches"/);
  assert.match(admin, /missingZeroSearchRpc/);
  assert.match(admin, /appendZeroSearchRows/);
  assert.match(admin, /normalizeZeroSearchPage/);
  assert.match(admin, /loadZeroSearches\(\{append:true\}\)/);
  assert.ok(!admin.includes('setAnalyticsCount("#analyticsZeroSearchesCount",view.counts&&view.counts.zero_result_searches)'));
  assert.ok(!admin.includes('renderAnalyticsList($("#analyticsZeroSearches")'));
  assert.match(html, /id="analyticsZeroSearchesMore"/);
  assert.match(html, /admin\.js\?v=80/);
  assert.match(html, /kutadgu-analytics-core\.js\?v=5/);
  assert.match(admin, /نەتىجىسىز ئىزدەش تىزىملىكى ئۈچۈن سانلىق مەلۇمات فۇنكسىيەسى تېخى قاچىلانمىغان/);
  assert.match(admin, /كۆرسىتىلگەن سان نۆلگە ئالماشتۇرۇلمىدى/);
});

test("stage 101 SQL is additive and keeps NULL distinct from zero", () => {
  const sql = read("STAGE101_ADMIN_ZERO_SEARCHES.sql");
  const rollback = read("STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_kutadgu_zero_searches/i);
  assert.doesNotMatch(sql, /create or replace function public\.get_kutadgu_analytics/i);
  assert.doesNotMatch(sql, /delete from public\.analytics_events/i);
  assert.match(sql, /result_count = 0/);
  assert.doesNotMatch(sql, /coalesce\(result_count,\s*0\)/i);
  assert.match(sql, /event_name = 'zero_result_search'/);
  assert.match(sql, /Europe\/Istanbul/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_kutadgu_zero_searches/i);
  assert.match(sql, /FROM anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_kutadgu_zero_searches/i);
  assert.match(sql, /TO authenticated/i);
  assert.match(sql, /is_kutadgu_admin/);
  assert.match(sql, /aal2/);
  assert.match(sql, /analytics_events_zero_search_recent_idx/);
  assert.match(sql, /ORDER BY last_searched_at DESC, query ASC/i);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.get_kutadgu_zero_searches/i);
  assert.match(rollback, /DROP INDEX IF EXISTS public\.analytics_events_zero_search_recent_idx/i);
  assert.doesNotMatch(rollback, /delete from public\.analytics_events/i);
  assert.doesNotMatch(rollback, /drop function[^;]*get_kutadgu_analytics/i);
  assert.doesNotMatch(rollback, /create or replace function public\.get_kutadgu_analytics/i);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("admin-zero-searches-tests ok");
