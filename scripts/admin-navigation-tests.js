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

const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const adminCss = read("admin.css");

function loadParseAdminSectionHash() {
  const sections = adminJs.match(/const ADMIN_SECTIONS=\[[^\]]+\]/);
  const def = adminJs.match(/const DEFAULT_ADMIN_SECTION="[^"]+"/);
  const fn = adminJs.match(/function parseAdminSectionHash\(hash\)\{[\s\S]*?\n\}/);
  assert.ok(sections && def && fn, "admin.js must define section hash helpers");
  return new Function(`${sections[0]};${def[0]};${fn[0]};return parseAdminSectionHash;`)();
}

test("cache pins are admin.css v=22, admin.js v=40, admin-mfa.js v=2, and admin-idle.js v=2", () => {
  assert.match(adminHtml, /admin\.css\?v=22/);
  assert.match(adminHtml, /admin\.js\?v=40/);
  assert.match(adminHtml, /admin-mfa\.js\?v=2/);
  assert.match(adminHtml, /admin-idle\.js\?v=2/);
  assert.match(adminHtml, /admin-catalog-productivity\.js\?v=2/);
  assert.doesNotMatch(adminHtml, /admin\.css\?v=21/);
  assert.doesNotMatch(adminHtml, /admin\.js\?v=39/);
});

test("section grouping keeps existing Admin cards", () => {
  assert.match(adminHtml, /id="overviewSection"[^>]*data-admin-section-panel="overview"/);
  assert.match(adminHtml, /id="adminStatus"/);
  assert.match(adminHtml, /class="admin-stats"/);
  assert.match(adminHtml, /id="booksCard"[^>]*data-admin-section-panel="books"/);
  assert.match(adminHtml, /id="announcementCard"/);
  assert.match(adminHtml, /data-admin-section-panel="storefront"/);
  assert.match(adminHtml, /id="coverRepairCard"/);
  assert.match(adminHtml, /data-admin-section-panel="import-covers"/);
  assert.match(adminHtml, /id="analyticsManagement"/);
  assert.match(adminHtml, /data-admin-section-panel="insights"/);
  assert.match(adminHtml, /id="memberManagement"/);
  assert.match(adminHtml, /data-admin-section-panel="customers"/);
  assert.match(adminHtml, /id="maintenanceCard"/);
  assert.match(adminHtml, /id="mfaCard"/);
  assert.match(adminHtml, /data-admin-section-panel="system"/);
  assert.match(adminHtml, /id="adminSectionSelect"/);
  assert.match(adminHtml, /class="admin-sidenav"/);
});

test("modals stay outside dashboard section panels", () => {
  const dashEnd = adminHtml.indexOf("</main>");
  const bookModal = adminHtml.indexOf('id="bookModal"');
  const importModal = adminHtml.indexOf('id="importModal"');
  const quickModal = adminHtml.indexOf('id="quickEditModal"');
  const bulkModal = adminHtml.indexOf('id="bulkConfirmModal"');
  assert.ok(dashEnd > 0 && bookModal > dashEnd && importModal > dashEnd);
  assert.ok(quickModal > dashEnd && bulkModal > dashEnd);
});

test("login/setup panels ignore dashboard section markup", () => {
  const setup = adminHtml.slice(adminHtml.indexOf('id="setupPanel"'), adminHtml.indexOf('id="loginPanel"'));
  const login = adminHtml.slice(adminHtml.indexOf('id="loginPanel"'), adminHtml.indexOf('id="mfaGatePanel"'));
  assert.doesNotMatch(setup, /data-admin-section=/);
  assert.doesNotMatch(login, /data-admin-section=/);
});

test("default section is books and hash parser falls back", () => {
  const parse = loadParseAdminSectionHash();
  assert.strictEqual(parse(""), "books");
  assert.strictEqual(parse("#"), "books");
  assert.strictEqual(parse("#nope"), "books");
  assert.strictEqual(parse("#BOOKS"), "books");
  assert.strictEqual(parse("#system"), "system");
  assert.strictEqual(parse("import-covers"), "import-covers");
  assert.strictEqual(parse("#customers"), "customers");
});

test("post-auth load list is unchanged", () => {
  assert.match(
    adminJs,
    /await Promise\.all\(\[loadBooks\(\),loadMembers\(\),loadAnalytics\(\),loadStats\(\),loadMaintenanceCard\(\),loadAnnouncementCard\(\),loadMfaCard\(\)\]\)/
  );
  assert.match(adminJs, /show\("dashboardPanel"\);\s*applyDashboardSectionFromLocation\(\{replace:true\}\)/);
});

test("hash switching is gated on authorized dashboard", () => {
  assert.match(adminJs, /function dashboardAuthorized\(\)/);
  assert.match(adminJs, /if\(applyingAdminSection\|\|!dashboardAuthorized\(\)\)return/);
  assert.match(adminJs, /function showAdminSection\(/);
});

test("desktop sidebar sits on the RTL inline-start track", () => {
  assert.match(adminCss, /grid-template-columns:\s*228px minmax\(0,1fr\)/);
  assert.match(adminCss, /@media\(max-width:\s*850px\)/);
  assert.match(adminCss, /\.admin-sidenav\{display:none\}/);
  assert.match(adminCss, /\.admin-section-picker\{display:block\}/);
  assert.match(adminCss, /\.admin-nav-item\.is-active/);
  assert.match(adminCss, /border-inline-start:\s*3px solid #70503d/);
  assert.match(adminCss, /\.admin-modal\{[^}]*z-index:40000/);
});

test("nav labels use the required Uyghur section titles", () => {
  assert.match(adminHtml, /📚 كىتابلار/);
  assert.match(adminHtml, /📊 ئومۇمىي كۆرۈنۈش/);
  assert.match(adminHtml, /📢 توربەت مەزمۇنى/);
  assert.match(adminHtml, /📥 ئىمپورت ۋە مۇقاۋا/);
  assert.match(adminHtml, /📈 ستاتىستىكا/);
  assert.match(adminHtml, /👥 ئەزالار/);
  assert.match(adminHtml, /⚙️ سىستېما/);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("admin-navigation-tests ok");
