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

test("evaluateAccess routing for aal2, aal1+verified, and aal1 without factor", () => {
  const none = Mfa.classifyFactors({ all: [] });
  const verified = Mfa.classifyFactors({ all: [{ id: "f1", factor_type: "totp", status: "verified" }] });
  const aal2 = Mfa.evaluateAccess({ currentLevel: "aal2" }, verified);
  assert.strictEqual(aal2.surface, "dashboard");
  assert.strictEqual(aal2.gate, false);
  const gate = Mfa.evaluateAccess({ currentLevel: "aal1" }, verified);
  assert.strictEqual(gate.surface, "gate");
  assert.strictEqual(gate.gate, true);
  const open = Mfa.evaluateAccess({ currentLevel: "aal1" }, none);
  assert.strictEqual(open.surface, "dashboard");
  assert.strictEqual(open.gate, false);
  assert.strictEqual(open.warnMissingMfa, true);
});

test("multiple verified TOTP factors pick the lowest factor id", () => {
  const chosen = Mfa.chooseVerifiedTotp([
    { id: "z-factor", factor_type: "totp", status: "verified" },
    { id: "a-factor", factor_type: "totp", status: "verified" }
  ]);
  assert.strictEqual(chosen.id, "a-factor");
});

test("gate submit does not sign out or unenroll on failure", () => {
  const gate = mfaJs.match(/function attachGate\([\s\S]*?function attach\(/);
  assert.ok(gate, "attachGate must exist");
  assert.doesNotMatch(gate[0], /signOut/);
  assert.doesNotMatch(gate[0], /unenroll/);
  assert.match(gate[0], /challengeAndVerify/);
  assert.match(gate[0], /getAuthenticatorAssuranceLevel/);
});

test("MFA hidden panels stay display:none so enrollment UI is not visible by default", () => {
  const css = read("admin.css");
  assert.match(css, /#mfaCard \[hidden\],#mfaGatePanel\[hidden\],#idleLockPanel\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.admin-mfa-enroll:not\(\[hidden\]\)\{display:flex/);
});

test("MFA UI lives in System section and not on login", () => {
  const login = adminHtml.slice(adminHtml.indexOf('id="loginPanel"'), adminHtml.indexOf('id="mfaGatePanel"'));
  const system = adminHtml.slice(adminHtml.indexOf('data-admin-section-panel="system"'), adminHtml.indexOf('data-admin-section-panel="storefront"'));
  assert.doesNotMatch(login, /id="mfaCard"/);
  assert.match(system, /id="mfaCard"/);
  assert.match(system, /id="mfaSetupBtn"/);
  assert.match(system, /id="mfaEnrollPanel"/);
  assert.match(adminHtml, /id="mfaGatePanel"/);
  assert.match(system, /hidden/);
});

test("AAL2 is UI-gated only; SQL and checkAdmin stay unchanged", () => {
  assert.match(mfaJs, /getAuthenticatorAssuranceLevel/);
  assert.match(mfaJs, /function evaluateAccess/);
  assert.match(adminJs, /checkAdmin\(session\.user\)/);
  const route = adminJs.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
  assert.ok(route);
  assert.match(route[0], /checkAdmin/);
  const live = route[0].slice(route[0].indexOf("getSession"));
  assert.ok(live.indexOf("checkAdmin") >= 0);
  assert.ok(live.indexOf("inspectAccess") > live.indexOf("checkAdmin"));
  assert.ok(live.indexOf("adminShouldHoldIdleLock") > live.indexOf("checkAdmin"));
  assert.ok(live.indexOf("inspectAccess") > live.indexOf("adminShouldHoldIdleLock"));
  assert.match(route[0], /decision\.gate/);
  assert.doesNotMatch(adminJs, /from\("books"\).*aal2/s);
  assert.match(adminJs, /async function loadMfaCard/);
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

test("no service_role; grant function and Stage 2B SELECT stay without AAL2", () => {
  assert.doesNotMatch(mfaJs, /service_role/);
  assert.doesNotMatch(adminJs, /service_role/);
  const fn = setupSql.match(/create or replace function public\.is_kutadgu_admin\(\)[\s\S]*?\$\$;/);
  assert.ok(fn);
  assert.doesNotMatch(fn[0], /aal2/i);
  assert.doesNotMatch(fn[0], /auth\.jwt\(\)/);
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
