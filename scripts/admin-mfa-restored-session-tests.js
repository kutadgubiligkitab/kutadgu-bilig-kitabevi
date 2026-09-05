#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Mfa = require("../admin-mfa.js");
const Idle = require("../admin-idle.js");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

let failed = 0;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function makeUser(id) {
  return { id: id || "admin-1", email: "admin@example.com" };
}

function makeSession(opts) {
  const options = opts || {};
  return {
    access_token: options.access_token || "access-token",
    refresh_token: options.refresh_token || "refresh-token",
    expires_at: options.expires_at != null ? options.expires_at : nowSec() + 3600,
    user: options.user || makeUser(options.userId)
  };
}

function clearAuthTestFlags() {
  delete globalThis.__kutadguSkipAdminAuth;
  delete globalThis.__kutadguAdminAalTest;
  delete globalThis.__kutadguMfaApi;
}

function makeAuthDb(opts) {
  const options = opts || {};
  const state = {
    session: options.session === undefined ? makeSession() : options.session,
    refreshCount: 0,
    getUserCount: 0,
    getSessionCount: 0,
    challengeCount: 0,
    listCount: 0,
    currentLevel: options.currentLevel || "aal1",
    factors: options.factors || [{ id: "factor-v", factor_type: "totp", status: "verified" }],
    challenged: false
  };
  async function maybeDelay(ms) {
    if (!ms) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  const db = {
    auth: {
      async initialize() {
        if (typeof options.initialize === "function") return options.initialize();
      },
      async getSession() {
        state.getSessionCount += 1;
        await maybeDelay(options.getSessionDelayMs);
        if (typeof options.getSession === "function") return options.getSession(state);
        if (options.getSessionError) return { data: { session: null }, error: options.getSessionError };
        return { data: { session: state.session }, error: null };
      },
      async refreshSession() {
        state.refreshCount += 1;
        await maybeDelay(options.refreshDelayMs);
        if (typeof options.onRefresh === "function") await options.onRefresh(state);
        if (options.refreshError) {
          return { data: { session: null, user: null }, error: options.refreshError };
        }
        const next = options.refreshedSession || makeSession({
          access_token: "fresh-access-token",
          user: state.session && state.session.user
        });
        state.session = next;
        return { data: { session: next, user: next.user }, error: null };
      },
      async getUser() {
        state.getUserCount += 1;
        if (options.getUserError && state.getUserCount <= (options.getUserErrorTimes || 1)) {
          return { data: { user: null }, error: options.getUserError };
        }
        if (!state.session || !state.session.user) {
          return { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing" } };
        }
        return { data: { user: state.session.user }, error: null };
      },
      mfa: {
        async listFactors() {
          state.listCount += 1;
          if (options.listError) return { data: null, error: options.listError };
          const all = state.factors.map((f) => Object.assign({}, f));
          return {
            data: {
              all,
              totp: all.filter((f) => f.factor_type === "totp" && f.status === "verified"),
              phone: []
            },
            error: null
          };
        },
        async getAuthenticatorAssuranceLevel() {
          return { data: { currentLevel: state.currentLevel, nextLevel: "aal2" }, error: options.aalError || null };
        },
        async challengeAndVerify({ code, factorId }) {
          state.challengeCount += 1;
          state.lastChallenge = { code, factorId, access: state.session && state.session.access_token };
          if (options.blockChallenge) {
            throw new Error("stale challenge should not run");
          }
          if (typeof options.challengeAndVerify === "function") {
            return options.challengeAndVerify({ code, factorId, state });
          }
          if (options.challengeError) return { data: null, error: options.challengeError };
          if (String(code) !== "123456") {
            return { data: null, error: { message: "Invalid TOTP code entered", code: "mfa_verification_failed" } };
          }
          state.currentLevel = options.aalAfterVerify == null ? "aal2" : options.aalAfterVerify;
          return { data: { access_token: "aal2-token" }, error: null };
        }
      }
    }
  };
  db.__state = state;
  return db;
}

function makeGateDom(otpValue) {
  const nodes = {
    status: { textContent: "", className: "" },
    otp: { value: otpValue == null ? "123456" : String(otpValue), addEventListener() {} },
    submit: { disabled: false },
    form: { addEventListener() {} },
    logout: {}
  };
  function $(sel) {
    if (sel === "#mfaGateStatus") return nodes.status;
    if (sel === "#mfaGateOtp") return nodes.otp;
    if (sel === "#mfaGateSubmit") return nodes.submit;
    if (sel === "#mfaGateForm") return nodes.form;
    if (sel === "#mfaGateLogout") return nodes.logout;
    return null;
  }
  $.nodes = nodes;
  return $;
}

function makeIdleDom(otpValue) {
  const nodes = {
    status: { textContent: "", className: "" },
    otp: { value: otpValue == null ? "123456" : String(otpValue), addEventListener() {} },
    submit: { disabled: false },
    form: { addEventListener() {} },
    logout: {}
  };
  function $(sel) {
    if (sel === "#idleLockStatus") return nodes.status;
    if (sel === "#idleLockOtp") return nodes.otp;
    if (sel === "#idleLockSubmit") return nodes.submit;
    if (sel === "#idleLockForm") return nodes.form;
    if (sel === "#idleLockLogout") return nodes.logout;
    return null;
  }
  $.nodes = nodes;
  return $;
}

const adminJs = read("admin.js");
const mfaJs = read("admin-mfa.js");
const idleJs = read("admin-idle.js");

test("sessionNeedsRefresh uses 120s skew and ignores unknown expiry", () => {
  assert.strictEqual(Mfa.SESSION_REFRESH_SKEW_SECONDS, 120);
  const healthy = makeSession({ expires_at: nowSec() + 3600 });
  assert.strictEqual(Mfa.sessionNeedsRefresh(healthy), false);
  const near = makeSession({ expires_at: nowSec() + 30 });
  assert.strictEqual(Mfa.sessionNeedsRefresh(near), true);
  const unknown = { access_token: "x", user: makeUser() };
  assert.strictEqual(Mfa.sessionNeedsRefresh(unknown), false);
  assert.strictEqual(Mfa.sessionNeedsRefresh({ user: makeUser() }), true);
});

test("classifyMfaFailure separates OTP, session, network, and completion errors", () => {
  assert.strictEqual(Mfa.classifyMfaFailure({ message: "Invalid TOTP code entered" }).category, "invalid_otp");
  assert.strictEqual(Mfa.classifyMfaFailure({ message: "Invalid code" }).category, "invalid_otp");
  assert.strictEqual(Mfa.classifyMfaFailure({ code: "mfa_verification_failed" }).category, "invalid_otp");
  assert.strictEqual(Mfa.classifyMfaFailure({ name: "AuthSessionMissingError" }).category, "session");
  assert.strictEqual(Mfa.classifyMfaFailure({ status: 401, message: "Invalid JWT" }).category, "session");
  assert.strictEqual(Mfa.classifyMfaFailure({ message: "refresh_token not found" }).category, "session");
  assert.strictEqual(Mfa.classifyMfaFailure({ name: "AuthRetryableFetchError" }).category, "network");
  assert.strictEqual(Mfa.classifyMfaFailure({ message: "Failed to fetch" }).category, "network");
  assert.strictEqual(Mfa.classifyMfaFailure({ message: "unexpected" }).category, "unknown");
  assert.match(Mfa.mfaGateMessage("invalid_otp"), /كود توغرا ئەمەس/);
  assert.match(Mfa.mfaGateMessage("session"), /كىرىش ۋاقتى توشتى/);
  assert.doesNotMatch(Mfa.mfaGateMessage("session"), /كود توغرا ئەمەس/);
  assert.doesNotMatch(Mfa.mfaGateMessage("network"), /كود توغرا ئەمەس/);
  assert.doesNotMatch(Mfa.mfaGateMessage("aal"), /كود توغرا ئەمەس/);
});

test("A. restored healthy AAL1 session is MFA-ready without refresh or password login", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({ currentLevel: "aal1" });
  const ready = await Mfa.ensurePrimarySessionReady(() => db, { force: true });
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.refreshed, false);
  assert.strictEqual(db.__state.refreshCount, 0);
  assert.ok(db.__state.getUserCount >= 1);
  const $ = makeGateDom("123456");
  let dashboard = 0;
  let login = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; },
    onSessionInvalid: async () => { login += 1; }
  });
  await gate.submit();
  assert.strictEqual(db.__state.challengeCount, 1);
  assert.strictEqual(db.__state.lastChallenge.access, "access-token");
  assert.strictEqual(db.__state.currentLevel, "aal2");
  assert.strictEqual(dashboard, 1);
  assert.strictEqual(login, 0);
  assert.strictEqual(db.__state.refreshCount, 0);
});

