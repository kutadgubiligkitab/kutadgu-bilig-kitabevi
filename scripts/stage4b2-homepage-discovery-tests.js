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
  "index.css", "shop.css", "premium-ux.css", "premium-ux.js",
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

test("card generators stay unchanged from origin/main", () => {
  const mainShop = gitShowMain("shop.js");
  assert.strictEqual(
    sliceBetween(shopJs, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;"),
    sliceBetween(mainShop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;")
  );
  // cartButton is not byte-pinned: L1 icon-only aria-label is covered by l1-home-cart-accessible-name-tests.js
  const cartBtn = sliceBetween(shopJs, "function cartButton(book,label=", "function cart(){");
  assert.match(cartBtn, /aria-label="تۈگەپ كەتتى"/);
  assert.match(cartBtn, /replace\(\/\\s\+\/g,""\)==="🛒"/);
  assert.strictEqual(
    sliceBetween(shopJs, "function card(b,i=0){", "const isDual=()=>"),
    sliceBetween(mainShop, "function card(b,i=0){", "const isDual=()=>")
  );
  const compact = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
  const mainCompact = gitShowMain("premium-ux.js");
  assert.strictEqual(
    sliceBetween(compact, "function compactCard(book){", "function bindCards(scope){"),
    sliceBetween(mainCompact, "function compactCard(book){", "function bindCards(scope){")
  );
});

test("Stage 4B-2 overlay is appended after premium-ux.css and covers.css reload", () => {
  assert.match(shopJs, /premium-ux\.css\?v=10/);
  assert.match(shopJs, /premium-ux\.js\?v=12/);
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
    (/\.sql$/i.test(file) && file !== "SITE_HOMEPAGE_ABOUT.sql") ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)admin\.(html|js|css)$/i.test(file) ||
    /(^|\/)premium-ux\.(js|css)$/i.test(file) ||
    /listing-card-safety|detail-similar-card-safety|recently-viewed-card-safety|detail-cover-mobile-safety|covers\.css|mobile\.css|theme\.css|index\.css|shop\.css|stage4b-public-cards\.css/.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
});

if (failed) {
  console.error("\n" + failed + " stage4b2 homepage discovery test(s) failed");
  process.exit(1);
}
console.log("stage4b2-homepage-discovery-tests ok");
