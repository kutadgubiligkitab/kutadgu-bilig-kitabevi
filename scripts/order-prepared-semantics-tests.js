#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");
let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed++;
    console.error("FAIL", name, err.message);
  });
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const previewFn = sliceBetween(shop, "async function showOrderPreview(){", "async function copyOrder(){");
const copyFn = sliceBetween(shop, "async function copyOrder(){", "async function shareOrder(){");
const shareFn = sliceBetween(shop, "async function shareOrder(){", "function whatsappOrderUrl(text){");
const saveFn = sliceBetween(shop, "const preparedOrderHistoryInflight=new WeakMap();", "async function showOrderPreview(){");
const waFn = sliceBetween(shop, "async function orderWithWhatsApp(){", "function setupCheckout(){");
const getOrBuildFn = sliceBetween(shop, "function getOrBuildOrder(requireCustomer=true){", "const preparedOrderHistoryInflight=new WeakMap();");

function makeOrderActions(opts = {}) {
  const ctx = {
    toasts: [],
    saveOrderCalls: [],
    openCalls: [],
    copied: [],
    shares: [],
    hrefs: [],
    timeline: [],
    saveDelayMs: opts.saveDelayMs || 40,
    saveShouldFail: !!opts.saveShouldFail,
    signedIn: opts.signedIn !== false,
    blocked: !!opts.blocked,
    cartLines: opts.cartLines || [{ id: "101", qty: 1 }],
    order: opts.order || {
      text: "زاكاز نومۇرى: T-1\nكىتاب: Test Book",
      orderId: "T-1",
      total: 42,
      totalQty: 1,
      items: [{ book_id: "101", title: "Test Book", qty: 1, price: 42 }]
    },
    document: {
      querySelector(sel) {
        if (sel === "#orderPreviewWrap") return ctx.wrap;
        if (sel === "#orderPreview") return ctx.pre;
        return null;
      },
      createElement() {
        return { value: "", select() {}, remove() {} };
      },
      body: { appendChild() {} },
      execCommand() { return true; }
    },
    wrap: { hidden: true, scrollIntoView() { ctx.previewScrolled = true; } },
    pre: { textContent: "" },
    navigator: {
      clipboard: {
        async writeText(text) { ctx.copied.push(String(text)); }
      },
      share: opts.share === false ? undefined : async (payload) => { ctx.shares.push(payload); }
    }
  };
  ctx.window = {
    KutadguMember: {
      ready: Promise.resolve(),
      getUser() { return ctx.signedIn ? { id: "member-1" } : null; },
      async saveOrder(order) {
        const t = Date.now();
        ctx.timeline.push({ type: "saveOrder:start", t });
        await new Promise((r) => setTimeout(r, ctx.saveDelayMs));
        ctx.saveOrderCalls.push(order);
        ctx.timeline.push({ type: "saveOrder:done", t: Date.now() });
        if (!ctx.signedIn) return { saved: false, reason: "not_signed_in" };
        if (ctx.blocked) return { saved: false, reason: "suspended" };
        if (ctx.saveShouldFail) throw new Error("save failed");
        return { saved: true, order: { status: "prepared", total: order.total } };
      }
    },
    open(url) {
      ctx.timeline.push({ type: "window.open", t: Date.now(), url: String(url) });
      ctx.openCalls.push(String(url));
      return { opener: ctx.window, close() {} };
    },
    location: {
      set href(url) { ctx.hrefs.push(String(url)); ctx.timeline.push({ type: "location.href", t: Date.now(), url: String(url) }); },
      get href() { return ctx.hrefs[ctx.hrefs.length - 1] || ""; }
    }
  };
  if (opts.popupBlocked) ctx.window.open = () => null;
  const api = new Function("ctx", `
    const window = ctx.window;
    const document = ctx.document;
    const navigator = ctx.navigator;
    const location = ctx.window.location;
    const console = { warn() {}, log() {} };
    function toast(msg){ ctx.toasts.push(String(msg)); }
    function getOrBuildOrder(){ return ctx.order; }
    function cart(){ return ctx.cartLines; }
    function canonicalId(id){ return String(id); }
    function trackEvent(){}
    ${saveFn}
    ${previewFn}
    ${copyFn}
    ${shareFn}
    ${sliceBetween(shop, "function whatsappOrderUrl(text){", "function safeText(value){")}
    ${waFn}
    return { showOrderPreview, copyOrder, shareOrder, orderWithWhatsApp, savePreparedOrderHistory, whatsappOrderUrl };
  `)(ctx);
  return { ctx, api };
}

