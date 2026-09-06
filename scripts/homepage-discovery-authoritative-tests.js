#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const premium = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
let failed = 0;
const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.stack || err.message);
      }));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.stack || err.message);
  }
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

test("homepage pins shop.js v=112 and premium-ux v=12", () => {
  assert.match(indexHtml, /shop\.js\?v=112/);
  assert.match(shop, /premium-ux\.js\?v=12/);
  assert.match(shop, /premium-ux\.css\?v=9/);
});

test("discovery no longer substitutes recommended() for empty category/group results", () => {
  const showGroup = sliceBetween(premium, "async function showGroup(", "section.querySelectorAll(\"[data-premium-group]\").forEach(button=>button.onclick");
  assert.match(showGroup, /queryDiscoveryCategories/);
  assert.doesNotMatch(showGroup, /recommended\(/);
  assert.match(showGroup, /discoverySeq/);
  assert.match(showGroup, /AbortController/);
  assert.match(showGroup, /discoveryEmptyMarkup/);
  assert.match(showGroup, /discoveryErrorMarkup/);
  const wizard = sliceBetween(premium, "wizard.querySelectorAll(\"[data-wizard-price]\")", "function setupSearchSuggestions");
  assert.match(wizard, /queryDiscoveryCategories/);
  assert.doesNotMatch(wizard, /recommended\(/);
  assert.match(wizard, /wizardSeq/);
  assert.match(wizard, /discoveryEmptyMarkup/);
});

test("recommendation helper remains for genuine recommendation surfaces", () => {
  assert.match(premium, /function recommended\(limit=8\)/);
  const empty = sliceBetween(premium, "function emptyActionMarkup(query){", "function setupSmartEmptyState(){");
  assert.match(empty, /recommended\(4\)/);
  const showGroup = sliceBetween(premium, "async function showGroup(", "section.querySelectorAll(\"[data-premium-group]\").forEach(button=>button.onclick");
  assert.doesNotMatch(showGroup, /getCatalog\(\)/);
});

function loadDiscoveryApi(shopApi) {
  const src = sliceBetween(premium, "const DISCOVERY_PAGE_SIZE=8;", "function renderDiscovery(){");
  return new Function("window", `
    "use strict";
    ${src}
    return {
      DISCOVERY_PAGE_SIZE,
      discoveryCache,
      mergeAuthoritativeCategoryLists,
      matchesSelectedCategory,
      queryCategoryAuthoritative,
      queryDiscoveryCategories,
      discoveryEmptyMarkup,
      discoveryErrorMarkup
    };
  `)({ kutadguShop: shopApi });
}

function book(id, category, extra) {
  return Object.assign({
    id,
    title: "كىتاب " + id,
    category,
    subcategory: "",
    price: 120,
    isActive: true,
    isRemote: true
  }, extra || {});
}

test("3 group query combines configured categories, dedupes canonical ids, max 8", () => {
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: (row) => row && row.isActive !== false
  });
  const roman = [book("1", "رومانلار"), book("2", "رومانلار"), book("dup", "رومانلار")];
  const poems = [book("dup", "شېئىرلار"), book("3", "شېئىرلار"), book("4", "شېئىرلار")];
  const stories = [book("5", "ھېكايىلەر"), book("6", "ھېكايىلەر"), book("7", "ھېكايىلەر"), book("8", "ھېكايىلەر"), book("9", "ھېكايىلەر")];
  const merged = api.mergeAuthoritativeCategoryLists([roman, poems, stories], 8);
  assert.deepStrictEqual(merged.map((row) => row.id), ["1", "2", "dup", "3", "4", "5", "6", "7"]);
  assert.strictEqual(merged.length, 8);
  assert.ok(!merged.some((row) => row.id === "9"));
});

test("4 category truth keeps only the selected category", () => {
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true
  });
  const mixed = [book("1", "رومانلار"), book("2", "شېئىرلار"), book("3", "رومانلار", { subcategory: "رومانلار" })];
  const roman = mixed.filter((row) => api.matchesSelectedCategory(row, "رومانلار"));
  assert.deepStrictEqual(roman.map((row) => row.id), ["1", "3"]);
});

