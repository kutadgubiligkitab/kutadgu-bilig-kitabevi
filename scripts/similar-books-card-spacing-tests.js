#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "detail-similar-card-safety.css"), "utf8");
const shopCss = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const listingSafety = fs.readFileSync(path.join(root, "listing-card-safety.css"), "utf8");
const shell = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");

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

test("Similar Books safety CSS is scoped to data-detail-related mini cards", () => {
  assert.match(css, /\[data-detail-related\] \.detail-related-grid \.shop-mini-card/);
  assert.match(css, /\.cover-stock-wrap\{[\s\S]*height:auto\s*!important/);
  assert.match(css, /aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(css, /object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(css, /object-fit:\s*cover/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /line-height:\s*1\.7/);
  assert.doesNotMatch(css, /\.books-grid\[data-catalog-source\]/);
  assert.doesNotMatch(css, /home-carousel|premium-card|home-feature/);
  assert.match(css, /body\.dark-mode/);
});

test("Similar Books equal-height uses reserved title/meta boxes without wrap stretch", () => {
  assert.match(css, /\[data-detail-related\] \.detail-related-grid\{[\s\S]*align-items:stretch/);
  assert.match(css, /align-self:stretch/);
  assert.match(css, /\.shop-mini-card\{[\s\S]*height:100%/);
  assert.match(css, /\.shop-mini-title\{[\s\S]*min-height:calc\(1\.7em \* 2\)/);
  assert.match(css, /\.shop-mini-meta\{[\s\S]*min-height:1\.7em/);
  assert.match(css, /\.mini-actions\{[\s\S]*margin-top:auto/);
  assert.doesNotMatch(css, /\.cover-stock-wrap\{[^}]*height:\s*100%/);
  assert.doesNotMatch(css, /align-self:start/);
});

test("book-shell loads similar-card safety after mobile.css", () => {
  const mobileAt = shell.indexOf("mobile.css");
  const safetyAt = shell.indexOf("detail-similar-card-safety.css?v=2");
  assert.ok(mobileAt >= 0 && safetyAt > mobileAt);
  assert.match(shell, /data-kutadgu-similar-card-safety="1"/);
});

test("recommendation markup still uses miniCard and same-category helpers", () => {
  const markup = shop.slice(shop.indexOf("function detailRelatedMarkup(book,related){"), shop.indexOf("function paintDetailRelated("));
  assert.match(markup, /related\.map\(miniCard\)/);
  assert.match(markup, /data-detail-related="1"/);
  assert.match(markup, /detail-related-grid/);
  const rec = shop.slice(shop.indexOf("function detailRecommendations(book,limit=DETAIL_RELATED_LIMIT,catalog){"), shop.indexOf("function detailGallerySlides(book){"));
  assert.match(rec, /String\(item\.category\|\|""\)\.trim\(\)===category/);
  assert.doesNotMatch(markup, /bookCardMarkup/);
});

test("PR #97 listing-card-safety remains listing-grid scoped and untouched in intent", () => {
  assert.match(listingSafety, /\.books-grid\[data-catalog-source\] \.book-card/);
  assert.doesNotMatch(listingSafety, /data-detail-related|shop-mini-card|detail-related-grid/);
  assert.match(shopCss, /\[data-detail-related\] \.detail-related-grid \.shop-mini-card \.cover-stock-wrap/);
});

test("this hotfix does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && file !== "SITE_HOMEPAGE_ABOUT.sql") ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)admin\.(html|js|css)$/i.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
});

if (failed) {
  console.error("\n" + failed + " similar-card-spacing test(s) failed");
  process.exit(1);
}
console.log("similar-books-card-spacing-tests ok");
