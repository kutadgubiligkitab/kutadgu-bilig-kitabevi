#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const mobile = fs.readFileSync(path.join(root, "mobile.js"), "utf8");
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
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const routeApi = new Function(`
  ${sliceBetween(shop, "const STOREFRONT_CATEGORY_HUBS={", "function storefrontPageFile(){")}
  return {storefrontCategoryHref, storefrontAppHref, STOREFRONT_CATEGORY_HUBS};
`)();

const recApi = new Function(`
  function canonicalId(id){ return String(id || ""); }
  function isStorefrontVisible(book){ return !!(book && book.isActive !== false); }
  let C = [];
  ${sliceBetween(shop, "function detailRecommendations(book,limit=4,catalog){", "function detailGallerySlides(book){")}
  return {
    setCatalog(list){ C = list; },
    detailRecommendations
  };
`)();

test("same-category related books are allowed and current book is excluded", () => {
  recApi.setCatalog([
    { id: "1", category: "رومانلار", title: "A", isActive: true },
    { id: "2", category: "رومانلار", title: "B", isActive: true },
    { id: "3", category: "رومانلار", title: "C", isActive: true }
  ]);
  const out = recApi.detailRecommendations({ id: "1", category: "رومانلار" }, 4);
  assert.deepStrictEqual(out.map((b) => b.id), ["2", "3"]);
});

test("different-category books are never used as recommendation fallback", () => {
  recApi.setCatalog([
    { id: "1", category: "رومانلار", title: "A", isActive: true },
    { id: "9", category: "بالىلار", title: "Unrelated", isActive: true },
    { id: "8", category: "دىن", title: "Also unrelated", isActive: true }
  ]);
  const out = recApi.detailRecommendations({ id: "1", category: "رومانلار" }, 4);
  assert.deepStrictEqual(out, []);
  assert.ok(!out.some((b) => b.category !== "رومانلار"));
});

test("same subcategory is preferred before other same-category books", () => {
  recApi.setCatalog([
    { id: "1", category: "رومانلار", subcategory: "تارىخىي", isActive: true },
    { id: "2", category: "رومانلار", subcategory: "باشقا", isActive: true },
    { id: "3", category: "رومانلار", subcategory: "تارىخىي", isActive: true },
    { id: "4", category: "بالىلار", subcategory: "تارىخىي", isActive: true }
  ]);
  const out = recApi.detailRecommendations({ id: "1", category: "رومانلار", subcategory: "تارىخىي" }, 4);
  assert.deepStrictEqual(out.map((b) => b.id), ["3", "2"]);
});

test("zero same-category matches yields an empty related list", () => {
  recApi.setCatalog([{ id: "1", category: "رومانلار", isActive: true }]);
  assert.deepStrictEqual(recApi.detailRecommendations({ id: "1", category: "رومانلار" }, 4), []);
});

test("inactive or hidden books are not recommended", () => {
  recApi.setCatalog([
    { id: "1", category: "رومانلار", isActive: true },
    { id: "2", category: "رومانلار", isActive: false }
  ]);
  assert.deepStrictEqual(recApi.detailRecommendations({ id: "1", category: "رومانلار" }, 4), []);
});

test("category CTA maps known sources to root clean hubs and rejects unsafe values", () => {
  assert.strictEqual(routeApi.storefrontCategoryHref("universal.html"), "/universal");
  assert.strictEqual(routeApi.storefrontCategoryHref("./romanlar.html"), "/romanlar");
  assert.strictEqual(routeApi.storefrontCategoryHref("/book/universal.html"), "/universal");
  assert.strictEqual(routeApi.storefrontCategoryHref("universal-3.html"), "/universal");
  assert.strictEqual(routeApi.storefrontCategoryHref("javascript:alert(1)"), "/#books");
  assert.strictEqual(routeApi.storefrontCategoryHref("https://evil.example/universal.html"), "/#books");
  assert.strictEqual(routeApi.storefrontCategoryHref(""), "/#books");
  assert.ok(!String(routeApi.storefrontCategoryHref("universal.html")).startsWith("/book/"));
});

test("cart favorites and account hrefs are root-safe from nested book URLs", () => {
  assert.strictEqual(routeApi.storefrontAppHref("cart.html"), "/cart.html");
  assert.strictEqual(routeApi.storefrontAppHref("favorites.html"), "/favorites.html");
  assert.strictEqual(routeApi.storefrontAppHref("account.html"), "/account.html");
  assert.strictEqual(routeApi.storefrontAppHref("index.html#books"), "/#books");
  assert.strictEqual(routeApi.storefrontAppHref("javascript:alert(1)", "/"), "/");
  assert.ok(!routeApi.storefrontAppHref("cart.html").includes("/book/"));
});

test("shop.js injects root-safe cart/favorites/account navigation", () => {
  const nav = sliceBetween(shop, "function ensureDesktopShopNav(){", "function injectFloat(){");
  assert.match(nav, /storefrontAppHref\(file/);
  const float = sliceBetween(shop, "function injectFloat(){", "function cardIdentityKeys(");
  assert.match(float, /storefrontAppHref\(/);
  assert.match(float, /location\.assign\(href\)/);
  assert.doesNotMatch(float, /location\.href=href/);
  const extras = sliceBetween(shop, "function renderDetailExtras(book){", "function decorateDetail(){");
  assert.match(extras, /storefrontCategoryHref\(book\.source\)/);
  assert.doesNotMatch(extras, /href="\$\{book\.source/);
  assert.match(extras, /detail-category-cta-only/);
  assert.match(extras, /related\.length/);
  const rec = sliceBetween(shop, "function detailRecommendations(book,limit=4,catalog){", "function detailGallerySlides(book){");
  assert.doesNotMatch(rec, /x\.category!==book\.category/);
  assert.match(rec, /isStorefrontVisible\(item\)/);
});

test("mobile injected cart/favorites/account links are root-relative", () => {
  assert.match(mobile, /href="\/cart\.html"/);
  assert.match(mobile, /href="\/favorites\.html"/);
  assert.match(mobile, /href="\/account\.html"/);
  assert.match(mobile, /function storefrontAppHref/);
  assert.match(mobile, /function normalizeRootAppLinks/);
  assert.doesNotMatch(mobile, /cart\.href = "cart\.html"/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("book-detail-google-entry-tests ok");
