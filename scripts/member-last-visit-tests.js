"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const visit = require("../cloudflare/member-last-visit.js");
const preview = require("../cloudflare/preview-dispatch.js");

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-14T12:00:00.000Z");

function requestFor(body, cf, headers) {
  const text = JSON.stringify(body);
  const extra = headers || {};
  return {
    method: "POST",
    url: "https://www.kutadgubilik.com/api/member-visit",
    headers: {
      get(name) {
        const key = String(name || "").toLowerCase();
        if (key === "content-length") return String(Buffer.byteLength(text));
        return extra[key] || "";
      }
    },
    text: async () => text,
    cf
  };
}

function userPayload(id, provider) {
  return {
    id,
    aud: "authenticated",
    email: "member@example.com",
    app_metadata: { provider: provider || "email" }
  };
}

async function runVisit(body, cf, auth, headers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("/auth/v1/user")) {
      if (auth && auth.throwAuth) throw new Error("auth down");
      return {
        status: auth && auth.status ? auth.status : 200,
        text: async () => JSON.stringify(auth && auth.user ? auth.user : userPayload(USER, auth && auth.provider))
      };
    }
    if (auth && auth.recordThrow) throw new Error("record failed");
    return { status: auth && auth.recordStatus ? auth.recordStatus : 204, text: async () => "" };
  };
  const result = await visit.handleMemberVisit(
    requestFor(body, cf, headers),
    { SUPABASE_SECRET_KEY: "server-secret" },
    { fetchImpl, now: () => NOW }
  );
  return { result, calls };
}

function recorded(calls) {
  return calls.filter((call) => call.url.includes("record_member_last_visit"));
}

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL", name, error && error.message);
  }
}

(async () => {
  await test("email and google sessions store only the trusted country and server time", async () => {
    for (const provider of ["email", "google"]) {
      const { result, calls } = await runVisit({
        page_path: "account.html?from=visit",
        country: "FR",
        user_id: OTHER,
        observed_at: "2000-01-01T00:00:00.000Z"
      }, { country: "tr" }, {
        provider,
        user: userPayload(USER, provider)
      }, {
        authorization: "Bearer member-token",
        "x-forwarded-for": "203.0.113.8",
        "cf-ipcountry": "US"
      });
      assert.strictEqual(result.status, 204);
      const rows = recorded(calls);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].body.p_user_id, USER);
      assert.strictEqual(rows[0].body.p_country, "TR");
      assert.strictEqual(rows[0].body.p_page, "account.html?from=visit");
      assert.strictEqual(rows[0].body.p_observed_at, NOW.toISOString());
      assert.strictEqual(rows[0].init.headers.Authorization, "Bearer server-secret");
      const lookup = calls.find((call) => call.url.includes("/auth/v1/user"));
      assert.strictEqual(lookup.init.headers.Authorization, "Bearer member-token");
      assert.strictEqual(lookup.init.headers.apikey, visit.PUBLIC_KEY);
    }
  });

  await test("a missing or unknown country is stored as null for that visit", async () => {
    for (const country of [undefined, "XX", "turkey"]) {
      const { result, calls } = await runVisit(
        { page_path: "index.html" },
        country ? { country } : {},
        { user: userPayload(USER, "email") },
        { authorization: "Bearer member-token" }
      );
      assert.strictEqual(result.status, 204);
      assert.strictEqual(recorded(calls)[0].body.p_country, null);
    }
  });

  await test("rejected or expired authentication writes nothing", async () => {
    for (const status of [401, 403]) {
      const { result, calls } = await runVisit(
        { page_path: "cart.html" },
        { country: "DE" },
        { status, user: userPayload(USER) },
        { authorization: "Bearer expired-token" }
      );
      assert.strictEqual(result.status, 401);
      assert.strictEqual(recorded(calls).length, 0);
    }
    const missing = await runVisit({ page_path: "cart.html" }, { country: "DE" }, {}, {});
    assert.strictEqual(missing.result.status, 401);
    assert.strictEqual(recorded(missing.calls).length, 0);
  });

  await test("a failed write is not retried inside the worker", async () => {
    const failedWrite = await runVisit(
      { page_path: "cart.html" },
      { country: "DE" },
      { recordStatus: 500, user: userPayload(USER) },
      { authorization: "Bearer member-token" }
    );
    assert.strictEqual(failedWrite.result.status, 503);
    assert.strictEqual(recorded(failedWrite.calls).length, 1);
    const thrown = await runVisit(
      { page_path: "cart.html" },
      { country: "DE" },
      { recordThrow: true, user: userPayload(USER) },
      { authorization: "Bearer member-token" }
    );
    assert.strictEqual(thrown.result.status, 503);
    assert.strictEqual(recorded(thrown.calls).length, 1);
  });

  await test("the route accepts only the visit post and the client no longer calls the old recorder", async () => {
    const member = fs.readFileSync(path.join(__dirname, "..", "member.js"), "utf8");
    assert.match(member, /\/api\/member-visit/);
    assert.doesNotMatch(member, /record_member_visit|memberAuthFetch|\/api\/member-signup/);
    assert.match(member, /db\.auth\.signUp\(/);
    assert.strictEqual(preview.classifyPath("/api/member-visit", "").kind, "member-visit");
    assert.strictEqual(preview.classifyPath("/api/member-signup", "").kind, "asset");
    assert.strictEqual(preview.methodAllowed("member-visit", "POST"), true);
    assert.strictEqual(preview.methodAllowed("member-visit", "GET"), false);
    const getResult = await visit.handleMemberVisit({ method: "GET", headers: { get() { return ""; } }, text: async () => "" }, {}, {});
    assert.strictEqual(getResult.status, 405);
  });

  if (failed) {
    console.error("\n" + failed + " member-last-visit test(s) failed");
    process.exit(1);
  }
  console.log("member-last-visit-tests ok");
})();
