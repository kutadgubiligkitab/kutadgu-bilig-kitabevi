#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const seo = require("../kutadgu-book-seo.js");
const publicBook = require("../kutadgu-public-book.js");
const sitemap = require("../kutadgu-sitemap.js");
const stock = require("../kutadgu-stock.js");
const handler = require("../api/book-public.js");

const ORIGIN = "https://www.kutadgubilik.com";
const COVER = "https://www.kutadgubilik.com/covers/real-122.webp";
const FAKE = /aggregateRating|reviewCount|"review"|shippingDetails|hasMerchantReturnPolicy|priceValidUntil|"brand"|"mpn"/;

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

function book(extra) {
  return Object.assign({
    id: "122",
    title: "يەر ئانا",
    author: "چىڭغىز ئايتماتوۋ",
    description: "قىسقا چۈشەندۈرۈش.",
    category: "رومانلار",
    publisher: "قۇتادغۇبىلىك",
    language: "ug",
    publishYear: "2018",
    price: 180,
    stock: 12,
    source: "romanlar.html",
    isbn: "9789750802959"
  }, extra || {});
}

function typesOf(node) {
  return [].concat(node && node["@type"]);
}

function nodesOf(payload, typeName) {
  return (payload["@graph"] || []).filter((node) => typesOf(node).includes(typeName));
}

function graphFor(row, options) {
  return seo.buildBookJsonLd(row, Object.assign({
    visible: true,
    stockKey: "in",
    image: COVER
  }, options || {}));
}

function productOf(payload) {
  const nodes = nodesOf(payload, "Product");
  assert.strictEqual(nodes.length, 1, "expected exactly one Product node");
  return nodes[0];
}

function assertNoInventedCommerce(node) {
  const raw = JSON.stringify(node);
  assert.doesNotMatch(raw, FAKE);
  assert.ok(!node.aggregateRating);
  assert.ok(!node.review);
  assert.ok(!node.brand);
  assert.ok(!node.mpn);
  assert.ok(!node.offers.shippingDetails);
  assert.ok(!node.offers.hasMerchantReturnPolicy);
  assert.ok(!node.offers.priceValidUntil);
}

function googleProductChecks(node) {
  const errors = [];
  const warnings = [];
  const types = typesOf(node);
  if (!types.includes("Product")) errors.push("missing Product type");
  if (!types.includes("Book")) errors.push("missing Book type");
  if (!String(node.name || "").trim()) errors.push("missing name");
  if (!node.offers || node.offers["@type"] !== "Offer") errors.push("missing Offer");
  else {
    const price = Number(node.offers.price);
    if (!Number.isFinite(price) || price <= 0) errors.push("merchant listing requires price > 0");
    if (node.offers.priceCurrency !== "TRY") errors.push("missing TRY priceCurrency");
  }
  if (!node.image) warnings.push("merchant listing image missing; product snippet can still use the offer");
  if (!node.description) warnings.push("description recommended");
  if (!node.sku) warnings.push("sku recommended");
  if (!node.gtin13 && !node.isbn) warnings.push("gtin/isbn omitted");
  if (!node.offers || !node.offers.availability) warnings.push("availability omitted");
  if (!node.brand) warnings.push("brand omitted; publisher is not used as a brand");
  if (!node.aggregateRating && !node.review) warnings.push("review/aggregateRating omitted");
  return { errors, warnings };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { if (body != null) this.chunks.push(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); }
  };
}

function jsonResponse(status, body) {
  return { status, async json() { return body; } };
}

async function invoke(url, row) {
  const orig = global.fetch;
  global.fetch = async () => jsonResponse(200, row ? [row] : []);
  const res = mockRes();
  try {
    await handler({ url, method: "GET" }, res);
  } finally {
    global.fetch = orig;
  }
  return { status: res.statusCode, body: res.chunks.join("") };
}

