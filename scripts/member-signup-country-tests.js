"use strict";

const assert = require("assert");
const signup = require("../cloudflare/member-signup-country.js");
const preview = require("../cloudflare/preview-dispatch.js");

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const FRESH = new Date(NOW - 1000).toISOString();
const OLD = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function userPayload(extra) {
  return Object.assign({
    id: USER,
    created_at: FRESH,
    identities: [{ provider: "email", user_id: USER }],
    email: "new@example.com"
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
    if (auth && auth.recordStatus) return { status: auth.recordStatus, text: async () => "" };
    return { status: 204, text: async () => "" };
  };
  const result = await signup.handleMemberSignup(
    requestFor("https://www.kutadgubilik.com/api/member-signup", body, cf, options && options.headers),
    { SUPABASE_SECRET_KEY: "server-secret" },
    { fetchImpl, now: () => NOW }
  );
  return { result, calls };
}

let failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log("PASS", name);
  }).catch((error) => {
    failed += 1;
    console.error("FAIL", name, error && error.message);
  });
}

const jobs = [];

jobs.push(test("a new email signup records Cloudflare country for that user only", async () => {
  const password = "correct-horse";
  const { result, calls } = await runSignup({
    email: "new@example.com",
    password,
    full_name: "يېڭى ئەزا",
    country: "FR",
    user_id: OTHER
  }, { country: "tr" }, {
    status: 200,
    payload: { user: userPayload(), session: null }
  }, { headers: { "cf-ipcountry": "US" } });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(JSON.parse(result.body).session, null);
  const record = calls.find((call) => call.url.includes("record_member_signup_country"));
  assert.ok(record);
  assert.strictEqual(record.body.p_country, "TR");
  assert.strictEqual(record.body.p_user_id, USER);
  assert.strictEqual(record.init.headers.Authorization, "Bearer server-secret");
  const sent = calls[0].body;
  assert.strictEqual(sent.country, undefined);
  assert.strictEqual(sent.user_id, undefined);
  assert.strictEqual(sent.data.full_name, "يېڭى ئەزا");
  assert.ok(calls[0].url.includes("redirect_to=https%3A%2F%2Fwww.kutadgubilik.com%2Faccount.html"));
  assert.ok(!calls[0].url.includes("evil.example"));
}));

