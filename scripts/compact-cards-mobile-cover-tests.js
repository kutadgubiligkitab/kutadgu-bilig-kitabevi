#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const premium = fs.readFileSync(path.join(root, "premium-ux.css"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
const mobile = fs.readFileSync(path.join(root, "detail-cover-mobile-safety.css"), "utf8");
const similar = fs.readFileSync(path.join(root, "detail-similar-card-safety.css"), "utf8");
const recent = fs.readFileSync(path.join(root, "recently-viewed-card-safety.css"), "utf8");
const listing = fs.readFileSync(path.join(root, "listing-card-safety.css"), "utf8");
const cartRowSafetyPath = path.join(root, "premium-cart-row-alignment-safety.css");

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

test("discovery cards use natural height instead of grid stretch", () => {
  const block = premium.slice(premium.indexOf("#premiumDiscoveryResults .premium-book-grid"));
  assert.match(block, /align-items:\s*start/);
  assert.match(block, /height:\s*auto/);
  assert.match(block, /flex:\s*0 0 auto/);
  assert.match(block, /-webkit-line-clamp:\s*2/);
  assert.match(block, /object-fit:\s*contain/);
  assert.doesNotMatch(block, /\.premium-book-card\{[^}]*height:\s*100%/);
  assert.doesNotMatch(block, /margin-top:\s*auto/);
});

