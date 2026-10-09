const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const A = require(path.join(root, "kutadgu-analytics-core.js"));
const visit = require(path.join(root, "cloudflare/analytics-visit-country.js"));
const preview = require(path.join(root, "cloudflare/preview-dispatch.js"));

function requestFor(body, cf, headers) {
  const text = JSON.stringify(body);
  const extra = headers || {};
  return {
    method: "POST",
    url: "https://www.kutadgubilik.com/api/analytics-event",
    headers: {
      get(name) {
        const key = String(name || "").toLowerCase();
        if (key === "content-length") return String(Buffer.byteLength(text));
        return extra[key] || null;
      }
    },
    text: async () => text,
    cf
  };
}

test("worker uses Cloudflare country and ignores the body and header", async () => {
  const seen = [];
  const fetchImpl = async (_url, opts) => {
    seen.push(JSON.parse(opts.body));
    return { status: 201, text: async () => "" };
  };
  const result = await visit.handleAnalyticsEvent(requestFor({
    event_name: "page_view",
    path: "/",
    visitor_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    country: "DE",
    ip: "203.0.113.10"
  }, { country: "tr" }, { "cf-ipcountry": "FR" }), {
    SUPABASE_SECRET_KEY: "server-secret"
  }, { fetchImpl });
  assert.equal(result.status, 204);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].country, "TR");
  assert.equal(seen[0].ip, undefined);
  assert.equal(seen[0].event_name, "page_view");
});

test("unknown Cloudflare metadata is stored without a country", async () => {
  for (const country of ["XX", "T1", "", null]) {
    const seen = [];
    const result = await visit.handleAnalyticsEvent(requestFor({
      event_name: "page_view",
      path: "/",
      event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    }, { country }, {}), { SUPABASE_SECRET_KEY: "server-secret" }, {
      fetchImpl: async (_url, opts) => {
        seen.push(JSON.parse(opts.body));
        return { status: 201, text: async () => "" };
      }
    });
    assert.equal(result.status, 204);
    assert.equal(Object.hasOwn(seen[0], "country"), false);
  }
});

test("a missing country column is retried once without country", async () => {
  const seen = [];
  const result = await visit.handleAnalyticsEvent(requestFor({
    event_name: "page_view",
    path: "/",
    event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
  }, { country: "DE" }, {}), { SUPABASE_SECRET_KEY: "server-secret" }, {
    fetchImpl: async (_url, opts) => {
      seen.push(JSON.parse(opts.body));
      if (seen.length === 1) {
        return { status: 400, text: async () => '{"code":"PGRST204","message":"Could not find the \'country\' column of analytics_events"}' };
      }
      return { status: 201, text: async () => "" };
    }
  });
  assert.equal(result.status, 204);
  assert.equal(seen[0].country, "DE");
  assert.equal(Object.hasOwn(seen[1], "country"), false);
});

test("country collection failure does not claim the event was stored", async () => {
  const missing = await visit.handleAnalyticsEvent(requestFor({
    event_name: "page_view",
    path: "/"
  }, { country: "TR" }, {}), {}, { fetchImpl: async () => ({ status: 201, text: async () => "" }) });
  assert.equal(missing.status, 503);
  const down = await visit.handleAnalyticsEvent(requestFor({
    event_name: "page_view",
    path: "/"
  }, { country: "TR" }, {}), { SUPABASE_SECRET_KEY: "server-secret" }, {
    fetchImpl: async () => { throw new Error("network down"); }
  });
  assert.equal(down.status, 503);
  assert.equal(A.workerAnalyticsResult(503), "direct");
  assert.equal(A.workerAnalyticsResult(409), "stored");
  assert.equal(A.workerAnalyticsResult(204), "stored");
});

test("duplicate conflict stays a stored response and cart events carry no country", async () => {
  const conflict = await visit.handleAnalyticsEvent(requestFor({
    event_name: "page_view",
    path: "/",
    event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
  }, { country: "US" }, {}), { SUPABASE_SECRET_KEY: "server-secret" }, {
    fetchImpl: async () => ({ status: 409, text: async () => "" })
  });
  assert.equal(conflict.status, 409);
  const seen = [];
  await visit.handleAnalyticsEvent(requestFor({
    event_name: "add_to_cart",
    path: "/book/15",
    book_id: "15"
  }, { country: "TR" }, {}), { SUPABASE_SECRET_KEY: "server-secret" }, {
    fetchImpl: async (_url, opts) => {
      seen.push(JSON.parse(opts.body));
      return { status: 201, text: async () => "" };
    }
  });
  assert.equal(seen[0].event_name, "add_to_cart");
  assert.equal(Object.hasOwn(seen[0], "country"), false);
  assert.equal(preview.classifyPath("/api/analytics-event", "").kind, "analytics-event");
  assert.equal(preview.methodAllowed("analytics-event", "POST"), true);
  assert.equal(preview.methodAllowed("analytics-event", "GET"), false);
});

