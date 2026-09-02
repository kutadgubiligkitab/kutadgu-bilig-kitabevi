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
    { loc: "https://www.kutadgubilik.com/book/102", lastmod: "2026-08-28" },
    { loc: "https://www.kutadgubilik.com/book/103" }
  ]);
  assert.ok(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
  assert.ok(xml.includes("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"));
  assert.ok(xml.includes("<loc>https://www.kutadgubilik.com/book/102</loc>"));
  assert.ok(xml.includes("<lastmod>2026-08-28</lastmod>"));
  assert.ok(!xml.includes("changefreq"));
  assert.ok(!xml.includes("priority"));
  assert.ok(!xml.includes("<lastmod></lastmod>"));
  assert.ok(xml.includes("/book/103"));
}));

jobs.push(test("C inactive books excluded; D no duplicate ids; no legacy loc", () => {
  const entries = sitemap.uniqueBookEntries([
    { id: 102, legacy_id: "children-3", is_active: true, updated_at: "2026-08-28T00:00:00Z" },
    { id: "102", legacy_id: "children-3", is_active: true, updated_at: "2026-08-28T00:00:00Z" },
    { id: 99, legacy_id: "hidden", is_active: false, updated_at: "2026-08-28T00:00:00Z" },
    { id: "children-3", legacy_id: "", is_active: true }
  ]);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].loc, "https://www.kutadgubilik.com/book/102");
  assert.ok(!entries.some(e => /children-3/.test(e.loc)));
}));

jobs.push(test("F private URLs never emitted", () => {
  const xml = sitemap.buildUrlsetXml([
    { loc: "https://www.kutadgubilik.com/admin.html" },
    { loc: "https://www.kutadgubilik.com/cart.html" },
    { loc: "https://www.kutadgubilik.com/account.html" },
    { loc: "https://www.kutadgubilik.com/favorites.html" },
    { loc: "https://www.kutadgubilik.com/my-books.html" },
    { loc: "https://www.kutadgubilik.com/book/1" }
  ]);
  assert.ok(!xml.includes("admin.html"));
  assert.ok(!xml.includes("cart.html"));
  assert.ok(!xml.includes("account.html"));
  assert.ok(!xml.includes("favorites.html"));
  assert.ok(!xml.includes("my-books.html"));
  assert.ok(xml.includes("/book/1"));
}));

jobs.push(test("pages sitemap has public hubs and trust pages only", () => {
  const xml = sitemap.buildUrlsetXml(sitemap.publicPageEntries());
  assert.ok(xml.includes("https://www.kutadgubilik.com/</loc>"));
  assert.ok(xml.includes("/children</loc>"));
  assert.ok(!xml.includes("/children.html"));
  assert.ok(xml.includes("/privacy</loc>"));
  assert.ok(xml.includes("/returns</loc>"));
  assert.ok(xml.includes("/order-info</loc>"));
  assert.ok(!xml.includes("/privacy.html"));
  assert.ok(!xml.includes("/returns.html"));
  assert.ok(!xml.includes("/order-info.html"));
  assert.ok(!xml.includes("/admin.html"));
  assert.ok(!xml.includes("/cart.html"));
  assert.ok(!xml.includes("localhost"));
  assert.ok(!xml.includes("ozumuzni-etirap-qilayli.html"));
  assert.ok(!xml.includes("kutadgu-bilig-kitab.vercel.app"));
}));

