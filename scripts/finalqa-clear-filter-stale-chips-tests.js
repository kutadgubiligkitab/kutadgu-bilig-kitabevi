"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const premium = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");

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

function listingResetHandler() {
  const listing = sliceBetween(shop, "function setupCatalogFilters(){", "function myBooksData()");
  const start = listing.indexOf("if(reset)reset.onclick=");
  const end = listing.indexOf("apply(false)};", start);
  assert.ok(start >= 0 && end > start, "catalog reset onclick");
  return listing.slice(start, end + "apply(false)};".length);
}

function searchResetHandler() {
  const search = sliceBetween(shop, "function searchEnhance(){", "function dynamicListingCard");
  const start = search.indexOf("if(reset)reset.onclick=");
  const end = search.indexOf("run(false)};", start);
  assert.ok(start >= 0 && end > start, "search reset onclick");
  return search.slice(start, end + "run(false)};".length);
}

const filterUx = sliceBetween(premium, "function setupFilterUX(){", "function enhanceDetail(){");

test("chips sync only from input/change on the filter panel, not from programmatic value clears", () => {
  assert.match(filterUx, /className="premium-active-filters"/);
  assert.match(filterUx, /panel\.addEventListener\("input",update\)/);
  assert.match(filterUx, /panel\.addEventListener\("change"/);
  assert.doesNotMatch(filterUx, /catalog-filter-reset/);
  assert.doesNotMatch(filterUx, /advanced-search-reset/);
  assert.doesNotMatch(filterUx, /addEventListener\("click"/);
});

test("listing and search reset still clear controls, re-query, and do not reload", () => {
  const listing = listingResetHandler();
  const search = searchResetHandler();
  for (const handler of [listing, search]) {
    assert.match(handler, /minEl\)minEl\.value=""/);
    assert.match(handler, /maxEl\)maxEl\.value=""/);
    assert.match(handler, /sortEl\)sortEl\.value="new"/);
    assert.match(handler, /collection\)collection\.value=""/);
    assert.doesNotMatch(handler, /location\.reload/);
    assert.doesNotMatch(handler, /location\.href\s*=/);
    assert.doesNotMatch(handler, /meta.*refresh/i);
  }
  assert.match(listing, /text\.value=""/);
  assert.match(listing, /apply\(false\)/);
  assert.match(search, /input\.value=""/);
  assert.match(search, /run\(false\)/);
});

test("reset notifies the chip layer with a bubbling input after values are cleared", () => {
  for (const handler of [listingResetHandler(), searchResetHandler()]) {
    const clearAt = handler.indexOf('minEl.value=""');
    const dispatchAt = handler.indexOf('reset.dispatchEvent(new Event("input",{bubbles:true}))');
    const applyAt = Math.max(handler.indexOf("apply(false)"), handler.indexOf("run(false)"));
    assert.ok(clearAt >= 0 && dispatchAt > clearAt, "dispatch after clear");
    assert.ok(applyAt > dispatchAt, "re-query after chip sync");
  }
});

test("clearing min/max chips happens in the same update without reload", () => {
  const QUERY_DEFAULTS = { search: "", minPrice: "", maxPrice: "", sort: "new" };
  const catalogQueryState = { listing: { ...QUERY_DEFAULTS } };
  const minEl = {
    id: "catalogMinPrice",
    tagName: "INPUT",
    value: "0",
    labels: [{ textContent: "ئەڭ تۆۋەن باھا" }],
    selectedOptions: undefined
  };
  const maxEl = {
    id: "catalogMaxPrice",
    tagName: "INPUT",
    value: "400",
    labels: [{ textContent: "ئەڭ يۇقىرى باھا" }],
    selectedOptions: undefined
  };
  const collection = {
    id: "catalogCollection",
    tagName: "SELECT",
    value: "",
    selectedIndex: 0,
    selectedOptions: [{ textContent: "بارلىق كىتابلار" }]
  };
  const sortEl = {
    id: "catalogSort",
    tagName: "SELECT",
    value: "new",
    selectedIndex: 0,
    selectedOptions: [{ textContent: "يېڭى قوشۇلغان" }]
  };
  const text = { id: "catalogFilterText", tagName: "INPUT", value: "", labels: [{ textContent: "ئىزدەش" }] };
  const panelEls = [text, collection, minEl, maxEl, sortEl];
  let chipsHtml = "";
  const update = () => {
    const active = panelEls.filter((el) => el.value && !(el.tagName === "SELECT" && el.selectedIndex === 0));
    chipsHtml = active.map((el) => `${el.labels[0].textContent}: ${el.selectedOptions?.[0]?.textContent || el.value} ×`).join("");
  };
  const panelListeners = { input: [update] };
  update();
  assert.match(chipsHtml, /ئەڭ تۆۋەن باھا: 0 ×/);
  assert.match(chipsHtml, /ئەڭ يۇقىرى باھا: 400 ×/);

  let applied = 0;
  function readState() {
    catalogQueryState.listing = {
      ...QUERY_DEFAULTS,
      search: text.value.trim(),
      sort: collection.value === "new" ? "new" : sortEl.value || "new",
      minPrice: minEl.value,
      maxPrice: maxEl.value
    };
    return catalogQueryState.listing;
  }
  function apply() {
    applied += 1;
    readState();
  }
  const reset = {
    dispatchEvent(event) {
      assert.strictEqual(event.type, "input");
      assert.strictEqual(event.bubbles, true);
      panelListeners.input.forEach((fn) => fn(event));
      return true;
    }
  };

  text.value = "";
  collection.value = "";
  minEl.value = "";
  maxEl.value = "";
  sortEl.value = "new";
  reset.dispatchEvent(new Event("input", { bubbles: true }));
  apply(false);

  assert.strictEqual(minEl.value, "");
  assert.strictEqual(maxEl.value, "");
  assert.strictEqual(sortEl.value, "new");
  assert.strictEqual(catalogQueryState.listing.minPrice, "");
  assert.strictEqual(catalogQueryState.listing.maxPrice, "");
  assert.strictEqual(catalogQueryState.listing.sort, "new");
  assert.strictEqual(chipsHtml, "");
  assert.strictEqual(applied, 1);
});

test("existing listing filter/sort/load-more behavior remains in place", () => {
  const listing = sliceBetween(shop, "function setupCatalogFilters(){", "function myBooksData()");
  assert.match(listing, /catalog-load-more/);
  assert.match(listing, /async function apply\(append=false\)/);
  assert.match(listing, /debouncedApply/);
  assert.match(listing, /catalog-empty-reset/);
  assert.match(listing, /id="catalogMinPrice"/);
  assert.match(listing, /id="catalogMaxPrice"/);
  assert.match(listing, /id="catalogSort"/);
  assert.match(listing, /id="catalogCollection"/);
  assert.doesNotMatch(listing, /location\.reload/);
  const search = sliceBetween(shop, "function searchEnhance(){", "function dynamicListingCard");
  assert.match(search, /id="searchMinPrice"/);
  assert.match(search, /id="searchMaxPrice"/);
  assert.match(search, /kutadgu:catalog-ready/);
});

if (failed) {
  console.error("\n" + failed + " finalqa clear-filter chip test(s) failed");
  process.exit(1);
}
console.log("finalqa-clear-filter-stale-chips-tests ok");
