#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "storefront-cards-1a-polish.css"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const body = css.replace(/\/\*[\s\S]*?\*\//g, "");

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

function stripCards1bCartLabel(src) {
  return src.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\"");
}

test("1B keeps Cards 1A cover contain, two-line clamp, and reserved title height", () => {
  assert.match(body, /object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(body, /object-fit:\s*cover/);
  assert.match(body, /-webkit-line-clamp:\s*2/);
  assert.match(body, /line-clamp:\s*2/);
  assert.match(body, /min-height:\s*calc\(1\.75em \* 2\)/);
  assert.match(body, /line-height:\s*1\.75/);
});

test("1B tightens title padding without removing reserved two-line height", () => {
  assert.match(body, /padding-block:\s*0 0\.06em/);
  const titleRules = body.match(/padding-block:\s*0 0\.06em[\s\S]{0,80}/g) || [];
  assert.ok(titleRules.length >= 1);
  assert.match(body, /#homeFeaturedBooks \.home-feature-info\{[\s\S]*padding:\s*8px 10px 8px\s*!important/);
  assert.match(body, /#homeFeaturedBooks \.home-feature-author\{[\s\S]*margin-top:\s*2px\s*!important/);
  assert.match(body, /#newBooksCarousel \.home-carousel-info\{[\s\S]*padding:\s*6px 4px 0\s*!important/);
});

test("1B modest desktop title/author sizes stay at least Cards 1A and keep hierarchy", () => {
  assert.match(body, /@media \(min-width:901px\)\{[\s\S]*font-size:\s*15px\s*!important/);
  assert.match(body, /@media \(min-width:901px\)\{[\s\S]*font-size:\s*12px\s*!important/);
  assert.ok(15 >= 14, "title not smaller than Cards 1A 14px");
  assert.ok(12 > 11, "author secondary remains below title");
  assert.doesNotMatch(body, /font-size:\s*(1[6-9]|[2-9]\d)px/);
});

test("featured and carousel cart CTAs show سېۋەتكە as compact brown pills", () => {
  const home = sliceBetween(shop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  const carousel = sliceBetween(shop, "function card(b,i=0){", "const isDual=()=>");
  assert.match(home, /cartButton\(b,"🛒 سېۋەتكە","add-to-cart home-feature-cart"\)/);
  assert.match(carousel, /cartButton\(b,"🛒 سېۋەتكە","home-carousel-cart add-to-cart"\)/);
  assert.match(body, /#homeFeaturedBooks \.home-feature-cart,[\s\S]*#newBooksCarousel \.home-carousel-cart\{[\s\S]*width:\s*auto\s*!important/);
  assert.match(body, /border-radius:\s*999px\s*!important/);
  assert.match(body, /min-height:\s*36px/);
});

test("mini cards keep default labeled cartButton; compact 🛒 path remains for narrow callers", () => {
  const mini = sliceBetween(shop, "function miniCard(b){", "function favoriteCard(b){");
  assert.match(mini, /\$\{cartButton\(b\)\}/);
  assert.doesNotMatch(mini, /cartButton\(b,"🛒"/);
  const cartBtn = sliceBetween(shop, "function cartButton(book,label=", "function cart(){");
  assert.match(cartBtn, /replace\(\/\\s\+\/g,""\)==="🛒"/);
});

test("cart still has a single add handler and OOS disable", () => {
  const bind = sliceBetween(shop, "function bindDynamicActions(scope){", "function bookCardMarkup");
  const clicks = bind.match(/data-cart-id/g) || [];
  assert.strictEqual(clicks.length, 1);
  assert.match(bind, /add\(b\.dataset\.cartId\)/);
  const cartBtn = sliceBetween(shop, "function cartButton(book,label=", "function cart(){");
  assert.match(cartBtn, /disabled aria-disabled="true" aria-label="تۈگەپ كەتتى"/);
});

test("overlay still avoids grid-template-columns and loads last", () => {
  assert.doesNotMatch(body, /grid-template-columns/);
  assert.match(indexHtml, /shop\.js\?v=131/);
  assert.match(shop, /storefront-cards-1a-polish\.css\?v=2/);
});

test("generators match origin/main except the visible cart label", () => {
  const mainShop = execSync("git show origin/main:shop.js", { cwd: root, encoding: "utf8" });
  const home = sliceBetween(shop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  const mainHome = sliceBetween(mainShop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  assert.strictEqual(stripCards1bCartLabel(home), stripCards1bCartLabel(mainHome));
  const carousel = sliceBetween(shop, "function card(b,i=0){", "const isDual=()=>");
  const mainCarousel = sliceBetween(mainShop, "function card(b,i=0){", "const isDual=()=>");
  assert.strictEqual(stripCards1bCartLabel(carousel), stripCards1bCartLabel(mainCarousel));
  assert.strictEqual(
    sliceBetween(shop, "function miniCard(b){", "function favoriteCard(b){"),
    sliceBetween(mainShop, "function miniCard(b){", "function favoriteCard(b){")
  );
  const compact = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
  const mainCompact = execSync("git show origin/main:premium-ux.js", { cwd: root, encoding: "utf8" });
  assert.strictEqual(
    sliceBetween(compact, "function compactCard(book){", "function bindCards(scope){"),
    sliceBetween(mainCompact, "function compactCard(book){", "function bindCards(scope){")
  );
});

test("no Search Discovery SQL RLS auth admin or protected geometry changes", () => {
  const rank = fs.readFileSync(path.join(root, "kutadgu-search-rank.js"), "utf8");
  const mainRank = execSync("git show origin/main:kutadgu-search-rank.js", { cwd: root, encoding: "utf8" });
  assert.strictEqual(rank, mainRank);
  const cfg = fs.readFileSync(path.join(root, "app-config.js"), "utf8");
  const mainCfg = execSync("git show origin/main:app-config.js", { cwd: root, encoding: "utf8" });
  assert.strictEqual(cfg, mainCfg);
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && file !== "STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION.sql" && file !== "STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql" && file !== "STAGE87_COVER_INTEGRITY.sql" && file !== "STAGE99_BOOK_ENGAGEMENT_VIEW_COUNTS.sql") ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)premium-ux\.css$/i.test(file) ||
    /kutadgu-search-rank\.js$|app-config\.js$/.test(file) ||
    /listing-card-safety|detail-similar-card-safety|recently-viewed-card-safety|covers\.css|theme\.css|shop\.css|catalog\.js$/.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
  ["index.css", "mobile.css"].forEach((rel) => {
    if (!files.includes(rel)) return;
    const diff = execSync("git diff origin/main -- " + rel, { cwd: root, encoding: "utf8" });
    const lines = diff.split("\n").filter((line) =>
      (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")
    );
    assert.ok(lines.length, rel);
    lines.forEach((line) => {
      assert.match(line, /^[+-]\s*\.home-(bookstore-hero h1|hero-campaign-title)\s*\{?\s*$/, rel + " " + line);
    });
  });
});

if (failed) {
  console.error("\n" + failed + " storefront cards 1B test(s) failed");
  process.exit(1);
}
console.log("storefront-cards-1b-polish-tests ok");
