#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const premium = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
const listing = require(path.join(root, "kutadgu-category-listing.js"));

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.message);
  }
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function loadShopCards() {
  const helpers = sliceBetween(shop, "function money(n){", "function isStockEnforcementEnabled(){");
  const mini = sliceBetween(shop, "function miniCard(b){", "function favoriteCard(b){");
  const home = sliceBetween(shop, "function homeFeatureCard(b){", "let homeFeaturedRequestId=0;");
  const book = sliceBetween(shop, "function bookCardMarkup(b,variant=\"listing\",coverOpts={}){", "function searchResultCard(b){");
  const carousel = sliceBetween(shop, "function homeCarouselCard(b,i=0){", "async function setupHomeCarousel(){");
  return new Function(`
    function escapeHtml(value){
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[ch]));
    }
    function escapeAttr(value){ return escapeHtml(value); }
    function safeHref(href){ return href || ""; }
    function storefrontAuthor(book){ return book && book.author || ""; }
    function stockStateClass(){ return ""; }
    function stockBadge(){ return ""; }
    function cartButton(book, label, cls){
      return '<button type="button" class="' + (cls || "add-to-cart") + '" data-cart-id="' + book.id + '">' + (label || "🛒 سېۋەتكە سېلىش") + '</button>';
    }
    function coverImgHtml(){ return '<img src="/kutadgu-logo.png" alt="cover">'; }
    function wrapCoverHtml(book, html){ return html; }
    function miniCover(book){ return wrapCoverHtml(book, coverImgHtml(book)); }
    ${helpers}
    ${mini}
    ${home}
    ${book}
    ${carousel}
    return { seriesPriceText, seriesCardLabel, seriesPartCount, miniCard, homeFeatureCard, bookCardMarkup, homeCarouselCard };
  `)();
}

const api = loadShopCards();
const FORBIDDEN = ["370", "399", "769", "بېكىتىلگەن يۈرۈشلۈك باھاسى", "تولۇق يۈرۈشلۈك", "قىسىم باھاسى", "قىسىملارنى كۆرۈش", "جىلدلىق توپلام", "ھەر بىر جىلد", "دىن", "volume-group-card-badge", "data-fav-id", "data-cart-id", "data-share-id"];

function ownerBook(extra = {}) {
  return {
    id: "156",
    catalogKind: "group",
    kind: "group",
    groupId: "1",
    title: "ئويغانغان زېمىن",
    author: "ئابدۇرېھىم ئۆتكۈر",
    memberCount: 2,
    memberPrices: [370, 399],
    completeSetPrice: 750,
    effectiveSetPrice: 750,
    price: 370,
    href: "/volume-group/series-156",
    category: "تارىخىي رومانلار",
    image: "/kutadgu-logo.png",
    ...extra
  };
}

function assertCompact(markup, label) {
  assert.match(markup, /ئويغانغان زېمىن — 2 قىسىم/, label);
  assert.match(markup, /750 ₺/, label);
  assert.match(markup, /تەپسىلاتى/, label);
  assert.match(markup, /title="ئويغانغان زېمىن — 2 قىسىم"/, label);
  FORBIDDEN.forEach((token) => assert.doesNotMatch(markup, new RegExp(token), label + " " + token));
  assert.doesNotMatch(markup, /تەپسىلات</, label);
}

test("series-156 cards show the explicit 750 set and one details link", () => {
  const book = ownerBook();
  assertCompact(api.bookCardMarkup(book), "listing");
  assertCompact(api.bookCardMarkup(book, "search"), "search");
  assertCompact(api.miniCard(book), "mini");
  assertCompact(api.homeFeatureCard(book), "featured");
  assertCompact(api.homeCarouselCard(book, 0), "carousel");
  assert.strictEqual(book.title, "ئويغانغان زېمىن");
});

