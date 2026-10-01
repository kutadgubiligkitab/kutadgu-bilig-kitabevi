#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const api = require("../kutadgu-visit-order.js");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const booksHtml = fs.readFileSync(path.join(root, "books.html"), "utf8");
const visitSrc = fs.readFileSync(path.join(root, "kutadgu-visit-order.js"), "utf8");

let failed = 0;
const queue = [];
function test(name, fn) {
  queue.push({ name, fn });
}

function ids(n) {
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    dump: data
  };
}

function throwingStorage() {
  return {
    getItem() { throw new Error("sessionStorage unavailable"); },
    setItem() { throw new Error("sessionStorage unavailable"); }
  };
}

test("same seed and snapshot stay unique and stable; other seeds move the whole catalog", () => {
  const catalog = ids(80);
  const alpha = api.permuteIds(catalog, "alpha");
  const alphaAgain = api.permuteIds(catalog, "alpha");
  const beta = api.permuteIds(catalog, "beta");
  assert.deepStrictEqual(alpha, alphaAgain);
  assert.notDeepStrictEqual(alpha, beta);
  assert.strictEqual(new Set(alpha).size, catalog.length);
  assert.deepStrictEqual(alpha.slice().sort((a, b) => Number(a) - Number(b)), catalog);
  assert.deepStrictEqual(beta.slice().sort((a, b) => Number(a) - Number(b)), catalog);
  const randomCalls = [];
  const original = Math.random;
  Math.random = () => {
    randomCalls.push(1);
    return original();
  };
  try {
    assert.deepStrictEqual(api.permuteIds(catalog, "alpha"), alpha);
  } finally {
    Math.random = original;
  }
  assert.strictEqual(randomCalls.length, 0);
  const heads = new Set();
  ["alpha", "beta", "gamma", "delta", "epsilon"].forEach((seed) => {
    api.permuteIds(catalog, seed).slice(0, 12).forEach((id) => heads.add(id));
  });
  assert.ok(catalog.slice(24).some((id) => heads.has(id)), "an id outside the original first page appears early");
});

test("a multi-page walk shows every eligible id once, including ids outside the first page", async () => {
  const catalog = ids(60);
  const hidden = new Set(["5", "17", "40"]);
  const missing = new Set(["8"]);
  const order = api.permuteIds(catalog, "visit-walk");
  const seen = [];
  let offset = 0;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const page = await api.collectVisiblePage(order, offset, 12, async (windowIds) => {
      return windowIds
        .filter((id) => !missing.has(String(id)) && !hidden.has(String(id)))
        .map((id) => ({ id: String(id), isActive: true }));
    });
    page.items.forEach((book) => {
      assert.ok(!seen.includes(String(book.id)), String(book.id));
      seen.push(String(book.id));
    });
    assert.ok(page.nextOffset > offset || !page.hasMore);
    offset = page.nextOffset;
    if (!page.hasMore) break;
  }
  assert.ok(guard < 20, "load more terminated");
  const expected = catalog.filter((id) => !hidden.has(id) && !missing.has(id));
  assert.strictEqual(seen.length, expected.length);
  assert.deepStrictEqual(seen.slice().sort((a, b) => Number(a) - Number(b)), expected);
  const firstPage = new Set(order.slice(0, 12));
  assert.ok(seen.some((id) => !firstPage.has(id)));
  assert.ok(!seen.includes("8"));
  assert.ok(!seen.includes("5"));
});

test("desktop and mobile page sizes, empty catalogs, and a single book terminate", () => {
  const order = api.permuteIds(ids(30), "pages");
  const lookup = (id) => ({ id: String(id), isActive: true });
  const desktop = api.walkSnapshot(order, 0, 24, lookup);
  const mobile = api.walkSnapshot(order, 0, 12, lookup);
  assert.strictEqual(desktop.items.length, 24);
  assert.strictEqual(mobile.items.length, 12);
  assert.strictEqual(desktop.hasMore, true);
  const second = api.walkSnapshot(order, desktop.nextOffset, 24, lookup);
  assert.strictEqual(second.items.length, 6);
  assert.strictEqual(second.hasMore, false);
  const seen = desktop.items.concat(second.items).map((book) => book.id);
  assert.strictEqual(new Set(seen).size, 30);
  const empty = api.walkSnapshot([], 0, 24, lookup);
  assert.deepStrictEqual(empty.items, []);
  assert.strictEqual(empty.hasMore, false);
  assert.strictEqual(empty.nextOffset, 0);
  const one = api.walkSnapshot(["7"], 0, 24, lookup);
  assert.strictEqual(one.items.length, 1);
  assert.strictEqual(one.hasMore, false);
  assert.strictEqual(api.listingTotal(0, 0, 0, false), 0);
});

