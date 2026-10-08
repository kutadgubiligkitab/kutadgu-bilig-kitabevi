#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
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
function memoryStorage(seed) {
  const data = Object.assign({}, seed);
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); }
  };
}

test("one visitor with reloads counts once per Istanbul day and page views stay page views", () => {
  const visitor = "11111111-1111-4111-8111-111111111111";
  const events = [0, 1, 2].map((hour) => ({
    event_name: "page_view",
    visitor_id: visitor,
    created_at: `2026-09-30T${String(hour).padStart(2, "0")}:00:00Z`
  }));
  const day = A.classifyVisitorDay(events, "2026-09-30");
  assert.strictEqual(day.visitors, 1);
  assert.strictEqual(day.events, 3);
  assert.strictEqual(day.status, "complete");
});

test("two tabs share a visitor id and keep separate sessions", () => {
  const local = memoryStorage();
  const tabA = memoryStorage();
  const tabB = memoryStorage();
  const visitorA = A.visitorId(local);
  const visitorB = A.visitorId(local);
  const sessionA = A.sessionId(tabA);
  const sessionB = A.sessionId(tabB);
  assert.ok(A.isUuidV4(visitorA));
  assert.strictEqual(visitorA, visitorB);
  assert.notStrictEqual(sessionA, sessionB);
  assert.notStrictEqual(visitorA, sessionA);
});

test("two browsers are two visitors", () => {
  const first = A.visitorId(memoryStorage());
  const second = A.visitorId(memoryStorage());
  assert.notStrictEqual(first, second);
  const events = [
    { visitor_id: first, created_at: "2026-09-30T12:00:00Z" },
    { visitor_id: second, created_at: "2026-09-30T13:00:00Z" }
  ];
  assert.strictEqual(A.classifyVisitorDay(events, "2026-09-30").visitors, 2);
});

test("Istanbul midnight splits the calendar day and seven days fill gaps as unavailable", () => {
  assert.strictEqual(A.istanbulDate("2026-09-30T20:59:59Z"), "2026-09-30");
  assert.strictEqual(A.istanbulDate("2026-09-30T21:00:00Z"), "2026-10-01");
  const range = A.istanbulRange(7, new Date("2026-09-30T21:00:00Z"));
  assert.deepStrictEqual(range, { start: "2026-09-25", end: "2026-10-01", days: 7, timezone: "Europe/Istanbul" });
  const described = A.describeAnalytics({
    schema_version: 2,
    range_start: "2026-09-25",
    range_end: "2026-10-01",
    visitors: {
      daily: [
        { date: "2026-09-29", status: "zero", visitors: 0, events: 0 },
        { date: "2026-10-01", status: "complete", visitors: 2, events: 4, identified_events: 4 }
      ]
    }
  }, new Date("2026-10-01T00:00:00Z"));
  assert.strictEqual(described.visitors.daily.length, 7);
  assert.strictEqual(described.visitors.daily[0].date, "2026-09-25");
  assert.strictEqual(described.visitors.daily[0].status, "unavailable");
  assert.strictEqual(described.visitors.daily[0].visitors, null);
  assert.strictEqual(described.visitors.daily[4].status, "zero");
  assert.strictEqual(described.visitors.daily[4].visitors, 0);
  assert.strictEqual(described.visitors.daily[6].visitors, 2);
});

test("missing identity is unavailable and is not invented from page views", () => {
  const day = A.classifyVisitorDay([
    { event_name: "page_view", created_at: "2026-09-30T08:00:00Z" },
    { event_name: "page_view", visitor_id: "", created_at: "2026-09-30T09:00:00Z" }
  ], "2026-09-30");
  assert.strictEqual(day.status, "unavailable");
  assert.strictEqual(day.visitors, null);
  assert.strictEqual(day.events, 2);
  assert.strictEqual(A.visitorId(null), "");
  assert.strictEqual(A.visitorId({ getItem() { throw new Error("blocked"); }, setItem() {} }), "");
  const historical = A.describeAnalytics({ page_views: 90, book_views: 10 }, new Date("2026-09-30T12:00:00Z"));
  assert.strictEqual(historical.schema, 1);
  assert.strictEqual(historical.visitors.today.status, "unavailable");
  assert.ok(historical.visitors.daily.every((row) => row.status === "unavailable" && row.visitors === null));
});

