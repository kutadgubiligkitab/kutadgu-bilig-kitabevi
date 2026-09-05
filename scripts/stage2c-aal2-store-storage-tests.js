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

const sql = read("STAGE2C_AAL2_STORE_STORAGE_RLS.sql");
const setup = read("SUPABASE_SETUP.sql");
const maint = read("SITE_MAINTENANCE_MODE.sql");
const announce = read("SITE_ANNOUNCEMENT_BAR.sql");
const booksSql = read("STAGE2C_AAL2_BOOKS_WRITE_RLS.sql");
const stage2b = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");
const adminJs = read("admin.js");
const adminMfa = read("admin-mfa.js");
const member = read("member.js");
const resetJs = read("reset-password.js");
const cfgJs = read("supabase-config.js");

const JWT_AAL2 = String.raw`\(select auth\.jwt\(\)->>'aal'\) = 'aal2'`;
const COVER_SCOPE = String.raw`\(bucket_id = 'book-covers' AND \(select auth\.jwt\(\)->>'aal'\) = 'aal2'\)\s*OR \(bucket_id IS DISTINCT FROM 'book-covers'\)`;

function policyBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`create policy "${escaped}"[\s\S]*?(?=drop policy|create policy|grant |revoke |create or replace|begin;|commit;|--)`,
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

function assertInsertAal2(source, name, tableHint) {
  const block = policyBlock(source, name);
  assert.match(block, /AS RESTRICTIVE/i);
  assert.match(block, /FOR INSERT/i);
  assert.match(block, /TO authenticated/i);
  assert.doesNotMatch(block, /TO anon/i);
  assert.doesNotMatch(block, /FOR ALL/i);
  assert.doesNotMatch(block, /FOR SELECT/i);
  assert.match(block, new RegExp(String.raw`WITH CHECK \(` + JWT_AAL2 + String.raw`\)`, "i"));
  assert.doesNotMatch(block, /USING/i);
  if (tableHint) assert.match(block, new RegExp(tableHint, "i"));
}

function assertUpdateAal2(source, name, tableHint) {
  const block = policyBlock(source, name);
  assert.match(block, /AS RESTRICTIVE/i);
  assert.match(block, /FOR UPDATE/i);
  assert.match(block, /TO authenticated/i);
  assert.doesNotMatch(block, /FOR ALL/i);
  assert.doesNotMatch(block, /FOR SELECT/i);
  assert.match(block, new RegExp(String.raw`USING \(` + JWT_AAL2 + String.raw`\)`, "i"));
  assert.match(block, new RegExp(String.raw`WITH CHECK \(` + JWT_AAL2 + String.raw`\)`, "i"));
  if (tableHint) assert.match(block, new RegExp(tableHint, "i"));
}

function assertDeleteAal2(source, name, tableHint) {
  const block = policyBlock(source, name);
  assert.match(block, /AS RESTRICTIVE/i);
  assert.match(block, /FOR DELETE/i);
  assert.match(block, /TO authenticated/i);
  assert.doesNotMatch(block, /FOR ALL/i);
  assert.doesNotMatch(block, /FOR SELECT/i);
  assert.match(block, new RegExp(String.raw`USING \(` + JWT_AAL2 + String.raw`\)`, "i"));
  assert.doesNotMatch(block, /WITH CHECK/i);
  if (tableHint) assert.match(block, new RegExp(tableHint, "i"));
}

test("migration is reviewed SQL only and does not rewrite rows", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\s+public\.(store_settings|store_announcements|orders)\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /FOR ALL/i);
});