test("skipped snapshot positions advance the cursor and keep later ids", async () => {
  const order = ["1", "2", "3", "4", "5"];
  const page = await api.collectVisiblePage(order, 0, 2, async (windowIds) => {
    return windowIds.filter((id) => id !== "2").map((id) => ({ id, isActive: id !== "4" }));
  });
  assert.deepStrictEqual(page.items.map((book) => book.id), ["1", "3"]);
  assert.strictEqual(page.nextOffset, 3);
  const rest = await api.collectVisiblePage(order, page.nextOffset, 2, async (windowIds) => {
    return windowIds.filter((id) => id !== "2").map((id) => ({ id, isActive: id !== "4" }));
  });
  assert.deepStrictEqual(rest.items.map((book) => book.id), ["5"]);
  assert.strictEqual(rest.hasMore, false);
  assert.strictEqual(api.listingTotal(5, rest.nextOffset, 3, false), 3);
  assert.strictEqual(api.listingTotal(5, page.nextOffset, 2, true), 4);
});

test("the id index follows content-range through a short server page and refuses a silent cap", async () => {
  const all = ids(25).map((id) => ({ id, is_active: true }));
  const capped = await api.collectIdIndex(async (from, requested) => {
    const slice = all.slice(from, from + Math.min(4, requested));
    if (!slice.length) return { rows: [], status: 416, contentRange: `*/${all.length}` };
    const end = from + slice.length - 1;
    return { rows: slice, status: 206, contentRange: `${from}-${end}/${all.length}` };
  });
  assert.strictEqual(capped.rows.length, 25);
  assert.strictEqual(capped.total, 25);

  const small = await api.collectIdIndex(async (from) => {
    if (from > 0) return { rows: [], status: 200, contentRange: "" };
    return { rows: [{ id: "1", is_active: true }, { id: "2", is_active: true }], status: 200, contentRange: "" };
  });
  assert.strictEqual(small.rows.length, 2);

  await assert.rejects(
    api.collectIdIndex(async () => ({ rows: [{ id: "1" }, { id: "2" }, { id: "3" }], status: 206, contentRange: "" })),
    (err) => err && err.code === "truncated-index"
  );

  let calls = 0;
  await assert.rejects(
    api.collectIdIndex(async () => {
      calls += 1;
      return { rows: [{ id: "1" }, { id: "2" }], status: 206, contentRange: "0-1/10" };
    }),
    (err) => err && err.code === "truncated-index"
  );
  assert.ok(calls >= 2);

  await assert.rejects(
    api.collectIdIndex(async () => { throw Object.assign(new Error("down"), { name: "AbortError" }); }),
    (err) => err && err.name === "AbortError"
  );
});

test("canonical ids drop hidden and duplicate rows", () => {
  assert.deepStrictEqual(api.canonicalIds([
    { id: 2, is_active: true },
    { id: "2", is_active: true },
    { id: 3, is_active: false },
    { id: "legacy", is_active: true },
    { id: 1, isActive: true }
  ]), ["2", "1"]);
  assert.deepStrictEqual(api.canonicalIds([{ id: "legacy", is_active: true }], { allowNonCanonical: true }), ["legacy"]);
});

test("storage failure keeps the visit in memory and does not require localStorage", () => {
  api.resetMemory();
  const broken = api.visitStore(throwingStorage());
  const saved = broken.save({ seed: "memory-seed", ids: ["4", "9", "4"], cursor: 2 });
  assert.strictEqual(saved.seed, "memory-seed");
  assert.deepStrictEqual(saved.ids, ["4", "9"]);
  assert.strictEqual(saved.cursor, 2);
  const again = api.visitStore(throwingStorage());
  assert.deepStrictEqual(again.load().ids, ["4", "9"]);
  assert.strictEqual(again.load().seed, "memory-seed");

  api.resetMemory();
  const disk = memoryStorage();
  const stored = api.visitStore(disk);
  stored.save({ seed: "disk-seed", ids: ["8", "1", "3"], cursor: 1 });
  api.resetMemory();
  const reloaded = api.visitStore(disk);
  assert.deepStrictEqual(reloaded.load(), { seed: "disk-seed", ids: ["8", "1", "3"], cursor: 1 });
  api.resetMemory();
  const fresh = api.visitStore(memoryStorage());
  assert.strictEqual(fresh.load(), null);
  assert.notStrictEqual(api.newSeed(), api.newSeed());
  assert.doesNotMatch(visitSrc, /localStorage\.(get|set)Item/);
  assert.match(visitSrc, /kutadgu-books-visit-v1/);
  assert.match(visitSrc, /sessionStorage/);
});

test("discovery applies only to the unfiltered default listing", () => {
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover" }), true);
  ["new", "title", "author", "priceLow", "priceHigh", "bestseller", "recommended", "relevance"].forEach((sort) => {
    assert.strictEqual(api.isDiscoveryListing({ sort }), false, sort);
  });
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover", search: "roman" }), false);
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover", source: "romanlar.html" }), false);
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover", category: "رومان" }), false);
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover", sources: ["romanlar.html"] }), false);
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover", minPrice: 10 }), false);
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover", bestseller: true }), false);
  assert.strictEqual(api.isDiscoveryListing({ sort: "discover", ids: ["1"] }), false);
  assert.strictEqual(api.DISCOVER_LABEL, "بۇ قېتىملىق بايقاش تەرتىپى");
});

