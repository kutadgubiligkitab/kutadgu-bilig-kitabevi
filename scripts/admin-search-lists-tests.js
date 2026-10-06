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
    console.error("FAIL", name, err && err.stack || err);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("a completed search stays one customer search, and a confirmed zero is separate from unknown", () => {
  assert.deepStrictEqual(A.searchEvents("ئۈچ قېتىم", 3).map((ev) => ev.name), ["search"]);
  assert.strictEqual(A.searchEvents("ئۈچ قېتىم", 3)[0].data.results, 3);
  const zero = A.searchEvents("نۆل", 0);
  assert.deepStrictEqual(zero.map((ev) => ev.name), ["search", "zero_result_search"]);
  assert.strictEqual(zero[0].data.results, 0);
  const unknown = A.searchEvents("نامەلۇم", null);
  assert.deepStrictEqual(unknown.map((ev) => ev.name), ["search"]);
  assert.strictEqual(unknown[0].data.results, null);
  assert.strictEqual(A.normalizeSearchQuery("  قوش   بوشلۇق  "), "قوش بوشلۇق");
  assert.notStrictEqual(A.normalizeSearchQuery("LatinCase"), A.normalizeSearchQuery("latincase"));
  assert.strictEqual(A.searchEvents("LatinCase", 1)[0].data.query, "LatinCase");
});

test("three calls stay three searches, including inside any visit window", () => {
  const calls = ["ئۈچ قېتىم", "ئۈچ قېتىم", "ئۈچ قېتىم"].map((query) => A.searchEvents(query, 1));
  assert.strictEqual(calls.length, 3);
  calls.forEach((events) => {
    assert.deepStrictEqual(events.map((ev) => ev.name), ["search"]);
    assert.strictEqual(events[0].data.query, "ئۈچ قېتىم");
  });
  const core = read("kutadgu-analytics-core.js");
  const searchFn = core.slice(core.indexOf("function searchEvents"), core.indexOf("function canonicalBookId"));
  assert.match(searchFn, /name:"search"/);
  assert.doesNotMatch(searchFn, /last_counted|visitor_id|interval '3 hours'/);
});

test("a retried event id is stored once and a failed search is not tracked", () => {
  const analytics = read("analytics.js");
  assert.match(analytics, /Prefer:\s*"return=minimal"/);
  assert.doesNotMatch(analytics, /resolution=ignore-duplicates/);
  assert.match(analytics, /retry-same-id/);
  assert.strictEqual(A.retryDecision(0, "", 0), "retry-same-id");
  assert.strictEqual(A.retryDecision(503, "", 0), "retry-same-id");
  assert.strictEqual(A.retryDecision(409, "", 0), "stored");
  assert.strictEqual(A.retryDecision(409, "", 1), "stored");
  const shop = read("shop.js");
  assert.match(shop, /if\(!append\)trackCompletedSearch/);
  assert.match(shop, /function confirmedCatalogTotal/);
});

test("search pages reuse the snapshot helpers and keep a failed read off zero", () => {
  const page = A.normalizeZeroSearchPage({
    total_queries: 3,
    total_events: 6,
    offset: 0,
    limit: 20,
    next_offset: 3,
    as_of: "2026-10-06T12:00:00+00:00",
    days: 7,
    range_start: "2026-09-30",
    range_end: "2026-10-06",
    representation: "search",
    queries: [
      { query: "گامما", searches: 3, last_searched_at: "2026-10-06T11:00:00Z" },
      { query: "ئالفا", searches: 2, last_searched_at: "2026-10-06T10:00:00Z" },
      { query: "بېتا", searches: 2, last_searched_at: "2026-10-06T10:00:00Z" }
    ]
  });
  assert.deepStrictEqual(page.queries.map((row) => row.query), ["گامما", "ئالفا", "بېتا"]);
  assert.strictEqual(page.queries[0].searches, 3);
  assert.strictEqual(page.has_more, false);
  const session = A.continueZeroSearchSession(null, page);
  const stale = A.normalizeZeroSearchPage({
    total_queries: 1,
    total_events: 1,
    offset: 0,
    limit: 20,
    next_offset: 1,
    as_of: "2026-10-05T12:00:00+00:00",
    days: 30,
    range_start: "2026-09-06",
    range_end: "2026-10-05",
    queries: [{ query: "باشقا", searches: 9, last_searched_at: "2026-10-05T09:00:00Z" }]
  });
  assert.strictEqual(A.zeroSearchAppendMatches(session, stale), false);
  assert.strictEqual(A.continueZeroSearchSession(session, stale), null);
  assert.strictEqual(session.rows.length, 3);
  assert.strictEqual(session.totalEvents, 6);
  assert.strictEqual(A.missingSearchTermsRpc({ code: "PGRST202", message: "Could not find the function" }), true);
  assert.strictEqual(A.missingSearchTermsRpc({ code: "500", message: "network down" }), false);
  assert.strictEqual(A.missingSearchTermsRpc(null), false);
});

