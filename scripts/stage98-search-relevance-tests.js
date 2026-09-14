#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Rank = require("../kutadgu-search-rank.js");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const analytics = fs.readFileSync(path.join(root, "kutadgu-analytics-core.js"), "utf8");

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
function titles(rows) {
  return rows.map((row) => row.title);
}

const ANA = [
  { id: "3", title: "يەر ئانا", author: "A", isbn: "111", category: "رومان", created_at: "2026-03-01" },
  { id: "2", title: "ئانا دەريانى ئىزدەپ", author: "B", isbn: "222", category: "رومان", created_at: "2026-02-01" },
  { id: "1", title: "ئانا", author: "C", isbn: "333", category: "رومان", created_at: "2020-01-01" }
];

test("A exact title ranks before title-contains and title-prefix matches", () => {
  assert.deepStrictEqual(titles(Rank.rankHits(ANA, "ئانا")), ["ئانا", "ئانا دەريانى ئىزدەپ", "يەر ئانا"]);
});

test("B exact ISBN ranks first", () => {
  const rows = [
    { id: "9", title: "9782222222222", author: "ئانا", isbn: "111", category: "رومان" },
    { id: "8", title: "ئانا", author: "X", isbn: "999", category: "رومان" },
    { id: "7", title: "باشقا", author: "Y", isbn: "9782222222222", category: "رومان" }
  ];
  assert.strictEqual(Rank.rankHits(rows, "978-222-222-222-2")[0].id, "7");
  assert.strictEqual(Rank.scoreHit(rows[2], "9782222222222"), Rank.SCORE.isbnExact);
});

test("C title match ranks before author/translator/publisher/category-only matches", () => {
  const rows = [
    { id: "a", title: "باشقا", author: "ئانا", translator: "", publisher: "", category: "رومان" },
    { id: "t", title: "باشقا", author: "X", translator: "ئانا", publisher: "", category: "رومان" },
    { id: "p", title: "باشقا", author: "X", translator: "", publisher: "ئانا", category: "رومان" },
    { id: "c", title: "باشقا", author: "X", translator: "", publisher: "", category: "ئانا" },
    { id: "q", title: "ئانا ھەققىدە", author: "X", translator: "", publisher: "", category: "رومان" }
  ];
  assert.strictEqual(Rank.rankHits(rows, "ئانا")[0].id, "q");
  assert.ok(Rank.scoreHit(rows[4], "ئانا") > Rank.scoreHit(rows[0], "ئانا"));
  assert.ok(Rank.scoreHit(rows[0], "ئانا") > Rank.scoreHit(rows[1], "ئانا"));
});

test("D later created_at page still ranks exact title first across the full hit list", () => {
  const page1 = ANA.filter((row) => row.id !== "1");
  const page2 = ANA.filter((row) => row.id === "1");
  const merged = page1.concat(page2);
  assert.strictEqual(titles(page1)[0], "يەر ئانا");
  assert.deepStrictEqual(titles(Rank.rankHits(merged, "ئانا")).slice(0, 1), ["ئانا"]);
});

test("E/F ranking keeps category and price filters already applied", () => {
  const priced = ANA.map((row) => ({ ...row, price: Number(row.id) * 10 }));
  const rows = priced.concat([{ id: "4", title: "ئانا", author: "Z", isbn: "444", category: "لۇغەت", price: 900 }]);
  const categoryOnly = rows.filter((row) => row.category === "رومان");
  assert.deepStrictEqual(titles(Rank.rankHits(categoryOnly, "ئانا")), ["ئانا", "ئانا دەريانى ئىزدەپ", "يەر ئانا"]);
  const cheap = priced.filter((row) => row.price <= 20);
  assert.strictEqual(Rank.rankHits(cheap, "ئانا")[0].title, "ئانا");
  assert.ok(cheap.every((row) => row.price <= 20));
});

