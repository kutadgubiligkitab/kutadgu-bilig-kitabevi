#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
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

const sanitizeApi = new Function(`
  const CART_DISPLAY_VERSION = 1;
  function safeUrlApi(){ return null; }
  ${sliceBetween(shop, "function isSafeCoverUrl(raw){", "function safeCoverUrl(")}
  ${sliceBetween(shop, "function isSampleDemoCover(src){", "const COVER_RETRY_MAX=")}
  ${sliceBetween(shop, "function clipCartDisplayText(raw,max){", "function readCartDisplayStore(){")}
  return {sanitizeCartDisplaySnapshot, clipCartDisplayText, isSafeCoverUrl, isSampleDemoCover};
`)();

test("display snapshot uses a separate versioned key and does not change CART_KEY", () => {
  assert.match(shop, /const CART_KEY="kutadgu-cart-v1"/);
  assert.match(shop, /CART_DISPLAY_KEY="kutadgu-cart-display-v1"/);
  assert.match(shop, /CART_DISPLAY_VERSION=1/);
  assert.match(shop, /CART_DISPLAY_MAX_ITEMS=80/);
  assert.doesNotMatch(shop, /set\(CART_DISPLAY_KEY/);
  assert.match(shop, /localStorage\.setItem\(CART_DISPLAY_KEY/);
});

test("add writes CART_KEY then upserts a display snapshot; remove prunes", () => {
  const add = sliceBetween(shop, "function add(id,qty=1){", "function remove(id){");
  assert.match(add, /set\(CART_KEY,a\)/);
  assert.match(add, /upsertCartDisplaySnapshot\(b\)/);
  const remove = sliceBetween(shop, "function remove(id){", "function favs(){");
  assert.match(remove, /set\(CART_KEY,next\)/);
  assert.match(remove, /pruneCartDisplaySnapshots\(\)/);
  const clear = sliceBetween(shop, "if(confirm(\"سېۋەتتىكى بارلىق كىتابلارنى ئۆچۈرەمسىز؟\"))", "let scroll=document.querySelector(\"#scrollCheckout\")");
  assert.match(clear, /set\(CART_KEY,\[\]\)/);
  assert.match(clear, /pruneCartDisplaySnapshots\(\)/);
});

test("instant first paint uses snapshots before catalog settle; skeleton remains the no-snapshot path", () => {
  const paint = sliceBetween(shop, "function paintCartBootState(){", "function homepageVisibleBooks(");
  assert.match(paint, /cartHasUsableDisplayPreview\(\)/);
  assert.match(paint, /showCartBootSkeleton/);
  const preview = sliceBetween(shop, "function cartHasUsableDisplayPreview(){", "function cartItemSkeletonMarkup(){");
  assert.match(preview, /items\.every\(/);
  assert.doesNotMatch(preview, /items\.some\(/);
  const page = sliceBetween(shop, "function cartPage(){", "function changeQty(");
  assert.match(page, /cartHydrationPending\(\)/);
  assert.match(page, /data-cart-hydration/);
  assert.match(page, /aside\.hidden=preview/);
  assert.match(page, /escapeHtml\(x\.b\.title\)/);
  assert.match(page, /preview\|\|!visible/);
  assert.match(page, /disabled aria-disabled=\\"true\\"/);
  const boot = sliceBetween(shop, "async function boot(){", "window.kutadguShop=");
  assert.ok(boot.indexOf("initStaticShell()") < boot.indexOf("await loadRemoteCatalog()"));
  assert.ok(boot.lastIndexOf("hydrateBooksByIds") < boot.indexOf("markCatalogBootSettled()"));
});

test("authoritative refresh reuses existing hydrate and then re-renders cartPage", () => {
  const mark = sliceBetween(shop, "function markCatalogBootSettled(){", "function isCartDocument(){");
  assert.match(mark, /refreshCartDisplaySnapshotsFromCatalog\(\)/);
  const boot = sliceBetween(shop, "async function boot(){", "window.kutadguShop=");
  assert.match(boot, /await loadRemoteCatalog\(\)/);
  assert.match(boot, /await hydrateBooksByIds/);
  assert.match(boot, /markCatalogBootSettled\(\)/);
  const init = sliceBetween(shop, "function init(){", "let bootStarted=false");
  assert.match(init, /cartPage\(\)/);
  assert.doesNotMatch(boot, /fetchRemotePage\(\{ids:savedIds/);
});

test("stale snapshot is not authoritative for WhatsApp / totals", () => {
  const order = sliceBetween(shop, "function buildOrderText(requireCustomer=true){", "function getOrBuildOrder(");
  assert.match(order, /cartHydrationPending\(\)/);
  assert.match(order, /b:find\(line\.id\)\|\|null/);
  assert.match(order, /__cartDisplayPreview/);
  const page = sliceBetween(shop, "function cartPage(){", "function changeQty(");
  assert.match(page, /const orderable=preview\?\[\]/);
  assert.match(page, /checkout\.hidden=blocked\|\|preview/);
});

test("legacy ID migration realigns snapshot keys without changing CART_KEY schema", () => {
  const migrate = sliceBetween(shop, "function migratePersistedBookIds(){", "function money(n){");
  assert.match(migrate, /set\(CART_KEY,nextCart\)/);
  assert.match(migrate, /migrateCartDisplaySnapshots\(prevCart\)/);
  assert.match(shop, /function migrateCartDisplaySnapshots\(/);
});

test("sanitize rejects HTML, javascript covers, and sample-demo covers", () => {
  const htmlTitle = sanitizeApi.sanitizeCartDisplaySnapshot({
    id: "91001",
    title: "<img src=x onerror=alert(1)><script>window.__xss=1</script>",
    author: "ok",
    price: 11,
    image: "javascript:alert(1)"
  });
  assert.ok(htmlTitle);
  assert.strictEqual(htmlTitle.image, "");
  assert.ok(htmlTitle.title.includes("<img"));
  const sample = sanitizeApi.sanitizeCartDisplaySnapshot({
    id: "91001",
    title: "Real",
    image: "/sample-book-cover.png"
  });
  assert.strictEqual(sample.image, "");
  const unsafeId = sanitizeApi.sanitizeCartDisplaySnapshot({
    id: "9\"><img>",
    title: "Real"
  });
  assert.strictEqual(unsafeId, null);
  const httpsOk = sanitizeApi.sanitizeCartDisplaySnapshot({
    id: "91001",
    title: "Real",
    image: "/kutadgu-logo.png",
    price: 88
  });
  assert.strictEqual(httpsOk.image, "/kutadgu-logo.png");
  assert.strictEqual(httpsOk.price, 88);
});

test("cart rows keep existing quantity and remove controls", () => {
  const page = sliceBetween(shop, "function cartPage(){", "function changeQty(");
  assert.match(page, /data-plus=/);
  assert.match(page, /data-minus=/);
  assert.match(page, /data-remove=/);
  assert.match(page, /coverImgHtml\(x\.b/);
});

test("changeQty refuses quantity mutation while cart hydration is pending", () => {
  const qty = sliceBetween(shop, "function changeQty(id,d){", "function customerData(){");
  assert.match(qty, /if\(cartHydrationPending\(\)\)return;/);
  assert.doesNotMatch(qty, /else if\(cartHydrationPending\(\)\)/);
  assert.ok(qty.indexOf("if(cartHydrationPending())return;") < qty.indexOf("set(CART_KEY,a)"));
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("cart-instant-render-tests ok");
