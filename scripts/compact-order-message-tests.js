#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const css = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed++;
    console.error("FAIL", name, err && err.stack || err);
  });
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const moneyFn = sliceBetween(shop, "function money(n){", "function isStockEnforcementEnabled(){");
const cartPageFn = sliceBetween(shop, "function cartPage(){", "function changeQty(");
const signatureFn = sliceBetween(shop, "function currentOrderSignature(customer){", "function orderMessageAmount(n,alwaysDecimals){");
const buildFn = sliceBetween(shop, "function orderMessageAmount(n,alwaysDecimals){", "function getOrBuildOrder(requireCustomer=true){");
const getOrBuildFn = sliceBetween(shop, "function getOrBuildOrder(requireCustomer=true){", "const preparedOrderHistoryInflight=new WeakMap();");
const previewFn = sliceBetween(shop, "async function showOrderPreview(){", "async function copyOrder(){");
const copyFn = sliceBetween(shop, "async function copyOrder(){", "async function shareOrder(){");
const shareFn = sliceBetween(shop, "async function shareOrder(){", "function whatsappOrderUrl(text){");
const urlFn = sliceBetween(shop, "function whatsappOrderUrl(text){", "let sharedCartImportClaimed=false;");
const waFn = sliceBetween(shop, "async function orderWithWhatsApp(){", "function syncDeliveryAddressRequired(){");
const genFn = sliceBetween(shop, "const ORDER_NO_ALPHABET=", "let preparedOrder=null,preparedOrderSignature=\"\";");
const previewCss = sliceBetween(css, ".order-preview{", ".checkout-note{");

function customer(overrides = {}) {
  return {
    name: "Aygul Test",
    phone: "0555 000 11 11",
    city: "Istanbul / Fatih",
    address: "Test street 1, door 4",
    delivery: "كارگو ئارقىلىق",
    note: "",
    ...overrides
  };
}

function book(id, title, price) {
  return { id, title, author: "Test author", price };
}

function load(state) {
  let cryptoCalls = 0;
  const crypto = {
    getRandomValues(bytes) {
      cryptoCalls += 1;
      for (let i = 0; i < bytes.length; i++) bytes[i] = cryptoCalls * 3 + i;
      return bytes;
    }
  };
  state.toasts = [];
  state.events = [];
  state.cartPageCalls = 0;
  state.clampCalls = 0;
  state.saveCustomerCalls = 0;
  state.wrap = state.wrap || { hidden: true, scrollIntoView() { state.scrolled = true; } };
  state.pre = state.pre || { textContent: "" };
  state.copied = [];
  state.shares = [];
  state.openCalls = [];
  state.hrefs = [];
  const api = new Function("state", "crypto", `
    const globalThis = { crypto };
    const document = {
      querySelector(sel) {
        if (sel === "#checkoutForm") {
          return state.formPresent === false ? null : { reportValidity() { return state.formValid !== false; } };
        }
        if (sel === "#orderPreviewWrap") return state.wrap;
        if (sel === "#orderPreview") return state.pre;
        return null;
      },
      createElement() { return { value: "", select() {}, remove() {} }; },
      body: { appendChild() {} },
      execCommand() { return true; }
    };
    const navigator = {
      clipboard: { async writeText(text) { state.copied.push(String(text)); } },
      share: state.share === false ? undefined : async (payload) => { state.shares.push(payload); }
    };
    const window = {
      crypto,
      KUTADGU_WHATSAPP_NUMBER: "905368999888",
      open(url) {
        state.openCalls.push(String(url));
        return { opener: window, close() {} };
      },
      location: {
        set href(url) { state.hrefs.push(String(url)); },
        get href() { return state.hrefs[state.hrefs.length - 1] || ""; }
      }
    };
    const location = window.location;
    const console = { warn() {} };
    function toast(msg) { state.toasts.push(String(msg)); }
    function cartHydrationPending() { return !!state.hydrationPending; }
    function cartLines() { return state.lines.map((line) => ({ id: line.id, qty: line.qty })); }
    function cart() { return state.lines.map((line) => ({ id: line.id, qty: line.qty })); }
    function find(id) { return state.books[String(id)] || null; }
    function isStorefrontVisible() { return state.visible !== false; }
    function stockInfo() { return state.stock || { canBuy: true, qty: null }; }
    function clampCartQuantitiesToStock() { state.clampCalls += 1; return !!state.clamp; }
    function cartPage() { state.cartPageCalls += 1; }
    function saveCustomerData() { state.saveCustomerCalls += 1; return state.customer; }
    function canonicalId(id) { return String(id); }
    function trackEvent(name, payload) { state.events.push({ name, payload }); }
    function savePreparedOrderHistory() { return Promise.resolve({ saved: false, reason: "not_signed_in" }); }
    let preparedOrder = null, preparedOrderSignature = "";
    ${genFn}
    ${signatureFn}
    ${buildFn}
    ${getOrBuildFn}
    ${previewFn}
    ${copyFn}
    ${shareFn}
    ${urlFn}
    ${waFn}
    return {
      buildOrderText, getOrBuildOrder, showOrderPreview, copyOrder, shareOrder,
      orderWithWhatsApp, whatsappOrderUrl, orderItemAmount, orderGrandAmount
    };
  `)(state, crypto);
  api.cryptoCalls = () => cryptoCalls;
  return api;
}

