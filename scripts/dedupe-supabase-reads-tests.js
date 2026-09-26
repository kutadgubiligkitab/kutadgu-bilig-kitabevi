#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Views = require("../kutadgu-book-views.js");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const viewsSrc = fs.readFileSync(path.join(root, "kutadgu-book-views.js"), "utf8");
const statsConfig = { url: "https://example.supabase.co", anonKey: "anon" };

let failed = 0;
const queue = [];
function test(name, fn) {
  queue.push({ name, fn });
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function domNode(className, attrs) {
  const node = {
    className: className || "",
    textContent: "",
    children: [],
    parentNode: null,
    attrs: Object.assign({}, attrs || {}),
    ownerDocument: null
  };
  node.ownerDocument = {
    createElement() {
      const created = domNode("");
      created.ownerDocument = node.ownerDocument;
      return created;
    }
  };
  node.setAttribute = function (key, value) { this.attrs[key] = String(value); };
  node.getAttribute = function (key) {
    return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
  };
  node.appendChild = function (child) {
    this.children.push(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    return child;
  };
  node.insertBefore = function (child, before) {
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    return child;
  };
  node.remove = function () {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  };
  node.querySelectorAll = function (selector) {
    const parts = String(selector || "").split(",").map((part) => part.trim()).filter(Boolean);
    const out = [];
    const visit = (current) => {
      (current.children || []).forEach((child) => {
        const cls = String(child.className || "").split(/\s+/);
        const matched = parts.some((sel) => {
          const attr = sel.match(/^\[([^\]=]+)(?:="([^"]+)")?\]$/);
          if (attr) {
            const value = child.getAttribute(attr[1]);
            return value != null && (attr[2] == null || value === attr[2]);
          }
          const classSel = sel.match(/^\.([a-z0-9-]+)$/i);
          return !!(classSel && cls.includes(classSel[1]));
        });
        if (matched) out.push(child);
        visit(child);
      });
    };
    visit(this);
    return out;
  };
  node.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
  return node;
}

function listingCard(id) {
  const card = domNode("book-card", { "data-live-book-id": String(id) });
  const price = domNode("book-price");
  card.appendChild(price);
  return card;
}

function cardGrid(cards) {
  const grid = domNode("books-grid");
  cards.forEach((card) => grid.appendChild(card));
  return grid;
}

function statsResponse(rows, ok) {
  return { ok: ok !== false, json: async () => rows };
}

function heldFetch(rows) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    release,
    async fetch() {
      await gate;
      return statsResponse(rows);
    }
  };
}

test("concurrent requests for the same book id share one view_stats read", async () => {
  Views.resetStatsCache();
  const card = listingCard("415");
  const grid = cardGrid([card]);
  let calls = 0;
  let release;
  const fetchImpl = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = Views.hydrate(grid, { force: true, now: 0, config: statsConfig, fetchImpl });
  const second = Views.hydrate(grid, { force: true, now: 5, config: statsConfig, fetchImpl });
  const third = Views.hydrate(cardGrid([listingCard("415")]), { force: true, now: 6, config: statsConfig, fetchImpl });
  assert.strictEqual(calls, 1);
  release(statsResponse([{ book_id: "415", total_views: 40 }]));
  await first;
  await second;
  await third;
  assert.strictEqual(calls, 1);
  assert.strictEqual(card.querySelector(".book-view-count-compact").textContent, "👁 40");
});

test("the same normalized id set is not read twice, and a different set still is", async () => {
  Views.resetStatsCache();
  const a = listingCard("12");
  const b = listingCard("7");
  const grid = cardGrid([a, b]);
  const reversed = cardGrid([listingCard("7"), listingCard("12")]);
  let calls = 0;
  const urls = [];
  let release;
  const fetchImpl = (url) => {
    calls += 1;
    urls.push(url);
    return new Promise((resolve) => { release = resolve; });
  };
  const first = Views.hydrate(grid, { force: true, now: 0, config: statsConfig, fetchImpl });
  const second = Views.hydrate(reversed, { force: true, now: 1, config: statsConfig, fetchImpl });
  assert.strictEqual(calls, 1);
  release(statsResponse([{ book_id: "12", total_views: 21 }, { book_id: "7", total_views: 22 }]));
  await first;
  await second;
  assert.strictEqual(calls, 1);
  assert.match(urls[0], /book_id=in\.\(12,7\)/);

  Views.resetStatsCache();
  const other = cardGrid([listingCard("90"), listingCard("91")]);
  let otherCalls = 0;
  const pendingOther = Views.hydrate(other, {
    force: true,
    now: 0,
    config: statsConfig,
    fetchImpl(url) {
      otherCalls += 1;
      assert.match(url, /in\.\(90,91\)/);
      assert.doesNotMatch(url, /12|7/);
      return statsResponse([{ book_id: "90", total_views: 30 }, { book_id: "91", total_views: 31 }]);
    }
  });
  const again = Views.hydrate(grid, {
    force: true,
    now: 2,
    config: statsConfig,
    fetchImpl() {
      otherCalls += 1;
      return statsResponse([{ book_id: "12", total_views: 21 }, { book_id: "7", total_views: 22 }]);
    }
  });
  await pendingOther;
  await again;
  assert.strictEqual(otherCalls, 2);
});

