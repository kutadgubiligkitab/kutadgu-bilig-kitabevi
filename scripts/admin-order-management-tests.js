#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.message);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const adminCss = read("admin.css");
const setup = read("SUPABASE_SETUP.sql");
const stage2c = read("STAGE2C_AAL2_STORE_STORAGE_RLS.sql");
const navSpec = read("tests/e2e/admin-navigation.spec.js");

function loadHelpers() {
  const counted = sliceBetween(adminJs, "const COUNTED_ORDER_STATUSES=new Set([", "function renderMemberStats(){");
  const statuses = adminJs.match(/const ORDER_STATUSES=\[[^\]]+\]/);
  const set = adminJs.match(/const ORDER_STATUS_SET=new Set\(ORDER_STATUSES\);/);
  const labels = adminJs.match(/const ORDER_STATUS_LABELS=\{[^}]+\}/);
  const orderFns = sliceBetween(adminJs, "function isAllowedOrderStatus(status){", "async function loadAdminOrders(opts){");
  assert.ok(statuses && set && labels, "order helper declarations");
  return new Function(`
    function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
    ${statuses[0]};
    ${set[0]}
    ${labels[0]};
    ${counted}
    ${orderFns}
    return {
      COUNTED_ORDER_STATUSES, orderStatusKey, countsTowardOrderStats, orderStatsCount, orderStatsRevenue,
      ORDER_STATUSES, isAllowedOrderStatus, orderStatusLabel, shouldConfirmOrderStatus,
      orderUpdateSucceeded, isAal2OrderUpdateError, formatOrderUpdateError, aal2RequiredOrderUpdateMessage,
      aalUnknownOrderUpdateMessage, orderUpdateEmptyMessage, normalizeAdminAal, isAdminAal2, isBelowAal2,
      knownAdminAal, readAdminAalFromInspect, readAdminAalFromMfaResult, resolveAdminOrderAal,
      decideAdminOrderStatusUpdate, orderBelongsToStatusFilter, parseOrderItems, patchOrdersStatus, esc
    };
  `)();
}

const H = loadHelpers();

test("1 Orders section exists in desktop Admin navigation", () => {
  assert.match(adminHtml, /data-admin-section="orders">📦 زاكازلار/);
  assert.match(adminHtml, /class="admin-sidenav"/);
  assert.match(adminJs, /const ADMIN_SECTIONS=\["overview","books","storefront","import-covers","insights","customers","orders","system"\]/);
});

test("2 Orders section exists in the Admin section picker/mobile navigation", () => {
  assert.match(adminHtml, /<option value="orders">📦 زاكازلار<\/option>/);
  assert.match(adminHtml, /id="adminSectionSelect"/);
  assert.match(navSpec, /orders: "#orderManagement"/);
});

test("3 ADMIN_SECTIONS includes orders", () => {
  assert.ok(adminJs.includes('"orders"'));
  const parseStart = adminJs.match(/const ADMIN_SECTIONS=\[[^\]]+\]/);
  const def = adminJs.match(/const DEFAULT_ADMIN_SECTION="[^"]+"/);
  const fn = adminJs.match(/function parseAdminSectionHash\(hash\)\{[\s\S]*?\n\}/);
  const parse = new Function(`${parseStart[0]};${def[0]};${fn[0]};return parseAdminSectionHash;`)();
  assert.strictEqual(parse("#orders"), "orders");
  assert.strictEqual(parse("#books"), "books");
});

test("4 Admin order query includes required order fields and is bounded", () => {
  assert.match(adminJs, /const ADMIN_ORDER_SELECT="id,order_no,user_id,status,items,total,total_qty,customer_name,customer_phone,customer_city,customer_address,delivery_method,customer_note,created_at,updated_at"/);
  assert.match(adminJs, /const ADMIN_ORDER_PAGE_SIZE=40/);
  assert.match(adminJs, /db\.from\("orders"\)\.select\(ADMIN_ORDER_SELECT,\{count:"exact"\}\)\.range\(from,to\)/);
  assert.match(adminJs, /db\.from\("orders"\)\.select\("id,user_id,total,status,created_at"\)/);
  assert.doesNotMatch(adminJs, /from\("orders"\)\.select\("\*"\)/);
});

