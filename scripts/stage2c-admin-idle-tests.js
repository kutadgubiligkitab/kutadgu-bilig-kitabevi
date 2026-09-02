#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Idle = require("../admin-idle.js");
const Mfa = require("../admin-mfa.js");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
  }
}

const mem = {
  data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
  setItem(k, v) { this.data[k] = String(v); },
  removeItem(k) { delete this.data[k]; }
};

function install(clock, idleMs) {
  globalThis.__kutadguAdminIdleStorage = mem;
  mem.data = {};
  globalThis.__kutadguAdminIdleNow = () => clock.t;
  globalThis.__kutadguAdminIdleMs = idleMs || 30 * 60 * 1000;
}

test("IDLE_MS is 30 minutes and storage key is Admin-only", () => {
  assert.strictEqual(Idle.IDLE_MS, 30 * 60 * 1000);
  assert.strictEqual(Idle.STORAGE_KEY, "kutadgu-admin-idle-v1");
  assert.deepStrictEqual(Idle.ACTIVITY_EVENTS, ["pointerdown", "keydown", "touchstart"]);
  assert.strictEqual(Idle.isAuthStorageKey("sb-fxlojnqwyojqjskfggmh-auth-token"), true);
  assert.strictEqual(Idle.isAuthStorageKey("kutadgu-admin-idle-v1"), false);
});

test("activity before timeout does not lock", () => {
  const clock = { t: 1_000_000 };
  install(clock, 50_000);
  Idle.noteActivity({ force: true });
  clock.t += 10_000;
  assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), false);
});

test("inactivity reaching timeout locks", () => {
  const clock = { t: 1_000_000 };
  install(clock, 50_000);
  Idle.noteActivity({ force: true });
  clock.t += 50_000;
  assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), true);
  Idle.markLocked();
  assert.strictEqual(Idle.readState().locked, true);
});

test("pointerdown keydown touchstart are activity; mousemove and scroll are not", () => {
  assert.strictEqual(Idle.activityFromEvent({ type: "pointerdown" }), true);
  assert.strictEqual(Idle.activityFromEvent({ type: "keydown", isTrusted: true }), true);
  assert.strictEqual(Idle.activityFromEvent({ type: "touchstart" }), true);
  assert.strictEqual(Idle.activityFromEvent({ type: "pointerdown", isTrusted: false }), false);
  assert.strictEqual(Idle.activityFromEvent({ type: "keydown", isTrusted: false }), false);
  assert.strictEqual(Idle.activityFromEvent({ type: "mousemove", isTrusted: true }), false);
  assert.strictEqual(Idle.activityFromEvent({ type: "scroll" }), false);
  assert.strictEqual(Idle.activityFromEvent({ type: "focus" }), false);
  assert.strictEqual(Idle.activityFromEvent({ type: "visibilitychange" }), false);
});

test("busy mutation workflow prevents NEW lock but not a persisted lock", () => {
  const clock = { t: 1_000_000 };
  install(clock, 1_000);
  Idle.noteActivity({ force: true });
  clock.t += 5_000;
  assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), true), false);
  mem.setItem(Idle.STORAGE_KEY, JSON.stringify({ lastActivity: 1, locked: true }));
  assert.strictEqual(Idle.isPersistedLock(Idle.readState()), true);
  assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), true), true);
});

test("exact Preview payload lastActivity 1 locked true is a lock", () => {
  globalThis.__kutadguAdminIdleStorage = mem;
  mem.data = {};
  delete globalThis.__kutadguAdminIdleNow;
  delete globalThis.__kutadguAdminIdleMs;
  mem.setItem(Idle.STORAGE_KEY, "{\"lastActivity\":1,\"locked\":true}");
  const snap = Idle.readState();
  assert.strictEqual(snap.lastActivity, 1);
  assert.strictEqual(snap.locked, true);
  assert.strictEqual(Idle.shouldLock(snap, Date.now(), false), true);
  assert.strictEqual(Idle.shouldLock(snap, Date.now(), true), true);
  Idle.noteActivity({ force: true });
  assert.strictEqual(Idle.readState().locked, true);
  assert.strictEqual(Idle.readState().lastActivity, 1);
});

test("noteActivity while locked does not unlock without forceUnlock", () => {
  const clock = { t: 1_000_000 };
  install(clock, 1_000);
  Idle.noteActivity({ force: true });
  clock.t += 2_000;
  Idle.markLocked();
  Idle.noteActivity({ force: true });
  assert.strictEqual(Idle.readState().locked, true);
  Idle.unlock();
  assert.strictEqual(Idle.readState().locked, false);
});

test("shared storage lock survives reload and new tab", () => {
  const clock = { t: 5_000_000 };
  install(clock, 1_000);
  Idle.noteActivity({ force: true });
  clock.t += 2_000;
  Idle.markLocked();
  const raw = mem.getItem(Idle.STORAGE_KEY);
  const mem2 = {
    data: { [Idle.STORAGE_KEY]: raw },
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; }
  };
  globalThis.__kutadguAdminIdleStorage = mem2;
  assert.strictEqual(Idle.readState().locked, true);
  assert.strictEqual(Idle.shouldLock(Idle.readState(), Idle.now(), false), true);
});

