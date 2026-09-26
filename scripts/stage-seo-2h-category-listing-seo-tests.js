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
  "shop.js": "38569909c9aec9c2d0bd79875edc035ebb54c505a6b86409006e43f52c3ad301",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "kutadgu-book-seo.js": "be6e4e0d5a499f5bb8fddc46aa42df04c856c87ec2276195c51875b336736a80",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
  "book-shell.html": "526933939bc136be9ef39430fcdc9be1ae5f92d02e93894e56e0f772c4f685d1",
  "index.html": "6a6188b7de8c294ee319a99136d2cf41bca764f0db92b0883795b76184870306",
  "home-hero-content.js": "dddb9141d6b06414b44577524473dd48d28a7021f64abfcbac5c3f6ce0ad023b",
  "vercel.json": "6b64b17147a87f6637df7cc0ed492741e3ce20ccbeb5d13c88e0df2615fb9009",
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
    const title = attr(html, /<title>([\s\S]*?)<\/title>/);
    const oldTitle = attr(old, /<title>([\s\S]*?)<\/title>/);
    if (slug === "adabiyat-roman") {
      assert.strictEqual(title, "ئەدەبىيات رومانلىرى - قۇتادغۇبىلىك كىتابخانىسى");
      assert.strictEqual(title, oldTitle);
      assert.notStrictEqual(title, attr(pages.romanlar, /<title>([\s\S]*?)<\/title>/));
    } else {
      assert.strictEqual(title, oldTitle);
    }
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
    assert.match(html, /shop\.js\?v=133/);
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
  assert.match(html, /shop\.js\?v=133/);
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
    "api/book-public.js",

    "favorites.js",
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
    "kutadgu-book-seo.js",
    "kutadgu-public-book.js",
    "scripts/google-book-product-seo-tests.js",
    "scripts/stage7-seo-tests.js",
    "tests/e2e/book-clean-urls.spec.js",
    "scripts/stage-seo-2a-server-rendered-book-seo-tests.js",
    "scripts/stage-seo-2b-homepage-h1-tests.js",
    "scripts/stage-seo-2b2-visible-homepage-h1-tests.js",
    "scripts/stage-seo-2c-book-first-byte-content-tests.js",
    "scripts/stage-seo-2d-favicon-tests.js",
    "scripts/stage-seo-2e-book-meta-descriptions-tests.js",
    "scripts/stage-seo-2f-first-byte-book-details-tests.js",
    "scripts/stage5d-global-books-tests.js",
    "kutadgu-category-listing.js",
    "api/category-listing.js",
    "vercel.json",
    "scripts/category-first-byte-seo-tests.js",
    "scripts/category-template-packaging-tests.js",
    "scripts/static-preview-server.js",
    "scripts/l3-custom-404-page-tests.js",
    "tests/e2e/listing-catalog-boot.spec.js",
    "tests/e2e/adabiyat-hub.spec.js",
    "tests/e2e/stage5d-global-books.spec.js",
    "scripts/m1-cross-page-search-cold-load-tests.js",
    "STAGE87_COVER_INTEGRITY.sql",
    "STAGE99_BOOK_ENGAGEMENT_VIEW_COUNTS.sql",
    "kutadgu-book-views.js",
    "kutadgu-analytics-core.js",
    "scripts/book-view-counts-tests.js",
    "scripts/dedupe-supabase-reads-tests.js",
    "scripts/stage91-admin-import-scale-tests.js",
    "scripts/measure-supabase-reads.js",
    "scripts/stage99-admin-suggest-save-refresh-tests.js",
    "scripts/stage95-book-entry-suggest-tests.js",
    "admin.js",
    "admin.html",
    "kutadgu-cover-image.js",
    "scripts/cover-upload-optimize-tests.js",
    "tests/e2e/cover-upload-optimize.spec.js",
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
    "scripts/stage-ai-search-1g2-relevance-rerank-tests.js",
    "kutadgu-announcements.js",
    "scripts/stage3-shop-identity-tests.js",
    "scripts/stage4b1-public-cards-tests.js",
    "scripts/stage4b2-homepage-discovery-tests.js",
    "scripts/storefront-cards-1a-polish-tests.js",
    "scripts/storefront-cards-1b-polish-tests.js",
    "storefront-cover-presentation.css",
    "scripts/storefront-cover-presentation-tests.js",
    "tests/e2e/admin-book-cover-picker.spec.js",
    "tests/e2e/admin-book-form-polish.spec.js",
    "tests/e2e/admin-stock-foundation.spec.js",
    "tests/e2e/admin-suggest-save-refresh.spec.js",
    "tests/e2e/book-interior-print-type.spec.js",
    "tests/e2e/public-book-card-row-alignment.spec.js",
    "tests/e2e/helpers.js",
    "scripts/ci-supabase-egress-protection-tests.js",
    "scripts/bestseller-public-config-tests.js",
    "store-hours-content.js",
    "adabiyat-roman-1.html",
    "adabiyat-roman-2.html",
    "adabiyat-roman-3.html",
    "adabiyat-roman-4.html",
    "adabiyat-roman-5.html",
    "adabiyat-roman-6.html",
    "book-shell.html",
    "cart.html",
    "children-1.html",
    "children-2.html",
    "children-3.html",
    "children-4.html",
    "children-5.html",
    "children-6.html",
    "dastanlar-1.html",
    "dastanlar-2.html",
    "dastanlar-3.html",
    "dastanlar-4.html",
    "dastanlar-5.html",
    "dastanlar-6.html",
    "delete-account.html",
    "derslik-1.html",
    "derslik-2.html",
    "derslik-3.html",
    "derslik-4.html",
    "derslik-5.html",
    "derslik-6.html",
    "dini-1.html",
    "dini-2.html",
    "dini-3.html",
    "dini-4.html",
    "dini-5.html",
    "dini-6.html",
    "dunya-edebiyati-1.html",
    "dunya-edebiyati-2.html",
    "dunya-edebiyati-3.html",
    "dunya-edebiyati-4.html",
    "dunya-edebiyati-5.html",
    "dunya-edebiyati-6.html",
    "favorites.html",
    "hekayiler-1.html",
    "hekayiler-2.html",
    "hekayiler-3.html",
    "hekayiler-4.html",
    "hekayiler-5.html",
    "hekayiler-6.html",
    "index.html",
    "my-books.html",
    "order-info.html",
    "ozumuzni-etirap-qilayli.html",
    "privacy.html",
    "returns.html",
    "romanlar-2.html",
    "romanlar-3.html",
    "romanlar-4.html",
    "romanlar-5.html",
    "romanlar-6.html",
    "scripts/auth-oauth-recovery-tests.js",
    "scripts/auth-production-cache-buster-tests.js",
    "scripts/book-detail-seo-hydration-race-tests.js",
    "scripts/book-interior-print-type-tests.js",
    "scripts/homepage-compact-ux-tests.js",
    "scripts/homepage-discovery-authoritative-tests.js",
    "scripts/listing-catalog-boot-tests.js",
    "scripts/order-prepared-semantics-tests.js",
    "scripts/p0-cart-favorites-identity-tests.js",
    "scripts/stage82-stock-foundation-tests.js",
    "scripts/stage83-stock-enforcement-tests.js",
    "scripts/stage97-shop-hours-tests.js",
    "scripts/stage98-search-relevance-tests.js",
    "scripts/static-demo-production-safety-tests.js",
    "scripts/storefront-session-bootstrap-tests.js",
    "sheirlar-1.html",
    "sheirlar-2.html",
    "sheirlar-3.html",
    "sheirlar-4.html",
    "sheirlar-5.html",
    "sheirlar-6.html",
    "tarikhiy-romanlar-1.html",
    "tarikhiy-romanlar-2.html",
    "tarikhiy-romanlar-3.html",
    "tarikhiy-romanlar-4.html",
    "tarikhiy-romanlar-5.html",
    "tarikhiy-romanlar-6.html",
    "terbiye-1.html",
    "terbiye-2.html",
    "terbiye-3.html",
    "terbiye-4.html",
    "terbiye-5.html",
    "terbiye-6.html",
    "tibb-1.html",
    "tibb-2.html",
    "tibb-3.html",
    "tibb-4.html",
    "tibb-5.html",
    "tibb-6.html",
    "universal-1.html",
    "universal-2.html",
    "universal-3.html",
    "universal-4.html",
    "universal-5.html",
    "universal-6.html",
    "uyghur-adabiyati-1.html",
    "uyghur-adabiyati-2.html",
    "uyghur-adabiyati-3.html",
    "uyghur-adabiyati-4.html",
    "uyghur-adabiyati-5.html",
    "uyghur-adabiyati-6.html",
    "account.html",
    "account.js",
    "book-staff.html",
    "member.js",
    "scripts/account-cross-tab-logout-tests.js",
    "scripts/account-header-cart-count-tests.js",
    "scripts/admin-non-admin-session-tests.js",
    "scripts/book-staff-portal-tests.js",
    "scripts/member-premerge-sync-tests.js",
    "scripts/qa-customer-facing-fixes-tests.js",
    "scripts/qa-audit2-low-fixes-tests.js",
    "public-header.css",
    "public-header.js",
    "scripts/public-header-tests.js",
    "scripts/admin-submissions-tests.js",
    "scripts/admin-book-staff-tests.js",
    "scripts/legacy-book-query-redirect-tests.js",
    "scripts/book-public-status-tests.js",
    "scripts/posthog-analytics-tests.js",
    "tests/e2e/maintenance-mode.spec.js",
    "tests/e2e/phase1-stock-enforcement-off.spec.js",
    "tests/e2e/phase2-stock-enforcement.spec.js",
    "tests/e2e/static-demo-production-safety.spec.js",
    "tests/e2e/account-cross-tab-logout.spec.js",
    "tests/e2e/auth-oauth-recovery.spec.js",
    "tests/e2e/search-relevance.spec.js"
  ]);
  const unexpected = files.filter((file) => !allowed.has(file) && !file.startsWith(".vercel/"));
  assert.deepStrictEqual(unexpected, [], unexpected.join(", "));
});

if (failed) {
  console.error("\n" + failed + " SEO 2H category listing test(s) failed");
  process.exit(1);
}
console.log("stage-seo-2h-category-listing-seo-tests ok");
