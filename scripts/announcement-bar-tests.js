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

const sql = read("SITE_ANNOUNCEMENT_BAR.sql");
const js = read("kutadgu-announcements.js");
const cfg = read("supabase-config.js");
const adminJs = read("admin.js");
const adminHtml = read("admin.html");
const helpers = read("tests/e2e/helpers.js");
const vercel = read("vercel.json");
const maintSql = read("SITE_MAINTENANCE_MODE.sql");
const api = require(path.join(root, "kutadgu-announcements.js"));

test("SQL creates announcements + singleton settings without touching store_settings", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.store_announcements/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.store_announcement_settings/);
  assert.match(sql, /rotation_interval_seconds integer NOT NULL DEFAULT 5/);
  assert.match(sql, /rotation_interval_seconds >= 2 AND rotation_interval_seconds <= 60/);
  assert.match(sql, /CONSTRAINT store_announcement_settings_singleton CHECK \(id = 1\)/);
  assert.match(sql, /starts_at timestamptz NULL/);
  assert.match(sql, /ends_at timestamptz NULL/);
  assert.match(sql, /is_kutadgu_admin\(\)/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.store_announcements TO anon, authenticated/);
  assert.match(sql, /GRANT INSERT, UPDATE, DELETE ON TABLE public\.store_announcements TO authenticated/);
  assert.match(sql, /GRANT INSERT, UPDATE ON TABLE public\.store_announcement_settings TO authenticated/);
  assert.doesNotMatch(sql, /GRANT[^\n]*service_role/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS public\.store_settings/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.store_settings/);
  assert.doesNotMatch(sql, /key = 'maintenance_mode'/);
  assert.match(maintSql, /CREATE TABLE IF NOT EXISTS public\.store_settings/);
});

test("RLS public window vs admin-all and settings public read", () => {
  assert.match(sql, /store_announcements_select_public/);
  assert.match(sql, /enabled = true/);
  assert.match(sql, /starts_at IS NULL OR starts_at <= now\(\)/);
  assert.match(sql, /ends_at IS NULL OR ends_at >= now\(\)/);
  assert.match(sql, /store_announcements_select_admin/);
  assert.match(sql, /store_announcements_delete_admin/);
  assert.match(sql, /store_announcement_settings_select_public/);
  assert.match(sql, /store_announcement_settings_update_admin/);
});

