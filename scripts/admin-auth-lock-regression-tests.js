#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Idle = require("../admin-idle.js");
const Mfa = require("../admin-mfa.js");

const root = path.join(__dirname, "..");
const adminJs = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const IDLE_MS = 30 * 60 * 1000;
const mem = {
  data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
  setItem(k, v) { this.data[k] = String(v); },
  removeItem(k) { delete this.data[k]; }
};

let failed = 0;

function install(clock) {
  mem.data = {};
  globalThis.__kutadguAdminIdleStorage = mem;
  globalThis.__kutadguAdminIdleNow = () => clock.t;
  delete globalThis.__kutadguAdminIdleMs;
  delete globalThis.__kutadguAdminAalTest;
  delete globalThis.__kutadguMfaApi;
  delete globalThis.__kutadguSkipAdminAuth;
  Idle.setRestoreGuard(false);
  Idle.setRestoreGuard(false);
}

function stamp(clock) {
  Idle.noteActivity({ force: true });
  return clock.t;
}

const verified = [{ id: "factor-v", factor_type: "totp", status: "verified" }];

function mfaClient(opts) {
  const options = opts || {};
  return {
    async getAuthenticatorAssuranceLevel() {
      if (options.throwAal) throw new Error("aal down");
      if (options.aalError) return { data: null, error: { message: "aal down" } };
      if (options.malformedAal) return { data: { currentLevel: "nope" }, error: null };
      return { data: { currentLevel: options.level || "aal1", nextLevel: "aal2" }, error: null };
    },
    async listFactors() {
      if (options.throwList) throw new Error("list down");
      if (options.listError) return { data: null, error: { message: "list down" } };
      if (options.malformedList) return { data: { unexpected: true }, error: null };
      return { data: options.payload || { all: options.factors || [] }, error: null };
    }
  };
}