test("1 partial cache: queryCatalog roman books are used instead of getCatalog", async () => {
  const calls = [];
  const api = loadDiscoveryApi({
    getCatalog() { return [book("70001", "ئۇنىۋېرسال", { title: "ئۇنىۋېرسال كىتاب" })]; },
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog(input) {
      calls.push(input);
      if (input.category === "رومانلار") {
        return { items: [book("81001", "رومانلار", { title: "رومان كىتابى ئا" })], source: "supabase" };
      }
      return { items: [], source: "supabase" };
    }
  });
  const items = await api.queryDiscoveryCategories(["رومانلار"], 8, null, 8);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].category, "رومانلار");
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, "رومان كىتابى ئا");
  assert.ok(!items.some((row) => row.category === "ئۇنىۋېرسال"));
});

test("2 zero roman results stay empty and do not use recommended books", async () => {
  const api = loadDiscoveryApi({
    getCatalog() {
      return [book("90001", "ئۇنىۋېرسال", { title: "تەۋسىيە كىتابى", isRecommended: true })];
    },
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog(input) {
      if (input.category === "رومانلار") return { items: [], source: "supabase" };
      return { items: [book("90001", "ئۇنىۋېرسال", { title: "تەۋسىيە كىتابى", isRecommended: true })], source: "supabase" };
    }
  });
  const items = await api.queryDiscoveryCategories(["رومانلار"], 8, null, 8);
  assert.deepStrictEqual(items, []);
  assert.match(api.discoveryEmptyMarkup(), /بۇ تۈردە ھازىرچە كىتاب يوق/);
  assert.doesNotMatch(api.discoveryEmptyMarkup(), /تەۋسىيە كىتابى/);
});

test("6 remote error is not cached as data and surfaces unavailable markup", async () => {
  let shouldFail = true;
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog() {
      if (shouldFail) throw new Error("Catalog query failed (HTTP 500)");
      return { items: [book("81001", "رومانلار")], source: "supabase" };
    }
  });
  await assert.rejects(() => api.queryCategoryAuthoritative("رومانلار", 8), /HTTP 500/);
  assert.strictEqual(api.discoveryCache.size, 0);
  assert.match(api.discoveryErrorMarkup(), /ۋاقىتلىق خاتالىق/);
  shouldFail = false;
  const items = await api.queryCategoryAuthoritative("رومانلار", 8);
  assert.strictEqual(items.length, 1);
});

test("authoritative per-category cache is reused and is not cross-contaminated", async () => {
  let romanCalls = 0;
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog(input) {
      if (input.category === "رومانلار") {
        romanCalls++;
        return { items: [book("81001", "رومانلار")], source: "supabase" };
      }
      return { items: [book("82001", "دىنىي كىتابلار")], source: "supabase" };
    }
  });
  await api.queryCategoryAuthoritative("رومانلار", 8);
  await api.queryCategoryAuthoritative("رومانلار", 8);
  const religious = await api.queryCategoryAuthoritative("دىنىي كىتابلار", 8);
  assert.strictEqual(romanCalls, 1);
  assert.strictEqual(religious[0].id, "82001");
});

test("storefront-visible filter drops inactive and non-visible rows", async () => {
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: (row) => row && row.isActive !== false && row.isRemote === true && /^\d+$/.test(String(row.id)),
    async queryCatalog() {
      return {
        items: [
          book("romanlar-2", "رومانلار", { isRemote: false, isActive: true }),
          book("81001", "رومانلار", { isRemote: true }),
          book("81002", "رومانلار", { isRemote: true, isActive: false })
        ],
        source: "supabase"
      };
    }
  });
  const items = await api.queryCategoryAuthoritative("رومانلار", 8);
  assert.deepStrictEqual(items.map((row) => row.id), ["81001"]);
});

Promise.resolve().then(() => Promise.all(pending)).then(() => {
  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll homepage discovery authoritative unit tests passed");
});