test("period distinct visitors are not the sum of daily visitors", () => {
  const visitor = "22222222-2222-4222-8222-222222222222";
  const events = [
    { visitor_id: visitor, created_at: "2026-09-29T10:00:00Z" },
    { visitor_id: visitor, created_at: "2026-09-30T10:00:00Z" }
  ];
  const dayOne = A.classifyVisitorDay(events, "2026-09-29").visitors;
  const dayTwo = A.classifyVisitorDay(events, "2026-09-30").visitors;
  const period = A.periodVisitorCount(events, "2026-09-29", "2026-09-30");
  assert.strictEqual(dayOne + dayTwo, 2);
  assert.strictEqual(period.visitors, 1);
  assert.notStrictEqual(period.visitors, dayOne + dayTwo);
});

test("partial days count only identified visitors", () => {
  const visitor = "33333333-3333-4333-8333-333333333333";
  const day = A.classifyVisitorDay([
    { visitor_id: visitor, created_at: "2026-09-30T10:00:00Z" },
    { created_at: "2026-09-30T11:00:00Z" }
  ], "2026-09-30");
  assert.strictEqual(day.status, "partial");
  assert.strictEqual(day.visitors, 1);
  assert.strictEqual(day.events, 2);
});

test("unknown search results stay unknown and a true zero still records one zero-result event", () => {
  const unknown = A.searchEvents("تارىخ", null);
  assert.strictEqual(unknown.length, 1);
  assert.strictEqual(unknown[0].data.results, null);
  const row = A.buildRow("search", unknown[0].data, { path: "/index.html", sessionId: "s" });
  assert.strictEqual(row.result_count, null);
  const zero = A.searchEvents("يوق", 0);
  assert.strictEqual(zero.length, 2);
  assert.strictEqual(zero[1].name, "zero_result_search");
  assert.strictEqual(A.searchEvents("يوق", undefined)[0].data.results, null);
});

test("canonical id wins and the lowest legacy id is the deterministic fallback", () => {
  const books = [
    { id: 9, legacy_id: "slug" },
    { id: 2, legacy_id: "slug" },
    { id: 3, legacy_id: "9" }
  ];
  assert.strictEqual(A.resolveBookId("9", books), "9");
  assert.strictEqual(A.resolveBookId("slug", books), "2");
  assert.strictEqual(A.resolveBookId("missing", books), "missing");
  const tokens = A.whatsappTokens({ book_id: "1", meta: { book_ids: ["1", "1", "2"] } });
  assert.deepStrictEqual(tokens, ["1", "2"]);
  const resolved = [...new Set(tokens.map((token) => A.resolveBookId(token, [{ id: 1 }, { id: 2 }])))];
  assert.deepStrictEqual(resolved, ["1", "2"]);
});