jobs.push(test("K 20k books stay in one sitemap; 50k uses index split", () => {
  assert.strictEqual(sitemap.sitemapPageCount(84), 1);
  assert.strictEqual(sitemap.sitemapPageCount(5000), 1);
  assert.strictEqual(sitemap.sitemapPageCount(20000), 1);
  assert.deepStrictEqual(sitemap.bookSitemapLocs(20000), ["https://www.kutadgubilik.com/sitemap-books.xml"]);
  assert.strictEqual(sitemap.sitemapPageCount(40001), 2);
  const locs = sitemap.indexLocs(40001);
  assert.strictEqual(locs[0], "https://www.kutadgubilik.com/sitemap-pages.xml");
  assert.ok(locs.includes("https://www.kutadgubilik.com/sitemap-books-1.xml"));
  assert.ok(locs.includes("https://www.kutadgubilik.com/sitemap-books-2.xml"));
  const fake = Array.from({ length: 20000 }, (_, i) => ({ loc: sitemap.bookCanonicalUrl(i + 1) }));
  const xml = sitemap.buildUrlsetXml(fake);
  assert.ok(xml.length < 50 * 1024 * 1024);
  assert.strictEqual((xml.match(/<url>/g) || []).length, 20000);
  assert.strictEqual(sitemap.FETCH_PAGE_SIZE, 1000);
  assert.ok(20000 / sitemap.FETCH_PAGE_SIZE <= 20);
}));