test("a frozen snapshot ignores books added after the visit", async () => {
  const snapshot = ["2", "1"];
  const page = await api.collectVisiblePage(snapshot, 0, 24, async () => ([
    { id: "1", isActive: true },
    { id: "2", isActive: true },
    { id: "99", isActive: true }
  ]));
  assert.deepStrictEqual(page.items.map((book) => book.id), ["2", "1"]);
  assert.strictEqual(page.hasMore, false);
});

test("a capped full-record page still shows every eligible snapshot id once", async () => {
  const order = ids(60);
  const hidden = new Set(["4", "15"]);
  const missing = new Set(["9"]);
  async function fetchPage(windowIds, from, pageSize) {
    const matched = windowIds
      .filter((id) => !missing.has(id))
      .map((id) => ({ id, isActive: !hidden.has(id) }));
    const slice = matched.slice(from, from + Math.min(4, pageSize));
    if (!slice.length) return { rows: [], count: 0, status: 416, contentRange: `*/${matched.length}` };
    const end = from + slice.length - 1;
    return { rows: slice, count: slice.length, status: 206, contentRange: `${from}-${end}/${matched.length}` };
  }
  const seen = [];
  let offset = 0;
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const page = await api.collectVisiblePage(order, offset, 12, async (windowIds) => (
      api.resolveIdWindow(windowIds, (from, pageSize) => fetchPage(windowIds, from, pageSize))
    ));
    page.items.forEach((book) => {
      assert.ok(!seen.includes(book.id), book.id);
      seen.push(book.id);
    });
    if (!page.hasMore) {
      offset = page.nextOffset;
      break;
    }
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  }
  assert.ok(guard < 40, "load more terminated");
  assert.strictEqual(offset, order.length);
  const expected = order.filter((id) => !hidden.has(id) && !missing.has(id));
  assert.deepStrictEqual(seen, expected);
  const restored = await api.collectVisiblePage(order, 0, offset, async (windowIds) => (
    api.resolveIdWindow(windowIds, (from, pageSize) => fetchPage(windowIds, from, pageSize))
  ), offset);
  assert.deepStrictEqual(restored.items.map((book) => book.id), seen);
  assert.strictEqual(restored.hasMore, false);
  await assert.rejects(
    api.resolveIdWindow(ids(10), async () => ({ rows: [{ id: "1", isActive: true }], count: 1, status: 206, contentRange: "" })),
    (err) => err && err.code === "truncated-page"
  );
});

test("shop wiring keeps discovery off explicit sorts, homepage, and localStorage", () => {
  assert.match(shop, /بۇ قېتىملىق بايقاش تەرتىپى/);
  assert.match(shop, /function ensureDiscoveryVisit\(/);
  assert.match(shop, /function fetchDiscoveryRemotePage\(/);
  assert.match(shop, /resolveIdWindow\(windowIds/);
  assert.match(shop, /if\(append&&loadingMore\)return/);
  assert.match(shop, /visitSessionStorage\(\)/);
  assert.match(shop, /isGlobalBooks\?`<option value="discover" selected>بۇ قېتىملىق بايقاش تەرتىپى<\/option>`:""/);
  assert.match(shop, /if\(key==="newest"\)arr=\(await queryCatalog\(\{offset:0,pageSize:8,sort:"new",newOnly:true\}/);
  assert.match(shop, /sort:"recommended",recommended:true/);
  const sortFn = shop.slice(shop.indexOf("function sortBooks("), shop.indexOf("function bindDynamicActions("));
  assert.doesNotMatch(sortFn, /permuteIds|Math\.random|discover/);
  assert.doesNotMatch(shop, /localStorage\.setItem\("kutadgu-books-visit/);
  assert.match(booksHtml, /kutadgu-visit-order\.js\?v=2/);
  assert.ok(booksHtml.indexOf("kutadgu-visit-order.js?v=2") < booksHtml.indexOf("shop.js?v=137"));
  assert.match(booksHtml, /rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/books"/);
  assert.strictEqual((booksHtml.match(/application\/ld\+json/g) || []).length, 1);
  assert.match(booksHtml, /CollectionPage/);
  assert.match(booksHtml, /shop\.js\?v=137/);
});

(async () => {
  for (const item of queue) {
    try {
      await item.fn();
      console.log("PASS", item.name);
    } catch (err) {
      failed += 1;
      console.error("FAIL", item.name, err && err.stack || err);
    }
  }
  if (failed) {
    console.error("\n" + failed + " books visit rotation test(s) failed");
    process.exit(1);
  }
  console.log("books-visit-rotation-tests ok");
})();