test("user-action order survives delayed delivery and does not treat equal steps as later", () => {
  const delayed = [
    { event_name: "add_to_cart", session_id: "delay", action_seq: 2, occurred_at: "2026-09-30T10:00:10Z", created_at: "2026-09-30T10:00:00Z" },
    { event_name: "book_view", session_id: "delay", action_seq: 1, occurred_at: "2026-09-30T10:00:00Z", created_at: "2026-09-30T10:00:20Z" }
  ];
  const user = A.orderedUserActionFunnel(delayed);
  const arrival = A.recordedArrivalFunnel(delayed);
  assert.strictEqual(user.kind, "ordered_user_action");
  assert.strictEqual(user.accurate_user_action_order, true);
  assert.strictEqual(user.cart_adds, 1);
  assert.strictEqual(arrival.kind, "recorded_arrival");
  assert.strictEqual(arrival.order, "server_receipt_time");
  assert.strictEqual(arrival.accurate_user_action_order, false);
  assert.notStrictEqual(arrival.kind, "ordered_user_action");
  assert.strictEqual(arrival.cart_adds, 0);

  const equalSeq = [
    { event_name: "book_view", session_id: "eq", action_seq: 5, occurred_at: "2026-09-30T10:00:00Z", created_at: "2026-09-30T10:00:00Z" },
    { event_name: "add_to_cart", session_id: "eq", action_seq: 5, occurred_at: "2026-09-30T10:00:00Z", created_at: "2026-09-30T10:00:00Z" }
  ];
  assert.strictEqual(A.orderedUserActionFunnel(equalSeq).views, 1);
  assert.strictEqual(A.orderedUserActionFunnel(equalSeq).cart_adds, 0);

  const equalTime = [
    { event_name: "add_to_cart", session_id: "tie", action_seq: 8, occurred_at: "2026-09-30T10:00:00Z", created_at: "2026-09-30T09:00:00Z" },
    { event_name: "book_view", session_id: "tie", action_seq: 7, occurred_at: "2026-09-30T10:00:00Z", created_at: "2026-09-30T10:00:00Z" }
  ];
  assert.strictEqual(A.orderedUserActionFunnel(equalTime).cart_adds, 1);
  assert.strictEqual(A.recordedArrivalFunnel(equalTime).cart_adds, 0);

  const historical = [
    { event_name: "book_view", session_id: "old", created_at: "2026-09-30T10:00:00Z" },
    { event_name: "add_to_cart", session_id: "old", created_at: "2026-09-30T10:05:00Z" }
  ];
  const excluded = A.orderedUserActionFunnel(historical);
  assert.strictEqual(excluded.views, 0);
  assert.strictEqual(excluded.excluded_without_action_seq, 2);
  const arrived = A.recordedArrivalFunnel(historical);
  assert.strictEqual(arrived.views, 1);
  assert.strictEqual(arrived.cart_adds, 1);
  assert.strictEqual(arrived.accurate_user_action_order, false);
  assert.strictEqual(A.orderedUserActionFunnel([]).view_to_cart_pct, null);
});

test("aggregate ratios stay labelled as ratios and are not clamped", () => {
  const described = A.describeAnalytics({ book_views: 10, cart_adds: 25, whatsapp_clicks: 40 });
  assert.strictEqual(described.funnel.kind, "aggregate_ratio");
  assert.strictEqual(described.funnel.funnel.view_to_cart_pct, 250);
  assert.strictEqual(described.funnel.funnel.cart_to_whatsapp_pct, 160);
  const ordered = A.describeAnalytics({
    schema_version: 2,
    funnel: { kind: "ordered_user_action", views: 4, cart_adds: 2, whatsapp_clicks: 1, view_to_cart_pct: 50, cart_to_whatsapp_pct: 50, view_to_whatsapp_pct: 25, excluded_without_session: 3, excluded_without_action_seq: 1 },
    arrival_funnel: { kind: "recorded_arrival", views: 5, cart_adds: 1, whatsapp_clicks: 0, accurate_user_action_order: false }
  });
  assert.strictEqual(ordered.funnel.kind, "ordered_user_action");
  assert.strictEqual(ordered.funnel.funnel.accurate_user_action_order, true);
  assert.strictEqual(ordered.funnel.funnel.excluded_without_session, 3);
  assert.strictEqual(ordered.arrival.kind, "recorded_arrival");
  assert.strictEqual(ordered.arrival.accurate_user_action_order, false);
  const mislabeled = A.describeAnalytics({
    funnel: { kind: "ordered_session", views: 4, cart_adds: 2, whatsapp_clicks: 1, accurate_user_action_order: true }
  });
  assert.strictEqual(mislabeled.funnel.kind, "recorded_arrival");
  assert.strictEqual(mislabeled.funnel.funnel.accurate_user_action_order, false);
});

