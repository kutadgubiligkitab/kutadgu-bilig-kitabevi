#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const member = fs.readFileSync(path.join(root, "member.js"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const accountJs = fs.readFileSync(path.join(root, "account.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "STAGE80_MEMBER_ORDER_INTEGRITY.sql"), "utf8");
const setup = fs.readFileSync(path.join(root, "SUPABASE_SETUP.sql"), "utf8");
const stage83 = fs.readFileSync(path.join(root, "STAGE83_STOCK_ENFORCEMENT.sql"), "utf8");

const NEW_ID = /^KB-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
const HISTORICAL = "KB-250905-1234";
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed++;
    console.error("FAIL", name, err && err.message);
  });
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const genSrc = sliceBetween(shop, "const ORDER_NO_ALPHABET=", "let preparedOrder=null,preparedOrderSignature=\"\";");
const getOrBuildSrc = sliceBetween(shop, "function getOrBuildOrder(requireCustomer=true){", "const preparedOrderHistoryInflight=new WeakMap();");
const saveSrc = sliceBetween(shop, "const preparedOrderHistoryInflight=new WeakMap();", "async function showOrderPreview(){");
const waSrc = sliceBetween(shop, "async function orderWithWhatsApp(){", "function setupCheckout(){");

function loadGenerator(fillFn) {
  const crypto = {
    getRandomValues(bytes) {
      fillFn(bytes);
      return bytes;
    }
  };
  return new Function("crypto", `
    const globalThis = { crypto };
    const window = { crypto };
    ${genSrc}
    return { makeOrderId, randomOrderIdSuffix, ORDER_NO_ALPHABET };
  `)(crypto);
}

function fillConstant(value) {
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = value;
  };
}
function fillSequence(start) {
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = start + i;
  };
}

