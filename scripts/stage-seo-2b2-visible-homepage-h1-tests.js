#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const FROZEN = {
  "shop.js": "3976a603d3057cb7872252048f40b3772ab63cd28216938924ba16a6c9e8a519",
  "kutadgu-search-rank.js": "87f083b9bfd62ce6ea0ce0df6bd796ca21a201a580b5ffb6dc3258326321831b",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "kutadgu-ai-search-ui.js": "af97de6463fb2f58da83f1415061e7ae853e4f71a7155689a0e64693716aaffb",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "kutadgu-public-book.js": "6f2125c9c5c12a6f753a836453b963e51e7ac81646996337fdb19dc6e26152c9",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
  "book-shell.html": "5a64832621af657513ccdad4f74e1033be5f43642c1ccc873374b3050a1a30e1",
  "home-hero-content.js": "dddb9141d6b06414b44577524473dd48d28a7021f64abfcbac5c3f6ce0ad023b",
  "home-hero-slideshow.js": "7b88037c2e391c22a006468fca2e146191192986c083cd010135454a8610a274",
  "vercel.json": "5cd4cda341684186f6904e8b3a8e2d209dfc430ea51548158154eef35d94f66d"
};

const HOME_TITLE = "قۇتادغۇبىلىك كىتابخانىسى";
const HOME_SNIPPET = "قۇتادغۇبىلىك كىتابخانىسى — ئۇيغۇرچە كىتابلار، ئەدەبىيات، تارىخ، دىن، تەربىيە ۋە پەن-مائارىپقا دائىر نادىر ئەسەرلەرنى بىر يەردىن تېپىش ۋە زاكاز قىلىشقا بولىدىغان ئىشەنچلىك كىتابخانا.";

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

function changedFiles() {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  return [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
}

test("initial homepage HTML has one visible non-empty bookstore H1", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const opens = html.match(/<h1\b[^>]*>/gi) || [];
  assert.strictEqual(opens.length, 1);
  const h1 = html.match(/<h1\b[\s\S]*?<\/h1>/);
  assert.ok(h1);
  assert.match(h1[0], /class="home-hero-eyebrow"/);
  assert.match(h1[0], /data-home-hero-eyebrow/);
  assert.doesNotMatch(h1[0], /\bhidden\b/);
  assert.strictEqual(h1[0].replace(/<[^>]+>/g, "").trim(), HOME_TITLE);
  assert.match(
    html,
    /<h2\s+class="home-hero-campaign-title"\s+data-home-hero-title\s+hidden\s*>\s*<\/h2>/
  );
  assert.doesNotMatch(html, /<h1[^>]*home-hero-campaign-title/);
  assert.doesNotMatch(html, /<h1[^>]*\bhidden\b/);
});

test("homepage title canonical robots OG and JSON-LD stay unchanged", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const title = html.match(/<title>([^<]*)<\/title>/);
  assert.ok(title);
  assert.strictEqual(title[1], HOME_TITLE);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.kutadgubilik\.com\/">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.match(html, /<meta property="og:title" content="قۇتادغۇبىلىك كىتابخانىسى">/);
  assert.ok(html.includes(`<meta name="description" content="${HOME_SNIPPET}">`));
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd);
  const data = JSON.parse(jsonLd[1]);
  assert.ok(data["@graph"].some((n) => n["@type"] === "BookStore"));
  assert.ok(data["@graph"].some((n) => n["@type"] === "WebSite"));
});

test("hero JS still uses data attributes and store/campaign hidden behavior", () => {
  const js = fs.readFileSync(path.join(root, "home-hero-content.js"), "utf8");
  assert.match(js, /querySelector\("\[data-home-hero-eyebrow\]"\)/);
  assert.match(js, /querySelector\("\[data-home-hero-title\]"\)/);
  const store = js.slice(js.indexOf("function applyStoreCopy"), js.indexOf("function applyCampaignCopy"));
  assert.match(store, /els\.title\.setAttribute\("hidden", ""\)/);
  const campaign = js.slice(js.indexOf("function applyCampaignCopy"), js.indexOf("function renderSlides"));
  assert.match(campaign, /els\.title\.removeAttribute\("hidden"\)/);
  assert.match(campaign, /els\.title\.setAttribute\("hidden", ""\)/);
  assert.doesNotMatch(js, /querySelector\(\s*["']h1["']\s*\)/);
  assert.doesNotMatch(js, /querySelector\(\s*["']h2["']\s*\)/);
});

test("CSS no longer uses a generic hero H1 selector", () => {
  ["stage3-shop-identity.css", "index.css", "mobile.css"].forEach((rel) => {
    const css = fs.readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(css, /\.home-bookstore-hero\s+h1/, rel);
    assert.match(css, /\.home-hero-campaign-title/, rel);
    assert.match(css, /\.home-hero-eyebrow/, rel);
  });
  const identity = fs.readFileSync(path.join(root, "stage3-shop-identity.css"), "utf8");
  assert.match(identity, /\.home-hero-eyebrow\{\s*display:\s*block;/);
  assert.match(identity, /font-size:\s*var\(--font-size-lg,16px\)/);
  assert.match(identity, /\.home-hero-campaign-title\[hidden\]\{\s*display:\s*none !important;/);
});

test("search AI Search cart auth admin book detail and 2A files stay frozen", () => {
  Object.keys(FROZEN).forEach((rel) => {
    assert.strictEqual(sha256(rel), FROZEN[rel], rel);
  });
  const files = changedFiles();
  [
    "shop.js",
    "kutadgu-search-rank.js",
    "kutadgu-ai-search.js",
    "kutadgu-ai-search-ui.js",
    "api/ai-search.js",
    "kutadgu-public-book.js",
    "api/book-public.js",
    "book-shell.html",
    "home-hero-content.js",
    "home-hero-slideshow.js",
    "vercel.json",
    "admin.js",
    "admin.html",
    "book-staff.js",
    "book-staff.html",
    "favorites.js",
    "member.js"
  ].forEach((rel) => {
    assert.ok(!files.includes(rel), rel);
  });
  const allowed = new Set([
    "index.html",
    "index.css",
    "mobile.css",
    "stage3-shop-identity.css",
    "package.json",
    "scripts/home-hero-overlay-tests.js",
    "scripts/stage-seo-2b-homepage-h1-tests.js",
    "scripts/stage-seo-2b2-visible-homepage-h1-tests.js",
    "scripts/homepage-compact-ux-tests.js",
    "scripts/stage3-shop-identity-tests.js",
    "scripts/homepage-about-editor-tests.js",
    "scripts/storefront-cards-1a-polish-tests.js",
    "scripts/stage4b2-homepage-discovery-tests.js"
  ]);
  const unexpected = files.filter((file) => !allowed.has(file));
  assert.deepStrictEqual(unexpected, [], unexpected.join(", "));
});

if (failed) {
  console.error("\n" + failed + " SEO 2B-2 visible homepage H1 test(s) failed");
  process.exit(1);
}
console.log("stage-seo-2b2-visible-homepage-h1-tests ok");
