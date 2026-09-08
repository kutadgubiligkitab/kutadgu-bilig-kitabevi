#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");

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

const helper = sliceBetween(shop, "function syncDeliveryAddressRequired(){", "function setupCheckout(){");
const setup = sliceBetween(shop, "function setupCheckout(){", "/* ===== Premium configurable carousel");
const saveFn = sliceBetween(shop, "function saveCustomerData(){", "function loadCustomerData(){");
const loadFn = sliceBetween(shop, "function loadCustomerData(){", "function loadMemberProfileIntoCheckout(){");
const buildFn = sliceBetween(shop, "function buildOrderText(requireCustomer=true){", "function getOrBuildOrder(requireCustomer=true){");
const getOrBuildFn = sliceBetween(shop, "function getOrBuildOrder(requireCustomer=true){", "const preparedOrderHistoryInflight=new WeakMap();");
const previewFn = sliceBetween(shop, "async function showOrderPreview(){", "async function copyOrder(){");
const copyFn = sliceBetween(shop, "async function copyOrder(){", "async function shareOrder(){");
const shareFn = sliceBetween(shop, "async function shareOrder(){", "function whatsappOrderUrl(text){");
const waFn = sliceBetween(shop, "async function orderWithWhatsApp(){", "function syncDeliveryAddressRequired(){");

const PICKUP = "دۇكاندىن ئېلىش";
const CARGO = "كارگو ئارقىلىق";
const LATER = "كېيىن بېكىتىش";

function field(required) {
  return {
    value: "",
    required: !!required,
    hidden: false,
    removeAttribute(name) { if (name === "required") this.required = false; },
    setAttribute(name) { if (name === "required") this.required = true; },
    hasAttribute(name) { return name === "required" ? this.required : false; }
  };
}

function loadSync() {
  return new Function(`
    let address, delivery, mark;
    const document = {
      querySelector(sel) {
        if (sel === "#customerAddress") return address;
        if (sel === "#deliveryMethod") return delivery;
        if (sel === "#customerAddressRequiredMark") return mark;
        return null;
      }
    };
    ${helper}
    return {
      syncDeliveryAddressRequired,
      bind(nextAddress, nextDelivery, nextMark) {
        address = nextAddress;
        delivery = nextDelivery;
        mark = nextMark;
      }
    };
  `)();
}

function reportValidity(name, phone, address) {
  if (name.required && !String(name.value || "").trim()) return false;
  if (phone.required && !String(phone.value || "").trim()) return false;
  if (address.required && !String(address.value || "").trim()) return false;
  return true;
}

test("HTML keeps cargo address required by default and a toggleable required mark", () => {
  assert.match(cartHtml, /id="deliveryMethod"/);
  assert.match(cartHtml, /<option value="كارگو ئارقىلىق">كارگو ئارقىلىق<\/option>/);
  assert.match(cartHtml, /<option value="دۇكاندىن ئېلىش">دۇكاندىن ئېلىش<\/option>/);
  assert.match(cartHtml, /id="customerAddress"[^>]*required/);
  assert.match(cartHtml, /id="customerAddressRequiredMark">\*<\/span>/);
  assert.match(cartHtml, /id="customerName"[^>]*required/);
  assert.match(cartHtml, /id="customerPhone"[^>]*required/);
});

test("setupCheckout syncs after loadCustomerData and on delivery change; actions stay shared", () => {
  assert.match(setup, /loadCustomerData\(\);\n  syncDeliveryAddressRequired\(\);/);
  assert.match(setup, /#deliveryMethod"\)\?\.addEventListener\("change",syncDeliveryAddressRequired\)/);
  assert.match(setup, /whatsapp\)whatsapp\.onclick=orderWithWhatsApp/);
  assert.match(setup, /prepare\)prepare\.onclick=showOrderPreview/);
  assert.match(setup, /copy\)copy\.onclick=copyOrder/);
  assert.match(setup, /share\)share\.onclick=shareOrder/);
  assert.match(previewFn, /getOrBuildOrder\(true\)/);
  assert.match(copyFn, /getOrBuildOrder\(true\)/);
  assert.match(shareFn, /getOrBuildOrder\(true\)/);
  assert.match(waFn, /getOrBuildOrder\(true\)/);
  assert.match(getOrBuildFn, /form\.reportValidity\(\)/);
  assert.match(buildFn, /form\.reportValidity\(\)/);
  assert.doesNotMatch(previewFn, /customerAddress/);
  assert.doesNotMatch(copyFn, /customerAddress/);
  assert.doesNotMatch(shareFn, /customerAddress/);
  assert.doesNotMatch(waFn, /customerAddress/);
  assert.doesNotMatch(helper, /كېيىن بېكىتىش/);
});

test("customer persistence keys and WhatsApp address line stay unchanged", () => {
  assert.match(saveFn, /address:document\.querySelector\("#customerAddress"\)\?\.value\.trim\(\)\|\|""/);
  assert.match(saveFn, /delivery:document\.querySelector\("#deliveryMethod"\)\?\.value\|\|""/);
  assert.match(loadFn, /customerAddress:d\.address/);
  assert.match(loadFn, /deliveryMethod:d\.delivery/);
  assert.match(buildFn, /`ئادرېس: \$\{c\.address\|\|"-"\}`/);
  assert.match(buildFn, /`يەتكۈزۈش: \$\{c\.delivery\|\|"-"\}`/);
});

test("pickup with name/phone and empty address passes; cargo still fails", () => {
  const api = loadSync();
  const name = field(true); name.value = "Aygul";
  const phone = field(true); phone.value = "555";
  const address = field(true);
  const delivery = { value: PICKUP };
  const mark = { hidden: false };
  api.bind(address, delivery, mark);
  api.syncDeliveryAddressRequired();
  assert.strictEqual(address.required, false);
  assert.strictEqual(mark.hidden, true);
  assert.strictEqual(name.required, true);
  assert.strictEqual(phone.required, true);
  assert.strictEqual(reportValidity(name, phone, address), true);

  delivery.value = CARGO;
  api.syncDeliveryAddressRequired();
  assert.strictEqual(address.required, true);
  assert.strictEqual(mark.hidden, false);
  assert.strictEqual(reportValidity(name, phone, address), false);
});

test("switching cargo → pickup removes required; pickup → cargo restores it", () => {
  const api = loadSync();
  const address = field(true);
  const delivery = { value: CARGO };
  const mark = { hidden: false };
  api.bind(address, delivery, mark);
  api.syncDeliveryAddressRequired();
  assert.strictEqual(address.required, true);
  assert.strictEqual(mark.hidden, false);

  delivery.value = PICKUP;
  api.syncDeliveryAddressRequired();
  assert.strictEqual(address.required, false);
  assert.strictEqual(mark.hidden, true);

  delivery.value = CARGO;
  api.syncDeliveryAddressRequired();
  assert.strictEqual(address.required, true);
  assert.strictEqual(mark.hidden, false);
});

test("persisted pickup is synchronized on checkout load; decide-later stays required", () => {
  const api = loadSync();
  const address = field(true);
  const mark = { hidden: false };
  const delivery = { value: PICKUP };
  api.bind(address, delivery, mark);
  api.syncDeliveryAddressRequired();
  assert.strictEqual(address.required, false);
  assert.strictEqual(mark.hidden, true);

  delivery.value = LATER;
  api.syncDeliveryAddressRequired();
  assert.strictEqual(address.required, true);
  assert.strictEqual(mark.hidden, false);
});

if (failed) {
  console.error("\n" + failed + " m2 pickup address test(s) failed");
  process.exit(1);
}
console.log("m2-pickup-address-validation-tests ok");
