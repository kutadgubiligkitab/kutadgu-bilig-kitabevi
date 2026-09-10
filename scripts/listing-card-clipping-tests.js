#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const safety = fs.readFileSync(path.join(root, "listing-card-safety.css"), "utf8");
const shopCss = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const LISTING_PAGES = [
  "romanlar.html","universal.html","children.html","dini.html","derslik.html","terbiye.html",
  "tibb.html","dastanlar.html","sheirlar.html","hekayiler.html","uyghur-adabiyati.html",
  "dunya-edebiyati.html","adabiyat-roman.html","tarikhiy-romanlar.html","adabiyat.html"
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

test("listing safety stylesheet is a catalog-grid scoped hotfix", () => {
  assert.match(safety, /\.books-grid\[data-catalog-source\] \.book-card/);
  assert.match(safety, /aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(safety, /object-fit:\s*contain\s*!important/);
  assert.doesNotMatch(safety, /object-fit:\s*cover/);
  assert.match(safety, /-webkit-line-clamp:\s*2/);
  assert.match(safety, /line-clamp:\s*2/);
  assert.match(safety, /-webkit-line-clamp:\s*1/);
  assert.match(safety, /line-height:\s*1\.7/);
  assert.match(safety, /overflow-wrap:\s*anywhere/);
  assert.match(safety, /\.book-actions/);
  assert.match(safety, /body\.dark-mode/);
  assert.doesNotMatch(safety, /home-carousel|similar-books|premium-card/);
});

test("cover wrap is a flex contain frame, not a clipping block", () => {
  assert.match(shopCss, /\.cover-stock-wrap\{[^}]*display:flex/);
  assert.match(safety, /\.cover-stock-wrap\{[\s\S]*display:flex\s*!important/);
  assert.match(safety, /\.book-image,[\s\S]*display:flex\s*!important/);
  assert.match(safety, /max-width:100%\s*!important/);
  assert.match(safety, /max-height:100%\s*!important/);
});

test("live listing pages load the safety stylesheet after unified layout", () => {
  for (const file of LISTING_PAGES) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /data-kutadgu-listing-card-safety="1"/, file);
    assert.match(html, /listing-card-safety\.css\?v=2/, file);
    const unified = html.indexOf('id="unified-book-card-layout"');
    const safetyAt = html.indexOf("listing-card-safety.css");
    assert.ok(unified >= 0 && safetyAt > unified, `${file} safety CSS must follow unified layout`);
    const unifiedBlock = html.slice(unified, html.indexOf("</style>", unified));
    assert.match(unifiedBlock, /\.book-cover[\s\S]{0,80}display:\s*flex\s*!important/, file);
    assert.doesNotMatch(unifiedBlock, /\.book-cover[\s\S]{0,40}display:\s*block\s*!important/, file);
  }
});

test("this hotfix does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only main HEAD; git diff --name-only; git diff --cached --name-only", {
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
  console.error("\n" + failed + " listing-card-clipping test(s) failed");
  process.exit(1);
}
console.log("listing-card-clipping-tests ok");