jobs.push(test("confirmation without a session still records the signup country", async () => {
  const { result, calls } = await runSignup({
    email: "new@example.com",
    password: "correct-horse",
    full_name: ""
  }, { country: "DE" }, {
    status: 200,
    payload: { user: userPayload(), session: null }
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(calls.filter((call) => call.url.includes("record_member_signup_country")).length, 1);
  assert.strictEqual(calls[1].body.p_country, "DE");
}));

jobs.push(test("a session signup keeps the auth body when country recording fails", async () => {
  const { result, calls } = await runSignup({
    email: "new@example.com",
    password: "correct-horse"
  }, { country: "KG" }, {
    status: 200,
    payload: { user: userPayload(), session: { access_token: "session-token", user: { id: USER } } },
    recordStatus: 500
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(JSON.parse(result.body).session.access_token, "session-token");
  assert.strictEqual(calls.filter((call) => call.url.includes("record_member_signup_country")).length, 1);
}));

jobs.push(test("rejection, duplicates, old users, and missing country do not record", async () => {
  const password = "correct-horse";
  const cases = [
    [{ email: "new@example.com", password }, { country: "TR" }, { status: 422, payload: { msg: "weak" } }],
    [{ email: "new@example.com", password }, { country: "TR" }, { status: 200, payload: { user: userPayload({ identities: [] }), session: null } }],
    [{ email: "new@example.com", password }, { country: "TR" }, { status: 200, payload: { user: userPayload({ created_at: OLD }), session: null } }],
    [{ email: "new@example.com", password }, { country: "XX" }, { status: 200, payload: { user: userPayload(), session: null } }],
    [{ email: "new@example.com", password }, {}, { status: 200, payload: { user: userPayload(), session: { access_token: "t" } } }]
  ];
  for (const [body, cf, auth] of cases) {
    const { result, calls } = await runSignup(body, cf, auth);
    assert.strictEqual(result.status, auth.status);
    assert.strictEqual(calls.filter((call) => call.url.includes("record_member_signup_country")).length, 0);
  }
}));

jobs.push(test("a transport failure does not invent a second signup", async () => {
  const { result, calls } = await runSignup({
    email: "new@example.com",
    password: "correct-horse"
  }, { country: "TR" }, { throwBefore: true, status: 200, payload: {} });
  assert.strictEqual(result.status, 503);
  assert.strictEqual(calls.length, 1);
}));

jobs.push(test("an echoed password is removed and is not logged", async () => {
  const password = "correct-horse";
  const { result } = await runSignup({
    email: "new@example.com",
    password
  }, { country: "TR" }, {
    status: 400,
    payload: { msg: "rejected " + password }
  });
  assert.strictEqual(result.body.includes(password), false);
  assert.strictEqual(signup.handleMemberSignup.toString().includes("console."), false);
}));

jobs.push(test("Google creation records this request country and login does not", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("/auth/v1/user")) {
      return {
        status: 200,
        text: async () => JSON.stringify({
          id: USER,
          created_at: FRESH,
          identities: [{ provider: "google", user_id: USER }]
        })
      };
    }
    return { status: 204, text: async () => "" };
  };
  const token = "header.payload.signature-token";
  const created = await signup.handleMemberSignupCountry(requestFor(
    "https://www.kutadgubilik.com/api/member-signup-country",
    { country: "FR", user_id: OTHER },
    { country: "nl" },
    { authorization: "Bearer " + token }
  ), { SUPABASE_SECRET_KEY: "server-secret" }, { fetchImpl, now: () => NOW });
  assert.strictEqual(created.status, 204);
  const recorded = calls.find((call) => String(call.url).includes("record_member_signup_country"));
  assert.ok(recorded);
  assert.strictEqual(recorded.body.p_country, "NL");
  assert.strictEqual(recorded.body.p_user_id, USER);
  calls.length = 0;
  const oldFetch = async (url) => {
    calls.push({ url, body: null });
    return {
      status: 200,
      text: async () => JSON.stringify({
        id: USER,
        created_at: OLD,
        identities: [{ provider: "google", user_id: USER }]
      })
    };
  };
  const login = await signup.handleMemberSignupCountry(requestFor(
    "https://www.kutadgubilik.com/api/member-signup-country",
    {},
    { country: "US" },
    { authorization: "Bearer " + token }
  ), { SUPABASE_SECRET_KEY: "server-secret" }, { fetchImpl: oldFetch, now: () => NOW });
  assert.strictEqual(login.status, 204);
  assert.strictEqual(calls.some((call) => String(call.url).includes("record_member_signup_country")), false);
}));

jobs.push(test("email identities and bad tokens do not record a Google country", async () => {
  const token = "header.payload.signature-token";
  const emailFetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({
      id: USER,
      created_at: FRESH,
      identities: [{ provider: "email", user_id: USER }, { provider: "google", user_id: USER }]
    })
  });
  const email = await signup.handleMemberSignupCountry(requestFor(
    "https://www.kutadgubilik.com/api/member-signup-country",
    {},
    { country: "TR" },
    { authorization: "Bearer " + token }
  ), { SUPABASE_SECRET_KEY: "server-secret" }, { fetchImpl: emailFetch, now: () => NOW });
  assert.strictEqual(email.status, 204);
  const denied = await signup.handleMemberSignupCountry(requestFor(
    "https://www.kutadgubilik.com/api/member-signup-country",
    {},
    { country: "TR" },
    { authorization: "Bearer short" }
  ), { SUPABASE_SECRET_KEY: "server-secret" }, { fetchImpl: emailFetch, now: () => NOW });
  assert.strictEqual(denied.status, 401);
}));

jobs.push(test("the worker routes accept only POST", () => {
  assert.strictEqual(preview.classifyPath("/api/member-signup", "").kind, "member-signup");
  assert.strictEqual(preview.classifyPath("/api/member-signup-country", "").kind, "member-signup-country");
  assert.strictEqual(preview.methodAllowed("member-signup", "POST"), true);
  assert.strictEqual(preview.methodAllowed("member-signup", "GET"), false);
  assert.strictEqual(preview.methodAllowed("member-signup-country", "PUT"), false);
}));

Promise.all(jobs).then(() => {
  if (failed) {
    console.error("\n" + failed + " member signup country test(s) failed");
    process.exit(1);
  }
  console.log("member-signup-country-tests ok");
});
