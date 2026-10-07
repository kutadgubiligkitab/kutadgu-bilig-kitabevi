const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const A = require(path.join(root, "kutadgu-analytics-core.js"));

function memoryStorage(seed) {
  const data = Object.assign({}, seed);
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

test("old analytics payload does not invent visit counts from page views", () => {
  const described = A.describeAnalytics({
    page_views: 1561,
    book_views: 1561,
    cart_adds: 235,
    whatsapp_clicks: 9,
    top_books: [{ book_id: "15", title: "كىتاب", views: 4 }],
    zero_searches: []
  }, new Date("2026-10-06T09:00:00Z"));
  assert.strictEqual(described.schema, 1);
  assert.strictEqual(described.counts.page_views.value, 1561);
  assert.strictEqual(described.counts.book_views.value, 1561);
  assert.strictEqual(described.counts.cart_adds.value, 235);
  assert.strictEqual(described.visitors.today.status, "unavailable");
  assert.strictEqual(described.visitors.today.visitors, null);
  assert.strictEqual(described.countedVisits.today.status, "unavailable");
  assert.strictEqual(described.countedVisits.today.visits, null);
  assert.strictEqual(described.countedVisits.yesterday.visits, null);
  assert.strictEqual(described.countedVisits.period.visits, null);
  assert.strictEqual(described.countedVisits.daily.length, 7);
  assert.ok(described.countedVisits.daily.every((row) => row.status === "unavailable" && row.visits === null));
});

test("counted visits stay separate from distinct visitors and keep zero partial and unavailable", () => {
  const now = new Date("2026-10-06T09:00:00Z");
  const end = A.istanbulDate(now);
  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(A.addCalendarDays(end, -i));
  const described = A.describeAnalytics({
    schema_version: 2,
    page_views: 20,
    book_views: 4,
    cart_adds: 1,
    whatsapp_clicks: 0,
    visitors: {
      today: { status: "complete", visitors: 99 },
      yesterday: { status: "complete", visitors: 99 },
      period: { status: "complete", visitors: 99 },
      daily: days.map((date) => ({ date, status: "complete", visitors: 99 }))
    },
    counted_visits: {
      version: 1,
      window_hours: 3,
      today: { date: end, status: "complete", visits: 3 },
      yesterday: { date: A.addCalendarDays(end, -1), status: "unavailable", visits: null },
      period: { status: "partial", visits: 5 },
      daily: days.map((date, index) => {
        if (index === 6) return { date, status: "complete", visits: 3 };
        if (index === 5) return { date, status: "unavailable", visits: null };
        if (index === 4) return { date, status: "zero", visits: 0 };
        if (index === 3) return { date, status: "partial", visits: 2 };
        return { date, status: "zero", visits: 0 };
      })
    }
  }, now);
  assert.strictEqual(described.visitors.today.visitors, 99);
  assert.strictEqual(described.countedVisits.today.visits, 3);
  assert.strictEqual(described.countedVisits.today.text, "3");
  assert.strictEqual(described.countedVisits.yesterday.visits, null);
  assert.strictEqual(described.countedVisits.yesterday.text, "—");
  assert.strictEqual(described.countedVisits.period.visits, 5);
  assert.strictEqual(described.countedVisits.period.status, "partial");
  assert.notStrictEqual(described.countedVisits.period.visits, described.visitors.period.visitors);
  assert.strictEqual(described.countedVisits.daily[4].visits, 0);
  assert.strictEqual(described.countedVisits.daily[4].status, "zero");
  assert.strictEqual(described.countedVisits.daily[3].status, "partial");
  assert.strictEqual(described.countedVisits.daily[5].visits, null);
  assert.strictEqual(described.counts.page_views.value, 20);
  assert.strictEqual(described.counts.whatsapp_clicks.value, 0);
});

test("the same browser id survives sign-in keys and a second tab shares it", () => {
  const storage = memoryStorage();
  const first = A.visitorId(storage);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  storage.setItem("sb-auth-token", "signed-in");
  storage.removeItem("sb-auth-token");
  assert.strictEqual(A.visitorId(storage), first);
  assert.strictEqual(A.visitorId(storage), first);
  const otherBrowser = A.visitorId(memoryStorage());
  assert.notStrictEqual(otherBrowser, first);
  assert.strictEqual(A.visitorId(null), "");
});

test("storefront files do not reset the browser id or count visits locally", () => {
  const analytics = fs.readFileSync(path.join(root, "analytics.js"), "utf8");
  const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
  const member = fs.readFileSync(path.join(root, "member.js"), "utf8");
  assert.ok(analytics.includes("kutadgu-analytics-visitor") === false);
  assert.ok(!shop.includes("kutadgu-analytics-visitor"));
  assert.ok(!member.includes("kutadgu-analytics-visitor"));
  assert.ok(!analytics.includes("lastCounted"));
  assert.ok(!analytics.includes("resolution=ignore-duplicates"));
  assert.ok(analytics.includes('Prefer:"return=minimal"'));
  assert.ok(fs.readFileSync(path.join(root, "index.html"), "utf8").includes("analytics.js?v=7"));
  assert.ok(fs.readFileSync(path.join(root, "book-shell.html"), "utf8").includes("/analytics.js?v=7"));
  assert.ok(!analytics.includes("visit-at"));
  assert.strictEqual(A.shouldRecordRemote("www.kutadgubilik.com", "/admin.html"), false);
  assert.strictEqual(A.shouldRecordRemote("www.kutadgubilik.com", "/book-staff.html"), false);
  assert.strictEqual(A.shouldRecordRemote("www.kutadgubilik.com", "/index.html"), true);
  const row = A.buildRow("page_view", {}, {
    path: "/index.html",
    sessionId: "s-tab",
    visitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  });
  assert.strictEqual(row.event_name, "page_view");
  assert.strictEqual(row.visitor_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.strictEqual(row.event_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  const cart = A.buildRow("add_to_cart", { bookId: "15", qty: 1 }, {
    path: "/book/15",
    sessionId: "s-tab",
    visitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  });
  assert.strictEqual(cart.event_name, "add_to_cart");
});

test("a failed tracking request does not throw", async () => {
  const listeners = {};
  const document = {
    readyState: "complete",
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
    fetch: async () => { throw new Error("network down"); },
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(),
    crypto: global.crypto,
    console
  });
  vm.runInContext(fs.readFileSync(path.join(root, "analytics.js"), "utf8"), context);
  await window.KutadguAnalytics.track("page_view", {});
  await window.KutadguAnalytics.track("add_to_cart", { bookId: "15", qty: 1 });
});

test("migration files preserve analytics rows and do not apply Stage 100", () => {
  const forward = fs.readFileSync(path.join(root, "STAGE114_THREE_HOUR_VISITS.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(root, "STAGE114_THREE_HOUR_VISITS_ROLLBACK.sql"), "utf8");
  assert.match(forward, /interval '3 hours'/);
  assert.match(forward, /counted_visits/);
  assert.doesNotMatch(forward, /delete from public\.analytics_events/i);
  assert.doesNotMatch(forward, /schema_version/);
  assert.doesNotMatch(rollback, /delete from public\.analytics_events/i);
  assert.match(rollback, /make_interval/);
  assert.doesNotMatch(rollback, /counted_visits/);
  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  assert.match(html, /زىيارەت قېتىمى/);
  assert.match(html, /id="analyticsVisitorsToday">—/);
  assert.match(html, /بۈگۈنكى زىيارەت قېتىمى/);
  assert.doesNotMatch(html, /analyticsVisitCounts/);
  assert.doesNotMatch(html, /بۈگۈنكى خاتىرىلەنگەن زىيارەتچى/);
  assert.doesNotMatch(admin, /setVisitorCount/);
  assert.match(html, /admin\.js\?v=93/);
  assert.match(html, /kutadgu-analytics-core\.js\?v=8/);
});
