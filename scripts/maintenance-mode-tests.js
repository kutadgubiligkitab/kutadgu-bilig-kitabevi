#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

const maint = read("kutadgu-maintenance.js");
const sql = read("SITE_MAINTENANCE_MODE.sql");
const cfg = read("supabase-config.js");
const adminJs = read("admin.js");
const adminHtml = read("admin.html");
const vercel = read("vercel.json");
const helpers = read("tests/e2e/helpers.js");

test("SQL is a single store_settings key with admin-only writes", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.store_settings/);
  assert.match(sql, /maintenance_mode/);
  assert.match(sql, /is_kutadgu_admin\(\)/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.store_settings TO anon, authenticated/);
  assert.match(sql, /GRANT INSERT, UPDATE ON TABLE public\.store_settings TO authenticated/);
  assert.doesNotMatch(sql, /GRANT[^\n]*service_role/);
  assert.doesNotMatch(sql, /DELETE ON TABLE public\.store_settings/);
});

test("guard fail-open on lookup error and uses admin_users for bypass", () => {
  assert.match(maint, /if \(!res\.ok\) return \{ error: true/);
  assert.match(maint, /if \(res\.error\) return false/);
  assert.match(maint, /\/rest\/v1\/admin_users\?select=user_id/);
  assert.match(maint, /cache: "no-store"/);
  assert.match(maint, /credentials: "omit"/);
  assert.match(maint, /kutadgu-maint-admin-note/);
  assert.doesNotMatch(maint, /service_role/);
  assert.doesNotMatch(maint, /[?&]bypass=/);
  assert.doesNotMatch(maint, /localStorage\.getItem\(["']kutadgu/);
  assert.doesNotMatch(maint, /maintenance_bypass/);
});

test("guard covers storefront and skips Admin + password recovery", () => {
  assert.match(maint, /admin\.html/);
  assert.match(maint, /reset-password\.html/);
  assert.match(maint, /kutadgu-maintenance-overlay/);
  assert.match(maint, /dir", "rtl"/);
  assert.match(maint, /noindex, nofollow/);
  assert.match(maint, /تور بېتىمىزدە ۋاقىتلىق ئاسراش/);
});

test("supabase-config loads one centralized guard without mass HTML", () => {
  assert.match(cfg, /kutadgu-maintenance\.js\?v=2/);
  assert.match(cfg, /admin\.html/);
  assert.doesNotMatch(cfg, /service_role/);
});

test("Admin UI is Uyghur with confirm, no English ON/OFF labels", () => {
  assert.match(adminHtml, /ئاسراشنى باشلاش/);
  assert.match(adminHtml, /id="maintenanceToggleBtn"/);
  assert.match(adminJs, /ئاسراشنى توختىتىش/);
  assert.match(adminJs, /confirm\(/);
  assert.match(adminJs, /from\("store_settings"\)\.update/);
  assert.doesNotMatch(adminHtml, />\s*ON\s*</);
  assert.doesNotMatch(adminHtml, />\s*OFF\s*</);
  assert.match(adminHtml, /admin\.js\?v=54/);
  assert.match(adminHtml, /admin\.css\?v=33/);
});

test("homepage title and root URL files were not rewritten by this feature", () => {
  const index = read("index.html");
  assert.match(index, /<title>قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
  assert.match(index, /rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/"/);
  assert.match(index, /<a href="\/" class="logo">/);
  const shop = read("shop.js");
  assert.match(shop, /const HOMEPAGE_DOCUMENT_TITLE="قۇتادغۇبىلىك كىتابخانىسى"/);
  const v = JSON.parse(vercel);
  const home = (v.redirects || []).filter((r) => r.source === "/index.html");
  assert.strictEqual(home.length, 1);
  assert.strictEqual(home[0].destination, "/");
});

test("e2e write-safe helper blocks store_settings writes", () => {
  assert.match(helpers, /store_settings/);
});

test("no 503 architecture rewrite; vercel cache exemption is localized", () => {
  const v = JSON.parse(vercel);
  assert.ok(!(v.rewrites || []).some((r) => /maintenance/.test(JSON.stringify(r))));
  assert.ok((v.headers || []).some((h) => h.source === "/kutadgu-maintenance.js"));
  assert.ok((v.headers || []).some((h) => h.source === "/supabase-config.js"));
});

if (failed) {
  process.exit(1);
}
console.log("All maintenance-mode unit checks passed.");
