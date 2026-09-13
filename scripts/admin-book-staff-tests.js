#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
const navSpec = read("tests/e2e/admin-navigation.spec.js");

function sliceFn(source, name) {
  const start = source.indexOf("async function " + name + "(");
  const alt = source.indexOf("function " + name + "(");
  const from = start >= 0 ? start : alt;
  assert.ok(from >= 0, "missing " + name);
  const next = source.slice(from + 1).search(/\n(?:async )?function /);
  return next < 0 ? source.slice(from) : source.slice(from, from + 1 + next);
}

function cssBraceBalance(css) {
  const withoutComments = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let min = 0;
  let quote = "";
  for (let i = 0; i < withoutComments.length; i++) {
    const ch = withoutComments[i];
    const prev = i > 0 ? withoutComments[i - 1] : "";
    if (quote) {
      if (ch === quote && prev !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < min) min = depth;
    }
  }
  return { depth, min, quote };
}

const systemPanel = adminHtml.slice(
  adminHtml.indexOf('data-admin-section-panel="system"'),
  adminHtml.indexOf('data-admin-section-panel="storefront"')
);

test("Book Staff management UI exists only inside Admin System section", () => {
  assert.match(systemPanel, /id="bookStaffCard"/);
  assert.match(systemPanel, /id="maintenanceCard"/);
  assert.match(systemPanel, /id="mfaCard"/);
  assert.match(systemPanel, /👤 كىتاب قوشۇش خادىملىرى/);
  assert.match(systemPanel, /id="bookStaffEmail"/);
  assert.match(systemPanel, /id="bookStaffAddBtn"[^>]*>قوشۇش/);
  assert.match(systemPanel, /id="bookStaffList"/);
  assert.doesNotMatch(adminHtml, /data-admin-section="book-staff"/);
  assert.doesNotMatch(adminHtml, /data-admin-section-panel="book-staff"/);
  const booksPanel = adminHtml.slice(
    adminHtml.indexOf('id="booksCard"'),
    adminHtml.indexOf('id="submissionsCard"')
  );
  assert.doesNotMatch(booksPanel, /id="bookStaffCard"/);
  assert.match(navSpec, /#bookStaffCard/);
});

test("add action calls add_kutadgu_book_staff RPC only", () => {
  const fn = sliceFn(adminJs, "addBookStaffAccount");
  assert.match(fn, /confirm\("بۇ Email نى كىتاب قوشۇش خادىمى قىلامسىز/);
  assert.match(fn, /تولۇق Admin قىلمايدۇ/);
  assert.match(fn, /db\.rpc\("add_kutadgu_book_staff",\{p_email:email\}\)/);
  assert.doesNotMatch(fn, /\.from\("book_staff_users"\)\.(insert|update|delete|upsert)/);
  assert.doesNotMatch(fn, /admin_users/);
  assert.doesNotMatch(fn, /auth\.admin|service_role/);
  assert.doesNotMatch(fn, /is_kutadgu_admin/);
});

test("activate/deactivate calls set_kutadgu_book_staff_active RPC only", () => {
  const fn = sliceFn(adminJs, "setBookStaffActive");
  const render = sliceFn(adminJs, "renderBookStaffAccounts");
  assert.match(fn, /db\.rpc\("set_kutadgu_book_staff_active",\{p_user_id:id,p_active:enable\}\)/);
  assert.match(fn, /confirm\("بۇ خادىمنى قايتا قوزغىتامسىز/);
  assert.match(fn, /confirm\("بۇ خادىمنى توختىتامسىز/);
  assert.doesNotMatch(fn, /\.from\("book_staff_users"\)\.(insert|update|delete|upsert)/);
  assert.doesNotMatch(fn, /admin_users/);
  assert.match(render, /توختىتىش/);
  assert.match(render, /قايتا قوزغىتىش/);
  assert.doesNotMatch(render, /ئۆچۈرۈش|data-delete/);
});

test("loader reads staff rows and only id,email,full_name from profiles", () => {
  const fn = sliceFn(adminJs, "loadBookStaffAccounts");
  assert.match(fn, /\.from\("book_staff_users"\)/);
  assert.match(fn, /\.select\("user_id,active,created_at,created_by"\)/);
  assert.match(adminJs, /const BOOK_STAFF_PROFILE_SELECT="id,email,full_name"/);
  assert.match(fn, /\.from\("profiles"\)\.select\(BOOK_STAFF_PROFILE_SELECT\)/);
  assert.doesNotMatch(fn, /phone|address|orders|customer_phone|customer_address/);
  assert.doesNotMatch(fn, /\.from\("book_staff_users"\)\.(insert|update|delete|upsert)/);
  assert.doesNotMatch(fn, /admin_users/);
  assert.match(adminJs, /if\(id==="system"\)loadBookStaffAccounts\(\)/);
});

test("staff list does not expose phone, address, or orders", () => {
  const render = sliceFn(adminJs, "renderBookStaffAccounts");
  assert.match(render, /row\.email/);
  assert.match(render, /row\.full_name/);
  assert.doesNotMatch(render, /phone|address|orders|customer_/);
  assert.doesNotMatch(adminHtml, /book_staff.*phone|staffPhone/);
});

test("existing Admin sections and pending submissions remain intact", () => {
  ["books", "overview", "submissions", "storefront", "import-covers", "insights", "customers", "orders", "system"].forEach((id) => {
    assert.match(adminHtml, new RegExp(`data-admin-section="${id}"`));
    assert.match(adminHtml, new RegExp(`<option value="${id}"`));
  });
  assert.match(
    adminJs,
    /const ADMIN_SECTIONS=\["overview","books","submissions","storefront","import-covers","insights","customers","orders","system"\]/
  );
  assert.match(adminHtml, /id="submissionsCard"[^>]*data-admin-section-panel="submissions"/);
  assert.match(adminJs, /approve_staff_book_submission/);
  assert.match(adminJs, /reject_staff_book_submission/);
  assert.match(
    adminJs,
    /await Promise\.all\(\[loadBooks\(\),loadMembers\(\),loadAnalytics\(\),loadStats\(\),loadMaintenanceCard\(\),loadAnnouncementCard\(\),loadHeroAdminCard\(\),loadMfaCard\(\)\]\)/
  );
});

test("admin.css staff styles are balanced", () => {
  const { depth, min, quote } = cssBraceBalance(adminCss);
  assert.strictEqual(quote, "", "unclosed CSS string");
  assert.ok(min >= 0, "unmatched closing brace");
  assert.strictEqual(depth, 0, "brace depth ended at " + depth);
  assert.match(adminCss, /\.admin-staff-list/);
  assert.match(adminCss, /\.admin-staff-actions button\{flex:1;min-height:44px\}/);
});

test("this PR does not add SQL or change public storefront files", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const sql = files.filter((file) => /\.sql$/i.test(file));
  assert.deepStrictEqual(sql, [], sql.join(", "));
  const storefront = files.filter((file) =>
    /^(index\.html|shop\.js|shop\.css|public-header\.(js|css)|catalog\.js)$/.test(file)
  );
  assert.deepStrictEqual(storefront, [], storefront.join(", "));
  assert.doesNotMatch(adminJs, /service_role/);
  assert.doesNotMatch(adminJs, /from\("admin_users"\)\.(insert|update|delete|upsert)/);
});

if (failed) {
  console.error("\n" + failed + " admin book staff test(s) failed");
  process.exit(1);
}
console.log("admin-book-staff-tests ok");
