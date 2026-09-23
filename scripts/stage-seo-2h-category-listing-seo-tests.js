#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sitemap = require("../kutadgu-sitemap.js");
const seo = require("../kutadgu-book-seo.js");

const ICON = '<link rel="icon" type="image/png" href="/kutadgu-logo.png">';
const LIT_CHILDREN = [
  "romanlar",
  "tarikhiy-romanlar",
  "sheirlar",
  "hekayiler",
  "dastanlar",
  "dunya-edebiyati"
];
const FAKE_CLAIM = /دانە|ئېتىبار|ئەرزان|ھەقسىز يەتكۈزۈش|ئەڭ ئاۋات|ئەڭ كۆپ سېتىلغان|bestseller|#1|ranking/i;
const FROZEN = {
  "shop.js": "f4f040bb8d1e0cfa0cb881a7411e9cf1b7db043ab61e98f1322a55208b7cd8ab",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "kutadgu-book-seo.js": "bd97183c340ee91b02162e72c59b2e73a7a675319a89285a5037ed6ddacba8d1",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
  "book-shell.html": "685b3d7e3065d832f4922f6268c1cfbf7a2eb1325a443598cb3946ab86184aac",
  "index.html": "caee90498fc0ef3f6c128efe6b915559a59be659d9f1264e2bc4521c5c5fbc4d",
  "home-hero-content.js": "dddb9141d6b06414b44577524473dd48d28a7021f64abfcbac5c3f6ce0ad023b",
  "vercel.json": "b51d5f9089a7a7eee23de77b07115bcbf351f312cf7e7f3c608e14cd707e4665",
  "kutadgu-logo.png": "ca0afbb2b5f4a7552073520c13215cfbf4254eb5a81eca7ac0b53b10f6e777c9"
};

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

