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
  assert.strictEqual(page.next_offset, 3);
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

test("a browsing snapshot still reaches a group that becomes newest between pages", () => {
  const asOf = "2026-09-30T20:00:00+00:00";
  const all = Array.from({ length: 26 }, (_, i) => ({
    query: `query-${String(i + 1).padStart(2, "0")}`,
    searches: 1,
    last_searched_at: new Date(Date.parse("2026-09-30T19:59:00Z") - i * 60000).toISOString()
  }));
  function pageAt(offset, limit, rows, total, cursor) {
    return A.normalizeZeroSearchPage({
      total_queries: total,
      total_events: total,
      offset,
      limit,
      next_offset: cursor,
      as_of: asOf,
      days: 7,
      range_start: "2026-09-24",
      range_end: "2026-09-30",
      queries: rows
    });
  }
  const first = pageAt(0, 20, all.slice(0, 20), 26, 20);
  let session = A.continueZeroSearchSession(null, first);
  assert.strictEqual(session.nextOffset, 20);
  assert.strictEqual(session.rows.length, 20);
  assert.strictEqual(session.hasMore, true);
  assert.strictEqual(session.capped, false);
  assert.strictEqual(session.asOf, asOf);
  const second = pageAt(20, 20, all.slice(20), 26, 26);
  session = A.continueZeroSearchSession(session, second);
  assert.strictEqual(session.rows.length, 26);
  assert.strictEqual(session.rows[25].query, "query-26");
  assert.strictEqual(session.nextOffset, 26);
  assert.strictEqual(session.hasMore, false);
  assert.strictEqual(session.capped, false);
  assert.strictEqual(new Set(session.rows.map((row) => row.query)).size, 26);

  const overlap = pageAt(20, 20, [all[25], all[0], all[1]], 26, 23);
  const moved = A.continueZeroSearchSession(A.continueZeroSearchSession(null, first), overlap);
  assert.strictEqual(moved.rows.length, 21);
  assert.strictEqual(moved.rows[20].query, "query-26");
  assert.strictEqual(moved.nextOffset, 23);
  assert.notStrictEqual(moved.nextOffset, moved.rows.length);
  assert.strictEqual(moved.hasMore, true);
  assert.strictEqual(moved.capped, false);

  const refreshed = A.continueZeroSearchSession(null, pageAt(0, 20, [
    { query: "arrived-later", searches: 1, last_searched_at: "2026-09-30T20:02:00Z" },
    { query: "query-26", searches: 2, last_searched_at: "2026-09-30T20:01:00Z" }
  ].concat(all.slice(0, 18)), 27, 20));
  assert.strictEqual(refreshed.rows[0].query, "arrived-later");
  assert.strictEqual(refreshed.rows[1].searches, 2);
  assert.strictEqual(refreshed.asOf, asOf);
});

