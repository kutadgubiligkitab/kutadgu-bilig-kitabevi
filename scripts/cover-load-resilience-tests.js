#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const css = fs.readFileSync(path.join(root, "shop.css"), "utf8");
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

test("one shared cover retry mechanism exists with bounded delays", () => {
  assert.match(shop, /const COVER_RETRY_MAX=2/);
  assert.match(shop, /const COVER_RETRY_DELAYS=\[300,900\]/);
  assert.match(shop, /const COVER_RETRY_CONCURRENCY=3/);
  assert.match(shop, /function handleCoverError\(img\)/);
  assert.match(shop, /function handleCoverLoad\(img\)/);
  assert.match(shop, /function replayApprovedCover\(img\)/);
  assert.match(shop, /function enqueueCoverRetry\(img\)/);
  assert.match(shop, /img\.isConnected/);
  assert.match(shop, /function isRetryableCoverUrl\(src\)/);
});

test("coverImgHtml retries instead of immediately replacing the img", () => {
  const html = sliceBetween(shop, "function coverImgHtml(book,opts={}){", "function listingCardSkeletonMarkup()");
  assert.match(html, /kutadguHandleCoverError/);
  assert.match(html, /data-cover-src=/);
  assert.doesNotMatch(html, /kutadguMarkCoverUnavailable&&window\.kutadguMarkCoverUnavailable\(this\)/);
  assert.doesNotMatch(html, /this\.src='\$\{FALLBACK_COVER\}'/);
});

test("missing unsafe and sample covers are not retryable", () => {
  const retry = sliceBetween(shop, "function isRetryableCoverUrl(src){", "function coverRetryState(img){");
  assert.match(retry, /isSampleDemoCover\(t\)/);
  assert.match(retry, /isSafeCoverUrl\(t\)/);
  const cover = sliceBetween(shop, "function coverSrc(book){", "function isSampleDemoCover(src){");
  assert.match(cover, /if\(!raw\|\|isSampleDemoCover\(raw\)\)return ""/);
});

test("JS cover assignment paths share assignCoverImage", () => {
  assert.match(shop, /function assignCoverImage\(img,src,opts=\{\}\)/);
  assert.match(shop, /assignCoverImage\(img,src\)/);
  assert.match(shop, /assignCoverImage\(picture,url\)/);
  assert.match(shop, /assignCoverImage\(img,src,\{loading:"eager"/);
  const fallbacks = sliceBetween(shop, "function applyStaticCoverFallbacks(scope=document){", "function applyDetailCoverFallback(){");
  assert.match(fallbacks, /handleCoverError\(this\)/);
  assert.doesNotMatch(fallbacks, /this\.onerror=null;\s*if\(COVER_LAYOUT_TEST_MODE\)\{this\.src=FALLBACK_COVER;return\}\s*markCoverUnavailable\(this\)/);
});

test("retry visual state keeps cover geometry and reduced motion", () => {
  assert.match(css, /img\.is-cover-retrying/);
  assert.match(css, /opacity:\s*0/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.book-cover-unavailable/);
});

test("stage 66 listing first-paint and no sample fallback remain", () => {
  assert.match(shop, /function paintListingBootState\(\)/);
  assert.match(shop, /kutadguHandleCoverError/);
  assert.ok(fs.existsSync(path.join(root, "sample-book-cover.png")));
  assert.match(shop, /COVER_LAYOUT_TEST_MODE\)return FALLBACK_COVER/);
});

test("shared renderer still used by listing search carousel cart favorites", () => {
  assert.match(shop, /coverImgHtml\(b,coverOpts\)/);
  assert.match(shop, /coverImgHtml\(b\)/);
  assert.match(shop, /home-carousel-cover/);
  assert.match(shop, /function miniCover\(b\)\{/);
  assert.match(shop, /return coverImgHtml\(b,\{width:320,height:460\}\)/);
  assert.match(shop, /coverImgHtml\(x\.b,\{width:100,height:127/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("cover-load-resilience-tests ok");