async function run() {
  await test("new order IDs match KB-YYMMDD-XXXXXXXX from the non-ambiguous alphabet", () => {
    const api = loadGenerator(fillSequence(2));
    const id = api.makeOrderId();
    assert.match(id, NEW_ID);
    const suffix = id.split("-")[2];
    assert.equal(suffix.length, 8);
    assert.doesNotMatch(suffix, /[01IO]/);
    assert.equal(api.ORDER_NO_ALPHABET, ALPHABET);
  });

  await test("makeOrderId uses Web Crypto and never Math.random", () => {
    assert.match(genSrc, /getRandomValues/);
    assert.doesNotMatch(genSrc, /Math\.random/);
    assert.doesNotMatch(genSrc, /toString\(36\)/);
    let called = 0;
    const api = loadGenerator((bytes) => {
      called++;
      for (let i = 0; i < bytes.length; i++) bytes[i] = 7;
    });
    api.makeOrderId();
    assert.equal(called, 1);
  });

  await test("controlled crypto values produce distinct suffixes, not a constant ID", () => {
    const a = loadGenerator(fillSequence(0)).makeOrderId();
    const b = loadGenerator(fillSequence(8)).makeOrderId();
    const c = loadGenerator(fillConstant(3)).makeOrderId();
    assert.match(a, NEW_ID);
    assert.match(b, NEW_ID);
    assert.match(c, NEW_ID);
    assert.notEqual(a, b);
    assert.notEqual(a.split("-")[2], b.split("-")[2]);
    assert.notEqual(a.split("-")[2], c.split("-")[2]);
    const prefix = a.slice(0, 10);
    assert.match(prefix, /^KB-\d{6}-$/);
    assert.equal(a.slice(0, 10), b.slice(0, 10));
  });

  await test("historical 4-digit order numbers remain displayable and searchable", () => {
    assert.match(HISTORICAL, /^KB-\d{6}-\d{4}$/);
    assert.doesNotMatch(HISTORICAL, NEW_ID);
    assert.match(accountJs, /order\.order_no/);
    assert.doesNotMatch(accountJs, /KB-\[0-9\]\{6\}-\[0-9\]\{4\}/);
    assert.doesNotMatch(accountJs, /KB-\\d\{6\}-\[23456789/);
    assert.match(adminJs, /postgrestIlike\("order_no",term\)/);
    assert.doesNotMatch(adminJs, /KB-\[0-9\]\{6\}-\[0-9\]\{4\}/);
    assert.match(member, /p_order_no:String\(order\.orderId\|\|""\)\.trim\(\)/);
    assert.doesNotMatch(member, /KB-\[0-9\]\{6\}-\[0-9\]\{4\}/);
  });

  await test("prepared order reuse keeps the same order_no through persistence", async () => {
    const crypto = {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = 11 + i;
        return bytes;
      }
    };
    const saveOrderCalls = [];
    const api = new Function("crypto", "saveOrderCalls", `
      const globalThis = { crypto };
      const window = {
        crypto,
        KutadguMember: {
          ready: Promise.resolve(),
          getUser() { return { id: "member-1" }; },
          async saveOrder(order) {
            saveOrderCalls.push(order);
            return { saved: true, order: { order_no: order.orderId, status: "prepared" } };
          }
        }
      };
      const document = { querySelector() { return null; } };
      function saveCustomerData(){ return { name: "Aygul", phone: "555" }; }
      function currentOrderSignature(customer){ return JSON.stringify({ cart: [{ id: "101", qty: 1 }], customer }); }
      ${genSrc}
      let preparedOrder=null,preparedOrderSignature="";
      let buildCount=0;
      function buildOrderText(){
        buildCount++;
        const orderId=makeOrderId();
        return { orderId, text: "زاكاز نومۇرى: " + orderId, items: [{ book_id: 101, qty: 1 }] };
      }
      ${getOrBuildSrc}
      ${saveSrc}
      return {
        getOrBuildOrder,
        savePreparedOrderHistory,
        builds(){ return buildCount; }
      };
    `)(crypto, saveOrderCalls);
    const first = api.getOrBuildOrder(false);
    const second = api.getOrBuildOrder(false);
    const third = api.getOrBuildOrder(false);
    assert.equal(api.builds(), 1);
    assert.equal(first, second);
    assert.equal(second, third);
    assert.match(first.orderId, NEW_ID);
    assert.equal(first.orderId, second.orderId);
    const persist = await api.savePreparedOrderHistory(first);
    assert.equal(persist.saved, true);
    assert.equal(saveOrderCalls.length, 1);
    assert.equal(saveOrderCalls[0].orderId, first.orderId);
    assert.equal(saveOrderCalls[0], first);
    await api.savePreparedOrderHistory(first);
    assert.equal(saveOrderCalls.length, 1);
  });

  await test("member persistence receives the WhatsApp/prepared order_no unchanged", () => {
    assert.match(member, /db\.rpc\("create_member_order"/);
    assert.match(member, /p_order_no:String\(order\.orderId\|\|""\)\.trim\(\)/);
    assert.match(saveSrc, /member\?\.saveOrder\?\.\(order\)/);
    assert.match(waSrc, /savePreparedOrderHistory\(o\)/);
    assert.ok(waSrc.indexOf("window.open(url") < waSrc.indexOf("savePreparedOrderHistory"));
  });

  await test("guest WhatsApp path still skips DB persistence", () => {
    assert.match(saveSrc, /reason:"not_signed_in"/);
    assert.match(waSrc, /savePreparedOrderHistory/);
    assert.doesNotMatch(shop, /from\("orders"\)\.insert/);
  });

  await test("applied Stage 80/83 SQL keep the historical 4-digit regex; Stage 84 and setup accept both", () => {
    assert.match(sql, /\^KB-\[0-9\]\{6\}-\[0-9\]\{4\}\$/);
    assert.match(stage83, /\^KB-\[0-9\]\{6\}-\[0-9\]\{4\}\$/);
    assert.doesNotMatch(stage83, /\[23456789ABCDEFGHJKLMNPQRSTUVWXYZ\]\{8\}/);
    const dual = /\^KB-\[0-9\]\{6\}-\(\[0-9\]\{4\}\|\[23456789ABCDEFGHJKLMNPQRSTUVWXYZ\]\{8\}\)\$/;
    assert.match(setup, dual);
    assert.doesNotMatch(shop, /create_member_order/);
    assert.doesNotMatch(shop, /ALTER TABLE/);
    assert.doesNotMatch(shop, /CREATE UNIQUE INDEX/i);
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("All order-number hardening tests passed");
}

run();
