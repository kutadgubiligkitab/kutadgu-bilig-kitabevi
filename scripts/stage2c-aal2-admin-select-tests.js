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

const sql = read("STAGE2C_AAL2_ADMIN_SELECT_RLS.sql");
const writeRepair = read("STAGE2C_AAL2_RESTRICTIVE_REPAIR.sql");
const setup = read("SUPABASE_SETUP.sql");
const stage2b = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");
const stage8 = read("STAGE8_STORE_ANALYTICS.sql");
const stage91 = read("STAGE91_ADMIN_IMPORT_SCALE.sql");
const member = read("member.js");
const resetJs = read("reset-password.js");
const adminJs = read("admin.js");
const adminMfa = read("admin-mfa.js");

const JWT_AAL2 = String.raw`\(select auth\.jwt\(\)->>'aal'\) = 'aal2'`;
const ADMIN_AND_AAL2 = String.raw`public\.is_kutadgu_admin\(\)\s*AND \(select auth\.jwt\(\)->>'aal'\) = 'aal2'`;

function policyBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`create policy "?${escaped}"?[\s\S]*?(?=drop policy|create policy|create or replace|revoke |grant |begin;|commit;|do \$\$|--)`,
    "i"
  ));
  assert.ok(match, "missing policy " + name);
  return match[0];
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

function rlsAllows(policies, ctx) {
  const applicable = policies.filter((p) => p.cmd === ctx.cmd);
  const permissive = applicable.filter((p) => p.permissive);
  const restrictive = applicable.filter((p) => !p.permissive);
  if (!permissive.length) return false;
  return permissive.some((p) => p.check(ctx)) && restrictive.every((p) => p.check(ctx));
}

function adminSelectUsing(ctx) {
  return ctx.isAdmin === true && ctx.aal === "aal2";
}

test("read-path SQL is reviewed-only and does not rewrite rows, writes, or PR #133 policies", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\s+public\.(books|orders|profiles)\b/i);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "aal2 required to update books"/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "aal2 required to update orders"/);
  assert.doesNotMatch(sql, /CREATE POLICY "aal2 required to/);
  assert.doesNotMatch(sql, /AS RESTRICTIVE/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.is_kutadgu_admin/i);
  assert.doesNotMatch(sql, /create_member_order/i);
  assert.match(writeRepair, /AS RESTRICTIVE FOR UPDATE TO authenticated/);
});

test("Admin SELECT policies require Admin AND AAL2; they are not table-wide RESTRICTIVE", () => {
  [
    "admin can read all profiles",
    "admin can read all orders",
    "admin can read analytics",
    "admin can read all books",
    "store_announcements_select_admin",
    "store_hero_settings_select_admin",
    "store_hero_store_slides_select_admin",
    "store_hero_campaigns_select_admin"
  ].forEach((name) => {
    const block = policyBlock(sql, name);
    assert.match(block, /FOR SELECT/i);
    assert.match(block, /TO authenticated/i);
    assert.doesNotMatch(block, /TO anon/i);
    assert.doesNotMatch(block, /AS RESTRICTIVE/i);
    assert.match(block, new RegExp(ADMIN_AND_AAL2, "i"));
  });
  assert.match(setup, new RegExp(
    String.raw`create policy "admin can read all profiles" on public\.profiles for select to authenticated using \(public\.is_kutadgu_admin\(\) and ` + JWT_AAL2 + String.raw`\)`
  ));
  assert.match(setup, new RegExp(
    String.raw`create policy "admin can read all orders" on public\.orders for select to authenticated using \(public\.is_kutadgu_admin\(\) and ` + JWT_AAL2 + String.raw`\)`
  ));
  assert.match(setup, new RegExp(
    String.raw`create policy "admin can read analytics" on public\.analytics_events for select to authenticated using \(public\.is_kutadgu_admin\(\) and ` + JWT_AAL2 + String.raw`\)`
  ));
  const books = policyBlock(stage2b, "admin can read all books");
  assert.match(books, new RegExp(ADMIN_AND_AAL2, "i"));
});