test("storefront fail-open, textContent only, mount inside header", () => {
  assert.match(js, /el\.textContent = String\(message/);
  assert.match(js, /el\.textContent = msg/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
  assert.match(js, /header\.appendChild\(bar\)/);
  assert.doesNotMatch(js, /wrapHeader|site-top-stack/);
  assert.match(js, /if \(!res\.ok\) return \{ error: true/);
  assert.match(js, /credentials: "omit"/);
  assert.doesNotMatch(js, /service_role/);
  assert.doesNotMatch(js, /<marquee/i);
  assert.match(js, /line-clamp:2/);
  assert.match(js, /-webkit-line-clamp:2/);
  assert.match(js, /تەپسىلات ↓/);
  assert.match(js, /يىغىش ↑/);
  assert.match(js, /border-radius:999px/);
  assert.match(js, /max\(48px, 5%\)/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /aria-controls/);
  assert.match(js, /isLineOverflowing/);
  assert.match(js, /scrollHeight/);
  assert.match(js, /prefers-reduced-motion/);
  assert.doesNotMatch(js, /kutadgu-announce-ltr/);
  assert.doesNotMatch(js, /data-announce-clone/);
  assert.doesNotMatch(js, /isTickerOverflow/);
  assert.doesNotMatch(js, /--kutadgu-announce-travel/);
  assert.doesNotMatch(js, /lockCopyWidth/);
  assert.doesNotMatch(js, /padding-inline-end:3em/);
  assert.doesNotMatch(js, /translate3d\(-50%/);
  assert.match(cfg, /kutadgu-announcements\.js\?v=6/);
  assert.match(cfg, /kutadgu-maintenance\.js\?v=2/);
});

test("filterActive respects enabled and start/end window", () => {
  const now = Date.parse("2026-09-01T12:00:00Z");
  const rows = [
    { message: "future", enabled: true, sort_order: 1, starts_at: "2026-09-02T00:00:00Z" },
    { message: "past", enabled: true, sort_order: 2, ends_at: "2026-08-01T00:00:00Z" },
    { message: "off", enabled: false, sort_order: 0 },
    { message: "on", enabled: true, sort_order: 3 },
    { message: "  ", enabled: true, sort_order: 4 }
  ];
  const active = api.filterActive(rows, now);
  assert.deepStrictEqual(active.map((r) => r.message), ["on"]);
  assert.strictEqual(api.isAnnouncementCurrent({ message: "x", enabled: true }, now), true);
  assert.strictEqual(api.isAnnouncementCurrent({ message: "x", enabled: false }, now), false);
});

test("interval clamp and autoplay rules", () => {
  assert.strictEqual(api.clampInterval(5), 5);
  assert.strictEqual(api.clampInterval(1), 2);
  assert.strictEqual(api.clampInterval(90), 60);
  assert.strictEqual(api.clampInterval("nope"), 5);
  assert.strictEqual(api.shouldAutoplay(0), false);
  assert.strictEqual(api.shouldAutoplay(1), false);
  assert.strictEqual(api.shouldAutoplay(3), true);
  assert.strictEqual(api.shouldAutoplay(3, { reducedMotion: true }), false);
  assert.strictEqual(api.isLineOverflowing(80, 40), true);
  assert.strictEqual(api.isLineOverflowing(40, 40), false);
  assert.strictEqual(api.isLineOverflowing(41, 40), false);
  assert.strictEqual(api.isLineOverflowing(42, 40), true);
});

test("Admin card is separate from book CRUD with Uyghur labels", () => {
  assert.match(adminHtml, /id="announcementCard"/);
  assert.match(adminHtml, /id="announceInterval"/);
  assert.match(adminHtml, /id="announceSaveBtn"/);
  assert.match(adminHtml, /id="maintenanceToggleBtn"/);
  assert.match(adminHtml, /ئېلان بالدىقى/);
  assert.match(adminHtml, /admin\.js\?v=58/);
  assert.match(adminHtml, /admin\.css\?v=34/);
  assert.match(adminJs, /from\("store_announcements"\)\.insert/);
  assert.match(adminJs, /from\("store_announcements"\)\.update/);
  assert.match(adminJs, /from\("store_announcements"\)\.delete/);
  assert.match(adminJs, /from\("store_announcement_settings"\)\.update/);
  assert.match(adminJs, /confirm\("بۇ ئېلاننى ئۆچۈرەمسىز؟"\)/);
  assert.match(adminJs, /from\("store_settings"\)\.update/);
  assert.doesNotMatch(adminHtml, />\s*ON\s*</);
  assert.doesNotMatch(adminJs, /service_role/);
});

test("e2e stubs announcements so CI does not use live rows", () => {
  assert.match(helpers, /store_announcements/);
  assert.match(helpers, /store_announcement_settings/);
  assert.match(helpers, /installAnnouncementFixtures/);
  assert.match(helpers, /PGRST205/);
});

test("sticky shared CSS does not wrap header or restyle admin brand as a storefront link", () => {
  const theme = read("theme.css");
  const shop = read("shop.css");
  const mobile = read("mobile.css");
  assert.match(theme, /body > header:not\(\.account-topbar\):not\(\.admin-topbar\)/);
  assert.match(shop, /body > header:not\(\.account-topbar\):not\(\.admin-topbar\)/);
  assert.match(mobile, /--kutadgu-sticky-header-height/);
  assert.match(js, /ensureLogoHomeLink/);
  assert.match(js, /admin-brand/);
  const adminHtml = read("admin.html");
  assert.match(adminHtml, /<div class="admin-brand">/);
  assert.doesNotMatch(adminHtml, /class="admin-brand"><a href="\/"/);
});

test("vercel exempts announcement script cache like maintenance", () => {
  const v = JSON.parse(vercel);
  assert.ok((v.headers || []).some((h) => h.source === "/kutadgu-announcements.js"));
  assert.ok((v.headers || []).some((h) => h.source === "/kutadgu-maintenance.js"));
});

if (failed) {
  process.exit(1);
}
console.log("All announcement-bar unit checks passed.");