jobs.push(test("H I canonical helpers never use preview/localhost", () => {
  assert.strictEqual(seo.productionOrigin(), "https://www.kutadgubilik.com");
  assert.strictEqual(seo.bookCanonicalUrl("102"), "https://www.kutadgubilik.com/book/102");
  assert.ok(!seo.productionOrigin().includes("kutadgubilig.com"));
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

jobs.push(test("public info pages use www clean canonicals", () => {
  sitemap.PUBLIC_INFO_SLUGS.forEach(slug => {
    const html = fs.readFileSync(path.join(__dirname, "..", `${slug}.html`), "utf8");
    assert.ok(html.includes(`rel="canonical" href="https://www.kutadgubilik.com/${slug}"`));
    assert.ok(!html.includes(`kutadgubilik.com/${slug}.html`));
    assert.ok(!html.includes("kutadgubilig.com"));
  });
}));

jobs.push(test("category hubs use www canonical; numbered stubs stay noindex to old hub URL", () => {
  const universal = fs.readFileSync(path.join(__dirname, "..", "universal.html"), "utf8");
  const page2 = fs.readFileSync(path.join(__dirname, "..", "universal-2.html"), "utf8");
  assert.ok(universal.includes('rel="canonical" href="https://www.kutadgubilik.com/universal"'));
  assert.ok(universal.includes('og:url" content="https://www.kutadgubilik.com/universal"'));
  assert.ok(universal.includes('content="index, follow"'));
  assert.ok(!universal.includes("kutadgu-bilig-kitab.vercel.app"));
  assert.ok(!universal.includes('kutadgubilik.com/universal.html'));
  assert.ok(page2.includes('content="noindex, follow"'));
  assert.ok(page2.includes('rel="canonical" href="https://www.kutadgubilik.com/universal.html"'));
}));

jobs.push(test("category hub clean URLs are explicit redirects+rewrites without global cleanUrls", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(!vercel.cleanUrls);
  const home = (vercel.redirects || []).filter(r => r.source === "/index.html");
  assert.strictEqual(home.length, 1);
  assert.strictEqual(home[0].destination, "/");
  sitemap.CATEGORY_HUB_SLUGS.forEach(slug => {
    const redirect = (vercel.redirects || []).find(r => r.source === `/${slug}.html`);
    const rewrite = (vercel.rewrites || []).find(r => r.source === `/${slug}`);
    assert.ok(redirect, `missing redirect for ${slug}`);
    assert.strictEqual(redirect.destination, `/${slug}`);
    assert.strictEqual(redirect.permanent, true);
    assert.ok(rewrite, `missing rewrite for ${slug}`);
    assert.strictEqual(rewrite.destination, `/${slug}.html`);
    assert.ok(!(vercel.redirects || []).some(r => r.source === `/${slug}` && r.destination === `/${slug}.html`));
  });
  assert.ok(!(vercel.redirects || []).some(r => r.source === "/book.html"), "vercel.json must not 308 /book.html with unsubstituted :id");
  const bookHtmlLegacy = (vercel.rewrites || []).find(r => r.source === "/book.html");
  const bookQueryLegacy = (vercel.rewrites || []).find(r => r.source === "/book" && r.destination === "/api/legacy-book-redirect");
  const bookShell = (vercel.rewrites || []).find(r => r.source === "/book" && r.destination === "/book.html");
  assert.ok(bookHtmlLegacy, "missing /book.html numeric-id rewrite to redirect function");
  assert.strictEqual(bookHtmlLegacy.destination, "/api/legacy-book-redirect");
  assert.strictEqual(bookHtmlLegacy.has[0].type, "query");
  assert.strictEqual(bookHtmlLegacy.has[0].key, "id");
  assert.strictEqual(bookHtmlLegacy.has[0].value, "\\d+");
  assert.ok(bookQueryLegacy, "missing /book?id= rewrite to redirect function");
  assert.strictEqual(bookQueryLegacy.has[0].value, "\\d+");
  const bookRewrite = (vercel.rewrites || []).find(r => r.source === "/book/:id");
  assert.ok(bookRewrite, "missing /book/:id rewrite");
  assert.strictEqual(bookRewrite.destination, "/book.html");
  assert.ok(bookShell, "missing /book rewrite to book.html");
  const htmlIdx = (vercel.rewrites || []).findIndex(r => r.source === "/book.html");
  const queryIdx = (vercel.rewrites || []).findIndex(r => r.source === "/book" && r.destination === "/api/legacy-book-redirect");
  const pathIdx = (vercel.rewrites || []).findIndex(r => r.source === "/book/:id");
  const shellIdx = (vercel.rewrites || []).findIndex(r => r.source === "/book" && r.destination === "/book.html");
  assert.ok(htmlIdx >= 0 && htmlIdx < pathIdx, "/book.html numeric rewrite must precede /book/:id");
  assert.ok(queryIdx >= 0 && queryIdx < pathIdx, "/book?id= rewrite must precede /book/:id");
  assert.ok(pathIdx >= 0 && pathIdx < shellIdx, "/book/:id rewrite must precede bare /book shell");
  sitemap.PUBLIC_INFO_SLUGS.forEach(slug => {
    const redirect = (vercel.redirects || []).find(r => r.source === `/${slug}.html`);
    const rewrite = (vercel.rewrites || []).find(r => r.source === `/${slug}`);
    assert.ok(redirect, `missing redirect for ${slug}`);
    assert.strictEqual(redirect.destination, `/${slug}`);
    assert.strictEqual(redirect.permanent, true);
    assert.ok(rewrite, `missing rewrite for ${slug}`);
    assert.strictEqual(rewrite.destination, `/${slug}.html`);
    assert.ok(!(vercel.redirects || []).some(r => r.source === `/${slug}` && r.destination === `/${slug}.html`));
  });
  assert.ok(!(vercel.redirects || []).some(r => r.source === "/cart.html"));
  assert.ok(!(vercel.redirects || []).some(r => r.source === "/account.html"));
  assert.ok(!(vercel.rewrites || []).some(r => r.source === "/universal-2"));
}));

jobs.push(test("G robots.txt sitemap location and private disallows", () => {
  const robots = fs.readFileSync(path.join(__dirname, "..", "robots.txt"), "utf8");
  assert.ok(robots.includes("Sitemap: https://www.kutadgubilik.com/sitemap.xml"));
  assert.ok(robots.includes("Disallow: /admin.html"));
  assert.ok(robots.includes("Disallow: /admin-quality-preview.html"));
  assert.ok(robots.includes("Disallow: /cart.html"));
  assert.ok(robots.includes("Disallow: /account.html"));
  assert.ok(!/Disallow: \/\*\.js/.test(robots));
  assert.ok(!/Disallow: \/\*\.css/.test(robots));
}));

jobs.push(test("book.html shell does not ship a first-byte robots or canonical veto", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "book.html"), "utf8");
  assert.ok(!/meta[^>]*name=["']robots["']/i.test(html));
  assert.ok(!/rel=["']canonical["']/i.test(html));
  assert.ok(!html.includes("kutadguRobots"));
  assert.ok(!html.includes("noindex"));
  assert.ok(!html.includes('content="index, follow"'));
  assert.ok(!html.includes("kutadgu-bilig-kitab.vercel.app"));
  assert.ok(!html.includes("localhost"));
  const shop = fs.readFileSync(path.join(__dirname, "..", "shop.js"), "utf8");
  assert.ok(shop.includes("applyUnresolvedDetailDocument"));
  assert.ok(shop.includes('indexable?"index, follow":"noindex, follow"'));
  assert.ok(shop.includes("isStorefrontVisible(book)"));
  const js = fs.readFileSync(path.join(__dirname, "..", "kutadgu-book-seo.js"), "utf8");
  assert.ok(js.includes("function applyUnresolvedDetailDocument"));
}));

jobs.push(test("book clean URL helpers parse path/query and never invent NaN paths", () => {
  assert.strictEqual(seo.bookPath("126"), "/book/126");
  assert.strictEqual(seo.bookPath(" 122 "), "/book/122");
  assert.strictEqual(seo.bookPath("children-3"), "");
  assert.strictEqual(seo.bookPath(""), "");
  assert.strictEqual(seo.parseBookIdFromLocation({ pathname: "/book/122", search: "" }), "122");
  assert.strictEqual(seo.parseBookIdFromLocation({ pathname: "/book.html", search: "?id=122" }), "122");
  assert.strictEqual(seo.parseBookIdFromLocation({ pathname: "/book.html", search: "?id=children-3" }), "children-3");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=126" }), "/book/126");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=126&utm=1" }), "/book/126?utm=1");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book", search: "?id=122" }), "/book/122");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book", search: "?id=122&utm=1" }), "/book/122?utm=1");
  assert.strictEqual(seo.legacyNumericIdRedirectPath("?id=122"), "/book/122");
  assert.strictEqual(seo.legacyNumericIdRedirectPath("?id=122&utm=x"), "/book/122?utm=x");
  assert.ok(!seo.legacyNumericIdRedirectPath("?id=122").includes("id="));
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=children-3" }), "");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book", search: "?id=undefined" }), "");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book", search: "?id=null" }), "");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book", search: "?id=NaN" }), "");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "" }), "");
  assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book/126", search: "?id=99" }), "");
  assert.ok(seo.isBookDetailPath("/book/126"));
  assert.ok(seo.isBookDetailPath("/book.html"));
  assert.ok(seo.isBookDetailPath("/book"));
  assert.ok(!seo.isBookDetailPath("/universal"));
}));

