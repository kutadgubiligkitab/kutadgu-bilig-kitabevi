#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const B = require("../catalog-bibliography.js");

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

const sql = read("STAGE_INTERIOR_PRINT_TYPE.sql");
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
const form = adminHtml.slice(adminHtml.indexOf('id="bookForm"'), adminHtml.indexOf('id="quickEditModal"'));
const save = adminJs.slice(adminJs.indexOf("async function saveBook("), adminJs.indexOf("async function toggleActive("));

test("1-4 Admin 3-state select sits near cover type / book size with unselected default", () => {
  assert.match(form, /id="bookCoverType"/);
  assert.match(form, /id="bookSize"/);
  const sizeAt = form.indexOf('id="bookSize"');
  const printAt = form.indexOf('id="bookInteriorPrintType"');
  assert.ok(printAt > sizeAt);
  assert.match(form, /data-book-col="interior_print_type" hidden/);
  assert.match(form, /ئىچكى بېسىلىشى/);
  assert.match(form, /\(ئىختىيارىي\)/);
  assert.match(form, /<select id="bookInteriorPrintType">/);
  assert.match(form, /<option value="">تاللانمىغان<\/option>/);
  assert.match(form, /<option value="color">رەڭلىك<\/option>/);
  assert.match(form, /<option value="bw">رەڭسىز<\/option>/);
  assert.doesNotMatch(form, /id="bookInteriorPrintType"[^>]*required/);
  assert.doesNotMatch(form, /id="bookIsColorPrint"/);
  assert.doesNotMatch(form, /ئىچكى بەتلىرى رەڭلىك/);
  assert.match(adminJs, /\$\("#bookInteriorPrintType"\)\.value=""/);
});