test("public storefront SELECT policies stay without AAL2", () => {
  const announce = read("SITE_ANNOUNCEMENT_BAR.sql");
  const hero = read("SITE_HERO_MANAGEMENT.sql");
  [
    policyBlock(announce, "store_announcements_select_public"),
    policyBlock(announce, "store_announcement_settings_select_public"),
    policyBlock(hero, "store_hero_settings_select_public"),
    policyBlock(hero, "store_hero_store_slides_select_public"),
    policyBlock(hero, "store_hero_campaigns_select_public")
  ].forEach((block) => {
    assert.match(block, /TO anon, authenticated/i);
    assert.doesNotMatch(block, /aal2/i);
    assert.doesNotMatch(block, /is_kutadgu_admin/i);
  });
  assert.match(policyBlock(announce, "store_announcements_select_admin"), new RegExp(ADMIN_AND_AAL2, "i"));
  assert.match(policyBlock(hero, "store_hero_campaigns_select_admin"), new RegExp(ADMIN_AND_AAL2, "i"));
});

test("member/public SELECT and admin_users pre-MFA SELECT stay AAL1", () => {
  assert.match(setup, /create policy "member can read own profile" on public\.profiles for select to authenticated using \(id = auth\.uid\(\)\)/);
  assert.match(setup, /create policy "member can read own orders" on public\.orders for select to authenticated using \(user_id = auth\.uid\(\)\)/);
  assert.match(setup, /create policy "public can read active books" on public\.books for select to anon,authenticated using \(is_active = true\)/);
  assert.match(setup, /create policy "admin can read own admin row" on public\.admin_users for select to authenticated using \(user_id = auth\.uid\(\)\)/);
  const ownAdmin = policyBlock(setup, "admin can read own admin row");
  const ownProfile = policyBlock(setup, "member can read own profile");
  const ownOrders = policyBlock(setup, "member can read own orders");
  const publicBooks = policyBlock(setup, "public can read active books");
  [ownAdmin, ownProfile, ownOrders, publicBooks].forEach((block) => {
    assert.doesNotMatch(block, /aal2/i);
    assert.doesNotMatch(block, /auth\.jwt\(\)/);
  });
  assert.doesNotMatch(sql, /admin can read own admin row/);
  assert.doesNotMatch(sql, /member can read own profile/);
  assert.doesNotMatch(sql, /member can read own orders/);
  assert.doesNotMatch(sql, /public can read active books/);
});

function booksSelectPolicies() {
  return [
    { cmd: "SELECT", permissive: true, check: (ctx) => ctx.active === true },
    { cmd: "SELECT", permissive: true, check: adminSelectUsing }
  ];
}
function profilesSelectPolicies() {
  return [
    { cmd: "SELECT", permissive: true, check: (ctx) => ctx.own === true },
    { cmd: "SELECT", permissive: true, check: adminSelectUsing }
  ];
}
function ordersSelectPolicies() {
  return profilesSelectPolicies();
}
function analyticsSelectPolicies() {
  return [{ cmd: "SELECT", permissive: true, check: adminSelectUsing }];
}
function adminUsersSelectPolicies() {
  return [{ cmd: "SELECT", permissive: true, check: (ctx) => ctx.own === true }];
}
function writePolicies() {
  return [
    { cmd: "UPDATE", permissive: true, check: (ctx) => ctx.isAdmin === true },
    { cmd: "UPDATE", permissive: false, check: (ctx) => ctx.aal === "aal2" }
  ];
}

