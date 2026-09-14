#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

let failed = 0;
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.message);
      });
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.message);
  }
}

const cfg = read("supabase-config.js");
const member = read("member.js");
const admin = read("admin.js");
const shop = read("shop.js");
const staff = read("book-staff.js");
const resetJs = read("reset-password.js");
const maint = read("kutadgu-maintenance.js");

function loadConfigSandbox(store) {
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
  const sandbox = {
    window: {},
    URL,
    localStorage,
    location: { hostname: "www.kutadgubilik.com", origin: "https://www.kutadgubilik.com", pathname: "/", search: "", hash: "", href: "https://www.kutadgubilik.com/" },
    document: { currentScript: null, querySelector() { return null; }, getElementById() { return null; }, documentElement: { classList: { add() {} } }, createElement() { return { dataset: {}, textContent: "" }; }, head: { appendChild() {} } }
  };
  sandbox.window = sandbox;
  sandbox.window.localStorage = localStorage;
  vm.runInNewContext(cfg, sandbox);
  return { sandbox, localStorage, store };
}

test("storage keys are stable, different, and centralized", () => {
  assert.match(cfg, /KUTADGU_MEMBER_AUTH_STORAGE_KEY = "kutadgu-member-auth-v1"/);
  assert.match(cfg, /KUTADGU_ADMIN_AUTH_STORAGE_KEY = "kutadgu-admin-auth-v1"/);
  assert.notStrictEqual("kutadgu-member-auth-v1", "kutadgu-admin-auth-v1");
  assert.match(member, /kutadgu-member-auth-v1/);
  assert.match(admin, /kutadgu-admin-auth-v1/);
  assert.doesNotMatch(member, /kutadgu-admin-auth-v1/);
  assert.doesNotMatch(staff, /kutadgu-admin-auth-v1/);
  assert.match(staff, /memberApi\(\)\.getClient/);
});

test("Member and Admin createClient use isolated auth options", () => {
  assert.match(member, /auth:memberAuthOptions\(\)/);
  assert.match(member, /detectSessionInUrl:true/);
  assert.match(admin, /kutadguAdminAuthOptions/);
  assert.match(admin, /detectSessionInUrl:false/);
  assert.match(resetJs, /nextAdmin/);
  assert.match(resetJs, /storageKey:storageKey/);
  assert.match(resetJs, /detectSessionInUrl:false/);
});

test("ordinary logout is session-local and does not use global scope", () => {
  const memberSignOut = member.match(/async function signOut\(\)\{[\s\S]*?async function resetPassword/);
  assert.match(memberSignOut[0], /signOut\(\{scope:"local"\}\)/);
  assert.doesNotMatch(memberSignOut[0], /scope:"global"/);
  const logout = admin.match(/async function logout\(\)\{[\s\S]*?function openImport/);
  assert.match(logout[0], /signOut\(\{scope:"local"\}\)/);
  const denyStart = admin.indexOf("const ok=await checkAdmin(session.user);");
  const deny = admin.slice(denyStart, admin.indexOf("if(gen!==routeGen)return;", denyStart));
  assert.doesNotMatch(deny, /signOut/);
  assert.match(resetJs, /signOut\(\{scope:"local"\}\)/);
});

test("A/B peek Member key ignores Admin and legacy shared tokens", () => {
  const { sandbox } = loadConfigSandbox({
    "kutadgu-admin-auth-v1": JSON.stringify({
      access_token: "admin-tok",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "admin-user" }
    }),
    "sb-fxlojnqwyojqjskfggmh-auth-token": JSON.stringify({
      access_token: "legacy-tok",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "legacy-user" }
    }),
    "kutadgu-member-auth-v1": JSON.stringify({
      access_token: "member-tok",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "member-user" }
    })
  });
  assert.strictEqual(sandbox.window.kutadguPeekPersistedAuthUserId("kutadgu-member-auth-v1"), "member-user");
  assert.strictEqual(sandbox.window.kutadguPeekPersistedAuthUserId("kutadgu-admin-auth-v1"), "admin-user");
  assert.notStrictEqual(sandbox.window.kutadguPeekPersistedAuthUserId("kutadgu-member-auth-v1"), "admin-user");
  assert.match(shop, /kutadgu-member-auth-v1/);
  assert.doesNotMatch(shop, /kutadgu-admin-auth-v1/);
});