test("a failed in-flight view_stats read is cleared and can be retried", async () => {
  Views.resetStatsCache();
  const card = listingCard("415");
  let calls = 0;
  await Views.hydrate(cardGrid([card]), {
    force: true,
    now: 0,
    config: statsConfig,
    fetchImpl() {
      calls += 1;
      return statsResponse([], false);
    }
  });
  assert.strictEqual(card.querySelector(".book-view-count-compact"), null);
  await Views.hydrate(cardGrid([card]), {
    force: true,
    now: 20,
    config: statsConfig,
    fetchImpl() {
      calls += 1;
      return statsResponse([{ book_id: "415", total_views: 28 }]);
    }
  });
  assert.strictEqual(calls, 2);
  assert.strictEqual(card.querySelector(".book-view-count-compact").textContent, "👁 28");
});

test("a completed view_stats result stays cached for 10 minutes", async () => {
  Views.resetStatsCache();
  const card = listingCard("415");
  let calls = 0;
  const fetchImpl = () => {
    calls += 1;
    return statsResponse([{ book_id: "415", total_views: 33 }]);
  };
  await Views.hydrate(cardGrid([card]), { force: true, now: 1000, config: statsConfig, fetchImpl });
  await Views.hydrate(cardGrid([card]), { force: true, now: 1000 + Views.CACHE_MS - 1, config: statsConfig, fetchImpl });
  assert.strictEqual(calls, 1);
  assert.ok(Views.CACHE_MS >= 10 * 60 * 1000);
  await Views.hydrate(cardGrid([card]), { force: true, now: 1000 + Views.CACHE_MS + 1, config: statsConfig, fetchImpl });
  assert.strictEqual(calls, 2);
});

test("cold /book/415 shares one view_stats read and still loads a different related set", async () => {
  Views.resetStatsCache();
  const info = domNode("book-detail-info");
  info.appendChild(domNode(""));
  const detailCard = listingCard("415");
  const related = [listingCard("301"), listingCard("302")];
  const page = domNode("book-detail-page");
  page.appendChild(info);
  page.appendChild(detailCard);
  related.forEach((card) => page.appendChild(card));
  const prevDocument = global.document;
  const prevLocation = global.location;
  const prevFetch = global.fetch;
  const prevConfig = global.KUTADGU_SUPABASE_CONFIG;
  global.KUTADGU_SUPABASE_CONFIG = statsConfig;
  global.location = { pathname: "/book/415", hostname: "www.kutadgubilik.com" };
  global.document = {
    body: { dataset: { bookId: "415" } },
    querySelector(sel) {
      if (sel === ".book-detail-info") return info;
      if (sel === ".book-detail-page,.book-detail-info") return page;
      return null;
    },
    querySelectorAll(sel) { return page.querySelectorAll(sel); }
  };
  const urls = [];
  let release;
  global.fetch = (url) => {
    urls.push(String(url));
    return new Promise((resolve) => { release = resolve; });
  };
  try {
    const detailReads = [
      Views.fetchAndPaint(),
      Views.fetchAndPaint(),
      Views.fetchAndPaint()
    ];
    assert.strictEqual(urls.filter((url) => url.includes("in.(415)")).length, 1);
    release(statsResponse([{ book_id: "415", total_views: 40 }]));
    await Promise.all(detailReads);
    assert.strictEqual(urls.filter((url) => url.includes("in.(415)")).length, 1);
    await Views.hydrate(cardGrid(related), {
      force: true,
      now: Date.now(),
      config: statsConfig,
      fetchImpl(url) {
        urls.push(String(url));
        assert.match(url, /in\.\(301,302\)/);
        return statsResponse([{ book_id: "301", total_views: 20 }, { book_id: "302", total_views: 21 }]);
      }
    });
    assert.strictEqual(urls.filter((url) => url.includes("in.(301,302)")).length, 1);
    assert.strictEqual(related[0].querySelector(".book-view-count-compact").textContent, "👁 20");
  } finally {
    global.document = prevDocument;
    global.location = prevLocation;
    global.fetch = prevFetch;
    global.KUTADGU_SUPABASE_CONFIG = prevConfig;
    Views.resetStatsCache();
  }
});

