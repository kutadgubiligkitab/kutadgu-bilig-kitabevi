"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
globalThis.KUTADGU_APP_CONFIG = {
  catalogCategories: [
    { source: "romanlar.html", label: "رومانلار" },
    { source: "tibb.html", label: "تېبابەت ۋە ساغلاملىق" }
  ]
};
const directory = require("../kutadgu-book-categories.js");

directory.applyPublic({
  categories: [
    { id: 1, slug: "romanlar", source: "romanlar.html", label: "رومانلار يېڭى", summary: "", icon: "📖", sort_order: 10 },
    { id: 2, slug: "yeni-tur", source: "yeni-tur.html", label: "يېڭى تۈر", summary: "يېڭى", icon: "📚", sort_order: 20 }
  ],
  redirects: [{ slug: "dictionary", source: "dictionary.html", target_slug: "grammar", target_source: "grammar.html" }]
});

assert.strictEqual(directory.authoritative(), true);
assert.strictEqual(directory.currentLabel("رومانلار"), "رومانلار يېڭى");
assert.strictEqual(directory.currentLabel("تېبابەت ۋە ساغلاملىق"), "");
assert.strictEqual(directory.selectionPairs({ includeSource: "tibb.html" }).find((pair) => pair[0] === "tibb.html")[1], "تېبابەت ۋە ساغلاملىق");
assert.strictEqual(directory.selectionPairs({ includeSource: "tibb.html", includeLabel: "يېڭى تېبابەت" }).find((pair) => pair[0] === "tibb.html")[1], "يېڭى تېبابەت");
assert.strictEqual(directory.redirectFor("dictionary").target_slug, "grammar");
assert.ok(directory.visible().every((row) => row.slug !== "tibb"));

directory.applyFailure("http");
assert.strictEqual(directory.snapshot().mode, "authoritative");
assert.strictEqual(directory.currentLabel("رومانلار"), "رومانلار يېڭى");

const sitemap = require("../kutadgu-sitemap.js");
const listing = require("../kutadgu-category-listing.js");
const xml = sitemap.appendManagedCategories(
  '<?xml version="1.0"?><urlset><url><loc>https://www.kutadgubilik.com/romanlar</loc></url></urlset>',
  [{ slug: "romanlar" }, { slug: "yeni-tur" }, { slug: "../admin" }]
);
assert.strictEqual(xml.match(/\/yeni-tur</g).length, 1);
assert.strictEqual(xml.match(/\/romanlar</g).length, 1);
assert.strictEqual(xml.includes("../admin"), false);

const html = listing.applyDynamicCategoryDocument(
  '<html><head><title>old</title><link rel="canonical" href="https://www.kutadgubilik.com/universal"></head><body><h1>old</h1><div class="books-grid"></div></body></html>',
  { slug: "yeni-tur", label: "يېڭى تۈر", source: "yeni-tur.html" },
  []
);
assert.ok(html.includes("<title>يېڭى تۈر | قۇتادغۇبىلىك كىتابخانىسى</title>"));
assert.ok(html.includes("https://www.kutadgubilik.com/yeni-tur"));
assert.ok(html.includes("<h1>يېڭى تۈر</h1>"));
const universal = listing.applyDynamicCategoryDocument(
  fs.readFileSync(path.join(__dirname, "../universal.html"), "utf8"),
  { slug: "yeni-tur", label: "يېڭى تۈر", source: "yeni-tur.html" },
  []
);
assert.ok(universal.includes("<h1>يېڭى تۈر</h1>"));
assert.ok(universal.includes("https://www.kutadgubilik.com/yeni-tur"));

console.log("book category client: PASS");
