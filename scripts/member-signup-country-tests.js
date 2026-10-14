"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const signup = require("../cloudflare/member-signup-country.js");
const preview = require("../cloudflare/preview-dispatch.js");

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const FRESH = new Date(NOW - 1000).toISOString();
const MINUTE = new Date(NOW - 60 * 1000).toISOString();
const OLD = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHALLENGE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

function requestFor(url, body, cf, headers) {
  const text = JSON.stringify(body);
  const extra = headers || {};
  return {
    method: "POST",
    url,
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

function sdkBody(extra) {
  return Object.assign({
    email: "new@example.com",
    password: "correct-horse",
    data: { full_name: "يېڭى ئەزا", country: "FR" },
    code_challenge: CHALLENGE,
    code_challenge_method: "s256",
    gotrue_meta_security: { captcha_token: "captcha-token" },
    country: "FR",
    user_id: OTHER
  }, extra || {});
}

function emailUser(extra) {
  return Object.assign({
    id: USER,
    aud: "authenticated",
    email: "new@example.com",
    created_at: FRESH,
    identities: [{ provider: "email", user_id: USER }]
  }, extra || {});
}

async function runSignup(body, cf, auth, options) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("/auth/v1/signup")) {
      if (auth && auth.throwBefore) throw new Error("network");
      return {
        status: auth.status,
        text: async () => JSON.stringify(auth.payload)
      };
    }
    if (auth && auth.recordDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, auth.recordDelayMs));
    }
    if (auth && auth.recordThrow) throw new Error("record failed");
    if (auth && auth.recordStatus) return { status: auth.recordStatus, text: async () => "" };
    return { status: 204, text: async () => "" };
  };
  const result = await signup.handleMemberSignup(
    requestFor(
      (options && options.url) || "https://www.kutadgubilik.com/api/member-signup",
      body,
      cf,
      options && options.headers
    ),
    { SUPABASE_SECRET_KEY: "server-secret" },
    { fetchImpl, now: () => NOW }
  );
  return { result, calls };
}

function recorded(calls) {
  return calls.filter((call) => String(call.url).includes("record_member_signup_country"));
}

let failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log("PASS", name);
  }).catch((error) => {
    failed += 1;
    console.error("FAIL", name, error && error.stack || error);
  });
}

const jobs = [];

jobs.push(test("a new email signup records Cloudflare country for that user only", async () => {
  const { result, calls } = await runSignup(sdkBody(), { country: "tr" }, {
    status: 200,
    payload: { user: emailUser(), session: null }
  }, { headers: { "cf-ipcountry": "US", "x-forwarded-for": "198.51.100.8", "cf-connecting-ip": "203.0.113.9" } });
  assert.strictEqual(result.status, 200);
  const record = recorded(calls);
  assert.strictEqual(record.length, 1);
  assert.strictEqual(record[0].body.p_country, "TR");
  assert.strictEqual(record[0].body.p_user_id, USER);
  assert.strictEqual(record[0].init.headers.Authorization, "Bearer server-secret");
  const sent = calls[0].body;
  assert.strictEqual(sent.country, undefined);
  assert.strictEqual(sent.user_id, undefined);
  assert.strictEqual(sent.data.full_name, "يېڭى ئەزا");
  assert.strictEqual(sent.data.country, undefined);
  assert.strictEqual(sent.code_challenge, CHALLENGE);
  assert.strictEqual(sent.code_challenge_method, "s256");
  assert.strictEqual(sent.gotrue_meta_security.captcha_token, "captcha-token");
  assert.strictEqual(calls[0].init.headers["X-Forwarded-For"], "203.0.113.9");
  assert.strictEqual(calls[0].init.headers["X-Real-IP"], "203.0.113.9");
  assert.ok(calls[0].url.includes("redirect_to=https%3A%2F%2Fwww.kutadgubilik.com%2Faccount.html"));
  assert.ok(!calls[0].url.includes("evil.example"));
  assert.ok(!calls[0].url.includes("198.51.100.8"));
}));

