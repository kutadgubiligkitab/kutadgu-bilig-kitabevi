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

const sql = read("STAGE_COLOR_PRINT.sql");
const setup = read("SUPABASE_SETUP.sql");
const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const shop = read("shop.js");
const cfg = read("supabase-config.js");
const stage80 = read("STAGE80_MEMBER_ORDER_INTEGRITY.sql");
const stage82 = read("STAGE82_STOCK_FOUNDATION.sql");
const stage83 = read("STAGE83_STOCK_ENFORCEMENT.sql");
const mfaJs = read("admin-mfa.js");
const idleJs = read("admin-idle.js");
const heroJs = read("admin-hero.js");
const stockJs = read("kutadgu-stock.js");

test("migration adds boolean is_color_print default false, no row rewrites, no RLS", () => {
  assert.match(sql, /Supabase > SQL Editor/);
  assert.match(sql, /ئاگېنت ئىجرا قىلمايدۇ/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_color_print boolean not null default false/i);
  const body = sql.slice(sql.indexOf("begin;"), sql.indexOf("commit;") + 7);
  assert.doesNotMatch(body, /\bUPDATE\b/i);
  assert.doesNotMatch(body, /\bINSERT\b/i);
  assert.doesNotMatch(body, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /DROP POLICY/i);
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(sql, /\bGRANT\b/i);
  assert.doesNotMatch(sql, /\bREVOKE\b/i);
  assert.doesNotMatch(sql, /\bprice\b/i);
  assert.doesNotMatch(sql, /\bstock\b/i);
  assert.match(setup, /is_color_print boolean not null default false/);
  assert.match(setup, /add column if not exists is_color_print boolean not null default false/i);
});