function readyState(overrides = {}) {
  const longTitle = "ئۇزۇن ئۇيغۇرچە كىتاب نامى ".repeat(8).trim();
  return {
    lines: [
      { id: "1", qty: 1 },
      { id: "2", qty: 2 },
      { id: "3", qty: 2 }
    ],
    books: {
      "1": book("1", longTitle, 153),
      "2": book("2", "ئاچىل", 153),
      "3": book("3", "يەنە بىر كىتاب", 147)
    },
    customer: customer(),
    formValid: true,
    formPresent: true,
    visible: true,
    hydrationPending: false,
    clamp: false,
    stock: { canBuy: true, qty: null },
    longTitle,
    ...overrides
  };
}

function lineOf(text, title) {
  return text.split("\n").find((line) => line.includes(title));
}

async function run() {
  await test("item lines show quantity and one subtotal, with a bold summed summary", () => {
    const state = readyState();
    const api = load(state);
    const order = api.buildOrderText(false);
    assert.ok(order);
    const text = order.text;
    assert.equal(lineOf(text, state.longTitle), `1. ${state.longTitle} — 1 دانە · 153 ₺`);
    assert.equal(lineOf(text, "ئاچىل"), "2. ئاچىل — 2 دانە · 306 ₺");
    assert.equal(lineOf(text, "يەنە بىر كىتاب"), "3. يەنە بىر كىتاب — 2 دانە · 294 ₺");
    assert.equal(text.includes("×"), false);
    assert.equal(text.includes(" = "), false);
    assert.equal(text.split("\n").filter((line) => line.startsWith("*")).join("\n"), "*جەمئىي كىتاب سانى: 5 — جەمئىي: 753,00 ₺*");
    assert.equal(order.totalQty, 5);
    assert.equal(order.total, 753);
    assert.deepStrictEqual(order.items.map((item) => ({
      book_id: item.book_id, price: item.price, qty: item.qty, line_total: item.line_total
    })), [
      { book_id: "1", price: 153, qty: 1, line_total: 153 },
      { book_id: "2", price: 153, qty: 2, line_total: 306 },
      { book_id: "3", price: 147, qty: 2, line_total: 294 }
    ]);
    assert.equal(text.split("\n").some((line) => line.includes(state.longTitle) && line.includes("\n")), false);
    assert.equal(lineOf(text, state.longTitle).includes(state.longTitle), true);
  });

  await test("fractional item subtotals and the grand total use Turkish separators", () => {
    const state = readyState({
      lines: [{ id: "4", qty: 2 }, { id: "5", qty: 1 }],
      books: {
        "4": book("4", "كەسىرلىك كىتاب", 412.1),
        "5": book("5", "چوڭ سومما", 10410.1)
      }
    });
    const order = load(state).buildOrderText(false);
    assert.equal(lineOf(order.text, "كەسىرلىك كىتاب"), "1. كەسىرلىك كىتاب — 2 دانە · 824,20 ₺");
    assert.equal(lineOf(order.text, "چوڭ سومما"), "2. چوڭ سومما — 1 دانە · 10.410,10 ₺");
    assert.equal(order.totalQty, 3);
    assert.equal(Math.round(order.total * 100), 1123430);
    assert.match(order.text, /\*جەمئىي كىتاب سانى: 3 — جەمئىي: 11\.234,30 ₺\*/);
    assert.equal(order.items[0].line_total, 824.2);
    assert.equal(order.items[0].price, 412.1);
    assert.equal(load({ ...state, lines: [{ id: "6", qty: 1 }], books: { "6": book("6", "پۈتۈن", 11234) } }).buildOrderText(false).text.includes("1. پۈتۈن — 1 دانە · 11.234 ₺"), true);
  });

  await test("a blank note is omitted and a nonempty note stays with the other customer fields", () => {
    const blank = load(readyState({ customer: customer({ note: " \n\t " }) })).buildOrderText(false);
    assert.equal(blank.text.includes("ئىزاھات"), false);
    assert.match(blank.text, /ئىسمى: Aygul Test/);
    assert.match(blank.text, /تېلېفون: 0555 000 11 11/);
    assert.match(blank.text, /شەھەر \/ رايون: Istanbul \/ Fatih/);
    assert.match(blank.text, /ئادرېس: Test street 1, door 4/);
    assert.match(blank.text, /يەتكۈزۈش: كارگو ئارقىلىق/);
    assert.equal(blank.customer.phone, "0555 000 11 11");
    const noted = load(readyState({ customer: customer({ note: "  كەلگەندە تېلېفون قىلىڭ  " }) })).buildOrderText(false);
    assert.match(noted.text, /ئىزاھات: كەلگەندە تېلېفون قىلىڭ/);
    assert.equal(noted.text.includes("ئىزاھات: -"), false);
    assert.match(noted.text, /ئەسسالامۇ ئەلەيكۇم، تۆۋەندىكى كىتابلارنى زاكاز قىلماقچى ئىدىم:/);
    assert.match(noted.text, /زاكاز نومۇرى: KB-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}/);
  });

  await test("preview, copy, share, and the decoded WhatsApp URL use one text and one order id", async () => {
    const state = readyState({ customer: customer({ note: "ئىشىك ئالدىدا قويۇڭ" }) });
    const api = load(state);
    const preview = await api.showOrderPreview();
    const again = await api.showOrderPreview();
    assert.equal(preview, again);
    assert.equal(api.cryptoCalls(), 1);
    assert.equal(state.pre.textContent, preview.text);
    assert.equal(state.wrap.hidden, false);
    await api.copyOrder();
    await api.shareOrder();
    await api.orderWithWhatsApp();
    assert.deepStrictEqual(state.copied, [preview.text]);
    assert.equal(state.shares[0].text, preview.text);
    assert.equal(state.openCalls.length, 1);
    const decoded = decodeURIComponent(state.openCalls[0].split("text=")[1]);
    assert.equal(decoded, preview.text);
    assert.match(state.openCalls[0], /^https:\/\/wa\.me\/905368999888\?text=/);
    assert.equal(state.events[0].name, "whatsapp_order_click");
    assert.equal(state.events[0].payload.total, preview.total);
    state.customer = customer({ note: "باشقا ئىزاھات" });
    const changed = api.getOrBuildOrder(false);
    assert.notEqual(changed.orderId, preview.orderId);
    assert.equal(api.cryptoCalls(), 2);
    assert.match(changed.text, /ئىزاھات: باشقا ئىزاھات/);
  });

  await test("empty, hidden, out-of-stock, clamped, and invalid carts still produce no message", () => {
    const emptyState = readyState({ lines: [] });
    const empty = load(emptyState);
    assert.equal(empty.buildOrderText(false), null);
    assert.deepStrictEqual(emptyState.toasts, ["سېۋەت بوش"]);

    const pendingState = readyState({ hydrationPending: true });
    assert.equal(load(pendingState).buildOrderText(false), null);
    assert.deepStrictEqual(pendingState.toasts, ["كىتاب ئۇچۇرى يۈكلىنىۋاتىدۇ؛ سەل ساقلاڭ."]);

    const hiddenState = readyState({ visible: false });
    assert.equal(load(hiddenState).buildOrderText(false), null);
    assert.deepStrictEqual(hiddenState.toasts, ["سېۋەتتە ھازىرچە تەمىنلەنمەيدىغان كىتاب بار"]);

    const stockState = readyState({ stock: { canBuy: false, qty: 0 } });
    assert.equal(load(stockState).buildOrderText(false), null);
    assert.deepStrictEqual(stockState.toasts, ["سېۋەتتە تۈگەپ كەتكەن كىتاب بار؛ ئۇنى ئۆچۈرۈڭ"]);

    const overState = readyState({ stock: { canBuy: true, qty: 1 } });
    assert.equal(load(overState).buildOrderText(false), null);
    assert.deepStrictEqual(overState.toasts, ["سېۋەتتىكى سان نۆۋەتتىكى ئامباردىن ئېشىپ كەتتى"]);

    const clampedState = readyState({ clamp: true });
    const clamped = load(clampedState);
    assert.equal(clamped.buildOrderText(false), null);
    assert.equal(clampedState.cartPageCalls, 1);
    assert.deepStrictEqual(clampedState.toasts, ["سېۋەتتىكى سان نۆۋەتتىكى ئامبارغا ماسلاشتۇرۇلدى"]);

    const invalidState = readyState({ formValid: false });
    const invalid = load(invalidState);
    assert.equal(invalid.buildOrderText(true), null);
    assert.equal(invalid.getOrBuildOrder(true), null);
    assert.deepStrictEqual(invalidState.toasts, []);
    assert.equal(invalidState.saveCustomerCalls, 0);
  });

  await test("formatting stays local to the order message and the cart still uses money()", () => {
    assert.equal(moneyFn.trim(), 'function money(n){return n!=null&&n!==""?`${Number(n).toLocaleString("tr-TR")} ₺`:"باھا تېخى بېكىتىلمىگەن"}');
    assert.match(cartPageFn, /money\(\(x\.b\.price\|\|0\)\*x\.qty\)/);
    assert.match(cartPageFn, /money\(total\)/);
    assert.doesNotMatch(cartPageFn, /orderItemAmount|orderGrandAmount|orderMessageAmount/);
    assert.doesNotMatch(buildFn, /money\(/);
    assert.match(buildFn, /price:Number\(x\.b\.price\)\|\|0/);
    assert.match(buildFn, /line_total:\(Number\(x\.b\.price\)\|\|0\)\*x\.qty/);
    assert.match(cartHtml, /shop\.js\?v=156/);
    assert.match(previewCss, /white-space:pre-wrap/);
    assert.match(previewCss, /word-break:break-word/);
    assert.match(previewCss, /direction:rtl/);
    assert.match(cartHtml, /<html lang="ug" dir="rtl">/);
  });

  if (failed) {
    console.error("\n" + failed + " compact order message test(s) failed");
    process.exit(1);
  }
  console.log("compact-order-message-tests ok");
}

run();