test("B. near-expiry restored session waits for refresh before challengeAndVerify", async () => {
  clearAuthTestFlags();
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const db = makeAuthDb({
    session: makeSession({ access_token: "stale-access", expires_at: nowSec() + 20 }),
    refreshDelayMs: 20,
    onRefresh: () => barrier
  });
  const $ = makeGateDom("123456");
  let dashboard = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; }
  });
  const pending = gate.submit();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(db.__state.challengeCount, 0);
  assert.strictEqual(db.__state.refreshCount, 1);
  release();
  await pending;
  assert.strictEqual(db.__state.challengeCount, 1);
  assert.strictEqual(db.__state.lastChallenge.access, "fresh-access-token");
  assert.strictEqual(dashboard, 1);
});

test("C. unrestorable session does not open MFA or dashboard", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({
    session: makeSession({ expires_at: nowSec() - 10 }),
    refreshError: { message: "Invalid Refresh Token", code: "refresh_token_not_found" }
  });
  const ready = await Mfa.ensurePrimarySessionReady(() => db, { force: true });
  assert.strictEqual(ready.ok, false);
  assert.ok(ready.reason === "refresh_failed" || ready.reason === "session_error");
  const $ = makeGateDom("123456");
  let dashboard = 0;
  let login = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; },
    onSessionInvalid: async () => { login += 1; }
  });
  await gate.submit();
  assert.strictEqual(db.__state.challengeCount, 0);
  assert.strictEqual(dashboard, 0);
  assert.strictEqual(login, 1);
  assert.match($.nodes.status.textContent, /كىرىش ۋاقتى توشتى/);
  assert.doesNotMatch($.nodes.status.textContent, /كود توغرا ئەمەس/);
});

