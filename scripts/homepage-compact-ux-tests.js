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
  assert.match(html, /index\.css\?v=10/);
  assert.match(html, /shop\.js\?v=76/);
  assert.match(html, /srcset="hero-brand-logo\.webp"/);
  assert.match(html, /src="hero-brand-logo\.png\?v=1"/);
  assert.match(html, /srcset="kutadgu-logo\.webp"/);
});

test("carousel opens the first enabled mode that has books", () => {
  const start = shop.indexOf("function firstPopulatedCarouselMode");
  const end = shop.indexOf("async function setupHomeCarousel");
  assert.ok(start >= 0 && end > start, "firstPopulatedCarouselMode must sit next to setupHomeCarousel");
  const helpers = new Function(`${shop.slice(start, end)}; return {firstPopulatedCarouselMode, carouselVisibleCount, carouselShouldAutoplay};`)();
  const modes = ["recommended", "bestseller", "newest"];
  assert.strictEqual(helpers.firstPopulatedCarouselMode(modes, { recommended: 0, newest: 4 }), "newest");
  assert.strictEqual(helpers.firstPopulatedCarouselMode(modes, { recommended: 3, newest: 0 }), "recommended");
  assert.strictEqual(helpers.firstPopulatedCarouselMode(modes, { recommended: 2, newest: 5 }), "recommended");
  assert.strictEqual(helpers.firstPopulatedCarouselMode(modes, { recommended: 0, bestseller: 3, newest: 5 }), "bestseller");
  assert.strictEqual(helpers.firstPopulatedCarouselMode(modes, { recommended: 0, bestseller: 0, newest: 0 }), "recommended");
  const carousel = shop.slice(shop.indexOf("async function setupHomeCarousel"), shop.indexOf("function loadMemberSystem"));
  assert.match(carousel, /resolveInitialMode\(\)\.then\(initial=>\{if\(!userPickedMode\)setMode\(initial\)\}\)/);
  assert.match(carousel, /modeCache\.get\(candidate\)\|\|await loadMode\(candidate,false\)/);
  assert.doesNotMatch(carousel, /setMode\(enabledModes\[0\]\)/);
  assert.match(carousel, /tabs\.forEach\(button=>\{button\.hidden=!enabledModes\.includes\(button\.dataset\.carouselMode\)\}\)/);
});

test("homepage carousel auto-slides one book every 5s when more than 4 books are visible", () => {
  const start = shop.indexOf("function firstPopulatedCarouselMode");
  const end = shop.indexOf("async function setupHomeCarousel");
  const helpers = new Function(`${shop.slice(start, end)}; return {carouselVisibleCount, carouselShouldAutoplay};`)();
  assert.strictEqual(helpers.carouselVisibleCount(1280, { desktopCardsPerRow: 4, tabletVisibleCards: 4 }), 4);
  assert.strictEqual(helpers.carouselVisibleCount(900, { desktopCardsPerRow: 4, tabletVisibleCards: 4 }), 3);
  assert.strictEqual(helpers.carouselVisibleCount(800, { desktopCardsPerRow: 4, tabletVisibleCards: 4 }), 2);
  assert.strictEqual(helpers.carouselVisibleCount(390, { desktopCardsPerRow: 4, tabletVisibleCards: 4 }), 1);
  assert.strictEqual(helpers.carouselShouldAutoplay(6, 4, { autoPlayEnabled: true }), true);
  assert.strictEqual(helpers.carouselShouldAutoplay(4, 4, { autoPlayEnabled: true }), false);
  assert.strictEqual(helpers.carouselShouldAutoplay(8, 4, { reducedMotion: true, autoPlayEnabled: true }), false);
  assert.strictEqual(helpers.carouselShouldAutoplay(8, 1, { mobile: true, mobileAutoPlayEnabled: false, autoPlayEnabled: true }), false);
  const carousel = shop.slice(shop.indexOf("async function setupHomeCarousel"), shop.indexOf("function loadMemberSystem"));
  assert.match(carousel, /autoplayDelay:5000/);
  assert.match(carousel, /desktopRows:1/);
  assert.match(carousel, /carouselRoot\.addEventListener\("mouseenter",stop\)/);
  assert.match(carousel, /carouselRoot\.addEventListener\("mouseleave",start\)/);
  assert.match(carousel, /list\.slice\(-vis\)/);
  assert.match(carousel, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(min-width: 1101px\)/);
  assert.match(css, /flex:0 0 calc\(\(100% - 48px\) \/ 4\)/);
});

test("homepage sections keep ids and put books before category cards", () => {
  const pos = (id) => {
    const needle = `id="${id}"`;
    const first = html.indexOf(needle);
    assert.ok(first >= 0, `${id} must exist`);
    assert.strictEqual(html.indexOf(needle, first + 1), -1, `${id} must exist exactly once`);
    return first;
  };
  const books = pos("books");
  const carousel = pos("newBooksCarousel");
  const featured = pos("homeFeaturedBooks");
  const categories = pos("bookCategories");
  const order = pos("orderProcess");
  const about = pos("about");
  const contact = pos("contact");
  assert.ok(books < carousel && carousel < featured && featured < categories);
  assert.ok(categories < order && order < about && about < contact);
  assert.doesNotMatch(html, /id="premiumDiscovery"/);
  assert.match(html, /id="searchInput"/);
  assert.match(html, /id="homeCarouselTrack"/);
  assert.match(html, /href="adabiyat.html"/);
  assert.match(html, /href="dini.html"/);
  assert.match(html, /href="children.html"/);
  const catBlock = html.slice(categories, order);
  assert.doesNotMatch(catBlock, /id="homeFeaturedBooks"/);
  assert.doesNotMatch(html, /id="homeShopSections"/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("\nAll homepage compact UX unit tests passed");