test("legacy default auth token is forgotten and not imported", () => {
  const store = {
    "sb-fxlojnqwyojqjskfggmh-auth-token": "legacy",
    "sb-fxlojnqwyojqjskfggmh-auth-token-code-verifier": "pkce",
    "kutadgu-member-auth-v1": "keep-member",
    "kutadgu-admin-auth-v1": "keep-admin",
    "unrelated": "keep-other"
  };
  const { sandbox } = loadConfigSandbox(store);
  sandbox.window.kutadguForgetLegacySharedAuthStorage();
  assert.strictEqual(store["sb-fxlojnqwyojqjskfggmh-auth-token"], undefined);
  assert.strictEqual(store["sb-fxlojnqwyojqjskfggmh-auth-token-code-verifier"], undefined);
  assert.strictEqual(store["kutadgu-member-auth-v1"], "keep-member");
  assert.strictEqual(store["kutadgu-admin-auth-v1"], "keep-admin");
  assert.strictEqual(store.unrelated, "keep-other");
  assert.match(member, /kutadguForgetLegacySharedAuthStorage/);
  assert.match(admin, /kutadguForgetLegacySharedAuthStorage/);
  assert.doesNotMatch(member + admin, /kutadguPeekPersistedAuthUserId\(kutadguLegacy/);
});

test("G Google OAuth remains Member-only", () => {
  assert.match(member, /signInWithOAuth\(\{provider:"google"/);
  assert.doesNotMatch(admin, /signInWithOAuth/);
  assert.doesNotMatch(resetJs, /signInWithOAuth/);
});

test("H Book Staff uses Member client, not Admin", () => {
  assert.match(staff, /function memberApi\(\)\{return window\.KutadguMember\}/);
  assert.match(staff, /memberApi\(\)\.getClient/);
  assert.doesNotMatch(staff, /createClient/);
  assert.doesNotMatch(staff, /kutadgu-admin-auth-v1/);
});

test("I PR #159 non-admin Admin visit still does not signOut", () => {
  const route = admin.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
  const denyStart = route[0].indexOf("const ok=await checkAdmin(session.user);");
  const deny = route[0].slice(denyStart, route[0].indexOf("if(gen!==routeGen)return;", denyStart));
  assert.doesNotMatch(deny, /signOut/);
  assert.match(deny, /بۇ ھېسابات Admin ھېسابى ئەمەس/);
});

test("J Admin MFA/AAL2 still runs only after checkAdmin", () => {
  const route = admin.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
  const live = route[0].slice(route[0].indexOf("ensurePrimarySessionReady"));
  assert.ok(live.indexOf("inspectAccess") > live.indexOf("checkAdmin"));
  assert.match(admin, /from\("admin_users"\)\.select\("user_id"\)/);
  assert.doesNotMatch(cfg + member + admin, /service_role/);
});

test("maintenance bypass does not scan the legacy shared key", () => {
  assert.match(maint, /kutadguAdminAuthStorageKey/);
  assert.match(maint, /kutadguMemberAuthStorageKey/);
  assert.doesNotMatch(maint, /sb-" \+ ref \+ "-auth-token/);
  assert.doesNotMatch(maint, /createClient\(c\.url, c\.key\)/);
  assert.match(maint, /kutadguAdminAuthOptions/);
});

test("no SQL / RLS schema edits in this stage", () => {
  assert.doesNotMatch(member + cfg, /CREATE POLICY|ALTER TABLE/);
  assert.doesNotMatch(admin, /CREATE POLICY|ALTER TABLE/);
  assert.match(admin, /from\("admin_users"\)/);
});

Promise.resolve().then(() => {
  if (failed) {
    console.error("\n" + failed + " auth session isolation test(s) failed");
    process.exit(1);
  }
  console.log("auth-session-isolation-tests ok");
});