const adminApi = new Function(`
  ${sliceBetween(admin, "const COUNTED_ORDER_STATUSES=new Set([", "function renderMemberStats(){")}
  let members = [];
  let orders = [];
  const els = {};
  function $(sel){ return els[sel] || (els[sel] = { textContent: "" }); }
  function money(n){ return Number(n) || 0; }
  ${sliceBetween(admin, "function renderMemberStats(){", "function renderMembers(){")}
  return {
    COUNTED_ORDER_STATUSES, countsTowardOrderStats, orderStatsCount, orderStatsRevenue,
    memberOrderSummary, renderMemberStats, setState(m, o){ members = m; orders = o; }, els
  };
`)();

const fixtureOrders = [
  { user_id: "m1", status: "prepared", total: 100 },
  { user_id: "m1", status: "confirmed", total: 200 },
  { user_id: "m1", status: "processing", total: 300 },
  { user_id: "m1", status: "shipped", total: 400 },
  { user_id: "m1", status: "completed", total: 500 },
  { user_id: "m1", status: "cancelled", total: 600 },
  { user_id: "m1", status: "unknown", total: 700 },
  { user_id: "m1", status: "", total: 800 }
];

async function run() {
  await test("preview/copy/share source never persist order history", () => {
    assert.doesNotMatch(previewFn, /savePreparedOrderHistory/);
    assert.doesNotMatch(previewFn, /saveOrder/);
    assert.doesNotMatch(copyFn, /savePreparedOrderHistory/);
    assert.doesNotMatch(copyFn, /saveOrder/);
    assert.doesNotMatch(shareFn, /savePreparedOrderHistory/);
    assert.doesNotMatch(shareFn, /saveOrder/);
    assert.doesNotMatch(previewFn, /ھېسابىڭىزغا ساقلاندى/);
    assert.doesNotMatch(previewFn, /زاكاز تارىخىغىمۇ ساقلىنىدۇ/);
    assert.match(previewFn, /زاكاز ئۇچۇرى تەييار بولدى/);
    assert.match(getOrBuildFn, /buildOrderText\(false\)/);
    assert.doesNotMatch(getOrBuildFn, /saveOrder/);
  });

  await test("WhatsApp remains the only storefront save path and opens first", () => {
    assert.match(waFn, /window\.open\(url/);
    assert.match(waFn, /savePreparedOrderHistory/);
    assert.ok(waFn.indexOf("window.open(url") < waFn.indexOf("savePreparedOrderHistory"));
    assert.match(saveFn, /historySaved/);
    assert.match(saveFn, /getUser/);
    assert.match(saveFn, /saveOrder/);
    assert.match(saveFn, /preparedOrderHistoryInflight=new WeakMap/);
    assert.match(saveFn, /preparedOrderHistoryInflight\.get\(order\)/);
    assert.match(saveFn, /preparedOrderHistoryInflight\.set\(order,persist\)/);
    assert.match(saveFn, /preparedOrderHistoryInflight\.delete\(order\)/);
    const setup = sliceBetween(shop, "function setupCheckout(){", "/* ===== Premium configurable carousel");
    assert.match(setup, /whatsapp\)whatsapp\.onclick=orderWithWhatsApp/);
    assert.match(setup, /prepare\)prepare\.onclick=showOrderPreview/);
  });

  await test("A Prepare Order is client preview only", async () => {
    const { ctx, api } = makeOrderActions({ signedIn: true });
    const out = await api.showOrderPreview();
    assert.equal(ctx.pre.textContent, ctx.order.text);
    assert.equal(ctx.wrap.hidden, false);
    assert.equal(ctx.saveOrderCalls.length, 0);
    assert.ok(out && out.text);
    assert.equal(ctx.toasts.includes("زاكاز ئۇچۇرى تەييار بولدى ✅"), true);
    await api.showOrderPreview();
    await api.showOrderPreview();
    assert.equal(ctx.saveOrderCalls.length, 0);
  });

  await test("B Copy Order copies text and does not save", async () => {
    const { ctx, api } = makeOrderActions({ signedIn: true });
    await api.copyOrder();
    await api.copyOrder();
    assert.deepStrictEqual(ctx.copied, [ctx.order.text, ctx.order.text]);
    assert.equal(ctx.saveOrderCalls.length, 0);
  });

  await test("C Share Order uses Web Share without save; copy fallback also has zero saves", async () => {
    const share = makeOrderActions({ signedIn: true });
    await share.api.shareOrder();
    await share.api.shareOrder();
    assert.equal(share.ctx.shares.length, 2);
    assert.equal(share.ctx.saveOrderCalls.length, 0);

    const fallback = makeOrderActions({ signedIn: true, share: false });
    await fallback.api.shareOrder();
    await fallback.api.shareOrder();
    assert.deepStrictEqual(fallback.ctx.copied, [fallback.ctx.order.text, fallback.ctx.order.text]);
    assert.equal(fallback.ctx.saveOrderCalls.length, 0);
  });

  await test("D Prepare then Copy then Share still never saves", async () => {
    const { ctx, api } = makeOrderActions({ signedIn: true });
    await api.showOrderPreview();
    await api.copyOrder();
    await api.shareOrder();
    await api.showOrderPreview();
    await api.copyOrder();
    await api.shareOrder();
    assert.equal(ctx.saveOrderCalls.length, 0);
    assert.equal(ctx.pre.textContent, ctx.order.text);
    assert.ok(ctx.copied.length >= 1);
    assert.ok(ctx.shares.length >= 1);
  });

  await test("E WhatsApp opens before signed-in history save, at most once, and survives save failure", async () => {
    const ok = makeOrderActions({ signedIn: true, saveDelayMs: 50 });
    const done = ok.api.orderWithWhatsApp();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(ok.ctx.openCalls.length, 1);
    assert.match(ok.ctx.openCalls[0], /^https:\/\/wa\.me\/\?text=/);
    assert.equal(decodeURIComponent(ok.ctx.openCalls[0].split("text=")[1] || ""), ok.ctx.order.text);
    assert.equal(ok.ctx.saveOrderCalls.length, 0);
    const openAt = ok.ctx.timeline.find((x) => x.type === "window.open").t;
    await done;
    assert.equal(ok.ctx.saveOrderCalls.length, 1);
    const saveStart = ok.ctx.timeline.find((x) => x.type === "saveOrder:start").t;
    assert.ok(openAt <= saveStart, "WhatsApp navigation must start before history save");
    await ok.api.orderWithWhatsApp();
    await ok.api.orderWithWhatsApp();
    assert.equal(ok.ctx.openCalls.length, 3);
    assert.equal(ok.ctx.saveOrderCalls.length, 1);

    const fail = makeOrderActions({ signedIn: true, saveShouldFail: true });
    await fail.api.orderWithWhatsApp();
    assert.equal(fail.ctx.openCalls.length, 1);
    assert.equal(fail.ctx.saveOrderCalls.length, 1);
  });

  await test("concurrent WhatsApp clicks share one in-flight saveOrder", async () => {
    const ok = makeOrderActions({ signedIn: true, saveDelayMs: 80 });
    const a = ok.api.orderWithWhatsApp();
    const b = ok.api.orderWithWhatsApp();
    const c = ok.api.orderWithWhatsApp();
    const persistA = ok.api.savePreparedOrderHistory(ok.ctx.order);
    const persistB = ok.api.savePreparedOrderHistory(ok.ctx.order);
    const persistC = ok.api.savePreparedOrderHistory(ok.ctx.order);
    assert.equal(persistA, persistB);
    assert.equal(persistB, persistC);
    await Promise.all([a, b, c, persistA, persistB, persistC]);
    assert.equal(ok.ctx.openCalls.length, 3);
    assert.equal(ok.ctx.saveOrderCalls.length, 1);
    await ok.api.orderWithWhatsApp();
    await ok.api.orderWithWhatsApp();
    assert.equal(ok.ctx.openCalls.length, 5);
    assert.equal(ok.ctx.saveOrderCalls.length, 1);

    const fail = makeOrderActions({ signedIn: true, saveShouldFail: true, saveDelayMs: 80 });
    await Promise.allSettled([
      fail.api.orderWithWhatsApp(),
      fail.api.orderWithWhatsApp(),
      fail.api.orderWithWhatsApp()
    ]);
    assert.equal(fail.ctx.openCalls.length, 3);
    assert.equal(fail.ctx.saveOrderCalls.length, 1);
    fail.ctx.saveShouldFail = false;
    await fail.api.orderWithWhatsApp();
    assert.equal(fail.ctx.openCalls.length, 4);
    assert.equal(fail.ctx.saveOrderCalls.length, 2);

    const guest = makeOrderActions({ signedIn: false, saveDelayMs: 80 });
    await Promise.all([
      guest.api.orderWithWhatsApp(),
      guest.api.orderWithWhatsApp(),
      guest.api.orderWithWhatsApp()
    ]);
    assert.equal(guest.ctx.openCalls.length, 3);
    assert.equal(guest.ctx.saveOrderCalls.length, 0);
  });

  await test("F guest WhatsApp works without saveOrder persistence", async () => {
    const { ctx, api } = makeOrderActions({ signedIn: false });
    await api.orderWithWhatsApp();
    assert.equal(ctx.openCalls.length, 1);
    assert.match(ctx.openCalls[0], /^https:\/\/wa\.me\/\?text=/);
    assert.equal(ctx.saveOrderCalls.length, 0);
    const result = await api.savePreparedOrderHistory(ctx.order);
    assert.equal(result.saved, false);
    assert.equal(result.reason, "not_signed_in");
    assert.equal(ctx.saveOrderCalls.length, 0);
  });

  await test("suspended members still reach saveOrder after WhatsApp opens", async () => {
    const { ctx, api } = makeOrderActions({ signedIn: true, blocked: true });
    await api.orderWithWhatsApp();
    assert.equal(ctx.openCalls.length, 1);
    assert.equal(ctx.saveOrderCalls.length, 1);
    const result = await api.savePreparedOrderHistory(ctx.order);
    assert.equal(result.saved, false);
    assert.equal(result.reason, "suspended");
  });

  await test("G Admin stats count only confirmed/processing/shipped/completed", () => {
    assert.deepStrictEqual([...adminApi.COUNTED_ORDER_STATUSES].sort(), ["completed", "confirmed", "processing", "shipped"]);
    assert.equal(adminApi.orderStatsCount(fixtureOrders), 4);
    assert.equal(adminApi.orderStatsRevenue(fixtureOrders), 1400);
    for (const status of ["prepared", "cancelled", "unknown", "", "draft"]) {
      assert.equal(adminApi.countsTowardOrderStats({ status, total: 999 }), false);
    }
    for (const status of ["confirmed", "processing", "shipped", "completed", "CONFIRMED"]) {
      assert.equal(adminApi.countsTowardOrderStats({ status }), true);
    }
    adminApi.setState([{ id: "m1", visit_count: 3 }], fixtureOrders);
    adminApi.renderMemberStats();
    assert.equal(adminApi.els["#statOrders"].textContent, 4);
    assert.equal(adminApi.els["#statRevenue"].textContent, 1400);
    const summary = adminApi.memberOrderSummary("m1");
    assert.equal(summary.count, 4);
    assert.equal(summary.total, 1400);
    const other = adminApi.memberOrderSummary("m2");
    assert.equal(other.count, 0);
    assert.equal(other.total, 0);
  });

  await test("H cart authority and WhatsApp builders are preserved", () => {
    assert.match(shop, /const CART_KEY="kutadgu-cart-v1"/);
    assert.match(shop, /function changeQty/);
    assert.match(shop, /function buildOrderText/);
    assert.match(shop, /function whatsappOrderUrl/);
    assert.match(shop, /cartHydrationPending\(\)/);
    assert.match(cartHtml, /id="prepareOrder"/);
    assert.match(cartHtml, /id="copyOrder"/);
    assert.match(cartHtml, /id="shareOrder"/);
    assert.match(cartHtml, /id="whatsappOrder"/);
    assert.match(cartHtml, /زاكاز تور مۇلازىمېتىرىغا ئەۋەتىلمەيدۇ/);
    assert.match(cartHtml, /shop\.js\?v=97/);
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("order-prepared-semantics-tests ok");
}

run();