test("admin search list is paginated and the summary paint does not replace it", () => {
  const admin = read("admin.js");
  const html = read("admin.html");
  assert.match(admin, /rpc\("get_kutadgu_searches"/);
  assert.match(admin, /loadSearches\(\{append:true\}\)/);
  assert.match(admin, /missingSearchTermsRpc/);
  assert.match(admin, /zeroSearchAppendMatches\(searchShown/);
  assert.match(admin, /كۆرسىتىلگەن سان نۆلگە ئالماشتۇرۇلمىدى/);
  assert.match(admin, /ئىزدەش تىزىملىكى ئۈچۈن سانلىق مەلۇمات فۇنكسىيەسى تېخى قاچىلانمىغان/);
  assert.doesNotMatch(admin, /renderAnalyticsList\(\$\("#analyticsSearches"\)/);
  assert.doesNotMatch(admin, /analyticsTopSearches/);
  assert.match(html, /id="analyticsSearchesMore"/);
  assert.match(html, /id="analyticsSearches"/);
  assert.doesNotMatch(html, /analyticsTopSearches/);
  assert.match(html, /admin\.js\?v=94/);
  assert.match(html, /kutadgu-analytics-core\.js\?v=9/);
  assert.match(html, /admin\.css\?v=51/);
  assert.match(html, /سېۋەتكە قوشۇش ۋەقىسى/);
  assert.match(html, /چېكىش سانى/);
  assert.match(html, /Europe\/Istanbul كۈن چېگرىسى/);
  const css = read("admin.css");
  assert.match(css, /@media\(max-width:700px\)\{\.admin-analytics-grid\{grid-template-columns:1fr\}\}/);
});

test("stage 116 adds the lists without rewriting visits or historical rows", () => {
  const sql = read("STAGE116_ADMIN_ANALYTICS_LISTS.sql");
  const rollback = read("STAGE116_ADMIN_ANALYTICS_LISTS_ROLLBACK.sql");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_kutadgu_searches/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_kutadgu_zero_searches/i);
  assert.match(sql, /top_cart_books/);
  assert.match(sql, /top_whatsapp_books/);
  assert.match(sql, /unknown_result_searches/);
  assert.match(sql, /counted_visits', private\.kutadgu_counted_visit_report\(p_days\)/);
  assert.match(sql, /coalesce\(result_count,0\)=0/);
  assert.match(sql, /result_count is null/i);
  assert.match(sql, /count\(DISTINCT event_key\)/i);
  assert.match(sql, /ORDER BY searches DESC, last_searched_at DESC, query ASC/i);
  assert.match(sql, /Europe\/Istanbul/);
  assert.match(sql, /jsonb_array_elements_text/);
  assert.match(sql, /event_name = 'add_to_cart'/);
  assert.match(sql, /event_name = 'whatsapp_order_click'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_kutadgu_searches/i);
  assert.match(sql, /FROM anon/i);
  assert.match(sql, /TO authenticated/i);
  assert.match(sql, /is_kutadgu_admin/);
  assert.match(sql, /aal2/);
  assert.doesNotMatch(sql, /delete from public\.analytics_events/i);
  assert.doesNotMatch(sql, /started_at/i);
  assert.doesNotMatch(sql, /kutadgu_resolve_book_id/i);
  const analyticsFn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.get_kutadgu_analytics"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.get_kutadgu_analytics")
  );
  assert.doesNotMatch(analyticsFn, /schema_version/);
  assert.match(analyticsFn, /top_books/);
  assert.match(analyticsFn, /zero_searches/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.get_kutadgu_searches/i);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.get_kutadgu_zero_searches\(integer, integer, integer, timestamptz\)/i);
  assert.match(rollback, /counted_visits', private\.kutadgu_counted_visit_report\(p_days\)/);
  assert.doesNotMatch(rollback, /top_cart_books/);
  assert.doesNotMatch(rollback, /delete from public\.analytics_events/i);
  assert.doesNotMatch(rollback, /analytics_events_event_id_uidx/);
  const stage114 = read("STAGE114_THREE_HOUR_VISITS.sql");
  assert.doesNotMatch(stage114, /top_cart_books/);
  assert.doesNotMatch(read("analytics.js"), /resolution=ignore-duplicates/);
});

test("cart and whatsapp descriptions do not invent orders", () => {
  const described = A.describeAnalytics({
    page_views: 4,
    book_views: 2,
    cart_adds: 3,
    whatsapp_clicks: 2,
    top_books: [{ book_id: "15", title: "Canon", views: 2 }],
    zero_searches: [],
    top_cart_books: [{ book_id: "15", title: "Canon", adds: 2 }],
    top_whatsapp_books: [{ book_id: "16", title: "Other", clicks: 2 }],
    unknown_result_searches: 1,
    counted_visits: { today: { status: "partial", visits: 1 } }
  });
  assert.strictEqual(described.lists.top_cart_books.state, "rows");
  assert.strictEqual(described.lists.top_cart_books.rows[0].adds, 2);
  assert.strictEqual(described.lists.top_whatsapp_books.rows[0].clicks, 2);
  assert.strictEqual(described.counts.unknown_result_searches.value, 1);
  assert.strictEqual(described.counts.page_views.value, 4);
  assert.strictEqual(described.countedVisits.today.visits, 1);
  assert.strictEqual(described.lists.top_searches.state, "unsupported");
  const tokens = A.whatsappTokens({ book_id: "15", meta: { book_ids: ["15", "15", "16"] } });
  assert.deepStrictEqual(tokens, ["15", "16"]);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("admin-search-lists-tests ok");