test("Admin AAL1 cannot read another member profile/orders or inactive books; Admin AAL2 can", () => {
  assert.strictEqual(rlsAllows(profilesSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal1", own: false }), false);
  assert.strictEqual(rlsAllows(ordersSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal1", own: false }), false);
  assert.strictEqual(rlsAllows(booksSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal1", active: false }), false);
  assert.strictEqual(rlsAllows(analyticsSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal1" }), false);
  assert.strictEqual(rlsAllows(profilesSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal2", own: false }), true);
  assert.strictEqual(rlsAllows(ordersSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal2", own: false }), true);
  assert.strictEqual(rlsAllows(booksSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal2", active: false }), true);
  assert.strictEqual(rlsAllows(analyticsSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal2" }), true);
});

test("non-admin AAL1 and AAL2 cannot read Admin-only data", () => {
  ["aal1", "aal2"].forEach((aal) => {
    assert.strictEqual(rlsAllows(profilesSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal, own: false }), false);
    assert.strictEqual(rlsAllows(ordersSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal, own: false }), false);
    assert.strictEqual(rlsAllows(booksSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal, active: false }), false);
    assert.strictEqual(rlsAllows(analyticsSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal }), false);
  });
});

test("member AAL1 can read own profile and own orders; public can read active books without MFA", () => {
  assert.strictEqual(rlsAllows(profilesSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal: "aal1", own: true }), true);
  assert.strictEqual(rlsAllows(ordersSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal: "aal1", own: true }), true);
  assert.strictEqual(rlsAllows(booksSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal: "aal1", active: true }), true);
  assert.strictEqual(rlsAllows(booksSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal1", active: true }), true);
});

test("Admin AAL1 can still read own admin_users row before MFA", () => {
  assert.strictEqual(rlsAllows(adminUsersSelectPolicies(), { cmd: "SELECT", isAdmin: true, aal: "aal1", own: true }), true);
  assert.strictEqual(rlsAllows(adminUsersSelectPolicies(), { cmd: "SELECT", isAdmin: false, aal: "aal1", own: false }), false);
});

function rpcAllows(isAdmin, aal) {
  if (!isAdmin) return false;
  if (aal !== "aal2") return false;
  return true;
}

test("get_kutadgu_analytics and get_kutadgu_book_stock_sum require Admin then AAL2", () => {
  [functionBody(sql, "public.get_kutadgu_analytics"), functionBody(stage8, "public.get_kutadgu_analytics")].forEach((fn) => {
    assert.match(fn, /security definer/i);
    assert.match(fn, /if not public\.is_kutadgu_admin\(\) then/);
    assert.match(fn, /if \(select auth\.jwt\(\)->>'aal'\) is distinct from 'aal2' then/);
    assert.match(fn, /raise exception 'AAL2 required' using errcode = '42501'/);
    const adminAt = fn.search(/is_kutadgu_admin\(\)/);
    const aalAt = fn.search(/is distinct from 'aal2'/);
    assert.ok(adminAt >= 0 && aalAt > adminAt);
  });
  [functionBody(sql, "public.get_kutadgu_book_stock_sum"), functionBody(stage91, "public.get_kutadgu_book_stock_sum")].forEach((fn) => {
    assert.match(fn, /if not public\.is_kutadgu_admin\(\) then/);
    assert.match(fn, /if \(select auth\.jwt\(\)->>'aal'\) is distinct from 'aal2' then/);
    assert.match(fn, /raise exception 'AAL2 required' using errcode = '42501'/);
  });
  assert.strictEqual(rpcAllows(false, "aal1"), false);
  assert.strictEqual(rpcAllows(false, "aal2"), false);
  assert.strictEqual(rpcAllows(true, "aal1"), false);
  assert.strictEqual(rpcAllows(true, "aal2"), true);
});

test("PR #133 write composition is unchanged: Admin+AAL2 only", () => {
  assert.strictEqual(rlsAllows(writePolicies(), { cmd: "UPDATE", isAdmin: false, aal: "aal1" }), false);
  assert.strictEqual(rlsAllows(writePolicies(), { cmd: "UPDATE", isAdmin: false, aal: "aal2" }), false);
  assert.strictEqual(rlsAllows(writePolicies(), { cmd: "UPDATE", isAdmin: true, aal: "aal1" }), false);
  assert.strictEqual(rlsAllows(writePolicies(), { cmd: "UPDATE", isAdmin: true, aal: "aal2" }), true);
  assert.match(writeRepair, /CREATE POLICY "aal2 required to update books"/);
  assert.match(writeRepair, /AS RESTRICTIVE FOR UPDATE TO authenticated/);
});

test("frontend has no service_role; auth and MFA gate files stay in place", () => {
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(adminJs, /service_role/);
  assert.match(adminMfa, /function evaluateAccess/);
  assert.match(adminMfa, /getAuthenticatorAssuranceLevel/);
  assert.match(member, /signInWithOAuth\(\{provider:"google",options:\{redirectTo\}\}/);
  assert.match(member, /flowType:"pkce"/);
  assert.match(resetJs, /verifyOtp\(\{token_hash:info\.tokenHash,type:"recovery"\}\)/);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("stage2c-aal2-admin-select-tests ok");