function sha256(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex");
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function gitShow(rel) {
  return execSync(`git show origin/main:${rel}`, { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

function attr(html, re) {
  const match = String(html || "").match(re);
  return match ? match[1] : "";
}

function count(html, re) {
  return (String(html || "").match(re) || []).length;
}

function introText(html) {
  const match = String(html || "").match(/<p class="category-hub-intro">([\s\S]*?)<\/p>/);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function navBlock(html) {
  const match = String(html || "").match(/<nav class="category-hub-nav"[^>]*>([\s\S]*?)<\/nav>/);
  return match ? match[0] : "";
}

function navHrefs(html) {
  const block = navBlock(html);
  return [...block.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

function jsonLd(html) {
  const match = String(html || "").match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  return match ? match[1].trim() : "";
}

function catalogAttrs(html) {
  const grid = String(html || "").match(/<div class="books-grid"[^>]*>/);
  return grid ? grid[0] : "";
}

const HUBS = [...sitemap.CATEGORY_HUB_SLUGS];
const PUBLIC_LISTINGS = ["books"];
const pages = Object.fromEntries(HUBS.map((slug) => [slug, read(`${slug}.html`)]));
const baseline = Object.fromEntries(HUBS.map((slug) => [slug, gitShow(`${slug}.html`)]));
const listingPages = Object.fromEntries(PUBLIC_LISTINGS.map((slug) => [slug, read(`${slug}.html`)]));
const listingBaseline = Object.fromEntries(PUBLIC_LISTINGS.map((slug) => [slug, gitShow(`${slug}.html`)]));
const css = read("category-hub-seo.css");

test("trusted public hubs match sitemap and SEO helper, and /books is a separate public listing", () => {
  assert.deepStrictEqual([...seo.CATEGORY_HUB_SLUGS], HUBS);
  assert.deepStrictEqual(HUBS, [
    "adabiyat",
    "romanlar",
    "tarikhiy-romanlar",
    "sheirlar",
    "hekayiler",
    "dastanlar",
    "dunya-edebiyati",
    "adabiyat-roman",
    "uyghur-adabiyati",
    "universal",
    "tibb",
    "derslik",
    "terbiye",
    "dini",
    "children",
    "dictionary",
    "grammar"
  ]);
  assert.ok(!HUBS.includes("books"), "books stays a global listing, not a category hub slug");
  assert.ok(sitemap.PUBLIC_PAGE_PATHS.includes("/books"));
  assert.ok(fs.existsSync(path.join(root, "books.html")));
});

HUBS.forEach((slug) => {
  test(`${slug}: first-byte SEO structure, favicon, intro, and listing attrs`, () => {
    const html = pages[slug];
    const old = baseline[slug];
    assert.match(html, /lang="ug"/);
    assert.match(html, /dir="rtl"/);
    assert.strictEqual(count(html, /<h1\b/gi), 1);
    assert.strictEqual(count(html, /rel=["']canonical["']/gi), 1);
    assert.strictEqual(
      attr(html, /<link rel="canonical" href="([^"]+)"/),
      `https://www.kutadgubilik.com/${slug}`
    );
    assert.match(html, /<meta name="robots" content="index, follow"/);
    assert.strictEqual(count(html, /rel=["']icon["']/gi), 1);
    assert.ok(html.includes(ICON), "exact favicon tag");
    assert.strictEqual(attr(html, /<title>([\s\S]*?)<\/title>/), attr(old, /<title>([\s\S]*?)<\/title>/));
    assert.strictEqual(
      attr(html, /<meta name="description" content="([^"]*)"/),
      attr(old, /<meta name="description" content="([^"]*)"/)
    );
    assert.strictEqual(jsonLd(html), jsonLd(old));
    assert.match(html, /"@type":"CollectionPage"/);
    assert.strictEqual(count(html, /class="category-hub-intro"/g), 1);
    assert.strictEqual(count(html, /class="category-hub-nav"/g), 1);
    const intro = introText(html);
    assert.ok(intro.length >= 24, "intro too thin");
    assert.doesNotMatch(intro, FAKE_CLAIM);
    assert.doesNotMatch(html, /<p class="category-hub-intro"[^>]*(hidden|aria-hidden="true")/);
    assert.match(html, /href="\/category-hub-seo\.css\?v=1"/);
    assert.match(html, /shop\.js\?v=128/);
    assert.strictEqual(
      attr(html, /data-catalog-source="([^"]*)"/),
      attr(old, /data-catalog-source="([^"]*)"/)
    );
    assert.strictEqual(
      attr(html, /data-catalog-sources="([^"]*)"/) || "",
      attr(old, /data-catalog-sources="([^"]*)"/) || ""
    );
    if (slug === "adabiyat") {
      assert.match(catalogAttrs(html), /data-adabiyat-hub="1"/);
      assert.match(
        catalogAttrs(html),
        /data-catalog-sources="romanlar.html,tarikhiy-romanlar.html,sheirlar.html,hekayiler.html,dastanlar.html,dunya-edebiyati.html"/
      );
    }
    const hrefs = navHrefs(html);
    assert.ok(hrefs.length >= 2 && hrefs.length <= 8, `${slug} nav size ${hrefs.length}`);
    hrefs.forEach((href) => {
      assert.match(href, /^\/([a-z0-9-]+)?$/);
      assert.doesNotMatch(href, /^javascript:/i);
    });
    assert.ok(hrefs.includes("/"), `${slug} missing homepage link`);
    const grid = html.slice(html.indexOf('class="books-grid"'), html.indexOf("</section>", html.indexOf('class="books-grid"')));
    assert.match(grid, /book-card is-skeleton/);
    assert.doesNotMatch(grid, /<img\b/i);
  });
});

test("/books public global listing gets first-byte favicon and intro without becoming a category hub", () => {
  const html = listingPages.books;
  const old = listingBaseline.books;
  assert.match(html, /lang="ug"/);
  assert.match(html, /dir="rtl"/);
  assert.strictEqual(count(html, /<h1\b/gi), 1);
  assert.strictEqual(count(html, /rel=["']canonical["']/gi), 1);
  assert.strictEqual(
    attr(html, /<link rel="canonical" href="([^"]+)"/),
    "https://www.kutadgubilik.com/books"
  );
  assert.match(html, /<meta name="robots" content="index, follow"/);
  assert.strictEqual(count(html, /rel=["']icon["']/gi), 1);
  assert.ok(html.includes(ICON), "exact favicon tag");
  assert.strictEqual(attr(html, /<title>([\s\S]*?)<\/title>/), attr(old, /<title>([\s\S]*?)<\/title>/));
  assert.strictEqual(
    attr(html, /<meta name="description" content="([^"]*)"/),
    attr(old, /<meta name="description" content="([^"]*)"/)
  );
  assert.strictEqual(jsonLd(html), jsonLd(old));
  assert.match(html, /"@type":"CollectionPage"/);
  assert.strictEqual(count(html, /class="category-hub-intro"/g), 1);
  assert.strictEqual(count(html, /class="category-hub-nav"/g), 0);
  const intro = introText(html);
  assert.ok(intro.length >= 24, "intro too thin");
  assert.match(intro, /بارلىق كىتابلار/);
  assert.match(intro, /WhatsApp/);
  assert.doesNotMatch(intro, FAKE_CLAIM);
  assert.doesNotMatch(html, /<p class="category-hub-intro"[^>]*(hidden|aria-hidden="true")/);
  assert.match(html, /href="\/category-hub-seo\.css\?v=1"/);
  assert.match(html, /shop\.js\?v=128/);
  assert.match(html, /class="books-grid" data-catalog-source=""/);
  assert.strictEqual(attr(html, /data-catalog-source="([^"]*)"/), "");
  assert.strictEqual(attr(old, /data-catalog-source="([^"]*)"/), "");
  assert.ok(!attr(html, /data-catalog-sources="([^"]*)"/));
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/books"/);
  const grid = html.slice(html.indexOf('class="books-grid"'), html.indexOf("</section>", html.indexOf('class="books-grid"')));
  assert.match(grid, /book-card is-skeleton/);
  assert.doesNotMatch(grid, /<img\b/i);
});

test("visible intros are page-specific and not duplicated", () => {
  const texts = [
    ...HUBS.map((slug) => introText(pages[slug])),
    ...PUBLIC_LISTINGS.map((slug) => introText(listingPages[slug]))
  ];
  const unique = new Set(texts);
  assert.strictEqual(unique.size, HUBS.length + PUBLIC_LISTINGS.length, "duplicate listing intros");
});

test("/adabiyat first-byte nav lists literature children", () => {
  const hrefs = navHrefs(pages.adabiyat);
  assert.deepStrictEqual(hrefs, [
    "/",
    "/romanlar",
    "/tarikhiy-romanlar",
    "/sheirlar",
    "/hekayiler",
    "/dastanlar",
    "/dunya-edebiyati"
  ]);
});

LIT_CHILDREN.forEach((slug) => {
  test(`/${slug} links back to /adabiyat and keeps sibling literature links`, () => {
    const hrefs = navHrefs(pages[slug]);
    assert.ok(hrefs.includes("/"));
    assert.ok(hrefs.includes("/adabiyat"));
    LIT_CHILDREN.forEach((sib) => assert.ok(hrefs.includes(`/${sib}`), `${slug} missing /${sib}`));
    assert.match(navBlock(pages[slug]), new RegExp(`href="/${slug}"[^>]*aria-current="page"`));
    assert.match(pages[slug], /class="back-button"[^>]*href="\/adabiyat"/);
  });
});

test("other category hubs keep a short homepage/category nav", () => {
  assert.deepStrictEqual(navHrefs(pages["adabiyat-roman"]), ["/", "/adabiyat", "/romanlar"]);
  assert.deepStrictEqual(navHrefs(pages["uyghur-adabiyati"]), ["/", "/adabiyat"]);
  [
    "universal",
    "tibb",
    "derslik",
    "terbiye",
    "dini",
    "children",
    "dictionary",
    "grammar"
  ].forEach((slug) => {
    assert.deepStrictEqual(navHrefs(pages[slug]), ["/", "/books"]);
  });
});

test("shared CSS keeps intro/nav visible in the cream/brown theme", () => {
  assert.match(css, /\.category-hub-intro\s*\{/);
  assert.match(css, /\.category-hub-nav\s*\{/);
  assert.doesNotMatch(css, /\.category-hub-intro[^{]*\{[^}]*display\s*:\s*none/);
  assert.doesNotMatch(css, /\.category-hub-intro[^{]*\{[^}]*visibility\s*:\s*hidden/);
  assert.doesNotMatch(css, /\.category-hub-intro[^{]*\{[^}]*font-size\s*:\s*0/);
  assert.match(css, /#f6f0e5|#44352d|#4b3327|#fffdf9|#e8dccb/);
});

test("protected product files stay frozen and out of this diff", () => {
  Object.keys(FROZEN).forEach((rel) => {
    assert.strictEqual(sha256(rel), FROZEN[rel], rel);
  });
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  [

    "kutadgu-search-rank.js",
    "kutadgu-ai-search.js",
    "api/ai-search.js",
    "kutadgu-book-seo.js",
    "kutadgu-public-book.js",
    "api/book-public.js",
    "book-shell.html",
    "index.html",
    "vercel.json",

    "favorites.js",
    "member.js",
    "cart.js"
  ].forEach((rel) => {
    assert.ok(!files.includes(rel), rel);
  });
  const allowed = new Set([
    ...HUBS.map((slug) => `${slug}.html`),
    ...PUBLIC_LISTINGS.map((slug) => `${slug}.html`),
    "category-hub-seo.css",
    "scripts/stage-seo-2h-category-listing-seo-tests.js",
    "package.json",
    "kutadgu-ai-search-ui.js",
    "ai-search-ui.css",
    "scripts/stage-ai-search-1f-preview-ui-tests.js",
    "scripts/stage-ai-search-cover-fallback-tests.js",
    "scripts/stage-ai-search-results-grid-tests.js",
    "scripts/stage-ai-search-conflicting-empty-state-tests.js",
    "tests/e2e/ai-search-cover-fallback.spec.js",
    "tests/e2e/ai-search-results-grid.spec.js",
    "tests/e2e/ai-search-conflicting-empty-state.spec.js",
    "scripts/stage-seo-2a-server-rendered-book-seo-tests.js",
    "scripts/stage-seo-2b-homepage-h1-tests.js",
    "scripts/stage-seo-2b2-visible-homepage-h1-tests.js",
    "scripts/stage-seo-2c-book-first-byte-content-tests.js",
    "scripts/stage-seo-2d-favicon-tests.js",
    "scripts/stage-seo-2e-book-meta-descriptions-tests.js",
    "scripts/stage-seo-2f-first-byte-book-details-tests.js",
    "STAGE87_COVER_INTEGRITY.sql",
    "admin.js",
    "shop.js",
    "book-staff.js",
    "admin-catalog-productivity.js",
    "premium-ux.js",
    "scripts/audit-book-covers.js",
    "scripts/admin-catalog-productivity-tests.js",
    "scripts/security-hardening-2a-tests.js",
    "tests/e2e/admin-cover-stale-state.spec.js",
    "tests/e2e/cover-book-binding.spec.js",
    "supabase-config.js",
    "carousel-sample-cover.png",
    "sample-book-cover(1).png",
    "scripts/cover-integrity-guard-tests.js",
    "scripts/cover-load-resilience-tests.js",
    "scripts/adabiyat-hub-tests.js",
    "scripts/admin-book-staff-tests.js",
    "scripts/admin-navigation-tests.js",
    "scripts/admin-submissions-tests.js",
    "scripts/compact-cards-mobile-cover-tests.js",
    "scripts/design-foundation-tests.js",
    "scripts/discovery-category-split-hotfix-tests.js",
    "scripts/listing-card-clipping-tests.js",
    "scripts/public-book-card-row-alignment-tests.js",
    "scripts/recently-viewed-card-spacing-tests.js",
    "scripts/similar-books-card-spacing-tests.js",
    "scripts/stage-ai-search-1c-vector-foundation-tests.js",
    "scripts/stage-ai-search-1d-generate-book-embeddings-tests.js",
    "scripts/stage-ai-search-1e-backend-api-tests.js",
    "scripts/stage3-shop-identity-tests.js",
    "scripts/stage4b1-public-cards-tests.js",
    "scripts/stage4b2-homepage-discovery-tests.js",
    "scripts/storefront-cards-1a-polish-tests.js",
    "scripts/storefront-cards-1b-polish-tests.js",
    "tests/e2e/admin-book-cover-picker.spec.js",
    "tests/e2e/admin-book-form-polish.spec.js",
    "tests/e2e/admin-stock-foundation.spec.js",
    "tests/e2e/admin-suggest-save-refresh.spec.js",
    "tests/e2e/book-interior-print-type.spec.js",
    "tests/e2e/public-book-card-row-alignment.spec.js"
  ]);
  const unexpected = files.filter((file) => !allowed.has(file) && !file.startsWith(".vercel/"));
  assert.deepStrictEqual(unexpected, [], unexpected.join(", "));
});

if (failed) {
  console.error("\n" + failed + " SEO 2H category listing test(s) failed");
  process.exit(1);
}
console.log("stage-seo-2h-category-listing-seo-tests ok");