test("country report states stay distinct and do not invent a zero", () => {
  assert.equal(A.describeAnalytics({ page_views: 4 }, new Date("2026-10-08T12:00:00Z")).visitCountries.status, "unavailable");
  assert.equal(A.describeVisitCountries(null).rows, null);
  const partial = A.describeVisitCountries({
    status: "partial",
    countries: [{ code: "DE", visits: 2 }, { code: "TR", visits: 2 }],
    unknown_visits: 3,
    latest: [
      { country: null, counted_at: "2026-10-08T09:30:00Z" },
      { country: "TR", counted_at: "2026-10-08T06:30:00Z" }
    ]
  });
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.rows.map((row) => [row.label, row.visits]), [
    ["نامەلۇم", 3],
    ["گېرمانىيە", 2],
    ["تۈركىيە", 2]
  ]);
  assert.equal(partial.latest.length, 2);
  assert.equal(partial.latest[0].label, "نامەلۇم");
  assert.match(partial.latest[1].stamp, /^2026-10-08 09:30$/);
  const zero = A.describeVisitCountries({ status: "zero", countries: [], unknown_visits: 0, latest: [] });
  assert.equal(zero.status, "zero");
  assert.equal(zero.unknownVisits, 0);
  assert.deepEqual(zero.rows, []);
  const zz = A.countryLabel("ZZ");
  assert.ok(zz === "ZZ" || /[^\u0000-\u007f]/.test(zz));
  assert.equal(A.countryLabel("HK"), "خوڭكوڭ");
  assert.equal(A.countryLabel("hk"), "خوڭكوڭ");
  assert.equal(A.countryLabel("TR"), "تۈركىيە");
  assert.equal(A.countryLabel(null), "نامەلۇم");
  const many = [];
  for (let i = 0; i < 200; i += 1) {
    const code = String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26));
    many.push({ code, visits: 200 - i });
  }
  const full = A.describeVisitCountries({
    status: "complete",
    countries: many,
    unknown_visits: 5,
    latest: many.slice(0, 25).map((row) => ({
      country: row.code,
      counted_at: "2026-10-08T09:30:00Z"
    }))
  });
  assert.equal(full.rows.length, 201);
  assert.ok(full.rows.some((row) => row.label === "نامەلۇم" && row.visits === 5));
  assert.equal(full.latest.length, 20);
  const row = A.buildRow("page_view", { country: "TR" }, {
    path: "/",
    visitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    eventId: "ffffffff-ffff-4fff-8fff-ffffffffffff"
  });
  assert.equal(row.country, undefined);
});

test("the storefront recorder follows the worker result and falls back without a country", async () => {
  const calls = [];
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
  let workerStatus = 204;
  const context = vm.createContext({
    window,
    document,
    location: { hostname: "www.kutadgubilik.com", pathname: "/index.html" },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    fetch: async (url, opts) => {
      calls.push({ url: String(url), body: opts && opts.body });
      if (String(url).includes("/api/analytics-event")) {
        return { status: workerStatus, ok: workerStatus >= 200 && workerStatus < 300, text: async () => "" };
      }
      return { status: 201, ok: true, text: async () => "" };
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    localStorage: { getItem() { return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }, setItem() {}, removeItem() {} },
    crypto: global.crypto,
    console
  });
  vm.runInContext(fs.readFileSync(path.join(root, "analytics.js"), "utf8"), context);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((call) => call.url.includes("/api/analytics-event")));
  assert.equal(JSON.parse(calls[0].body).country, undefined);
  calls.length = 0;
  workerStatus = 503;
  await window.KutadguAnalytics.track("page_view", {});
  const workerCall = calls.find((call) => call.url.includes("/api/analytics-event"));
  const directCall = calls.find((call) => call.url.includes("/rest/v1/analytics_events"));
  assert.ok(workerCall);
  assert.ok(directCall);
  assert.equal(JSON.parse(directCall.body).country, undefined);
  assert.equal(JSON.parse(directCall.body).event_name, "page_view");
});