function jsonLd(html) {
  const matches = html.match(/<script id="kutadguBookSchema" type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  assert.strictEqual(matches.length, 1);
  const body = matches[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  return JSON.parse(body);
}

function rowFrom(extra) {
  const src = book(extra);
  return {
    id: Number(src.id),
    title: src.title,
    author: src.author,
    description: src.description,
    image_url: extra && Object.prototype.hasOwnProperty.call(extra, "image_url") ? extra.image_url : COVER,
    category: src.category,
    publisher: src.publisher,
    isbn: src.isbn,
    price: src.price,
    stock: src.stock,
    stock_status: extra && extra.stockStatus != null ? extra.stockStatus : (extra && extra.stock_status) || "",
    source: src.source,
    publish_year: src.publishYear
  };
}

async function run() {
  await test("1-3 active sellable book is one Product+Book node plus BreadcrumbList", () => {
    const payload = graphFor(book());
    const node = productOf(payload);
    assert.deepStrictEqual(typesOf(node), ["Product", "Book"]);
    assert.strictEqual(nodesOf(payload, "Book").length, 1);
    assert.strictEqual(nodesOf(payload, "BreadcrumbList").length, 1);
    assert.strictEqual(node["@id"], ORIGIN + "/book/122#book");
    assert.strictEqual(node.name, "يەر ئانا");
    assert.strictEqual(node.url, ORIGIN + "/book/122");
    assert.strictEqual(node.author.name, "چىڭغىز ئايتماتوۋ");
    assert.strictEqual(node.isbn, "9789750802959");
    assert.strictEqual(node.publisher.name, "قۇتادغۇبىلىك");
    assert.strictEqual(node.inLanguage, "ug");
    assert.strictEqual(node.datePublished, "2018");
    assertNoInventedCommerce(node);
    const checks = googleProductChecks(node);
    assert.deepStrictEqual(checks.errors, []);
  });

  await test("4 valid ISBN-13 is both Book.isbn and Product.gtin13", () => {
    const node = productOf(graphFor(book({ isbn: "978-975-08-0295-9" })));
    assert.strictEqual(node.isbn, "9789750802959");
    assert.strictEqual(node.gtin13, "9789750802959");
  });

  await test("5 invalid or missing ISBN never becomes gtin13", () => {
    ["7228052258", "9789750802950", "not-an-isbn", "", "9786051234567"].forEach((isbn) => {
      const node = productOf(graphFor(book({ isbn })));
      const compact = isbn.replace(/[^0-9X]/gi, "");
      assert.ok(!node.gtin13, isbn);
      assert.ok(!node.isbn, isbn);
      if (compact) assert.ok(!JSON.stringify(node).includes(compact), isbn);
    });
  });

  await test("6 ISBN-10 stays on Book.isbn and is not rewritten as gtin13", () => {
    ["0306406152", "080442957X", "0 306 40615 2"].forEach((isbn) => {
      const node = productOf(graphFor(book({ isbn })));
      assert.strictEqual(node.isbn, isbn.replace(/[\s-]+/g, "").toUpperCase());
      assert.ok(!node.gtin13, isbn);
      assert.ok(!/^978/.test(String(node.isbn)));
    });
  });

  await test("7-11 price, condition, and effective stock map onto one TRY Offer", () => {
    const priced = productOf(graphFor(book({ price: 180 }), { stockKey: "in" }));
    assert.strictEqual(priced.offers["@type"], "Offer");
    assert.strictEqual(priced.offers.price, 180);
    assert.strictEqual(priced.offers.priceCurrency, "TRY");
    assert.strictEqual(priced.offers.url, ORIGIN + "/book/122");
    assert.strictEqual(priced.offers.itemCondition, "https://schema.org/NewCondition");
    assert.strictEqual(priced.offers.availability, "https://schema.org/InStock");
    assert.deepStrictEqual(priced.offers.seller, { "@id": ORIGIN + "/#store" });
    assert.strictEqual(priced.sku, "KBG-122");

    assert.strictEqual(productOf(graphFor(book(), { stockKey: "low" })).offers.availability, "https://schema.org/InStock");
    const sold = productOf(graphFor(book(), { stockKey: "out" }));
    assert.strictEqual(sold.offers.availability, "https://schema.org/OutOfStock");
    assert.ok(typesOf(sold).includes("Product"));
    const unknown = productOf(graphFor(book(), { stockKey: "" }));
    assert.ok(!unknown.offers.availability);
  });

  await test("server stock key follows the storefront helper, including manual override", () => {
    function key(row) {
      return stock.storefrontStockInfo(publicBook.publicSeoBook(row, String(row.id)), { stockEnforcement: true }).key;
    }
    assert.strictEqual(key(rowFrom({ stock: 12, stock_status: "" })), "in");
    assert.strictEqual(key(rowFrom({ stock: 2, stock_status: "" })), "low");
    assert.strictEqual(key(rowFrom({ stock: 0, stock_status: "in_stock" })), "out");
    assert.strictEqual(key(rowFrom({ stock: 9, stock_status: "out_of_stock" })), "out");
    assert.strictEqual(key(rowFrom({ stock: 9, stock_status: "low_stock" })), "low");
    assert.strictEqual(key(rowFrom({ stock: 9, stock_status: "in_stock" })), "in");
  });

  await test("12 inactive or missing books emit no Product node", () => {
    const hidden = seo.buildBookJsonLd(book(), { visible: false, stockKey: "in", image: COVER });
    assert.strictEqual(nodesOf(hidden, "Product").length, 0);
    assert.strictEqual(hidden["@graph"][0]["@type"], "Book");
    assert.ok(!hidden["@graph"][0].gtin13);
    assert.ok(!hidden["@graph"][0].sku);
    const free = seo.buildBookJsonLd(book({ price: 0 }), { visible: true, stockKey: "in", image: COVER });
    assert.strictEqual(nodesOf(free, "Product").length, 0);
    assert.strictEqual(free["@graph"][0]["@type"], "Book");
  });

  await test("13 missing, sample, and unsafe covers omit image instead of substituting one", () => {
    ["", "sample-book-cover.png", "/sample-book-cover(1).png", "carousel-sample-cover.png", "javascript:alert(1)", "http://cdn.example/cover.jpg"].forEach((image) => {
      const node = productOf(graphFor(book(), { image }));
      assert.ok(!node.image, image);
    });
    const relative = productOf(graphFor(book(), { image: "/covers/real-122.webp" }));
    assert.strictEqual(relative.image, COVER);
  });

  await test("14 empty description uses the factual fallback and no promotional claim", () => {
    const row = book({ description: "", author: "چىڭغىز ئايتماتوۋ" });
    const node = productOf(graphFor(row));
    assert.strictEqual(node.description, seo.metaDescription(row));
    assert.match(node.description, /يەر ئانا/);
    assert.match(node.description, /ئاپتور: چىڭغىز ئايتماتوۋ/);
    assert.match(node.description, /تۈرى: رومانلار/);
    assert.match(node.description, /نەشرىيات: قۇتادغۇبىلىك/);
    assert.match(node.description, /نەشر يىلى: 2018/);
    assert.doesNotMatch(node.description, /دانە|ئېتىبار|ئەرزان|ھەقسىز|ئەڭ ئاۋات/);
    const bare = seo.buildBookJsonLd(book({ description: "", price: null }));
    assert.ok(!bare["@graph"][0].description);
  });

  await test("15-18 first-byte HTML already contains one Product graph, one canonical, and the clean URL", async () => {
    const row = rowFrom({ stock: 12, stock_status: "in_stock" });
    const out = await invoke("/book/122", row);
    assert.strictEqual(out.status, 200);
    assert.match(out.body, /<title>يەر ئانا - قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
    assert.strictEqual((out.body.match(/rel=["']canonical["']/gi) || []).length, 1);
    assert.strictEqual((out.body.match(/name=["']robots["']/gi) || []).length, 1);
    assert.ok(out.body.includes('<link rel="canonical" href="https://www.kutadgubilik.com/book/122">'));
    assert.match(out.body, /<h1>يەر ئانا<\/h1>/);
    const payload = jsonLd(out.body);
    const node = productOf(payload);
    assert.deepStrictEqual(typesOf(node), ["Product", "Book"]);
    assert.strictEqual(node.gtin13, "9789750802959");
    assert.strictEqual(node.offers.priceCurrency, "TRY");
    assert.strictEqual(node.offers.availability, "https://schema.org/InStock");
    assert.strictEqual(node.offers.itemCondition, "https://schema.org/NewCondition");
    assert.strictEqual(node.image, COVER);
    assert.strictEqual(nodesOf(payload, "BreadcrumbList").length, 1);
    assert.deepStrictEqual(googleProductChecks(node).errors, []);

    const sold = await invoke("/book/122", rowFrom({ stock: 8, stock_status: "out_of_stock" }));
    assert.match(sold.body, /index, follow/);
    assert.strictEqual(productOf(jsonLd(sold.body)).offers.availability, "https://schema.org/OutOfStock");

    const low = await invoke("/book/122", rowFrom({ stock: 2, stock_status: "" }));
    assert.strictEqual(productOf(jsonLd(low.body)).offers.availability, "https://schema.org/InStock");

    const noIsbn = await invoke("/book/122", rowFrom({ isbn: "" }));
    assert.ok(!productOf(jsonLd(noIsbn.body)).gtin13);

    const noCover = await invoke("/book/122", rowFrom({ image_url: "" }));
    const coverless = productOf(jsonLd(noCover.body));
    assert.ok(!coverless.image);
    assert.doesNotMatch(noCover.body, /sample-book-cover|og:image/);
    assert.deepStrictEqual(googleProductChecks(coverless).errors, []);
    assert.ok(googleProductChecks(coverless).warnings.some((item) => /image/.test(item)));

    const noDesc = await invoke("/book/122", rowFrom({ description: "" }));
    assert.match(noDesc.body, /<section class="dynamic-book-description" hidden>/);
    assert.match(productOf(jsonLd(noDesc.body)).description, /يەر ئانا/);

    const missing = await invoke("/book/999999999", null);
    assert.strictEqual(missing.status, 404);
    assert.match(missing.body, /noindex/i);
    assert.doesNotMatch(missing.body, /kutadguBookSchema|"@type"\s*:\s*"Product"|gtin13/);
  });

  await test("16 hydration replaces the same script and does not add a second Product", async () => {
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const update = shop.slice(shop.indexOf("function updateBookSeo(book){"), shop.indexOf("function populateDynamicBookPage(b){"));
    assert.match(update, /querySelector\("#kutadguBookSchema"\)/);
    assert.match(update, /if\(!schema\)\{schema=document\.createElement\("script"\);schema\.id="kutadguBookSchema"/);
    assert.match(update, /schema\.textContent=JSON\.stringify\(payload\)/);
    assert.doesNotMatch(update, /createElement\("script"\)[\s\S]*createElement\("script"\)/);

    const out = await invoke("/book/122", rowFrom({}));
    const before = jsonLd(out.body);
    const mapped = publicBook.publicSeoBook(rowFrom({}), "122");
    const hydrated = seo.buildBookJsonLd(mapped, {
      canonical: ORIGIN + "/book/122",
      authorName: seo.storefrontAuthor(mapped),
      image: COVER,
      visible: true,
      stockKey: "in"
    });
    const replaced = out.body.replace(
      /<script id="kutadguBookSchema" type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script id="kutadguBookSchema" type="application/ld+json">${JSON.stringify(hydrated).replace(/</g, "\\u003c")}</script>`
    );
    const after = jsonLd(replaced);
    assert.strictEqual((replaced.match(/id=["']kutadguBookSchema["']/gi) || []).length, 1);
    assert.strictEqual(nodesOf(after, "Product").length, 1);
    assert.strictEqual(nodesOf(after, "Book").length, 1);
    assert.strictEqual(after["@graph"][0]["@id"], before["@graph"][0]["@id"]);
    assert.strictEqual(after["@graph"][0].offers.price, before["@graph"][0].offers.price);
    assert.strictEqual(after["@graph"][0].name, before["@graph"][0].name);
  });

  await test("19-20 sitemap keeps active canonical books once and drops inactive, private, and legacy URLs", () => {
    const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
    const indexXml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
    const pagesXml = fs.readFileSync(path.join(root, "sitemap-pages.xml"), "utf8");
    assert.match(robots, /Sitemap:\s*https:\/\/www\.kutadgubilik\.com\/sitemap\.xml/);
    assert.match(indexXml, /https:\/\/www\.kutadgubilik\.com\/sitemap-pages\.xml/);
    assert.match(indexXml, /https:\/\/www\.kutadgubilik\.com\/sitemap-books\.xml/);
    assert.doesNotMatch(pagesXml, /\/book\/|book\.html|\/admin|\/account|\/cart|\/favorites/);

    const rows = [
      { id: 122, is_active: true, updated_at: "2026-03-01T00:00:00.000Z" },
      { id: 122, is_active: true, updated_at: "2026-03-02T00:00:00.000Z" },
      { id: 113, is_active: true, created_at: "2024-01-15T00:00:00.000Z", updated_at: "not-a-date" },
      { id: 8, is_active: false, updated_at: "2026-01-01T00:00:00.000Z" },
      { id: "children-3", is_active: true },
      { id: 999, is_active: true, updated_at: "1800-01-01" }
    ];
    const entries = sitemap.uniqueBookEntries(rows);
    assert.deepStrictEqual(entries.map((entry) => entry.loc), [
      ORIGIN + "/book/122",
      ORIGIN + "/book/113",
      ORIGIN + "/book/999"
    ]);
    assert.strictEqual(entries[0].lastmod, "2026-03-01");
    assert.strictEqual(entries[1].lastmod, "2024-01-15");
    assert.ok(!entries[2].lastmod);
    const xml = sitemap.buildUrlsetXml(entries);
    assert.doesNotMatch(xml, /book\.html|\/admin|\/cart|\/account|\/favorites|kutadgubilig\.com|localhost|vercel\.app/);
    assert.strictEqual((xml.match(/<loc>/g) || []).length, 3);
    const privateXml = sitemap.buildUrlsetXml([
      { loc: ORIGIN + "/admin.html" },
      { loc: ORIGIN + "/cart.html" },
      { loc: ORIGIN + "/account.html" },
      { loc: ORIGIN + "/favorites.html" },
      { loc: ORIGIN + "/book/122" }
    ]);
    assert.doesNotMatch(privateXml, /\/admin|\/cart|\/account|\/favorites/);
    assert.match(privateXml, /\/book\/122/);
    assert.ok(entries.every((entry) => /^https:\/\/www\.kutadgubilik\.com\/book\/\d+$/.test(entry.loc)));
    const added = sitemap.uniqueBookEntries(rows.concat([{ id: 501, is_active: true, updated_at: "2026-09-01T12:00:00.000Z" }]));
    assert.ok(added.some((entry) => entry.loc === ORIGIN + "/book/501" && entry.lastmod === "2026-09-01"));
    assert.ok(!/const BOOK_COUNT|bookCount\s*=\s*\d{2,}/.test(fs.readFileSync(path.join(root, "kutadgu-sitemap.js"), "utf8")));
  });

  await test("21 public book cards expose crawlable /book/<id> anchors", () => {
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const premium = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
    const ai = fs.readFileSync(path.join(root, "kutadgu-ai-search-ui.js"), "utf8");
    assert.match(shop, /function bookDetailHref\(id, fallbackHref\)\{[\s\S]*?if\(\/\^\\d\+\$\/\.test\(raw\)\)return `\/book\/\$\{raw\}`;/);
    assert.match(shop, /<a class="book-image\$\{state\?" "\+state:""\}" href="\$\{href\}">/);
    assert.match(shop, /<a class="detail-button" href="\$\{href\}">تەپسىلات<\/a>/);
    assert.match(shop, /<a class="advanced-search-title" href="\$\{href\}">/);
    assert.match(shop, /<a href="\$\{href\}">/);
    assert.match(shop, /<a href="\$\{href\}" class="home-carousel-link">/);
    assert.match(shop, /function miniCard\(b\)\{[\s\S]*?<a href="\$\{href\}">/);
    assert.match(premium, /if\(\/\^\\d\+\$\/\.test\(id\)\)return `\/book\/\$\{id\}`;/);
    assert.match(premium, /<a class="premium-card-link" href="\$\{escapeHtml\(bookHref\(book\)\)\}">/);
    assert.match(ai, /return "\/book\/" \+ String\(num\)/);
    assert.match(ai, /coverWrap\.setAttribute\("href", href\)/);
    assert.match(shop, /<button type="button" class="favorite-button"/);
    assert.match(shop, /function cartButton\(/);
    assert.doesNotMatch(shop, /<a[^>]+data-cart-id=/);
    assert.doesNotMatch(shop, /<a[^>]+data-fav-id=/);
  });

  await test("homepage store entity stays the seller target and is not copied onto the book graph", () => {
    const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.match(home, /"@type":"BookStore","@id":"https:\/\/www\.kutadgubilik\.com\/#store"/);
    assert.match(home, /"@type":"WebSite"/);
    assert.match(home, /"logo":"https:\/\/www\.kutadgubilik\.com\/kutadgu-logo\.png"/);
    assert.match(home, /"telephone":"\+905368999888"/);
    assert.match(home, /openingHours/);
    assert.match(home, /sameAs/);
    const node = productOf(graphFor(book()));
    assert.deepStrictEqual(node.offers.seller, { "@id": ORIGIN + "/#store" });
    assert.ok(!nodesOf(graphFor(book()), "BookStore").length);
    assert.ok(!nodesOf(graphFor(book()), "WebSite").length);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " Google book Product SEO test(s) failed");
    process.exit(1);
  }
  console.log("google-book-product-seo-tests ok");
});
