#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const codec = require("../kutadgu-shared-cart.js");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");
const css = fs.readFileSync(path.join(root, "shop.css"), "utf8");

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
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}
function live(id, stock, available) {
  return () => ({
    id: String(id),
    available: available !== false,
    canBuy: available !== false,
    stockQty: stock
  });
}
function lookup(table) {
  return (id) => {
    const row = table[String(id)];
    return row ? { ...row, id: String(row.id || id) } : null;
  };
}

test("encode normal cart as v1 id and qty only", () => {
  const encoded = codec.encodeSharedCart([
    { id: 156, qty: 2, title: "Secret title", price: 400, phone: "5551234567", name: "Ayshe", address: "Istiklal", email: "a@b.c", note: "leave at door", token: "tok-1" },
    { id: "341", qty: 1 }
  ]);
  assert.strictEqual(encoded.ok, true);
  assert.strictEqual(encoded.payload, "v1.156x2.341x1");
  assert.strictEqual(codec.sharedCartUrl("https://www.kutadgubilik.com", encoded.payload), "https://www.kutadgubilik.com/cart.html?share=v1.156x2.341x1");
});

test("decode normal payload", () => {
  const decoded = codec.decodeSharedCart("v1.156x2.341x1");
  assert.strictEqual(decoded.ok, true);
  assert.deepStrictEqual(decoded.items, [{ id: "156", qty: 2 }, { id: "341", qty: 1 }]);
});

test("reject malformed version", () => {
  assert.strictEqual(codec.decodeSharedCart("v2.156x1").ok, false);
  assert.strictEqual(codec.decodeSharedCart("v2.156x1").reason, "version");
  assert.strictEqual(codec.decodeSharedCart("156x1").reason, "version");
});

test("reject non-numeric id and unsafe text", () => {
  assert.strictEqual(codec.decodeSharedCart("v1.12ax1").ok, false);
  assert.strictEqual(codec.decodeSharedCart("v1.12ax1").reason, "malformed");
  assert.strictEqual(codec.decodeSharedCart("v1.1x1<script>").ok, false);
  assert.strictEqual(codec.decodeSharedCart("%3Cscript%3E").reason, "version");
  assert.strictEqual(codec.decodeSharedCart("%ZZ").reason, "encoding");
  assert.strictEqual(codec.encodeSharedCart([{ id: "abc", qty: 1 }]).ok, false);
});

test("clamp qty to 1..99 and reject zero", () => {
  assert.strictEqual(codec.encodeSharedCart([{ id: "8", qty: 150 }]).payload, "v1.8x99");
  assert.strictEqual(codec.decodeSharedCart("v1.8x150").items[0].qty, 99);
  assert.strictEqual(codec.decodeSharedCart("v1.8x0").ok, false);
  assert.strictEqual(codec.decodeSharedCart("v1.8x-1").ok, false);
  assert.strictEqual(codec.encodeSharedCart([{ id: "8", qty: 0 }]).reason, "empty");
});

test("dedupe ids by summing then clamping", () => {
  const decoded = codec.decodeSharedCart("v1.3x40.3x40");
  assert.deepStrictEqual(decoded.items, [{ id: "3", qty: 80 }]);
  assert.strictEqual(codec.decodeSharedCart("v1.3x60.3x50").items[0].qty, 99);
  const encoded = codec.encodeSharedCart([{ id: "3", qty: 40 }, { id: "3", qty: 40 }]);
  assert.strictEqual(encoded.payload, "v1.3x80");
});

test("max 80 items", () => {
  const many = [];
  for (let i = 1; i <= 81; i++) many.push(i + "x1");
  assert.strictEqual(codec.decodeSharedCart("v1." + many.join(".")).reason, "too_many");
  const items = [];
  for (let i = 1; i <= 81; i++) items.push({ id: String(i), qty: 1 });
  assert.strictEqual(codec.encodeSharedCart(items).reason, "too_many");
  assert.strictEqual(codec.decodeSharedCart("v1." + "1x1.".repeat(2000)).reason, "too_long");
});

test("no PII fields in payload", () => {
  const encoded = codec.encodeSharedCart([{
    id: "15",
    qty: 1,
    name: "Ayshe",
    phone: "5551234567",
    address: "Istiklal",
    note: "door",
    email: "reader@example.com",
    accountId: "user-9",
    token: "secret-token",
    price: 880,
    title: "Hidden title",
    image: "https://cdn.example/cover.webp"
  }]);
  assert.strictEqual(encoded.payload, "v1.15x1");
  ["Ayshe", "5551234567", "Istiklal", "reader@example.com", "secret-token", "Hidden", "cover.webp", "880"].forEach((secret) => {
    assert.ok(!encoded.payload.includes(secret), secret);
  });
});

test("merge keeps existing cart and sums quantities", () => {
  const books = {
    10: { id: "10", available: true, canBuy: true, stockQty: 20 },
    20: { id: "20", available: true, canBuy: true, stockQty: 20 }
  };
  const merged = codec.mergeSharedLines(
    [{ id: "10", qty: 2, price: 50 }],
    [{ id: "20", qty: 1 }, { id: "10", qty: 3 }],
    lookup(books)
  );
  assert.deepStrictEqual(merged.items, [{ id: "10", qty: 5 }, { id: "20", qty: 1 }]);
  assert.strictEqual(merged.added, 1);
  assert.strictEqual(merged.increased, 1);
  assert.match(codec.sharedCartNotice({ added: 0, increased: 1, skipped: 1, clamped: 0 }), /بەزى كىتابلار قوشۇلدى/);
  assert.match(codec.sharedCartNotice({ added: 0, increased: 0, skipped: 2, clamped: 0 }), /قوشقىلى بولمىدى/);
  assert.ok(!("price" in merged.items[0]));
});

