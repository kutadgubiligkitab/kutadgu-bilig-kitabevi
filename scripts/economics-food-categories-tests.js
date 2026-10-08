#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const listing = require("../kutadgu-category-listing.js");
const sitemap = require("../kutadgu-sitemap.js");
const seo = require("../kutadgu-book-seo.js");

const PRIOR_SLUGS = [
  "adabiyat",
  "romanlar",
  "tarikhiy-romanlar",
  "sheirlar",
  "hekayiler",
  "dastanlar",
  "dunya-edebiyati",
  "adabiyat-roman",
  "uyghur-adabiyati",
  "universal",
  "tibb",
  "derslik",
  "terbiye",
  "dini",
  "children",
  "dictionary",
  "grammar"
];
const ADDED = [
  { slug: "iqtisad", source: "iqtisad.html", label: "ئىقتىساد" },
  { slug: "taamlar", source: "taamlar.html", label: "تائاملار" }
];

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function row(id, extra) {
  return Object.assign({
    id,
    title: "كىتاب " + id,
    author: "ئاپتور",
    image_url: "",
    price: 12,
    stock: 4,
    stock_status: "in_stock",
    source: "grammar.html",
    is_active: true
  }, extra || {});
}

function gridHtml(html) {
  const start = String(html).indexOf('class="books-grid"');
  const end = String(html).indexOf("</section>", start);
  return String(html).slice(start, end);
}

test("existing category slugs stay in order and the two new hubs are appended", () => {
  assert.deepStrictEqual(sitemap.CATEGORY_HUB_SLUGS.slice(0, PRIOR_SLUGS.length), PRIOR_SLUGS);
  assert.deepStrictEqual(sitemap.CATEGORY_HUB_SLUGS.slice(PRIOR_SLUGS.length), ["iqtisad", "taamlar"]);
  assert.deepStrictEqual([...seo.CATEGORY_HUB_SLUGS], sitemap.CATEGORY_HUB_SLUGS);
  assert.deepStrictEqual(listing.CATEGORY_SLUGS, sitemap.CATEGORY_HUB_SLUGS);
  assert.ok(!listing.PARENT_SLUG.iqtisad);
  assert.ok(!listing.PARENT_SLUG.taamlar);
  assert.ok(!listing.ADABIYAT_SOURCES.includes("iqtisad.html"));
  assert.ok(!listing.ADABIYAT_SOURCES.includes("taamlar.html"));
});

test("catalog config appends the exact labels and does not add discovery groups", () => {
  const cfg = read("app-config.js");
  const sources = [...cfg.matchAll(/source:"([^"]+)",label:"([^"]+)"/g)].map((match) => ({
    source: match[1],
    label: match[2]
  }));
  const expected = [
    ["romanlar.html", "رومانلار"],
    ["tarikhiy-romanlar.html", "تارىخىي رومانلار"],
    ["sheirlar.html", "شېئىرلار"],
    ["hekayiler.html", "ھېكايىلەر"],
    ["dastanlar.html", "داستانلار"],
    ["dunya-edebiyati.html", "دۇنيا ئەدەبىياتى"],
    ["adabiyat-roman.html", "ئەدەبىيات رومانلىرى"],
    ["uyghur-adabiyati.html", "ئۇيغۇر ئەدەبىياتى"],
    ["universal.html", "ئۇنىۋېرسال"],
    ["tibb.html", "تېبابەت ۋە ساغلاملىق"],
    ["derslik.html", "دەرسلىك"],
    ["terbiye.html", "پەرزەنت تەربىيەسى"],
    ["dini.html", "دىنىي كىتابلار"],
    ["children.html", "بالىلار كىتابلىرى"],
    ["dictionary.html", "لۇغەت"],
    ["grammar.html", "گرامماتىكا"],
    ["iqtisad.html", "ئىقتىساد"],
    ["taamlar.html", "تائاملار"]
  ];
  assert.deepStrictEqual(sources.map((item) => [item.source, item.label]), expected);
  const groups = cfg.slice(cfg.indexOf("discoveryGroups"));
  assert.doesNotMatch(groups, /ئىقتىساد|تائاملار/);
  assert.match(read("admin.js"), /catalogCategories/);
  assert.match(read("book-staff.js"), /catalogCategories/);
});

