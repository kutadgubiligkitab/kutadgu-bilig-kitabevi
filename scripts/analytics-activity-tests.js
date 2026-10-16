"use strict";

const assert = require("assert");
const preview = require("../cloudflare/preview-dispatch.js");
const visits = require("../cloudflare/verified-visits.js");
const core = require("../kutadgu-analytics-core.js");

const SIGNING = "signing-secret-for-tests-32ch-min";
const HOST = "www.kutadgubilik.com";
const CLIENT_VISITOR = "14141414-1414-4141-8141-141414141414";
const EVENT_A = "15151515-1515-4151-8151-151515151515";
const EVENT_B = "16161616-1616-4161-8161-161616161616";

function env() {
  return {
    KUTADGU_HOST_MODE: "production",
    TURNSTILE_SITE_KEY: "0x4AAAAAAApublic-site-key",
    TURNSTILE_SECRET_KEY: "turnstile-secret-for-tests-32ch",
    VISIT_SIGNING_SECRET: SIGNING,
    SUPABASE_SECRET_KEY: "service-role-test"
  };
}

function request(body, cookie) {
  const headers = new Headers({ host: HOST, "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  return {
    method: "POST",
    url: "https://" + HOST + "/api/analytics-event",
    headers,
    cf: { country: "TR" },
    text: async () => JSON.stringify(body)
  };
}

function capture(store) {
  return async function (url, init) {
    const target = String(url);
    const body = init && init.body ? JSON.parse(init.body) : {};
    store.calls.push({ url: target, body });
    if (target.endsWith("/analytics_events")) {
      store.inserts.push(body);
      return { ok: store.insertStatus < 400, status: store.insertStatus, text: async () => "", json: async () => ({}) };
    }
    if (target.endsWith("/kutadgu_attest_analytics_event")) {
      store.attests.push(body);
      if (store.attestThrows) throw new Error("attest down");
      if (!store.attestOk) return { ok: false, status: 500, json: async () => null };
      return { ok: true, status: 200, json: async () => true };
    }
    if (target.endsWith("/kutadgu_note_action_attestation_outage")) {
      store.outages += 1;
      return { ok: true, status: 200, json: async () => true };
    }
    return { ok: false, status: 404, json: async () => ({ message: "missing" }) };
  };
}

function blank() {
  return { calls: [], inserts: [], attests: [], outages: 0, insertStatus: 201, attestOk: true, attestThrows: false };
}

(async () => {
  const requestShape = core.activityPageRequest({
    category: "search",
    scope: "raw",
    sort: "count_asc",
    preset: "custom",
    start: "2026-10-01",
    end: "2026-10-03",
    query: "  ئالما  ",
    offset: 20,
    limit: 20
  });
  assert.deepStrictEqual(requestShape, {
    p_category: "search",
    p_scope: "raw",
    p_sort: "count_asc",
    p_preset: "custom",
    p_offset: 20,
    p_limit: 20,
    p_query: "ئالما",
    p_start: "2026-10-01",
    p_end: "2026-10-03"
  });
  assert.strictEqual(core.activityPageRequest({ preset: "today" }).p_preset, "today");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(core.activityPageRequest({ preset: "today" }), "p_start"), false);
  const unavailable = core.normalizeActivityPage({
    status: "unavailable",
    scope: "verified",
    category: "book_view",
    kind: "book",
    sort: "latest",
    rows: null,
    total: null,
    total_events: null,
    offset: 0,
    limit: 20,
    started_at: "2026-10-16T20:18:04Z"
  });
  assert.strictEqual(unavailable.rows, null);
  assert.strictEqual(unavailable.total, null);
  assert.strictEqual(core.normalizeActivityPage({ status: "zero", scope: "verified", category: "book_view", rows: [], total: 0, total_events: 0, offset: 0, limit: 20 }).status, "zero");
  assert.strictEqual(core.missingActivityRpc({ code: "PGRST202", message: "Could not find the function public.get_kutadgu_analytics_activity" }), true);

  const legacy = blank();
  const legacyResponse = await preview.dispatch(request({
    event_name: "book_view",
    book_id: "15",
    visitor_id: CLIENT_VISITOR,
    verified: true,
    event_id: EVENT_A
  }), env(), { fetchImpl: capture(legacy) });
  assert.strictEqual(legacyResponse.status, 204);
  assert.strictEqual(legacy.attests.length, 0);
  assert.strictEqual(legacy.outages, 0);
  assert.strictEqual(legacy.inserts[0].visitor_id, CLIENT_VISITOR);
  assert.strictEqual(legacy.inserts[0].verified, undefined);

  const cookie = await visits.issueCookie("17171717-1717-4171-8171-171717171717", env(), HOST, Math.floor(Date.now() / 1000));
  const live = blank();
  const counted = await preview.dispatch(request({
    event_name: "add_to_cart",
    book_id: "15",
    visitor_id: CLIENT_VISITOR,
    event_id: EVENT_A
  }, cookie.split(";")[0]), env(), { fetchImpl: capture(live) });
  assert.strictEqual(counted.status, 204);
  assert.strictEqual(live.attests.length, 1);
  assert.strictEqual(live.attests[0].p_visitor_id, "17171717-1717-4171-8171-171717171717");
  assert.notStrictEqual(live.attests[0].p_visitor_id, CLIENT_VISITOR);
  assert.strictEqual(live.attests[0].p_event_id, EVENT_A);
  assert.ok(live.calls.every((call) => !call.url.includes("kutadgu_accept_verified_visit")));

  const again = blank();
  again.insertStatus = 409;
  const retry = await preview.dispatch(request({
    event_name: "add_to_cart",
    book_id: "15",
    event_id: EVENT_A
  }, cookie.split(";")[0]), env(), { fetchImpl: capture(again) });
  assert.strictEqual(retry.status, 409);
  assert.strictEqual(again.attests.length, 1);
  assert.strictEqual(again.attests[0].p_event_id, EVENT_A);

  const second = blank();
  await preview.dispatch(request({
    event_name: "add_to_cart",
    book_id: "16",
    event_id: EVENT_B
  }, cookie.split(";")[0]), env(), { fetchImpl: capture(second) });
  assert.strictEqual(second.attests.length, 1);
  assert.strictEqual(second.attests[0].p_event_id, EVENT_B);

  const expiredCookie = await visits.issueCookie("17171717-1717-4171-8171-171717171717", env(), HOST, Math.floor(Date.now() / 1000) - (12 * 60 * 60) - 5);
  const expired = blank();
  await preview.dispatch(request({
    event_name: "search",
    search_query: "يوق",
    result_count: 0,
    event_id: EVENT_B
  }, expiredCookie.split(";")[0]), env(), { fetchImpl: capture(expired) });
  assert.strictEqual(expired.inserts.length, 1);
  assert.strictEqual(expired.attests.length, 0);
  assert.strictEqual(expired.outages, 0);

  const failed = blank();
  failed.attestOk = false;
  await preview.dispatch(request({
    event_name: "book_view",
    book_id: "15",
    event_id: EVENT_A
  }, cookie.split(";")[0]), env(), { fetchImpl: capture(failed) });
  assert.strictEqual(failed.attests.length, 1);
  assert.strictEqual(failed.outages, 1);

  console.log("analytics activity: PASS");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
