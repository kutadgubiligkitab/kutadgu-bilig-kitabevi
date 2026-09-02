#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
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

test("homepage initial HTML has no sample/demo book cover images", () => {
  const carousel = sliceBetween(html, 'id="newBooksCarousel"', 'id="homeFeaturedBooks"');
  const featured = sliceBetween(html, 'id="homeFeaturedBooks"', 'id="bookCategories"');
  assert.doesNotMatch(carousel, /sample-book-cover\.png/);
  assert.doesNotMatch(featured, /sample-book-cover\.png/);
  assert.doesNotMatch(carousel, /<img\b/i);
  assert.doesNotMatch(featured, /<img\b/i);
});

test("homepage catalog hosts start as coverless skeleton cards", () => {
  assert.match(html, /id="homeCarouselTrack"[^>]*aria-busy="true"/);
  assert.match(html, /home-carousel-card is-skeleton/);
  assert.match(html, /data-home-featured-shell="1"/);
  assert.match(html, /home-featured-grid is-skeleton-grid/);
  assert.match(html, /home-feature-card is-skeleton/);
  assert.match(html, /class="home-skel-cover"/);
});

test("static shell does not paint homepage books before remote catalog boot", () => {
  const shell = sliceBetween(shop, "function initStaticShell()", "function init()");
  assert.doesNotMatch(shell, /renderHomeFeaturedBooks\(\)/);
  assert.match(shell, /renderHomeSections\(\)/);
  assert.match(shop, /initStaticShell\(\);\n  if\(isStorefrontHomepage\(\)\)applyHomepageDocumentTitle\(\)/);
  const boot = sliceBetween(shop, "async function boot()", "window.kutadguShop=");
  assert.match(boot, /initStaticShell\(\);\n  await loadRemoteCatalog\(\)/);
  const init = sliceBetween(shop, "function init()", "let bootStarted=false");
  assert.match(init, /setupHomeCarousel\(\)/);
  assert.match(init, /renderHomeFeaturedBooks\(\)/);
});

test("homepage collections drop static demo covers when Supabase is configured", () => {
  assert.match(shop, /function isSampleDemoCover\(src\)/);
  assert.match(shop, /function homepageVisibleBooks\(result\)/);
  assert.match(shop, /remoteCatalog\.configured&&result&&result\.source==="static"/);
  const featured = sliceBetween(shop, "async function renderHomeFeaturedBooks()", "function renderHomeSections()");
  assert.match(featured, /homepageVisibleBooks\(result\)/);
  assert.match(featured, /queryCatalog\(\{offset:0,pageSize:20,sort:"new"\}\)/);
  const carousel = sliceBetween(shop, "async function setupHomeCarousel()", "function loadMemberSystem");
  assert.match(carousel, /homepageVisibleBooks\(result\)/);
  assert.match(carousel, /homeCarouselSkeletonMarkup\(4\)/);
});

test("sample-book-cover.png file is kept on disk", () => {
  assert.ok(fs.existsSync(path.join(root, "sample-book-cover.png")));
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("homepage-catalog-boot-tests ok");
