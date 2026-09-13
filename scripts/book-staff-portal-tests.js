#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

let failed = 0;
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.stack || err.message);
      });
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.stack || err.message);
  }
}

const accountHtml = read("account.html");
const accountJs = read("account.js");
const staffHtml = read("book-staff.html");
const staffJs = read("book-staff.js");
const memberJs = read("member.js");
const adminJs = read("admin.js");
const sql = read("STAGE92_BOOK_STAFF_SECURITY.sql");

function loadStaffApi() {
  const sandbox = {
    window: {
      KUTADGU_APP_CONFIG: {
        catalogCategories: [{ source: "dini.html", label: "دىنىي كىتابلار" }]
      }
    },
    document: {
      readyState: "complete",
      querySelector() { return null; },
      addEventListener() {}
    },
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Error,
    Promise,
    Map,
    setTimeout,
    clearTimeout
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.runInNewContext(staffJs, sandbox);
  return sandbox.window.KutadguBookStaff;
}

const pending = [];
function add(name, fn) {
  const result = test(name, fn);
  if (result && typeof result.then === "function") pending.push(result);
}

add("account.html Book Staff button is hidden UX only and links to /book-staff.html", () => {
  assert.match(accountHtml, /id="bookStaffEntry"/);
  assert.match(accountHtml, /bookStaffEntry[^>]*hidden|hidden[^>]*bookStaffEntry/);
  assert.match(accountHtml, /href="\/book-staff\.html"/);
  assert.match(accountHtml, /📚 كىتاب قوشۇش/);
  assert.match(accountHtml, /يېڭى كىتاب ئۇچۇرىنى كىرگۈزۈپ باشقۇرغۇچىنىڭ تەستىقىغا يوللاڭ/);
  assert.doesNotMatch(accountHtml, /Full Admin|admin_users/);
  assert.match(accountJs, /rpc\("is_kutadgu_book_staff"\)/);
  assert.match(accountJs, /hideBookStaffEntry\(\)/);
  assert.match(accountJs, /catch\(e\)\{\}/);
  assert.doesNotMatch(accountJs, /is_kutadgu_admin/);
  assert.match(accountHtml, /account\.js\?v=6/);
  assert.match(accountHtml, /member\.js\?v=26/);
  assert.match(accountHtml, /supabase-config\.js\?v=21/);
});

add("staff page is private, separate from admin, and not in public chrome", () => {
  assert.match(staffHtml, /noindex, nofollow/);
  assert.match(staffHtml, /book-staff\.js\?v=1/);
  assert.match(staffHtml, /admin-mfa\.js\?v=3/);
  assert.match(staffHtml, /member\.js\?v=26/);
  assert.doesNotMatch(staffHtml, /admin\.html|admin\.js/);
  assert.doesNotMatch(staffHtml, /data-admin-section|Orders|Analytics|Pending review/);
  assert.match(staffHtml, /بۇ ھېسابقا كىتاب قوشۇش خادىمى ھوقۇقى بېرىلمىگەن/);
  assert.match(staffHtml, /href="\/account\.html"/);
  const index = read("index.html");
  assert.doesNotMatch(index, /book-staff\.html/);
  const footer = accountHtml.match(/site-footer[\s\S]*?<\/footer>/)[0];
  assert.doesNotMatch(footer, /book-staff\.html/);
  assert.match(read("public-header.js"), /"book-staff\.html": true/);
  assert.match(read("kutadgu-sitemap.js"), /\/book-staff\.html/);
  assert.doesNotMatch(read("sitemap-pages.xml"), /book-staff/);
});

add("staff JS never writes books directly and never uses admin_users", () => {
  assert.doesNotMatch(staffJs, /\.from\("books"\)\.(insert|update|upsert|delete)/);
  assert.doesNotMatch(staffJs, /admin_users/);
  assert.doesNotMatch(staffJs, /is_kutadgu_admin/);
  assert.match(staffJs, /rpc\("submit_book_for_approval",\{payload:payload\}\)/);
  assert.match(staffJs, /rpc\("is_kutadgu_book_staff"\)/);
  assert.match(staffJs, /inspectAccess/);
  assert.match(staffJs, /ensurePrimarySessionReady/);
  assert.match(staffJs, /attachGate/);
  assert.match(staffJs, /storage\.from\(bucket\)\.upload\(path,valid,\{upsert:false/);
  assert.match(staffJs, /staff\/"\+String\(uid\)\+"\//);
  assert.doesNotMatch(staffJs, /getPublicUrl/);
  assert.doesNotMatch(staffJs, /type="url"|image_url input|javascript:/);
});

add("payload whitelist matches Stage92 and excludes protected fields", () => {
  const api = loadStaffApi();
  const payload = api.buildPayload({
    title: "Test Book",
    author: "Author",
    source: "dini.html",
    category: "دىنىي كىتابلار",
    price: "12.5",
    original_price: "20",
    stock: "3",
    pages: "120",
    publish_year: "2020",
    cover_type: "hardcover",
    book_size: "A5",
    interior_print_type: "bw",
    is_color_print: false,
    isbn: "123",
    image_url: "staff/abc/file.jpg"
  });
  assert.deepStrictEqual(Object.keys(payload).sort(), [
    "author", "book_size", "category", "cover_type", "image_url", "interior_print_type",
    "is_color_print", "isbn", "original_price", "pages", "price", "publish_year",
    "source", "stock", "title"
  ].sort());
  assert.strictEqual(payload.price, 12.5);
  assert.strictEqual(payload.stock, 3);
  api.FORBIDDEN_FIELDS.forEach((field) => {
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, field), field);
  });
  assert.throws(() => api.buildPayload({ title: "", author: "A", source: "dini.html", category: "دىنىي كىتابلار", price: "1" }));
  assert.throws(() => api.buildPayload({ title: "T", author: "A", source: "dini.html", category: "دىنىي كىتابلار", price: "-1" }));
  assert.throws(() => api.buildPayload({ title: "T", author: "A", source: "dini.html", category: "دىنىي كىتابلار", price: "1", publish_year: "999" }));
  assert.throws(() => api.buildPayload({ title: "T", author: "A", source: "dini.html", category: "دىنىي كىتابلار", price: "1", cover_type: "leather" }));
});

add("cover path is staff/<uid>/ and RPC result is fail-closed", () => {
  const api = loadStaffApi();
  const p = api.staffCoverObjectPath("11111111-1111-4111-8111-111111111111", { name: "cover.JPG" });
  assert.match(p, /^staff\/11111111-1111-4111-8111-111111111111\/\d{8}-[a-z0-9]+-cover\.jpg$/);
  assert.ok(!p.includes(".."));
  assert.strictEqual(api.isActiveStaffResult(true), true);
  assert.strictEqual(api.isActiveStaffResult(false), false);
  assert.strictEqual(api.isActiveStaffResult(null), false);
  assert.strictEqual(api.isActiveStaffResult({}), false);
  assert.strictEqual(api.isActiveStaffResult([true]), true);
  assert.throws(() => api.validateCoverFile({ type: "text/html", size: 10, name: "x.html" }));
});

add("AAL2 unlocks form; AAL1 with TOTP gates; missing TOTP enrolls; invalid OTP does not submit", () => {
  const api = loadStaffApi();
  assert.strictEqual(api.staffSurface({ assurance: { currentLevel: "aal2" }, classified: { configured: true } }), "form");
  assert.strictEqual(api.staffSurface({ assurance: { currentLevel: "aal1" }, classified: { configured: true } }), "gate");
  assert.strictEqual(api.staffSurface({ assurance: { currentLevel: "aal1" }, classified: { configured: false } }), "enroll");
  assert.match(staffJs, /AAL2 required/);
  assert.match(staffHtml, /id="mfaGateForm"/);
  assert.match(staffHtml, /id="mfaSetupBtn"/);
  assert.doesNotMatch(staffJs, /from\("books"\)/);
});

add("backend Stage92 already has staff RPC and AAL2; this PR adds no SQL", () => {
  assert.match(sql, /is_kutadgu_book_staff/);
  assert.match(sql, /submit_book_for_approval/);
  assert.match(sql, /auth\.jwt\(\)->>'aal'\) IS DISTINCT FROM 'aal2'/);
  assert.match(sql, /staff\/' \|\| v_uid::text \|\| '\//);
  assert.doesNotMatch(staffJs, /CREATE TABLE|ALTER TABLE/);
  assert.doesNotMatch(accountJs, /CREATE TABLE/);
});

add("Admin MFA and pending/staff management files stay authoritative", () => {
  assert.match(read("admin-mfa.js"), /function inspectAccess/);
  assert.match(adminJs, /approve_staff_book_submission/);
  assert.match(adminJs, /add_kutadgu_book_staff/);
  assert.doesNotMatch(staffHtml, /approve_staff_book_submission/);
});

add("Google OAuth account pins from PR 155 remain on account.html", () => {
  assert.match(accountHtml, /supabase-config\.js\?v=21/);
  assert.match(accountHtml, /member\.js\?v=26/);
  assert.match(memberJs, /detectSessionInUrl:true,persistSession:true,flowType:"pkce"/);
  assert.doesNotMatch(accountJs, /exchangeCodeForSession/);
});

Promise.resolve().then(() => Promise.all(pending)).then(() => {
  if (failed) {
    console.error("\n" + failed + " book-staff portal test(s) failed");
    process.exit(1);
  }
  console.log("book-staff-portal-tests ok");
});
