#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const FROZEN = {
  "shop.js": "24e71d6008f74c7dc31a0e8d9961760c0964b35669aa9a1aa04f050f8edd909a",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "home-hero-content.js": "dddb9141d6b06414b44577524473dd48d28a7021f64abfcbac5c3f6ce0ad023b",
  "home-hero-slideshow.js": "7b88037c2e391c22a006468fca2e146191192986c083cd010135454a8610a274",
  "vercel.json": "5f7c347d0b8ac2a40bac10ba0ee0189abaa774e01d83d25af3c15b8f68f75d15"
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

test("homepage initial HTML has exactly one visible bookstore-name H1", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const opens = html.match(/<h1\b[^>]*>/gi) || [];
  assert.strictEqual(opens.length, 1, "expected exactly one <h1>");
  assert.match(
    html,
    /<h1 class="home-hero-eyebrow" data-home-hero-eyebrow>قۇتادغۇبىلىك كىتابخانىسى<\/h1>/
  );
  const h1 = html.match(/<h1\b[\s\S]*?<\/h1>/);
  assert.ok(h1);
  assert.match(h1[0], /class="home-hero-eyebrow"/);
  assert.match(h1[0], /data-home-hero-eyebrow/);
  assert.doesNotMatch(h1[0], /\bhidden\b/);
  assert.match(h1[0], /قۇتادغۇبىلىك كىتابخانىسى/);
  assert.match(
    html,
    /<h2\s+class="home-hero-campaign-title"\s+data-home-hero-title\s+hidden\s*>\s*<\/h2>/
  );
  assert.doesNotMatch(html, /role="heading"/);
  assert.doesNotMatch(html, /aria-level="1"/);
  assert.doesNotMatch(html, /<h1[^>]*home-hero-campaign-title/);
  assert.doesNotMatch(html, /<div\s+class="home-hero-eyebrow"/);
});

test("homepage title canonical robots and JSON-LD stay unchanged", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const title = html.match(/<title>([^<]*)<\/title>/);
  assert.ok(title);
  assert.strictEqual(title[1], HOME_TITLE);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.kutadgubilik\.com\/">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.ok(html.includes(`<meta name="description" content="${HOME_SNIPPET}">`));
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd);
  const data = JSON.parse(jsonLd[1]);
  assert.ok(data["@graph"].some((n) => n["@type"] === "BookStore"));
  assert.ok(data["@graph"].some((n) => n["@type"] === "WebSite"));
});

test("hero JS still targets data-home-hero-title and data-home-hero-eyebrow", () => {
  const js = fs.readFileSync(path.join(root, "home-hero-content.js"), "utf8");
  assert.match(js, /querySelector\("\[data-home-hero-title\]"\)/);
  assert.match(js, /querySelector\("\[data-home-hero-eyebrow\]"\)/);
  assert.match(js, /els\.title\.hasAttribute\("hidden"\)/);
  assert.match(js, /els\.title\.setAttribute\("hidden", ""\)/);
  assert.match(js, /els\.title\.removeAttribute\("hidden"\)/);
  assert.doesNotMatch(js, /querySelector\(\s*["']h1["']\s*\)/);
  assert.doesNotMatch(js, /role=["']heading["']/);
  assert.doesNotMatch(js, /aria-level/);
});

test("hero CSS keeps campaign-title large and does not restyle the eyebrow H1", () => {
  const css = fs.readFileSync(path.join(root, "stage3-shop-identity.css"), "utf8");
  assert.doesNotMatch(css, /\.home-bookstore-hero h1/);
  assert.match(css, /\.home-hero-campaign-title\{/);
  assert.match(css, /\.home-hero-eyebrow\{/);
  assert.match(css, /\.home-hero-campaign-title\[hidden\]\{\s*display:\s*none !important;/);
});

test("search AI Search cart auth book detail admin and 2A files stay frozen", () => {
  Object.keys(FROZEN).forEach((rel) => {
    assert.strictEqual(sha256(rel), FROZEN[rel], rel);
  });
  const files = changedFiles();
  const forbidden = [

    "kutadgu-search-rank.js",
    "kutadgu-ai-search.js",
    "api/ai-search.js",
    "home-hero-content.js",
    "home-hero-slideshow.js",
    "admin.html",

    "book-staff.html",
    "favorites.js",
    "member.js"
  ];
  forbidden.forEach((rel) => {
    assert.ok(!files.includes(rel), rel);
  });
});

if (failed) {
  console.error("\n" + failed + " SEO 2B homepage H1 test(s) failed");
  process.exit(1);
}
console.log("stage-seo-2b-homepage-h1-tests ok");
