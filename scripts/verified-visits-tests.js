"use strict";

// MOCKED SITEVERIFY. These checks exercise the Worker and cookie code with a
// fake Cloudflare response. They are not a live Turnstile integration and
// they are not a physical-device check.

const assert = require("assert");
const preview = require("../cloudflare/preview-dispatch.js");
const visits = require("../cloudflare/verified-visits.js");

const SIGNING = "signing-secret-for-tests-32ch-min";
const TURNSTILE = "turnstile-secret-for-tests-32ch";
const SITE_KEY = "0x4AAAAAAApublic-site-key";
const HOST = "www.kutadgubilik.com";

function baseEnv(extra) {
  return Object.assign({
    KUTADGU_HOST_MODE: "production",
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: TURNSTILE,
    VISIT_SIGNING_SECRET: SIGNING,
    SUPABASE_SECRET_KEY: "service-role-test"
  }, extra || {});
}

function fakeRequest({ method, url, body, cookie, cf, contentLength }) {
  const headers = new Headers({ host: new URL(url).host });
  if (cookie) headers.set("cookie", cookie);
  if (body != null) headers.set("content-type", "application/json");
  if (contentLength != null) headers.set("content-length", String(contentLength));
  return {
    method: method || "POST",
    url,
    cf: cf || { country: "TR" },
    headers,
    text: async () => (body == null ? "" : typeof body === "string" ? body : JSON.stringify(body))
  };
}

