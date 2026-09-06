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

test("this hotfix does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    /\.sql$/i.test(file) ||
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
