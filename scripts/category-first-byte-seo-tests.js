#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const listing = require("../kutadgu-category-listing.js");
const handler = require("../api/category-listing.js");
const seo = require("../kutadgu-book-seo.js");
const sitemap = require("../kutadgu-sitemap.js");
const publicBook = require("../kutadgu-public-book.js");

const ORIGIN = "https://www.kutadgubilik.com";
const PRIVATE = /\/admin|\/account|service_role|submission_status|sales_count|legacy_id|\/api\/category-listing/;

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.stack || err);
  });
}

function row(id, extra) {
  return Object.assign({
    id: String(id),
    title: "كىتاب " + id,
    author: "ئابدۇقادىر جالالىدىن",
    image_url: ORIGIN + "/covers/book-" + id + ".webp",
    price: 120,
    stock: 8,
    stock_status: "",
    source: "romanlar.html",
    is_active: true
  }, extra || {});
}

function jsonResponse(status, body) {
  return {
    status,
    async json() { return body; }
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { this.body = body == null ? "" : body; }
  };
}

async function invoke(url, fetchImpl) {
  const previous = global.fetch;
  if (fetchImpl) global.fetch = fetchImpl;
  const res = mockRes();
  try {
    await handler({ url, method: "GET" }, res);
  } finally {
    global.fetch = previous;
  }
  return res;
}

function bookHrefs(html) {
  return [...String(html || "").matchAll(/<a[^>]+href="([^"]+)"/g)].map((match) => match[1]);
}

function bookAnchors(html) {
  return bookHrefs(html).filter((href) => /^\/book\/\d+$/.test(href));
}

function gridHtml(html) {
  const start = String(html || "").indexOf('<div class="books-grid"');
  assert.ok(start >= 0, "missing grid");
  const openEnd = html.indexOf(">", start);
  let depth = 1;
  let i = openEnd + 1;
  while (i < html.length && depth > 0) {
    const nextOpen = html.toLowerCase().indexOf("<div", i);
    const nextClose = html.toLowerCase().indexOf("</div>", i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start, nextClose + 6);
      i = nextClose + 6;
    }
  }
  throw new Error("unclosed grid");
}

function jsonLd(html) {
  const scripts = [...String(html || "").matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)];
  assert.strictEqual(scripts.length, 1, "expected one JSON-LD script");
  return JSON.parse(scripts[0][1]);
}

function typesOf(node) {
  return [].concat(node && node["@type"]);
}