test("ordinary cards keep their own price, details label, and cart action", () => {
  const book = { id: "11", title: "ئادەتتىكى كىتاب", author: "ئابدۇرېھىم ئۆتكۈر", price: 120, href: "/book/11", category: "رومانلار", stock: 8 };
  const listing = api.bookCardMarkup(book);
  assert.match(listing, />تەپسىلات</);
  assert.match(listing, /data-cart-id="11"/);
  assert.match(listing, /120 ₺/);
  assert.doesNotMatch(listing, /تەپسىلاتى/);
  const featured = api.homeFeatureCard(book);
  assert.match(featured, /data-cart-id="11"/);
  assert.match(featured, /🛒 سېۋەتكە/);
  const carousel = api.homeCarouselCard(book, 0);
  assert.match(carousel, /home-carousel-cart add-to-cart/);
  assert.match(carousel, /data-cart-id="11"/);
});

test("counts come from metadata and missing prices stay unset", () => {
  assert.strictEqual(api.seriesPartCount({ memberCount: 3, memberBookIds: [1] }), 3);
  assert.strictEqual(api.seriesPartCount({ member_count: 0, member_book_ids: ["a", "b", "c"] }), 3);
  assert.strictEqual(api.seriesPartCount({ memberPrices: [1, 2, 3, 4] }), 4);
  assert.strictEqual(api.seriesPartCount({ memberCount: 100 }), 100);
  assert.strictEqual(api.seriesCardLabel({ title: "نام", memberCount: 100 }), "نام — 100 قىسىم");
  assert.doesNotMatch(api.seriesCardLabel({ title: "نام", memberCount: 0, memberBookIds: [] }), /0 قىسىم/);

  const summed = ownerBook({
    id: "2",
    title: "يىغىندا",
    completeSetPrice: null,
    complete_set_price: null,
    effectiveSetPrice: 769,
    price: 370
  });
  const summedCard = api.bookCardMarkup(summed);
  assert.match(summedCard, /769 ₺/);
  assert.doesNotMatch(summedCard, /370|بېكىتىلگەن يۈرۈشلۈك باھاسى/);

  const parts = {
    id: "3",
    catalogKind: "group",
    groupId: "3",
    title: "ئۈچ قىسىم",
    author: "ئاپتور",
    memberCount: 3,
    memberPrices: [100, 120, 140],
    completeSetPrice: null,
    effectiveSetPrice: null,
    price: 55,
    href: "/volume-group/three"
  };
  const partsCard = api.miniCard(parts);
  assert.match(partsCard, /360 ₺/);
  assert.match(partsCard, /ئۈچ قىسىم — 3 قىسىم/);
  assert.doesNotMatch(partsCard, /55 ₺|100 ₺|120 ₺|140 ₺/);

  const missing = ownerBook({
    id: "4",
    title: "باھاسىز",
    memberCount: 2,
    memberPrices: [],
    completeSetPrice: null,
    effectiveSetPrice: null,
    price: 370,
    href: "/volume-group/missing"
  });
  const missingCard = api.homeFeatureCard(missing);
  assert.match(missingCard, /باھا تېخى بېكىتىلمىگەن/);
  assert.doesNotMatch(missingCard, /370|0 ₺/);

  const longTitle = "بۇ ناھايىتى ئۇزۇن يۈرۈشلۈك نامى بولۇپ بىر قۇرغا سىغمەيدۇ ۋە ئىككىنچى قۇرغا چۈشىدۇ";
  const longBook = ownerBook({ title: longTitle });
  const longCard = api.bookCardMarkup(longBook);
  const expected = `${longTitle} — 2 قىسىم`;
  assert.match(longCard, new RegExp(`title="${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.strictEqual(longBook.title, longTitle);
  assert.match(api.homeCarouselCard(ownerBook({ memberCount: 100, memberPrices: [1], completeSetPrice: 750, price: 1 }), 5), /100 قىسىم/);
});

function loadPremium(shopApi) {
  const body = sliceBetween(premium, "function isSeriesCard(book){", "function recoverCachedCoverFailure(img){");
  return new Function("window", `
    function escapeHtml(value){
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[ch]));
    }
    function money(value){
      return value !== null && value !== undefined && value !== "" ? Number(value).toLocaleString("tr-TR") + " ₺" : "باھا تېخى بېكىتىلمىگەن";
    }
    function cover(){ return "/kutadgu-logo.png"; }
    function bookHref(book){ return "/book/" + book.id; }
    function badges(){ return ""; }
    ${body}
    return { compactCard };
  `)({ kutadguShop: shopApi });
}

test("premium grouped cards reuse the series label without a part cart", () => {
  const book = ownerBook();
  const withShop = loadPremium(api).compactCard(book);
  assertCompact(withShop, "premium-shop");
  assert.match(withShop, /href="\/volume-group\/series-156"/);
  assert.match(withShop, /data-cover-src="\/kutadgu-logo\.png"/);
  assert.match(withShop, /data-cover-book="156"/);
  assert.doesNotMatch(withShop, /data-premium-cart|data-premium-favorite/);
  const fallback = loadPremium(null).compactCard(ownerBook({ href: "", groupSlug: "series-156" }));
  assert.match(fallback, /750 ₺/);
  assert.match(fallback, /href="\/volume-group\/series-156"/);
  const ordinary = loadPremium(api).compactCard({ id: "11", title: "ئادەتتىكى", author: "ئاپتور", price: 120, href: "/book/11" });
  assert.match(ordinary, /data-premium-cart="11"/);
  assert.match(ordinary, /data-premium-favorite="11"/);
  assert.match(ordinary, /<strong>ئادەتتىكى<\/strong>/);
  assert.match(ordinary, /120 ₺/);
});

test("category listing first paint uses the explicit set and keeps the stored title", () => {
  const row = {
    id: "156",
    title: "ئويغانغان زېمىن",
    author: "ئابدۇرېھىم ئۆتكۈر",
    image_url: "/kutadgu-logo.png",
    price: 370,
    stock: 8,
    stock_status: "in_stock",
    source: "tarikhiy-romanlar.html",
    is_active: true,
    kind: "group",
    group_slug: "series-156",
    member_count: 2,
    member_book_ids: ["156", "157"],
    member_prices: [370, 399],
    complete_set_price: 750,
    effective_set_price: 750
  };
  const book = listing.normalizeCategoryRow(row, ["tarikhiy-romanlar.html"]);
  const card = listing.listingCardMarkup(book);
  assert.strictEqual(book.title, "ئويغانغان زېمىن");
  assert.match(card, /ئويغانغان زېمىن — 2 قىسىم/);
  assert.match(card, /title="ئويغانغان زېمىن — 2 قىسىم"/);
  assert.match(card, /750 ₺/);
  assert.match(card, />تەپسىلاتى</);
  assert.doesNotMatch(card, /370|399|769|جىلدلىق|ھەر بىر جىلد|بېكىتىلگەن|data-cart-id/);

  const summed = listing.normalizeCategoryRow({
    ...row,
    id: "200",
    title: "يىغىندا",
    group_slug: "summed",
    complete_set_price: null,
    effective_set_price: 769
  }, ["tarikhiy-romanlar.html"]);
  const summedCard = listing.listingCardMarkup(summed);
  assert.match(summedCard, /769 ₺/);
  assert.doesNotMatch(summedCard, /370|بېكىتىلگەن يۈرۈشلۈك باھاسى/);

  const parts = listing.normalizeCategoryRow({
    ...row,
    id: "201",
    title: "ئۈچ",
    group_slug: "three",
    member_count: null,
    member_book_ids: ["1", "2", "3"],
    member_prices: [100, 200, 300],
    complete_set_price: null,
    effective_set_price: null,
    price: 40
  }, ["tarikhiy-romanlar.html"]);
  const partsCard = listing.listingCardMarkup(parts);
  assert.match(partsCard, /ئۈچ — 3 قىسىم/);
  assert.match(partsCard, /600 ₺/);
  assert.doesNotMatch(partsCard, /40 ₺|100 ₺/);

  const hundred = listing.normalizeCategoryRow({
    ...row,
    id: "202",
    title: "يۈز",
    group_slug: "hundred",
    member_count: 100,
    complete_set_price: 750
  }, ["tarikhiy-romanlar.html"]);
  assert.match(listing.listingCardMarkup(hundred), /يۈز — 100 قىسىم/);

  const missing = listing.normalizeCategoryRow({
    ...row,
    id: "203",
    title: "باھاسىز",
    group_slug: "missing",
    member_count: 2,
    member_prices: [],
    complete_set_price: null,
    effective_set_price: null,
    price: 370
  }, ["tarikhiy-romanlar.html"]);
  const missingCard = listing.listingCardMarkup(missing);
  assert.match(missingCard, /باھا تېخى بېكىتىلمىگەن/);
  assert.doesNotMatch(missingCard, /370|0 ₺/);

  const longTitle = "بۇ ناھايىتى ئۇزۇن يۈرۈشلۈك نامى بولۇپ بىر قۇرغا سىغمەيدۇ";
  const longBook = listing.normalizeCategoryRow({ ...row, title: longTitle }, ["tarikhiy-romanlar.html"]);
  assert.strictEqual(longBook.title, longTitle);
  assert.match(listing.listingCardMarkup(longBook), new RegExp(`title="${longTitle} — 2 قىسىم"`));

  const ordinary = listing.normalizeCategoryRow({
    id: "11",
    title: "ئادەتتىكى",
    author: "ئاپتور",
    price: 120,
    stock: 8,
    stock_status: "in_stock",
    source: "tarikhiy-romanlar.html",
    is_active: true
  }, ["tarikhiy-romanlar.html"]);
  const ordinaryCard = listing.listingCardMarkup(ordinary);
  assert.match(ordinaryCard, />تەپسىلات</);
  assert.match(ordinaryCard, /data-cart-id="11"/);
  assert.doesNotMatch(ordinaryCard, /تەپسىلاتى/);
});

function loadNormalize() {
  const amount = sliceBetween(shop, "function finiteSeriesAmount(value){", "function seriesMemberPriceList(book){");
  const fn = sliceBetween(shop, "function normalizeCatalogBook(book,index=0,isRemote=false){", "const STATIC_CATALOG");
  return new Function(`
    function money(n){
      return n != null && n !== "" ? Number(n).toLocaleString("tr-TR") + " ₺" : "باھا تېخى بېكىتىلمىگەن";
    }
    function bibliographicLib(){ return {}; }
    function normalizeGalleryImages(){ return []; }
    function bookDetailHref(id){ return "/book/" + id; }
    ${amount}
    ${fn}
    return normalizeCatalogBook;
  `)();
}

const normalizeCatalogBook = loadNormalize();
const volumeStorefront = require(path.join(root, "kutadgu-volume-storefront.js"));
const MISSING_PRICE = "باھا تېخى بېكىتىلمىگەن";

function rawGroup(extra = {}) {
  return {
    id: "9",
    kind: "group",
    catalogKind: "group",
    group_id: "9",
    groupId: "9",
    group_slug: "incomplete",
    title: "تولۇقسىز",
    author: "ئاپتور",
    member_count: 2,
    memberCount: 2,
    member_book_ids: ["9", "10"],
    memberBookIds: ["9", "10"],
    price: 370,
    image_url: "/kutadgu-logo.png",
    is_active: true,
    source: "tarikhiy-romanlar.html",
    href: "/volume-group/incomplete",
    ...extra
  };
}

function assertMissingPrice(markup, label) {
  assert.match(markup, new RegExp(MISSING_PRICE), label);
  assert.doesNotMatch(markup, /370|0 ₺/, label);
}

test("normalization keeps missing member prices and cards sum only a complete set", () => {
  const cases = [
    { name: "partial null", member_prices: [370, null], expect: "missing" },
    { name: "all missing", member_prices: [null, null], expect: "missing", preserved: [null, null] },
    { name: "blank", member_prices: ["", "  ", "\t"], member_count: 3, member_book_ids: ["1", "2", "3"], expect: "missing", preserved: [null, null, null] },
    { name: "short list", member_prices: [370], expect: "missing" },
    { name: "valid zero", member_prices: [0, 0], expect: "0 ₺" },
    { name: "complete", member_prices: [100, 120, 140], member_count: 3, member_book_ids: ["1", "2", "3"], expect: "360 ₺" },
    { name: "explicit wins", member_prices: [370, null], complete_set_price: 750, expect: "750 ₺" },
    { name: "effective wins", member_prices: [370], effective_set_price: 769, expect: "769 ₺" },
    { name: "blank explicit falls through", member_prices: [100, 200], complete_set_price: "  ", effective_set_price: "", expect: "300 ₺" },
    { name: "explicit zero", member_prices: [370, null], complete_set_price: 0, expect: "0 ₺" }
  ];
  const premiumFallback = loadPremium(null);
  cases.forEach((item) => {
    const raw = rawGroup({
      member_prices: item.member_prices,
      memberPrices: item.member_prices,
      member_count: item.member_count || 2,
      memberCount: item.member_count || 2,
      member_book_ids: item.member_book_ids || ["9", "10"],
      memberBookIds: item.member_book_ids || ["9", "10"],
      complete_set_price: Object.prototype.hasOwnProperty.call(item, "complete_set_price") ? item.complete_set_price : null,
      completeSetPrice: Object.prototype.hasOwnProperty.call(item, "complete_set_price") ? item.complete_set_price : null,
      effective_set_price: Object.prototype.hasOwnProperty.call(item, "effective_set_price") ? item.effective_set_price : null,
      effectiveSetPrice: Object.prototype.hasOwnProperty.call(item, "effective_set_price") ? item.effective_set_price : null
    });
    const catalogItem = volumeStorefront.normalizeCatalogItem({
      kind: "group",
      id: raw.id,
      group_id: raw.group_id,
      group_slug: raw.group_slug,
      title: raw.title,
      author: raw.author,
      price: raw.price,
      image_url: raw.image_url,
      is_active: true,
      member_count: raw.member_count,
      member_book_ids: raw.member_book_ids,
      member_prices: item.member_prices,
      complete_set_price: raw.complete_set_price,
      effective_set_price: raw.effective_set_price
    });
    const book = normalizeCatalogBook(catalogItem, 0, true);
    if (item.preserved) assert.deepStrictEqual(book.memberPrices, item.preserved, item.name);
    const card = api.bookCardMarkup(book);
    const premium = premiumFallback.compactCard(book);
    const row = listing.normalizeCategoryRow({
      ...raw,
      kind: "group",
      is_active: true,
      stock: 4,
      stock_status: "in_stock"
    }, ["tarikhiy-romanlar.html"]);
    const ssr = listing.listingCardMarkup(row);
    if (item.preserved) assert.deepStrictEqual(row.member_prices, item.preserved, item.name + " ssr");
    [card, premium, ssr].forEach((markup) => {
      if (item.expect === "missing") assertMissingPrice(markup, item.name);
      else {
        assert.match(markup, new RegExp(item.expect.replace("₺", "₺")), item.name);
        assert.doesNotMatch(markup, new RegExp(MISSING_PRICE), item.name);
      }
    });
  });
  const series = normalizeCatalogBook(rawGroup({
    id: "156",
    group_id: "1",
    group_slug: "series-156",
    title: "ئويغانغان زېمىن",
    member_prices: [370, 399],
    complete_set_price: 750,
    effective_set_price: 750,
    href: "/volume-group/series-156"
  }), 0, true);
  assert.match(api.bookCardMarkup(series), /750 ₺/);
  assert.doesNotMatch(api.bookCardMarkup(series), /769|370 ₺/);
});

if (failed) {
  console.error(failed + " compact series card test(s) failed");
  process.exit(1);
}
console.log("compact-series-card-tests ok");