test("unlock writes fresh activity", () => {
  const clock = { t: 9_000_000 };
  install(clock, 1_000);
  Idle.markLocked();
  clock.t = 9_100_000;
  Idle.unlock();
  const snap = Idle.readState();
  assert.strictEqual(snap.locked, false);
  assert.strictEqual(snap.lastActivity, 9_100_000);
});

test("idle module never writes auth keys or OTP", () => {
  const idleJs = read("admin-idle.js");
  assert.match(idleJs, /[Dd]oes not touch GoTrue auth storage keys/);
  assert.doesNotMatch(idleJs, /auth\.signOut/);
  assert.doesNotMatch(idleJs, /\.signOut\(/);
  assert.doesNotMatch(idleJs, /console\.(log|debug|info|warn|error)/);
  assert.doesNotMatch(idleJs, /unenroll/);
  assert.match(idleJs, /challengeAndVerify/);
  assert.match(idleJs, /getAuthenticatorAssuranceLevel/);
  const attach = idleJs.match(/async function submit\([\s\S]*?function bind/);
  assert.ok(attach);
  assert.doesNotMatch(attach[0], /signOut/);
  assert.match(idleJs, /storage\.setItem\(STORAGE_KEY/);
  assert.match(idleJs, /lastActivity: Number\(state\.lastActivity\) \|\| 0/);
  assert.doesNotMatch(idleJs, /\botp\b.*setItem|setItem.*\botp\b/);
});

test("admin.js timeout never auto-signOut; persisted lock precedes inspectAccess and dashboard", () => {
  const adminJs = read("admin.js");
  const idleJs = read("admin-idle.js");
  assert.match(adminJs, /persistedIdleLocked/);
  assert.match(adminJs, /adminShouldHoldIdleLock/);
  assert.match(adminJs, /enforceAdminIdleLock/);
  assert.match(adminJs, /onAuthStateChange\(\(\)=>setTimeout\(routeSession,0\)\)/);
  const route = adminJs.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
  assert.ok(route);
  assert.ok(route[0].indexOf("persistedIdleLocked") < route[0].indexOf("getSession"));
  const live = route[0].slice(route[0].indexOf("getSession"));
  assert.ok(live.indexOf("adminShouldHoldIdleLock") < live.indexOf("inspectAccess"));
  assert.ok(live.lastIndexOf("adminShouldHoldIdleLock") > live.indexOf("inspectAccess"));
  assert.doesNotMatch(adminJs.match(/function tickAdminIdle[\s\S]*?function onAdminActivity/)[0], /signOut/);
  assert.doesNotMatch(adminJs.match(/function showIdleLock[\s\S]*?function enforceAdminIdleLock/)[0], /signOut/);
  const open = adminJs.match(/async function openAuthorizedDashboard\(\)\{[\s\S]*?function columnList/);
  assert.ok(open);
  assert.match(open[0], /adminShouldHoldIdleLock/);
  assert.match(open[0], /enforceAdminIdleLock/);
  assert.doesNotMatch(open[0], /noteActivity/);
  const login = adminJs.match(/async function login\(e\)\{[\s\S]*?async function logout/);
  assert.ok(login);
  assert.doesNotMatch(login[0], /forceUnlock/);
  assert.match(adminJs, /onAuthStateChange\(\(\)=>setTimeout\(routeSession,0\)\)/);
  assert.doesNotMatch(adminJs.match(/db\.auth\.onAuthStateChange[\s\S]{0,80}/)[0], /noteActivity/);
  const act = adminJs.match(/function onAdminActivity\(e\)\{[\s\S]*?function onAdminIdleStorage/);
  assert.ok(act);
  assert.doesNotMatch(act[0], /mousemove|scroll|visibilitychange/);
  assert.match(act[0], /persistedIdleLocked/);
  assert.match(adminJs, /api\.clearState/);
  assert.match(idleJs, /STORAGE_KEY = "kutadgu-admin-idle-v1"/);
  assert.match(idleJs, /isTrusted === false/);
  assert.match(read("vercel.json"), /"source": "\/admin-idle\.js"/);
});

test("password reset Google OAuth SQL MFA enrollment files stay out of this change", () => {
  const adminIdle = read("admin-idle.js");
  const resetJs = read("reset-password.js");
  const memberJs = read("member.js");
  const cfg = read("supabase-config.js");
  const setup = read("SUPABASE_SETUP.sql");
  assert.match(resetJs, /verifyOtp\(\{token_hash:info\.tokenHash,type:"recovery"\}\)/);
  assert.match(memberJs, /signInWithOAuth\(\{provider:"google",options:\{redirectTo\}\}/);
  assert.match(cfg, /reset-password\.html\?type=recovery/);
  assert.doesNotMatch(adminIdle, /reset-password/);
  assert.match(setup, /create or replace function public\.is_kutadgu_admin\(\)/);
  assert.match(read("admin-mfa.js"), /function evaluateAccess/);
  assert.match(Mfa.evaluateAccess({ currentLevel: "aal2" }, Mfa.classifyFactors({ all: [{ id: "f", factor_type: "totp", status: "verified" }] })).surface, /dashboard/);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("stage2c-admin-idle-tests ok");
