#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sitemap = require("../kutadgu-sitemap.js");
const seo = require("../kutadgu-book-seo.js");

let failed = 0;
function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      console.log("PASS", name);
    } catch (err) {
      failed += 1;
      console.error("FAIL", name, err && err.message);
    }
  };
  return run();
}

function mockFetch(pages) {
  return async function fetchImpl(url, options) {
    const range = String((options && options.headers && options.headers.Range) || "0-0");
    const [from, to] = range.split("-").map(Number);
    const rows = pages.slice(from, to + 1);
    return {
      ok: true,
      status: 206,
      headers: { get: key => (String(key).toLowerCase() === "content-range" ? `${from}-${from + rows.length - 1}/${pages.length}` : "") },
      text: async () => JSON.stringify(rows)
    };
  };
}

const jobs = [];

jobs.push(test("A urlset is valid XML without invented changefreq/priority", () => {
  const xml = sitemap.buildUrlsetXml([
    { loc: "https://kutadgu-bilig-kitab.vercel.app/book.html?id=102", lastmod: "2026-08-28" },
    { loc: "https://kutadgu-bilig-kitab.vercel.app/book.html?id=103" }
  ]);
  assert.ok(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
  assert.ok(xml.includes("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"));
  assert.ok(xml.includes("<loc>https://kutadgu-bilig-kitab.vercel.app/book.html?id=102</loc>"));
  assert.ok(xml.includes("<lastmod>2026-08-28</lastmod>"));
  assert.ok(!xml.includes("changefreq"));
  assert.ok(!xml.includes("priority"));
  assert.ok(!xml.includes("<lastmod></lastmod>"));
  assert.ok(xml.includes("id=103"));
}));

jobs.push(test("C inactive books excluded; D no duplicate ids; no legacy loc", () => {
  const entries = sitemap.uniqueBookEntries([
    { id: 102, legacy_id: "children-3", is_active: true, updated_at: "2026-08-28T00:00:00Z" },
    { id: "102", legacy_id: "children-3", is_active: true, updated_at: "2026-08-28T00:00:00Z" },
    { id: 99, legacy_id: "hidden", is_active: false, updated_at: "2026-08-28T00:00:00Z" },
    { id: "children-3", legacy_id: "", is_active: true }
  ]);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].loc, "https://kutadgu-bilig-kitab.vercel.app/book.html?id=102");
  assert.ok(!entries.some(e => /children-3/.test(e.loc)));
}));

jobs.push(test("F private URLs never emitted", () => {
  const xml = sitemap.buildUrlsetXml([
    { loc: "https://kutadgu-bilig-kitab.vercel.app/admin.html" },
    { loc: "https://kutadgu-bilig-kitab.vercel.app/cart.html" },
    { loc: "https://kutadgu-bilig-kitab.vercel.app/account.html" },
    { loc: "https://kutadgu-bilig-kitab.vercel.app/favorites.html" },
    { loc: "https://kutadgu-bilig-kitab.vercel.app/my-books.html" },
    { loc: "https://kutadgu-bilig-kitab.vercel.app/book.html?id=1" }
  ]);
  assert.ok(!xml.includes("admin.html"));
  assert.ok(!xml.includes("cart.html"));
  assert.ok(!xml.includes("account.html"));
  assert.ok(!xml.includes("favorites.html"));
  assert.ok(!xml.includes("my-books.html"));
  assert.ok(xml.includes("book.html?id=1"));
}));

jobs.push(test("pages sitemap has public hubs and trust pages only", () => {
  const xml = sitemap.buildUrlsetXml(sitemap.publicPageEntries());
  assert.ok(xml.includes("https://kutadgu-bilig-kitab.vercel.app/</loc>"));
  assert.ok(xml.includes("/children.html"));
  assert.ok(xml.includes("/privacy.html"));
  assert.ok(xml.includes("/returns.html"));
  assert.ok(xml.includes("/order-info.html"));
  assert.ok(!xml.includes("/admin.html"));
  assert.ok(!xml.includes("/cart.html"));
  assert.ok(!xml.includes("localhost"));
}));

