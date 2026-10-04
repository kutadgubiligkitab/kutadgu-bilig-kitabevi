#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const cssPath = path.join(root, "stage4b2-homepage-discovery.css");
const css = fs.readFileSync(cssPath, "utf8");
const stage4b1 = fs.readFileSync(path.join(root, "stage4b-public-cards.css"), "utf8");
const shopJs = fs.readFileSync(path.join(root, "shop.js"), "utf8");

const HOSTS = ["#homeFeaturedBooks", "#newBooksCarousel", "#premiumDiscoveryResults"];
const FORBIDDEN_PROPS = [
  "aspect-ratio", "object-fit", "object-position",
  "width", "min-width", "max-width",
  "height", "min-height", "max-height",
  "padding", "margin",
  "display", "position", "inset", "top", "left", "right", "bottom",
  "flex", "grid", "align-items", "align-self", "justify-content", "gap",
  "transform"
];
const ALLOWED_PROPS = new Set([
  "color", "font-family", "font-size", "font-weight",
  "background-color", "border-color",
  "outline", "outline-offset", "transition"
]);
const PROTECTED = [
  "index.css", "premium-ux.css",
  "covers.css", "mobile.css", "theme.css", "stage4b-public-cards.css",
  "listing-card-safety.css", "detail-similar-card-safety.css",
  "recently-viewed-card-safety.css", "detail-cover-mobile-safety.css"
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

test("stage4b2-homepage-discovery.css exists", () => {
  assert.ok(fs.existsSync(cssPath));
  assert.match(css, /#homeFeaturedBooks/);
  assert.match(css, /#newBooksCarousel/);
  assert.match(css, /#premiumDiscoveryResults/);
});

test("every production selector is scoped to a homepage discovery host", () => {
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
      const host = HOSTS.find((id) => sel.startsWith(id + " ") || sel.startsWith(id + ".") || sel.startsWith(id + ":"));
      assert.ok(host, "unscoped selector: " + sel);
    }
  }
  assert.doesNotMatch(body, /(?:^|[,{]\s*)\.(?:home-feature-card|home-carousel-card|premium-book-card|premium-card-[a-z-]+|add-to-cart|favorite-button)\b/);
});

test("overlay omits geometry and layout properties", () => {
  const body = stripComments(css);
  const declBlocks = [...body.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
  assert.ok(declBlocks.length > 0);
  for (const block of declBlocks) {
    const decls = block.split(";").map((d) => d.trim()).filter(Boolean);
    for (const decl of decls) {
      const prop = decl.split(":")[0].trim().toLowerCase();
      if (!prop) continue;
      assert.ok(ALLOWED_PROPS.has(prop), "unexpected property: " + prop);
      assert.ok(!FORBIDDEN_PROPS.includes(prop), "forbidden property: " + prop);
    }
  }
});

test("overlay does not target cover frames", () => {
  const body = stripComments(css);
  assert.doesNotMatch(body, /cover-stock-wrap/);
  assert.doesNotMatch(body, /home-feature-cover/);
  assert.doesNotMatch(body, /home-feature-cover-frame/);
  assert.doesNotMatch(body, /home-carousel-cover/);
  assert.doesNotMatch(body, /premium-card-cover/);
});

test("Stage 4B-1 overlay still excludes homepage discovery families", () => {
  const decls = stripComments(stage4b1);
  assert.doesNotMatch(decls, /home-feature|home-carousel|premium-book-card|premium-card/);
});

test("protected CSS and premium-ux.js stay byte-identical to origin/main", () => {
  for (const name of PROTECTED) {
    const diff = execSync(`git diff -- origin/main -- ${name}`, { cwd: root, encoding: "utf8" });
    assert.strictEqual(diff, "", name + " changed");
  }
});

function stripCards1bCartLabel(src) {
  return src.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\"");
}

test("card generators stay unchanged from origin/main except Cards 1B cart labels", () => {
  const mainShop = gitShowMain("shop.js");
  const home = sliceBetween(shopJs, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  const mainHome = sliceBetween(mainShop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  assert.strictEqual(stripCards1bCartLabel(home), stripCards1bCartLabel(mainHome));
  assert.match(home, /cartButton\(b,"🛒 سېۋەتكە","add-to-cart home-feature-cart"\)/);
  // cartButton is not byte-pinned: L1 icon-only aria-label is covered by l1-home-cart-accessible-name-tests.js
  const cartBtn = sliceBetween(shopJs, "function cartButton(book,label=", "function cart(){");
  assert.match(cartBtn, /aria-label="تۈگەپ كەتتى"/);
  assert.match(cartBtn, /replace\(\/\\s\+\/g,""\)==="🛒"/);
  const carousel = sliceBetween(shopJs, "function card(b,i=0){", "const isDual=()=>");
  const mainCarousel = sliceBetween(mainShop, "function card(b,i=0){", "const isDual=()=>");
  assert.strictEqual(stripCards1bCartLabel(carousel), stripCards1bCartLabel(mainCarousel));
  assert.match(carousel, /cartButton\(b,"🛒 سېۋەتكە","home-carousel-cart add-to-cart"\)/);
  const compact = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
  const mainCompact = gitShowMain("premium-ux.js");
  const compactSlice = compactCardSlice(compact);
  const mainSlice = compactCardSlice(mainCompact);
  assert.match(compactSlice, /data-cover-src="\$\{src\}"/);
  assert.match(compactSlice, /data-cover-book="\$\{id\}"/);
  assert.match(compactSlice, /loading="lazy" decoding="async"/);
  assert.match(compactSlice, /<strong>\$\{escapeHtml\(book\.title\)\}<\/strong>/);
  assert.match(compactSlice, /<small>\$\{escapeHtml\(book\.author\|\|"—"\)\}<\/small>/);
  assert.match(compactSlice, /premium-card-price/);
  assert.match(compactSlice, /href="\$\{escapeHtml\(bookHref\(book\)\)\}"/);
  assert.match(compactSlice, /data-premium-favorite="\$\{id\}"/);
  assert.match(compactSlice, /data-premium-cart="\$\{id\}"/);
  assert.strictEqual(normalizePremiumCoverCard(compactSlice), normalizePremiumCoverCard(mainSlice));
  const bind = sliceBetween(compact, "function recoverCachedCoverFailure(img){", "const DISCOVERY_PAGE_SIZE=8;");
  assert.match(bind, /assignCoverImage\(img,src,\{bookId:bookId,loading:img\.getAttribute\("loading"\)\|\|"lazy"\}\)/);
  assert.match(bind, /recoverCachedCoverFailure\(img\)/);
  assert.match(bind, /requestAnimationFrame\(\(\)=>recoverCachedCoverFailure\(img\)\)/);
  assert.match(bind, /!img\.complete\|\|img\.naturalWidth!==0/);
  assert.doesNotMatch(bind, /markMissing/);
  assert.match(bind, /data-premium-favorite/);
  assert.match(bind, /data-premium-cart/);
  assert.match(bind, /toggleFav\?/);
  assert.match(bind, /kutadguShop\?\.add\?/);
});

test("Stage 4B-2 overlay is appended after premium-ux.css and covers.css reload", () => {
  assert.match(shopJs, /premium-ux\.css\?v=10/);
  assert.match(shopJs, /premium-ux\.js\?v=13/);
  assert.match(shopJs, /stage4b2-homepage-discovery\.css\?v=1/);
  assert.match(shopJs, /data-kutadgu-stage4b2-homepage-discovery/);
  assert.match(shopJs, /premium-cart-row-alignment-safety\.css\?v=1/);
  assert.match(shopJs, /data-kutadgu-premium-cart-row-alignment/);
  const ensureCovers = sliceBetween(shopJs, "function ensureCoverSystemCss(){", "function ensureStage4b2HomepageDiscoveryCss(){");
  assert.match(ensureCovers, /covers\.css\?v=2/);
  assert.match(ensureCovers, /ensureStage4b2HomepageDiscoveryCss\(\)/);
  const loadPremium = sliceBetween(shopJs, "function loadPremiumUX(){", "let staticShellReady=false;");
  const premiumAt = loadPremium.indexOf("premium-ux.css?v=10");
  const coversAt = loadPremium.indexOf("ensureCoverSystemCss()");
  const overlayAt = loadPremium.indexOf("ensureStage4b2HomepageDiscoveryCss()");
  const alignmentAt = loadPremium.lastIndexOf("ensurePremiumCartRowAlignmentCss()");
  assert.ok(premiumAt >= 0 && coversAt > premiumAt && overlayAt > coversAt && alignmentAt > overlayAt, "loadPremiumUX order");
  const boot = shopJs.slice(shopJs.indexOf("async function boot(){"));
  const bootPremium = boot.indexOf("await loadPremiumUX()");
  const bootCovers = boot.indexOf("ensureCoverSystemCss();", bootPremium);
  const bootOverlay = boot.indexOf("ensureStage4b2HomepageDiscoveryCss();", bootCovers);
  const bootAlign = boot.indexOf("ensurePremiumCartRowAlignmentCss();", bootOverlay);
  assert.ok(bootPremium >= 0 && bootCovers > bootPremium && bootOverlay > bootCovers && bootAlign > bootOverlay, "boot order");
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
    "STAGE_AI_SEARCH_RPC_SERVER_ONLY.sql","STAGE106_CATALOG_CREDITS.sql","STAGE106_CATALOG_CREDIT_CORRECTIONS.sql","STAGE106_CATALOG_CREDITS_ROLLBACK.sql","STAGE107_BOOK_REVIEWS.sql","STAGE107_BOOK_REVIEWS_ROLLBACK.sql","STAGE108_BOOK_REVIEW_LIMITS_DELETE.sql","STAGE108_BOOK_REVIEW_LIMITS_DELETE_ROLLBACK.sql","STAGE109_BOOK_REVIEW_HEARTS_REPLIES.sql","STAGE109_BOOK_REVIEW_HEARTS_REPLIES_ROLLBACK.sql","STAGE110_BOOK_REVIEW_NOTIFICATIONS.sql","STAGE110_BOOK_REVIEW_NOTIFICATIONS_ROLLBACK.sql"].includes(file)) ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)premium-ux\.css$/i.test(file) ||
    /listing-card-safety|detail-similar-card-safety|recently-viewed-card-safety|detail-cover-mobile-safety|covers\.css|theme\.css|stage4b-public-cards\.css/.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
  if (files.includes("shop.css")) {
    const diff = execSync("git diff origin/main -- shop.css", { cwd: root, encoding: "utf8" });
    const lines = diff.split("\n").filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
    const knownDarkCart = [
      "+/* Dark cart/checkout text only.",
      "+   --site-brown-dark is #171311 in dark mode (a surface color), so prices,",
      "+   totals, and section titles painted with it become black on the dark card.",
      "+   --site-brown (#8d6b52) is also too dim on those same surfaces.",
      "+   Light-mode rules above keep both tokens. */",
      "+body.dark-mode .cart-unit-price,",
      "+body.dark-mode .cart-line-price strong,",
      "+body.dark-mode .cart-total strong,",
      "+body.dark-mode .cart-summary-heading,",
      "+body.dark-mode .cart-summary-row strong,",
      "+body.dark-mode .checkout-section-title,",
      "+body.dark-mode .checkout-member-note a{",
      "+  color:var(--site-text);",
      "+}",
      "+body.dark-mode .checkout-form input::placeholder,",
      "+body.dark-mode .checkout-form textarea::placeholder{",
      "+  color:var(--site-text-soft);",
      "+  opacity:1;",
      "+}",
      "+"
    ];
    const at = lines.findIndex((_, i) => knownDarkCart.every((line, j) => lines[i + j] === line));
    const rest = at < 0 ? lines : lines.slice(0, at).concat(lines.slice(at + knownDarkCart.length));
    const repeated = rest.findIndex((_, i) => knownDarkCart.every((line, j) => rest[i + j] === line));
    const exactDarkCartOnly = at >= 0 && repeated < 0 && rest.length === 0;
    if (!exactDarkCartOnly) {
      const body = lines.join("\n");
      assert.ok(lines.length && lines.every((line) => line.startsWith("-")), body);
      assert.match(body, /\.cover-stock-overlay/);
      assert.doesNotMatch(body, /cover-stock-wrap|stock-badge|book-card|book-image/);
    }
  }
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
  console.error("\n" + failed + " stage4b2 homepage discovery test(s) failed");
  process.exit(1);
}
console.log("stage4b2-homepage-discovery-tests ok");