test("old RPC fields are unsupported while a present zero stays zero", () => {
  const described = A.describeAnalytics({
    page_views: 9,
    book_views: 4,
    cart_adds: 0,
    whatsapp_clicks: 1,
    top_books: [{ book_id: "1", title: "كىتاب", views: 4 }],
    zero_searches: []
  });
  assert.strictEqual(described.counts.page_views.value, 9);
  assert.strictEqual(described.counts.cart_adds.value, 0);
  assert.strictEqual(described.counts.zero_result_searches.state, "unsupported");
  assert.strictEqual(described.lists.top_books.state, "rows");
  assert.strictEqual(described.lists.top_cart_books.state, "unsupported");
  assert.strictEqual(described.lists.top_whatsapp_books.state, "unsupported");
  assert.strictEqual(described.lists.top_searches.state, "unsupported");
  assert.strictEqual(described.lists.zero_searches.state, "empty");
});

test("a newer range request wins over an older in-flight response", () => {
  const gate = A.createAnalyticsLoadGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.strictEqual(gate.isCurrent(first), false);
  assert.strictEqual(gate.isCurrent(second), true);
});

test("retries reuse the decision and do not invent another visitor", () => {
  assert.strictEqual(A.retryDecision(0, "", 0), "retry-same-id");
  assert.strictEqual(A.retryDecision(503, "", 0), "retry-same-id");
  assert.strictEqual(A.retryDecision(503, "", 1), "drop");
  assert.strictEqual(A.retryDecision(409, "", 0), "stored");
  assert.strictEqual(A.retryDecision(201, "", 0), "stored");
  assert.strictEqual(A.retryDecision(400, "visitor_id", 0), "omit-column");
  assert.strictEqual(A.retryDecision(400, "action_seq", 4), "omit-column");
  assert.strictEqual(A.retryDecision(400, "visitor_id", 0, { schemaAttempts: 7, optionalLimit: 7 }), "drop");
  assert.strictEqual(A.retryDecision(0, "", 4, { schemaAttempts: 5, networkAttempts: 0 }), "retry-same-id");
  assert.strictEqual(A.retryDecision(503, "", 0, { schemaAttempts: 5, networkAttempts: 0, idempotent: false }), "drop");
  assert.strictEqual(A.retryDecision(503, "", 0, { networkAttempts: 1 }), "drop");
  assert.strictEqual(A.OPTIONAL_COLUMN_LIMIT >= 5, true);
  assert.strictEqual(A.retryDecision(0, "", 0, { idempotent: false }), "drop");
  assert.strictEqual(A.retryDecision(503, "", 0, { idempotent: false }), "drop");
  const now = new Date("2026-09-30T12:00:00Z");
  assert.strictEqual(A.acceptClientOccurredAt("2026-09-30T11:56:00Z", now), "2026-09-30T11:56:00.000Z");
  assert.strictEqual(A.acceptClientOccurredAt("2026-09-30T11:54:00Z", now), null);
  assert.strictEqual(A.acceptClientOccurredAt("2026-09-30T12:02:00Z", now), null);
  const seq = memoryStorage();
  assert.strictEqual(A.nextActionSeq(seq), 1);
  assert.strictEqual(A.nextActionSeq(seq), 2);
  const paired = A.buildRow("book_view", { bookId: "1" }, {
    path: "/book/1", sessionId: "s", actionSeq: 4, occurredAt: "2026-09-30T12:00:00.000Z"
  });
  assert.strictEqual(paired.action_seq, 4);
  assert.strictEqual(paired.occurred_at, "2026-09-30T12:00:00.000Z");
  const half = A.buildRow("book_view", { bookId: "1" }, { path: "/book/1", sessionId: "s", actionSeq: 4 });
  assert.ok(!("action_seq" in half));
  assert.ok(!("occurred_at" in half));
  const row = A.buildRow("add_to_cart", { bookId: "8", qty: 1 }, {
    path: "/cart.html",
    sessionId: "s",
    visitorId: "not-a-visitor",
    eventId: "44444444-4444-4444-8444-444444444444",
    host: "preview.vercel.app"
  });
  assert.ok(!("visitor_id" in row));
  assert.strictEqual(row.event_id, "44444444-4444-4444-8444-444444444444");
  assert.ok(!("host" in row));
  const again = A.buildRow("add_to_cart", { bookId: "8", qty: 2 }, {
    path: "/cart.html",
    sessionId: "s",
    eventId: "55555555-5555-4555-8555-555555555555",
    host: "www.kutadgubilik.com"
  });
  assert.notStrictEqual(again.event_id, row.event_id);
  assert.strictEqual(again.item_count, 2);
  assert.strictEqual(again.host, "www.kutadgubilik.com");
});

