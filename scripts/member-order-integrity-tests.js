#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log("PASS", name);
    }).catch((err) => {
      failed++;
      console.error("FAIL", name, err && err.message);
    });
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function functionBody(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`create or replace function ${escaped}\([\s\S]*?\$\$;`,
    "i"
  ));
  assert.ok(match, "missing function " + name);
  return match[0];
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const sql = read("STAGE80_MEMBER_ORDER_INTEGRITY.sql");
const setup = read("SUPABASE_SETUP.sql");
const member = read("member.js");
const shop = read("shop.js");
const admin = read("admin.js");
const pkg = read("package.json");
const workflow = read(".github/workflows/stage10-regression.yml");
const helpers = read("tests/e2e/helpers.js");
const e2e = read("tests/e2e/order-prepared-semantics.spec.js");
const preparedTests = read("scripts/order-prepared-semantics-tests.js");

const sqlFn = functionBody(sql, "public.create_member_order");
const setupFn = functionBody(setup, "public.create_member_order");

function assertRpcAuthority(fn) {
  assert.match(fn, /security definer/i);
  assert.match(fn, /set search_path = public/i);
  assert.match(fn, /v_uid := auth\.uid\(\)/i);
  assert.match(fn, /if v_uid is null then/i);
  assert.match(fn, /public\.is_member_active\(\)/i);
  assert.doesNotMatch(fn, /p_user_id/);
  assert.doesNotMatch(fn, /p_status/);
  assert.doesNotMatch(fn, /p_total\b/);
  assert.doesNotMatch(fn, /p_total_qty/);
  assert.match(fn, /'prepared'/);
  assert.match(fn, /v_uid,\s*'prepared'/);
  assert.match(fn, /from public\.books/i);
  assert.match(fn, /v_book\.price \* v_qty/);
  assert.match(fn, /v_total_qty := v_total_qty \+ v_qty/);
  assert.match(fn, /raise exception 'empty_items'/i);
  assert.match(fn, /raise exception 'invalid_quantity'/i);
  assert.match(fn, /raise exception 'too_many_items'/i);
  assert.match(fn, /raise exception 'book_not_found'/i);
  assert.match(fn, /raise exception 'book_inactive'/i);
  assert.match(fn, /raise exception 'invalid_book_price'/i);
  assert.match(fn, /v_book\.is_active is not true/i);
  assert.doesNotMatch(fn, /v_elem\s*->>\s*'price'/);
  assert.doesNotMatch(fn, /v_elem\s*->>\s*'title'/);
  assert.doesNotMatch(fn, /execute\s+/i);
  assert.doesNotMatch(fn, /format\s*\(/i);
}

function loadSaveOrder(overrides) {
  const ctx = {
    db: {
      async rpc(name, args) {
        ctx.rpcCalls.push({ name, args });
        if (ctx.rpcError) return { data: null, error: ctx.rpcError };
        return { data: [ctx.rpcRow], error: null };
      }
    },
    user: { id: "auth-user-1" },
    blocked: false,
    rpcCalls: [],
    rpcError: null,
    rpcRow: {
      id: "ord-1",
      status: "prepared",
      user_id: "auth-user-1",
      total: 20,
      total_qty: 2,
      items: [{ book_id: 101, title: "Canonical", qty: 2, price: 10 }]
    }
  };
  Object.assign(ctx, overrides);
  const src = sliceBetween(member, "async function saveOrder(order){", "\nconst api=window.KutadguMember=");
  const saveOrder = new Function("ctx", `
    const db = ctx.db;
    const user = ctx.user;
    const blocked = ctx.blocked;
    ${src}
    return saveOrder;
  `)(ctx);
  return { ctx, saveOrder };
}

async function run() {
  await test("A member.js no longer performs direct orders.insert", () => {
    assert.doesNotMatch(member, /from\("orders"\)\.insert/);
    assert.doesNotMatch(member, /from\('orders'\)\.insert/);
  });

  await test("B member save path uses create_member_order RPC", async () => {
    assert.match(member, /db\.rpc\("create_member_order"/);
    const { ctx, saveOrder } = loadSaveOrder();
    const result = await saveOrder({
      orderId: "KB-250905-1234",
      total: 999999,
      totalQty: 5000,
      items: [{ book_id: "101", title: "Forged", price: 999999, qty: 2, line_total: 1999998 }],
      customer: { name: "Aygul", phone: "555", city: "Istanbul", address: "St 1", delivery: "cargo", note: "hi" }
    });
    assert.equal(ctx.rpcCalls.length, 1);
    assert.equal(ctx.rpcCalls[0].name, "create_member_order");
    assert.equal(result.saved, true);
    assert.equal(result.order.status, "prepared");
  });

  await test("C member cannot choose persisted status; RPC args omit status/user_id/totals", async () => {
    const { ctx, saveOrder } = loadSaveOrder();
    await saveOrder({
      orderId: "KB-250905-1234",
      status: "completed",
      user_id: "attacker",
      total: 999999,
      totalQty: 5000,
      items: [{ book_id: 7, qty: 1, price: 50, title: "Client title" }]
    });
    const args = ctx.rpcCalls[0].args;
    assert.equal(args.p_order_no, "KB-250905-1234");
    assert.deepStrictEqual(args.p_items, [{ book_id: 7, qty: 1 }]);
    assert.strictEqual(args.p_status, undefined);
    assert.strictEqual(args.p_user_id, undefined);
    assert.strictEqual(args.p_total, undefined);
    assert.strictEqual(args.p_total_qty, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(args, "status"));
    assert.ok(!Object.prototype.hasOwnProperty.call(args, "user_id"));
    assert.ok(!("price" in args.p_items[0]));
    assert.ok(!("title" in args.p_items[0]));
  });

  await test("D SQL user_id comes from auth.uid(), never client input", () => {
    [sqlFn, setupFn].forEach(assertRpcAuthority);
    [sqlFn, setupFn].forEach((fn) => {
      assert.match(fn, /v_uid,\s*'prepared'/);
      assert.doesNotMatch(fn, /user_id\s*,\s*p_/i);
    });
  });

  await test("E SQL total and total_qty are derived from public.books", () => {
    [sqlFn, setupFn].forEach((fn) => {
      assert.match(fn, /v_line_total := round\(v_book\.price \* v_qty, 2\)/);
      assert.match(fn, /v_total := v_total \+ v_line_total/);
      assert.match(fn, /v_total_qty := v_total_qty \+ v_qty/);
      assert.match(fn, /jsonb_build_object\(\s*'book_id', v_book\.id/);
      assert.match(fn, /'price', v_book\.price/);
    });
  });

  await test("F authenticated INSERT is revoked and member INSERT policy is dropped", () => {
    assert.match(sql, /REVOKE INSERT ON public\.orders FROM authenticated/i);
    assert.match(sql, /REVOKE INSERT ON public\.orders FROM anon/i);
    assert.match(sql, /REVOKE INSERT ON public\.orders FROM PUBLIC/i);
    assert.match(sql, /DROP POLICY IF EXISTS "member can create own orders" ON public\.orders/i);
    assert.doesNotMatch(sql, /CREATE POLICY "member can create own orders"/i);
    assert.doesNotMatch(setup, /create policy "member can create own orders"/i);
    assert.match(setup, /drop policy if exists "member can create own orders" on public\.orders/);
    assert.match(setup, /revoke insert on public\.orders from authenticated/);
    assert.match(setup, /grant select,update on public\.orders to authenticated/);
    assert.doesNotMatch(setup, /grant select,insert,update on public\.orders to authenticated/);
    assert.match(sql, /GRANT SELECT, UPDATE ON public\.orders TO authenticated/i);
    assert.doesNotMatch(sql, /GRANT INSERT ON public\.orders/i);
  });

  await test("G malformed, empty, and invalid quantities are rejected in SQL", () => {
    [sqlFn, setupFn].forEach((fn) => {
      assert.match(fn, /jsonb_typeof\(p_items\) is distinct from 'array'/i);
      assert.match(fn, /if v_n < 1 then/i);
      assert.match(fn, /if v_n > 50 then/i);
      assert.match(fn, /if v_qty is null or v_qty < 1 or v_qty > 99 then/i);
      assert.match(fn, /raise exception 'quantity_too_large'/i);
      assert.match(fn, /raise exception 'invalid_book_id'/i);
    });
  });

  await test("H nonexistent/inactive books cannot become trusted order items", () => {
    [sqlFn, setupFn].forEach((fn) => {
      assert.match(fn, /raise exception 'book_not_found'/i);
      assert.match(fn, /raise exception 'book_inactive'/i);
      assert.match(fn, /where public\.books\.id = v_book_id/i);
    });
  });

  await test("I item prices come from public.books rather than client values", () => {
    [sqlFn, setupFn].forEach((fn) => {
      assert.match(fn, /from public\.books/i);
      assert.doesNotMatch(fn, /v_elem ->> 'price'/);
      assert.doesNotMatch(fn, /v_elem -> 'price'/);
      assert.match(fn, /if v_book\.price is null or v_book\.price < 0 then/i);
      assert.match(fn, /'price', v_book\.price/);
    });
  });

  await test("SECURITY DEFINER hygiene: search_path, revoke public/anon, grant authenticated only", () => {
    [sql, setup].forEach((src) => {
      assert.match(src, /revoke all on function public\.create_member_order\(text, jsonb, text, text, text, text, text, text\) from public/i);
      assert.match(src, /revoke execute on function public\.create_member_order\(text, jsonb, text, text, text, text, text, text\) from anon/i);
      assert.match(src, /grant execute on function public\.create_member_order\(text, jsonb, text, text, text, text, text, text\) to authenticated/i);
    });
    assert.doesNotMatch(sqlFn, /to anon/i);
    assert.doesNotMatch(sql, /service_role/);
    assert.doesNotMatch(member, /service_role/);
    assert.doesNotMatch(member, /serviceRole/);
    assert.doesNotMatch(shop, /service_role/);
  });

  await test("migration is review-only and does not rewrite existing orders", () => {
    assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
    assert.match(sql, /Does NOT delete, rewrite, backfill, or change existing orders/);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql, /DROP TABLE/i);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\.orders\b/i);
    assert.doesNotMatch(sql, /\bUPDATE\s+public\.orders\b/i);
    assert.doesNotMatch(pkg, /STAGE80_MEMBER_ORDER_INTEGRITY/);
    assert.doesNotMatch(workflow, /STAGE80_MEMBER_ORDER_INTEGRITY/);
    assert.doesNotMatch(workflow, /\bpsql\b/);
    assert.doesNotMatch(member, /STAGE80_MEMBER_ORDER_INTEGRITY/);
  });

  await test("order_no is validated and is not financial authority", () => {
    [sqlFn, setupFn].forEach((fn) => {
      assert.match(fn, /\^KB-\[0-9\]\{6\}-\[0-9\]\{4\}\$/);
      assert.match(shop, /function makeOrderId\(\)\{/);
      assert.match(shop, /return `KB-\$\{y\}\$\{m\}\$\{d\}-\$\{r\}`/);
    });
  });

  await test("J WhatsApp-first semantics remain the only member history save path", () => {
    assert.match(shop, /async function orderWithWhatsApp\(\)\{/);
    assert.match(shop, /await savePreparedOrderHistory\(o\)/);
    assert.match(shop, /const persist=\(async\(\)=>\{/);
    assert.match(shop, /member\?\.saveOrder\?\.\(order\)/);
    const previewFn = sliceBetween(shop, "async function showOrderPreview(){", "async function copyOrder(){");
    const copyFn = sliceBetween(shop, "async function copyOrder(){", "async function shareOrder(){");
    const shareFn = sliceBetween(shop, "async function shareOrder(){", "function whatsappOrderUrl(text){");
    const waFn = sliceBetween(shop, "async function orderWithWhatsApp(){", "function setupCheckout(){");
    [previewFn, copyFn, shareFn].forEach((fn) => {
      assert.doesNotMatch(fn, /saveOrder/);
      assert.doesNotMatch(fn, /savePreparedOrderHistory/);
    });
    assert.match(waFn, /savePreparedOrderHistory/);
    assert.match(preparedTests, /preview\/copy\/share source never persist order history/);
    assert.match(preparedTests, /A Prepare Order is client preview only/);
    assert.match(preparedTests, /F guest WhatsApp works without saveOrder persistence/);
    assert.match(e2e, /rest\/v1\/rpc\/create_member_order/);
    assert.match(e2e, /prepare\/copy\/share do not POST orders/);
    assert.match(helpers, /rpc\\\/create_member_order/);
  });

  await test("K Admin counted-status semantics remain intact", () => {
    assert.match(admin, /const COUNTED_ORDER_STATUSES=new Set\(\["confirmed","processing","shipped","completed"\]\)/);
    assert.match(preparedTests, /G Admin stats count only confirmed\/processing\/shipped\/completed/);
    assert.doesNotMatch(admin, /create_member_order/);
  });

  await test("guest and suspended members never reach the RPC", async () => {
    const guest = loadSaveOrder({ user: null });
    const guestResult = await guest.saveOrder({ orderId: "KB-250905-1234", items: [{ book_id: 1, qty: 1 }] });
    assert.deepStrictEqual(guestResult, { saved: false, reason: "not_signed_in" });
    assert.equal(guest.ctx.rpcCalls.length, 0);

    const blocked = loadSaveOrder({ blocked: true });
    const blockedResult = await blocked.saveOrder({ orderId: "KB-250905-1234", items: [{ book_id: 1, qty: 1 }] });
    assert.deepStrictEqual(blockedResult, { saved: false, reason: "suspended" });
    assert.equal(blocked.ctx.rpcCalls.length, 0);
  });

  await test("Admin AAL2 order UPDATE policy is unchanged", () => {
    assert.match(setup, /create policy "aal2 required to update orders" on public\.orders as restrictive for update to authenticated using \(\(select auth\.jwt\(\)->>'aal'\) = 'aal2'\) with check \(\(select auth\.jwt\(\)->>'aal'\) = 'aal2'\)/);
    assert.match(setup, /create policy "admin can update orders" on public\.orders for update to authenticated\nusing \(public\.is_kutadgu_admin\(\)\) with check \(public\.is_kutadgu_admin\(\)\)/);
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("member-order-integrity-tests ok");
}

run();