test("G Load More slices ranked ids without duplicates or reordering", () => {
  const ranked = Rank.rankHits(ANA, "ئانا");
  const first = ranked.slice(0, 2);
  const more = ranked.slice(2, 4);
  const known = new Set(first.map((row) => row.id));
  more.forEach((row) => assert.ok(!known.has(row.id)));
  assert.deepStrictEqual(titles(first.concat(more)), titles(ranked));
});

test("H explicit sorts are not treated as relevance", () => {
  assert.strictEqual(Rank.usesSearchRelevance({ search: "ئانا", sort: "relevance" }), true);
  assert.strictEqual(Rank.usesSearchRelevance({ search: "ئانا", sort: "new" }), false);
  assert.strictEqual(Rank.usesSearchRelevance({ search: "ئانا", sort: "priceLow" }), false);
  assert.strictEqual(Rank.usesSearchRelevance({ search: "", sort: "relevance" }), false);
});

test("I cold-load q-param still waits for catalog-ready", () => {
  const enhance = shop.slice(shop.indexOf("function searchEnhance(){"), shop.indexOf("function dynamicListingCard"));
  assert.match(enhance, /kutadgu:catalog-ready/);
  assert.match(enhance, /addEventListener\("kutadgu:catalog-ready",runQueuedSearch,\{once:true\}\)/);
  assert.doesNotMatch(enhance, /if\(qParam\)\{input\.value=qParam;run\(false\)\}/);
});

test("L static fallback ranks with the same helper", () => {
  const staticFn = shop.slice(shop.indexOf("function staticQueryPage"), shop.indexOf("function remoteOrder"));
  assert.match(staticFn, /Rank\.usesSearchRelevance\(state\)&&Rank\.rankHits\)rows=Rank\.rankHits\(rows,state\.search\)/);
  assert.match(staticFn, /else rows=sortBooks\(rows,state\.sort\)/);
});

test("K analytics still fire once per real search, not Load More", () => {
  const enhance = shop.slice(shop.indexOf("function searchEnhance(){"), shop.indexOf("function dynamicListingCard"));
  assert.match(enhance, /if\(!append\)trackSearchQuery\(state\.search,result\.total\)/);
  assert.doesNotMatch(enhance, /if\(append\)trackSearchQuery/);
  assert.match(analytics, /zero_result_search/);
});

test("no SQL/RPC; remote path ranks the full match set then pages by id", () => {
  assert.match(shop, /async function loadSearchRankIndex/);
  assert.match(shop, /async function fetchRankedRemotePage/);
  assert.match(shop, /rankFields:true/);
  assert.match(shop, /usesSearchRelevance\(state\)&&!options\._rankedPage/);
  assert.doesNotMatch(shop, /CREATE FUNCTION|rpc\("search/);
  assert.ok(!fs.existsSync(path.join(root, "SITE_SEARCH_RELEVANCE.sql")));
});

test("every shop.js page loads kutadgu-search-rank.js immediately before it", () => {
  function walk(dir, acc) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || ["node_modules", "vendor", "tests"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (entry.name.endsWith(".html")) acc.push(full);
    }
    return acc;
  }
  for (const file of walk(root, [])) {
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes("shop.js?")) continue;
    assert.match(html, /kutadgu-search-rank\.js\?v=1["']><\/script><script defer src=["'][^"']*shop\.js\?v=127/, path.relative(root, file));
  }
});

test("UI default sort is relevance; layout markup is unchanged", () => {
  assert.match(shop, /<option value="relevance">مۇناسىۋەتلىك تەرتىپ<\/option>/);
  assert.match(shop, /sortEl\?\.value\|\|"relevance"/);
  assert.match(indexHtml, /kutadgu-search-rank\.js\?v=1/);
  assert.match(indexHtml, /shop\.js\?v=127/);
  assert.match(shop, /id="advancedSearchPanel"/);
  assert.match(shop, /id="searchLoadMore"/);
});

if (failed) {
  console.error("\n" + failed + " stage98 search relevance test(s) failed");
  process.exit(1);
}
console.log("stage98-search-relevance-tests ok");
