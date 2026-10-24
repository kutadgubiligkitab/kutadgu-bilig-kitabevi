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
  assert.match(indexHtml, /shop\.js\?v=180/);
  assert.match(shop, /storefront-cards-1a-polish\.css\?v=3/);
  assert.match(shop, /data-kutadgu-storefront-cards-1a/);
  const ensurePublic = sliceBetween(shop, "function ensurePublicBookCardRowAlignmentCss(){", "function ensureStorefrontCards1aPolishCss(){");
  assert.match(ensurePublic, /ensureStorefrontCards1aPolishCss\(\)/);
  const loadPremium = sliceBetween(shop, "function loadPremiumUX(){", "let staticShellReady=false;");
  const publicAt = loadPremium.lastIndexOf("ensurePublicBookCardRowAlignmentCss()");
  assert.ok(publicAt >= 0);
});

function paidCarouselCard(src) {
  const cut = src.indexOf("\n  function giftCard(b,i=0){");
  const body = cut >= 0 ? src.slice(0, cut) : src;
  return body.replace("    if(mode===\"gifts\")return giftCard(b,i);\n", "").replace(/\s+$/, "");
}

function stripCards1bCartLabel(src) {
  return src.replace(/cartButton\(b,"🛒 سېۋەتكە"/g, "cartButton(b,\"🛒\"");
}

test("ordinary card actions stay while grouped cards use the compact series label", () => {
  const mini = sliceBetween(shop, "function miniCard(b){", "function favoriteCard(b){");
  assert.match(mini, /\$\{cartButton\(b\)\}/);
  assert.match(mini, /SERIES_CARD_DETAIL/);
  assert.doesNotMatch(mini, /volume-group-card-badge|قىسىملارنى كۆرۈش|بېكىتىلگەن يۈرۈشلۈك باھاسى/);
  const home = sliceBetween(shop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  assert.match(home, /cartButton\(b,"🛒 سېۋەتكە","add-to-cart home-feature-cart"\)/);
  assert.match(home, /home-feature-cart">\$\{SERIES_CARD_DETAIL\}/);
  const carouselCard = sliceBetween(shop, "function homeCarouselCard(b,i=0){", "async function setupHomeCarousel(){");
  assert.match(carouselCard, /cartButton\(b,"🛒 سېۋەتكە","home-carousel-cart add-to-cart"\)/);
  assert.match(carouselCard, /class="home-carousel-cart" href="/);
  const carousel = sliceBetween(shop, "function card(b,i=0){", "const isDual=()=>");
  assert.match(carousel, /return homeCarouselCard\(b,i\)/);
  assert.match(carousel, /function giftCard\(b,i=0\)/);
  const giftCard = carousel.slice(carousel.indexOf("function giftCard(b,i=0){"), carousel.indexOf("function giftStateMarkup"));
  assert.match(giftCard, /ھەقسىز قەغەز سوۋغا/);
  assert.doesNotMatch(giftCard, /home-carousel-price|data-cart-id/);
  assert.match(shop, /usesSearchRelevance/);
  const compact = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
  const compactSlice = compactCardSlice(compact);
  assert.match(compactSlice, /data-cover-src="\$\{src\}"/);
  assert.match(compactSlice, /data-cover-book="\$\{id\}"/);
  assert.match(compactSlice, /<strong>\$\{escapeHtml\(book\.title\)\}<\/strong>/);
  assert.match(compactSlice, /<small>\$\{escapeHtml\(book\.author\|\|"—"\)\}<\/small>/);
  assert.match(compactSlice, /premium-card-price/);
  assert.match(compactSlice, /href="\$\{escapeHtml\(bookHref\(book\)\)\}"/);
  assert.match(compactSlice, /data-premium-favorite="\$\{id\}"/);
  assert.match(compactSlice, /data-premium-cart="\$\{id\}"/);
  assert.match(compact, /function seriesCompactCard\(book,src,id\)/);
  assert.match(compact, /data-cover-src="\$\{src\}" data-cover-book="\$\{id\}"/);
  assert.match(compact, /تەپسىلاتى/);
  assert.doesNotMatch(sliceBetween(compact, "function seriesCompactCard(book,src,id){", "function compactCard(book){"), /data-premium-cart|data-premium-favorite/);
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
    (/\.sql$/i.test(file) && file !== "STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION.sql" && file !== "STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql" && file !== "STAGE87_COVER_INTEGRITY.sql" && file !== "STAGE99_BOOK_ENGAGEMENT_VIEW_COUNTS.sql" && file !== "STAGE100_ADMIN_DAILY_VISITORS.sql" && file !== "STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql" && file !== "scripts/stage100-isolated-fixture.sql" && file !== "scripts/stage100-isolated-load.sql" && file !== "scripts/stage100-isolated-assertions.sql" && file !== "scripts/stage100-isolated-rollback-assertions.sql" && file !== "scripts/stage100-isolated-reapply-assertions.sql" && file !== "STAGE101_ADMIN_ZERO_SEARCHES.sql" && file !== "STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql" && file !== "scripts/stage101-isolated-assertions.sql" && file !== "scripts/stage101-isolated-rollback-assertions.sql" && file !== "STAGE103_BLOCK_BOOK_COVER_STORAGE_WRITES.sql" && file !== "STAGE104_REWRITE_BOOK_IMAGE_URLS.sql" && file !== "STAGE_AI_SEARCH_RPC_SERVER_ONLY.sql" && file !== "STAGE106_CATALOG_CREDITS.sql" && file !== "STAGE106_CATALOG_CREDIT_CORRECTIONS.sql" && file !== "STAGE106_CATALOG_CREDITS_ROLLBACK.sql" && file !== "STAGE107_BOOK_REVIEWS.sql" && file !== "STAGE107_BOOK_REVIEWS_ROLLBACK.sql" && file !== "STAGE108_BOOK_REVIEW_LIMITS_DELETE.sql" && file !== "STAGE108_BOOK_REVIEW_LIMITS_DELETE_ROLLBACK.sql" && file !== "STAGE109_BOOK_REVIEW_HEARTS_REPLIES.sql" && file !== "STAGE109_BOOK_REVIEW_HEARTS_REPLIES_ROLLBACK.sql" && file !== "STAGE110_BOOK_REVIEW_NOTIFICATIONS.sql" && file !== "STAGE110_BOOK_REVIEW_NOTIFICATIONS_ROLLBACK.sql" && file !== "STAGE111_BOOK_REVIEW_PAGES.sql" && file !== "STAGE111_BOOK_REVIEW_PAGES_ROLLBACK.sql" && file !== "STAGE120_WEBSITE_FEEDBACK.sql" && file !== "STAGE120_WEBSITE_FEEDBACK_ROLLBACK.sql" && file !== "STAGE121_CART_SHARE_PERMISSIONS.sql" && file !== "STAGE121_CART_SHARE_PERMISSIONS_ROLLBACK.sql" && file !== "STAGE122_GIFT_BOOK_OFFERS.sql" && file !== "STAGE122_GIFT_BOOK_OFFERS_ROLLBACK.sql" && file !== "STAGE117_VISIT_COUNTRIES.sql" && file !== "STAGE117_VISIT_COUNTRIES_ROLLBACK.sql" && file !== "scripts/stage117-isolated-assertions.sql" && file !== "scripts/stage117-isolated-coverage-failure.sql" && file !== "scripts/stage117-isolated-coverage-recovery.sql") ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)premium-ux\.css$/i.test(file) ||
    /listing-card-safety|detail-similar-card-safety|recently-viewed-card-safety|covers\.css|theme\.css|catalog\.js$/.test(file)
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
    const volumeSetPriceOnly = lines.length === 2
      && lines[0] === "-.volume-set-price strong{font-size:18px;color:var(--site-brown-dark,#4b3327)}"
      && lines[1] === "+.volume-set-price strong{font-size:18px;color:var(--site-text,#44352d)}";
    const selectionSummaryOnly = lines.length === 3
      && lines[0] === "-.volume-selection-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:10px 12px;border-radius:10px;background:var(--site-bg-soft,#fbf8f2)}"
      && lines[1] === "+.volume-selection-summary{display:grid;gap:4px;align-items:start;padding:10px 12px;border-radius:10px;background:var(--site-bg-soft,#fbf8f2)}"
      && lines[2] === "+.volume-selection-summary strong{color:var(--site-text,#44352d)}";
    if (selectionSummaryOnly) {
      assert.match(lines[2], /var\(--site-text,#44352d\)/);
    } else if (volumeSetPriceOnly) {
      assert.match(lines[1], /var\(--site-text,#44352d\)/);
    } else if (!exactDarkCartOnly) {
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
  console.error("\n" + failed + " storefront cards 1A test(s) failed");
  process.exit(1);
}
console.log("storefront-cards-1a-polish-tests ok");
