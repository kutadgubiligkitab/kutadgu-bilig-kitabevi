#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
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

const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("idle search does not inject the tall hint into #searchResults", () => {
  const enhance = shop.slice(shop.indexOf("function searchEnhance"), shop.indexOf("function dynamicListingCard"));
  assert.match(enhance, /if\(!hasFilter\(\)\)\{/);
  assert.match(enhance, /res\.innerHTML=fallbackNotice\(\);/);
  assert.doesNotMatch(enhance, /advanced-search-hint/);
  assert.match(html, /placeholder="كىتاب ئىسمى، ئاپتور ياكى تۈر بويىچە ئىزدەڭ/);
});

test("search query path is unchanged", () => {
  const enhance = shop.slice(shop.indexOf("function searchEnhance"), shop.indexOf("function dynamicListingCard"));
  assert.match(enhance, /function hasFilter\(\)\{return !!\(input\.value\.trim\(\)/);
  assert.match(enhance, /inputTimer=setTimeout\(\(\)=>run\(false\),400\)/);
  assert.match(enhance, /await queryCatalog\(state,/);
  assert.match(enhance, /sort:collectionMode==="new"\?"new":sortEl\?\.value\|\|"new"/);
});

test("desktop compact CSS is gated to min-width 701px", () => {
  const block = css.slice(css.indexOf("PR #35"));
  assert.match(block, /@media \(min-width: 701px\)/);
  assert.match(block, /\.home-bookstore-hero\{[\s\S]*min-height:160px !important/);
  assert.match(block, /padding:12px clamp\(22px,5vw,74px\) 14px !important/);
  assert.match(block, /\.home-hero-inner\{[\s\S]*gap:22px !important/);
  assert.match(block, /\.bookstore-scene\{[\s\S]*min-height:135px !important/);
  assert.match(block, /hero-scene-logo/);
  assert.match(block, /\.home-search-card-section\{[\s\S]*scroll-margin-top:96px/);
  assert.match(block, /\.home-search-card \.advanced-search-panel\.is-collapsed/);
  assert.match(block, /#newBooksCarousel\{[\s\S]*margin-top:8px !important/);
  assert.doesNotMatch(block, /max-width:\s*700px/);
});

test("homepage assets bumped; hero image paths unchanged", () => {
  assert.match(html, /index\.css\?v=9/);
  assert.match(html, /shop\.js\?v=74/);
  assert.match(html, /srcset="hero-brand-logo\.webp"/);
  assert.match(html, /src="hero-brand-logo\.png\?v=1"/);
  assert.match(html, /srcset="kutadgu-logo\.webp"/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("\nAll homepage compact UX unit tests passed");
