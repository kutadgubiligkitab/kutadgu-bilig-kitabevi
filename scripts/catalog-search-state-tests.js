#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const premium = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, startNeedle);
  return src.slice(start, end);
}

test("search failure is not the confirmed-empty class", () => {
  const search = sliceBetween(shop, "function searchEnhance(){", "function dynamicListingCard(");
  const failure = sliceBetween(search, "function paintSearchFailure(){", "function waitForSearchRetry(");
  assert.match(failure, /class="search-failed catalog-error-state"/);
  assert.match(failure, /data-search-state="failed"/);
  assert.match(failure, /ئىزدەش ۋاقىتلىق ئىشلىمىدى/);
  assert.match(failure, /data-search-retry="1"/);
  assert.doesNotMatch(failure, /search-empty/);
  assert.doesNotMatch(failure, /ئىزدەش نەتىجىسى تېپىلمىدى/);
  const empty = sliceBetween(search, "function draw(result,append=false){", "function paintSearchLoading(){");
  assert.match(empty, /class="search-empty" data-search-state="empty"/);
  assert.match(empty, /نەتىجە تېپىلمىدى/);
  assert.match(search, /setSearchState\("loading"\)/);
  assert.match(search, /setSearchState\("idle"\)/);
  assert.match(search, /SEARCH_AUTO_RETRY_MS=350/);
  assert.match(search, /if\(append\|\|error\?\.name==="AbortError"\|\|token!==requestId\)throw error/);
  assert.match(search, /if\(!append\)trackCompletedSearch\(state\.search,result\)/);
  assert.doesNotMatch(failure, /trackCompletedSearch|analytics/);
});

test("smart empty state enhances only a confirmed empty result", () => {
  const enhance = sliceBetween(premium, "function setupSmartEmptyState(){", "function setupFilterUX(){");
  assert.match(enhance, /results\.dataset\.searchState!=="empty"/);
  assert.match(enhance, /querySelector\("\.search-empty"\)/);
  assert.match(enhance, /ئىزدەش نەتىجىسى تېپىلمىدى/);
  const before = enhance.slice(0, enhance.indexOf("querySelector(\".search-empty\")"));
  assert.match(before, /searchState!=="empty"/);
});

test("featured catalog failure stays separate from an empty shelf and from covers", () => {
  const featured = sliceBetween(shop, "async function renderHomeFeaturedBooks(options={}){", "function renderHomeSections(){");
  assert.match(featured, /data-catalog-state="loading"/);
  assert.match(featured, /host\.dataset\.catalogState="empty"/);
  assert.match(featured, /كىتابلار تېخى قوشۇلمىغان/);
  assert.match(featured, /host\.dataset\.catalogState="failed"/);
  assert.match(featured, /يېقىندا قوشۇلغان كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى/);
  assert.match(featured, /host\.dataset\.catalogState="ready"/);
  const cover = sliceBetween(shop, "function markCoverUnavailable(img){", "function handleCoverLoad(img){");
  assert.match(cover, /book-cover-unavailable/);
  assert.doesNotMatch(cover, /catalog-error-state|search-empty|search-failed/);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("catalog search state tests passed");
