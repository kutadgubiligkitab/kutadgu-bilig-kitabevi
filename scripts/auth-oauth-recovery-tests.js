#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
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
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const cfg = read("supabase-config.js");
const index = read("index.html");
const resetJs = read("reset-password.js");
const member = read("member.js");
const admin = read("admin.js");
const account = read("account.html");

test("auth origin is www custom domain, not Vercel", () => {
  assert.match(cfg, /window\.KUTADGU_SITE_ORIGIN = "https:\/\/www\.kutadgubilig\.com"/);
  assert.doesNotMatch(cfg, /KUTADGU_SITE_ORIGIN = "https:\/\/kutadgu-bilig-kitab\.vercel\.app"/);
  assert.match(member, /https:\/\/www\.kutadgubilig\.com\/reset-password\.html\?next=/);
  assert.match(admin, /https:\/\/www\.kutadgubilig\.com\/reset-password\.html\?next=admin/);
  assert.doesNotMatch(member, /kutadgu-bilig-kitab\.vercel\.app\/reset-password/);
  assert.doesNotMatch(admin, /kutadgu-bilig-kitab\.vercel\.app\/reset-password/);
});

test("password reset helper always uses www and next=account|admin", () => {
  const sandbox = {
    window: {},
    URLSearchParams,
    console,
    location: { pathname: "/index.html", search: "", hash: "", href: "https://www.kutadgubilig.com/" }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(
    cfg.replace(/\(function kutadguBounceRecoveryToResetPage\(\)\{[\s\S]*?\}\)\(\);/, "")
      .replace(/\(function kutadguLoadMaintenanceGuard\(\)\{[\s\S]*?\}\)\(\);/, ""),
    sandbox
  );
  assert.strictEqual(sandbox.window.KUTADGU_SITE_ORIGIN, "https://www.kutadgubilig.com");
  assert.strictEqual(
    sandbox.window.kutadguPasswordResetRedirectTo("account"),
    "https://www.kutadgubilig.com/reset-password.html?next=account"
  );
  assert.strictEqual(
    sandbox.window.kutadguPasswordResetRedirectTo("admin"),
    "https://www.kutadgubilig.com/reset-password.html?next=admin"
  );
  assert.strictEqual(
    sandbox.window.kutadguPasswordResetRedirectTo(),
    "https://www.kutadgubilig.com/reset-password.html?next=account"
  );
  assert.strictEqual(sandbox.window.kutadguIsPasswordRecoveryType("?type=recovery", ""), true);
  assert.strictEqual(sandbox.window.kutadguIsPasswordRecoveryType("?code=abc", ""), false);
  assert.strictEqual(sandbox.window.kutadguIsPasswordRecoveryType("?code=abc&type=signup", ""), false);
  assert.strictEqual(sandbox.window.kutadguIsPasswordRecoveryType("", "#access_token=x&type=recovery"), true);
});

test("homepage bounce only uses explicit type=recovery", () => {
  assert.match(index, /var recovery=\/\[\?&\]type=recovery/);
  assert.doesNotMatch(index, /authOnHome/);
  assert.match(index, /if\(!recovery\)return;/);
  assert.doesNotMatch(cfg, /authOnHome/);
  assert.match(cfg, /kutadguIsPasswordRecoveryType/);
});

test("Google OAuth redirectTo is www account.html", () => {
  assert.match(member, /const redirectTo=origin\+"\/account.html"/);
  assert.match(account, /member\.js\?v=9/);
  assert.match(read("shop.js"), /member\.js\?v=9/);
  assert.match(index, /shop\.js\?v=66/);
});

test("reset page does not treat generic SIGNED_IN as recovery", () => {
  assert.match(resetJs, /event==="PASSWORD_RECOVERY"/);
  assert.doesNotMatch(resetJs, /event==="PASSWORD_RECOVERY" \|\| event==="SIGNED_IN"/);
  assert.match(resetJs, /detectSessionInUrl:isExplicitRecoveryType\(info\.type\)/);
  assert.match(resetJs, /if\(session && \(info\.code \|\| info\.tokenHash\)\)markRecoveryReady/);
  assert.match(resetJs, /if\(!consumed\)return null/);
  assert.match(resetJs, /isGenericOauthCode/);
  assert.match(resetJs, /sendGenericOauthToAccount/);
});

test("reset-password.html loads reset-password.js v=4", () => {
  assert.match(read("reset-password.html"), /reset-password\.js\?v=4/);
  assert.match(read("reset-password.html"), /supabase-config\.js\?v=10/);
  assert.match(account, /supabase-config\.js\?v=10/);
  assert.match(index, /supabase-config\.js\?v=10/);
  assert.match(read("admin.html"), /supabase-config\.js\?v=10/);
  assert.match(read("admin.html"), /admin\.js\?v=30/);
});

function isExplicitRecoveryType(type){
  return type==="recovery";
}
function isIntendedRecoveryLink(info){
  if(isExplicitRecoveryType(info.type))return true;
  if((info.next==="account"||info.next==="admin")&&(info.code||info.tokenHash))return true;
  return false;
}
function isGenericOauthCode(info){
  if(!info.code)return false;
  if(isExplicitRecoveryType(info.type))return false;
  if(info.next==="account"||info.next==="admin")return false;
  return true;
}

test("recovery detection matches reset-password.js rules", () => {
  assert.match(resetJs, /function isIntendedRecoveryLink/);
  assert.strictEqual(isExplicitRecoveryType("recovery"), true);
  assert.strictEqual(isExplicitRecoveryType(""), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "", code: "x", tokenHash: "" }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "account", code: "x", tokenHash: "" }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "admin", code: "", tokenHash: "th" }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "", code: "oauth-code", tokenHash: "" }), false);
  assert.strictEqual(isGenericOauthCode({ type: "", next: "", code: "oauth-code", tokenHash: "" }), true);
  assert.strictEqual(isGenericOauthCode({ type: "recovery", next: "", code: "x", tokenHash: "" }), false);
  assert.strictEqual(isGenericOauthCode({ type: "", next: "account", code: "x", tokenHash: "" }), false);
});

if (failed) process.exit(1);
console.log("auth-oauth-recovery unit checks passed.");
