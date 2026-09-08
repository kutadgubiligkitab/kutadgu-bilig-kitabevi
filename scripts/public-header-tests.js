#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const header = require(path.join(root, "public-header.js"));
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const mobile = fs.readFileSync(path.join(root, "mobile.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public-header.css"), "utf8");
const bookShell = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const accountHtml = fs.readFileSync(path.join(root, "account.html"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");
const favHtml = fs.readFileSync(path.join(root, "favorites.html"), "utf8");
const diniHtml = fs.readFileSync(path.join(root, "dini.html"), "utf8");

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

test("cart favorites account and home are root-safe", () => {
  assert.strictEqual(header.rootAppHref("cart.html"), "/cart.html");
  assert.strictEqual(header.rootAppHref("favorites.html"), "/favorites.html");
  assert.strictEqual(header.rootAppHref("account.html"), "/account.html");
  assert.strictEqual(header.rootAppHref("index.html"), "/");
  assert.strictEqual(header.rootAppHref("books.html"), "/books");
  assert.strictEqual(header.rootAppHref("index.html#books"), "/#books");
  assert.strictEqual(header.rootAppHref("javascript:alert(1)", "/"), "/");
  assert.ok(!header.rootAppHref("cart.html").includes("/book/"));
  assert.ok(!header.malformedBookAppPath("/cart.html"));
  assert.ok(header.malformedBookAppPath("/book/cart.html"));
  assert.ok(header.malformedBookAppPath("/book/favorites.html"));
  assert.ok(header.malformedBookAppPath("/book/account.html"));
});

test("header href rewriter never emits nested book app pages", () => {
  const cart = header.rewriteHeaderHref("cart.html");
  const fav = header.rewriteHeaderHref("favorites.html");
  const account = header.rewriteHeaderHref("account.html");
  [cart, fav, account].forEach((href) => {
    assert.ok(href.startsWith("/"));
    assert.ok(!href.startsWith("/book/"));
  });
  assert.strictEqual(header.rootAsset("kutadgu-logo.png"), "/kutadgu-logo.png");
  assert.strictEqual(header.rootAsset("/kutadgu-logo.webp"), "/kutadgu-logo.webp");
});

test("public pages load the shared header helper before shop/mobile", () => {
  [indexHtml, bookShell, cartHtml, favHtml, diniHtml].forEach((html) => {
    assert.match(html, /public-header\.js\?v=\d+/);
    const helper = html.search(/public-header\.js\?v=\d+/);
    const shopAt = html.search(/shop\.js\?v=\d+/);
    if (shopAt >= 0) assert.ok(helper >= 0 && helper < shopAt);
  });
  assert.match(accountHtml, /public-header\.js\?v=1/);
  assert.match(accountHtml, /theme\.js\?v=5/);
  assert.match(accountHtml, /href="\/"/);
  assert.match(indexHtml, /href="\/cart\.html"/);
  assert.match(indexHtml, /href="\/favorites\.html"/);
  assert.match(indexHtml, /href="\/account\.html"/);
  assert.match(indexHtml, /src="\/kutadgu-logo\.png"/);
});

test("shop and mobile keep using storefrontAppHref and call the helper", () => {
  assert.match(shop, /KutadguPublicHeader\.ensure/);
  assert.match(shop, /function loadPublicHeader\(/);
  assert.match(shop, /new URLSearchParams\(location\.search\)\.get\("q"\)/);
  assert.match(shop, /\.kutadgu-public-header nav/);
  assert.match(mobile, /KutadguPublicHeader\.ensure/);
  assert.match(mobile, /srcset="\/kutadgu-logo\.webp"/);
  assert.match(mobile, /"index.html": "\/"/);
  assert.doesNotMatch(mobile, /JSON\.parse\(localStorage\.getItem\("kutadgu-cart-v1"/);
});

test("header CSS keeps search compact, theme in-flow, and mobile spacing", () => {
  assert.match(css, /\.kutadgu-header-search/);
  assert.match(css, /flex-direction:\s*row !important/);
  assert.match(css, /max-width:\s*420px/);
  assert.match(css, /min-width:\s*280px/);
  assert.match(css, /\.kutadgu-public-header \.theme-button/);
  assert.match(css, /position:\s*static !important/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /--kutadgu-sticky-header-height/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /body\.dark-mode \.kutadgu-public-header/);
  assert.match(css, /@media \(min-width: 769px\)/);
  assert.match(css, /display:\s*grid !important/);
  assert.doesNotMatch(css, /admin-topbar/);
  const helperJs = fs.readFileSync(path.join(root, "public-header.js"), "utf8");
  assert.match(helperJs, /public-header\.css\?v=2/);
});

test("helper does not touch admin/auth/order/sql surfaces", () => {
  const js = fs.readFileSync(path.join(root, "public-header.js"), "utf8");
  assert.doesNotMatch(js, /createOrder|whatsappOrderUrl|rpc\(/);
  assert.doesNotMatch(js, /GRANT |CREATE POLICY|ALTER TABLE/);
  assert.match(js, /EXCLUDED_FILES/);
  assert.match(js, /"admin\.html": true/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("public-header-tests ok");