test("repeated detail polls do not create a view_stats retry storm", async () => {
  Views.resetStatsCache();
  const info = domNode("book-detail-info");
  const prevDocument = global.document;
  const prevLocation = global.location;
  const prevFetch = global.fetch;
  const prevConfig = global.KUTADGU_SUPABASE_CONFIG;
  global.KUTADGU_SUPABASE_CONFIG = statsConfig;
  global.location = { pathname: "/book/415", hostname: "www.kutadgubilik.com" };
  global.document = {
    body: { dataset: { bookId: "415" } },
    querySelector(sel) {
      if (sel === ".book-detail-info") return info;
      if (sel === ".book-detail-page,.book-detail-info") return info;
      return null;
    }
  };
  let calls = 0;
  let release;
  global.fetch = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  try {
    const polls = [];
    for (let i = 0; i < 40; i += 1) polls.push(Views.fetchAndPaint());
    assert.strictEqual(calls, 1);
    release(statsResponse([{ book_id: "415", total_views: 40 }]));
    await Promise.all(polls);
    assert.strictEqual(calls, 1);
    await Views.fetchAndPaint();
    assert.strictEqual(calls, 1);
    assert.strictEqual((viewsSrc.match(/setInterval\(/g) || []).length, 2);
    assert.match(viewsSrc, /tries > 40/);
  } finally {
    global.document = prevDocument;
    global.location = prevLocation;
    global.fetch = prevFetch;
    global.KUTADGU_SUPABASE_CONFIG = prevConfig;
    Views.resetStatsCache();
  }
});

function countApi(opts) {
  const windowObj = {
    KUTADGU_SUPABASE_CONFIG: opts.config || {},
    sessionStorage: opts.sessionStorage
  };
  const C = Array.isArray(opts.catalog) ? opts.catalog : [];
  const cfgSrc = sliceBetween(shop, "function supabasePublicConfig(){", "function normalizeRemoteBook");
  const countSrc = sliceBetween(shop, "async function countPositiveSales(){", "function firstPopulatedCarouselMode");
  return new Function("window", "fetch", "C", `
    ${cfgSrc}
    ${countSrc}
    return { countPositiveSales, window };
  `)(windowObj, opts.fetch, C);
}

test("homepage bestseller HEAD count is shared by concurrent callers", async () => {
  let calls = 0;
  let release;
  const api = countApi({
    config: { url: "https://example.supabase.co", publishableKey: "k" },
    fetch: () => {
      calls += 1;
      return new Promise((resolve) => {
        release = () => resolve({
          headers: { get: () => "0-0/6" }
        });
      });
    }
  });
  const first = api.countPositiveSales();
  const second = api.countPositiveSales();
  assert.strictEqual(calls, 1);
  release();
  assert.strictEqual(await first, 6);
  assert.strictEqual(await second, 6);
  assert.strictEqual(calls, 1);
  assert.strictEqual(await api.countPositiveSales(), 6);
  assert.strictEqual(calls, 1);
});

test("public storefront no longer requests inactive books and admin hide/show stays", () => {
  const inactive = sliceBetween(shop, "async function loadInactiveRemoteIndex(){", "async function loadRemoteCatalog");
  assert.doesNotMatch(inactive, /fetch\(/);
  assert.doesNotMatch(inactive, /is_active=eq\.false/);
  assert.match(inactive, /inactiveRemoteKeys=new Set\(\)/);
  const boot = sliceBetween(shop, "async function loadRemoteCatalog(){", "async function hydrateBooksByIds");
  assert.match(boot, /loadInactiveRemoteIndex\(\)/);
  assert.match(boot, /is_active=eq\.true/);
  assert.match(admin, /listFilters\.active==="no"\)query=query\.eq\("is_active",false\)/);
  assert.match(admin, /const next=b\.is_active===false/);
  assert.match(admin, /\.update\(\{is_active:next\}\)/);
  assert.doesNotMatch(viewsSrc, /select=\*/);
});

(async function run() {
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
    console.error("\n" + failed + " dedupe supabase read test(s) failed");
    process.exit(1);
  }
  console.log("dedupe-supabase-reads-tests ok");
})();
