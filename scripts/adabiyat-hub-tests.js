#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const html = fs.readFileSync(path.join(root, "adabiyat.html"), "utf8");
const sitemap = require(path.join(root, "kutadgu-sitemap.js"));
const pagesXml = fs.readFileSync(path.join(root, "sitemap-pages.xml"), "utf8");
const romanlar = fs.readFileSync(path.join(root, "romanlar.html"), "utf8");
const sheirlar = fs.readFileSync(path.join(root, "sheirlar.html"), "utf8");

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

const start = shop.indexOf("const ADABIYAT_HUB_SUBS=");
const end = shop.indexOf("const catalogQueryState=");
assert.ok(start >= 0 && end > start, "adabiyat hub helpers must exist");
const helpers = new Function(`${shop.slice(start, end)}; return {ADABIYAT_HUB_SUBS,ADABIYAT_HUB_SOURCES,normalizeAdabiyatSub,adabiyatListingQuery,normalizeSourceList};`)();

test("authoritative literature sources match the six dedicated listing files", () => {
  assert.deepStrictEqual([...helpers.ADABIYAT_HUB_SOURCES], [
    "romanlar.html",
    "tarikhiy-romanlar.html",
    "sheirlar.html",
    "hekayiler.html",
    "dastanlar.html",
    "dunya-edebiyati.html"
  ]);
  assert.doesNotMatch(helpers.ADABIYAT_HUB_SOURCES.join(","), /uyghur-adabiyati|adabiyat-roman\.html/);
});

test("invalid sub values fall back to all literature", () => {
  assert.strictEqual(helpers.normalizeAdabiyatSub(""), "");
  assert.strictEqual(helpers.normalizeAdabiyatSub("romanlar"), "romanlar");
  assert.strictEqual(helpers.normalizeAdabiyatSub("romanlar.html"), "romanlar");
  assert.strictEqual(helpers.normalizeAdabiyatSub("not-a-category"), "");
  assert.strictEqual(helpers.normalizeAdabiyatSub("<script>"), "");
  const all = helpers.adabiyatListingQuery("nope");
  assert.strictEqual(all.source, "");
  assert.deepStrictEqual(all.sources, [...helpers.ADABIYAT_HUB_SOURCES]);
  const roman = helpers.adabiyatListingQuery("romanlar");
  assert.strictEqual(roman.source, "romanlar.html");
  assert.strictEqual(roman.sources, null);
});

test("source list sanitizes filenames and remote query uses in()", () => {
  assert.deepStrictEqual(helpers.normalizeSourceList({ sources: "romanlar.html, sheirlar.html, ../x" }), [
    "romanlar.html",
    "sheirlar.html"
  ]);
  assert.match(shop, /params\.set\("source",`in\.\(\$\{state\.sources\.map\(quotePostgrestValue\)/);
  assert.match(shop, /allowed\.has\(book\.source\)/);
  assert.match(shop, /history\.pushState/);
  assert.match(shop, /popstate/);
});

test("/adabiyat is books-first with hub markup and no emoji cards", () => {
  assert.match(html, /data-adabiyat-hub="1"/);
  assert.match(html, /data-catalog-source="adabiyat.html"/);
  assert.match(html, /data-catalog-sources="romanlar.html,tarikhiy-romanlar.html,sheirlar.html,hekayiler.html,dastanlar.html,dunya-edebiyati.html"/);
  assert.match(html, /book-card is-skeleton/);
  assert.match(html, /<h1>ئەدەبىيات<\/h1>/);
  assert.doesNotMatch(html, /📘|📕|📜|📖|📗|🌍/);
  assert.doesNotMatch(html, /href="\/romanlar" class="book-button"/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.kutadgubilik.com\/adabiyat"/);
  assert.doesNotMatch(html, /canonical[^>]+adabiyat\?/);
  assert.match(html, /public-header\.js\?v=1/);
  assert.match(html, /shop\.js\?v=115/);
  assert.match(html, /listing-card-safety\.css\?v=2/);
});

test("SEO keeps one parent canonical and does not sitemap filter states", () => {
  assert.ok(sitemap.PUBLIC_PAGE_PATHS.includes("/adabiyat"));
  assert.ok(sitemap.PUBLIC_PAGE_PATHS.includes("/romanlar"));
  assert.ok(!sitemap.PUBLIC_PAGE_PATHS.some((p) => p.includes("?sub=")));
  assert.ok(pagesXml.includes("/adabiyat</loc>"));
  assert.ok(pagesXml.includes("/romanlar</loc>"));
  assert.ok(!pagesXml.includes("adabiyat?"));
  assert.match(romanlar, /rel="canonical" href="https:\/\/www\.kutadgubilik.com\/romanlar"/);
  assert.match(sheirlar, /rel="canonical" href="https:\/\/www\.kutadgubilik.com\/sheirlar"/);
  assert.match(romanlar, /href="\/adabiyat"/);
  assert.match(shop, /data-adabiyat-hub/);
});

test("this PR does not change Admin/SQL/auth/order surfaces", () => {
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
  console.error("\n" + failed + " adabiyat-hub test(s) failed");
  process.exit(1);
}
console.log("adabiyat-hub-tests ok");
