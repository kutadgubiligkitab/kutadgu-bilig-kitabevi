#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
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

const cartSrc = sliceBetween(shop, "function cartButton(book,label=", "function cart(){");
const homeSrc = sliceBetween(shop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
const carouselSrc = sliceBetween(shop, "async function setupHomeCarousel()", "function loadMemberSystem");

test("homepage featured and carousel still pass icon-only 🛒 into cartButton", () => {
  assert.match(homeSrc, /cartButton\(b,"🛒","add-to-cart home-feature-cart"\)/);
  assert.match(carouselSrc, /cartButton\(b,"🛒","home-carousel-cart add-to-cart"\)/);
});

function loadCartButton() {
  return new Function(`
    function escapeHtml(v){
      return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    }
    function escapeAttr(v){ return escapeHtml(v); }
    function isStorefrontVisible(){ return true; }
    function stockInfo(book){
      if (book && book.stock === 0) return { canBuy: false };
      return { canBuy: true };
    }
    ${cartSrc}
    return { cartButton };
  `)();
}

const api = loadCartButton();
const featured = api.cartButton({ id: "101", title: "ئىسكەندەرنامە", stock: 4 }, "🛒", "add-to-cart home-feature-cart");
const carousel = api.cartButton({ id: "101", title: "ئىسكەندەرنامە", stock: 4 }, "🛒", "home-carousel-cart add-to-cart");
const quoted = api.cartButton({ id: "7", title: 'Kitap "A"', stock: 4 }, "🛒", "add-to-cart home-feature-cart");
const textBtn = api.cartButton({ id: "2", title: "نورمال", stock: 4 });
const detailBtn = api.cartButton({ id: "3", title: "نورمال", stock: 4 }, "🛒 سېۋەتكە قوشۇش", "add-to-cart detail-cart");
const outCompact = api.cartButton({ id: "0", title: "تۈگەپ", stock: 0 }, "🛒", "home-carousel-cart add-to-cart");
const outText = api.cartButton({ id: "0", title: "تۈگەپ", stock: 0 });

test("icon-only in-stock featured and carousel buttons get a book-title aria-label", () => {
  assert.match(featured, /aria-label="ئىسكەندەرنامە — سېۋەتكە سېلىش"/);
  assert.match(carousel, /aria-label="ئىسكەندەرنامە — سېۋەتكە سېلىش"/);
  assert.match(quoted, /aria-label="Kitap &quot;A&quot; — سېۋەتكە سېلىش"/);
});

test("visible icon-only label stays 🛒", () => {
  assert.match(featured, />🛒<\/button>/);
  assert.match(carousel, />🛒<\/button>/);
  assert.doesNotMatch(featured, />[^<]*سېۋەتكە سېلىش<\/button>/);
  assert.doesNotMatch(carousel, />[^<]*سېۋەتكە سېلىش<\/button>/);
});

test("normal text cart buttons stay unchanged", () => {
  assert.match(textBtn, />🛒 سېۋەتكە سېلىش<\/button>/);
  assert.doesNotMatch(textBtn, /aria-label=/);
  assert.match(detailBtn, />🛒 سېۋەتكە قوشۇش<\/button>/);
  assert.doesNotMatch(detailBtn, /aria-label=/);
});

test("out-of-stock accessible labeling remains تۈگەپ كەتتى", () => {
  assert.match(outCompact, /aria-label="تۈگەپ كەتتى"/);
  assert.match(outText, /aria-label="تۈگەپ كەتتى"/);
  assert.match(outCompact, />🛒<span class="cart-blocked-mark" aria-hidden="true">✕<\/span></);
  assert.doesNotMatch(outCompact, /ئىسكەندەرنامە — سېۋەتكە سېلىش/);
  assert.doesNotMatch(outText, /سېۋەتكە سېلىش"/);
});

if (failed) {
  console.error("\n" + failed + " l1 home cart accessible-name test(s) failed");
  process.exit(1);
}
console.log("l1-home-cart-accessible-name-tests ok");
