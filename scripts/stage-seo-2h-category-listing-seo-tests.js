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
const NEW_HUBS = {
  iqtisad: { label: "ئىقتىساد" },
  taamlar: { label: "تائاملار" }
};
const FROZEN = {
  "shop.js": "0038744c226c391b9433a54d99ba1b6edf2a9b0c2cf8956e12439f0d434d885e",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "e336cdeb44545592f3a4325bd83ff4204341e0f565e298c5c4c576d70c3c15a8",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "kutadgu-book-seo.js": "c711ddb3f14b15c302f7b82e71276d1a865cd74118530837fe309ec442154a2d",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
  "book-shell.html": "3707b9e7bcac2bb1e842b2e2d9c48281602f3dffbad6b814d9f4716ec5a71fbb",
  "index.html": "7fd479b1e02b9abffc19a10d9fd9c90197a2b2f68b3ce8c808b871a9902cbeb4",
  "home-hero-content.js": "321456761d14ebc084304539d81dc24e666a637e488e3e8014491c937dce064a",
  "vercel.json": "b423a3edf3d199d8b3703dade4dc355b3124a3a9b0e93ab1e724acd69c6b63a7",
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
  try {
    return execSync(`git show origin/main:${rel}`, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (err) {
    const stderr = String((err && err.stderr) || (err && err.message) || "");
    if (err && err.status === 128 && /exists on disk, but not in/.test(stderr)) return "";
    throw err;
  }
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
    "grammar",
    "iqtisad",
    "taamlar"
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
    const description = attr(html, /<meta name="description" content="([^"]*)"/);
    if (NEW_HUBS[slug]) {
      assert.strictEqual(old, "");
      assert.strictEqual(title, `${NEW_HUBS[slug].label} | قۇتادغۇبىلىك كىتابخانىسى`);
      assert.strictEqual(description, `قۇتادغۇبىلىك كىتابخانىسىدىكى ${NEW_HUBS[slug].label} كىتابلىرىنى كۆرۈڭ ۋە WhatsApp ئارقىلىق زاكاز قىلىڭ.`);
      const data = JSON.parse(jsonLd(html));
      assert.strictEqual(data["@type"], "CollectionPage");
      assert.strictEqual(data.name, NEW_HUBS[slug].label);
      assert.strictEqual(data.url, `https://www.kutadgubilik.com/${slug}`);
    } else if (slug === "adabiyat-roman") {
      assert.strictEqual(title, "ئەدەبىيات رومانلىرى - قۇتادغۇبىلىك كىتابخانىسى");
      assert.strictEqual(title, oldTitle);
      assert.notStrictEqual(title, attr(pages.romanlar, /<title>([\s\S]*?)<\/title>/));
      assert.strictEqual(description, attr(old, /<meta name="description" content="([^"]*)"/));
      assert.strictEqual(jsonLd(html), jsonLd(old));
    } else {
      assert.strictEqual(title, oldTitle);
      assert.strictEqual(description, attr(old, /<meta name="description" content="([^"]*)"/));
      assert.strictEqual(jsonLd(html), jsonLd(old));
    }
    assert.match(html, /"@type":"CollectionPage"/);
    assert.strictEqual(count(html, /class="category-hub-intro"/g), 1);
    assert.strictEqual(count(html, /class="category-hub-nav"/g), 1);
    const intro = introText(html);
    assert.ok(intro.length >= 24, "intro too thin");
    assert.doesNotMatch(intro, FAKE_CLAIM);
    assert.doesNotMatch(html, /<p class="category-hub-intro"[^>]*(hidden|aria-hidden="true")/);
    assert.match(html, /href="\/category-hub-seo\.css\?v=1"/);
    assert.match(html, /shop\.js\?v=147/);
    if (NEW_HUBS[slug]) {
      assert.strictEqual(attr(html, /data-catalog-source="([^"]*)"/), `${slug}.html`);
      assert.strictEqual(attr(html, /data-catalog-sources="([^"]*)"/) || "", "");
    } else {
      assert.strictEqual(
        attr(html, /data-catalog-source="([^"]*)"/),
        attr(old, /data-catalog-source="([^"]*)"/)
      );
      assert.strictEqual(
        attr(html, /data-catalog-sources="([^"]*)"/) || "",
        attr(old, /data-catalog-sources="([^"]*)"/) || ""
      );
    }
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
  assert.match(html, /shop\.js\?v=147/);
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
    "grammar",
    "iqtisad",
    "taamlar"
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
    "kutadgu-ai-search.js",
    "scripts/stage-seo-2h-category-listing-seo-tests.js",
    "scripts/economics-food-categories-tests.js",
    "app-config.js",
    "kutadgu-sitemap.js",
    "sitemap-pages.xml",
    "tests/e2e/homepage-compact.spec.js",
    "home-category-appended-cards.css",
    "package.json",
    "package-lock.json",
    "PROJECT-RECOVERY.md",
    ".env.example",
    ".gitignore",
    ".assetsignore",
    ".dev.vars.example",
    "wrangler.jsonc",
    "_headers",
    "CLOUDFLARE_MIGRATION_REPORT.md",
    "kutadgu-image-storage.js",
    "cloudflare/worker.js",
    "cloudflare/preview-dispatch.js",
    ".well-known/assetlinks.json",
    ".well-known/apple-app-site-association.json",
    "cloudflare/r2-cover-upload.js",
    "admin-hero.js",
    "scripts/admin-hero-tests.js",
    "STAGE103_BLOCK_BOOK_COVER_STORAGE_WRITES.sql",
    "STAGE104_REWRITE_BOOK_IMAGE_URLS.sql",
    "STAGE_AI_SEARCH_RPC_SERVER_ONLY.sql",
    "scripts/r2-book-url-object-manifest.json",
    "scripts/r2-book-url-rollback-manifest.json",
    "scripts/r2-book-url-storage-classification.json",
    "cloudflare/r2-cover-read.js",
    "kutadgu-preview-r2-images.js",
    "cloudflare/security-headers.js",
    "cloudflare/production-cutover-routes.json",
    "scripts/r2-s3-client.js",
    "scripts/r2-cover-inventory.js",
    "scripts/r2-cover-copy-verify.js",
    "scripts/legacy-cover-storage/README.md",
    "scripts/legacy-cover-storage/restore-manifest.json",
    "scripts/legacy-cover-storage/deletion-manifest.json",
    "scripts/legacy-cover-storage/protected-snapshot.json",
    "scripts/legacy-cover-storage/restore-from-r2.js",
    "scripts/legacy-cover-storage/delete-exact.js",
    "scripts/legacy-cover-storage/deletion-result.json",
    "scripts/cloudflare-preview-tests.js",
    "scripts/cloudflare-preview-dev.js",
    ".cursor/rules/project-recovery.mdc",
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
    "analytics.js",
    "STAGE100_ADMIN_DAILY_VISITORS.sql",
    "STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql",
    "scripts/stage100-isolated-postgres.sh",
    "scripts/stage100-isolated-fixture.sql",
    "scripts/stage100-isolated-load.sql",
    "scripts/stage100-isolated-assertions.sql",
    "scripts/stage100-isolated-rollback-assertions.sql",
    "scripts/stage100-isolated-reapply-assertions.sql",
    "STAGE102_R2_BOOK_IMAGE_URLS.sql",
    "STAGE101_ADMIN_ZERO_SEARCHES.sql",
    "STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql",
    "scripts/stage101-isolated-assertions.sql",
    "scripts/stage101-isolated-postgres.sh",
    "scripts/stage101-isolated-rollback-assertions.sql",
    "scripts/admin-zero-searches-tests.js",
    "scripts/stage8-analytics-tests.js",
    "tests/e2e/admin-zero-searches.spec.js",
    "tests/e2e/zero-result-search.spec.js",
    "scripts/admin-daily-visitors-tests.js",
    "tests/e2e/admin-daily-visitors.spec.js",
    "scripts/book-view-counts-tests.js",
    "scripts/dedupe-supabase-reads-tests.js",
    "scripts/stage91-admin-import-scale-tests.js",
    "scripts/measure-supabase-reads.js",
    "scripts/stage99-admin-suggest-save-refresh-tests.js",
    "scripts/stage95-book-entry-suggest-tests.js",
    "admin.js",
    "admin.html",
    "admin.css",
    "admin-save-guard.js",
    "scripts/admin-save-guard-tests.js",
    "scripts/stage96-admin-book-form-polish-tests.js",
    "kutadgu-cover-image.js",
    "scripts/cover-upload-optimize-tests.js",
    "tests/e2e/cover-upload-optimize.spec.js",
    "shop.js",
    "kutadgu-visit-order.js",
    "scripts/books-visit-rotation-tests.js",
    "tests/e2e/books-visit-rotation.spec.js",
    "shop.css",
    "scripts/storefront-stock-ux-tests.js",
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
    "scripts/admin-original-price-tests.js",
    "scripts/admin-price-history-tests.js",
    "scripts/announcement-bar-tests.js",
    "scripts/maintenance-mode-tests.js",
    "scripts/stage62-cover-type-book-size-tests.js",
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
    "scripts/homepage-about-editor-tests.js",
    "scripts/homepage-compact-ux-tests.js",
    "scripts/homepage-discovery-authoritative-tests.js",
    "scripts/listing-catalog-boot-tests.js",
    "scripts/order-prepared-semantics-tests.js",
    "scripts/p0-cart-favorites-identity-tests.js",
    "scripts/cart-page-boot-tests.js",
    "kutadgu-shared-cart.js",
    "kutadgu-shared-cart-links.js",
    "STAGE105_SHARED_CART_LINKS.sql",
    "scripts/shared-cart-v1-tests.js",
    "scripts/shared-cart-short-links-v2-tests.js",
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
    "account.css",
    "reset-password.html",
    "books.html",
    "adabiyat.html",
    "adabiyat-roman.html",
    "children.html",
    "dastanlar.html",
    "derslik.html",
    "dictionary.html",
    "dini.html",
    "dunya-edebiyati.html",
    "grammar.html",
    "hekayiler.html",
    "romanlar.html",
    "sheirlar.html",
    "tarikhiy-romanlar.html",
    "terbiye.html",
    "tibb.html",
    "universal.html",
    "uyghur-adabiyati.html",
    "account.js",
    "book-staff.html",
    "member.js",
    "scripts/account-cross-tab-logout-tests.js",
    "scripts/account-header-cart-count-tests.js",
    "scripts/admin-non-admin-session-tests.js",
    "scripts/book-staff-portal-tests.js",
    "scripts/stage12-admin-import-covers-tests.js",
    "scripts/stage70-storage-policy-hardening-tests.js",
    "scripts/stage2c-aal2-store-storage-tests.js",
    "scripts/stage93-book-staff-gallery-tests.js",
    "scripts/member-premerge-sync-tests.js",
    "scripts/qa-customer-facing-fixes-tests.js",
    "scripts/finalqa-clear-filter-stale-chips-tests.js",
    "scripts/qa-audit2-low-fixes-tests.js",
    "public-header.css",
    "public-header.js",
    "scripts/public-header-tests.js",
    "scripts/admin-submissions-tests.js",
    "scripts/admin-book-staff-tests.js",
    "scripts/legacy-book-query-redirect-tests.js",
    "scripts/book-public-status-tests.js",
    "scripts/posthog-analytics-tests.js",
    "posthog-config.js",
    "playwright.config.js",
    "tests/e2e/helpers.js",
    "scripts/ci-resolve-e2e-target.js",
    "STAGE11_RECOVERY.md",
    "tests/e2e/maintenance-mode.spec.js",
    "tests/e2e/phase1-stock-enforcement-off.spec.js",
    "tests/e2e/phase2-stock-enforcement.spec.js",
    "tests/e2e/static-demo-production-safety.spec.js",
    "tests/e2e/account-cross-tab-logout.spec.js",
    "tests/e2e/auth-oauth-recovery.spec.js",
    "tests/e2e/search-relevance.spec.js",
    "catalog-credits.js",
    "catalog-credits.css",
    "credit-books.html",
    "STAGE106_CATALOG_CREDITS.sql",
    "STAGE106_CATALOG_CREDITS_ROLLBACK.sql",
    "book-staff.css",
    "scripts/catalog-credits-tests.js",
    "tests/e2e/catalog-credits.spec.js",
    "tests/e2e/catalog-credit-link-persistence.spec.js",
    "tests/e2e/premium-discovery-cover-retry.spec.js",
    "STAGE106_CATALOG_CREDIT_CORRECTIONS.sql",
    "scripts/stage106-isolated-verify.js",
    "STAGE107_BOOK_REVIEWS.sql",
    "STAGE107_BOOK_REVIEWS_ROLLBACK.sql",
    "STAGE108_BOOK_REVIEW_LIMITS_DELETE.sql",
    "STAGE108_BOOK_REVIEW_LIMITS_DELETE_ROLLBACK.sql",
    "STAGE109_BOOK_REVIEW_HEARTS_REPLIES.sql",
    "STAGE109_BOOK_REVIEW_HEARTS_REPLIES_ROLLBACK.sql",
    "STAGE110_BOOK_REVIEW_NOTIFICATIONS.sql",
    "STAGE110_BOOK_REVIEW_NOTIFICATIONS_ROLLBACK.sql",
    "STAGE111_BOOK_REVIEW_PAGES.sql",
    "STAGE111_BOOK_REVIEW_PAGES_ROLLBACK.sql",
    "book-reviews.js",
    "book-reviews.css",
    "admin-book-reviews.js",
    "scripts/book-reviews-tests.js",
    "scripts/stage107-isolated-verify.js",
    "scripts/stage108-isolated-verify.js",
    "scripts/cover-upload-optimize-tests.js",
    "tests/e2e/book-reviews.spec.js",
    "tests/e2e/fixtures/public-header-4e07e95a.js",
    "tests/e2e/fixtures/admin-css-6c3e7bb6.css",
    "scripts/admin-order-management-tests.js",
    "STAGE112_ADMIN_MEMBER_CART.sql",
    "STAGE112_ADMIN_MEMBER_CART_ROLLBACK.sql",
    "admin-member-cart.js",
    "scripts/admin-member-cart-tests.js",
    "scripts/stage112-isolated-verify.js",
    "tests/e2e/admin-member-cart.spec.js",
    "STAGE113_ADMIN_MEMBER_DIRECTORY.sql",
    "STAGE113_ADMIN_MEMBER_DIRECTORY_ROLLBACK.sql",
    "scripts/stage113-isolated-verify.js",
    "scripts/admin-member-directory-tests.js",
    "tests/e2e/admin-member-directory.spec.js",
    "home-hero-content.js",
    "home-hero-slideshow.js",
    "scripts/home-hero-overlay-tests.js",
    "tests/e2e/home-hero-overlay.spec.js",
    "STAGE114_THREE_HOUR_VISITS.sql",
    "STAGE114_THREE_HOUR_VISITS_ROLLBACK.sql",
    "scripts/stage114-isolated-postgres.sh",
    "scripts/stage114-isolated-fixture.sql",
    "scripts/stage114-isolated-assertions.sql",
    "scripts/stage114-isolated-rollback-assertions.sql",
    "scripts/stage114-isolated-reapply-assertions.sql",
    "scripts/stage114-isolated-counter-failure.sql",
    "scripts/stage114-isolated-counter-recovery.sql",
    "scripts/three-hour-visits-tests.js",
    "STAGE115_ANALYTICS_EVENT_ID.sql",
    "scripts/analytics-insert-postgrest.sh",
    "tests/e2e/admin-three-hour-visits.spec.js",
    "STAGE116_ADMIN_ANALYTICS_LISTS.sql",
    "STAGE116_ADMIN_ANALYTICS_LISTS_ROLLBACK.sql",
    "scripts/admin-search-lists-tests.js",
    "scripts/admin-search-lists-postgrest.sh",
    "tests/e2e/admin-search-lists.spec.js",
    "tests/e2e/book-detail-boot.spec.js"
  ]);
  const unexpected = files.filter((file) => !allowed.has(file) && !file.startsWith(".vercel/"));
  assert.deepStrictEqual(unexpected, [], unexpected.join(", "));
});

if (failed) {
  console.error("\n" + failed + " SEO 2H category listing test(s) failed");
  process.exit(1);
}
console.log("stage-seo-2h-category-listing-seo-tests ok");
