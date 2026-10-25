#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const seo = require("../kutadgu-book-seo.js");
const analytics = require("../kutadgu-analytics-core.js");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const shop = read("shop.js");
const privacy = read("privacy.html");
assert.match(read("index.html"), /WhatsApp تا ئايرىم جەزملىنىدۇ\./);
assert.match(read("order-info.html"), /WhatsApp تا ئايرىم جەزملىنىدۇ\./);
assert.match(read("book-shell.html"), /WhatsApp تا جەزملىنىدۇ/);
assert.match(shop, /WhatsApp تا جەزملىنىدۇ\./);
assert.doesNotMatch(shop + privacy + read("index.html") + read("order-info.html") + read("book-shell.html"), /جەزمللىنىدۇ|جەزملەشمىدى|ئالاقىلەشسىڭىز|22-سىنتەبىر|كۆرەلەش ئۈچۈن|ياقتۇرۇلغانلاردىن|توركۆرگۈ |سەھىپىنى يېڭىلاپ/);
assert.match(shop, /كىتاب سېۋەتكە قوشۇلمىدى\. بەتنى يېڭىلاپ قايتا سىناڭ\./);
assert.match(shop, /ياقتۇرغانلارغا قوشۇلمىدى\. بەتنى يېڭىلاپ قايتا سىناڭ\./);
assert.match(shop, /ياقتۇرغانلاردىن چىقىرىلدى/);
assert.match(shop, /<strong>بۇ نامغا تەۋە ئاممىۋى كىتاب يوق\.<\/strong>/);
assert.match(shop, /placeholder="كىتاب ياكى ئاپتور ئىزدەڭ…"/);
assert.match(shop, /\[\.\.\.ADABIYAT_HUB_SOURCES\]/);
assert.match(privacy, /2026-يىلى 22-سېنتەبىر/);
assert.match(privacy, /تور بېتى/);
assert.match(privacy, /ئالاقىلاشسىڭىز/);
assert.match(privacy, /زاكازنى كېيىن كۆرەلىشىڭىز ئۈچۈن/);
assert.match(privacy, /https:\/\/www\.kutadgubilik\.com/);
assert.match(shop, /ھېساب ھالىتى تېخى جەزملەنمىدى\. سوۋغا تىزىملىكى كۆرسىتىلمەيدۇ\./);
assert.doesNotMatch(read("credit-books.html"), /بۇ نامغا تەۋە/);
assert.match(read("STAGE132_BOOK_CATEGORIES.sql"), /'romanlar', 'romanlar\.html', 'رومانلار', 'ئەدەبى رومانلار\.'/);
assert.doesNotMatch(read("kutadgu-category-nav.js"), /مەشھۇر شەخسلەر/);

const raw = "A. B. ئىچكى نۇقتا 3.14 قالىدۇ...";
assert.strictEqual(seo.metaDescription({ title: "يەر ئانا", description: raw, author: "A." }), raw);
const generated = seo.metaDescription({
  title: "يەر ئانا",
  description: "",
  author: "A. B.",
  category: "رومان.",
  publisher: "3.14 نەشر",
  publishYear: "1970"
});
assert.strictEqual(generated, "يەر ئانا — ئاپتور: A. B. تۈرى: رومان. نەشرىيات: 3.14 نەشر. نەشر يىلى: 1970. قۇتادغۇبىلىك كىتابخانىسى.");
assert.ok(generated.length <= 170);
const graph = seo.buildBookJsonLd({
  id: "130",
  title: "يەر ئانا",
  author: "A. B.",
  description: "",
  category: "رومان.",
  price: 12
}, { visible: true, stockKey: "in" });
const book = graph["@graph"].find((item) => Array.isArray(item["@type"]) ? item["@type"].includes("Book") : item["@type"] === "Book");
assert.strictEqual(book.description, seo.metaDescription({
  title: "يەر ئانا",
  author: "A. B.",
  description: "",
  category: "رومان."
}));
const kept = seo.buildBookJsonLd({
  id: "136",
  title: "يەر ئانا",
  description: raw,
  price: 12
}, { visible: true, stockKey: "in" });
const keptBook = kept["@graph"].find((item) => Array.isArray(item["@type"]) ? item["@type"].includes("Book") : item["@type"] === "Book");
assert.strictEqual(keptBook.description, raw);

assert.deepStrictEqual(analytics.searchEvents("ئېلېكتىرونلۇق خەت", 1), []);
assert.deepStrictEqual(analytics.searchEvents("ئېلېكترونلۇق خەت", 1), []);
assert.strictEqual(analytics.buildRow("search", { query: "ئېلېكترونلۇق خەت", results: 1 }, { path: "/", sessionId: "local" }), null);
const ordinary = analytics.searchEvents("يەر ئانا", 2);
assert.strictEqual(ordinary.length, 1);
assert.strictEqual(ordinary[0].name, "search");
assert.strictEqual(ordinary[0].data.query, "يەر ئانا");

console.log("spelling-copy-tests ok");