jobs.push(test("a direct GoTrue user response records the signup country", async () => {
  const { result, calls } = await runSignup(sdkBody({ data: { full_name: "" }, gotrue_meta_security: {} }), { country: "DE" }, {
    status: 200,
    payload: emailUser()
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(JSON.parse(result.body).id, USER);
  assert.strictEqual(JSON.parse(result.body).user, undefined);
  assert.strictEqual(recorded(calls).length, 1);
  assert.strictEqual(calls[1].body.p_country, "DE");
  assert.strictEqual(calls[0].body.gotrue_meta_security, undefined);
}));

jobs.push(test("a raw session response records from its user and keeps the tokens", async () => {
  const payload = {
    access_token: "session-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: emailUser()
  };
  const { result, calls } = await runSignup(sdkBody(), { country: "KG" }, {
    status: 200,
    payload,
    recordStatus: 500
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(JSON.parse(result.body).access_token, "session-token");
  assert.strictEqual(JSON.parse(result.body).refresh_token, "refresh-token");
  assert.strictEqual(recorded(calls).length, 1);
}));

jobs.push(test("a hung country write still returns the signup body", async () => {
  const started = Date.now();
  const { result, calls } = await runSignup(sdkBody(), { country: "TR" }, {
    status: 200,
    payload: emailUser(),
    recordDelayMs: 5000
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, "elapsed " + elapsed);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(JSON.parse(result.body).id, USER);
  assert.strictEqual(recorded(calls).length, 1);
}));

jobs.push(test("a thrown country write still returns the signup body", async () => {
  const { result } = await runSignup(sdkBody(), { country: "TR" }, {
    status: 200,
    payload: emailUser(),
    recordThrow: true
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(JSON.parse(result.body).email, "new@example.com");
}));

jobs.push(test("rejection, duplicates, retries, malformed success, and missing country do not record", async () => {
  const cases = [
    [{ status: 422, payload: { msg: "weak" } }, { country: "TR" }],
    [{ status: 200, payload: emailUser({ identities: [] }) }, { country: "TR" }],
    [{ status: 200, payload: emailUser({ identities: [{ provider: "email", user_id: "" }] }) }, { country: "TR" }],
    [{ status: 200, payload: emailUser({ identities: [{ provider: "email", user_id: OTHER }] }) }, { country: "TR" }],
    [{ status: 200, payload: emailUser({ created_at: MINUTE }) }, { country: "US" }],
    [{ status: 200, payload: emailUser({ created_at: OLD }) }, { country: "TR" }],
    [{ status: 200, payload: emailUser({ created_at: new Date(NOW - 20000).toISOString() }) }, { country: "TR" }],
    [{ status: 200, payload: emailUser({ created_at: new Date(NOW + 30000).toISOString() }) }, { country: "TR" }],
    [{ status: 200, payload: { user: emailUser(), session: null } }, { country: "XX" }],
    [{ status: 200, payload: { user: emailUser(), session: { access_token: "t" } } }, {}],
    [{ status: 200, payload: { ok: true } }, { country: "TR" }],
    [{ status: 200, payload: { user: null } }, { country: "TR" }],
    [{ status: 200, payload: { id: USER, access_token: "orphan", identities: [{ provider: "email", user_id: USER }], created_at: FRESH } }, { country: "TR" }]
  ];
  for (const [auth, cf] of cases) {
    const { result, calls } = await runSignup(sdkBody(), cf, auth);
    assert.strictEqual(result.status, auth.status, JSON.stringify(auth.payload));
    assert.strictEqual(recorded(calls).length, 0, JSON.stringify(auth.payload));
    if (auth.payload && auth.payload.ok === true) assert.strictEqual(JSON.parse(result.body).ok, true);
  }
}));

jobs.push(test("a user created a few seconds ago still records", async () => {
  const { calls } = await runSignup(sdkBody(), { country: "NL" }, {
    status: 200,
    payload: emailUser({ created_at: new Date(NOW - 12000).toISOString() })
  });
  assert.strictEqual(recorded(calls).length, 1);
  const future = await runSignup(sdkBody(), { country: "NL" }, {
    status: 200,
    payload: emailUser({ created_at: new Date(NOW + 5000).toISOString() })
  });
  assert.strictEqual(recorded(future.calls).length, 1);
}));

jobs.push(test("missing or plain PKCE and an oversized captcha do not call GoTrue", async () => {
  const missing = sdkBody();
  delete missing.code_challenge;
  delete missing.code_challenge_method;
  const plain = sdkBody({ code_challenge_method: "plain" });
  const huge = sdkBody();
  huge.gotrue_meta_security = { captcha_token: "x".repeat(2049) };
  for (const body of [missing, plain, huge]) {
    const { result, calls } = await runSignup(body, { country: "TR" }, {
      status: 200,
      payload: emailUser()
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(calls.length, 0);
  }
}));

jobs.push(test("an untrusted redirect is replaced and a same-origin account page is kept", async () => {
  const evil = await runSignup(sdkBody(), { country: "TR" }, {
    status: 200,
    payload: emailUser({ identities: [] })
  }, { url: "https://www.kutadgubilik.com/api/member-signup?redirect_to=https%3A%2F%2Fevil.example%2Faccount.html" });
  assert.ok(evil.calls[0].url.includes("redirect_to=https%3A%2F%2Fwww.kutadgubilik.com%2Faccount.html"));
  assert.ok(!evil.calls[0].url.includes("evil.example"));
  const local = await runSignup(sdkBody(), { country: "TR" }, {
    status: 200,
    payload: emailUser({ identities: [] })
  }, { url: "http://127.0.0.1:4173/api/member-signup?redirect_to=http%3A%2F%2F127.0.0.1%3A4173%2Faccount.html" });
  assert.ok(local.calls[0].url.includes("redirect_to=http%3A%2F%2F127.0.0.1%3A4173%2Faccount.html"));
}));

jobs.push(test("a transport failure does not invent a second signup", async () => {
  const { result, calls } = await runSignup(sdkBody(), { country: "TR" }, { throwBefore: true, status: 200, payload: {} });
  assert.strictEqual(result.status, 503);
  assert.strictEqual(calls.length, 1);
}));

jobs.push(test("an echoed password is removed and is not logged", async () => {
  const password = "correct-horse";
  const { result } = await runSignup(sdkBody(), { country: "TR" }, {
    status: 400,
    payload: { msg: "rejected " + password }
  });
  assert.strictEqual(result.body.includes(password), false);
  assert.strictEqual(signup.handleMemberSignup.toString().includes("console."), false);
}));

jobs.push(test("login and Google age cannot record a signup country", async () => {
  const member = fs.readFileSync(path.join(__dirname, "../member.js"), "utf8");
  assert.strictEqual(member.includes("member-signup-country"), false);
  assert.strictEqual(member.includes("noteRecentGoogleSignupCountry"), false);
  assert.match(member, /db\.auth\.signUp\(/);
  assert.match(member, /memberAuthFetch/);
  assert.match(member, /emailRedirectTo/);
  assert.match(member, /\/api\/member-signup/);
  assert.strictEqual(typeof signup.handleMemberSignupCountry, "undefined");
  assert.strictEqual(preview.classifyPath("/api/member-signup", "").kind, "member-signup");
  assert.strictEqual(preview.classifyPath("/api/member-signup-country", "").kind, "asset");
  assert.strictEqual(preview.methodAllowed("member-signup", "POST"), true);
  assert.strictEqual(preview.methodAllowed("member-signup", "GET"), false);
  const minute = await runSignup(sdkBody(), { country: "US" }, {
    status: 200,
    payload: {
      id: USER,
      created_at: MINUTE,
      email: "google@example.com",
      identities: [{ provider: "google", user_id: USER }]
    }
  });
  assert.strictEqual(recorded(minute.calls).length, 0);
}));

Promise.all(jobs).then(() => {
  if (failed) {
    console.error("\n" + failed + " member signup country test(s) failed");
    process.exit(1);
  }
  console.log("member-signup-country-tests ok");
});
