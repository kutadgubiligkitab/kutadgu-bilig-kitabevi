#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "cart.html"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
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

test("cart.html initial host has no sample/demo book cover images", () => {
  const host = sliceBetween(html, 'id="cartItems"', 'id="cartAside"');
  assert.doesNotMatch(host, /sample-book-cover\.png/);
  assert.doesNotMatch(host, /<img\b/i);
  assert.match(html, /id="cartItems"[^>]*aria-busy="true"/);
});

test("static shell does not paint cart books before remote catalog hydrate", () => {
  const shell = sliceBetween(shop, "function initStaticShell()", "function init()");
  assert.doesNotMatch(shell, /cartPage\(\)/);
  assert.match(shell, /paintCartBootState\(\)/);
  assert.match(shop, /function cartWaitingForRemoteBooks\(\)/);
  assert.match(shop, /function showCartBootSkeleton\(/);
  assert.match(shop, /cart-item is-skeleton/);
  assert.doesNotMatch(sliceBetween(shop, "function cartItemSkeletonMarkup()", "function showCartBootSkeleton"), /sample-book-cover/);
  assert.doesNotMatch(sliceBetween(shop, "function cartItemSkeletonMarkup()", "function showCartBootSkeleton"), /<img\b/i);
  const boot = sliceBetween(shop, "async function boot()", "window.kutadguShop=");
  assert.match(boot, /initStaticShell\(\);\n  await loadRemoteCatalog\(\)/);
  assert.match(boot, /await hydrateBooksByIds/);
  assert.match(boot, /markCatalogBootSettled\(\)/);
  const settledAt = boot.indexOf("markCatalogBootSettled()");
  const lastHydrate = boot.lastIndexOf("hydrateBooksByIds");
  assert.ok(lastHydrate >= 0 && settledAt > lastHydrate, "settle after cart id hydrate");
  const init = sliceBetween(shop, "function init()", "let bootStarted=false");
  assert.match(init, /cartPage\(\)/);
});

test("cart boot helpers do not change persistence keys or WhatsApp builders", () => {
  assert.match(shop, /const CART_KEY="kutadgu-cart-v1"/);
  assert.match(shop, /function buildOrderText/);
  assert.match(shop, /function changeQty/);
  assert.match(shop, /function paintCartBootState/);
});

test("sample-book-cover.png file is kept on disk", () => {
  assert.ok(fs.existsSync(path.join(root, "sample-book-cover.png")));
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("cart-page-boot-tests ok");
