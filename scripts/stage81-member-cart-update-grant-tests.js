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
    console.error("FAIL", name, err.message);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const sql = read("STAGE81_MEMBER_CART_UPDATE_GRANT.sql");
const setup = read("SUPABASE_SETUP.sql");
const member = read("member.js");
const pkg = read("package.json");
const workflow = read(".github/workflows/stage10-regression.yml");
const shop = read("shop.js");
const adminJs = read("admin.js");

test("authenticated cart UPDATE grant is present in migration and setup SQL", () => {
  assert.match(sql, /GRANT UPDATE ON public\.member_cart_items TO authenticated;/i);
  assert.match(setup, /grant select,insert,update,delete on public\.member_cart_items to authenticated;/i);
  assert.doesNotMatch(setup, /grant select,insert,delete on public\.member_cart_items to authenticated;/i);
});

test("Stage 81 only grants member_cart_items UPDATE", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  const code = sql.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
  const grantLines = sql.split("\n").filter((line) => /^\s*GRANT\s+/i.test(line));
  assert.strictEqual(grantLines.length, 1, "Stage 81 must contain exactly one GRANT statement");
  assert.match(grantLines[0], /GRANT UPDATE ON public\.member_cart_items TO authenticated;/i);
  assert.doesNotMatch(code, /member_favorites/i);
  assert.doesNotMatch(code, /public\.orders/i);
  assert.doesNotMatch(code, /is_kutadgu_admin/i);
  assert.doesNotMatch(code, /GRANT UPDATE ON public\.member_favorites/i);
});

test("Stage 81 does not loosen or recreate cart RLS", () => {
  assert.doesNotMatch(sql, /DROP POLICY/i);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /ALTER POLICY/i);
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.is_member_active/i);
  assert.match(sql, /cart owner access/);
  assert.match(sql, /will not recreate or loosen RLS/);
  const cartPolicy = setup.match(/create policy "cart owner access" on public\.member_cart_items[\s\S]*?;/);
  assert.ok(cartPolicy, "setup still has cart owner access");
  assert.match(cartPolicy[0], /for all to authenticated/);
  assert.match(cartPolicy[0], /using \(user_id = auth\.uid\(\) and public\.is_member_active\(\)\)/);
  assert.match(cartPolicy[0], /with check \(user_id = auth\.uid\(\) and public\.is_member_active\(\)\)/);
});

test("favorites, orders, and Admin privileges are unchanged by Stage 81", () => {
  assert.match(setup, /grant select,insert,delete on public\.member_favorites to authenticated;/);
  assert.doesNotMatch(setup, /grant select,insert,update,delete on public\.member_favorites to authenticated;/);
  assert.match(setup, /grant select,update on public\.orders to authenticated;/);
  assert.match(setup, /revoke insert on public\.orders from authenticated;/);
  assert.doesNotMatch(sql, /GRANT SELECT,INSERT,DELETE ON public\.member_favorites/i);
  assert.doesNotMatch(sql, /GRANT SELECT,UPDATE ON public\.orders/i);
});

test("migration is review-only and does not rewrite cart rows", () => {
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\.member_cart_items\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.member_cart_items\b/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\.member_cart_items\b/i);
  assert.doesNotMatch(pkg, /STAGE81_MEMBER_CART_UPDATE_GRANT/);
  assert.doesNotMatch(workflow, /STAGE81_MEMBER_CART_UPDATE_GRANT/);
  assert.doesNotMatch(workflow, /\bpsql\b/);
  assert.doesNotMatch(member, /STAGE81_MEMBER_CART_UPDATE_GRANT/);
  assert.doesNotMatch(shop, /STAGE81_MEMBER_CART_UPDATE_GRANT/);
  assert.doesNotMatch(adminJs, /STAGE81_MEMBER_CART_UPDATE_GRANT/);
  assert.doesNotMatch(pkg, /\bpsql\b/);
});

test("member.js quantity path uses pinned UPDATE rather than delete-insert", () => {
  const replaceCart = member.slice(
    member.indexOf("async function replaceCart("),
    member.indexOf("let mergedForUserId=")
  );
  assert.match(replaceCart, /\.update\(\{quantity:row\.qty\}\)\.eq\("user_id",uid\)\.eq\("book_id",row\.id\)/);
  assert.doesNotMatch(replaceCart, /replace-cart-qty-delete/);
  assert.doesNotMatch(replaceCart, /replace-cart-qty-insert/);
  assert.doesNotMatch(replaceCart, /\.update\(\{quantity:[^}]+\}\)(?!\.eq\("user_id",uid\)\.eq\("book_id",row\.id\))/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("stage81-member-cart-update-grant-tests ok");
