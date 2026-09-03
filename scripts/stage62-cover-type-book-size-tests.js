#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const B = require("../catalog-bibliography.js");
const Prod = require("../admin-catalog-productivity.js");

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

const sql = read("STAGE62_COVER_TYPE_BOOK_SIZE.sql");
const setup = read("SUPABASE_SETUP.sql");
const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const shop = read("shop.js");
const cfg = read("supabase-config.js");
const prodJs = read("admin-catalog-productivity.js");
const stage2b = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");
const stage2c = read("STAGE2C_AAL2_BOOKS_WRITE_RLS.sql");
const resetJs = read("reset-password.js");
const mfaJs = read("admin-mfa.js");
const idleJs = read("admin-idle.js");
const oauthJs = read("supabase-config.js");

test("fresh-install SQL includes nullable cover_type and book_size", () => {
  assert.match(setup, /cover_type text,/);
  assert.match(setup, /book_size text,/);
  assert.match(setup, /add column if not exists cover_type text;/);
  assert.match(setup, /add column if not exists book_size text;/);
  assert.match(setup, /alter column cover_type drop not null/);
  assert.doesNotMatch(setup, /cover_type text not null default ''/);
});

test("STAGE62 is manual reviewed SQL with no book row rewrites", () => {
  assert.match(sql, /Supabase > SQL Editor/);
  assert.match(sql, /ئاگېنت ئىجرا قىلمايدۇ/);
  const body = sql.slice(sql.indexOf("begin;"), sql.indexOf("commit;") + 7);
  assert.doesNotMatch(body, /\bUPDATE\b/i);
  assert.doesNotMatch(body, /\bINSERT\b/i);
  assert.doesNotMatch(body, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DROP POLICY/i);
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(body, /is_kutadgu_admin\s*\(/);
});

test("CHECK constraints allow NULL and only canonical stored values", () => {
  assert.match(sql, /cover_type is null/);
  assert.match(sql, /cover_type in \('hardcover', 'paperback', 'other'\)/);
  assert.match(sql, /book_size is null/);
  assert.match(sql, /book_size in \('A4', 'A5', 'B5', 'other'\)/);
  assert.match(setup, /cover_type in \('hardcover', 'paperback', 'other'\)/);
  assert.match(setup, /book_size in \('A4', 'A5', 'B5', 'other'\)/);
});

test("STAGE62 does not weaken RLS/AAL2 SQL files", () => {
  assert.match(stage2b, /public can read active books/);
  assert.match(stage2c, /aal2 required to update books/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /DROP POLICY/i);
});

test("Admin create form has optional cover type and book size selects", () => {
  assert.match(adminHtml, /id="bookCoverType"/);
  assert.match(adminHtml, /id="bookSize"/);
  assert.match(adminHtml, /data-book-col="cover_type"/);
  assert.match(adminHtml, /data-book-col="book_size"/);
  assert.match(adminHtml, /<option value="">تاللانمىغان<\/option>/);
  assert.match(adminHtml, /<option value="hardcover">قاتتىق مۇقاۋىلىق<\/option>/);
  assert.match(adminHtml, /<option value="paperback">يۇمشاق مۇقاۋىلىق<\/option>/);
  assert.match(adminHtml, /<option value="other">باشقا<\/option>/);
  assert.match(adminHtml, /<option value="A4">A4<\/option>/);
  assert.match(adminHtml, /<option value="A5">A5<\/option>/);
  assert.match(adminHtml, /<option value="B5">B5<\/option>/);
  assert.doesNotMatch(adminHtml, /id="bookDimensions"/);
  const form = adminHtml.slice(adminHtml.indexOf('id="bookForm"'), adminHtml.indexOf('id="quickEditModal"'));
  assert.doesNotMatch(form, /eni-boy|ئېنى-بوي/);
  assert.doesNotMatch(form, /placeholder="مەسىلەن 14/);
});

test("Admin save payload persists canonical cover_type and book_size", () => {
  assert.match(adminJs, /canonicalOptionalForSave/);
  assert.match(adminJs, /row\.cover_type=coverPlan\.value/);
  assert.match(adminJs, /row\.book_size=sizePlan\.value/);
  assert.doesNotMatch(adminJs, /bookDimensions/);
  assert.match(adminJs, /LIVE_OPTIONAL_BOOK_COLS=\{[^}]*cover_type:true/);
  assert.match(adminJs, /book_size:true/);
  assert.match(cfg, /cover_type: true/);
  assert.match(cfg, /book_size: true/);
  assert.match(cfg, /dimensions: false/);
});

test("edit form loads stored values and blanks remain valid", () => {
  assert.match(adminJs, /normalizeCoverType\(b\.cover_type\)/);
  assert.match(adminJs, /normalizeBookSize\(b\.book_size\)/);
  assert.match(adminJs, /\$\("#bookCoverType"\)\.value=""/);
  assert.match(adminJs, /\$\("#bookSize"\)\.value=""/);
});

test("blank select on edit with a stored canonical value writes null (explicit clear)", () => {
  const keep = B.canonicalOptionalForSave("", "hardcover", true, B.normalizeCoverType);
  assert.deepStrictEqual(keep, { include: true, value: null });
  const preserveUnknown = B.canonicalOptionalForSave("", "weird", true, B.normalizeCoverType);
  assert.strictEqual(preserveUnknown.include, false);
  const write = B.canonicalOptionalForSave("paperback", "hardcover", true, B.normalizeCoverType);
  assert.deepStrictEqual(write, { include: true, value: "paperback" });
});

test("writeBookRow keeps cover fields when present and drops them when optional is off", () => {
  const keep = (() => {
    const OPTIONAL_BOOK_COLS = ["cover_type", "book_size", "dimensions"];
    const presentBookCols = new Set(["cover_type", "book_size"]);
    const row = { title: "T", cover_type: "hardcover", book_size: "A5", dimensions: "14x21", price: 1 };
    const out = {};
    Object.keys(row).forEach((key) => {
      if (OPTIONAL_BOOK_COLS.includes(key) && !presentBookCols.has(key)) return;
      out[key] = row[key];
    });
    return out;
  })();
  assert.strictEqual(keep.cover_type, "hardcover");
  assert.strictEqual(keep.book_size, "A5");
  assert.ok(!Object.prototype.hasOwnProperty.call(keep, "dimensions"));
});

test("Quick Edit and Bulk Edit were intentionally left unchanged", () => {
  assert.deepStrictEqual(Prod.ALLOWED_BULK_ACTIONS, [
    "category", "stock_status", "stock", "publisher",
    "recommended_on", "recommended_off", "new_on", "new_off", "activate", "deactivate"
  ]);
  const quickFields = prodJs.match(/const QUICK_EDIT_FIELDS=\[[^\]]+\]/)[0];
  assert.doesNotMatch(quickFields, /cover_type|book_size/);
  const bulk = prodJs.match(/const ALLOWED_BULK_ACTIONS=\[[^\]]+\]/)[0];
  assert.doesNotMatch(bulk, /cover_type|book_size/);
  const quickHtml = adminHtml.slice(adminHtml.indexOf('id="quickEditModal"'), adminHtml.indexOf('id="bulkConfirmModal"'));
  assert.doesNotMatch(quickHtml, /bookCoverType|bookSize/);
});

