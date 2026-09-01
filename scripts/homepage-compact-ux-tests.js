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
  assert.match(html, /shop\.js\?v=75/);
  assert.match(html, /srcset="hero-brand-logo\.webp"/);
  assert.match(html, /src="hero-brand-logo\.png\?v=1"/);
  assert.match(html, /srcset="kutadgu-logo\.webp"/);
});

test("carousel opens the first enabled mode that has books", () => {
  const start = shop.indexOf("function firstPopulatedCarouselMode");
  const end = shop.indexOf("async function setupHomeCarousel");
  assert.ok(start >= 0 && end > start, "firstPopulatedCarouselMode must sit next to setupHomeCarousel");
  const firstPopulatedCarouselMode = new Function(`${shop.slice(start, end)}; return firstPopulatedCarouselMode;`)();
  const modes = ["recommended", "bestseller", "newest"];
  assert.strictEqual(firstPopulatedCarouselMode(modes, { recommended: 0, newest: 4 }), "newest");
  assert.strictEqual(firstPopulatedCarouselMode(modes, { recommended: 3, newest: 0 }), "recommended");
  assert.strictEqual(firstPopulatedCarouselMode(modes, { recommended: 2, newest: 5 }), "recommended");
  assert.strictEqual(firstPopulatedCarouselMode(modes, { recommended: 0, bestseller: 3, newest: 5 }), "bestseller");
  assert.strictEqual(firstPopulatedCarouselMode(modes, { recommended: 0, bestseller: 0, newest: 0 }), "recommended");
  const carousel = shop.slice(shop.indexOf("async function setupHomeCarousel"), shop.indexOf("function loadMemberSystem"));
  assert.match(carousel, /resolveInitialMode\(\)\.then\(initial=>\{if\(!userPickedMode\)setMode\(initial\)\}\)/);
  assert.match(carousel, /modeCache\.get\(candidate\)\|\|await loadMode\(candidate,false\)/);
  assert.doesNotMatch(carousel, /setMode\(enabledModes\[0\]\)/);
  assert.match(carousel, /tabs\.forEach\(button=>\{button\.hidden=!enabledModes\.includes\(button\.dataset\.carouselMode\)\}\)/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("\nAll homepage compact UX unit tests passed");
