#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const booksHtml = fs.readFileSync(path.join(root, "books.html"), "utf8");
const headerJs = fs.readFileSync(path.join(root, "public-header.js"), "utf8");
const mobile = fs.readFileSync(path.join(root, "mobile.js"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const sitemap = require(path.join(root, "kutadgu-sitemap.js"));

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

function listingCatalogSource(raw) {
  const source = String(raw || "").trim();
  if (!source || source === "*" || source === "all" || source === "books.html") return "";
  return source;
}

test("listingCatalogSource treats empty and books.html as no source filter", () => {
  const start = shop.indexOf("function listingCatalogSource(raw){");
  const end = shop.indexOf("function setupCatalogFilters(){");
  assert.ok(start >= 0 && end > start);
  const fn = vm.runInNewContext(`${shop.slice(start, end)}; listingCatalogSource`);
  assert.strictEqual(fn(""), "");
  assert.strictEqual(fn("   "), "");
  assert.strictEqual(fn("*"), "");
  assert.strictEqual(fn("all"), "");
  assert.strictEqual(fn("books.html"), "");
  assert.strictEqual(fn("dini.html"), "dini.html");
  assert.strictEqual(fn("universal.html"), "universal.html");
  assert.strictEqual(listingCatalogSource("dini.html"), "dini.html");
});

test("books.html is a category-neutral listing with global SEO", () => {
  assert.match(booksHtml, /<title>بارلىق كىتابلار \| قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
  assert.match(booksHtml, /rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/books"/);
  assert.match(booksHtml, /og:url" content="https:\/\/www\.kutadgubilik\.com\/books"/);
  assert.match(booksHtml, /content="index, follow"/);
  assert.match(booksHtml, /"@type":"CollectionPage"/);
  assert.match(booksHtml, /class="books-grid" data-catalog-source=""/);
  assert.doesNotMatch(booksHtml, /data-catalog-source="[^"]+"/);
  assert.doesNotMatch(booksHtml, /ئۇنىۋېرسال ئەسەرلەر/);
  assert.match(booksHtml, /<h1>\s*بارلىق كىتابلار\s*<\/h1>/);
  assert.match(booksHtml, /قۇتادغۇبىلىك كىتابخانىسىدىكى بارلىق كىتابلارنى كۆرۈڭ، ئىزدەڭ ۋە تاللاڭ\./);
  assert.match(booksHtml, /باش بەتكە قايتىش/);
  assert.doesNotMatch(booksHtml, /كىتاب تۈرلىرىگە قايتىش/);
  assert.match(booksHtml, /listing-card-safety\.css\?v=2/);
  assert.match(booksHtml, /stage4b-public-cards\.css\?v=1/);
});

test("/books routing follows current category convention only", () => {
  const redirect = (vercel.redirects || []).find((r) => r.source === "/books.html");
  const rewrite = (vercel.rewrites || []).find((r) => r.source === "/books");
  assert.ok(redirect);
  assert.strictEqual(redirect.destination, "/books");
  assert.strictEqual(redirect.permanent, true);
  assert.ok(rewrite);
  assert.strictEqual(rewrite.destination, "/books.html");
  assert.ok(!(vercel.redirects || []).some((r) => r.source === "/books" && r.destination === "/books.html"));
  assert.ok(!vercel.cleanUrls);
  ["adabiyat", "universal", "tibb", "derslik", "terbiye", "dini", "children"].forEach((slug) => {
    const catRedirect = (vercel.redirects || []).find((r) => r.source === `/${slug}.html`);
    const catRewrite = (vercel.rewrites || []).find((r) => r.source === `/${slug}`);
    assert.strictEqual(catRedirect.destination, `/${slug}`);
    assert.strictEqual(catRewrite.destination, `/${slug}.html`);
  });
});

test("mobile drawer points Books at /books and categories at #bookCategories", () => {
  assert.match(mobile, /\["كىتابلار", "\/books"/);
  assert.match(mobile, /\["كىتاب تۈرلىرى", "\/#bookCategories"/);
  assert.match(mobile, /function syncCategoriesMenuLink\(menu\)/);
  assert.match(mobile, /data-mobile-categories/);
});

test("public Books / View all links point at /books and featured-all cannot revert", () => {
  assert.match(html, /<a href="\/books">\s*كىتابلار\s*<\/a>/);
  assert.match(html, /href="\/books" class="button" data-home-hero-primary/);
  assert.match(html, /class="home-featured-all" href="\/books"/);
  assert.match(shop, /class="home-featured-all" href="\/books"/);
  assert.doesNotMatch(shop, /class="home-featured-all" href="#books"/);
  assert.match(headerJs, /var booksHref = "\/books"/);
  assert.match(headerJs, /function ensureBooksNavLink\(nav\)/);
  assert.match(mobile, /\["كىتابلار", "\/books"/);
  assert.match(mobile, /\["كىتاب تۈرلىرى", "\/#bookCategories"/);
  assert.match(html, /id="books"/);
  assert.match(html, /home-search-card-section/);
});

test("sitemap includes /books without treating it as a category hub", () => {
  const xml = sitemap.buildUrlsetXml(sitemap.publicPageEntries());
  assert.ok(xml.includes("/books</loc>"));
  assert.ok(!sitemap.CATEGORY_HUB_SLUGS.includes("books"));
});

if (failed) {
  console.error("\n" + failed + " stage5d global books test(s) failed");
  process.exit(1);
}
console.log("stage5d-global-books-tests ok");