test("5-7 save writes color / bw / null and syncs legacy boolean only when both columns exist", () => {
  assert.match(save, /if\(presentBookCols\.has\("interior_print_type"\)\)\{/);
  assert.match(save, /row\.interior_print_type=printType\|\|null/);
  assert.match(save, /if\(presentBookCols\.has\("is_color_print"\)\)row\.is_color_print=printType==="color"/);
  assert.doesNotMatch(save, /row\.price\s*\+/);
  assert.doesNotMatch(save, /variant|sku|surcharge/i);
  const withCol = (() => {
    const present = new Set(["interior_print_type", "is_color_print"]);
    function payload(selected) {
      const row = { title: "T", price: 12 };
      if (present.has("interior_print_type")) {
        const printType = B.normalizeInteriorPrintType(selected);
        row.interior_print_type = printType || null;
        if (present.has("is_color_print")) row.is_color_print = printType === "color";
      }
      return row;
    }
    return {
      color: payload("color"),
      bw: payload("bw"),
      unset: payload("")
    };
  })();
  assert.strictEqual(withCol.color.interior_print_type, "color");
  assert.strictEqual(withCol.color.is_color_print, true);
  assert.strictEqual(withCol.color.price, 12);
  assert.strictEqual(withCol.bw.interior_print_type, "bw");
  assert.strictEqual(withCol.bw.is_color_print, false);
  assert.strictEqual(withCol.unset.interior_print_type, null);
  assert.strictEqual(withCol.unset.is_color_print, false);
});

test("8-12 edit hydration: color, bw, null, legacy true→color, legacy false stays unselected", () => {
  assert.match(adminJs, /Bib\.resolveInteriorPrintType/);
  assert.strictEqual(B.resolveInteriorPrintType({ interior_print_type: "color" }), "color");
  assert.strictEqual(B.interiorPrintTypeLabel("color"), "رەڭلىك");
  assert.strictEqual(B.resolveInteriorPrintType({ interior_print_type: "bw" }), "bw");
  assert.strictEqual(B.interiorPrintTypeLabel("bw"), "رەڭسىز");
  assert.strictEqual(B.resolveInteriorPrintType({ interior_print_type: null }), null);
  assert.strictEqual(B.resolveInteriorPrintType({}), null);
  assert.strictEqual(B.resolveInteriorPrintType({ is_color_print: true }), "color");
  assert.strictEqual(B.resolveInteriorPrintType({ is_color_print: false }), null);
  assert.strictEqual(B.resolveInteriorPrintType({ isColorPrint: true }), "color");
  assert.strictEqual(B.resolveInteriorPrintType({ interior_print_type: "bw", is_color_print: true }), "bw");
  assert.strictEqual(B.normalizeInteriorPrintType(""), null);
  assert.strictEqual(B.normalizeInteriorPrintType("colour"), "color");
});

test("13-15 public detail color/bw/null labels", () => {
  assert.strictEqual(B.interiorPrintDetailValue({ interior_print_type: "color" }), "رەڭلىك");
  assert.strictEqual(B.interiorPrintDetailValue({ interior_print_type: "bw" }), "رەڭسىز");
  assert.strictEqual(B.interiorPrintDetailValue({ interior_print_type: null }), "");
  assert.strictEqual(B.interiorPrintDetailValue({ is_color_print: true }), "رەڭلىك");
  assert.strictEqual(B.interiorPrintDetailValue({ is_color_print: false }), "");
  assert.match(shop, /setDynamicMeta\("ئىچكى بېسىلىشى",colorPrintDetailValue\(b\)\)/);
  assert.match(shop, /lib\.interiorPrintDetailValue/);
});

test("16 listing/home/favorites cards do not gain a print badge", () => {
  const card = shop.slice(shop.indexOf("function bookCardMarkup"), shop.indexOf("function searchResultCard"));
  const home = shop.slice(shop.indexOf("function homeFeatureCard(b){"), shop.indexOf("let homeFeaturedRequestId"));
  const carousel = shop.slice(shop.indexOf("function card(b,i=0){"), shop.indexOf("const isDual=()=>"));
  const fav = shop.slice(shop.indexOf("function favoriteCard(b){"), shop.indexOf("function homeFeatureCard(b){"));
  [card, home, carousel, fav].forEach((slice) => {
    assert.doesNotMatch(slice, /interiorPrintType|interior_print_type|ئىچكى بېسىلىشى|رەڭلىك|رەڭسىز/);
  });
});

test("17 missing interior_print_type column does not break Admin/catalog", () => {
  assert.match(cfg, /interior_print_type: false/);
  assert.match(cfg, /STAGE_INTERIOR_PRINT_TYPE\.sql/);
  assert.match(adminJs, /OPTIONAL_BOOK_COLS=\[[^\]]*interior_print_type/);
  assert.match(adminJs, /LIVE_OPTIONAL_BOOK_COLS=\{[^}]*interior_print_type:false/);
  assert.match(adminJs, /async function detectOptionalInteriorPrintTypeColumn\(/);
  assert.match(adminJs, /await detectOptionalInteriorPrintTypeColumn\(\)/);
  assert.match(adminJs, /function enableInteriorPrintTypeColumn\(/);
  assert.match(adminJs, /spec\.optionalColumns\.interior_print_type=true/);
  assert.match(adminJs, /function disableInteriorPrintTypeColumn\(/);
  assert.match(save, /disableInteriorPrintTypeColumn\(\)/);
  assert.match(save, /delete payload\.interior_print_type/);
  assert.match(shop, /params=new URLSearchParams\(\{select:"\*"\}\)/);
  const omit = (() => {
    const OPTIONAL_BOOK_COLS = ["interior_print_type", "is_color_print", "stock"];
    const presentBookCols = new Set(["is_color_print"]);
    const row = { title: "T", interior_print_type: "color", is_color_print: true, price: 10 };
    const out = {};
    Object.keys(row).forEach((key) => {
      if (OPTIONAL_BOOK_COLS.includes(key) && !presentBookCols.has(key)) return;
      out[key] = row[key];
    });
    return out;
  })();
  assert.strictEqual(omit.title, "T");
  assert.ok(!Object.prototype.hasOwnProperty.call(omit, "interior_print_type"));
});

test("18 stock/cart/order/auth remain untouched; old boolean is not deleted", () => {
  assert.match(setup, /is_color_print boolean not null default false/);
  assert.doesNotMatch(sql, /drop column.*is_color_print/i);
  assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|\bGRANT\b|\bREVOKE\b/i);
  assert.doesNotMatch(stage80, /interior_print_type/);
  assert.doesNotMatch(stage82, /interior_print_type/);
  assert.doesNotMatch(stage83, /interior_print_type/);
  assert.doesNotMatch(mfaJs, /interior_print_type/);
  assert.doesNotMatch(idleJs, /interior_print_type/);
  assert.doesNotMatch(heroJs, /interior_print_type/);
  assert.doesNotMatch(stockJs, /interior_print_type/);
  const add = shop.slice(shop.indexOf("function add(id,qty=1){"), shop.indexOf("function remove(id){"));
  assert.doesNotMatch(add, /interiorPrintType|interior_print_type/);
  assert.doesNotMatch(adminJs, /OPTIONAL_COL_ALIASES=\{[^}]*interior_print_type/);
});

test("migration is repeat-safe, CHECK-constrained, and backfills only true→color", () => {
  assert.match(sql, /Supabase > SQL Editor/);
  assert.match(sql, /ئاگېنت ئىجرا قىلمايدۇ/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS interior_print_type text/i);
  assert.match(sql, /drop constraint if exists books_interior_print_type_chk/i);
  assert.match(sql, /interior_print_type is null/);
  assert.match(sql, /interior_print_type in \('color', 'bw'\)/);
  assert.match(sql, /SET interior_print_type = 'color'/i);
  assert.match(sql, /WHERE is_color_print = true/i);
  assert.match(sql, /AND interior_print_type IS NULL/i);
  assert.doesNotMatch(sql, /SET interior_print_type = 'bw'/i);
  assert.match(setup, /interior_print_type text/);
  assert.match(setup, /add column if not exists interior_print_type text/i);
  assert.doesNotMatch(setup, /SET interior_print_type = 'color'/i);
});

test("cache pins bumped for Admin, homepage, and book-shell", () => {
  assert.match(adminHtml, /admin\.js\?v=67/);
  assert.match(adminHtml, /supabase-config\.js\?v=20/);
  assert.match(adminHtml, /catalog-bibliography\.js\?v=3/);
  assert.match(read("index.html"), /shop\.js\?v=121/);
  assert.match(read("index.html"), /supabase-config\.js\?v=20/);
  assert.match(read("book-shell.html"), /shop\.js\?v=119/);
  assert.match(read("book-shell.html"), /catalog-bibliography\.js\?v=3/);
});

if (failed) process.exit(1);
console.log("book-interior-print-type-tests ok");
