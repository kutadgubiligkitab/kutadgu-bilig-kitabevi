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

const HOSTS = [
  ".books-grid[data-catalog-source]",
  "#premiumDiscoveryResults",
  "#premiumWizardResults",
  "[data-people-also-viewed]",
  "#searchResults",
  "#newBooksCarousel",
  "#homeFeaturedBooks",
  "#homeShopSections",
  "#myBooksApp",
  "#favoritesList",
  "[data-detail-related]",
  "[data-recently-viewed]"
];

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

test("overlay exists, is host-scoped, and avoids unscoped .card/.book rules", () => {
  assert.ok(fs.existsSync(path.join(root, "storefront-cards-1a-polish.css")));
  const selectorChunks = body.split("{").slice(0, -1).map((chunk) => {
    const parts = chunk.split("}");
    return parts[parts.length - 1].trim();
  }).filter(Boolean);
  assert.ok(selectorChunks.length > 0);
  for (const chunk of selectorChunks) {
    if (chunk.startsWith("@")) continue;
    const selectors = chunk.split(",").map((s) => s.replace(/@media[^{]*/g, "").trim()).filter(Boolean);
    for (const sel of selectors) {
      const stripped = sel.replace(/^body\.dark-mode\s+/, "");
      const ok = HOSTS.some((host) => stripped.startsWith(host));
      assert.ok(ok, "unscoped selector: " + sel);
      assert.doesNotMatch(sel, /(?:^|[\s,])\.(?:card|book)(?:\s|$|\.|\[)/);
    }
  }
});

test("cover rules keep contain and do not crop or stretch", () => {
  assert.match(body, /object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(body, /object-fit:\s*cover/);
  assert.match(body, /object-position:\s*center center\s*!important/);
  assert.match(body, /max-width:\s*100%\s*!important/);
  assert.match(body, /max-height:\s*100%\s*!important/);
});

test("titles clamp to two lines with reserved height and Uyghur-safe line-height", () => {
  assert.match(body, /-webkit-line-clamp:\s*2/);
  assert.match(body, /line-clamp:\s*2/);
  assert.match(body, /min-height:\s*calc\(1\.75em \* 2\)/);
  assert.match(body, /line-height:\s*1\.75/);
  assert.match(body, /\.book-title/);
  assert.match(body, /#premiumDiscoveryResults \.premium-card-link strong/);
  assert.match(body, /#newBooksCarousel \.home-carousel-title/);
  assert.match(body, /#homeFeaturedBooks \.home-feature-title/);
  assert.match(body, /#searchResults \.advanced-search-title/);
});

test("author and price areas have predictable height", () => {
  assert.match(body, /\.book-author\{[\s\S]*min-height:\s*1\.7em/);
  assert.match(body, /\.book-price\{[\s\S]*min-height:\s*1\.5em/);
  assert.match(body, /#homeFeaturedBooks \.home-feature-author\{[\s\S]*min-height:\s*1\.7em/);
  assert.match(body, /#newBooksCarousel \.home-carousel-price\{[\s\S]*min-height:\s*1\.5em/);
});

test("does not change grid column counts or invent discount UI", () => {
  assert.doesNotMatch(body, /grid-template-columns/);
  assert.doesNotMatch(body, /original-price|compare-at|discount/);
});

test("dark mode uses theme tokens", () => {
  assert.match(body, /body\.dark-mode/);
  assert.match(body, /color:\s*var\(--site-text\)/);
  assert.match(body, /color:\s*var\(--site-text-soft\)/);
});

test("shop.js loads polish CSS last after public row-alignment overlay", () => {
  assert.match(indexHtml, /shop\.js\?v=128/);
  assert.match(shop, /storefront-cards-1a-polish\.css\?v=2/);
  assert.match(shop, /data-kutadgu-storefront-cards-1a/);
  const ensurePublic = sliceBetween(shop, "function ensurePublicBookCardRowAlignmentCss(){", "function ensureStorefrontCards1aPolishCss(){");
  assert.match(ensurePublic, /ensureStorefrontCards1aPolishCss\(\)/);
  const loadPremium = sliceBetween(shop, "function loadPremiumUX(){", "let staticShellReady=false;");
  const publicAt = loadPremium.lastIndexOf("ensurePublicBookCardRowAlignmentCss()");
  assert.ok(publicAt >= 0);
});

function stripCards1bCartLabel(src) {
  return src.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\"");
}

test("card generators and Search 1A rank helper stay unchanged except Cards 1B cart labels", () => {
  const mainShop = execSync("git show origin/main:shop.js", { cwd: root, encoding: "utf8" });
  assert.strictEqual(
    sliceBetween(shop, "function miniCard(b){", "function favoriteCard(b){"),
    sliceBetween(mainShop, "function miniCard(b){", "function favoriteCard(b){")
  );
  const home = sliceBetween(shop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  const mainHome = sliceBetween(mainShop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  assert.strictEqual(stripCards1bCartLabel(home), stripCards1bCartLabel(mainHome));
  assert.match(home, /cartButton\(b,"🛒 سېۋەتكە","add-to-cart home-feature-cart"\)/);
  const carousel = sliceBetween(shop, "function card(b,i=0){", "const isDual=()=>");
  const mainCarousel = sliceBetween(mainShop, "function card(b,i=0){", "const isDual=()=>");
  assert.strictEqual(stripCards1bCartLabel(carousel), stripCards1bCartLabel(mainCarousel));
  assert.match(carousel, /cartButton\(b,"🛒 سېۋەتكە","home-carousel-cart add-to-cart"\)/);
  assert.match(shop, /usesSearchRelevance/);
  const compact = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
  const mainCompact = execSync("git show origin/main:premium-ux.js", { cwd: root, encoding: "utf8" });
  assert.strictEqual(
    sliceBetween(compact, "function compactCard(book){", "function bindCards(scope){"),
    sliceBetween(mainCompact, "function compactCard(book){", "function bindCards(scope){")
  );
  const cfg = fs.readFileSync(path.join(root, "app-config.js"), "utf8");
  assert.match(cfg, /id:"parenting"/);
  assert.match(cfg, /id:"textbooks"/);
  assert.match(cfg, /categories:\["بالىلار كىتابلىرى"\]/);
});

test("14 no SQL RLS auth or database-record changes; protected geometry files untouched", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && file !== "STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION.sql" && file !== "STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql" && file !== "STAGE87_COVER_INTEGRITY.sql" && file !== "STAGE99_BOOK_ENGAGEMENT_VIEW_COUNTS.sql") ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)premium-ux\.css$/i.test(file) ||
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
  console.error("\n" + failed + " storefront cards 1A test(s) failed");
  process.exit(1);
}
console.log("storefront-cards-1a-polish-tests ok");