test("5 Prepared orders are visible by default", () => {
  assert.match(adminHtml, /<option value="all">بارلىق ھالەتلەر<\/option>/);
  assert.match(adminHtml, /<option value="prepared">تەييارلاندى<\/option>/);
  assert.doesNotMatch(adminJs, /neq\("status","prepared"\)/);
  assert.doesNotMatch(adminJs, /not\("status","eq","prepared"\)/);
  const load = sliceBetween(adminJs, "async function loadAdminOrders(opts){", "function renderAdminOrderPager(){");
  assert.doesNotMatch(load, /prepared/);
  assert.match(adminHtml, /تەييارلانغان زاكازلارمۇ بۇ يەردە كۆرۈنىدۇ/);
});

test("6 Search works for order_no, customer name, and phone", () => {
  assert.match(adminJs, /postgrestIlike\("order_no",term\)/);
  assert.match(adminJs, /postgrestIlike\("customer_name",term\)/);
  assert.match(adminJs, /postgrestIlike\("customer_phone",term\)/);
  assert.match(adminHtml, /id="adminOrderSearch"/);
});

test("7 Status filters work for all allowed statuses", () => {
  ["prepared", "confirmed", "processing", "shipped", "completed", "cancelled"].forEach((status) => {
    assert.match(adminHtml, new RegExp(`<option value="${status}">`));
    assert.ok(H.isAllowedOrderStatus(status));
  });
  assert.strictEqual(H.isAllowedOrderStatus("refunded"), false);
  assert.strictEqual(H.isAllowedOrderStatus("draft"), false);
  assert.match(adminJs, /query=query\.eq\("status",status\)/);
});

