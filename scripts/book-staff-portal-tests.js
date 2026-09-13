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

function loadStaffHarness() {
  const panels = {};
  function el(id) {
    if (!panels[id]) {
      panels[id] = {
        hidden: true,
        textContent: "",
        value: "",
        innerHTML: "",
        onclick: null,
        files: [],
        addEventListener() {},
        reset() {}
      };
    }
    return panels[id];
  }
  const sandbox = {
    window: {
      KUTADGU_APP_CONFIG: {
        catalogCategories: [{ source: "dini.html", label: "دىنىي كىتابلار" }]
      },
      KUTADGU_SUPABASE_CONFIG: {
        url: "https://fxlojnqwyojqjskfggmh.supabase.co",
        bucket: "book-covers"
      }
    },
    document: {
      readyState: "complete",
      querySelector(sel) {
        if (sel && sel.charAt(0) === "#") return el(sel.slice(1));
        return null;
      },
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
    URL,
    Promise,
    Map,
    setTimeout,
    clearTimeout
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.runInNewContext(staffJs, sandbox);
  return { api: sandbox.window.KutadguBookStaff, window: sandbox.window, panels };
}

function loadStaffApi() {
  return loadStaffHarness().api;
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
  assert.match(staffHtml, /book-staff\.js\?v=2/);
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

add("Book Staff form uses Uyghur dropdown labels with unchanged backend values", () => {
  assert.match(staffHtml, /book-staff\.css\?v=4/);
  assert.match(staffHtml, /<option value="hardcover">قاتتىق مۇقاۋا<\/option>/);
  assert.match(staffHtml, /<option value="paperback">يۇمشاق مۇقاۋا<\/option>/);
  assert.match(staffHtml, /<option value="other">باشقا<\/option>/);
  assert.match(staffHtml, /<option value="A4">A4<\/option>/);
  assert.match(staffHtml, /<option value="A5">A5<\/option>/);
  assert.match(staffHtml, /<option value="B5">B5<\/option>/);
  assert.match(staffHtml, /<option value="color">رەڭلىك<\/option>/);
  assert.match(staffHtml, /<option value="bw">قارا-ئاق<\/option>/);
  const css = read("book-staff.css");
  assert.match(css, /gap:20px/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /\.staff-form label>span\{[\s\S]*line-height:1\.7/);
  assert.match(css, /textarea\{[\s\S]*line-height:1\.8/);
  assert.match(css, /input\[type="checkbox"\]\{[\s\S]*width:22px/);
  assert.match(staffHtml, /book-staff\.js\?v=2/);
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
  assert.match(staffJs, /getPublicUrl\(path\)/);
  assert.match(staffJs, /assertStaffCoverPublicUrl/);
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
    image_url: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/abc/file.jpg"
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

add("cover public URL is browser-usable and scoped to this staff user", () => {
  const api = loadStaffApi();
  const uid = "11111111-1111-4111-8111-111111111111";
  const objectPath = api.staffCoverObjectPath(uid, { name: "cover.JPG" });
  const url = api.staffCoverPublicUrl(uid, objectPath);
  assert.match(url, /^https:\/\/fxlojnqwyojqjskfggmh\.supabase\.co\/storage\/v1\/object\/public\/book-covers\/staff\/11111111-1111-4111-8111-111111111111\/\d{8}-[a-z0-9]+-cover\.jpg$/);
  assert.strictEqual(api.assertStaffCoverPublicUrl(uid, url), url);
  const Safe = require(path.join(root, "kutadgu-safe-url.js"));
  assert.strictEqual(Safe.isSafeCoverUrl(url), true);
  assert.match(adminJs, /isSafeCoverUrl\(b\.image_url\)\?`<img src="\$\{esc\(b\.image_url\)\}"/);
  assert.throws(() => api.assertStaffCoverPublicUrl(uid, objectPath));
  assert.throws(() => api.assertStaffCoverPublicUrl(uid, "/staff/" + uid + "/cover.jpg"));
  assert.throws(() => api.assertStaffCoverPublicUrl("22222222-2222-4222-8222-222222222222", url));
  assert.throws(() => api.assertStaffCoverPublicUrl(uid, url + "?download=1"));
  assert.throws(() => api.assertStaffCoverPublicUrl(uid, url + "#x"));
  assert.throws(() => api.assertStaffCoverPublicUrl(uid, "https://evil.example/storage/v1/object/public/book-covers/staff/" + uid + "/cover.jpg"));
  assert.throws(() => api.assertStaffCoverPublicUrl(uid, "https://another.supabase.co/storage/v1/object/public/book-covers/staff/" + uid + "/cover.jpg"));
  assert.throws(() => api.staffCoverPublicUrl(uid, "staff/22222222-2222-4222-8222-222222222222/cover.jpg"));
});

add("AAL2 unlocks form; AAL1 with TOTP gates; missing TOTP enrolls; invalid OTP does not submit", () => {
  const api = loadStaffApi();
  assert.strictEqual(api.staffSurface({ assurance: { currentLevel: "aal2" }, classified: { configured: true } }), "form");
  assert.strictEqual(api.staffSurface({ assurance: { currentLevel: "aal1" }, classified: { configured: true } }), "gate");
  assert.strictEqual(api.staffSurface({ assurance: { currentLevel: "aal1" }, classified: { configured: false } }), "enroll");
  assert.match(staffJs, /AAL2 required/);
  assert.match(staffHtml, /id="mfaGateForm"/);
  assert.match(staffHtml, /id="mfaSetupBtn"/);
  assert.match(staffJs, /afterStaffMfaVerified/);
  assert.match(staffJs, /mfaAttachCtl\.verifyOtp[\s\S]*afterStaffMfaVerified/);
  assert.doesNotMatch(staffJs, /from\("books"\)/);
  assert.strictEqual(api.isActiveStaffResult(true), true);
  assert.strictEqual(api.isActiveStaffResult(false), false);
  assert.strictEqual(api.isActiveStaffResult(null), false);
  assert.strictEqual(api.isActiveStaffResult({}), false);
  assert.strictEqual(api.isActiveStaffResult([true]), true);
  assert.throws(() => api.validateCoverFile({ type: "text/html", size: 10, name: "x.html" }));
});

add("stale staff RPC after logout cannot reopen staff UI", async () => {
  const h = loadStaffHarness();
  let user = { id: "11111111-1111-4111-8111-111111111111", email: "staff@example.com" };
  let resolveRpc;
  h.window.KutadguMember = {
    ready: Promise.resolve(),
    getUser() { return user; },
    getClient() {
      return {
        rpc() {
          return new Promise((resolve) => { resolveRpc = resolve; });
        }
      };
    },
    async signOut() { user = null; }
  };
  h.window.KutadguAdminMfa = {
    inspectAccess: async () => ({ assurance: { currentLevel: "aal2" }, classified: { configured: true } })
  };
  const routed = h.api.routeStaffSession();
  for (let i = 0; i < 40 && typeof resolveRpc !== "function"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(typeof resolveRpc, "function");
  await h.api.logoutStaff();
  assert.strictEqual(h.api.lastStaffPanel(), "staffSignedOut");
  assert.strictEqual(h.panels.staffWorkspace.hidden, true);
  assert.strictEqual(h.panels.mfaGatePanel.hidden, true);
  assert.strictEqual(h.panels.mfaEnrollPanelWrap.hidden, true);
  resolveRpc({ data: true });
  await routed;
  assert.strictEqual(h.panels.staffWorkspace.hidden, true);
  assert.strictEqual(h.panels.mfaGatePanel.hidden, true);
  assert.strictEqual(h.panels.mfaEnrollPanelWrap.hidden, true);
  assert.strictEqual(h.api.lastStaffPanel(), "staffSignedOut");
});

add("successful TOTP verification re-routes to the staff form without refresh", async () => {
  const h = loadStaffHarness();
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "staff@example.com" };
  h.window.KutadguMember = {
    ready: Promise.resolve(),
    getUser() { return user; },
    getClient() { return { rpc: async () => ({ data: true }) }; }
  };
  h.window.KutadguAdminMfa = {
    inspectAccess: async () => ({ assurance: { currentLevel: "aal2" }, classified: { configured: true } })
  };
  await h.api.afterStaffMfaVerified();
  assert.strictEqual(h.api.lastStaffPanel(), "staffWorkspace");
  assert.strictEqual(h.panels.staffWorkspace.hidden, false);
  assert.strictEqual(h.panels.mfaEnrollPanelWrap.hidden, true);
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
