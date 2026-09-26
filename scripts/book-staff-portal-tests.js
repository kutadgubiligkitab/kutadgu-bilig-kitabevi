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
        reset() {},
        querySelectorAll() { return []; }
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
  assert.match(accountHtml, /account\.js\?v=7/);
  assert.match(accountHtml, /member\.js\?v=28/);
  assert.match(accountHtml, /supabase-config\.js\?v=22/);
});

add("staff page is private, separate from admin, and not in public chrome", () => {
  assert.match(staffHtml, /noindex, nofollow/);
  assert.match(staffHtml, /book-staff\.js\?v=8/);
  assert.match(staffHtml, /admin-mfa\.js\?v=3/);
  assert.match(staffHtml, /member\.js\?v=28/);
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

add("Book Staff visible copy is Uyghur and cover picker stays native under the hood", () => {
  assert.doesNotMatch(staffHtml, /Authenticator/);
  assert.doesNotMatch(staffHtml, /\bTOTP\b/);
  assert.doesNotMatch(staffHtml, /\bAAL2\b/);
  assert.match(staffHtml, /دەلىللەش ئەپى كودى/);
  assert.match(staffHtml, /2-باسقۇچلۇق دەلىللەش كېرەك/);
  assert.match(staffHtml, /دەلىللەش QR كودى/);
  assert.match(staffHtml, /خەلقئارا كىتاب نومۇرى \(ISBN\)/);
  assert.match(staffHtml, /id="staffCoverPickBtn"[^>]*>مۇقاۋا رەسىمى تاللاش/);
  assert.match(staffHtml, /id="staffCoverFileName"[^>]*>رەسىم تاللانمىدى/);
  assert.match(staffHtml, /id="staffCoverFile"[^>]*type="file"/);
  assert.match(staffHtml, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(staffHtml, /book-staff\.css\?v=7/);
  assert.match(staffHtml, /book-staff\.js\?v=8/);
  assert.match(staffHtml, /kutadgu-book-entry-suggest\.js\?v=2/);
  assert.match(staffHtml, /kutadgu-book-entry-suggest\.css\?v=1/);
  assert.match(staffHtml, /بۇرۇن كىرگۈزۈلگەن ئۇچۇرلاردىن تاللىسىڭىز بولىدۇ/);
  assert.match(staffHtml, /id="staffTitleSimilarWarning"/);
  assert.match(staffHtml, /<option value="hardcover">قاتتىق مۇقاۋا<\/option>/);
  assert.match(staffHtml, /<option value="paperback">يۇمشاق مۇقاۋا<\/option>/);
  assert.match(staffHtml, /<option value="other">باشقا<\/option>/);
  assert.match(staffHtml, /<option value="A4">A4<\/option>/);
  assert.match(staffHtml, /<option value="A5">A5<\/option>/);
  assert.match(staffHtml, /<option value="B5">B5<\/option>/);
  assert.match(staffHtml, /<option value="color">رەڭلىك<\/option>/);
  assert.match(staffHtml, /<option value="bw">قارا-ئاق<\/option>/);
  assert.match(staffHtml, /مۇندەرىجە \/ ئىچكى بەت رەسىملىرى/);
  assert.match(staffHtml, /ئەڭ كۆپ 4 پارچە رەسىم تاللىغىلى بولىدۇ/);
  assert.match(staffHtml, /id="staffGalleryPickBtn"[^>]*>رەسىملەرنى تاللاش/);
  assert.match(staffHtml, /id="staffGalleryFileName"[^>]*>رەسىم تاللانمىدى/);
  assert.match(staffHtml, /id="staffGalleryFiles"[^>]*type="file"/);
  assert.match(staffHtml, /id="staffGalleryFiles"[^>]*multiple/);
  const css = read("book-staff.css");
  assert.match(css, /gap:20px/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /\.staff-form label>span\{[\s\S]*line-height:1\.7/);
  assert.match(css, /textarea\{[\s\S]*line-height:1\.8/);
  assert.match(css, /input\[type="checkbox"\]\{[\s\S]*width:22px/);
  assert.match(css, /\.staff-file-input\{/);
  assert.match(css, /clip:rect\(0,0,0,0\)/);
  assert.match(staffJs, /staffCoverFile"\)\.files/);
  const api = loadStaffApi();
  assert.doesNotMatch(api.staffVisibleCopy("Authenticator كودى"), /Authenticator/);
  assert.doesNotMatch(api.staffVisibleCopy("TOTP / AAL2"), /\bTOTP\b|\bAAL2\b/);
  const jargon = "API|MFA|TOTP|AAL2|Authenticator";
  const staffVisibleHtml = staffHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(staffVisibleHtml, new RegExp("\\b(" + jargon + ")\\b"));
  ["MFA API يوق", "دەلىللەش API يوق", "Authenticator كودى", "TOTP / AAL2"].forEach((raw) => {
    const visible = api.staffFriendlyMessage(raw);
    assert.doesNotMatch(visible, new RegExp("\\b(" + jargon + ")\\b"));
    assert.match(visible, /[\u0600-\u06FF]/);
  });
  assert.strictEqual(api.staffVisibleCopy("MFA API يوق"), "دەلىللەش مۇلازىمىتى تېپىلمىدى.");
  assert.strictEqual(api.staffFriendlyMessage("MFA API يوق"), "دەلىللەش مۇلازىمىتى تېپىلمىدى.");
  assert.strictEqual(api.staffFriendlyMessage("دەلىللەش API يوق"), "دەلىللەش مۇلازىمىتى تېپىلمىدى.");
});

add("staff runtime maps known English backend errors and hides unknown raw messages", () => {
  const api = loadStaffApi();
  const generic = api.STAFF_GENERIC_ERROR;
  assert.strictEqual(generic, "مەشغۇلات تاماملانمىدى. سەل تۇرۇپ قايتا سىناڭ.");
  const known = {
    "Authentication required": "كىرىش كېرەك. قايتا كىرىڭ.",
    "Book staff permission required": "كىتاب قوشۇش ھوقۇقى يوق.",
    "AAL2 required": "2-باسقۇچلۇق دەلىللەش كېرەك.",
    "Invalid book payload": "كىتاب ئۇچۇرى توغرا ئەمەس.",
    "Unsupported book field": "بۇ مەيدان قوللىمايدۇ.",
    "jwt expired": "كىرىش ۋاقتى توشتى. قايتا كىرىڭ.",
    "Auth session missing!": "كىرىش ۋاقتى توشتى. قايتا كىرىڭ.",
    "new row violates row-level security policy": "ھۆججەت يوللاشقا رۇخسەت يوق ياكى مەغلۇپ بولدى.",
    "Failed to fetch": "تور ئۇلىنىشى مەغلۇپ بولدى. قايتا سىناڭ."
  };
  Object.keys(known).forEach((en) => {
    assert.strictEqual(api.staffFriendlyMessage({ message: en }), known[en]);
    assert.doesNotMatch(api.staffFriendlyMessage({ message: en }), /\b(API|MFA|TOTP|AAL2|Authenticator)\b/);
  });
  const unknown = api.staffFriendlyMessage({ message: "column books.secret_token does not exist" });
  assert.strictEqual(unknown, generic);
  assert.doesNotMatch(unknown, /secret_token|column books/);
  const jwtLeak = api.staffFriendlyMessage({ message: "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb" });
  assert.strictEqual(jwtLeak, generic);
  assert.doesNotMatch(jwtLeak, /eyJ/);
  const uyghur = "رەسىم ھۆججىتى JPEG، PNG، WebP ياكى GIF بولسۇن.";
  assert.strictEqual(api.staffFriendlyMessage(uyghur), uyghur);
  assert.strictEqual(api.staffFriendlyMessage("خەلقئارا كىتاب نومۇرى (ISBN) توغرا ئەمەس."), "خەلقئارا كىتاب نومۇرى (ISBN) توغرا ئەمەس.");
  assert.match(staffJs, /setStatus\(status,staffFriendlyMessage\(err\),"error"\)/);
  assert.match(staffJs, /level!=="aal2"/);
  assert.doesNotMatch(staffJs, /CREATE TABLE|ALTER TABLE/);
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
  assert.match(staffJs, /storage\.from\(bucket\)\.upload\(path,prepared\.body,\{...prepared\.options,upsert:false\}\)/);
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

add("staff gallery is local-only until submit, max 4, and URLs stay on own gallery prefix", () => {
  const api = loadStaffApi();
  const uid = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const origin = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/";
  assert.strictEqual(api.MAX_STAFF_GALLERY, 4);
  const jpeg = { name: "toc.jpg", type: "image/jpeg", size: 12 };
  assert.strictEqual(api.addGalleryFiles([jpeg, jpeg, jpeg, jpeg]).ok, true);
  assert.strictEqual(api.galleryDraft().length, 4);
  const extra = api.addGalleryFiles([jpeg]);
  assert.strictEqual(extra.ok, false);
  assert.match(String(extra.error && extra.error.message), /ئەڭ كۆپ 4/);
  assert.strictEqual(api.galleryDraft().length, 4);
  api.removeGalleryItem(0);
  assert.strictEqual(api.galleryDraft().length, 3);
  assert.match(staffJs, /addGalleryFiles\(input\.files\)/);
  assert.match(staffJs, /uploadStaffGallery\(client,String\(user\.id\),galleryDraft/);
  assert.match(staffJs, /upsert:false/);
  assert.match(staffJs, /galleryFileExtension/);
  assert.match(staffJs, /if\(fromApi\)publicUrl=assertStaffGalleryPublicUrl\(uid,fromApi\)/);
  assert.doesNotMatch(staffJs, /urls\.push\(assertStaffGalleryPublicUrl\(uid,canonical\)\)/);
  assert.strictEqual(api.galleryFileExtension({ name: "page.exe", type: "image/jpeg", size: 12 }), "jpg");
  const jpegPath = api.staffGalleryObjectPath(uid, { name: "page.exe", type: "image/jpeg", size: 12 }, 0);
  assert.match(jpegPath, /^staff\/11111111-1111-4111-8111-111111111111\/gallery\/\d{8}-[a-z0-9]+-0\.jpg$/);
  assert.doesNotMatch(jpegPath, /\.exe$/);
  assert.match(api.staffGalleryObjectPath(uid, { name: "page.exe", type: "image/png", size: 12 }, 1), /\.png$/);
  assert.match(api.staffGalleryObjectPath(uid, { name: "page.exe", type: "image/webp", size: 12 }, 2), /\.webp$/);
  assert.match(api.staffGalleryObjectPath(uid, { name: "page.exe", type: "image/gif", size: 12 }, 3), /\.gif$/);
  assert.throws(() => api.galleryFileExtension({ name: "page.jpg", type: "image/svg+xml", size: 12 }));
  assert.throws(() => api.staffGalleryObjectPath(uid, { name: "page.PNG" }, 0));
  const path = api.staffGalleryObjectPath(uid, { name: "page.PNG", type: "image/png", size: 12 }, 0);
  assert.match(path, /^staff\/11111111-1111-4111-8111-111111111111\/gallery\/\d{8}-[a-z0-9]+-0\.png$/);
  const url = api.staffGalleryPublicUrl(uid, path);
  assert.strictEqual(api.assertStaffGalleryPublicUrl(uid, url), url);
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, origin + "staff/" + uid + "/gallery/page.exe"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, origin + "staff/" + uid + "/gallery/page.html"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, origin + "staff/" + uid + "/gallery/page.svg"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, origin + "staff/" + uid + "/gallery/noext"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(other, url));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, origin + "staff/" + uid + "/cover.jpg"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, "https://evil.example/storage/v1/object/public/book-covers/staff/" + uid + "/gallery/a.jpg"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, url + "?x=1"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, url + "#x"));
  assert.throws(() => api.assertStaffGalleryPublicUrl(uid, origin + "staff/" + uid + "/gallery/../a.jpg"));
  const ordered = [
    origin + "staff/" + uid + "/gallery/a.jpg",
    origin + "staff/" + uid + "/gallery/b.jpg"
  ];
  const payload = api.buildPayload({
    title: "Test Book",
    author: "Author",
    source: "dini.html",
    category: "دىنىي كىتابلار",
    price: "1",
    staff_uid: uid,
    gallery_images: ordered
  });
  assert.deepStrictEqual(payload.gallery_images, ordered);
  assert.throws(() => api.buildPayload({
    title: "T", author: "A", source: "dini.html", category: "دىنىي كىتابلار", price: "1",
    staff_uid: uid,
    gallery_images: [origin + "staff/" + other + "/gallery/a.jpg"]
  }));
  assert.match(staffHtml, /<option value="hardcover">قاتتىق مۇقاۋا<\/option>/);
  assert.doesNotMatch(staffJs, /\.from\("books"\)\.(insert|update|upsert|delete)/);
  assert.doesNotMatch(staffJs, /is_kutadgu_admin/);
  assert.match(staffJs, /level!=="aal2"/);
  assert.strictEqual(api.staffFriendlyMessage("gallery_images may contain at most 4 items"), "ئەڭ كۆپ 4 پارچە رەسىم تاللىغىلى بولىدۇ.");
  assert.strictEqual(api.staffFriendlyMessage("gallery_images must be book-covers staff gallery URLs for this user"), "ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
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
  assert.match(staffJs, /level!=="aal2"/);
  assert.match(staffJs, /2-باسقۇچلۇق دەلىللەش كېرەك/);
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

add("backend Stage92 already has staff RPC and AAL2; gallery lives in Stage93 SQL file", () => {
  assert.match(sql, /is_kutadgu_book_staff/);
  assert.match(sql, /submit_book_for_approval/);
  assert.match(sql, /auth\.jwt\(\)->>'aal'\) IS DISTINCT FROM 'aal2'/);
  assert.match(sql, /staff\/' \|\| v_uid::text \|\| '\//);
  assert.doesNotMatch(staffJs, /CREATE TABLE|ALTER TABLE/);
  assert.doesNotMatch(accountJs, /CREATE TABLE/);
  assert.match(read("STAGE93_BOOK_STAFF_GALLERY.sql"), /gallery_images/);
});

add("Admin MFA and pending/staff management files stay authoritative", () => {
  assert.match(read("admin-mfa.js"), /function inspectAccess/);
  assert.match(adminJs, /approve_staff_book_submission/);
  assert.match(adminJs, /add_kutadgu_book_staff/);
  assert.doesNotMatch(staffHtml, /approve_staff_book_submission/);
});

add("non-admin Admin routing cannot signOut a Book Staff member session", () => {
  const route = adminJs.match(/async function routeSession\(\)\{[\s\S]*?async function openAuthorizedDashboard/);
  assert.ok(route);
  const denyStart = route[0].indexOf("const ok=await checkAdmin(session.user);");
  const deny = route[0].slice(denyStart, route[0].indexOf("if(gen!==routeGen)return;", denyStart));
  assert.doesNotMatch(deny, /signOut/);
  assert.match(deny, /user=null/);
  assert.match(deny, /show\("loginPanel"\)/);
  assert.doesNotMatch(staffJs, /is_kutadgu_admin/);
  assert.doesNotMatch(staffJs, /admin_users/);
  assert.match(staffHtml, /href="\/account\.html"/);
  assert.match(read("book-staff.html"), /book-staff\.js\?v=8/);
});

add("Google OAuth account pins from PR 155 remain on account.html", () => {
  assert.match(accountHtml, /supabase-config\.js\?v=22/);
  assert.match(accountHtml, /member\.js\?v=28/);
  assert.match(memberJs, /auth:memberAuthOptions\(\)/);
  assert.match(memberJs, /signOut\(\{scope:"local"\}\)/);
  assert.doesNotMatch(accountJs, /exchangeCodeForSession/);
});

Promise.resolve().then(() => Promise.all(pending)).then(() => {
  if (failed) {
    console.error("\n" + failed + " book-staff portal test(s) failed");
    process.exit(1);
  }
  console.log("book-staff-portal-tests ok");
});