(async function main() {
  async function check(name, fn) {
    try {
      await fn();
      console.log("PASS", name);
    } catch (err) {
      failed++;
      console.error("FAIL", name, err && err.stack || err);
    }
  }

  await check("1. expired 31-minute timestamp ignores the next trusted activity", async () => {
    const clock = { t: 1_000_000 };
    install(clock);
    stamp(clock);
    clock.t += 31 * 60 * 1000;
    assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), true);
    const before = Idle.readState().lastActivity;
    Idle.noteActivity();
    Idle.noteActivity({ force: true });
    const after = Idle.readState();
    assert.strictEqual(after.lastActivity, before);
    assert.strictEqual(after.locked, false);
    assert.strictEqual(Idle.shouldLock(after, Idle.now(), false), true);
  });

  await check("2. suspended tab several hours later is locked before activity", async () => {
    const clock = { t: 5_000_000 };
    install(clock);
    stamp(clock);
    clock.t += 6 * 60 * 60 * 1000;
    assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), true);
    const before = Idle.readState().lastActivity;
    Idle.noteActivity({ force: true });
    assert.strictEqual(Idle.readState().lastActivity, before);
  });

  await check("3. reload keeps a stale aal2 session behind the idle lock", async () => {
    const clock = { t: 8_000_000 };
    install(clock);
    mem.setItem(Idle.STORAGE_KEY, JSON.stringify({ lastActivity: clock.t - 31 * 60 * 1000, locked: false }));
    const snap = Idle.readState();
    assert.strictEqual(snap.status, "ok");
    assert.strictEqual(Idle.shouldLock(snap, clock.t, false), true);
    const decision = Mfa.evaluateAccess({ currentLevel: "aal2" }, Mfa.classifyFactors({ all: verified }));
    assert.strictEqual(decision.surface, "dashboard");
    assert.strictEqual(decision.gate, false);
    const route = adminJs.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
    assert.ok(route);
    assert.ok(route[0].indexOf("idleElapsedBeforeRestore") < route[0].indexOf("ensurePrimarySessionReady"));
    assert.ok(route[0].indexOf("setRestoreGuard(true)") < route[0].indexOf("ensurePrimarySessionReady"));
  });

  await check("4. missing and corrupted idle storage do not reopen a restored session", async () => {
    const clock = { t: 2_000_000 };
    install(clock);
    assert.strictEqual(Idle.readState().status, "missing");
    assert.strictEqual(Idle.shouldLock(Idle.readState(), clock.t, false, { restoringSession: true }), true);
    assert.strictEqual(Idle.shouldLock(Idle.readState(), clock.t, false), false);
    Idle.setRestoreGuard(true);
    Idle.noteActivity({ force: true });
    assert.strictEqual(Idle.readState().status, "missing");
    Idle.setRestoreGuard(false);
    mem.setItem(Idle.STORAGE_KEY, "{");
    assert.strictEqual(Idle.readState().status, "corrupt");
    Idle.noteActivity({ force: true });
    assert.strictEqual(mem.getItem(Idle.STORAGE_KEY), "{");
    assert.strictEqual(Idle.shouldLock(Idle.readState(), clock.t, false, { restoringSession: true }), true);
    globalThis.__kutadguAdminIdleStorage = { getItem() { throw new Error("blocked"); }, setItem() {} };
    assert.strictEqual(Idle.readState().status, "unavailable");
    assert.strictEqual(Idle.shouldLock(Idle.readState(), clock.t, false, { restoringSession: true }), true);
  });

  await check("5. activity at 29 minutes extends the timeout", async () => {
    const clock = { t: 3_000_000 };
    install(clock);
    stamp(clock);
    clock.t += 29 * 60 * 1000;
    assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), false);
    Idle.noteActivity({ force: true });
    assert.strictEqual(Idle.readState().lastActivity, clock.t);
    clock.t += 29 * 60 * 1000;
    assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), false);
    clock.t += 2 * 60 * 1000;
    assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), true);
  });

  await check("6. successful TOTP unlock restores normal access", async () => {
    const clock = { t: 4_000_000 };
    install(clock);
    stamp(clock);
    clock.t += IDLE_MS;
    Idle.markLocked();
    assert.strictEqual(Idle.readState().locked, true);
    clock.t += 5_000;
    Idle.unlock();
    const snap = Idle.readState();
    assert.strictEqual(snap.locked, false);
    assert.strictEqual(snap.lastActivity, clock.t);
    assert.strictEqual(Idle.shouldLock(snap, clock.t, false), false);
    clock.t += 60 * 1000;
    Idle.noteActivity();
    assert.strictEqual(Idle.readState().lastActivity, clock.t);
  });

  await check("7. fresh password login without an idle record starts a new timer", async () => {
    const clock = { t: 6_000_000 };
    install(clock);
    assert.strictEqual(Idle.readState().status, "missing");
    const snap = Idle.beginAuthenticatedActivity();
    assert.strictEqual(snap.status, "ok");
    assert.strictEqual(snap.locked, false);
    assert.strictEqual(snap.lastActivity, clock.t);
    assert.strictEqual(Idle.shouldLock(snap, clock.t, false, { restoringSession: true }), false);
    assert.match(adminJs, /beginAuthenticatedActivity/);
    const login = adminJs.match(/async function login\(e\)\{[\s\S]*?async function logout/);
    assert.ok(login);
    assert.match(login[0], /beginAuthenticatedActivity/);
    assert.doesNotMatch(login[0], /forceUnlock/);
  });

  await check("8. aal1 with a verified TOTP requires the MFA gate", async () => {
    const decision = Mfa.evaluateAccess({ currentLevel: "aal1" }, Mfa.classifyFactors({ all: verified }));
    assert.strictEqual(decision.surface, "gate");
    assert.strictEqual(decision.gate, true);
    assert.strictEqual(decision.blocked, false);
  });

  await check("9. aal1 inspection failures stay blocked", async () => {
    const cases = [
      mfaClient({ level: "aal1", listError: true, factors: verified }),
      mfaClient({ level: "aal1", throwList: true, factors: verified }),
      { async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null }; } },
      mfaClient({ level: "aal1", malformedList: true }),
      mfaClient({ level: "aal1", throwAal: true, factors: verified }),
      mfaClient({ level: "aal1", aalError: true, factors: verified }),
      mfaClient({ level: "aal1", malformedAal: true, factors: verified }),
      null
    ];
    for (const api of cases) {
      delete globalThis.__kutadguAdminAalTest;
      delete globalThis.__kutadguSkipAdminAuth;
      if (api) globalThis.__kutadguMfaApi = api;
      else delete globalThis.__kutadguMfaApi;
      const inspect = await Mfa.inspectAccess(() => ({ auth: { mfa: api } }));
      assert.strictEqual(inspect.decision.blocked, true, JSON.stringify(inspect.decision));
      assert.strictEqual(inspect.decision.surface, "blocked");
      assert.strictEqual(inspect.decision.gate, false);
    }
    delete globalThis.__kutadguMfaApi;
    const totpOnly = await (async () => {
      globalThis.__kutadguMfaApi = mfaClient({ level: "aal1", payload: { totp: verified, phone: [] } });
      return Mfa.inspectAccess(() => null);
    })();
    assert.strictEqual(totpOnly.decision.surface, "gate");
    const factorsShape = await (async () => {
      globalThis.__kutadguMfaApi = mfaClient({ level: "aal1", payload: { factors: verified } });
      return Mfa.inspectAccess(() => null);
    })();
    assert.strictEqual(factorsShape.decision.surface, "gate");
    globalThis.__kutadguMfaApi = mfaClient({ level: "aal1", factors: [] });
    const empty = await Mfa.inspectAccess(() => null);
    assert.strictEqual(empty.decision.surface, "dashboard");
    assert.strictEqual(empty.decision.blocked, false);
    assert.strictEqual(empty.decision.warnMissingMfa, true);
    delete globalThis.__kutadguMfaApi;
  });

  await check("10. valid aal2 keeps the login gate open even when listing fails", async () => {
    globalThis.__kutadguMfaApi = mfaClient({ level: "aal2", listError: true, factors: verified });
    const failedList = await Mfa.inspectAccess(() => null);
    assert.strictEqual(failedList.decision.surface, "dashboard");
    assert.strictEqual(failedList.decision.gate, false);
    assert.strictEqual(failedList.decision.blocked, false);
    globalThis.__kutadguMfaApi = mfaClient({ level: "aal2", factors: verified });
    const healthy = await Mfa.inspectAccess(() => null);
    assert.strictEqual(healthy.decision.surface, "dashboard");
    assert.strictEqual(healthy.decision.gate, false);
    delete globalThis.__kutadguMfaApi;
    const activity = adminJs.match(/function onAdminActivity\(e\)\{[\s\S]*?function onAdminIdleStorage/);
    assert.ok(activity);
    assert.ok(activity[0].indexOf("adminShouldHoldIdleLock") < activity[0].indexOf("noteActivity"));
    assert.match(adminJs, /function onAdminForeground/);
    assert.match(adminJs, /visibilitychange/);
    assert.match(adminJs, /decision\.blocked/);
  });

  await check("11. session restoration and a concurrent interaction cannot refresh an overdue timer", async () => {
    const clock = { t: 7_000_000 };
    install(clock);
    mem.setItem(Idle.STORAGE_KEY, JSON.stringify({ lastActivity: clock.t - 31 * 60 * 1000, locked: false }));
    Idle.setRestoreGuard(true);
    const before = Idle.readState().lastActivity;
    Idle.noteActivity();
    Idle.noteActivity({ force: true });
    assert.strictEqual(Idle.readState().lastActivity, before);
    assert.strictEqual(Idle.readState().locked, false);
    assert.strictEqual(Idle.restoreGuardOn(), true);
    Idle.setRestoreGuard(false);
    assert.strictEqual(Idle.restoreGuardOn(), false);
    assert.strictEqual(Idle.readState().lastActivity, before);
    assert.doesNotMatch(adminJs.match(/function tickAdminIdle[\s\S]*?function onAdminActivity/)[0], /signOut/);
  });

  if (failed) {
    console.error(failed + " failed");
    process.exit(1);
  }
  console.log("admin-auth-lock-regression-tests ok");
})();