test("load more stays on the retained snapshot when the selector has moved", () => {
  const asOf = "2026-09-30T20:00:00+00:00";
  const first = A.normalizeZeroSearchPage({
    total_queries: 26,
    total_events: 40,
    offset: 0,
    limit: 20,
    next_offset: 20,
    as_of: asOf,
    days: 30,
    range_start: "2026-09-02",
    range_end: "2026-10-01",
    queries: [{ query: "query-01", searches: 1, last_searched_at: "2026-09-30T19:00:00Z" }]
  });
  const session = A.continueZeroSearchSession(null, first);
  session.hasMore = true;
  const open = A.zeroSearchPageRequest({ append: false, selectedDays: 7, limit: 20 });
  assert.deepStrictEqual(open, { p_days: 7, p_offset: 0, p_limit: 20 });
  const more = A.zeroSearchPageRequest({ append: true, selectedDays: 7, session, limit: 20 });
  assert.deepStrictEqual(more, { p_days: 30, p_offset: 20, p_limit: 20, p_as_of: asOf });
  const page = A.normalizeZeroSearchPage({
    total_queries: 26,
    total_events: 40,
    offset: 20,
    limit: 20,
    next_offset: 26,
    as_of: "2026-09-30T20:00:00Z",
    days: 30,
    range_start: "2026-09-02",
    range_end: "2026-10-01",
    queries: [{ query: "query-26", searches: 1, last_searched_at: "2026-09-30T18:00:00Z" }]
  });
  assert.strictEqual(A.zeroSearchAppendMatches(session, page), true);
  const continued = A.continueZeroSearchSession(session, page);
  assert.strictEqual(continued.rows.length, 2);
  assert.strictEqual(continued.totalQueries, 26);
  assert.strictEqual(continued.totalEvents, 40);
  assert.strictEqual(continued.days, 30);
  assert.strictEqual(continued.asOf, asOf);
  assert.strictEqual(session.rows.length, 1);
  assert.strictEqual(session.totalQueries, 26);

  function mismatch(patch) {
    const body = {
      total_queries: 26,
      total_events: 40,
      offset: 20,
      limit: 20,
      next_offset: 26,
      as_of: asOf,
      days: 30,
      range_start: "2026-09-02",
      range_end: "2026-10-01",
      queries: [{ query: "other", searches: 1, last_searched_at: "2026-09-30T18:00:00Z" }]
    };
    Object.assign(body, patch);
    const bad = A.normalizeZeroSearchPage(body);
    assert.strictEqual(A.zeroSearchAppendMatches(session, bad), false);
    assert.strictEqual(A.continueZeroSearchSession(session, bad), null);
    assert.strictEqual(session.totalQueries, 26);
    assert.strictEqual(session.rows.length, 1);
  }
  mismatch({ days: 7, total_queries: 7, total_events: 7 });
  mismatch({ as_of: "2026-09-30T21:00:00+00:00" });
  mismatch({ range_start: "2026-09-25" });
  mismatch({ range_end: "2026-09-30" });
  mismatch({ offset: 0, next_offset: 7 });
  mismatch({ offset: 25, next_offset: 26 });
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
  assert.match(admin, /zeroSearchPageRequest/);
  assert.match(admin, /zeroSearchAppendMatches/);
  assert.match(admin, /continueZeroSearchSession/);
  assert.doesNotMatch(admin, /range\.value\s*=/);
  assert.doesNotMatch(admin, /جاۋاب چەكلىمىسى/);
  assert.match(admin, /missingZeroSearchRpc/);
  assert.match(read("kutadgu-analytics-core.js"), /function appendZeroSearchRows/);
  assert.match(admin, /normalizeZeroSearchPage/);
  assert.match(admin, /loadZeroSearches\(\{append:true\}\)/);
  assert.ok(!admin.includes('setAnalyticsCount("#analyticsZeroSearchesCount",view.counts&&view.counts.zero_result_searches)'));
  assert.ok(!admin.includes('renderAnalyticsList($("#analyticsZeroSearches")'));
  assert.match(html, /id="analyticsZeroSearchesMore"/);
  assert.match(html, /admin\.js\?v=94/);
  assert.match(html, /kutadgu-analytics-core\.js\?v=9/);
  assert.match(admin, /نەتىجىسىز ئىزدەش تىزىملىكى ئۈچۈن سانلىق مەلۇمات فۇنكسىيەسى تېخى قاچىلانمىغان/);
  assert.match(admin, /كۆرسىتىلگەن سان نۆلگە ئالماشتۇرۇلمىدى/);
});

test("stage 101 SQL is additive and keeps NULL distinct from zero", () => {
  const sql = read("STAGE101_ADMIN_ZERO_SEARCHES.sql");
  const rollback = read("STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql");
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.get_kutadgu_zero_searches\(integer, integer, integer\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_kutadgu_zero_searches/i);
  assert.match(sql, /p_as_of timestamptz DEFAULT NULL/i);
  assert.match(sql, /created_at <= v_as_of/);
  assert.match(sql, /'next_offset', v_offset \+ v_page_count/);
  assert.match(sql, /'as_of', v_as_of/);
  assert.match(sql, /get_kutadgu_zero_searches\(integer, integer, integer, timestamptz\)/i);
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
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.get_kutadgu_zero_searches\(integer, integer, integer, timestamptz\)/i);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.get_kutadgu_zero_searches\(integer, integer, integer\)/i);
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
