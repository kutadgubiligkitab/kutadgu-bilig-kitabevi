#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
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

const stage83 = read("STAGE83_STOCK_ENFORCEMENT.sql");
const stage84 = read("STAGE84_ORDER_NUMBER_FORMAT.sql");
const setup = read("SUPABASE_SETUP.sql");
const stage80 = read("STAGE80_MEMBER_ORDER_INTEGRITY.sql");
const pkg = read("package.json");
const workflow = read(".github/workflows/stage10-regression.yml");
const shop = read("shop.js");
const member = read("member.js");

const POST_CHECK_MARK = "-- READ-ONLY POST-CHECK (manual). Do NOT run as part of apply.";
const apply = stage84.split(POST_CHECK_MARK)[0];
const checks = stage84.split(POST_CHECK_MARK)[1] || "";
const stage83Fn = functionBody(stage83, "public.create_member_order");
const stage84Fn = functionBody(stage84, "public.create_member_order");
const setupFn = functionBody(setup, "public.create_member_order");

const DUAL = "^KB-[0-9]{6}-([0-9]{4}|[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8})$";
const DUAL_SRC = /\^KB-\[0-9\]\{6\}-\(\[0-9\]\{4\}\|\[23456789ABCDEFGHJKLMNPQRSTUVWXYZ\]\{8\}\)\$/;
const OLD_ONLY = /\^KB-\[0-9\]\{6\}-\[0-9\]\{4\}\$/;
const ORDER_NO_RE = new RegExp(DUAL);

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

function maskOrderNo(fn) {
  return fn.replace(/v_order_no\s*!~\s*'[^']+'/gi, "v_order_no !~ '<ORDER_NO>'");
}

test("manual reviewed apply only and is not executed from CI", () => {
  assert.match(stage84, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(stage84, /Production preflight/);
  assert.match(apply, /^BEGIN;/m);
  assert.match(apply, /^COMMIT;/m);
  assert.ok(apply.indexOf("BEGIN;") < apply.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.ok(apply.indexOf("CREATE OR REPLACE FUNCTION") < apply.indexOf("COMMIT;"));
  assert.doesNotMatch(pkg, /STAGE84_ORDER_NUMBER_FORMAT/);
  assert.doesNotMatch(workflow, /STAGE84_ORDER_NUMBER_FORMAT/);
  assert.doesNotMatch(workflow, /\bpsql\b/);
  assert.doesNotMatch(apply, /\bTRUNCATE\b/i);
  assert.doesNotMatch(apply, /DROP TABLE/i);
  assert.doesNotMatch(apply, /DROP FUNCTION/i);
  assert.doesNotMatch(apply, /DROP POLICY/i);
  assert.doesNotMatch(apply, /CREATE POLICY/i);
});

test("Stage 84 accepts historical 4-digit and new 8-char order numbers", () => {
  assert.match(stage84Fn, DUAL_SRC);
  assert.match(setupFn, DUAL_SRC);
  assert.match(stage83Fn, OLD_ONLY);
  assert.doesNotMatch(stage83Fn, /\[23456789ABCDEFGHJKLMNPQRSTUVWXYZ\]\{8\}/);
  assert.match(stage80, OLD_ONLY);

  const accept = [
    "KB-250905-1234",
    "KB-250905-0001",
    "KB-260906-23456789",
    "KB-260906-ABCDEFGH",
    "KB-260906-2A3B4C5D"
  ];
  const reject = [
    "",
    "KB-260906-123",
    "KB-260906-12345",
    "KB-260906-ABCDEFG",
    "KB-260906-ABCDEFGHI",
    "KB-260906-ABCD0EFG",
    "KB-260906-ABCDOEFG",
    "KB-260906-ABCD1EFG",
    "KB-260906-ABCDIEFG",
    "kb-260906-ABCDEFGH",
    "KB-260906-abcdefgh",
    "KB-260906-ABCD-EFGH",
    "XX-260906-1234"
  ];
  accept.forEach((id) => {
    assert.ok(ORDER_NO_RE.test(id), "should accept " + id);
  });
  reject.forEach((id) => {
    assert.ok(!ORDER_NO_RE.test(id), "should reject " + id);
  });
});

test("Stage 84 replacement keeps Stage 83 security and business logic", () => {
  assert.strictEqual(maskOrderNo(stage84Fn), maskOrderNo(stage83Fn));
  [stage84Fn, setupFn].forEach((fn) => {
    assert.match(fn, /SECURITY DEFINER/i);
    assert.match(fn, /SET search_path = public/i);
    assert.match(fn, /v_uid := auth\.uid\(\)/i);
    assert.match(fn, /public\.is_member_active\(\)/i);
    assert.match(fn, /'prepared'/);
    assert.match(fn, /insufficient_stock/);
    assert.match(fn, /v_book\.stock < v_qty/);
    assert.match(fn, /stock_unconfigured/);
    assert.match(fn, /from public\.books/i);
    assert.match(fn, /v_book\.price \* v_qty/);
    assert.doesNotMatch(fn, /kutadgu_apply_order_stock_delta/);
    assert.doesNotMatch(fn, /stock\s*=\s*stock\s*-/);
    assert.doesNotMatch(fn, /p_user_id/);
    assert.doesNotMatch(fn, /p_status/);
    assert.doesNotMatch(fn, /makeOrderId/);
  });
});

test("Stage 84 does not widen RLS, grants, triggers, or schema", () => {
  const body = apply.slice(apply.indexOf("BEGIN;"), apply.lastIndexOf("COMMIT;") + "COMMIT;".length);
  assert.doesNotMatch(body, /^\s*GRANT\b/im);
  assert.doesNotMatch(body, /^\s*REVOKE\b/im);
  assert.doesNotMatch(body, /^\s*ALTER TABLE\b/im);
  assert.doesNotMatch(body, /CREATE UNIQUE/i);
  assert.doesNotMatch(body, /DROP INDEX/i);
  assert.doesNotMatch(body, /CREATE TRIGGER/i);
  assert.doesNotMatch(body, /DROP TRIGGER/i);
  assert.doesNotMatch(body, /CREATE POLICY/i);
  assert.doesNotMatch(body, /ALTER POLICY/i);
  assert.doesNotMatch(body, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(body, /\bUPDATE\s+public\.orders\b/i);
  assert.doesNotMatch(body, /\bDELETE\s+FROM\s+public\.orders\b/i);
  assert.match(checks, /prosecdef/);
  assert.match(checks, /search_path/);
  assert.match(checks, /authenticated/);
  assert.match(checks, /anon/);
  assert.match(checks, /PUBLIC/);
  assert.match(checks, /UNIQUE/);
  assert.match(checks, /books = 8, orders = 4/);
  assert.match(checks, /Do not INSERT\/UPDATE\/DELETE/);
});

test("frontend still reuses one prepared ID and passes it to the RPC", () => {
  assert.match(shop, /if\(preparedOrder&&preparedOrderSignature===signature\)return preparedOrder/);
  assert.match(member, /p_order_no:String\(order\.orderId\|\|""\)\.trim\(\)/);
  assert.match(shop, /ORDER_NO_ALPHABET="23456789ABCDEFGHJKLMNPQRSTUVWXYZ"/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("All Stage 84 order-number format tests passed");