test("only new AAL2 policy names are dropped", () => {
  [
    "aal2 required to insert store_settings",
    "aal2 required to update store_settings",
    "aal2 required to insert store_announcements",
    "aal2 required to update store_announcements",
    "aal2 required to delete store_announcements",
    "aal2 required to insert store_announcement_settings",
    "aal2 required to update store_announcement_settings",
    "aal2 required to update orders",
    "aal2 required to insert book covers",
    "aal2 required to update book covers",
    "aal2 required to delete book covers"
  ].forEach((name) => {
    assert.match(sql, new RegExp(String.raw`DROP POLICY IF EXISTS "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i"));
  });
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS store_settings_update_admin/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "admin can upload book covers"/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "admin can update orders"/);
});

test("store_settings AAL2 is INSERT and UPDATE only", () => {
  assertInsertAal2(sql, "aal2 required to insert store_settings", "store_settings");
  assertUpdateAal2(sql, "aal2 required to update store_settings", "store_settings");
  assertInsertAal2(maint, "aal2 required to insert store_settings");
  assertUpdateAal2(maint, "aal2 required to update store_settings");
  assert.match(maint, /store_settings_select_public/);
  assert.match(maint, /USING \(key = 'maintenance_mode'\)/);
  assert.match(maint, /is_kutadgu_admin\(\) AND key = 'maintenance_mode'/);
  const created = [...sql.matchAll(/CREATE POLICY "aal2 required to \w+ store_settings"[\s\S]*?;/gi)].map((m) => m[0]);
  assert.strictEqual(created.length, 2);
  created.forEach((block) => assert.doesNotMatch(block, /FOR SELECT/i));
});

test("store_announcements AAL2 is INSERT UPDATE DELETE only", () => {
  assertInsertAal2(sql, "aal2 required to insert store_announcements");
  assertUpdateAal2(sql, "aal2 required to update store_announcements");
  assertDeleteAal2(sql, "aal2 required to delete store_announcements");
  assertInsertAal2(announce, "aal2 required to insert store_announcements");
  assertUpdateAal2(announce, "aal2 required to update store_announcements");
  assertDeleteAal2(announce, "aal2 required to delete store_announcements");
  assert.match(announce, /store_announcements_select_public/);
  assert.match(announce, /store_announcements_select_admin/);
});

test("store_announcement_settings AAL2 is INSERT and UPDATE only", () => {
  assertInsertAal2(sql, "aal2 required to insert store_announcement_settings");
  assertUpdateAal2(sql, "aal2 required to update store_announcement_settings");
  assertInsertAal2(announce, "aal2 required to insert store_announcement_settings");
  assertUpdateAal2(announce, "aal2 required to update store_announcement_settings");
  assert.match(announce, /store_announcement_settings_select_public/);
  assert.match(announce, /USING \(id = 1\)/);
});

test("orders AAL2 is UPDATE only and isolated from member order creation", () => {
  assertUpdateAal2(sql, "aal2 required to update orders", "orders");
  assertUpdateAal2(setup, "aal2 required to update orders");
  assert.doesNotMatch(setup, /create policy "member can create own orders"/i);
  const createOrder = functionBody(setup, "public.create_member_order");
  assert.doesNotMatch(createOrder, /aal2/i);
  assert.doesNotMatch(createOrder, /auth\.jwt\(\)/);
  const memberSelect = policyBlock(setup, "member can read own orders");
  const adminSelect = policyBlock(setup, "admin can read all orders");
  [memberSelect, adminSelect].forEach((block) => {
    assert.doesNotMatch(block, /aal2/i);
    assert.doesNotMatch(block, /auth\.jwt\(\)/);
  });
  assert.match(setup, /create policy "admin can update orders" on public\.orders for update to authenticated\nusing \(public\.is_kutadgu_admin\(\)\) with check \(public\.is_kutadgu_admin\(\)\)/);
  const orderPolicies = [...sql.matchAll(/CREATE POLICY "aal2 required[^"]*orders"[\s\S]*?;/gi)].map((m) => m[0]);
  assert.strictEqual(orderPolicies.length, 1);
  assert.match(orderPolicies[0], /FOR UPDATE/i);
  assert.doesNotMatch(orderPolicies[0], /FOR INSERT/i);
});

test("storage AAL2 is scoped to book-covers and is not global", () => {
  ["aal2 required to insert book covers", "aal2 required to update book covers", "aal2 required to delete book covers"].forEach((name) => {
    const block = policyBlock(sql, name);
    const setupBlock = policyBlock(setup, name);
    [block, setupBlock].forEach((b) => {
      assert.match(b, /AS RESTRICTIVE/i);
      assert.match(b, /TO authenticated/i);
      assert.match(b, /storage\.objects/i);
      assert.match(b, /bucket_id = 'book-covers'/);
      assert.match(b, /bucket_id IS DISTINCT FROM 'book-covers'/i);
      assert.match(b, new RegExp(COVER_SCOPE, "i"));
      assert.doesNotMatch(b, /FOR SELECT/i);
      assert.doesNotMatch(b, /FOR ALL/i);
    });
  });
  const insert = policyBlock(sql, "aal2 required to insert book covers");
  assert.match(insert, /FOR INSERT/i);
  assert.doesNotMatch(insert, /USING/i);
  const upd = policyBlock(sql, "aal2 required to update book covers");
  assert.match(upd, /FOR UPDATE/i);
  assert.match(upd, /USING/i);
  assert.match(upd, /WITH CHECK/i);
  const del = policyBlock(sql, "aal2 required to delete book covers");
  assert.match(del, /FOR DELETE/i);
  assert.doesNotMatch(del, /WITH CHECK/i);
  const globalAal2Only = /create policy "[^"]+" on storage\.objects as restrictive[\s\S]*?(?:with check|using) \(\(select auth\.jwt\(\)->>'aal'\) = 'aal2'\)/i;
  assert.doesNotMatch(sql, globalAal2Only);
  assert.doesNotMatch(setup, globalAal2Only);
  assert.doesNotMatch(setup, /create policy "public can read book covers"/i);
  assert.doesNotMatch(setup, /create policy "[^"]+" on storage\.objects for select/i);
  assert.doesNotMatch(setup, /on storage\.objects for select to anon,authenticated/i);
  assert.match(setup, /create policy "admin can upload book covers" on storage\.objects for insert to authenticated\nwith check \(bucket_id = 'book-covers' and public\.is_kutadgu_admin\(\)\)/);
});

test("no AAL2 SELECT policies in this migration", () => {
  const created = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/gi)].map((m) => m[0]);
  assert.ok(created.length >= 11);
  created.forEach((block) => {
    assert.doesNotMatch(block, /FOR SELECT/i);
    assert.match(block, /AS RESTRICTIVE/i);
  });
});

test("Phase 3B PR1 books AAL2 and set_member_status remain unchanged", () => {
  assert.match(booksSql, /CREATE POLICY "aal2 required to insert books"/);
  assert.match(setup, /create policy "aal2 required to insert books" on public\.books as restrictive for insert to authenticated with check \(/);
  assert.match(setup, /create policy "public can read active books" on public\.books for select to anon,authenticated using \(is_active = true\)/);
  assert.match(setup, /create policy "admin can read all books" on public\.books for select to authenticated using \(public\.is_kutadgu_admin\(\)\)/);
  assert.doesNotMatch(sql, /on public\.books/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.set_member_status/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.is_kutadgu_admin/i);
  const fn = functionBody(setup, "public.set_member_status");
  assert.match(fn, /if not public\.is_kutadgu_admin\(\) then raise exception 'Admin permission required'/);
  assert.match(fn, /if \(select auth\.jwt\(\)->>'aal'\) is distinct from 'aal2' then/);
  const grant = functionBody(setup, "public.is_kutadgu_admin");
  assert.match(grant, /select exists \(select 1 from public\.admin_users where user_id = auth\.uid\(\)\)/);
  assert.doesNotMatch(grant, /aal2/i);
  assert.doesNotMatch(stage2b, /store_settings/);
});

test("profiles member UPDATE and analytics INSERT remain without AAL2", () => {
  const profilePolicies = [...setup.matchAll(/create policy "[^"]+" on public\.profiles[\s\S]*?;/gi)].map((m) => m[0]);
  assert.ok(profilePolicies.length >= 3);
  profilePolicies.forEach((block) => {
    assert.doesNotMatch(block, /aal2/i);
  });
  assert.match(setup, /create policy "member can update own profile" on public\.profiles for update to authenticated/);
  assert.doesNotMatch(sql, /on public\.profiles/i);
  assert.match(setup, /create policy "public can insert analytics" on public\.analytics_events for insert to anon,authenticated with check \(true\)/);
  const analyticsInsert = [...setup.matchAll(/create policy "[^"]+" on public\.analytics_events[\s\S]*?;/gi)].map((m) => m[0]);
  analyticsInsert.forEach((block) => assert.doesNotMatch(block, /aal2/i));
  const fav = policyBlock(setup, "favorite owner access");
  const cart = policyBlock(setup, "cart owner access");
  [fav, cart].forEach((block) => assert.doesNotMatch(block, /aal2/i));
});

test("Admin frontend writes stay compatible; MFA UI and auth untouched", () => {
  assert.match(adminJs, /from\("store_settings"\)\.update/);
  assert.match(adminJs, /from\("store_announcements"\)/);
  assert.match(adminJs, /from\("store_announcement_settings"\)\.update/);
  assert.match(adminJs, /cfg\.bucket\|\|"book-covers"/);
  assert.match(adminJs, /upsert:false/);
  assert.match(adminJs, /from\("orders"\)\.update\(\{status:nextStatus\}\)/);
  assert.doesNotMatch(adminJs, /from\("orders"\)\.delete/);
  assert.doesNotMatch(adminJs, /from\("orders"\)\.insert/);
  assert.match(adminMfa, /function evaluateAccess/);
  assert.match(adminMfa, /getAuthenticatorAssuranceLevel/);
  assert.match(resetJs, /verifyOtp\(\{token_hash:info\.tokenHash,type:"recovery"\}\)/);
  assert.doesNotMatch(resetJs, /exchangeCodeForSession/);
  assert.match(member, /signInWithOAuth\(\{provider:"google",options:\{redirectTo\}\}/);
  assert.match(member, /flowType:"pkce"/);
  assert.match(cfgJs, /reset-password\.html\?type=recovery/);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("stage2c-aal2-store-storage-tests ok");
