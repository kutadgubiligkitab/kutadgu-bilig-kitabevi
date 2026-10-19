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
  assert.match(failure, /run\(false,\{forceRecovery:true\}\)/);
  const debounced = sliceBetween(search, "const debouncedRun=", "input.addEventListener(\"input\",debouncedRun);");
  assert.match(debounced, /invalidateSearch\(\)/);
  assert.match(debounced, /setTimeout\(\(\)=>run\(false\),400\)/);
  assert.ok(debounced.indexOf("invalidateSearch()") < debounced.indexOf("setTimeout"));
  const retry = sliceBetween(search, "async function querySearchPage(", "async function run(append=false,options={}){");
  assert.match(retry, /forceRecovery:force/);
  assert.match(retry, /Math\.max\(SEARCH_AUTO_RETRY_MS,recoveryDelayMs\(\)\)/);
  const second = retry.slice(retry.lastIndexOf("return queryCatalog"));
  assert.match(second, /queryCatalog\(state,\{signal:controller\.signal\}\)/);
  assert.doesNotMatch(second, /forceRecovery/);
  assert.match(search, /if\(append&&loadingMore\)return/);
  assert.match(search, /function invalidateSearch\(\)/);
  assert.match(search, /reset\.onclick=\(\)=>\{[^}]*invalidateSearch\(\)[^}]*reset\.dispatchEvent\(new Event\("input",\{bubbles:true\}\)\)\}/);
  assert.doesNotMatch(sliceBetween(search, "if(reset)reset.onclick=", "res.innerHTML=fallbackNotice();"), /run\(false\)/);
  assert.match(search, /if\(remoteCatalog\.available\)return 0/);
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
