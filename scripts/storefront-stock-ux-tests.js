#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const css = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const stockHelper = fs.readFileSync(path.join(root, "kutadgu-stock.js"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.message);
  }
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function stockUxApi() {
  const stateSrc = sliceBetween(shop, "function stockStateClass(book){", "function clampCartQuantitiesToStock(){");
  const cartSrc = sliceBetween(shop, "function cartButton(book,label=", "function cart(){");
  const cardSrc = sliceBetween(shop, "function bookCardMarkup(b,variant=\"listing\",coverOpts={}){", "function searchResultCard(b){");
  const miniSrc = sliceBetween(shop, "function miniCard(b){", "function favoriteCard(b){");
  const favSrc = sliceBetween(shop, "function favoriteCard(b){", "function renderFavoritesPage(){");
  const homeSrc = sliceBetween(shop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  return new Function(`
    function escapeHtml(s){ return String(s == null ? "" : s); }
    function escapeAttr(s){ return String(s == null ? "" : s); }
    function isStorefrontVisible(){ return true; }
    function storefrontAuthor(b){ return b && b.author || ""; }
    function safeHref(href){ return href || "/book/1"; }
    function money(n){ return String(n) + " ₺"; }
    function coverImgHtml(){ return '<img src="/kutadgu-logo.png" alt="cover">'; }
    function stockInfo(book){
      const qty = book && book.stock;
      if (qty === 0) return { key: "out", label: "تۈگەپ كەتتى", canBuy: false, qty: 0 };
      if (qty > 0 && qty <= 3) return { key: "low", label: "ئاز قالدى", canBuy: true, qty };
      if (qty >= 4) return { key: "in", label: "ئامباردا بار", canBuy: true, qty };
      return { key: "unknown", label: "", canBuy: true, qty: null };
    }
    ${stateSrc}
    ${cartSrc}
    ${cardSrc}
    function miniCover(b){ return wrapCoverHtml(b, coverImgHtml(b)); }
    ${miniSrc}
    ${favSrc}
    ${homeSrc}
    return { stockBadge, stockStateClass, wrapCoverHtml, cartButton, bookCardMarkup, miniCard, favoriteCard, homeFeatureCard };
  `)();
}

const api = stockUxApi();

test("stockInfo still keeps in-stock labels internally", () => {
  assert.match(shop, /return \{key:"in",label:"ئامباردا بار",canBuy:true,qty\}/);
  assert.match(stockHelper, /in_stock:"ئامباردا بار"/);
});

test("stockBadge hides in-stock and never prints exact quantity", () => {
  assert.strictEqual(api.stockBadge({ stock: 4 }), "");
  assert.strictEqual(api.stockBadge({ stock: 8 }), "");
  const one = api.stockBadge({ stock: 1 });
  const three = api.stockBadge({ stock: 3 });
  const zero = api.stockBadge({ stock: 0 });
  assert.match(one, /ئاز قالدى/);
  assert.match(three, /ئاز قالدى/);
  assert.doesNotMatch(one, /1 دانە/);
  assert.doesNotMatch(three, /3 دانە/);
  assert.doesNotMatch(one, /ئامباردا بار/);
  assert.match(zero, /تۈگەپ كەتتى/);
  assert.doesNotMatch(api.stockBadge({ stock: 1 }) + api.stockBadge({ stock: 0 }), /\b[123]\b/);
});

test("listing cards use silent in-stock, low badge, and out-of-stock cover state", () => {
  const four = api.bookCardMarkup({ id: "4", href: "/book/4", title: "نورمال", author: "A", category: "رومانلار", price: 20, stock: 4 });
  assert.doesNotMatch(four, /ئامباردا بار/);
  assert.doesNotMatch(four, /stock-in/);
  assert.doesNotMatch(four, /is-stock-out/);
  assert.match(four, /سېۋەتكە سېلىش/);
  assert.doesNotMatch(four, /disabled/);

  const one = api.bookCardMarkup({ id: "1", href: "/book/1", title: "ئاز", author: "A", category: "رومانلار", price: 20, stock: 1 });
  assert.match(one, /ئاز قالدى/);
  assert.match(one, /is-stock-low/);
  assert.doesNotMatch(one, /1 دانە قالدى/);
  assert.doesNotMatch(one, /disabled/);

  const three = api.bookCardMarkup({ id: "3", href: "/book/3", title: "ئاز3", author: "A", category: "رومانلار", price: 20, stock: 3 });
  assert.match(three, /ئاز قالدى/);
  assert.match(three, /is-stock-low/);

  const zero = api.bookCardMarkup({ id: "0", href: "/book/0", title: "تۈگەپ", author: "A", category: "رومانلار", price: 20, stock: 0 });
  assert.match(zero, /is-stock-out/);
  assert.match(zero, /cover-stock-overlay/);
  assert.match(zero, /تۈگەپ كەتتى/);
  assert.match(zero, /disabled aria-disabled="true"/);
  assert.match(zero, /cart-blocked-mark/);
  assert.match(zero, /class="detail-button"/);
  assert.doesNotMatch(zero, /ئامباردا بار/);
});

test("homepage mini favorites search and feature renderers share the same stock UX", () => {
  const search = api.bookCardMarkup({ id: "0", href: "/book/0", title: "تۈگەپ", author: "A", category: "رومانلار", price: 20, stock: 0 }, "search");
  assert.match(search, /advanced-search-result is-stock-out/);
  assert.match(search, /cover-stock-overlay/);
  const mini = api.miniCard({ id: "1", href: "/book/1", title: "ئاز", author: "A", stock: 1, price: 10 });
  assert.match(mini, /ئاز قالدى/);
  assert.match(mini, /is-stock-low/);
  const fav = api.favoriteCard({ id: "0", href: "/book/0", title: "تۈگەپ", author: "A", stock: 0, price: 10 });
  assert.match(fav, /is-stock-out/);
  assert.match(fav, /تۈگەپ كەتتى/);
  const home = api.homeFeatureCard({ id: "4", href: "/book/4", title: "نورمال", author: "A", stock: 4, price: 10 });
  assert.doesNotMatch(home, /ئامباردا بار/);
  assert.doesNotMatch(home, /is-stock-out/);
});

test("out-of-stock cart button is blocked without a giant cover X", () => {
  const btn = api.cartButton({ id: "0", stock: 0, title: "تۈگەپ" });
  assert.match(btn, /disabled aria-disabled="true"/);
  assert.match(btn, /aria-label="تۈگەپ كەتتى"/);
  assert.match(btn, /cart-blocked-mark/);
  assert.match(btn, /✕/);
  assert.doesNotMatch(shop, /giant|huge X|book-cover-x/i);
  assert.match(css, /cover-stock-overlay/);
  assert.match(css, /opacity:\.68/);
  assert.match(shop, /if\(Number\.isFinite\(stock\.qty\)&&stock\.qty>0\)x\.qty=Math\.min/);
  assert.match(shop, /if\(!stock\.canBuy&&d>0\)return/);
  assert.match(shop, /سېۋەتتە تۈگەپ كەتكەن كىتاب بار؛ ئۇنى ئۆچۈرۈڭ/);
});

test("admin inventory labels remain visible and stock accounting files are untouched in this UX slice", () => {
  assert.match(adminHtml, /ئامباردا بار/);
  assert.match(stockHelper, /function deriveStockStatus/);
  assert.doesNotMatch(shop, /create_member_order/);
  assert.match(shop, /function clampCartQuantitiesToStock\(\)\{/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("All storefront stock UX tests passed");