test("production hosts are recorded and local, preview, admin, and staff paths are not", () => {
  assert.strictEqual(A.shouldRecordRemote("www.kutadgubilik.com", "/index.html"), true);
  assert.strictEqual(A.shouldRecordRemote("kutadgubilik.com", "/book/12"), true);
  assert.strictEqual(A.shouldRecordRemote("kutadgu-bilig-kitab.vercel.app", "/cart.html"), false);
  assert.strictEqual(A.shouldRecordRemote("localhost", "/index.html"), false);
  assert.strictEqual(A.shouldRecordRemote("kutadgu-bilig-kitab-git-preview.vercel.app", "/index.html"), false);
  assert.strictEqual(A.shouldRecordRemote("www.kutadgubilik.com", "/admin.html"), false);
  assert.strictEqual(A.shouldRecordRemote("www.kutadgubilik.com", "/book-staff.html"), false);
});

test("admin rendering keeps the RPC, the period count, and the failure copy", () => {
  const admin = read("admin.js");
  const html = read("admin.html");
  assert.ok(admin.includes('rpc("get_kutadgu_analytics"'));
  assert.ok(!admin.includes('from("analytics_events")'));
  assert.ok(admin.includes("counted.period"));
  assert.ok(!/daily\.reduce|sumDaily/.test(admin));
  assert.ok(admin.includes("كۆرسىتىلگەن سانلار نۆلگە ئالماشتۇرۇلمىدى"));
  assert.ok(admin.includes("ordered_user_action"));
  assert.ok(admin.includes("يېتىپ كېلىش تەرتىپى ئىشلەتكۈچى ھەرىكىتى ئەمەس"));
  assert.ok(!admin.includes("ordered_session"));
  assert.ok(!admin.includes("STAGE8_STORE_ANALYTICS.sql"));
  assert.ok(html.includes("analyticsVisitorsToday"));
  assert.ok(html.includes("analyticsVisitorChart"));
  assert.ok(html.includes("Europe/Istanbul"));
  assert.ok(html.includes("جەمئىي ۋەقە نىسبىتى") === false);
  assert.ok(html.includes("WhatsApp زاكاز چېكىش"));
  assert.ok(html.includes('id="analyticsVisitorsToday">—'));
});