jobs.push(test("K 20k books stay in one sitemap; 50k uses index split", () => {
  assert.strictEqual(sitemap.sitemapPageCount(84), 1);
  assert.strictEqual(sitemap.sitemapPageCount(5000), 1);
  assert.strictEqual(sitemap.sitemapPageCount(20000), 1);
  assert.deepStrictEqual(sitemap.bookSitemapLocs(20000), ["https://kutadgu-bilig-kitab.vercel.app/sitemap-books.xml"]);
  assert.strictEqual(sitemap.sitemapPageCount(40001), 2);
  const locs = sitemap.indexLocs(40001);
  assert.strictEqual(locs[0], "https://kutadgu-bilig-kitab.vercel.app/sitemap-pages.xml");
  assert.ok(locs.includes("https://kutadgu-bilig-kitab.vercel.app/sitemap-books-1.xml"));
  assert.ok(locs.includes("https://kutadgu-bilig-kitab.vercel.app/sitemap-books-2.xml"));
  const fake = Array.from({ length: 20000 }, (_, i) => ({ loc: sitemap.bookCanonicalUrl(i + 1) }));
  const xml = sitemap.buildUrlsetXml(fake);
  assert.ok(xml.length < 50 * 1024 * 1024);
  assert.strictEqual((xml.match(/<url>/g) || []).length, 20000);
  assert.strictEqual(sitemap.FETCH_PAGE_SIZE, 1000);
  assert.ok(20000 / sitemap.FETCH_PAGE_SIZE <= 20);
}));

jobs.push(test("H I canonical helpers never use preview/localhost", () => {
  assert.strictEqual(seo.productionOrigin(), "https://kutadgu-bilig-kitab.vercel.app");
  assert.strictEqual(seo.bookCanonicalUrl("102"), "https://kutadgu-bilig-kitab.vercel.app/book.html?id=102");
  assert.ok(!seo.bookCanonicalUrl("102").includes("localhost"));
  assert.ok(!seo.buildBookJsonLd({ title: "T", id: "5" })["@graph"][0].url.includes("localhost"));
}));

jobs.push(test("J missing author/ISBN/description omitted; placeholder author skipped", () => {
  const json = seo.buildBookJsonLd({
    id: "5",
    title: "كىتاب",
    author: "ئاپتور ئىسمى",
    isbn: "",
    description: "",
    publisher: "",
    publishYear: "",
    price: null
  });
  const book = json["@graph"][0];
  assert.ok(!book.author);
  assert.ok(!book.isbn);
  assert.ok(!book.description);
  assert.ok(!book.publisher);
  assert.ok(!book.datePublished);
  assert.ok(!book.offers);
  assert.strictEqual(seo.metaDescription({ title: "كىتاب", description: "" }), "كىتاب — قۇتادغۇبىلىك كىتابخانىسى");
  const full = seo.buildBookJsonLd({
    id: "5",
    title: "كىتاب",
    author: "ئابدۇرېھىم ئۆتكۈر",
    isbn: "9789750802959",
    description: "چۈشەندۈرۈش",
    publisher: "نەشرىيات",
    publishYear: "2001",
    price: 120
  }, { visible: true, stockKey: "in" });
  const node = full["@graph"][0];
  assert.strictEqual(node.author.name, "ئابدۇرېھىم ئۆتكۈر");
  assert.strictEqual(node.isbn, "9789750802959");
  assert.strictEqual(node.datePublished, "2001");
  assert.strictEqual(node.offers.price, 120);
  assert.ok(!seo.isbnIfTrustworthy({ isbn: "not-an-isbn" }));
  assert.ok(!seo.datePublishedIfTrustworthy({ publishYear: "999" }));
}));

jobs.push(test("G robots.txt sitemap location and private disallows", () => {
  const robots = fs.readFileSync(path.join(__dirname, "..", "robots.txt"), "utf8");
  assert.ok(robots.includes("Sitemap: https://kutadgu-bilig-kitab.vercel.app/sitemap.xml"));
  assert.ok(robots.includes("Disallow: /admin.html"));
  assert.ok(robots.includes("Disallow: /admin-quality-preview.html"));
  assert.ok(robots.includes("Disallow: /cart.html"));
  assert.ok(robots.includes("Disallow: /account.html"));
  assert.ok(!/Disallow: \/\*\.js/.test(robots));
  assert.ok(!/Disallow: \/\*\.css/.test(robots));
}));