test("D. explicit password-login fresh token still verifies without extra refresh", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({
    session: makeSession({ access_token: "password-fresh", expires_at: nowSec() + 3500 })
  });
  const $ = makeGateDom("123456");
  let dashboard = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; }
  });
  await gate.submit();
  assert.strictEqual(dashboard, 1);
  assert.strictEqual(db.__state.refreshCount, 0);
  assert.strictEqual(db.__state.lastChallenge.access, "password-fresh");
  const loginFn = adminJs.match(/async function login\(e\)\{[\s\S]*?async function logout/);
  assert.ok(loginFn);
  assert.match(loginFn[0], /signInWithPassword\(\{email,password\}\)/);
  assert.match(loginFn[0], /await routeSession\(\)/);
  assert.ok(loginFn[0].indexOf("signInWithPassword") < loginFn[0].indexOf("routeSession"));
});

test("E. genuine invalid OTP keeps the friendly invalid-code message", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb();
  const $ = makeGateDom("000000");
  let dashboard = 0;
  let login = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; },
    onSessionInvalid: async () => { login += 1; }
  });
  await gate.submit();
  assert.strictEqual(dashboard, 0);
  assert.strictEqual(login, 0);
  assert.strictEqual($.nodes.status.textContent, Mfa.MFA_GATE_MESSAGES.invalid_otp);
  assert.match($.nodes.status.textContent, /كود توغرا ئەمەس ياكى ۋاقتى ئۆتۈپ كەتتى/);
});

