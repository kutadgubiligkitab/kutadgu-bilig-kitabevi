#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
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

const adminJs = read("admin.js");
const adminHtml = read("admin.html");
const mfaJs = read("admin-mfa.js");
const resetJs = read("reset-password.js");
const memberJs = read("member.js");
const cfgJs = read("supabase-config.js");
const setupSql = read("SUPABASE_SETUP.sql");
const stage2b = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");

test("unverified TOTP is not treated as configured", () => {
  const c = Mfa.classifyFactors({
    all: [{ id: "u1", factor_type: "totp", status: "unverified" }]
  });
  assert.strictEqual(c.configured, false);
  assert.strictEqual(c.unverified.length, 1);
  assert.strictEqual(c.verified.length, 0);
  assert.strictEqual(Mfa.statusKind(c.configured, c.unverified.length > 0), "unverified");
});

test("verified TOTP is configured", () => {
  const c = Mfa.classifyFactors({
    all: [{ id: "v1", factor_type: "totp", status: "verified" }]
  });
  assert.strictEqual(c.configured, true);
  assert.strictEqual(Mfa.statusKind(true, false), "configured");
});

test("empty factors are not configured", () => {
  const c = Mfa.classifyFactors({ all: [] });
  assert.strictEqual(c.configured, false);
  assert.strictEqual(Mfa.statusKind(false, false), "not_configured");
});

test("phone factors do not count as TOTP configured", () => {
  const c = Mfa.classifyFactors({
    all: [{ id: "p1", factor_type: "phone", status: "verified" }]
  });
  assert.strictEqual(c.configured, false);
});

test("QR src allows svg data URIs only", () => {
  const data = "data:image/svg+xml;utf-8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  assert.strictEqual(Mfa.qrImageSrc({ qr_code: data }), data);
  assert.ok(Mfa.qrImageSrc({ qr_code: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" }).startsWith("data:image/svg+xml"));
  assert.strictEqual(Mfa.qrImageSrc({ qr_code: "javascript:alert(1)" }), "");
  assert.strictEqual(Mfa.qrImageSrc({ qr_code: "https://evil.example/qr.png" }), "");
  assert.strictEqual(Mfa.qrImageSrc({ qr_code: "otpauth://totp/Test?secret=ABC" }), "");
});

test("OTP keeps 6 digits only", () => {
  assert.strictEqual(Mfa.digitsOnly("12a34b56c78"), "123456");
});

test("enroll options are TOTP without AAL2", () => {
  const o = Mfa.enrollOptions();
  assert.strictEqual(o.factorType, "totp");
  assert.ok(o.friendlyName);
});

test("MFA hidden panels stay display:none so enrollment UI is not visible by default", () => {
  const css = read("admin.css");
  assert.match(css, /#mfaCard \[hidden\]\{display:none!important\}/);
  assert.match(css, /\.admin-mfa-enroll:not\(\[hidden\]\)\{display:flex/);
});

test("MFA UI lives in System section and not on login", () => {
  const login = adminHtml.slice(adminHtml.indexOf('id="loginPanel"'), adminHtml.indexOf('id="dashboardPanel"'));
  const system = adminHtml.slice(adminHtml.indexOf('data-admin-section-panel="system"'), adminHtml.indexOf('data-admin-section-panel="storefront"'));
  assert.doesNotMatch(login, /id="mfaCard"/);
  assert.match(system, /id="mfaCard"/);
  assert.match(system, /id="mfaSetupBtn"/);
  assert.match(system, /id="mfaEnrollPanel"/);
  assert.match(system, /hidden/);
});

test("no AAL2 enforcement in Admin auth or MFA module", () => {
  assert.doesNotMatch(adminJs, /getAuthenticatorAssuranceLevel/);
  assert.doesNotMatch(mfaJs, /getAuthenticatorAssuranceLevel/);
  assert.doesNotMatch(mfaJs, /currentLevel/);
  assert.doesNotMatch(mfaJs, /nextLevel/);
  assert.match(adminJs, /async function loadMfaCard/);
  assert.doesNotMatch(adminJs, /blockAdminIfAal/);
});

test("MFA never persists or logs secrets", () => {
  assert.doesNotMatch(mfaJs, /localStorage\.setItem/);
  assert.doesNotMatch(mfaJs, /sessionStorage\.setItem/);
  assert.doesNotMatch(mfaJs, /console\.(log|debug|info|warn|error)/);
  assert.doesNotMatch(adminJs, /totp\.(secret|qr_code|uri)/);
});

test("verified factor is never unenrolled automatically in setup path", () => {
  assert.match(mfaJs, /if \(before\.configured\)/);
  assert.match(mfaJs, /before\.unverified\.map\(factorId\)/);
  assert.doesNotMatch(mfaJs, /before\.verified\.map\(factorId\)/);
  assert.match(mfaJs, /if \(!removeArmed\) return/);
});

test("failed verify does not sign out", () => {
  const verifyFn = mfaJs.match(/async function verifyOtp\(\)\s*\{[\s\S]*?async function confirmRemove/);
  assert.ok(verifyFn, "verifyOtp must exist");
  assert.doesNotMatch(verifyFn[0], /signOut/);
});

test("no service_role and no SQL/AAL2 policy edits in this phase", () => {
  assert.doesNotMatch(mfaJs, /service_role/);
  assert.doesNotMatch(adminJs, /service_role/);
  assert.doesNotMatch(setupSql, /aal2/i);
  assert.doesNotMatch(stage2b, /aal2/i);
});

test("password reset and Google OAuth files stay TokenHash/PKCE as before", () => {
  assert.match(resetJs, /verifyOtp\(\{token_hash:info\.tokenHash,type:"recovery"\}\)/);
  assert.doesNotMatch(resetJs, /exchangeCodeForSession/);
  assert.match(memberJs, /signInWithOAuth\(\{provider:"google",options:\{redirectTo\}\}/);
  assert.match(cfgJs, /reset-password\.html\?type=recovery/);
});

test("Admin client still has no Google OAuth and unchanged persist defaults", () => {
  assert.doesNotMatch(adminJs, /signInWithOAuth/);
  assert.match(adminJs, /createClient\(cfg\.url,cfg\.anonKey\|\|cfg\.publishableKey\)/);
  assert.doesNotMatch(adminJs, /detectSessionInUrl/);
  assert.doesNotMatch(adminJs, /persistSession:\s*false/);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("stage2c-admin-mfa-tests ok");