test("single-source queries stay unquoted and each book stays in its own category", () => {
  ADDED.forEach((item) => {
    assert.deepStrictEqual(listing.catalogSources(item.slug), [item.source]);
    const url = listing.categoryBooksQueryUrl([item.source], 0, 1000);
    assert.match(url, new RegExp(`source=eq\\.${item.source}(&|$)`));
    assert.doesNotMatch(url, /source=eq\."/);
    assert.match(url, /is_active=eq\.true/);
  });
  assert.match(listing.categoryBooksQueryUrl(["grammar.html"], 0, 1000), /source=eq\.grammar\.html(&|$)/);
  const rows = [
    row(11, { source: "iqtisad.html", title: "ئىقتىساد كىتابى" }),
    row(12, { source: "taamlar.html", title: "تائام كىتابى" }),
    row(13, { source: "iqtisad.html", is_active: false, title: "يوشۇرۇن ئىقتىساد" }),
    row(14, { source: "grammar.html", title: "گرامماتىكا كىتابى" }),
    row(15, { source: "iqtisad.html", stock: 0, stock_status: "out_of_stock", title: "تۈگىگەن ئىقتىساد" })
  ];
  const economics = listing.rowsToBooks(rows, ["iqtisad.html"]);
  const food = listing.rowsToBooks(rows, ["taamlar.html"]);
  const grammar = listing.rowsToBooks(rows, ["grammar.html"]);
  assert.deepStrictEqual(economics.map((book) => book.id), ["11", "15"]);
  assert.deepStrictEqual(food.map((book) => book.id), ["12"]);
  assert.deepStrictEqual(grammar.map((book) => book.id), ["14"]);
  const economicsHtml = listing.applyCategoryDocument(listing.readTemplate("iqtisad"), "iqtisad", economics);
  assert.match(economicsHtml, /href="\/book\/11"/);
  assert.match(economicsHtml, /href="\/book\/15"/);
  assert.match(economicsHtml, /تۈگەپ كەتتى/);
  assert.match(economicsHtml, /is-stock-out/);
  assert.doesNotMatch(economicsHtml, /href="\/book\/12"/);
  assert.doesNotMatch(economicsHtml, /href="\/book\/13"/);
  assert.doesNotMatch(economicsHtml, /href="\/book\/14"/);
  const foodHtml = listing.applyCategoryDocument(listing.readTemplate("taamlar"), "taamlar", food);
  assert.match(foodHtml, /href="\/book\/12"/);
  assert.doesNotMatch(foodHtml, /href="\/book\/11"/);
});

test("empty category documents keep the skeleton template and render no unrelated books", () => {
  ADDED.forEach((item) => {
    const template = read(`${item.slug}.html`);
    assert.match(template, /dir="rtl"/);
    assert.match(template, /lang="ug"/);
    assert.match(template, new RegExp(`<h1>\\s*${item.label}\\s*</h1>`));
    assert.match(template, new RegExp(`data-catalog-source="${item.source}"`));
    assert.match(template, /book-card is-skeleton/);
    assert.doesNotMatch(gridHtml(template), /<img\b/i);
    assert.doesNotMatch(template, /sample-book-cover/);
    assert.match(template, /analytics\.js\?v=7/);
    assert.match(template, /shop\.js\?v=147/);
    const empty = listing.applyCategoryDocument(template, item.slug, []);
    assert.doesNotMatch(gridHtml(empty), /href="\/book\//);
    assert.doesNotMatch(gridHtml(empty), /book-card/);
    assert.match(empty, new RegExp(`<h1>\\s*${item.label}\\s*</h1>`));
  });
  assert.match(read("shop.js"), /بۇ بۆلۈمدە ھازىرچە كىتاب يوق\./);
});

test("storefront category links resolve the new hubs and leave cart and view pins", () => {
  const shop = read("shop.js");
  const start = shop.indexOf("const STOREFRONT_CATEGORY_HUBS");
  const end = shop.indexOf("function storefrontAppHref");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${shop.slice(start, end)}\nthis.categoryHref = storefrontCategoryHref;`, sandbox);
  assert.strictEqual(sandbox.categoryHref("iqtisad.html"), "/iqtisad");
  assert.strictEqual(sandbox.categoryHref("taamlar.html"), "/taamlar");
  assert.strictEqual(sandbox.categoryHref("grammar.html"), "/grammar");
  assert.strictEqual(sandbox.categoryHref("missing.html"), "/#books");
  assert.match(shop, /app-config\.js\?v=6/);
  assert.match(shop, /kutadgu-book-views\.js\?v=6/);
  assert.match(read("admin.html"), /app-config\.js\?v=6/);
  assert.match(read("book-staff.html"), /app-config\.js\?v=6/);
  assert.match(read("book-shell.html"), /shop\.js\?v=147/);
  assert.match(read("book-shell.html"), /kutadgu-book-views\.js\?v=6/);
  assert.match(read("cart.html"), /shop\.js\?v=141/);
  assert.doesNotMatch(read("cart.html"), /shop\.js\?v=147/);
  assert.match(read("index.html"), /href="\/iqtisad"/);
  assert.match(read("index.html"), /href="\/taamlar"/);
  assert.match(read("index.html"), /home-category-appended-cards\.css\?v=1/);
  assert.match(read("home-category-appended-cards.css"), /nth-child\(10\)/);
  assert.match(read("home-category-appended-cards.css"), /nth-child\(11\)/);
  assert.match(read("home-category-appended-cards.css"), /min-width:\s*1101px/);
  const vercel = JSON.parse(read("vercel.json"));
  ADDED.forEach((item) => {
    const redirect = vercel.redirects.find((rule) => rule.source === `/${item.source}`);
    const rewrite = vercel.rewrites.find((rule) => rule.source === `/${item.slug}`);
    assert.strictEqual(redirect.destination, `/${item.slug}`);
    assert.strictEqual(rewrite.destination, `/api/category-listing?slug=${item.slug}`);
  });
  assert.match(read("vercel.json"), /iqtisad,romanlar,sheirlar,taamlar,/);
  assert.match(read("wrangler.jsonc"), /"\/iqtisad"/);
  assert.match(read("wrangler.jsonc"), /"\/taamlar"/);
  assert.match(read("sitemap-pages.xml"), /kutadgubilik\.com\/iqtisad</);
  assert.match(read("sitemap-pages.xml"), /kutadgubilik\.com\/taamlar</);
  assert.match(read("cloudflare/preview-dispatch.js"), /"\/iqtisad\.html": "\/iqtisad"/);
  assert.match(read("cloudflare/preview-dispatch.js"), /"\/taamlar\.html": "\/taamlar"/);
});

if (failed) {
  console.error("\n" + failed + " economics/food category test(s) failed");
  process.exit(1);
}
console.log("economics-food-categories-tests ok");
