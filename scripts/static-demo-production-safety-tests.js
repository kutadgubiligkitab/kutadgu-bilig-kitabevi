#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const V = require("../catalog-visibility.js");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const catalog = fs.readFileSync(path.join(root, "catalog.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const bookHtml = fs.readFileSync(path.join(root, "book.html"), "utf8");
const romanlar2 = fs.readFileSync(path.join(root, "romanlar-2.html"), "utf8");

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
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

test("static catalog still contains romanlar-2 fixture and is not deleted", () => {
  assert.match(catalog, /"id": "romanlar-2"/);
  assert.match(catalog, /رومان كىتابى 2/);
  assert.ok(fs.existsSync(path.join(root, "romanlar-2.html")));
  assert.ok(fs.existsSync(path.join(root, "sample-book-cover.png")));
  assert.ok(fs.existsSync(path.join(root, "catalog.js")));
});

test("production authority requires remote canonical books", () => {
  const demo = { id: "romanlar-2", isActive: true, isRemote: false, price: 200, image: "sample-book-cover.png" };
  assert.strictEqual(V.isStorefrontVisible(demo, { requireRemoteAuthority: true }), false);
  assert.strictEqual(V.isStorefrontVisible(demo, { remoteAvailable: true }), false);
  const real = { id: "123", isActive: true, isRemote: true };
  assert.strictEqual(V.isStorefrontVisible(real, { requireRemoteAuthority: true, remoteAvailable: true, inactiveKeys: new Set() }), true);
});

test("shop.js fails closed for static demo on production or remote-available storefronts", () => {
  assert.match(shop, /function requiresRemoteProductAuthority\(\)\{/);
  assert.match(shop, /KUTADGU_REQUIRE_REMOTE_PRODUCT_AUTHORITY/);
  assert.match(shop, /function paintUnauthorizedDetail\(\)\{/);
  assert.match(shop, /function pruneUnauthorizedLocalShopItems\(\)\{/);
  assert.match(shop, /function isUnauthorizedStaticDemoId\(id\)\{/);
  const add = sliceBetween(shop, "function add(id,qty=1){", "function remove(id){");
  assert.match(add, /if\(!isStorefrontVisible\(b\)\)\{toast\("بۇ كىتاب ھازىرچە تەمىنلەنمەيدۇ"\)/);
  const fav = sliceBetween(shop, "function toggleFav(id){", "function recent(id){");
  assert.match(fav, /isStorefrontVisible/);
  const order = sliceBetween(shop, "function buildOrderText(requireCustomer=true){", "function getOrBuildOrder(requireCustomer=true){");
  assert.match(order, /if\(items\.some\(x=>!isStorefrontVisible\(x\.b\)\)\)/);
  const prune = sliceBetween(shop, "function pruneUnauthorizedLocalShopItems(){", "function rebuildVisibleCatalog(){");
  assert.doesNotMatch(prune, /syncKey/);
});

test("unauthorized static detail does not keep fake price or add-to-cart chrome", () => {
  const paint = sliceBetween(shop, "function paintUnauthorizedDetail(){", "function decorateDetail(){");
  assert.match(paint, /applyUnresolvedDetailDocument/);
  assert.match(paint, /detail-unavailable-panel/);
  assert.match(paint, /\.detail-price,\.add-to-cart,\.favorite-button,\.share-button/);
  const decorate = sliceBetween(shop, "function decorateDetail(){", "function bindDynamicActions(");
  assert.match(decorate, /paintUnauthorizedDetail\(\)/);
  assert.match(decorate, /b\.isRemote!==true/);
  const cover = sliceBetween(shop, "function applyDetailCoverFallback(){", "function decorateCards(){");
  assert.match(cover, /if\(!book\|\|!isStorefrontVisible\(book\)\)\{/);
  const populate = sliceBetween(shop, "function populateDynamicBookPage(b){", "const DETAIL_RELATED_LIMIT=4;");
  assert.match(populate, /allowStaticFixture=!requiresRemoteProductAuthority\(\)/);
});

test("future legacy mapping still indexes remote legacy_id onto the canonical book", () => {
  const index = sliceBetween(shop, "function indexCatalogBook(book){", "function persistedAliases(){");
  assert.match(index, /catalogCache\.set\(String\(book\.legacyId\),book\)/);
  const remoteUrl = sliceBetween(shop, "function remoteBooksUrl(input={}){", "async function fetchRemotePage(input={},options={}){");
  assert.match(remoteUrl, /legacy_id\.in\./);
});

test("static fixture detail HTML first paint is a neutral shell, not a sellable product", () => {
  const files = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
  const checked = [];
  for (const name of files) {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    const idMatch = html.match(/data-book-id="([^"]+)"/);
    if (!idMatch || /^\d+$/.test(idMatch[1].trim())) continue;
    if (!html.includes("book-detail-page")) continue;
    checked.push(name);
    assert.match(html, /data-dynamic-book="1"/, name);
    assert.match(html, /data-static-detail-shell="1"/, name);
    assert.doesNotMatch(html, /add-to-cart/, name);
    assert.doesNotMatch(html, /favorite-button/, name);
    assert.doesNotMatch(html, /share-button/, name);
    assert.doesNotMatch(html, /sample-book-cover\.png/, name);
    assert.doesNotMatch(html, /\d[\d\s]*₺/, name);
    assert.doesNotMatch(html, /رومان كىتابى 2/, name);
    assert.doesNotMatch(html, /ئاپتور ئىسمى/, name);
  }
  assert.ok(checked.includes("romanlar-2.html"));
  assert.ok(checked.includes("ozumuzni-etirap-qilayli.html"));
  assert.ok(checked.length >= 80, "expected the class of static detail fixtures, got " + checked.length);
  assert.match(romanlar2, /data-book-id="romanlar-2"/);
  assert.match(romanlar2, /<h1>كىتاب<\/h1>/);
});

test("pins use shop.js v=106 and catalog-visibility.js v=3", () => {
  assert.match(indexHtml, /shop\.js\?v=106/);
  assert.match(indexHtml, /catalog-visibility\.js\?v=3/);
  assert.match(bookHtml, /shop\.js\?v=106/);
  assert.match(bookHtml, /catalog-visibility\.js\?v=3/);
  assert.match(romanlar2, /shop\.js\?v=106/);
  assert.match(shop, /member\.js\?v=25/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("All static demo production-safety tests passed");