test("F. session error during MFA is not blamed on the OTP", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({
    challengeError: { status: 401, message: "Invalid JWT", code: "bad_jwt" }
  });
  const $ = makeGateDom("123456");
  let dashboard = 0;
  let login = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; },
    onSessionInvalid: async () => { login += 1; }
  });
  await gate.submit();
  assert.strictEqual(dashboard, 0);
  assert.strictEqual(login, 1);
  assert.strictEqual($.nodes.status.textContent, Mfa.MFA_GATE_MESSAGES.session);
  assert.doesNotMatch($.nodes.status.textContent, /كود توغرا ئەمەس/);
});

test("G. network/API failure is a retry message, not wrong code", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({
    challengeError: { name: "AuthRetryableFetchError", message: "Failed to fetch" }
  });
  const $ = makeGateDom("123456");
  let dashboard = 0;
  let login = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; },
    onSessionInvalid: async () => { login += 1; }
  });
  await gate.submit();
  assert.strictEqual(dashboard, 0);
  assert.strictEqual(login, 0);
  assert.strictEqual($.nodes.status.textContent, Mfa.MFA_GATE_MESSAGES.network);
  assert.doesNotMatch($.nodes.status.textContent, /كود توغرا ئەمەس/);
});

test("H. challenge success without AAL2 still blocks dashboard", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({ aalAfterVerify: "aal1" });
  const $ = makeGateDom("123456");
  let dashboard = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const gate = Mfa.attachGate({
    $: $,
    getDb: () => db,
    onAal2: async () => { dashboard += 1; }
  });
  await gate.submit();
  assert.strictEqual(db.__state.challengeCount, 1);
  assert.strictEqual(db.__state.currentLevel, "aal1");
  assert.strictEqual(dashboard, 0);
  assert.strictEqual($.nodes.status.textContent, Mfa.MFA_GATE_MESSAGES.aal);
  assert.doesNotMatch($.nodes.status.textContent, /كود توغرا ئەمەس/);
});

test("I. multiple verified TOTP factors keep deterministic selection and never auto-unenroll", () => {
  const chosen = Mfa.chooseVerifiedTotp([
    { id: "z-factor", factor_type: "totp", status: "verified" },
    { id: "a-factor", factor_type: "totp", status: "verified" }
  ]);
  assert.strictEqual(chosen.id, "a-factor");
  assert.doesNotMatch(mfaJs, /before\.verified\.map\(factorId\)/);
  assert.doesNotMatch(mfaJs.match(/async function ensurePrimarySessionReady[\s\S]*?function evaluateAccess/)[0], /unenroll/);
  assert.match(Mfa.attachGate.toString() + mfaJs, /chooseVerifiedTotp/);
});

