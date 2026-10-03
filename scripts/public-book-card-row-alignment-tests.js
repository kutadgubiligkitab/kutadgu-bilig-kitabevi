#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const cssPath = path.join(root, "public-book-card-row-alignment-safety.css");
const css = fs.readFileSync(cssPath, "utf8");
const shopJs = fs.readFileSync(path.join(root, "shop.js"), "utf8");

const HOSTS = [
  "#premiumWizardResults",
  "[data-people-also-viewed]",
  "#searchResults",
  "#myBooksApp",
  "#homeShopSections",
  "#newBooksCarousel",
  "#homeFeaturedBooks",
  "#favoritesList"
];

const PROTECTED = [
  "listing-card-safety.css",
  "detail-similar-card-safety.css",
  "recently-viewed-card-safety.css",
  "detail-cover-mobile-safety.css",
  "stage4b-public-cards.css",
  "stage4b2-homepage-discovery.css",
  "premium-cart-row-alignment-safety.css",
  "premium-ux.css"
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

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function gitShowMain(file) {
  return execSync(`git show origin/main:${file}`, { cwd: root, encoding: "utf8" });
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function compactCardSlice(src) {
  const startNeedle = "function compactCard(book){";
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, startNeedle);
  const ends = ["function recoverCachedCoverFailure(img){", "function bindCards(scope){"]
    .map((needle) => src.indexOf(needle, start + startNeedle.length))
    .filter((index) => index > start);
  assert.ok(ends.length > 0, "compactCard end");
  return src.slice(start, Math.min(...ends));
}

function normalizePremiumCoverCard(src) {
  return src
    .replace("    const src=cover(book);\n    const id=escapeHtml(book.id);\n", "")
    .replace(/\$\{id\}/g, "${escapeHtml(book.id)}")
    .replace(' src="${src}" data-cover-src="${src}" data-cover-book="${escapeHtml(book.id)}"', ' src="${cover(book)}"');
}

test("public-book-card-row-alignment-safety.css exists with family contracts", () => {
  assert.ok(fs.existsSync(cssPath));
  const body = stripComments(css);
  assert.match(body, /#premiumWizardResults \.premium-book-grid/);
  assert.match(body, /\[data-people-also-viewed\] \.premium-book-grid/);
  assert.match(body, /#searchResults \.premium-empty-books/);
  assert.match(body, /#myBooksApp \.mybooks-grid:not\(\[data-recently-viewed\]\)/);
  assert.match(body, /#newBooksCarousel \.home-carousel-info/);
  assert.match(body, /#homeFeaturedBooks \.home-featured-grid\.is-marquee \.home-featured-track/);
  assert.match(body, /#favoritesList \.favorites-grid/);
  assert.match(body, /align-items:\s*stretch/);
  assert.match(body, /align-self:\s*stretch/);
  assert.match(body, /flex:\s*1 1 auto/);
  assert.match(body, /height:\s*auto/);
});

test("every production selector is host-scoped", () => {
  const body = stripComments(css);
  const selectorChunks = body.split("{").slice(0, -1).map((chunk) => {
    const parts = chunk.split("}");
    return parts[parts.length - 1].trim();
  }).filter(Boolean);
  assert.ok(selectorChunks.length > 0, "expected rules");
  for (const chunk of selectorChunks) {
    if (chunk.startsWith("@")) continue;
    const selectors = chunk.split(",").map((s) => s.replace(/@media[^{]*/g, "").trim()).filter(Boolean);
    for (const sel of selectors) {
      const host = HOSTS.find((id) => sel.startsWith(id + " ") || sel.startsWith(id + ".") || sel.startsWith(id + ":") || sel === id);
      assert.ok(host, "unscoped selector: " + sel);
    }
  }
});

test("new stylesheet omits global card/cart selectors and cover geometry", () => {
  const body = stripComments(css);
  assert.doesNotMatch(body, /(?:^|[,{]\s*)\.(?:add-to-cart|premium-book-card|shop-mini-card|favorite-card)\b/);
  assert.doesNotMatch(body, /object-fit/);
  assert.doesNotMatch(body, /aspect-ratio/);
  assert.doesNotMatch(body, /premium-card-cover|home-carousel-cover|home-feature-cover|favorite-cover|\bimg\b/);
  assert.doesNotMatch(body, /height:\s*100%/);
  const withoutCarouselBottom = body.replace(/#newBooksCarousel \.home-carousel-bottom\s*\{[^}]*\}/g, "");
  assert.doesNotMatch(withoutCarouselBottom, /margin-top:\s*auto/);
  assert.match(body, /#newBooksCarousel \.home-carousel-bottom\s*\{[^}]*margin-top:\s*auto/);
  assert.match(body, /#homeFeaturedBooks \.home-feature-bottom/);
  assert.doesNotMatch(body, /justify-content:\s*space-between/);
  assert.doesNotMatch(body, /height:\s*\d+px/);
});

test("protected safety files stay byte-identical to origin/main", () => {
  for (const name of PROTECTED) {
    const diff = execSync(`git diff -- origin/main -- ${name}`, { cwd: root, encoding: "utf8" });
    assert.strictEqual(diff, "", name + " changed");
  }
});

test("card generators stay unchanged from origin/main", () => {
  const mainShop = gitShowMain("shop.js");
  assert.strictEqual(
    sliceBetween(shopJs, "function miniCard(b){", "function favoriteCard(b){"),
    sliceBetween(mainShop, "function miniCard(b){", "function favoriteCard(b){")
  );
  assert.strictEqual(
    sliceBetween(shopJs, "function favoriteCard(b){", "function renderFavoritesPage(){"),
    sliceBetween(mainShop, "function favoriteCard(b){", "function renderFavoritesPage(){")
  );
  const home = sliceBetween(shopJs, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  const mainHome = sliceBetween(mainShop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  assert.strictEqual(
    home.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\""),
    mainHome.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\"")
  );
  assert.match(home, /cartButton\(b,"🛒 سېۋەتكە","add-to-cart home-feature-cart"\)/);
  assert.strictEqual(
    sliceBetween(shopJs, "function bookCardMarkup(b,variant=\"listing\",coverOpts={}){", "function searchResultCard(b){"),
    sliceBetween(mainShop, "function bookCardMarkup(b,variant=\"listing\",coverOpts={}){", "function searchResultCard(b){")
  );
  const carousel = sliceBetween(shopJs, "function card(b,i=0){", "const isDual=()=>");
  const mainCarousel = sliceBetween(mainShop, "function card(b,i=0){", "const isDual=()=>");
  assert.strictEqual(
    carousel.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\""),
    mainCarousel.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\"")
  );
  assert.match(carousel, /cartButton\(b,"🛒 سېۋەتكە","home-carousel-cart add-to-cart"\)/);
  const compact = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
  const mainCompact = gitShowMain("premium-ux.js");
  const compactSlice = compactCardSlice(compact);
  const mainSlice = compactCardSlice(mainCompact);
  assert.match(compactSlice, /data-cover-src="\$\{src\}"/);
  assert.match(compactSlice, /data-cover-book="\$\{id\}"/);
  assert.match(compactSlice, /<strong>\$\{escapeHtml\(book\.title\)\}<\/strong>/);
  assert.match(compactSlice, /<small>\$\{escapeHtml\(book\.author\|\|"—"\)\}<\/small>/);
  assert.match(compactSlice, /premium-card-price/);
  assert.match(compactSlice, /href="\$\{escapeHtml\(bookHref\(book\)\)\}"/);
  assert.match(compactSlice, /data-premium-favorite="\$\{id\}"/);
  assert.match(compactSlice, /data-premium-cart="\$\{id\}"/);
  assert.strictEqual(normalizePremiumCoverCard(compactSlice), normalizePremiumCoverCard(mainSlice));
});

test("public alignment CSS loads last after premium cart-row safety", () => {
  assert.match(shopJs, /public-book-card-row-alignment-safety\.css\?v=1/);
  assert.match(shopJs, /data-kutadgu-public-book-card-row-alignment/);
  const loadPremium = sliceBetween(shopJs, "function loadPremiumUX(){", "let staticShellReady=false;");
  const premiumAt = loadPremium.indexOf("premium-ux.css?v=10");
  const cartRowAt = loadPremium.indexOf("ensurePremiumCartRowAlignmentCss()");
  const publicAt = loadPremium.lastIndexOf("ensurePublicBookCardRowAlignmentCss()");
  assert.ok(premiumAt >= 0 && cartRowAt > premiumAt && publicAt > cartRowAt, "loadPremiumUX order");
  const ensureCart = sliceBetween(shopJs, "function ensurePremiumCartRowAlignmentCss(){", "function ensurePublicBookCardRowAlignmentCss(){");
  assert.match(ensureCart, /ensurePublicBookCardRowAlignmentCss\(\)/);
  const boot = shopJs.slice(shopJs.indexOf("async function boot(){"));
  const bootCart = boot.indexOf("ensurePremiumCartRowAlignmentCss();");
  const bootPublic = boot.indexOf("ensurePublicBookCardRowAlignmentCss();", bootCart);
  assert.ok(bootCart >= 0 && bootPublic > bootCart, "boot order");
});

test("this slice does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && !["SITE_HOMEPAGE_ABOUT.sql","SITE_ANNOUNCEMENT_BAR.sql","SITE_HERO_MANAGEMENT.sql","STAGE9_ANALYTICS_INSERT_RLS.sql","STAGE4_ANALYTICS_RPC_FIX.sql","STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql","STAGE2C_AAL2_ADMIN_SELECT_RLS.sql","STAGE8_STORE_ANALYTICS.sql","STAGE46_ANALYTICS_LEGACY_ID.sql","STAGE91_ADMIN_IMPORT_SCALE.sql","STAGE92_BOOK_STAFF_SECURITY.sql","STAGE93_BOOK_STAFF_GALLERY.sql","STAGE94_PENDING_BOOK_EDIT.sql","SITE_SHOP_HOURS.sql","SUPABASE_SETUP.sql","DATABASE_UPGRADE_V10.sql","STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION.sql","STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql","STAGE87_COVER_INTEGRITY.sql","STAGE99_BOOK_ENGAGEMENT_VIEW_COUNTS.sql","STAGE100_ADMIN_DAILY_VISITORS.sql","STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql","scripts/stage100-isolated-fixture.sql","scripts/stage100-isolated-load.sql","scripts/stage100-isolated-assertions.sql","scripts/stage100-isolated-rollback-assertions.sql","scripts/stage100-isolated-reapply-assertions.sql",
    "STAGE101_ADMIN_ZERO_SEARCHES.sql",
    "STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql",
    "scripts/stage101-isolated-assertions.sql",
    "scripts/stage101-isolated-rollback-assertions.sql",
    "STAGE103_BLOCK_BOOK_COVER_STORAGE_WRITES.sql",
    "STAGE104_REWRITE_BOOK_IMAGE_URLS.sql",
    "STAGE_AI_SEARCH_RPC_SERVER_ONLY.sql","STAGE106_CATALOG_CREDITS.sql","STAGE106_CATALOG_CREDIT_CORRECTIONS.sql","STAGE106_CATALOG_CREDITS_ROLLBACK.sql"].includes(file)) ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)premium-ux\.css$/i.test(file) ||
    /listing-card-safety|detail-similar-card-safety|recently-viewed-card-safety|detail-cover-mobile-safety|stage4b-public-cards|stage4b2-homepage-discovery\.css|premium-cart-row-alignment-safety/.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
});

if (failed) {
  console.error("\n" + failed + " public book-card row alignment test(s) failed");
  process.exit(1);
}
console.log("public-book-card-row-alignment-tests ok");