jobs.push(test("legacy-book-redirect function 308s numeric id and refuses fake paths", async () => {
  const handler = require("../api/legacy-book-redirect.js");
  function invoke(url) {
    return new Promise((resolve) => {
      const res = {
        statusCode: 0,
        headers: {},
        setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
        end() { resolve({ status: this.statusCode, location: this.headers.location || "" }); }
      };
      Promise.resolve(handler({ url }, res)).catch((err) => resolve({ status: 500, location: String(err) }));
    });
  }
  const html = await invoke("/api/legacy-book-redirect?id=122");
  assert.strictEqual(html.status, 308);
  assert.strictEqual(html.location, "/book/122");
  assert.ok(!/[?&]id=/.test(html.location));
  const withUtm = await invoke("/book?id=122&utm=src");
  assert.strictEqual(withUtm.status, 308);
  assert.strictEqual(withUtm.location, "/book/122?utm=src");
  assert.ok(!/[?&]id=/.test(withUtm.location.replace("utm=src", "")));
  for (const raw of ["undefined", "null", "NaN", "children-3"]) {
    const bad = await invoke(`/api/legacy-book-redirect?id=${raw}`);
    assert.strictEqual(bad.status, 404, raw);
    assert.ok(!/\/book\/(undefined|null|NaN|children-3)\b/.test(bad.location), raw);
  }
}));