test("J. overlapping ready calls share one inflight refresh and stay race-safe", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({
    session: makeSession({ expires_at: nowSec() + 15 }),
    getSessionDelayMs: 25
  });
  const first = Mfa.ensurePrimarySessionReady(() => db, { force: true });
  const second = Mfa.ensurePrimarySessionReady(() => db, { force: true });
  const results = await Promise.all([first, second]);
  assert.strictEqual(results[0], results[1]);
  assert.strictEqual(results[0].ok, true);
  assert.strictEqual(db.__state.getSessionCount, 1);
  assert.strictEqual(db.__state.refreshCount, 1);
  const route = adminJs.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
  assert.ok(route);
  assert.match(route[0], /const gen=\+\+routeGen/);
  assert.match(route[0], /ensurePrimarySessionReady/);
  const readyAt = route[0].indexOf("ensurePrimarySessionReady");
  const genAfterReady = route[0].indexOf("if(gen!==routeGen)return", readyAt);
  assert.ok(genAfterReady > readyAt);
  assert.match(adminJs, /onAuthStateChange\(\(\)=>setTimeout\(routeSession,0\)\)/);
  const failBlock = route[0].slice(route[0].indexOf("if(!ready||!ready.ok)"), route[0].indexOf("const session=ready.session"));
  assert.doesNotMatch(failBlock, /signOut/);
  assert.match(adminJs, /onSessionInvalid:\(\)=>\{/);
  const gateBind = adminJs.match(/function bindMfaGate\(\)\{[\s\S]*?async function loadMfaCard/);
  assert.doesNotMatch(gateBind[0], /signOut/);
});

test("K. idle lock reuses session readiness and does not treat session errors as wrong OTP", async () => {
  clearAuthTestFlags();
  const mem = {
    data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; }
  };
  globalThis.__kutadguAdminIdleStorage = mem;
  Idle.markLocked();
  const db = makeAuthDb({
    challengeError: { status: 401, message: "jwt expired" }
  });
  const $ = makeIdleDom("123456");
  let unlocked = 0;
  globalThis.__kutadguMfaApi = db.auth.mfa;
  const lock = Idle.attachLock({
    $: $,
    Mfa: Mfa,
    getDb: () => db,
    onUnlock: async () => { unlocked += 1; }
  });
  await lock.submit();
  assert.strictEqual(unlocked, 0);
  assert.strictEqual(Idle.readState().locked, true);
  assert.strictEqual($.nodes.status.textContent, Mfa.MFA_GATE_MESSAGES.session);
  assert.doesNotMatch($.nodes.status.textContent, /كود توغرا ئەمەس/);
  const db2 = makeAuthDb();
  globalThis.__kutadguMfaApi = db2.auth.mfa;
  const $bad = makeIdleDom("000000");
  const lock2 = Idle.attachLock({
    $: $bad,
    Mfa: Mfa,
    getDb: () => db2,
    onUnlock: async () => { unlocked += 1; }
  });
  await lock2.submit();
  assert.strictEqual(unlocked, 0);
  assert.match($bad.nodes.status.textContent, /كود توغرا ئەمەس/);
  assert.match($bad.nodes.status.textContent, /سىز چىقىرىلمايسىز/);
  delete globalThis.__kutadguAdminIdleStorage;
});

test("getUser failure on a locally healthy token refreshes once then allows MFA", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({
    session: makeSession({ access_token: "local-stale", expires_at: nowSec() + 2000 }),
    getUserError: { status: 401, message: "Invalid JWT" },
    getUserErrorTimes: 1
  });
  const ready = await Mfa.ensurePrimarySessionReady(() => db, { force: true });
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.refreshed, true);
  assert.strictEqual(db.__state.refreshCount, 1);
  assert.strictEqual(ready.session.access_token, "fresh-access-token");
});

test("no-session readiness is silent and does not look like a wrong OTP", async () => {
  clearAuthTestFlags();
  const db = makeAuthDb({ session: null });
  const ready = await Mfa.ensurePrimarySessionReady(() => db, { force: true });
  assert.strictEqual(ready.ok, false);
  assert.strictEqual(ready.reason, "no_session");
});

test("console warning never includes OTP/token/session payloads", () => {
  assert.match(mfaJs, /console\.warn\("Admin MFA failed", String\(category \|\| "unknown"\), code\)/);
  assert.doesNotMatch(mfaJs, /console\.warn\([^;]*err\.message/);
  assert.doesNotMatch(idleJs, /console\.(log|debug|info|warn|error)/);
});

test("restored-session tests do not use production OTP, credentials, or MFA writes", () => {
  const src = read("scripts/admin-mfa-restored-session-tests.js");
  assert.doesNotMatch(src, /kutadgubilik\.com/);
  assert.doesNotMatch(src, /signInWithPassword\(\{email:"[^"]+@/);
});

(async () => {
  for (const t of tests) {
    clearAuthTestFlags();
    try {
      await t.fn();
      console.log("PASS", t.name);
    } catch (err) {
      failed++;
      console.error("FAIL", t.name, err && err.stack ? err.stack : err);
    }
  }
  if (failed) {
    console.error(failed + " failed");
    process.exit(1);
  }
  console.log("admin-mfa-restored-session-tests ok");
})();
