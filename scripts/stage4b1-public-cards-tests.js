#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "stage4b-public-cards.css"), "utf8");
const listingSafety = fs.readFileSync(path.join(root, "listing-card-safety.css"), "utf8");
const similarSafety = fs.readFileSync(path.join(root, "detail-similar-card-safety.css"), "utf8");
const recentSafety = fs.readFileSync(path.join(root, "recently-viewed-card-safety.css"), "utf8");
const coverMobile = fs.readFileSync(path.join(root, "detail-cover-mobile-safety.css"), "utf8");
const covers = fs.readFileSync(path.join(root, "covers.css"), "utf8");
const mobile = fs.readFileSync(path.join(root, "mobile.css"), "utf8");
const theme = fs.readFileSync(path.join(root, "theme.css"), "utf8");
const shopJs = fs.readFileSync(path.join(root, "shop.js"), "utf8");

const LISTING_PAGES = [
  "romanlar.html","universal.html","children.html","dini.html","derslik.html","terbiye.html",
  "tibb.html","dastanlar.html","sheirlar.html","hekayiler.html","uyghur-adabiyati.html",
  "dunya-edebiyati.html","adabiyat-roman.html","tarikhiy-romanlar.html","adabiyat.html","books.html"
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

test("Stage 4B-1 stylesheet has no forbidden geometry overrides", () => {
  const decls = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(decls, /aspect-ratio/);
  assert.doesNotMatch(decls, /object-fit/);
  assert.doesNotMatch(decls, /object-position/);
  assert.doesNotMatch(decls, /cover-stock-wrap/);
  assert.doesNotMatch(decls, /book-cover-box/);
  assert.doesNotMatch(decls, /height\s*:\s*100%/);
  assert.doesNotMatch(decls, /height\s*:\s*auto/);
  assert.doesNotMatch(decls, /align-items/);
  assert.doesNotMatch(decls, /margin-top\s*:\s*auto/);
  assert.doesNotMatch(decls, /\.book-image|\.book-cover(?!-box)/);
  assert.doesNotMatch(decls, /home-feature|home-carousel|premium-book-card|premium-card/);
});

test("listing typography and action hierarchy use Stage 4A tokens", () => {
  assert.match(css, /\.books-grid\[data-catalog-source\] \.book-card \.book-title\s*\{[\s\S]*font-size:\s*var\(--font-size-lg\)/);
  assert.match(css, /\.books-grid\[data-catalog-source\] \.book-card \.book-author\s*\{[\s\S]*color:\s*var\(--site-text-soft\)/);
  assert.match(css, /\.books-grid\[data-catalog-source\] \.book-card \.book-author\s*\{[\s\S]*font-size:\s*var\(--font-size-sm\)/);
  assert.match(css, /\.books-grid\[data-catalog-source\] \.book-card \.book-price\s*\{[\s\S]*color:\s*var\(--site-text\)/);
  assert.match(css, /\.book-actions \.add-to-cart\s*\{[\s\S]*background-color:\s*var\(--button-primary-bg\)/);
  assert.match(css, /\.book-actions \.detail-button\s*\{[\s\S]*background-color:\s*var\(--button-secondary-bg\)/);
  assert.match(css, /\.book-actions \.favorite-button,[\s\S]*min-height:\s*44px/);
  assert.match(css, /min-height:\s*44px/);
});

test("mini-card chrome is scoped to similar, recent, and homepage selector grids", () => {
  assert.match(css, /\[data-detail-related\] \.detail-related-grid \.shop-mini-title/);
  assert.match(css, /\[data-recently-viewed\] \.shop-mini-title/);
  assert.match(css, /#homeShopSections \.shop-mini-title/);
  assert.match(css, /#homeShopSections \.shop-mini-card \.mini-actions \.add-to-cart\s*\{[\s\S]*background-color:\s*var\(--button-primary-bg\)/);
  assert.match(css, /\.advanced-search-actions \.add-to-cart\s*\{[\s\S]*background-color:\s*var\(--button-primary-bg\)/);
  assert.match(css, /\.advanced-search-actions \.detail-button\s*\{[\s\S]*background-color:\s*var\(--button-secondary-bg\)/);
});

test("safety and shared geometry files stay byte-identical to origin/main", () => {
  const names = [
    "listing-card-safety.css",
    "detail-similar-card-safety.css",
    "recently-viewed-card-safety.css",
    "detail-cover-mobile-safety.css",
    "covers.css",
    "mobile.css",
    "theme.css",
    "shop.js"
  ];
  for (const name of names) {
    const diff = execSync(`git diff -- origin/main -- ${name}`, { cwd: root, encoding: "utf8" });
    assert.strictEqual(diff, "", name + " changed");
  }
  assert.match(listingSafety, /\.books-grid\[data-catalog-source\] \.book-card/);
  assert.match(similarSafety, /height:auto\s*!important/);
  assert.match(recentSafety, /height:auto\s*!important/);
  assert.match(coverMobile, /\.detail-page-body \.book-cover-box:not\(\.no-cover\)/);
  assert.match(covers, /object-fit:contain/);
  assert.ok(mobile.length > 100);
  assert.match(theme, /--button-primary-bg/);
  assert.match(shopJs, /function miniCard\(b\)\{/);
  assert.match(shopJs, /function stockBadge\(book\)\{/);
});

test("Similar/Recent wrap-height:auto and reserved title boxes remain in safety CSS", () => {
  assert.match(similarSafety, /\.cover-stock-wrap\{[\s\S]*height:auto\s*!important/);
  assert.match(recentSafety, /\.cover-stock-wrap\{[\s\S]*height:auto\s*!important/);
  assert.match(similarSafety, /\.shop-mini-title\{[\s\S]*min-height:calc\(1\.7em \* 2\)/);
  assert.match(recentSafety, /\.shop-mini-title\{[\s\S]*min-height:calc\(1\.7em \* 2\)/);
  assert.match(similarSafety, /\.mini-actions\{[\s\S]*margin-top:auto/);
  assert.match(recentSafety, /\.mini-actions\{[\s\S]*margin-top:auto/);
  assert.doesNotMatch(css, /min-height:calc\(1\.7em \* 2\)/);
});

test("stock UX helpers still hide in-stock labels and exact quantities", () => {
  assert.match(shopJs, /if\(!s\.label\|\|s\.key==="in"\|\|s\.key==="unknown"\)return ""/);
  assert.match(shopJs, /if\(qty<=3\)return \{key:"low",label:"ئاز قالدى"/);
  assert.doesNotMatch(shopJs, /stockBadge[\s\S]{0,400}ئامباردا بار/);
  const badgeFn = shopJs.slice(shopJs.indexOf("function stockBadge(book){"), shopJs.indexOf("function coverStockOverlayHtml"));
  assert.doesNotMatch(badgeFn, /\.qty/);
});

test("listing, hub, detail, homepage, and my-books load Stage 4B-1 after safety CSS", () => {
  const marker = 'data-kutadgu-stage4b-public-cards="1"';
  for (const file of LISTING_PAGES) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /stage4b-public-cards\.css\?v=1/, file);
    assert.match(html, new RegExp(marker), file);
    const safetyAt = html.indexOf("listing-card-safety.css");
    const stageAt = html.indexOf("stage4b-public-cards.css");
    assert.ok(safetyAt >= 0 && stageAt > safetyAt, file + " overlay must follow listing safety");
    const mobileAt = html.search(/href=["'](?:\/)?mobile\.css/);
    if (mobileAt >= 0) {
      assert.ok(stageAt > mobileAt, file + " overlay must follow mobile.css");
    }
  }
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const shell = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
  const myBooks = fs.readFileSync(path.join(root, "my-books.html"), "utf8");
  for (const [name, html] of [["index", indexHtml], ["book-shell", shell], ["my-books", myBooks]]) {
    assert.match(html, /stage4b-public-cards\.css\?v=1/, name);
    assert.match(html, new RegExp(marker), name);
    const recentAt = html.indexOf("recently-viewed-card-safety.css");
    const similarAt = html.indexOf("detail-similar-card-safety.css");
    const stageAt = html.indexOf("stage4b-public-cards.css");
    if (recentAt >= 0) assert.ok(stageAt > recentAt, name + " after recently-viewed safety");
    if (similarAt >= 0) assert.ok(stageAt > similarAt, name + " after similar safety");
  }
  assert.ok(shell.indexOf("stage4b-public-cards.css") > shell.indexOf("detail-cover-mobile-safety.css"));
});

test("this slice does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    /\.sql$/i.test(file) ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)admin\.(html|js|css)$/i.test(file) ||
    /listing-card-safety|detail-similar-card-safety|recently-viewed-card-safety|detail-cover-mobile-safety|covers\.css|mobile\.css|theme\.css/.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
  assert.match(shopJs, /function homeFeatureCard\(b\)\{/);
  assert.match(shopJs, /function cartButton\(/);
});

if (failed) {
  console.error("\n" + failed + " stage4b1 public card test(s) failed");
  process.exit(1);
}
console.log("stage4b1-public-cards-tests ok");