jobs.push(test("book.html nested-route assets are root-relative", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "book.html"), "utf8");
  assert.ok(html.includes('href="/theme.css?'));
  assert.ok(html.includes('href="/shop.css?'));
  assert.ok(html.includes('href="/covers.css?'));
  assert.ok(html.includes('href="/mobile.css?'));
  assert.ok(html.includes('src="/shop.js?'));
  assert.ok(html.includes('src="/kutadgu-book-seo.js?'));
  assert.ok(html.includes('src="/mobile.js?'));
  assert.ok(!/href="theme\.css/.test(html));
  assert.ok(!/src="shop\.js/.test(html));
}));

jobs.push(test("unresolved detail SEO never indexes placeholder or emits Book JSON-LD", () => {
  const fake = {
    head: {
      nodes: [],
      querySelector(sel) {
        return this.nodes.find(n =>
          (sel === 'meta[name="robots"]' && n.name === "robots")
          || (sel === 'link[rel="canonical"]' && n.rel === "canonical")
          || (sel === "#kutadguBookSchema" && n.id === "kutadguBookSchema")
        ) || null;
      },
      createElement(tag) {
        return {
          tag,
          id: "",
          name: "",
          rel: "",
          content: "",
          href: "",
          parentNode: null,
          setAttribute(k, v) { this[k] = v; }
        };
      },
      appendChild(node) {
        node.parentNode = this;
        this.nodes.push(node);
      }
    }
  };
  seo.applyUnresolvedDetailDocument(fake);
  const robots = fake.head.nodes.filter(n => n.name === "robots");
  const canonical = fake.head.nodes.filter(n => n.rel === "canonical");
  assert.strictEqual(robots.length, 1);
  assert.strictEqual(robots[0].content, "noindex, follow");
  assert.strictEqual(canonical.length, 1);
  assert.strictEqual(canonical[0].href, "https://www.kutadgubilik.com/book.html");
  assert.ok(!canonical[0].href.includes("id="));
  assert.strictEqual(fake.head.nodes.filter(n => n.id === "kutadguBookSchema").length, 0);
  seo.applyUnresolvedDetailDocument(fake);
  assert.strictEqual(fake.head.nodes.filter(n => n.name === "robots").length, 1);
  assert.strictEqual(fake.head.nodes.filter(n => n.rel === "canonical").length, 1);
}));

jobs.push(test("shop.js uses www production origin and KutadguBookSeo", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "shop.js"), "utf8");
  assert.ok(js.includes("https://www.kutadgubilik.com"));
  assert.ok(js.includes("KutadguBookSeo"));
  assert.ok(!js.includes("kutadgubilig.com"));
  assert.ok(!js.includes("kutadgu-bilig-kitab.vercel.app"));
  assert.ok(js.includes('href="/privacy"'));
  assert.ok(js.includes('href="/returns"'));
  assert.ok(js.includes('href="/order-info"'));
  assert.ok(!js.includes("href=\"privacy.html\""));
}));

jobs.push(test("static sitemap files are indexes/pages without private URLs", () => {
  const indexXml = fs.readFileSync(path.join(__dirname, "..", "sitemap.xml"), "utf8");
  const pagesXml = fs.readFileSync(path.join(__dirname, "..", "sitemap-pages.xml"), "utf8");
  assert.ok(indexXml.includes("<sitemapindex"));
  assert.ok(indexXml.includes("https://www.kutadgubilik.com/sitemap-pages.xml"));
  assert.ok(indexXml.includes("https://www.kutadgubilik.com/sitemap-books.xml"));
  assert.ok(!pagesXml.includes("changefreq"));
  assert.ok(pagesXml.includes("/children</loc>"));
  assert.ok(pagesXml.includes("/privacy</loc>"));
  assert.ok(!pagesXml.includes("/privacy.html"));
  assert.ok(!pagesXml.includes("/children.html"));
  assert.ok(!pagesXml.includes("/admin.html"));
  assert.ok(!pagesXml.includes("/cart.html"));
  assert.ok(!pagesXml.includes("book.html?id="));
  assert.ok(!pagesXml.includes("ozumuzni-etirap-qilayli.html"));
  assert.ok(!pagesXml.includes("kutadgu-bilig-kitab.vercel.app"));
  assert.ok(!indexXml.includes("kutadgu-bilig-kitab.vercel.app"));
}));

