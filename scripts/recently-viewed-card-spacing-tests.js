#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "recently-viewed-card-safety.css"), "utf8");
const similar = fs.readFileSync(path.join(root, "detail-similar-card-safety.css"), "utf8");
const listing = fs.readFileSync(path.join(root, "listing-card-safety.css"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const myBooks = fs.readFileSync(path.join(root, "my-books.html"), "utf8");

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

test("Recently Viewed CSS is scoped away from Similar Books and listing grids", () => {
  assert.match(css, /\[data-recently-viewed\] \.shop-mini-card/);
  assert.match(css, /\.detail-extra-section:not\(\[data-detail-related\]\) \.detail-related-grid \.shop-mini-card/);
  assert.match(css, /height:auto\s*!important/);
  assert.match(css, /object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(css, /object-fit:\s*cover/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.doesNotMatch(css, /\.books-grid\[data-catalog-source\]/);
  assert.doesNotMatch(css, /\[data-detail-related\] \.detail-related-grid \.shop-mini-card\{/);
  assert.doesNotMatch(css, /home-carousel|premium-card/);
});

test("Recently Viewed equal-height uses reserved title/meta boxes without wrap stretch", () => {
  assert.match(css, /align-items:stretch/);
  assert.match(css, /align-self:stretch/);
  assert.match(css, /\.shop-mini-card\{[\s\S]*height:100%/);
  assert.match(css, /\.shop-mini-title\{[\s\S]*min-height:calc\(1\.7em \* 2\)/);
  assert.match(css, /\.shop-mini-meta\{[\s\S]*min-height:1\.7em/);
  assert.match(css, /\.mini-actions\{[\s\S]*margin-top:auto/);
  assert.doesNotMatch(css, /\.cover-stock-wrap\{[^}]*height:\s*100%/);
  assert.doesNotMatch(css, /align-items:start/);
  assert.doesNotMatch(css, /align-self:start/);
});

test("PR #98 Similar Books and PR #97 listing safety files stay listing/similar scoped", () => {
  assert.match(similar, /\[data-detail-related\] \.detail-related-grid \.shop-mini-card/);
  assert.doesNotMatch(similar, /data-recently-viewed/);
  assert.match(listing, /\.books-grid\[data-catalog-source\] \.book-card/);
  assert.doesNotMatch(listing, /data-recently-viewed/);
});

test("Recently Viewed still uses REC_KEY order and miniCard", () => {
  const recentFn = shop.slice(shop.indexOf("function recent(id){"), shop.indexOf("function toast(msg){"));
  assert.match(recentFn, /a\.unshift\(storeId\)/);
  assert.match(recentFn, /a\.slice\(0,12\)/);
  assert.match(recentFn, /canonicalId\(x\)!==storeId/);
  assert.match(shop, /data-recently-viewed="1"/);
  assert.match(shop, /recentBooks\.map\(miniCard\)/);
  assert.match(shop, /get\(REC_KEY,\[\]\)\.map\(find\)/);
});

test("book-shell index and my-books load recently-viewed safety after mobile.css", () => {
  for (const [name, html] of [["book-shell", shell], ["index", indexHtml], ["my-books", myBooks]]) {
    const mobileAt = html.indexOf("mobile.css");
    const safetyAt = html.indexOf("recently-viewed-card-safety.css?v=2");
    assert.ok(mobileAt >= 0 && safetyAt > mobileAt, name);
    assert.match(html, /data-kutadgu-recently-viewed-card-safety="1"/, name);
  }
  assert.match(shell, /data-kutadgu-similar-card-safety="1"/);
});

test("this hotfix does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only main HEAD; git diff --name-only; git diff --cached --name-only", {
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
  console.error("\n" + failed + " recently-viewed-card-spacing test(s) failed");
  process.exit(1);
}
console.log("recently-viewed-card-spacing-tests ok");