async function run() {
  await test("trusted category slugs match the sitemap hubs", () => {
    assert.deepStrictEqual(listing.CATEGORY_SLUGS, sitemap.CATEGORY_HUB_SLUGS);
    assert.strictEqual(listing.CATEGORY_SLUGS.length, 17);
    assert.deepStrictEqual(listing.catalogSources("adabiyat"), listing.ADABIYAT_SOURCES);
    assert.ok(!listing.catalogSources("adabiyat").includes("uyghur-adabiyati.html"));
    assert.ok(!listing.catalogSources("adabiyat").includes("adabiyat-roman.html"));
    assert.deepStrictEqual(listing.catalogSources("children"), ["children.html"]);
    const romanUrl = listing.categoryBooksQueryUrl(listing.catalogSources("romanlar"), 0, 5);
    assert.match(romanUrl, /source=eq\.romanlar\.html(?:&|$)/);
    assert.doesNotMatch(romanUrl, /source=eq\."/);
    const hubUrl = listing.categoryBooksQueryUrl(listing.catalogSources("adabiyat"), 0, 5);
    assert.match(hubUrl, /source=in\.\("romanlar\.html","tarikhiy-romanlar\.html"/);
    assert.deepStrictEqual(listing.PARENT_SLUG.romanlar, "adabiyat");
    assert.ok(!listing.PARENT_SLUG.children);
    assert.ok(!listing.PARENT_SLUG.adabiyat);
  });

  await test("1 /romanlar first HTML contains real /book/<id> anchors", async () => {
    const books = [row(122), row(88, { title: "ئىككىنچى" })];
    const res = await invoke("/romanlar", async (url) => {
      assert.match(url, /source=eq\.romanlar\.html(?:&|$)/);
      assert.doesNotMatch(url, /source=eq\."/);
      assert.match(url, /is_active=eq\.true/);
      assert.doesNotMatch(url, /select=\*/);
      assert.doesNotMatch(url, /description|submission_status|service_role/);
      return jsonResponse(200, books);
    });
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body, /<a class="book-image" href="\/book\/122">/);
    assert.match(res.body, /<a class="detail-button" href="\/book\/88">/);
    assert.ok(bookAnchors(res.body).includes("/book/122"));
    assert.match(res.body, /rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/romanlar"/);
    assert.match(res.body, /content="index, follow"/);
  });

  await test("2 /children first HTML contains every active category book", () => {
    const books = [];
    for (let id = 1; id <= 78; id += 1) books.push(row(id, { source: "children.html", title: "بالا " + id }));
    const html = listing.applyCategoryDocument(listing.readTemplate("children"), "children", listing.rowsToBooks(books, ["children.html"]));
    const ids = [...new Set(bookAnchors(html))];
    assert.strictEqual(ids.length, 78);
    assert.ok(ids.includes("/book/1"));
    assert.ok(ids.includes("/book/78"));
    assert.match(html, /بالىلار كىتابلىرى/);
  });

  await test("3 inactive books are excluded", () => {
    const books = listing.rowsToBooks([
      row(10),
      row(11, { is_active: false }),
      row(12, { is_active: null })
    ], ["romanlar.html"]);
    assert.deepStrictEqual(books.map((book) => book.id), ["10"]);
  });

  await test("4 a book from another category is excluded", () => {
    const books = listing.rowsToBooks([
      row(21),
      row(22, { source: "children.html" }),
      row(23, { source: "uyghur-adabiyati.html" })
    ], listing.catalogSources("romanlar"));
    assert.deepStrictEqual(books.map((book) => book.id), ["21"]);
    const hub = listing.rowsToBooks([
      row(30, { source: "romanlar.html" }),
      row(31, { source: "uyghur-adabiyati.html" })
    ], listing.catalogSources("adabiyat"));
    assert.deepStrictEqual(hub.map((book) => book.id), ["30"]);
  });

  await test("5 and 6 every rendered href is canonical numeric /book/<id> and never legacy", () => {
    const html = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", listing.rowsToBooks([
      row(122),
      row("004", { id: "004" })
    ], ["romanlar.html"]));
    const grid = gridHtml(html);
    const hrefs = bookHrefs(grid).filter((href) => href.startsWith("/book") || href.includes("book.html"));
    assert.ok(hrefs.length >= 2);
    hrefs.forEach((href) => assert.match(href, /^\/book\/\d+$/));
    assert.doesNotMatch(html, /\/book\.html\?id=/);
    assert.doesNotMatch(html, /localhost|127\.0\.0\.1|vercel\.app|https?:\/\/kutadgubilik\.com(?!\/)/);
    assert.doesNotMatch(grid, /href="https?:/);
  });

  await test("7 rendered category HTML has no private URLs", () => {
    const html = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", listing.rowsToBooks([row(122)], ["romanlar.html"]));
    assert.doesNotMatch(html, PRIVATE);
    assert.doesNotMatch(listing.CATEGORY_SELECT, /description|submission|sales_count|legacy_id|email/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "kutadgu-category-listing.js"), "utf8"), /service_role/i);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "api/category-listing.js"), "utf8"), /service_role|\.insert\(|\.update\(|\.delete\(/);
  });

  await test("8 only safe covers are rendered and they stay bound to their book", () => {
    const books = listing.rowsToBooks([
      row(1, { image_url: ORIGIN + "/covers/real-1.webp" }),
      row(2, { image_url: "/sample-book-cover.png" }),
      row(3, { image_url: "javascript:alert(1)" }),
      row(4, { image_url: ORIGIN + "/carousel-sample-cover.png" }),
      row(5, { image_url: "/covers/local-5.webp" })
    ], ["romanlar.html"]);
    const html = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", books);
    assert.match(html, /data-cover-book="1"[^>]*|src="https:\/\/www\.kutadgubilik\.com\/covers\/real-1\.webp"/);
    assert.match(html, /src="https:\/\/www\.kutadgubilik\.com\/covers\/real-1\.webp"/);
    assert.match(html, /data-cover-book="1"/);
    assert.match(html, /src="https:\/\/www\.kutadgubilik\.com\/covers\/local-5\.webp"/);
    assert.match(html, /data-cover-book="5"/);
    assert.doesNotMatch(html, /sample-book-cover/);
    assert.doesNotMatch(html, /carousel-sample-cover/);
    assert.doesNotMatch(html, /javascript:/i);
    const card1 = html.slice(html.indexOf('data-live-book-id="1"'), html.indexOf('data-live-book-id="2"'));
    const card5 = html.slice(html.indexOf('data-live-book-id="5"'), html.indexOf('data-live-book-id="3"') > 0 ? html.length : html.length);
    assert.match(card1, /real-1\.webp/);
    assert.doesNotMatch(card1, /local-5\.webp/);
    assert.strictEqual(listing.cardCoverSrc({ image_url: "javascript:alert(1)", image: "javascript:alert(1)" }), "");
  });

  await test("9 placeholder authors do not become author SEO semantics", () => {
    const books = listing.rowsToBooks([
      row(1, { author: "" }),
      row(2, { author: "—" }),
      row(3, { author: "ئاپتور ئىسمى" }),
      row(4, { author: "نامەلۇم" }),
      row(5, { author: "يېزىلمىغان" }),
      row(6, { author: "مەخمۇت قەشقەرى" })
    ], ["romanlar.html"]);
    const html = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", books);
    assert.doesNotMatch(html, /itemprop="author"|rel="author"|href="\/author\/|"@type":"Person"/);
    assert.match(html, /ئاپتورى: نامەلۇم/);
    assert.match(html, /ئاپتورى: يېزىلمىغان/);
    assert.match(html, /ئاپتورى: مەخمۇت قەشقەرى/);
    ["", "—", "ئاپتور ئىسمى", "نامەلۇم", "يېزىلمىغان"].forEach((author) => {
      const graph = seo.buildBookJsonLd({ id: "9", title: "كىتاب", author, price: 10, category: "رومانلار" }, { visible: true, stockKey: "in" });
      assert.ok(!graph["@graph"][0].author, author || "blank");
    });
    const real = seo.buildBookJsonLd({ id: "9", title: "كىتاب", author: "مەخمۇت قەشقەرى", price: 10, category: "رومانلار" }, { visible: true, stockKey: "in" });
    assert.strictEqual(real["@graph"][0].author.name, "مەخمۇت قەشقەرى");
  });

  await test("10 CollectionPage remains inside one JSON-LD script", () => {
    const html = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", listing.rowsToBooks([row(122)], ["romanlar.html"]));
    const data = jsonLd(html);
    const collections = data["@graph"].filter((node) => typesOf(node).includes("CollectionPage"));
    assert.strictEqual(collections.length, 1);
    assert.strictEqual(collections[0].url, ORIGIN + "/romanlar");
    assert.strictEqual(collections[0].name, "رومانلار");
  });

  await test("11 BreadcrumbList uses the real category hierarchy", () => {
    const roman = jsonLd(listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", []));
    const crumbs = roman["@graph"].find((node) => node["@type"] === "BreadcrumbList");
    assert.deepStrictEqual(crumbs.itemListElement.map((item) => item.name), ["باش بەت", "ئەدەبىيات", "رومان"]);
    assert.deepStrictEqual(crumbs.itemListElement.map((item) => item.item), [
      ORIGIN + "/",
      ORIGIN + "/adabiyat",
      ORIGIN + "/romanlar"
    ]);
    const child = jsonLd(listing.applyCategoryDocument(listing.readTemplate("children"), "children", []));
    const childCrumbs = child["@graph"].find((node) => node["@type"] === "BreadcrumbList");
    assert.deepStrictEqual(childCrumbs.itemListElement.map((item) => item.item), [ORIGIN + "/", ORIGIN + "/children"]);
    assert.strictEqual(childCrumbs.itemListElement[1].name, "بالىلار كىتابلىرى");
    const hub = jsonLd(listing.applyCategoryDocument(listing.readTemplate("adabiyat"), "adabiyat", []));
    const hubCrumbs = hub["@graph"].find((node) => node["@type"] === "BreadcrumbList");
    assert.deepStrictEqual(hubCrumbs.itemListElement.map((item) => item.item), [ORIGIN + "/", ORIGIN + "/adabiyat"]);
    const uyghur = jsonLd(listing.applyCategoryDocument(listing.readTemplate("uyghur-adabiyati"), "uyghur-adabiyati", []));
    const uyghurCrumbs = uyghur["@graph"].find((node) => node["@type"] === "BreadcrumbList");
    assert.deepStrictEqual(uyghurCrumbs.itemListElement.map((item) => item.item), [
      ORIGIN + "/",
      ORIGIN + "/adabiyat",
      ORIGIN + "/uyghur-adabiyati"
    ]);
  });

  await test("12 Product.category is the real catalog category on Product/Book", () => {
    const graph = seo.buildBookJsonLd({
      id: "122",
      title: "يەر ئانا",
      author: "چىڭغىز ئايتماتوۋ",
      category: "رومانلار",
      price: 180,
      isbn: "9789750802959",
      source: "romanlar.html"
    }, { visible: true, stockKey: "in", image: ORIGIN + "/covers/real-122.webp" });
    const node = graph["@graph"][0];
    assert.deepStrictEqual(typesOf(node), ["Product", "Book"]);
    assert.strictEqual(node.category, "رومانلار");
    assert.strictEqual(node.gtin13, "9789750802959");
    assert.strictEqual(node.offers.priceCurrency, "TRY");
    assert.strictEqual(node.offers.seller["@id"], ORIGIN + "/#store");
    assert.strictEqual(node.url, ORIGIN + "/book/122");
  });

  await test("13 a missing category is omitted and publisher is not reused", () => {
    const missing = seo.buildBookJsonLd({ id: "7", title: "كىتاب", author: "ئاپتور", publisher: "قۇتادغۇبىلىك", price: 50 }, { visible: true, stockKey: "in" });
    assert.ok(!missing["@graph"][0].category);
    assert.notStrictEqual(missing["@graph"][0].category, "قۇتادغۇبىلىك");
    const blank = seo.buildBookJsonLd({ id: "8", title: "كىتاب", category: "  —  ", price: 50 }, { visible: true, stockKey: "in" });
    assert.ok(!blank["@graph"][0].category);
    const bookOnly = seo.buildBookJsonLd({ id: "9", title: "كىتاب", category: "رومانلار", price: 0 }, { visible: true, stockKey: "in" });
    assert.strictEqual(bookOnly["@graph"][0]["@type"], "Book");
    assert.ok(!bookOnly["@graph"][0].category);
  });

  await test("14 client hydration replaces the grid instead of duplicating cards", () => {
    const books = listing.rowsToBooks([row(1), row(2), row(3)], ["romanlar.html"]);
    const ssr = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", books);
    assert.strictEqual(new Set(bookAnchors(gridHtml(ssr))).size, 3);
    const hydrated = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", [books[0]]);
    assert.deepStrictEqual([...gridHtml(hydrated).matchAll(/data-live-book-id="(\d+)"/g)].map((match) => match[1]), ["1"]);
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const filters = shop.slice(shop.indexOf("function setupCatalogFilters(){"), shop.indexOf("function myBooksData()"));
    const draw = filters.slice(filters.indexOf("function draw(result,append=false){"), filters.indexOf("async function apply(append=false){"));
    assert.match(draw, /grid\.innerHTML=items\.map/);
    assert.doesNotMatch(draw, /insertAdjacentHTML|grid\.innerHTML\s*\+=/);
    assert.match(filters, /preserveSsr/);
    assert.match(shop, /data-catalog-client/);
  });

  await test("15 category filtering and sorting still call apply", () => {
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const listingApply = shop.slice(shop.indexOf("function setupCatalogFilters(){"), shop.indexOf("function myBooksData()"));
    assert.match(listingApply, /function listingFiltersIdle\(\)/);
    assert.match(listingApply, /sortEl\.value!=="relevance"/);
    assert.match(listingApply, /\[sortEl,collection\]\.forEach\(el=>el&&el\.addEventListener\("change",\(\)=>apply\(false\)\)\)/);
    assert.match(listingApply, /catalog-load-more/);
    assert.match(listingApply, /data-adabiyat-sub/);
  });

  await test("16 view-count hydration still targets live book ids", () => {
    const html = listing.applyCategoryDocument(listing.readTemplate("romanlar"), "romanlar", listing.rowsToBooks([row(122)], ["romanlar.html"]));
    assert.match(gridHtml(html), /data-live-book-id="122"/);
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const views = fs.readFileSync(path.join(root, "kutadgu-book-views.js"), "utf8");
    assert.match(shop, /ensureBookViewCounts\(\)/);
    assert.match(views, /\[data-live-book-id\]/);
    assert.match(views, /function watchCards\(\)/);
  });

  await test("17 cart and favorite controls remain buttons on the card", () => {
    const html = listing.applyCategoryDocument(listing.readTemplate("dini"), "dini", listing.rowsToBooks([
      row(15, { source: "dini.html" })
    ], ["dini.html"]));
    const grid = gridHtml(html);
    assert.match(grid, /<button type="button" class="add-to-cart" data-cart-id="15">/);
    assert.match(grid, /<button type="button" class="favorite-button" data-fav-id="15"/);
    assert.match(grid, /<button type="button" class="share-button" data-share-id="15"/);
    assert.doesNotMatch(grid, /<a[^>]+data-cart-id|<a[^>]+data-fav-id/);
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    assert.match(shop, /if\(ssrListingPresent\(grid\)\)bindDynamicActions\(grid\)/);
    assert.match(shop, /data-cart-id/);
    assert.match(shop, /data-fav-id/);
  });

  await test("18 mobile card structure stays on the existing card classes", () => {
    const html = listing.applyCategoryDocument(listing.readTemplate("children"), "children", listing.rowsToBooks([
      row(4, { source: "children.html" })
    ], ["children.html"]));
    const grid = gridHtml(html);
    assert.match(grid, /class="book-card"/);
    assert.match(grid, /class="book-info"/);
    assert.match(grid, /class="book-title"/);
    assert.match(grid, /class="book-actions"/);
    assert.match(grid, /class="book-price"/);
    assert.doesNotMatch(grid, /style="[^"]*display\s*:\s*none/i);
    assert.match(html, /grid-template-columns:\s*1fr/);
    assert.match(fs.readFileSync(path.join(root, "shop.css"), "utf8"), /\.books-grid\[data-catalog-source\] \.book-card\{[^}]*display:flex/);
  });

  await test("19 sitemap canonical book URLs stay numeric", () => {
    assert.strictEqual(sitemap.bookCanonicalUrl(122), ORIGIN + "/book/122");
    assert.ok(sitemap.CATEGORY_HUB_SLUGS.includes("romanlar"));
    assert.ok(sitemap.CATEGORY_HUB_SLUGS.includes("children"));
    const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    const books = (vercel.rewrites || []).find((rule) => rule.source === "/books");
    assert.strictEqual(books.destination, "/books.html");
    sitemap.CATEGORY_HUB_SLUGS.forEach((slug) => {
      const rewrite = (vercel.rewrites || []).find((rule) => rule.source === `/${slug}`);
      assert.strictEqual(rewrite.destination, `/api/category-listing?slug=${slug}`);
    });
  });

  await test("catalog fetch failure is 503 no-store and not an indexable empty category", async () => {
    const res = await invoke("/children", async () => {
      throw new Error("offline");
    });
    assert.strictEqual(res.statusCode, 503);
    assert.match(res.headers["cache-control"], /no-store/);
    assert.match(res.headers["x-robots-tag"], /noindex/);
    assert.match(res.body, /noindex, follow/);
    assert.doesNotMatch(res.body, /data-ssr-catalog/);
    assert.match(res.body, /book-card is-skeleton/);
    assert.doesNotMatch(bookHrefs(res.body).join("\n"), /\/book\/\d+/);
    const ok = await invoke("/sheirlar", async () => jsonResponse(200, [row(9, { source: "sheirlar.html" })]));
    assert.strictEqual(ok.statusCode, 200);
    assert.match(ok.headers["cache-control"], /s-maxage=300/);
    assert.match(ok.headers["cache-control"], /stale-while-revalidate=600/);
    assert.doesNotMatch(ok.headers["cache-control"], /max-age=86400|immutable/);
    assert.match(ok.body, /href="\/book\/9"/);
  });

  await test("category renderer does not generate book descriptions", () => {
    const src = fs.readFileSync(path.join(root, "kutadgu-category-listing.js"), "utf8")
      + fs.readFileSync(path.join(root, "api/category-listing.js"), "utf8");
    assert.doesNotMatch(src, /book\.description|description:/);
    assert.doesNotMatch(listing.CATEGORY_SELECT, /description/);
    const html = listing.applyCategoryDocument(listing.readTemplate("grammar"), "grammar", listing.rowsToBooks([
      row(3, { source: "grammar.html" })
    ], ["grammar.html"]));
    assert.doesNotMatch(gridHtml(html), /dynamic-book-description|meta name="description"/);
    const cols = publicBook.PUBLIC_SEO_SELECT.split(",");
    assert.ok(cols.includes("isbn"));
    assert.ok(!cols.includes("submission_status"));
  });

  await test("unknown slug is not served as a category", async () => {
    const res = await invoke("/books");
    assert.strictEqual(res.statusCode, 404);
    assert.match(res.headers["cache-control"], /no-store/);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " category first-byte SEO test(s) failed");
    process.exit(1);
  }
  console.log("category-first-byte-seo-tests ok");
});
