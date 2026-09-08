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

test("legacy is_color_print column is kept; STAGE_COLOR_PRINT is unchanged", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_color_print boolean not null default false/i);
  assert.match(setup, /is_color_print boolean not null default false/);
  assert.doesNotMatch(sql, /DROP COLUMN.*is_color_print/i);
  assert.doesNotMatch(setup, /drop column if exists is_color_print/i);
});

test("deployed schema capability keeps is_color_print; live-detect can still hide writes", () => {
  assert.match(cfg, /is_color_print: true/);
  assert.doesNotMatch(cfg, /is_color_print: false/);
  assert.match(cfg, /STAGE_COLOR_PRINT\.sql/);
  assert.match(adminJs, /OPTIONAL_BOOK_COLS=\[[^\]]*is_color_print/);
  assert.match(adminJs, /LIVE_OPTIONAL_BOOK_COLS=\{[^}]*is_color_print:false/);
  assert.match(adminJs, /async function detectOptionalColorPrintColumn\(/);
  assert.match(adminJs, /await detectOptionalColorPrintColumn\(\)/);
  assert.match(adminJs, /function disableColorPrintColumn\(/);
  assert.match(adminJs, /function enableColorPrintColumn\(/);
});

test("Admin checkbox UI is removed; legacy boolean is not a public 3-state control", () => {
  const form = adminHtml.slice(adminHtml.indexOf('id="bookForm"'), adminHtml.indexOf('id="quickEditModal"'));
  assert.doesNotMatch(form, /id="bookIsColorPrint"/);
  assert.doesNotMatch(form, /ئىچكى بەتلىرى رەڭلىك/);
  assert.doesNotMatch(form, /data-book-col="is_color_print"/);
  const quick = adminHtml.slice(adminHtml.indexOf('id="quickEditModal"'), adminHtml.indexOf('id="bulkConfirmModal"'));
  assert.doesNotMatch(quick, /bookIsColorPrint/);
});

test("save still omits is_color_print when the optional column is unsupported", () => {
  const save = adminJs.slice(adminJs.indexOf("async function saveBook("), adminJs.indexOf("async function toggleActive("));
  assert.match(save, /if\(presentBookCols\.has\("is_color_print"\)\)row\.is_color_print=/);
  assert.match(save, /disableColorPrintColumn\(\)/);
  assert.doesNotMatch(save, /row\.price\s*\+/);
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

test("legacy is_color_print still feeds public detail; cards never show a print badge", () => {
  assert.match(shop, /isColorPrint:flag\("isColorPrint","is_color_print",false\)/);
  assert.match(shop, /function colorPrintDetailValue\(b\)\{/);
  assert.match(shop, /setDynamicMeta\("ئىچكى بېسىلىشى",colorPrintDetailValue\(b\)\)/);
  const card = shop.slice(shop.indexOf("function bookCardMarkup"), shop.indexOf("function searchResultCard"));
  const home = shop.slice(shop.indexOf("function homeFeatureCard(b){"), shop.indexOf("let homeFeaturedRequestId"));
  const carousel = shop.slice(shop.indexOf("function card(b,i=0){"), shop.indexOf("const isDual=()=>"));
  const fav = shop.slice(shop.indexOf("function favoriteCard(b){"), shop.indexOf("function homeFeatureCard(b){"));
  [card, home, carousel, fav].forEach((slice) => {
    assert.doesNotMatch(slice, /isColorPrint|is_color_print|interiorPrintType|interior_print_type|ئىچكى بېسىلىشى|رەڭلىك|رەڭسىز/);
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

if (failed) process.exit(1);
console.log("book-color-print-tests ok");
