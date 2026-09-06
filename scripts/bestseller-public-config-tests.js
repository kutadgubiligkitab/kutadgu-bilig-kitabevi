#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
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

function countApi(opts = {}) {
  const windowObj = {
    KUTADGU_SUPABASE_CONFIG: opts.config || {},
    __kutadguPositiveSalesCount: opts.cachedCount
  };
  const C = Array.isArray(opts.catalog) ? opts.catalog : [];
  const cfgSrc = sliceBetween(shop, "function supabasePublicConfig(){", "function normalizeRemoteBook");
  const countSrc = sliceBetween(shop, "async function countPositiveSales(){", "function firstPopulatedCarouselMode");
  return new Function("window", "fetch", "C", `
    ${cfgSrc}
    ${countSrc}
    return { supabasePublicConfig, countPositiveSales, window };
  `)(windowObj, opts.fetch, C);
}

function honestyApi(document) {
  const src = sliceBetween(shop, "function applyBestsellerHonesty(hasSales){", "async function countPositiveSales");
  return new Function("document", `
    ${src}
    return { applyBestsellerHonesty };
  `)(document);
}

function honestyDocument() {
  const carousel = {
    hidden: false,
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; }
  };
  const options = [
    { hidden: false, disabled: false, selected: true },
    { hidden: false, disabled: false, selected: false }
  ];
  return {
    carousel,
    options,
    querySelectorAll(sel) {
      if (String(sel).includes("data-carousel-mode='bestseller'")) return [carousel];
      if (String(sel).includes("option[value='bestseller']")) return options;
      return [];
    }
  };
}

function rangeResponse(total) {
  return {
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-range") return `0-0/${total}`;
        return null;
      }
    }
  };
}

test("countPositiveSales uses normalized cfg.key, not cfg.anonKey", () => {
  const src = sliceBetween(shop, "async function countPositiveSales(){", "function firstPopulatedCarouselMode");
  assert.match(src, /if\(cfg&&cfg\.url&&cfg\.key\)/);
  assert.match(src, /apikey:cfg\.key/);
  assert.match(src, /Authorization:`Bearer \$\{cfg\.key\}`/);
  assert.doesNotMatch(src, /cfg\.anonKey/);
  assert.doesNotMatch(src, /cfg\.publishableKey/);
});

test("other supabasePublicConfig consumers already use cfg.key", () => {
  const storefront = sliceBetween(shop, "function supabaseStorefrontConfigured(){", "let catalogBootSettled");
  assert.match(storefront, /cfg\.url&&cfg\.key/);
  const fetchPage = sliceBetween(shop, "async function fetchRemotePage(", "async function queryCatalog");
  assert.match(fetchPage, /apikey:cfg\.key/);
  assert.match(fetchPage, /Authorization:`Bearer \$\{cfg\.key\}`/);
  const inactive = sliceBetween(shop, "async function loadInactiveRemoteIndex(){", "async function loadRemoteCatalog");
  assert.match(inactive, /apikey:cfg\.key/);
  const boot = sliceBetween(shop, "async function loadRemoteCatalog(){", "async function hydrateBooksByIds");
  assert.match(boot, /cfg\.url&&cfg\.key/);
  assert.match(boot, /apikey:cfg\.key/);
});

test("publishableKey config normalizes to { url, key } and issues HEAD", async () => {
  const calls = [];
  const api = countApi({
    config: {
      url: "https://example.supabase.co/",
      publishableKey: "sb_publishable_test_key"
    },
    catalog: [{ salesCount: 9 }, { salesCount: 0 }],
    fetch: async (url, init) => {
      calls.push({ url, init });
      return rangeResponse(7);
    }
  });
  const cfg = api.supabasePublicConfig();
  assert.deepStrictEqual(cfg, { url: "https://example.supabase.co", key: "sb_publishable_test_key" });
  assert.strictEqual("anonKey" in cfg, false);
  const n = await api.countPositiveSales();
  assert.strictEqual(n, 7);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "https://example.supabase.co/rest/v1/books?select=id&sales_count=gt.0");
  assert.strictEqual(calls[0].init.method, "HEAD");
  assert.strictEqual(calls[0].init.headers.apikey, "sb_publishable_test_key");
  assert.strictEqual(calls[0].init.headers.Authorization, "Bearer sb_publishable_test_key");
  assert.strictEqual(calls[0].init.headers.Prefer, "count=exact");
});

test("anonKey config also normalizes onto cfg.key for the HEAD request", async () => {
  const calls = [];
  const api = countApi({
    config: {
      url: "https://fxlojnqwyojqjskfggmh.supabase.co",
      anonKey: "sb_publishable_live_shape"
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return rangeResponse(4);
    }
  });
  const n = await api.countPositiveSales();
  assert.strictEqual(n, 4);
  assert.strictEqual(calls[0].init.headers.apikey, "sb_publishable_live_shape");
  assert.strictEqual(calls[0].init.headers.Authorization, "Bearer sb_publishable_live_shape");
});

test("zero positive remote sales remains zero", async () => {
  const api = countApi({
    config: { url: "https://example.supabase.co", publishableKey: "k" },
    catalog: [{ salesCount: 3 }],
    fetch: async () => rangeResponse(0)
  });
  assert.strictEqual(await api.countPositiveSales(), 0);
  assert.strictEqual(api.window.__kutadguPositiveSalesCount, 0);
});

test("network failure falls back to local visible catalog count", async () => {
  const api = countApi({
    config: { url: "https://example.supabase.co", publishableKey: "k" },
    catalog: [{ salesCount: 2 }, { salesCount: 0 }, { salesCount: 5 }, { salesCount: "x" }],
    fetch: async () => { throw new Error("network down"); }
  });
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    assert.strictEqual(await api.countPositiveSales(), 2);
  } finally {
    console.warn = warn;
  }
  assert.ok(warnings.length >= 1);
});

test("missing public key skips remote HEAD and uses local catalog", async () => {
  const calls = [];
  const api = countApi({
    config: { url: "https://example.supabase.co" },
    catalog: [{ salesCount: 1 }],
    fetch: async (...args) => {
      calls.push(args);
      return rangeResponse(99);
    }
  });
  assert.strictEqual(await api.countPositiveSales(), 1);
  assert.strictEqual(calls.length, 0);
});

test("honesty hides carousel and collection options when count is 0", () => {
  const doc = honestyDocument();
  const api = honestyApi(doc);
  assert.strictEqual(api.applyBestsellerHonesty(0 > 0), false);
  assert.strictEqual(doc.carousel.hidden, true);
  assert.strictEqual(doc.carousel.attrs["aria-hidden"], "true");
  assert.ok(doc.options.every((opt) => opt.hidden && opt.disabled));
  assert.strictEqual(doc.options[0].selected, false);
});

test("honesty shows Best Sellers when remote count is positive", () => {
  const doc = honestyDocument();
  doc.carousel.hidden = true;
  doc.options.forEach((opt) => { opt.hidden = true; opt.disabled = true; });
  const api = honestyApi(doc);
  assert.strictEqual(api.applyBestsellerHonesty(7 > 0), true);
  assert.strictEqual(doc.carousel.hidden, false);
  assert.strictEqual("aria-hidden" in doc.carousel.attrs, false);
  assert.ok(doc.options.every((opt) => !opt.hidden && !opt.disabled));
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("bestseller-public-config-tests ok");
});