test("import does not require new columns and can map them when present", () => {
  assert.match(adminJs, /mapCanonicalImportField/);
  assert.match(adminJs, /if\(coverMap\.present\)mapped\.cover_type=coverMap\.value/);
  assert.match(adminJs, /hasOwnProperty\.call\(row,"cover_type"\)/);
  assert.match(adminJs, /hasOwnProperty\.call\(row,"book_size"\)/);
});

test("storefront detail shows labels when present and hides empty rows", () => {
  assert.match(shop, /setDynamicMeta\("مۇقاۋا تۈرى"/);
  assert.match(shop, /setDynamicMeta\("كىتاب ئۆلچىمى"/);
  assert.match(shop, /setDynamicMeta\("تەرجىمە قىلغۇچى"/);
  assert.doesNotMatch(shop, /setDynamicMeta\("تەرجىمانى"/);
  assert.match(shop, /bookSize:\(bibliographicLib\(\)\.normalizeBookSize/);
  assert.doesNotMatch(shop, /value\("dimensions","book_size"/);
  const card = shop.slice(shop.indexOf("function bookCardMarkup"), shop.indexOf("function searchResultCard"));
  assert.doesNotMatch(card, /coverType|bookSize|مۇقاۋا تۈرى|كىتاب ئۆلچىمى/);
});

test("auth MFA idle lock password reset OAuth files are unchanged by this feature", () => {
  assert.doesNotMatch(resetJs, /cover_type|book_size/);
  assert.doesNotMatch(mfaJs, /cover_type|book_size/);
  assert.doesNotMatch(idleJs, /cover_type|book_size/);
  assert.match(oauthJs, /kutadguIsGenericOauthHash/);
});

test("book.html loads catalog-bibliography before shop.js", () => {
  const bookHtml = read("book.html");
  const bib = bookHtml.indexOf("catalog-bibliography.js?v=2");
  const shop = bookHtml.indexOf("shop.js?v=86");
  assert.ok(bib > 0 && shop > bib);
});

test("Admin cache pins include bibliography v=2 and admin.js v=46", () => {
  assert.match(adminHtml, /catalog-bibliography\.js\?v=2/);
  assert.match(adminHtml, /admin\.js\?v=46/);
  assert.match(adminHtml, /admin\.css\?v=29/);
  assert.match(adminHtml, /تەرجىمە قىلغۇچى/);
  assert.doesNotMatch(adminHtml, /<span>تەرجىمانى /);
  assert.doesNotMatch(adminHtml, /ئىزدەش ۋە مەزمۇن سۈزگۈچلىرى Database تەرەپتە ئېلىپ بېرىلىدۇ/);
  assert.match(adminHtml, /id="adminSearch"[^>]*type="text"/);
  assert.match(adminHtml, /id="adminSearch"[^>]*dir="rtl"/);
  assert.match(adminHtml, /placeholder="ئاپتور، تەرجىمە قىلغۇچى، نەشرىيات ياكى كىتاب نامى"/);
  assert.match(adminJs, /search\.placeholder="ئاپتور، تەرجىمە قىلغۇچى، نەشرىيات ياكى كىتاب نامى"/);
  assert.match(adminJs, /search\.dir="rtl"/);
  assert.match(adminJs, /if\(field\.id==="adminSearch"\)/);
});

if (failed) process.exit(1);
console.log("stage62-cover-type-book-size-tests ok");