test("tracking keeps session and visitor apart and retries the same event id", () => {
  const js = read("analytics.js");
  const core = read("kutadgu-analytics-core.js");
  assert.ok(core.includes("kutadgu-analytics-visitor"));
  assert.ok(core.includes("kutadgu-analytics-session"));
  assert.ok(js.includes('core.visitorId(safeStorage("local"))'));
  assert.ok(js.includes("kutadgu-analytics-session"));
  assert.ok(!js.includes("resolution=ignore-duplicates"));
  assert.ok(js.includes('Prefer:"return=minimal"'));
  assert.ok(js.includes("idempotent:hasEvent"));
  assert.ok(js.includes("schemaAttempts:state.schema"));
  assert.ok(js.includes("networkAttempts:state.network"));
  assert.ok(js.includes("occurred_at"));
  assert.ok(js.includes("action_seq"));
  assert.ok(js.includes("analytics must never block the shop"));
  assert.ok(js.includes('{once:true}'));
  assert.ok(!/setTimeout\(/.test(js));
  assert.ok(!/sales_count/.test(js));
  const shop = read("shop.js");
  assert.ok(!shop.includes("Number(resultCount)||0"));
  const addFn = shop.slice(shop.indexOf("function add("), shop.indexOf("function remove("));
  assert.ok(addFn.includes('trackEvent("add_to_cart"'));
  assert.ok(!/sales_count/.test(addFn));
});

test("migration is repeat-safe, admin-only, and does not delete or backfill events", () => {
  const sql = read("STAGE100_ADMIN_DAILY_VISITORS.sql");
  assert.ok(/add column if not exists visitor_id/i.test(sql));
  assert.ok(/add column if not exists event_id/i.test(sql));
  assert.ok(/create unique index if not exists analytics_events_event_id_uidx/i.test(sql));
  assert.ok(/is_kutadgu_admin\(\)/.test(sql));
  assert.ok(/aal2/.test(sql));
  assert.ok(/revoke all on function public\.get_kutadgu_analytics\(integer\) from anon/i.test(sql));
  assert.ok(/grant execute on function public\.get_kutadgu_analytics\(integer\) to authenticated/i.test(sql));
  assert.ok(sql.includes("ordered_user_action"));
  assert.ok(sql.includes("recorded_arrival"));
  assert.ok(sql.includes("accurate_user_action_order"));
  assert.ok(/e\.action_seq > v\.first_view/.test(sql));
  assert.ok(!sql.includes("ordered_session"));
  assert.ok(/add column if not exists occurred_at/i.test(sql));
  assert.ok(/add column if not exists action_seq/i.test(sql));
  const rollback = read("STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql");
  assert.ok(/drop trigger if exists analytics_events_validate_timing/i.test(rollback));
  assert.ok(/create or replace function public\.get_kutadgu_analytics/i.test(rollback));
  assert.ok(/make_interval/.test(rollback));
  assert.ok(rollback.includes("book_engagement_detail"));
  assert.ok(!/delete from public\.analytics_events/i.test(rollback));
  assert.ok(!/schema_version/.test(rollback));
  assert.ok(!/\bsales_count\b/i.test(rollback));
  assert.ok(!/service_role/i.test(rollback));
  assert.ok(sql.includes("Europe/Istanbul"));
  assert.ok(/count\(distinct visitor_id\)/i.test(sql));
  assert.ok(sql.includes("period_distinct_is_not_the_sum_of_daily_counts"));
  assert.ok(sql.includes("book_engagement_detail"));
  assert.ok(sql.includes("book_engagement_cart"));
  assert.ok(/result_count = 0/.test(sql));
  assert.ok(/result_count is null/i.test(sql));
  assert.ok(!/least\s*\(\s*100/i.test(sql));
  assert.ok(!/b\.id::text\s*=\s*e\.book_id\s+or\s+b\.legacy_id/i.test(sql));
  assert.ok(!/delete from public\.analytics_events/i.test(sql));
  assert.ok(!/\bsales_count\b/i.test(sql));
  assert.ok(!/service_role/i.test(sql));
  assert.ok(sql.includes("MANUAL APPLY ONLY"));
});

test("cache pins moved for the changed analytics files", () => {
  const html = read("admin.html");
  const home = read("index.html");
  const shell = read("book-shell.html");
  assert.match(html, /admin\.css\?v=48/);
  assert.match(html, /kutadgu-analytics-core\.js\?v=7/);
  assert.match(html, /admin\.js\?v=86/);
  assert.match(home, /analytics\.js\?v=7/);
  assert.match(home, /kutadgu-analytics-core\.js\?v=5/);
  assert.match(home, /shop\.js\?v=147/);
  assert.match(shell, /src="\/analytics\.js\?v=7"/);
});

function browserStorage() {
  const data = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); }
  };
}