test("recommended carousel drops forced min-height and bottom auto-push", () => {
  assert.match(premium, /#newBooksCarousel \.home-carousel-card\{[\s\S]*min-height:0\s*!important/);
  assert.doesNotMatch(premium, /min-height:376px/);
  assert.doesNotMatch(premium, /min-height:340px/);
  assert.doesNotMatch(premium, /min-height:392px/);
  assert.match(premium, /#newBooksCarousel \.home-carousel-bottom\{[\s\S]*margin-top:6px\s*!important/);
  assert.doesNotMatch(premium, /#newBooksCarousel \.home-carousel-bottom\{[\s\S]*margin-top:auto/);
});

test("mobile detail cover safety follows image height and contain", () => {
  assert.match(mobile, /@media \(max-width: 768px\)/);
  assert.match(mobile, /\.detail-page-body \.book-cover-box:not\(\.no-cover\)/);
  assert.match(mobile, /aspect-ratio:\s*auto\s*!important/);
  assert.match(mobile, /min-height:\s*0\s*!important/);
  assert.match(mobile, /object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(mobile, /object-fit:\s*cover/);
  assert.match(mobile, /padding:\s*6px/);
});

test("book-shell loads cover safety after mobile.css; shop loads premium-ux.css v=10", () => {
  const mobileAt = shell.indexOf("mobile.css");
  const safetyAt = shell.indexOf("detail-cover-mobile-safety.css?v=1");
  assert.ok(mobileAt >= 0 && safetyAt > mobileAt);
  assert.match(shell, /data-kutadgu-detail-cover-mobile-safety="1"/);
  assert.match(shell, /data-kutadgu-similar-card-safety="1"/);
  assert.match(shell, /data-kutadgu-recently-viewed-card-safety="1"/);
  assert.match(shop, /premium-ux\.css\?v=10/);
});

test("PR 97 98 99 safety files stay scoped and omit discovery/detail-cover rules", () => {
  assert.match(listing, /\.books-grid\[data-catalog-source\] \.book-card/);
  assert.match(similar, /\[data-detail-related\] \.detail-related-grid \.shop-mini-card/);
  assert.match(recent, /\[data-recently-viewed\] \.shop-mini-card/);
  assert.doesNotMatch(listing, /premiumDiscoveryResults/);
  assert.doesNotMatch(similar, /detail-page-body \.book-cover-box:not/);
  assert.doesNotMatch(recent, /#newBooksCarousel/);
});

test("compactCard and home carousel markup stay behaviorally unchanged", () => {
  const ux = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
  assert.match(ux, /class="premium-book-card"/);
  assert.match(ux, /premium-card-cart/);
  assert.match(shop, /class="home-carousel-card/);
  assert.match(shop, /function cartButton\(/);
});

test("premium discovery cart-row alignment safety overlay", () => {
  assert.ok(fs.existsSync(cartRowSafetyPath), "premium-cart-row-alignment-safety.css missing");
  const safety = fs.readFileSync(cartRowSafetyPath, "utf8");
  const body = safety.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectorChunks = body.split("{").slice(0, -1).map((chunk) => {
    const parts = chunk.split("}");
    return parts[parts.length - 1].trim();
  }).filter(Boolean);
  assert.ok(selectorChunks.length > 0, "expected alignment rules");
  for (const chunk of selectorChunks) {
    if (chunk.startsWith("@")) continue;
    const selectors = chunk.split(",").map((s) => s.trim()).filter(Boolean);
    for (const sel of selectors) {
      assert.ok(
        sel.startsWith("#premiumDiscoveryResults ") ||
        sel.startsWith("#premiumDiscoveryResults.") ||
        sel.startsWith("#premiumDiscoveryResults:"),
        "unscoped selector: " + sel
      );
    }
  }
  assert.match(body, /#premiumDiscoveryResults \.premium-book-grid\s*\{[^}]*align-items:\s*stretch/);
  assert.match(body, /#premiumDiscoveryResults \.premium-book-card\s*\{[^}]*align-self:\s*stretch/);
  assert.match(body, /#premiumDiscoveryResults \.premium-book-card\s*\{[^}]*height:\s*auto/);
  assert.match(body, /#premiumDiscoveryResults \.premium-card-link\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(body, /#premiumDiscoveryResults \.premium-card-link\s*\{[^}]*min-height:\s*0/);
  assert.doesNotMatch(body, /height:\s*100%/);
  assert.doesNotMatch(body, /margin-top:\s*auto/);
  assert.doesNotMatch(body, /aspect-ratio/);
  assert.doesNotMatch(body, /object-fit/);
  assert.doesNotMatch(body, /premium-card-cover|\bimg\b/);
  assert.doesNotMatch(body, /premium-card-cart[^}]*\b(?:width|height)\s*:/);
  assert.doesNotMatch(body, /justify-content:\s*space-between/);
  assert.match(shop, /premium-cart-row-alignment-safety\.css\?v=1/);
  assert.match(shop, /data-kutadgu-premium-cart-row-alignment/);
  const loadPremium = (() => {
    const start = shop.indexOf("function loadPremiumUX(){");
    const end = shop.indexOf("let staticShellReady=false;");
    assert.ok(start >= 0 && end > start);
    return shop.slice(start, end);
  })();
  const stage4b2At = loadPremium.indexOf("ensureStage4b2HomepageDiscoveryCss()");
  const alignAt = loadPremium.lastIndexOf("ensurePremiumCartRowAlignmentCss()");
  assert.ok(stage4b2At >= 0 && alignAt > stage4b2At, "alignment CSS must load after Stage 4B-2");
  const ensureStage4b2 = (() => {
    const start = shop.indexOf("function ensureStage4b2HomepageDiscoveryCss(){");
    const end = shop.indexOf("function ensurePremiumCartRowAlignmentCss(){");
    assert.ok(start >= 0 && end > start);
    return shop.slice(start, end);
  })();
  assert.match(ensureStage4b2, /ensurePremiumCartRowAlignmentCss\(\)/);
});

test("this hotfix does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && !["SITE_HOMEPAGE_ABOUT.sql","STAGE9_ANALYTICS_INSERT_RLS.sql","STAGE4_ANALYTICS_RPC_FIX.sql","SUPABASE_SETUP.sql","DATABASE_UPGRADE_V10.sql"].includes(file)) ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)admin\.(html|js|css)$/i.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
});

if (failed) {
  console.error("\n" + failed + " compact-cards-mobile-cover test(s) failed");
  process.exit(1);
}
console.log("compact-cards-mobile-cover-tests ok");
