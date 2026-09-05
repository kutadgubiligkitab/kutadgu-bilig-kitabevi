#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const css = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const LISTING_PAGES = [
  "romanlar.html","universal.html","children.html","dini.html","derslik.html","terbiye.html",
  "tibb.html","dastanlar.html","sheirlar.html","hekayiler.html","uyghur-adabiyati.html",
  "dunya-edebiyati.html","adabiyat-roman.html","tarikhiy-romanlar.html"
];
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
function listingGrid(html) {
  const start = html.indexOf('class="books-grid"');
  assert.ok(start >= 0, "missing books-grid");
  const sectionEnd = html.indexOf("</section>", start);
  return html.slice(start, sectionEnd);
}

test("every live listing page first-paints skeletons without demo cards", () => {
  for (const file of LISTING_PAGES) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const grid = listingGrid(html);
    assert.match(html, /data-catalog-source="/, file);
    assert.match(html, /aria-busy="true"/, file);
    assert.match(grid, /book-card is-skeleton/, file);
    assert.match(grid, /listing-skel-cover/, file);
    assert.doesNotMatch(grid, /sample-book-cover\.png/, file);
    assert.doesNotMatch(grid, /<img\b/i, file);
    assert.doesNotMatch(grid, /رومان كىتابى|كىتابى 2|ئاپتور ئىسمى/, file);
    assert.match(html, /rel="canonical"/, file);
    assert.match(html, /CollectionPage/, file);
    assert.match(html, /shop\.js\?v=101/, file);
    assert.match(html, /shop\.css\?v=50/, file);
  }
});

test("CSS hides leftover live-grid demo cards before catalog-ready", () => {
  assert.match(css, /\.books-grid\[data-catalog-source\]:not\(\[data-catalog-ready\]\)\s*>\s*\.book-card:not\(\.is-skeleton\)/);
  assert.match(css, /\.book-cover-unavailable/);
  assert.match(css, /\.catalog-error-state/);
  assert.match(css, /\.listing-skel-cover/);
});

test("static shell paints listing skeletons and skips stale card sync while waiting", () => {
  const shell = sliceBetween(shop, "function initStaticShell()", "function init()");
  assert.match(shell, /paintListingBootState\(\)/);
  const paintAt = shell.indexOf("paintListingBootState()");
  const coverAt = shell.indexOf("applyStaticCoverFallbacks()");
  assert.ok(paintAt >= 0 && coverAt > paintAt, "boot state before cover fallbacks");
  assert.match(shell, /if\(!liveListingWaiting\(\)\)/);
  assert.match(shop, /function listingCardSkeletonMarkup\(\)/);
  assert.doesNotMatch(sliceBetween(shop, "function listingCardSkeletonMarkup()", "function liveListingGrid()"), /sample-book-cover/);
  assert.doesNotMatch(sliceBetween(shop, "function listingCardSkeletonMarkup()", "function liveListingGrid()"), /<img\b/i);
});

test("configured catalog never restores static demo books", () => {
  const query = sliceBetween(shop, "async function queryCatalog(", "async function loadInactiveRemoteIndex()");
  assert.match(query, /if\(remoteCatalog\.configured\)/);
  assert.match(query, /throw error/);
  const load = sliceBetween(shop, "async function loadRemoteCatalog()", "async function hydrateBooksByIds(");
  assert.match(load, /beginRemoteVisibleCatalog\(\)/);
  assert.match(load, /source:"error"/);
  assert.match(shop, /كىتابلارنى يۈكلەشتە خاتالىق كۆرۈلدى\. قايتا سىناڭ\./);
  assert.match(shop, /catalog-retry-btn/);
});

test("production listing covers never use sample-book-cover.png", () => {
  const cover = sliceBetween(shop, "function coverSrc(book){", "function isSampleDemoCover(src){");
  assert.match(cover, /isSampleDemoCover\(raw\)/);
  assert.match(cover, /fallback:""/);
  assert.match(shop, /function coverImgHtml\(book/);
  assert.match(shop, /book-cover-unavailable/);
  assert.match(shop, /window\.kutadguMarkCoverUnavailable/);
  const card = sliceBetween(shop, "function bookCardMarkup(b,variant=\"listing\",coverOpts={}){", "function searchResultCard(b)");
  assert.doesNotMatch(card, /this\.src='\$\{FALLBACK_COVER\}'/);
  assert.match(card, /coverImgHtml\(b,coverOpts\)/);
  const listingApply = sliceBetween(shop, "function setupCatalogFilters(){", "function myBooksData()");
  assert.match(listingApply, /listingBootSkeletonMarkup\(6\)/);
  assert.match(listingApply, /data-catalog-ready/);
  assert.match(listingApply, /listingErrorMarkup\(\)/);
  assert.doesNotMatch(listingApply, /grid\.innerHTML='<div class="catalog-loading-state"/);
});

test("homepage and cart cold-load protections remain", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cart = fs.readFileSync(path.join(root, "cart.html"), "utf8");
  assert.match(index, /home-carousel-card is-skeleton/);
  assert.match(index, /home-feature-card is-skeleton/);
  assert.doesNotMatch(sliceBetween(index, 'id="newBooksCarousel"', 'id="bookCategories"'), /sample-book-cover\.png/);
  assert.match(cart, /id="cartItems"[^>]*aria-busy="true"/);
  assert.doesNotMatch(sliceBetween(cart, 'id="cartItems"', 'id="cartAside"'), /sample-book-cover\.png/);
  const shell = sliceBetween(shop, "function initStaticShell()", "function init()");
  assert.doesNotMatch(shell, /renderHomeFeaturedBooks\(\)/);
  assert.doesNotMatch(shell, /cartPage\(\)/);
  assert.match(shell, /paintCartBootState\(\)/);
});

test("sample-book-cover.png file is kept on disk", () => {
  assert.ok(fs.existsSync(path.join(root, "sample-book-cover.png")));
});

test("filter/sort/pagination helpers still exist", () => {
  assert.match(shop, /function setupCatalogFilters\(\)/);
  assert.match(shop, /catalog-load-more/);
  assert.match(shop, /async function apply\(append=false\)/);
  assert.match(shop, /data-cart-id/);
  assert.match(shop, /data-fav-id/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("listing-catalog-boot-tests ok");