test("merge clamps to live stock and skips unavailable books", () => {
  const books = {
    10: { id: "10", available: true, canBuy: true, stockQty: 5 },
    30: { id: "30", available: false, canBuy: false, stockQty: 9 }
  };
  const merged = codec.mergeSharedLines(
    [{ id: "10", qty: 4 }],
    [{ id: "10", qty: 3 }, { id: "30", qty: 2 }, { id: "404", qty: 1 }],
    lookup(books)
  );
  assert.deepStrictEqual(merged.items, [{ id: "10", qty: 5 }]);
  assert.strictEqual(merged.clamped, 1);
  assert.ok(merged.skipped >= 2);
});

test("refresh search no longer contains share", () => {
  const once = codec.decodeSharedCart("v1.156x2");
  assert.strictEqual(once.ok, true);
  const next = codec.stripShareSearch("?share=v1.156x2&kept=1");
  assert.strictEqual(next, "?kept=1");
  assert.strictEqual(new URLSearchParams(next.slice(1)).get("share"), null);
  const bare = codec.stripShareSearch("?share=v1.156x2");
  assert.strictEqual(bare, "");
  assert.ok(!codec.decodeSharedCart(new URLSearchParams(bare).get("share") || "").ok);
});

test("empty cart cannot be shared", () => {
  assert.strictEqual(codec.encodeSharedCart([]).reason, "empty");
  assert.strictEqual(codec.encodeSharedCart([{ id: "", qty: 1 }]).ok, false);
  const page = sliceBetween(shop, "function cartPage(){", "function changeQty(");
  const empty = page.slice(page.indexOf("if(!items.length)"), page.indexOf('data-empty","false"'));
  assert.match(empty, /سېۋەت ھازىرچە بوش/);
  assert.doesNotMatch(empty, /shareCart/);
  const shareFn = sliceBetween(shop, "async function shareCartLink(){", "async function importSharedCartFromQuery(){");
  assert.match(shareFn, /reason==="too_many"/);
  assert.match(shareFn, /سېۋەت بوش، ھەمبەھىرلەشكە بولمايدۇ/);
});

test("existing order-text share is unchanged", () => {
  const shareFn = sliceBetween(shop, "async function shareOrder(){", "function whatsappOrderUrl(text){");
  assert.match(shareFn, /getOrBuildOrder\(true\)/);
  assert.match(shareFn, /navigator\.share/);
  assert.match(shareFn, /title:"قۇتادغۇبىلىك كىتابخانىسى — زاكاز",text:o\.text/);
  assert.doesNotMatch(shareFn, /shareCart|encodeSharedCart|\?share=/);
  assert.match(cartHtml, /id="shareOrder">📤 زاكازنى ھەمبەھىرلەش/);
  assert.match(cartHtml, /id="whatsappOrder"/);
  assert.match(cartHtml, /id="prepareOrder"/);
  assert.match(cartHtml, /id="copyOrder"/);
  assert.doesNotMatch(cartHtml, /id="shareCart"/);
});

test("member sync path is preserved and share query is removed once", () => {
  const importer = sliceBetween(shop, "async function importSharedCartFromQuery(){", "function scheduleSharedCartImport(){");
  const gate = sliceBetween(shop, "function sharedCartWriteReady(){", "function stripShareQuery(){");
  assert.match(gate, /identityBootstrapPending\(\)/);
  assert.match(gate, /shopStateWriteAllowed\(\)/);
  assert.match(importer, /sharedCartWriteReady\(\)/);
  assert.match(importer, /set\(CART_KEY,persisted\)/);
  assert.doesNotMatch(importer, /localStorage\.setItem\(CART_KEY/);
  assert.match(importer, /sharedCartImportClaimed=true/);
  assert.match(importer, /stripShareQuery\(\)/);
  const writer = sliceBetween(shop, "const set=(k,v)=>{", "function isProductionStorefront(){");
  assert.match(writer, /shopStateWriteAllowed\(\)/);
  assert.match(writer, /KutadguMember\?\.syncKey\?\.\(k,v\)/);
  const strip = sliceBetween(shop, "function stripShareQuery(){", "async function copySharedCartUrl");
  assert.match(strip, /searchParams\.delete\("share"\)/);
  assert.match(strip, /history\.replaceState/);
});

test("dark light and mobile cart layout stay on existing classes", () => {
  assert.match(cartHtml, /shop\.css\?v=55/);
  assert.match(cartHtml, /shop\.js\?v=141/);
  assert.match(cartHtml, /kutadgu-shared-cart\.js\?v=3/);
  assert.doesNotMatch(cartHtml, /<style/);
  const page = sliceBetween(shop, "function cartPage(){", "function changeQty(");
  assert.match(page, /class="cart-summary-actions"/);
  assert.match(page, /class="checkout-secondary" id="shareCart"/);
  assert.match(page, /class="clear-cart" id="clearCart"/);
  assert.match(cartHtml, /id="whatsappOrder"/);
  const dark = sliceBetween(css, "body.dark-mode .cart-unit-price,", "body.dark-mode .checkout-form input::placeholder");
  assert.match(dark, /color:var\(--site-text\)/);
  assert.doesNotMatch(dark, /#fff|white|--site-brown-dark|--site-brown[^-]/);
  assert.match(css, /\.whatsapp-order\{[^}]*background:#168b4b/);
  assert.match(css, /\.remove-cart\{[^}]*color:#a94a3b/);
  assert.match(css, /\.checkout-secondary\{[^}]*color:var\(--site-text,#44352d\)/);
});

if (failed) {
  console.error("\n" + failed + " shared-cart test(s) failed");
  process.exit(1);
}
console.log("shared-cart-v1-tests ok");
