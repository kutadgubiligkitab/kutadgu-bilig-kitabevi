#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
    console.error("FAIL", name, err && err.message);
  }
}

const adminJs = read("admin.js");
const adminHtml = read("admin.html");
const staffJs = read("book-staff.js");
const staffHtml = read("book-staff.html");
const accountJs = read("account.js");
const accountHtml = read("account.html");
const mfaJs = read("admin-mfa.js");

function routeSessionSource() {
  const route = adminJs.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
  assert.ok(route, "missing routeSession");
  return route[0];
}

function nonAdminDenySource() {
  const route = routeSessionSource();
  const start = route.indexOf("const ok=await checkAdmin(session.user);");
  assert.ok(start >= 0, "missing checkAdmin call");
  const end = route.indexOf("if(gen!==routeGen)return;", start);
  assert.ok(end > start, "missing post-checkAdmin generation guard");
  return route.slice(start, end);
}

test("A. Book Staff / member non-admin Admin visit does not call global signOut", () => {
  const deny = nonAdminDenySource();
  assert.doesNotMatch(deny, /signOut/);
  assert.doesNotMatch(deny, /location\.(href|assign|replace)/);
  assert.match(deny, /user=null/);
  assert.match(deny, /show\("loginPanel"\)/);
  assert.match(deny, /\$\("#adminLogout"\)\.hidden=true/);
  assert.match(deny, /بۇ ھېسابات Admin ھېسابى ئەمەس/);
  assert.doesNotMatch(deny, /تىزىملىكىدە يوق/);
  assert.match(staffHtml, /href="\/account\.html"/);
  assert.match(staffHtml, /book-staff\.js\?v=7/);
  assert.doesNotMatch(staffJs, /admin_users/);
  assert.doesNotMatch(staffJs, /is_kutadgu_admin/);
  assert.match(accountHtml, /account\.js\?v=6/);
  assert.match(accountJs, /function onMemberChange\(\)\{/);
});

test("B. Normal member session stays alive; Admin UI is local unauthorized only", () => {
  const deny = nonAdminDenySource();
  assert.match(deny, /show\("loginPanel"\)/);
  assert.doesNotMatch(deny, /openAuthorizedDashboard/);
  assert.doesNotMatch(deny, /inspectAccess/);
  const listener = adminJs.match(/db\.auth\.onAuthStateChange\([\s\S]{0,80}\)/);
  assert.ok(listener);
  assert.match(listener[0], /setTimeout\(routeSession,0\)/);
  assert.doesNotMatch(listener[0], /signOut/);
});

test("C. Full Admin MFA/AAL2 routing is unchanged after checkAdmin succeeds", () => {
  const route = routeSessionSource();
  const afterOk = route.slice(route.indexOf("user=session.user;"));
  assert.match(afterOk, /inspectAccess/);
  assert.match(afterOk, /decision\.gate/);
  assert.match(afterOk, /openAuthorizedDashboard/);
  assert.match(mfaJs, /function inspectAccess/);
  assert.match(mfaJs, /getAuthenticatorAssuranceLevel/);
  assert.match(adminHtml, /id="mfaGatePanel"/);
  assert.doesNotMatch(adminJs, /signInWithOAuth/);
});

test("D. Explicit Admin logout still signs out", () => {
  const logoutFn = adminJs.match(/async function logout\(\)\{[\s\S]*?function openImport/);
  assert.ok(logoutFn);
  assert.match(logoutFn[0], /db\.auth\.signOut\(\{scope:"local"\}\)/);
  assert.match(logoutFn[0], /user=null/);
  assert.match(logoutFn[0], /show\("loginPanel"\)/);
  assert.match(adminHtml, /id="adminLogout"/);
  assert.match(adminJs, /\$\("#adminLogout"\)\.onclick=logout/);
});

test("E. No role, RLS, or admin_users weakening", () => {
  assert.match(adminJs, /from\("admin_users"\)\.select\("user_id"\)\.eq\("user_id",u\.id\)/);
  assert.doesNotMatch(staffJs, /from\("admin_users"\)/);
  assert.doesNotMatch(accountJs, /from\("admin_users"\)/);
  assert.doesNotMatch(adminJs, /CREATE POLICY|ALTER TABLE|DROP POLICY/);
  assert.doesNotMatch(staffJs, /add_kutadgu_book_staff/);
  assert.match(adminHtml, /admin\.js\?v=78/);
});

if (failed) {
  console.error("\n" + failed + " admin non-admin session test(s) failed");
  process.exit(1);
}
console.log("admin-non-admin-session-tests ok");