function siteverify(payload, calls) {
  return async function (url) {
    calls.push(String(url));
    if (String(url).indexOf("siteverify") === -1) {
      return { ok: true, status: 200, json: async () => true };
    }
    if (payload === "timeout") {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    if (payload === "invalid") {
      return { ok: true, status: 200, json: async () => { throw new Error("not json"); } };
    }
    return { ok: true, status: 200, json: async () => payload };
  };
}

function rpcFetch(store) {
  return async function (url, init) {
    const target = String(url);
    store.urls.push(target);
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (target.endsWith("/kutadgu_consume_visit_proof")) {
      if (store.proofs.has(body.p_token_hash)) return { ok: true, status: 200, json: async () => false };
      store.proofs.add(body.p_token_hash);
      return { ok: true, status: 200, json: async () => true };
    }
    if (target.endsWith("/kutadgu_accept_verified_visit")) {
      store.accepts.push(body);
      const key = body.p_event_id;
      if (store.events.has(key)) return { ok: true, status: 200, json: async () => store.events.get(key) };
      const counted = !store.visitors.has(body.p_visitor_id);
      store.visitors.add(body.p_visitor_id);
      store.events.set(key, counted);
      return { ok: true, status: 200, json: async () => counted };
    }
    if (target.endsWith("/kutadgu_note_verified_outage")) {
      store.outages += 1;
      return { ok: true, status: 200, json: async () => true };
    }
    if (target.endsWith("/analytics_events")) {
      store.eventsInserted += 1;
      return { ok: true, status: 201, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({ message: "missing" }) };
  };
}

function store() {
  return { urls: [], proofs: new Set(), accepts: [], events: new Map(), visitors: new Set(), outages: 0, eventsInserted: 0 };
}

async function dispatch(env, request, fetchImpl) {
  return preview.dispatch(request, env, { fetchImpl });
}

async function jsonOf(response) {
  return JSON.parse(await response.text());
}

async function proof(env, fetchImpl, token, extra) {
  const response = await dispatch(env, fakeRequest(Object.assign({
    url: "https://" + HOST + "/api/visit-proof",
    body: { token, action: "visit", visitor_id: "11111111-1111-4111-8111-111111111111" }
  }, extra || {})), fetchImpl);
  return { response, body: await jsonOf(response), cookie: response.headers.get("set-cookie") || "" };
}

(async () => {
  assert.deepStrictEqual(visits.expectedHosts({ KUTADGU_HOST_MODE: "production" }, "www.kutadgubilik.com"), visits.PRODUCTION_HOSTS);
  assert.ok(!visits.expectedHosts({ KUTADGU_HOST_MODE: "production", KUTADGU_VISIT_HOSTS: "localhost" }, HOST).includes("localhost"));
  assert.strictEqual(visits.configurationProblem({ KUTADGU_HOST_MODE: "production", TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: TURNSTILE, VISIT_SIGNING_SECRET: SIGNING }, HOST), "test_key");
  assert.strictEqual(visits.configurationProblem({ KUTADGU_HOST_MODE: "production" }, HOST), "missing");

  const missing = store();
  const missingFetch = rpcFetch(missing);
  const missingResult = await proof(baseEnv({ TURNSTILE_SECRET_KEY: "" }), (url, init) => {
    missingFetch.calls = missingFetch.calls || [];
    if (String(url).includes("siteverify")) missingFetch.calls.push(url);
    return missingFetch(url, init);
  }, "token");
  assert.strictEqual(missingResult.response.status, 503);
  assert.strictEqual(missingResult.body.counted, false);
  assert.strictEqual(missingResult.body.reason, "missing");
  assert.strictEqual(missingResult.cookie, "");
  assert.strictEqual(missing.outages, 1);
  assert.ok(!missingFetch.calls || missingFetch.calls.length === 0);

  const calls = [];
  const data = store();
  const fetchImpl = async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: false, "error-codes": ["invalid-input-response"] }, calls)(url, init);
    return rpcFetch(data)(url, init);
  };
  const forged = await proof(baseEnv(), fetchImpl, "forged-token");
  assert.strictEqual(forged.response.status, 403);
  assert.strictEqual(forged.body.reason, "verification_rejected");
  assert.strictEqual(forged.cookie, "");
  assert.strictEqual(data.accepts.length, 0);
  assert.strictEqual(data.outages, 0);

  const expiredCalls = [];
  const expired = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }, expiredCalls)(url, init);
    return rpcFetch(store())(url, init);
  }, "expired-token");
  assert.strictEqual(expired.body.reason, "verification_rejected");

  const wrongHost = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: "evil.example", action: "visit" }, [])(url, init);
    return rpcFetch(store())(url, init);
  }, "host-token");
  assert.strictEqual(wrongHost.response.status, 403);
  assert.strictEqual(wrongHost.cookie, "");

  const wrongAction = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: HOST, action: "login" }, [])(url, init);
    return rpcFetch(store())(url, init);
  }, "action-token");
  assert.strictEqual(wrongAction.body.reason, "verification_rejected");

  const invalid = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify("invalid", [])(url, init);
    return rpcFetch(store())(url, init);
  }, "bad-json");
  assert.strictEqual(invalid.response.status, 503);
  assert.strictEqual(invalid.body.reason, "verification_unavailable");

  const timed = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify("timeout", [])(url, init);
    return rpcFetch(store())(url, init);
  }, "slow");
  assert.strictEqual(timed.response.status, 503);

  const live = store();
  const token = "fresh-token-value";
  const passed = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: HOST, action: "visit" }, [])(url, init);
    return rpcFetch(live)(url, init);
  }, token);
  assert.strictEqual(passed.response.status, 200);
  assert.strictEqual(passed.body.counted, false);
  assert.strictEqual(passed.body.reason, "proof_accepted");
  assert.match(passed.cookie, /HttpOnly/);
  assert.match(passed.cookie, /Secure/);
  assert.match(passed.cookie, /SameSite=Lax/);
  assert.match(passed.cookie, /Domain=\.kutadgubilik\.com/);
  assert.match(passed.cookie, /Path=\//);
  assert.strictEqual(live.accepts.length, 0);
  assert.strictEqual(live.proofs.size, 1);

  const replay = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: HOST, action: "visit" }, [])(url, init);
    return rpcFetch(live)(url, init);
  }, token);
  assert.strictEqual(replay.body.reason, "replayed_proof");
  assert.strictEqual(replay.response.status, 403);
  assert.strictEqual(replay.cookie, "");
  assert.strictEqual(live.outages, 0);

  const consumeDown = store();
  const down = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: HOST, action: "visit" }, [])(url, init);
    if (String(url).endsWith("/kutadgu_consume_visit_proof")) {
      return { ok: false, status: 503, json: async () => ({ message: "unavailable" }) };
    }
    return rpcFetch(consumeDown)(url, init);
  }, "consume-503-token");
  assert.strictEqual(down.response.status, 503);
  assert.strictEqual(down.body.reason, "verification_unavailable");
  assert.strictEqual(down.cookie, "");
  assert.strictEqual(consumeDown.outages, 1);
  assert.strictEqual(consumeDown.accepts.length, 0);

  const consumeThrow = store();
  const thrown = await proof(baseEnv(), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: HOST, action: "visit" }, [])(url, init);
    if (String(url).endsWith("/kutadgu_consume_visit_proof")) throw new Error("rpc failed");
    return rpcFetch(consumeThrow)(url, init);
  }, "consume-throw-token");
  assert.strictEqual(thrown.response.status, 503);
  assert.strictEqual(thrown.body.reason, "verification_unavailable");
  assert.strictEqual(thrown.cookie, "");
  assert.strictEqual(consumeThrow.outages, 1);

  const countThrow = store();
  const countCookie = await visits.issueCookie(visits.uuidV4(), baseEnv(), HOST, Math.floor(Date.now() / 1000));
  const countTransport = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-count",
    cookie: countCookie.split(";")[0],
    body: { event_id: "16161616-1616-4161-8161-161616161616" }
  }), async (url, init) => {
    if (String(url).endsWith("/kutadgu_accept_verified_visit")) throw new Error("count rpc failed");
    return rpcFetch(countThrow)(url, init);
  });
  const countTransportBody = await jsonOf(countTransport);
  assert.strictEqual(countTransport.status, 503);
  assert.deepStrictEqual(countTransportBody, { ok: false, counted: false, reason: "verification_unavailable" });
  assert.strictEqual(countThrow.outages, 1);
  assert.strictEqual(countThrow.accepts.length, 0);
  assert.ok(countThrow.urls.some((url) => url.endsWith("/kutadgu_note_verified_outage")));

  const bare = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-count",
    body: { event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", visitor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
  }), async (url, init) => rpcFetch(live)(url, init));
  const bareBody = await jsonOf(bare);
  assert.strictEqual(bare.status, 403);
  assert.strictEqual(bareBody.reason, "cookie_missing");
  assert.strictEqual(live.accepts.length, 0);

  const cookiePair = passed.cookie.split(";")[0];
  const eventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const counted = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-count",
    cookie: cookiePair,
    body: { event_id: eventId, visitor_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    cf: { country: "TR" }
  }), async (url, init) => rpcFetch(live)(url, init));
  const countedBody = await jsonOf(counted);
  assert.strictEqual(counted.status, 200);
  assert.strictEqual(countedBody.counted, true);
  assert.notStrictEqual(live.accepts[0].p_visitor_id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.strictEqual(live.accepts[0].p_country, "TR");
  const visitor = live.accepts[0].p_visitor_id;

  const retry = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-count",
    cookie: cookiePair,
    body: { event_id: eventId, visitor_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }
  }), async (url, init) => rpcFetch(live)(url, init));
  const retryBody = await jsonOf(retry);
  assert.strictEqual(retryBody.counted, true);
  assert.strictEqual(live.accepts.length, 2);
  assert.strictEqual(live.accepts[1].p_visitor_id, visitor);
  assert.strictEqual(live.accepts[1].p_event_id, eventId);

  const otherEvent = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const suppressed = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-count",
    cookie: cookiePair,
    body: { event_id: otherEvent }
  }), async (url, init) => rpcFetch(live)(url, init));
  assert.strictEqual((await jsonOf(suppressed)).counted, false);

  const tampered = cookiePair.slice(0, -1) + (cookiePair.endsWith("a") ? "b" : "a");
  const badCookie = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-count",
    cookie: tampered,
    body: { event_id: "12121212-1212-4121-8121-121212121212" }
  }), async (url, init) => rpcFetch(live)(url, init));
  assert.strictEqual((await jsonOf(badCookie)).reason, "cookie_missing");

  const oldNow = Math.floor(Date.now() / 1000) - (13 * 60 * 60);
  const expiredCookie = await visits.issueCookie(visitor, baseEnv(), HOST, oldNow);
  const expiredCount = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-count",
    cookie: expiredCookie.split(";")[0],
    body: { event_id: "13131313-1313-4131-8131-131313131313" }
  }), async (url, init) => rpcFetch(live)(url, init));
  assert.strictEqual((await jsonOf(expiredCount)).reason, "verification_expired");

  const renewed = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/visit-proof",
    cookie: expiredCookie.split(";")[0],
    body: { token: "renew-token", action: "visit" }
  }), async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: HOST, action: "visit" }, [])(url, init);
    return rpcFetch(live)(url, init);
  });
  const renewedCookie = renewed.headers.get("set-cookie") || "";
  const renewedIdentity = await visits.readIdentity(fakeRequest({
    method: "GET",
    url: "https://" + HOST + "/",
    cookie: renewedCookie.split(";")[0]
  }), baseEnv(), Math.floor(Date.now() / 1000));
  assert.strictEqual(renewedIdentity.id, visitor);
  assert.strictEqual(renewedIdentity.current, true);

  const previewEnv = baseEnv({
    KUTADGU_HOST_MODE: "preview",
    KUTADGU_VISIT_HOSTS: "preview.example"
  });
  const previewPass = await proof(previewEnv, async (url, init) => {
    if (String(url).includes("siteverify")) return siteverify({ success: true, hostname: "preview.example", action: "visit" }, [])(url, init);
    return rpcFetch(store())(url, init);
  }, "preview-token", { url: "https://preview.example/api/visit-proof" });
  assert.strictEqual(previewPass.response.status, 200);
  assert.doesNotMatch(previewPass.cookie, /Domain=/);

  const legacy = store();
  const legacyResponse = await dispatch(baseEnv(), fakeRequest({
    url: "https://" + HOST + "/api/analytics-event",
    body: {
      event_name: "page_view",
      path: "/",
      visitor_id: "14141414-1414-4141-8141-141414141414",
      event_id: "15151515-1515-4151-8151-151515151515"
    }
  }), async (url, init) => rpcFetch(legacy)(url, init));
  assert.ok(legacyResponse.status === 204 || legacyResponse.status === 201 || legacyResponse.status === 200);
  assert.strictEqual(legacy.eventsInserted, 1);
  assert.ok(legacy.urls.every((url) => !url.includes("kutadgu_accept_verified_visit")));

  const config = await dispatch(baseEnv(), fakeRequest({
    method: "GET",
    url: "https://" + HOST + "/api/visit-config"
  }), async () => { throw new Error("config must not call the network"); });
  const configBody = await jsonOf(config);
  assert.strictEqual(configBody.configured, true);
  assert.strictEqual(configBody.siteKey, SITE_KEY);
  assert.ok(!JSON.stringify(configBody).includes(TURNSTILE));
  assert.ok(!JSON.stringify(configBody).includes(SIGNING));

  assert.match(require("fs").readFileSync(require("path").join(__dirname, "..", "visit-proof.js"), "utf8"), /زىيارەت سانىنى دەلىللەش/);
  assert.doesNotMatch(require("fs").readFileSync(require("path").join(__dirname, "..", "analytics.js"), "utf8"), /remoteTrack\("page_view"/);
  console.log("verified visits worker: PASS (mocked siteverify)");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