jobs.push(test("book.html indexes only canonical numeric ids before JS hydrate", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "book.html"), "utf8");
  assert.ok(html.includes('var origin="https://kutadgu-bilig-kitab.vercel.app"'));
  assert.ok(html.includes("canonicalId=/^\\d+$/.test"));
  assert.ok(!html.includes("localhost"));
}));

jobs.push(test("shop.js uses production origin and KutadguBookSeo", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "shop.js"), "utf8");
  assert.ok(js.includes("https://kutadgu-bilig-kitab.vercel.app"));
  assert.ok(js.includes("KutadguBookSeo"));
  assert.ok(!/return String\(window\.KUTADGU_SITE_ORIGIN\|\|""\)\.replace\(\/\\\/\+\$\/,""\)\|\|location\.origin/.test(js));
}));

jobs.push(test("static sitemap files are indexes/pages without private URLs", () => {
  const indexXml = fs.readFileSync(path.join(__dirname, "..", "sitemap.xml"), "utf8");
  const pagesXml = fs.readFileSync(path.join(__dirname, "..", "sitemap-pages.xml"), "utf8");
  assert.ok(indexXml.includes("<sitemapindex"));
  assert.ok(indexXml.includes("/sitemap-pages.xml"));
  assert.ok(indexXml.includes("/sitemap-books.xml"));
  assert.ok(!pagesXml.includes("changefreq"));
  assert.ok(!pagesXml.includes("/admin.html"));
  assert.ok(!pagesXml.includes("/cart.html"));
  assert.ok(!pagesXml.includes("book.html?id="));
}));

jobs.push(test("lastmod omitted when timestamp is untrustworthy", () => {
  const entry = sitemap.rowToSitemapEntry({ id: 8, is_active: true, updated_at: "not-a-date", created_at: "" });
  assert.strictEqual(entry.loc, "https://kutadgu-bilig-kitab.vercel.app/book.html?id=8");
  assert.ok(!entry.lastmod);
  const badYear = sitemap.trustworthyLastmod("1800-01-01T00:00:00Z");
  assert.strictEqual(badYear, "");
}));

jobs.push(test("B mocked generator emits one loc per active id", async () => {
  const rows = [
    { id: 1, legacy_id: "ozumuzni-etirap-qilayli", is_active: true, updated_at: "2026-08-28T23:44:39.224424+00:00" },
    { id: 102, legacy_id: "children-3", is_active: true, created_at: "2026-08-27T00:00:00Z" },
    { id: 500, legacy_id: "gone", is_active: false }
  ];
  const xml = await sitemap.buildBooksSitemapXml(1, mockFetch(rows.filter(r => r.is_active)));
  assert.ok(xml.includes("book.html?id=1"));
  assert.ok(xml.includes("book.html?id=102"));
  assert.ok(!xml.includes("id=500"));
  assert.ok(!xml.includes("children-3"));
}));

jobs.push(test("live: 84 active books, valid XML, production locs, no private (A B D F)", async () => {
  const xml = await sitemap.buildBooksSitemapXml(1);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(xml.includes("<urlset"));
  assert.ok(locs.length >= 80 && locs.length <= 84);
  assert.strictEqual(new Set(locs).size, locs.length);
  locs.forEach(loc => {
    assert.ok(loc.startsWith("https://kutadgu-bilig-kitab.vercel.app/book.html?id="));
    const id = loc.split("id=")[1];
    assert.ok(/^\d+$/.test(id));
  });
  assert.ok(locs.includes("https://kutadgu-bilig-kitab.vercel.app/book.html?id=102"));
  assert.ok(locs.includes("https://kutadgu-bilig-kitab.vercel.app/book.html?id=103"));
  assert.ok(!xml.includes("/admin.html"));
  assert.ok(!xml.includes("/cart.html"));
  const indexXml = await sitemap.buildIndexSitemapXml();
  assert.ok(indexXml.includes("<sitemapindex"));
  assert.ok(indexXml.includes("/sitemap-books.xml"));
}));

jobs.push(test("E live legacy_id children-3 resolves on storefront URL", async () => {
  const res = await fetch("https://kutadgu-bilig-kitab.vercel.app/book.html?id=children-3");
  assert.ok(res.ok);
  const html = await res.text();
  assert.ok(html.includes("book.html"));
}));

Promise.all(jobs).then(() => {
  if (failed) {
    console.error(failed + " failed");
    process.exit(1);
  }
  console.log("stage7-seo-tests ok");
});