test("8 Order details safely render items, customer/contact, totals, note/address", () => {
  const detail = sliceBetween(adminJs, "function renderAdminOrderDetail(){", "function setAdminOrderStatusMsg(");
  ["customer_name", "customer_phone", "customer_city", "customer_address", "customer_note", "delivery_method", "total_qty", "order.total"].forEach((field) => {
    assert.match(detail, new RegExp(field.replace(".", "\\.")));
  });
  assert.match(detail, /esc\(order\.customer_address/);
  assert.match(detail, /esc\(order\.customer_note/);
  assert.match(detail, /esc\(item\.title\)/);
});

test("9 Old/malformed item snapshots fail gracefully", () => {
  assert.deepStrictEqual(H.parseOrderItems(null), []);
  assert.deepStrictEqual(H.parseOrderItems("not-json"), []);
  assert.deepStrictEqual(H.parseOrderItems({}), []);
  const rows = H.parseOrderItems([
    { title: "A", author: "B", qty: 2, price: 10, line_total: 20 },
    { book_id: 9, qty: "3", price: "5" },
    null,
    "x"
  ]);
  assert.strictEqual(rows[0].title, "A");
  assert.strictEqual(rows[1].title, 9);
  assert.strictEqual(rows[1].qty, 3);
  assert.strictEqual(rows[1].line_total, 15);
  assert.strictEqual(rows[2].title, "كىتاب");
  assert.strictEqual(rows[3].title, "كىتاب");
});

test("10 Status update only sends an allowed status", () => {
  assert.match(adminJs, /from\("orders"\)\.update\(\{status:nextStatus\}\)\.eq\("id",orderId\)/);
  assert.match(adminJs, /if\(!isAllowedOrderStatus\(nextStatus\)\)/);
  H.ORDER_STATUSES.forEach((status) => assert.ok(H.isAllowedOrderStatus(status)));
  assert.strictEqual(H.isAllowedOrderStatus("completed;drop"), false);
});

test("11 No order DELETE path is introduced", () => {
  assert.doesNotMatch(adminJs, /from\("orders"\)\.delete/);
  assert.doesNotMatch(adminHtml, /Delete Order|زاكازنى ئۆچۈرۈش/i);
  assert.doesNotMatch(adminJs, /removeOrder|deleteAdminOrder/);
});

test("12 Existing restrictive AAL2 order UPDATE protection remains intact", () => {
  assert.match(setup, /create policy "aal2 required to update orders" on public\.orders as restrictive for update to authenticated/);
  assert.match(stage2c, /CREATE POLICY "aal2 required to update orders"/);
  assert.doesNotMatch(adminJs, /STAGE80_MEMBER_ORDER_INTEGRITY/);
  assert.doesNotMatch(adminJs, /drop policy/i);
});

test("13 Failed/AAL2-blocked update shows a safe error and does not fake success", () => {
  assert.strictEqual(H.orderUpdateSucceeded(null, { message: "fail" }), false);
  assert.strictEqual(H.orderUpdateSucceeded([], null), false);
  assert.strictEqual(H.orderUpdateSucceeded([{ id: "1", status: "confirmed" }], null), true);
  assert.ok(H.isAal2OrderUpdateError({ code: "42501" }));
  assert.ok(H.isAal2OrderUpdateError({ message: "AAL2 required" }));
  assert.match(H.formatOrderUpdateError({ code: "42501" }), /AAL2/);
  assert.match(adminJs, /if\(!orderUpdateSucceeded\(data,error\)\)/);
  const save = sliceBetween(adminJs, "async function saveAdminOrderStatus(orderId){", "function setSaveMode(");
  assert.doesNotMatch(save, /adminOrderDetail=\{[^}]*status:nextStatus/);
  assert.doesNotMatch(save, /adminOrders=patchOrdersStatus/);
});

test("14 Existing counted-status semantics remain", () => {
  assert.deepStrictEqual([...H.COUNTED_ORDER_STATUSES].sort(), ["completed", "confirmed", "processing", "shipped"]);
});

test("15 prepared/cancelled remain excluded from revenue/order stats", () => {
  assert.strictEqual(H.countsTowardOrderStats({ status: "prepared", total: 999 }), false);
  assert.strictEqual(H.countsTowardOrderStats({ status: "cancelled", total: 999 }), false);
  assert.strictEqual(H.orderStatsCount([{ status: "prepared", total: 10 }, { status: "cancelled", total: 10 }, { status: "confirmed", total: 5 }]), 1);
  assert.strictEqual(H.orderStatsRevenue([{ status: "prepared", total: 10 }, { status: "completed", total: 7 }]), 7);
});

test("16 Updating status causes displayed statistics to stay consistent", () => {
  const list = [
    { id: "a", user_id: "m1", status: "prepared", total: 100 },
    { id: "b", user_id: "m1", status: "confirmed", total: 200 }
  ];
  assert.strictEqual(H.orderStatsCount(list), 1);
  const confirmed = H.patchOrdersStatus(list, "a", "confirmed");
  assert.strictEqual(H.orderStatsCount(confirmed), 2);
  assert.strictEqual(H.orderStatsRevenue(confirmed), 300);
  const cancelled = H.patchOrdersStatus(confirmed, "b", "cancelled");
  assert.strictEqual(H.orderStatsCount(cancelled), 1);
  assert.strictEqual(H.orderStatsRevenue(cancelled), 100);
  assert.match(adminJs, /orders=patchOrdersStatus\(orders,orderId,row\.status,row\.updated_at\)/);
  assert.match(adminJs, /renderMemberStats\(\)/);
  const save = sliceBetween(adminJs, "async function saveAdminOrderStatus(orderId){", "function setSaveMode(");
  assert.ok(save.indexOf("renderMemberStats()") < save.indexOf("loadAdminOrders({silent:true})"));
});

test("17 Customer data is escaped and not injected unsafely", () => {
  assert.strictEqual(H.esc('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
  assert.strictEqual(H.esc("a&b\"c'"), "a&amp;b&quot;c&#39;");
  const detail = sliceBetween(adminJs, "function renderAdminOrderDetail(){", "function setAdminOrderStatusMsg(");
  const list = sliceBetween(adminJs, "function renderAdminOrders(){", "function openAdminOrder(");
  ["customer_name", "customer_phone", "customer_city", "customer_address", "customer_note"].forEach((field) => {
    assert.match(detail, new RegExp(String.raw`esc\(order\.${field}`));
  });
  assert.match(list, /esc\(order\.customer_name/);
  assert.match(list, /esc\(order\.customer_phone/);
  assert.doesNotMatch(adminJs, /console\.(log|info|debug|warn)\([^)]*customer_address/);
  assert.doesNotMatch(adminJs, /console\.(log|info|debug|warn)\([^)]*customer_phone/);
  assert.doesNotMatch(adminJs, /console\.(log|info|debug|warn)\([^)]*customer_note/);
});

test("18 Existing Admin navigation/features still work", () => {
  assert.match(adminJs, /DEFAULT_ADMIN_SECTION="books"/);
  assert.match(adminHtml, /data-admin-section="books"/);
  assert.match(adminHtml, /id="booksCard"/);
  assert.match(adminHtml, /id="memberManagement"/);
  assert.match(adminCss, /\.admin-sidenav\{display:none\}/);
  assert.doesNotMatch(adminHtml, /KB-260905-8012/);
  assert.doesNotMatch(adminJs, /KB-260905-8012/);
});

test("cancellation confirms and does not delete the row", () => {
  assert.strictEqual(H.shouldConfirmOrderStatus("cancelled"), true);
  assert.strictEqual(H.shouldConfirmOrderStatus("confirmed"), false);
  assert.match(adminJs, /shouldConfirmOrderStatus\(nextStatus\)&&!confirm/);
  assert.doesNotMatch(adminJs, /from\("orders"\)\.delete/);
});

test("no SQL/RLS files were added for this Admin UI task", () => {
  assert.doesNotMatch(adminJs, /create policy/i);
  assert.doesNotMatch(adminJs, /grant insert on public\.orders/i);
  assert.match(adminJs, /if\(id==="orders"\)loadAdminOrders\(\)/);
});

function reloadFilteredOrders(store, { filter, search, page, pageSize, selectedId }) {
  const term = String(search || "").trim().toLowerCase();
  const filtered = store.filter((order) => {
    if (!H.orderBelongsToStatusFilter(order, filter)) return false;
    if (!term) return true;
    return [order.order_no, order.customer_name, order.customer_phone]
      .some((value) => String(value || "").toLowerCase().includes(term));
  });
  const total = filtered.length;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const pageClamped = Math.min(Math.max(0, page || 0), maxPage);
  const rows = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);
  const selected = selectedId ? rows.find((order) => String(order.id) === String(selectedId)) || null : null;
  return { rows, total, page: pageClamped, selected, pages: Math.max(1, Math.ceil(total / pageSize) || 1) };
}

function simulateStatusSave({ aal, store, orderId, nextStatus, filter, search, page, pageSize, updateData, updateError }) {
  const messages = [];
  let successShown = false;
  let updateCalled = false;
  const aalDecision = H.decideAdminOrderStatusUpdate(aal);
  if (!aalDecision.allowUpdate) {
    messages.push({ text: aalDecision.message, ok: false });
    return {
      ok: false,
      reason: aalDecision.reason,
      updateCalled,
      successShown,
      messages,
      view: reloadFilteredOrders(store, { filter, search, page, pageSize, selectedId: orderId })
    };
  }
  updateCalled = true;
  if (!H.orderUpdateSucceeded(updateData, updateError)) {
    messages.push({ text: H.formatOrderUpdateError(updateError), ok: false });
    return {
      ok: false,
      reason: "update_failed",
      updateCalled,
      successShown,
      messages,
      view: reloadFilteredOrders(store, { filter, search, page, pageSize, selectedId: orderId })
    };
  }
  const row = Array.isArray(updateData) ? updateData[0] : updateData;
  const idx = store.findIndex((order) => String(order.id) === String(orderId));
  if (idx >= 0) store[idx] = { ...store[idx], status: row.status, updated_at: row.updated_at };
  const view = reloadFilteredOrders(store, { filter, search, page, pageSize, selectedId: orderId });
  if (view.selected) {
    successShown = true;
    messages.push({ text: "ھالەت يېڭىلاندى.", ok: true });
  }
  return { ok: true, reason: "updated", updateCalled, successShown, messages, view };
}

test("prepared filter reloads after updating an order to confirmed", () => {
  const store = [
    { id: "1", status: "prepared", order_no: "KB-1", customer_name: "A", customer_phone: "1", total: 10 },
    { id: "2", status: "prepared", order_no: "KB-2", customer_name: "B", customer_phone: "2", total: 20 },
    { id: "3", status: "confirmed", order_no: "KB-3", customer_name: "C", customer_phone: "3", total: 30 }
  ];
  const before = reloadFilteredOrders(store, { filter: "prepared", page: 0, pageSize: 40, selectedId: "1" });
  assert.strictEqual(before.total, 2);
  assert.ok(before.rows.some((order) => order.id === "1"));
  assert.strictEqual(before.selected.id, "1");
  const result = simulateStatusSave({
    aal: "aal2",
    store,
    orderId: "1",
    nextStatus: "confirmed",
    filter: "prepared",
    page: 0,
    pageSize: 40,
    updateData: [{ id: "1", status: "confirmed", updated_at: "2026-09-05" }]
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updateCalled, true);
  assert.ok(!result.view.rows.some((order) => order.id === "1"));
  assert.strictEqual(result.view.total, 1);
  assert.strictEqual(result.view.selected, null);
  assert.strictEqual(result.successShown, false);
  const save = sliceBetween(adminJs, "async function saveAdminOrderStatus(orderId){", "function setSaveMode(");
  assert.match(save, /await loadAdminOrders\(\{silent:true\}\)/);
  assert.doesNotMatch(save, /adminOrders=patchOrdersStatus/);
  assert.match(adminJs, /const silent=!!\(opts&&opts.silent\);/);
  assert.match(adminJs, /if\(!silent\)host\.innerHTML=/);
});

test("status update compatible with the all filter stays visible with the new status", () => {
  const store = [
    { id: "1", status: "prepared", order_no: "KB-1", customer_name: "A", customer_phone: "1", total: 10 },
    { id: "2", status: "confirmed", order_no: "KB-2", customer_name: "B", customer_phone: "2", total: 20 }
  ];
  const result = simulateStatusSave({
    aal: "aal2",
    store,
    orderId: "1",
    nextStatus: "confirmed",
    filter: "all",
    page: 0,
    pageSize: 40,
    updateData: [{ id: "1", status: "confirmed", updated_at: "2026-09-05" }]
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.view.total, 2);
  assert.strictEqual(result.view.rows.find((order) => order.id === "1").status, "confirmed");
  assert.strictEqual(result.view.selected.status, "confirmed");
  assert.strictEqual(result.successShown, true);
  const stats = H.patchOrdersStatus(
    [{ id: "1", status: "prepared", total: 10 }, { id: "2", status: "confirmed", total: 20 }],
    "1",
    "confirmed"
  );
  assert.strictEqual(H.orderStatsCount(stats), 2);
});

test("current AAL1 shows a clear AAL2-required message and does not UPDATE", () => {
  assert.strictEqual(H.readAdminAalFromInspect({ assurance: { currentLevel: "aal1" } }), "aal1");
  assert.strictEqual(H.isBelowAal2("aal1"), true);
  const decision = H.decideAdminOrderStatusUpdate("aal1");
  assert.strictEqual(decision.allowUpdate, false);
  assert.strictEqual(decision.reason, "aal2_required");
  assert.match(decision.message, /2-باسقۇچلۇق دەلىللەش \(AAL2\)/);
  const result = simulateStatusSave({
    aal: "aal1",
    store: [{ id: "1", status: "prepared" }],
    orderId: "1",
    nextStatus: "confirmed",
    filter: "all",
    page: 0,
    pageSize: 40,
    updateData: [{ id: "1", status: "confirmed" }]
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.updateCalled, false);
  assert.strictEqual(result.successShown, false);
  assert.match(result.messages[0].text, /AAL2/);
  assert.strictEqual(result.messages[0].ok, false);
  const save = sliceBetween(adminJs, "async function saveAdminOrderStatus(orderId){", "function setSaveMode(");
  const readAal = sliceBetween(adminJs, "async function readCurrentAdminAal(){", "async function saveAdminOrderStatus(orderId){");
  assert.match(save, /const aal=await readCurrentAdminAal\(\)/);
  assert.match(readAal, /Mfa\.inspectAccess/);
  assert.match(readAal, /getAuthenticatorAssuranceLevel/);
  assert.ok(save.indexOf("decideAdminOrderStatusUpdate(aal)") < save.indexOf('.update({status:nextStatus})'));
  assert.match(save, /reason:aalDecision\.reason/);
  assert.match(adminJs, /typeof Mfa\.inspectAccess==="function"/);
  assert.match(adminJs, /getAuthenticatorAssuranceLevel/);
});

test("current AAL2 allows the normal UPDATE path to proceed", () => {
  assert.strictEqual(H.readAdminAalFromInspect({ assurance: { currentLevel: "aal2" } }), "aal2");
  assert.strictEqual(H.isAdminAal2("aal2"), true);
  const decision = H.decideAdminOrderStatusUpdate("aal2");
  assert.strictEqual(decision.allowUpdate, true);
  assert.strictEqual(decision.reason, "aal2");
  const result = simulateStatusSave({
    aal: "aal2",
    store: [{ id: "1", status: "prepared" }],
    orderId: "1",
    nextStatus: "confirmed",
    filter: "all",
    page: 0,
    pageSize: 40,
    updateData: [{ id: "1", status: "confirmed", updated_at: "2026-09-05" }]
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updateCalled, true);
  assert.strictEqual(result.successShown, true);
  const save = sliceBetween(adminJs, "async function saveAdminOrderStatus(orderId){", "function setSaveMode(");
  assert.match(save, /from\("orders"\)\.update\(\{status:nextStatus\}\)\.eq\("id",orderId\)/);
  assert.ok(save.indexOf("if(!aalDecision.allowUpdate)") < save.indexOf('.update({status:nextStatus})'));
});

test("unknown or empty AAL blocks UPDATE and does not send an orders UPDATE", () => {
  ["", null, undefined, "unknown", "aal3"].forEach((aal) => {
    const decision = H.decideAdminOrderStatusUpdate(aal);
    assert.strictEqual(decision.allowUpdate, false, String(aal));
    assert.strictEqual(decision.reason, "aal_unknown", String(aal));
    assert.strictEqual(decision.message, H.aalUnknownOrderUpdateMessage());
    assert.notStrictEqual(decision.message, H.aal2RequiredOrderUpdateMessage());
    const result = simulateStatusSave({
      aal,
      store: [{ id: "1", status: "prepared" }],
      orderId: "1",
      nextStatus: "confirmed",
      filter: "all",
      page: 0,
      pageSize: 40,
      updateData: [{ id: "1", status: "confirmed" }]
    });
    assert.strictEqual(result.ok, false, String(aal));
    assert.strictEqual(result.updateCalled, false, String(aal));
    assert.strictEqual(result.successShown, false, String(aal));
    assert.strictEqual(result.reason, "aal_unknown", String(aal));
    assert.match(result.messages[0].text, /تەكشۈرگىلى بولمىدى/);
    assert.doesNotMatch(result.messages[0].text, /AAL2\) كېرەك/);
  });
  const save = sliceBetween(adminJs, "async function saveAdminOrderStatus(orderId){", "function setSaveMode(");
  assert.ok(save.indexOf("if(!aalDecision.allowUpdate)") < save.indexOf('.update({status:nextStatus})'));
  assert.match(save, /reason:aalDecision\.reason/);
});

test("failed inspectAccess with a successful direct MFA fallback returning aal2 allows UPDATE", () => {
  assert.strictEqual(H.readAdminAalFromInspect({ assurance: { currentLevel: null } }), "");
  assert.strictEqual(H.readAdminAalFromInspect(null), "");
  assert.strictEqual(H.readAdminAalFromMfaResult({ data: { currentLevel: "aal2" }, error: null }), "aal2");
  const aal = H.resolveAdminOrderAal("", H.readAdminAalFromMfaResult({ data: { currentLevel: "aal2" } }));
  assert.strictEqual(aal, "aal2");
  const decision = H.decideAdminOrderStatusUpdate(aal);
  assert.strictEqual(decision.allowUpdate, true);
  assert.strictEqual(decision.reason, "aal2");
  const result = simulateStatusSave({
    aal,
    store: [{ id: "1", status: "prepared" }],
    orderId: "1",
    nextStatus: "confirmed",
    filter: "all",
    page: 0,
    pageSize: 40,
    updateData: [{ id: "1", status: "confirmed", updated_at: "2026-09-05" }]
  });
  assert.strictEqual(result.updateCalled, true);
  const readAal = sliceBetween(adminJs, "async function readCurrentAdminAal(){", "async function saveAdminOrderStatus(orderId){");
  assert.match(readAal, /Mfa\.inspectAccess/);
  assert.match(readAal, /getAuthenticatorAssuranceLevel/);
  assert.ok(readAal.indexOf("inspectAccess") < readAal.indexOf("getAuthenticatorAssuranceLevel"));
  assert.match(readAal, /if\(inspectAal\)return inspectAal;/);
  assert.doesNotMatch(readAal, /catch\(err\)\{\s*return ""/);
});

test("failed or unknown inspectAccess plus failed or unknown fallback is blocked with a safe unknown-AAL message", () => {
  assert.strictEqual(H.resolveAdminOrderAal("", ""), "");
  assert.strictEqual(H.readAdminAalFromMfaResult({ error: { message: "fail" }, data: { currentLevel: "aal2" } }), "");
  assert.strictEqual(H.readAdminAalFromMfaResult({ data: { currentLevel: null } }), "");
  assert.strictEqual(H.readAdminAalFromMfaResult(null), "");
  const decision = H.decideAdminOrderStatusUpdate(H.resolveAdminOrderAal("", ""));
  assert.strictEqual(decision.allowUpdate, false);
  assert.strictEqual(decision.reason, "aal_unknown");
  assert.strictEqual(decision.message, H.aalUnknownOrderUpdateMessage());
  assert.notStrictEqual(decision.message, H.aal2RequiredOrderUpdateMessage());
  const result = simulateStatusSave({
    aal: "",
    store: [{ id: "1", status: "prepared" }],
    orderId: "1",
    nextStatus: "confirmed",
    filter: "all",
    page: 0,
    pageSize: 40,
    updateData: [{ id: "1", status: "confirmed" }]
  });
  assert.strictEqual(result.updateCalled, false);
  assert.match(result.messages[0].text, /تەكشۈرگىلى بولمىدى/);
  assert.doesNotMatch(adminJs, /create policy/i);
});

test("empty/no-row non-AAL2 failure is handled safely without success or an AAL2 label", () => {
  assert.strictEqual(H.orderUpdateSucceeded([], null), false);
  assert.strictEqual(H.orderUpdateSucceeded(null, null), false);
  assert.strictEqual(H.isAal2OrderUpdateError(null), false);
  assert.strictEqual(H.isAal2OrderUpdateError({ message: "ئۆزگەرتىش يېزىلمىدى" }), false);
  assert.strictEqual(H.formatOrderUpdateError(null), H.orderUpdateEmptyMessage());
  assert.doesNotMatch(H.formatOrderUpdateError(null), /AAL2/);
  const result = simulateStatusSave({
    aal: "aal2",
    store: [{ id: "1", status: "prepared" }],
    orderId: "1",
    nextStatus: "confirmed",
    filter: "all",
    page: 0,
    pageSize: 40,
    updateData: [],
    updateError: null
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.updateCalled, true);
  assert.strictEqual(result.successShown, false);
  assert.strictEqual(result.messages[0].ok, false);
  assert.doesNotMatch(result.messages[0].text, /AAL2/);
  assert.match(result.messages[0].text, /ئۆزگەرتىش يېزىلمىدى/);
  assert.strictEqual(result.view.rows[0].status, "prepared");
  const save = sliceBetween(adminJs, "async function saveAdminOrderStatus(orderId){", "function setSaveMode(");
  const failBlock = save.split("if(!orderUpdateSucceeded(data,error))")[1].split("const row=")[0];
  assert.match(failBlock, /setAdminOrderStatusMsg\(formatOrderUpdateError\(error\),false\)/);
  assert.doesNotMatch(failBlock, /ھالەت يېڭىلاندى/);
  assert.doesNotMatch(failBlock, /loadAdminOrders/);
  assert.ok(save.indexOf("ھالەت يېڭىلاندى") > save.indexOf("orderUpdateSucceeded(data,error)"));
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("admin-order-management-tests ok");