test("deployed schema capability enables is_color_print; live-detect can still hide it", () => {
  assert.match(cfg, /is_color_print: true/);
  assert.doesNotMatch(cfg, /is_color_print: false/);
  assert.match(cfg, /STAGE_COLOR_PRINT\.sql/);
  assert.match(adminJs, /OPTIONAL_BOOK_COLS=\[[^\]]*is_color_print/);
  assert.match(adminJs, /LIVE_OPTIONAL_BOOK_COLS=\{[^}]*is_color_print:false/);
  assert.match(adminJs, /async function detectOptionalColorPrintColumn\(/);
  assert.match(adminJs, /await detectOptionalColorPrintColumn\(\)/);
  assert.match(adminJs, /function disableColorPrintColumn\(/);
  assert.match(adminJs, /function enableColorPrintColumn\(/);
  assert.match(adminJs, /if\(presentBookCols\.has\("is_color_print"\)\)row\.is_color_print=/);
  assert.match(adminJs, /OPTIONAL_BOOK_COLS\.includes\(key\)&&!presentBookCols\.has\(key\)/);
  const mergeVisible = (() => {
    const LIVE = { is_color_print: false };
    const spec = { optionalColumns: { is_color_print: true } };
    const optional = { ...LIVE, ...(spec.optionalColumns || {}) };
    const present = new Set();
    ["is_color_print"].forEach((col) => { if (optional[col] !== false) present.add(col); });
    return present.has("is_color_print");
  })();
  assert.strictEqual(mergeVisible, true);
  const mergeHidden = (() => {
    const LIVE = { is_color_print: false };
    const spec = { optionalColumns: { is_color_print: false } };
    const optional = { ...LIVE, ...(spec.optionalColumns || {}) };
    const present = new Set();
    ["is_color_print"].forEach((col) => { if (optional[col] !== false) present.add(col); });
    return present.has("is_color_print");
  })();
  assert.strictEqual(mergeHidden, false);
});

test("Admin checkbox is optional, Uyghur labeled, no رەڭسىز option", () => {
  const form = adminHtml.slice(adminHtml.indexOf('id="bookForm"'), adminHtml.indexOf('id="quickEditModal"'));
  assert.match(form, /id="bookIsColorPrint"/);
  assert.match(form, /<input id="bookIsColorPrint" type="checkbox">/);
  assert.match(form, /data-book-col="is_color_print"/);
  assert.match(form, /ئىچكى بەتلىرى رەڭلىك/);
  assert.match(form, /پەقەت رەڭلىك نەشر بولسا تاللاڭ\. تاللانمىسا توربەتتە بۇ ھەقتە خەت كۆرۈنمەيدۇ\./);
  assert.doesNotMatch(form, /id="bookIsColorPrint"[^>]*required/);
  assert.doesNotMatch(form, /رەڭسىز/);
  assert.doesNotMatch(form, /<select[^>]*bookIsColorPrint/);
  const quick = adminHtml.slice(adminHtml.indexOf('id="quickEditModal"'), adminHtml.indexOf('id="bulkConfirmModal"'));
  assert.doesNotMatch(quick, /bookIsColorPrint/);
});

test("new form defaults unchecked and edit hydrates only === true", () => {
  assert.match(adminJs, /\$\("#bookIsColorPrint"\)\.checked=false/);
  assert.match(adminJs, /\$\("#bookIsColorPrint"\)\.checked=b\.is_color_print===true/);
});

test("save payload still writes existing core flags and omits color when unsupported", () => {
  const save = adminJs.slice(adminJs.indexOf("async function saveBook("), adminJs.indexOf("async function toggleActive("));
  assert.match(save, /is_active:\$\("#bookIsActive"\)\.checked/);
  assert.match(save, /is_new:\$\("#bookIsNew"\)\.checked/);
  assert.match(save, /is_recommended:\$\("#bookIsRecommended"\)\.checked/);
  assert.match(save, /if\(presentBookCols\.has\("is_color_print"\)\)row\.is_color_print=/);
  assert.match(save, /disableColorPrintColumn\(\)/);
  assert.doesNotMatch(save, /row\.price\s*\+/);
  assert.doesNotMatch(save, /color.*surcharge|surcharge/i);
  const omit = (() => {
    const OPTIONAL_BOOK_COLS = ["is_color_print", "stock"];
    const presentBookCols = new Set();
    const row = { title: "T", is_color_print: true, is_new: false, price: 10 };
    const out = {};
    Object.keys(row).forEach((key) => {
      if (OPTIONAL_BOOK_COLS.includes(key) && !presentBookCols.has(key)) return;
      out[key] = row[key];
    });
    return out;
  })();
  assert.strictEqual(omit.title, "T");
  assert.strictEqual(omit.is_new, false);
  assert.strictEqual(omit.price, 10);
  assert.ok(!Object.prototype.hasOwnProperty.call(omit, "is_color_print"));
});

test("public catalog uses select * so a missing column cannot fail the listing query", () => {
  assert.match(shop, /function remoteBooksUrl\(input=\{\}\)\{/);
  assert.match(shop, /params=new URLSearchParams\(\{select:"\*"\}\)/);
});

test("public detail shows رەڭلىك only when true; cards never show color print", () => {
  assert.match(shop, /isColorPrint:flag\("isColorPrint","is_color_print",false\)/);
  assert.match(shop, /function colorPrintDetailValue\(b\)\{/);
  assert.match(shop, /setDynamicMeta\("ئىچكى بېسىلىشى",colorPrintDetailValue\(b\)\)/);
  assert.doesNotMatch(shop, /رەڭسىز/);
  const card = shop.slice(shop.indexOf("function bookCardMarkup"), shop.indexOf("function searchResultCard"));
  const home = shop.slice(shop.indexOf("function homeFeatureCard(b){"), shop.indexOf("let homeFeaturedRequestId"));
  const carousel = shop.slice(shop.indexOf("function card(b,i=0){"), shop.indexOf("const isDual=()=>"));
  [card, home, carousel].forEach((slice) => {
    assert.doesNotMatch(slice, /isColorPrint|is_color_print|ئىچكى بېسىلىشى|رەڭلىك/);
  });
});

test("stock, cart, order, auth, hero, and routes stay untouched by this flag", () => {
  assert.doesNotMatch(sql, /create_member_order/i);
  assert.doesNotMatch(stage80, /is_color_print/);
  assert.doesNotMatch(stage82, /is_color_print/);
  assert.doesNotMatch(stage83, /is_color_print/);
  assert.doesNotMatch(mfaJs, /is_color_print/);
  assert.doesNotMatch(idleJs, /is_color_print/);
  assert.doesNotMatch(heroJs, /is_color_print/);
  assert.doesNotMatch(stockJs, /is_color_print/);
  assert.doesNotMatch(adminJs, /from\("orders"\).*is_color_print/);
  const add = shop.slice(shop.indexOf("function add(id,qty=1){"), shop.indexOf("function remove(id){"));
  assert.doesNotMatch(add, /isColorPrint|is_color_print/);
});

test("import does not require is_color_print", () => {
  assert.doesNotMatch(adminJs, /OPTIONAL_COL_ALIASES=\{[^}]*is_color_print/);
  const insert = adminJs.slice(adminJs.indexOf("function rowToInsert(row,id){"), adminJs.indexOf("function rowToUpdate"));
  assert.doesNotMatch(insert, /is_color_print/);
});

test("cache pins bumped with Admin and book-detail shop.js", () => {
  assert.match(adminHtml, /admin\.js\?v=66/);
  assert.match(adminHtml, /supabase-config\.js\?v=19/);
  assert.match(read("index.html"), /shop\.js\?v=120/);
  assert.match(read("book-shell.html"), /shop\.js\?v=118/);
});

if (failed) process.exit(1);
console.log("book-color-print-tests ok");