jobs.push(test("lastmod omitted when timestamp is untrustworthy", () => {
  const entry = sitemap.rowToSitemapEntry({ id: 8, is_active: true, updated_at: "not-a-date", created_at: "" });
  assert.strictEqual(entry.loc, "https://www.kutadgubilik.com/book/8");
  assert.ok(!entry.lastmod);
  const badYear = sitemap.trustworthyLastmod("1800-01-01T00:00:00Z");
  assert.strictEqual(badYear, "");
}));

jobs.push(test("B mocked generator emits one loc per active id", async () => {
  const rows = [
    { id: 1, legacy_id: "ozumuzni-etirap-qilayli", is_active: true, updated_at: "2026-08-28T23:44:39.224424+00:00" },
    { id: 102, legacy_id: "children-3", is_active: true, created_at: "2026-08-27T00:00:00Z" },
    { id: 103, legacy_id: "children-4", is_active: true, updated_at: "2026-08-28T00:00:00Z" },
    { id: 500, legacy_id: "gone", is_active: false, updated_at: "2026-08-28T00:00:00Z" }
  ];
  const xml = await sitemap.buildBooksSitemapXml(1, mockFetch(rows));
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
  assert.ok(xml.includes("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"));
  assert.strictEqual(locs.length, 3);
  assert.deepStrictEqual(locs, [
    "https://www.kutadgubilik.com/book/1",
    "https://www.kutadgubilik.com/book/102",
    "https://www.kutadgubilik.com/book/103"
  ]);
  assert.strictEqual(new Set(locs).size, 3);
  locs.forEach(loc => {
    assert.ok(/^https:\/\/www\.kutadgubilik\.com\/book\/\d+$/.test(loc));
  });
  assert.ok(!xml.includes("id=500"));
  assert.ok(!xml.includes("children-3"));
  assert.ok(!xml.includes("children-4"));
  assert.ok(!xml.includes("ozumuzni-etirap-qilayli"));
  assert.ok(!xml.includes("/admin.html"));
  assert.ok(!xml.includes("/cart.html"));
  const indexXml = await sitemap.buildIndexSitemapXml(mockFetch(rows.filter(r => r.is_active === true)));
  assert.ok(indexXml.includes("<sitemapindex"));
  assert.ok(indexXml.includes("https://www.kutadgubilik.com/sitemap-books.xml"));
  assert.ok(!indexXml.includes("sitemap-books-1.xml"));
}));

const LIVE_SEO = String(process.env.KUTADGU_LIVE_SEO_TESTS || "").trim() === "1";
if (LIVE_SEO) {
  jobs.push(test("opt-in live books sitemap smoke (structure only, no catalog size)", async () => {
    const xml = await sitemap.buildBooksSitemapXml(1);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert.ok(xml.includes("<urlset"));
    assert.ok(locs.length > 0, "live sitemap returned no book locs");
    assert.strictEqual(new Set(locs).size, locs.length);
    locs.forEach(loc => {
      assert.ok(/^https:\/\/www\.kutadgubilik\.com\/book\/\d+$/.test(loc));
    });
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
}

Promise.all(jobs).then(() => {
  if (failed) {
    console.error(failed + " failed");
    process.exit(1);
  }
  console.log("stage7-seo-tests ok");
});