function loadAnalyticsVm(fetchImpl) {
  const listeners = {};
  const document = {
    readyState: "loading",
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach((fn) => fn(event)); }
  };
  const window = {
    KutadguAnalyticsCore: A,
    KUTADGU_SUPABASE_CONFIG: { url: "https://example.invalid", anonKey: "test-key" }
  };
  const context = vm.createContext({
    window,
    document,
    location: { hostname: "www.kutadgubilik.com", pathname: "/index.html" },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    fetch: fetchImpl,
    sessionStorage: browserStorage(),
    localStorage: browserStorage(),
    crypto: global.crypto,
    console
  });
  vm.runInContext(fs.readFileSync(path.join(root, "analytics.js"), "utf8"), context);
  return window;
}

async function legacySchemaStoresFirstPageViewOnce() {
  const stored = [];
  const probed = ["visitor_id", "event_id"];
  const withheld = ["host", "occurred_at", "action_seq"];
  let schemaErrors = 0;
  let firstBody = null;
  const window = loadAnalyticsVm(async (_url, init) => {
    const body = JSON.parse(init.body);
    if (!firstBody) firstBody = body;
    withheld.forEach((col) => {
      if (Object.prototype.hasOwnProperty.call(body, col)) throw new Error("sent absent column " + col);
    });
    const missing = probed.find((col) => Object.prototype.hasOwnProperty.call(body, col));
    if (missing) {
      schemaErrors += 1;
      return { ok: false, status: 400, text: async () => "PGRST204 Could not find the '" + missing + "' column of 'analytics_events' in the schema cache" };
    }
    stored.push(body);
    return { ok: true, status: 201, text: async () => "" };
  });
  await window.KutadguAnalytics.track("page_view", {});
  assert.ok(firstBody);
  withheld.forEach((col) => assert.ok(!(col in firstBody), col));
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].event_name, "page_view");
  assert.strictEqual(schemaErrors, probed.length);
  probed.concat(withheld).forEach((col) => assert.ok(!(col in stored[0]), col));
}

async function legacyLostResponseDoesNotDuplicate() {
  const stored = [];
  const window = loadAnalyticsVm(async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.event_id) {
      return { ok: false, status: 400, text: async () => "PGRST204 Could not find the 'event_id' column" };
    }
    stored.push(body);
    throw new Error("response lost after commit");
  });
  await window.KutadguAnalytics.track("add_to_cart", { bookId: "8", qty: 1 });
  await window.KutadguAnalytics.track("book_view", { bookId: "8" });
  assert.strictEqual(stored.length, 2);
  assert.deepStrictEqual(stored.map((row) => row.event_name).sort(), ["add_to_cart", "book_view"]);
  assert.ok(stored.every((row) => !("event_id" in row)));
}

async function eventIdRetryStaysOneRow() {
  const stored = [];
  const seen = new Set();
  let calls = 0;
  const window = loadAnalyticsVm(async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    if (!body.event_id) throw new Error("event_id missing");
    if (seen.has(body.event_id)) {
      if (String(init.headers.Prefer || "").includes("resolution=ignore-duplicates")) {
        throw new Error("retry asked PostgREST to select the inserted row");
      }
      return { ok: false, status: 409, text: async () => "{\"code\":\"23505\"}" };
    }
    seen.add(body.event_id);
    stored.push(body);
    throw new Error("response lost after commit");
  });
  await window.KutadguAnalytics.track("add_to_cart", { bookId: "8", qty: 1 });
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(calls, 2);
  await window.KutadguAnalytics.track("book_view", { bookId: "9" });
  assert.strictEqual(stored.length, 2);
  assert.notStrictEqual(stored[0].event_id, stored[1].event_id);
}

legacySchemaStoresFirstPageViewOnce()
  .then(() => legacyLostResponseDoesNotDuplicate())
  .then(() => eventIdRetryStaysOneRow())
  .then(() => {
    if (failed) {
      console.error(failed + " failed");
      process.exit(1);
    }
    console.log("PASS legacy schema first page view is stored once");
    console.log("PASS legacy schema lost response stays one row per event");
    console.log("admin-daily-visitors-tests ok");
  })
  .catch((err) => {
    console.error("FAIL legacy retry regression", err && err.stack || err);
    process.exit(1);
  });
