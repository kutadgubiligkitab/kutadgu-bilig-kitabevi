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

const sql = read("STAGE2C_AAL2_BOOKS_WRITE_RLS.sql");
const setup = read("SUPABASE_SETUP.sql");
const stage2b = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");
const adminJs = read("admin.js");
const adminMfa = read("admin-mfa.js");
const member = read("member.js");
const resetJs = read("reset-password.js");
const cfgJs = read("supabase-config.js");

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

const JWT_AAL2 = String.raw`\(select auth\.jwt\(\)->>'aal'\) = 'aal2'`;

test("migration is reviewed SQL only and does not rewrite book rows", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(sql, /ALTER TABLE public\.books ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\s+public\.books\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /service_role/);
});

test("only the new AAL2 policy names are dropped/created", () => {
  assert.match(sql, /DROP POLICY IF EXISTS "aal2 required to insert books" ON public\.books/);
  assert.match(sql, /DROP POLICY IF EXISTS "aal2 required to update books" ON public\.books/);
  assert.match(sql, /DROP POLICY IF EXISTS "aal2 required to delete books" ON public\.books/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "admin can insert books"/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "admin can update books"/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "admin can delete books"/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "public can read active books"/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "admin can read all books"/);
});

test("INSERT AAL2 policy is AS RESTRICTIVE for authenticated WITH CHECK only", () => {
  const block = policyBlock(sql, "aal2 required to insert books");
  assert.match(block, /AS RESTRICTIVE/);
  assert.match(block, /FOR INSERT/);
  assert.match(block, /TO authenticated/);
  assert.doesNotMatch(block, /TO anon/);
  assert.match(block, new RegExp(String.raw`WITH CHECK \(` + JWT_AAL2 + String.raw`\)`, "i"));
  assert.doesNotMatch(block, /USING/);
  assert.doesNotMatch(block, /FOR SELECT/);
  const setupBlock = policyBlock(setup, "aal2 required to insert books");
  assert.match(setupBlock, /as restrictive/);
  assert.match(setupBlock, new RegExp(String.raw`for insert to authenticated with check \(` + JWT_AAL2 + String.raw`\)`));
});

test("UPDATE AAL2 policy is AS RESTRICTIVE with USING and WITH CHECK", () => {
  const block = policyBlock(sql, "aal2 required to update books");
  assert.match(block, /AS RESTRICTIVE/);
  assert.match(block, /FOR UPDATE/);
  assert.match(block, /TO authenticated/);
  assert.match(block, new RegExp(String.raw`USING \(` + JWT_AAL2 + String.raw`\)`, "i"));
  assert.match(block, new RegExp(String.raw`WITH CHECK \(` + JWT_AAL2 + String.raw`\)`, "i"));
  const setupBlock = policyBlock(setup, "aal2 required to update books");
  assert.match(setupBlock, new RegExp(
    String.raw`as restrictive for update to authenticated using \(` + JWT_AAL2 +
    String.raw`\) with check \(` + JWT_AAL2 + String.raw`\)`
  ));
});

test("DELETE AAL2 policy is AS RESTRICTIVE USING only", () => {
  const block = policyBlock(sql, "aal2 required to delete books");
  assert.match(block, /AS RESTRICTIVE/);
  assert.match(block, /FOR DELETE/);
  assert.match(block, /TO authenticated/);
  assert.match(block, new RegExp(String.raw`USING \(` + JWT_AAL2 + String.raw`\)`, "i"));
  assert.doesNotMatch(block, /WITH CHECK/);
  const setupBlock = policyBlock(setup, "aal2 required to delete books");
  assert.match(setupBlock, new RegExp(String.raw`as restrictive for delete to authenticated using \(` + JWT_AAL2 + String.raw`\)`));
});

test("no AAL2 SELECT policy on books", () => {
  const created = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/gi)].map((m) => m[0]);
  assert.strictEqual(created.length, 3);
  created.forEach((block) => {
    assert.doesNotMatch(block, /FOR SELECT/i);
  });
  const setupSelect = [...setup.matchAll(/create policy "[^"]+" on public\.books for select[\s\S]*?;/gi)]
    .map((m) => m[0]);
  assert.ok(setupSelect.length >= 2);
  setupSelect.forEach((block) => {
    assert.doesNotMatch(block, /aal2/i);
    assert.doesNotMatch(block, /auth\.jwt\(\)/);
  });
});

test("existing public active SELECT and Admin all SELECT stay intact", () => {
  assert.match(setup, /create policy "public can read active books" on public\.books for select to anon,authenticated using \(is_active = true\)/);
  assert.match(setup, /create policy "admin can read all books" on public\.books for select to authenticated using \(public\.is_kutadgu_admin\(\)\)/);
  assert.match(stage2b, /CREATE POLICY "public can read active books"/);
  assert.match(stage2b, /USING \(is_active = true\)/);
  assert.match(stage2b, /CREATE POLICY "admin can read all books"/);
  assert.match(stage2b, /USING \(public\.is_kutadgu_admin\(\)\)/);
  assert.doesNotMatch(stage2b, /aal2/i);
});

test("permissive Admin write policies still use only is_kutadgu_admin()", () => {
  assert.match(setup, /create policy "admin can insert books" on public\.books for insert to authenticated with check \(public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "admin can update books" on public\.books for update to authenticated using \(public\.is_kutadgu_admin\(\)\) with check \(public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "admin can delete books" on public\.books for delete to authenticated using \(public\.is_kutadgu_admin\(\)\)/);
  assert.doesNotMatch(sql, /create policy "admin can insert books"/i);
});

test("is_kutadgu_admin() is not modified to require AAL2", () => {
  const fn = functionBody(setup, "public.is_kutadgu_admin");
  assert.match(fn, /select exists \(select 1 from public\.admin_users where user_id = auth\.uid\(\)\)/);
  assert.doesNotMatch(fn, /aal2/i);
  assert.doesNotMatch(fn, /auth\.jwt\(\)/);
  assert.doesNotMatch(sql, /create or replace function public\.is_kutadgu_admin/i);
});

test("bulk price change does not add SECURITY DEFINER shortcuts", () => {
  const price = read("admin-bulk-price.js");
  assert.doesNotMatch(price, /SECURITY DEFINER/i);
  assert.doesNotMatch(price, /\.rpc\(/);
  assert.match(adminJs, /function persistBulkPriceRow/);
  assert.match(adminJs, /db\.from\("books"\)\.update\(patch\)\.eq\("id",id\)\.select\("id"\)/);
  assert.doesNotMatch(adminJs, /rpc\(["'][^"']*price/i);
  assert.doesNotMatch(adminJs, /SECURITY DEFINER/i);
});

test("set_member_status still checks is_kutadgu_admin then JWT aal2 before UPDATE", () => {
  const mig = functionBody(sql, "public.set_member_status");
  const canon = functionBody(setup, "public.set_member_status");
  [mig, canon].forEach((fn) => {
    assert.match(fn, /returns void/i);
    assert.match(fn, /security definer/i);
    assert.match(fn, /set search_path = public/i);
    assert.match(fn, /if not public\.is_kutadgu_admin\(\) then raise exception 'Admin permission required'/);
    assert.match(fn, /if \(select auth\.jwt\(\)->>'aal'\) is distinct from 'aal2' then/);
    assert.match(fn, /raise exception 'AAL2 required' using errcode = '42501'/);
    assert.match(fn, /update public\.profiles set status = new_status, updated_at = now\(\) where id = member_id/);
    const adminAt = fn.search(/is_kutadgu_admin\(\)/);
    const aalAt = fn.search(/is distinct from 'aal2'/);
    const updateAt = fn.search(/update public\.profiles set status/);
    assert.ok(adminAt >= 0 && aalAt > adminAt && updateAt > aalAt);
    assert.doesNotMatch(fn, /user_metadata/);
    assert.doesNotMatch(fn, /raw_user_meta_data/);
  });
});

test("no table-wide profiles AAL2 policy", () => {
  assert.doesNotMatch(sql, /ON public\.profiles/i);
  assert.doesNotMatch(sql, /on public\.profiles/i);
  const profilePolicies = [...setup.matchAll(/create policy "[^"]+" on public\.profiles[\s\S]*?;/gi)]
    .map((m) => m[0]);
  assert.ok(profilePolicies.length >= 3);
  profilePolicies.forEach((block) => {
    assert.doesNotMatch(block, /aal2/i);
    assert.doesNotMatch(block, /auth\.jwt\(\)/);
  });
  assert.match(setup, /create policy "member can update own profile" on public\.profiles for update to authenticated/);
});

test("PR1 migration does not rewrite storage, store settings, announcements, or analytics", () => {
  assert.doesNotMatch(sql, /storage\.objects/);
  assert.doesNotMatch(sql, /store_settings/);
  assert.doesNotMatch(sql, /store_announcements/);
  assert.doesNotMatch(sql, /store_announcement_settings/);
  assert.doesNotMatch(sql, /on public\.orders/i);
  assert.doesNotMatch(sql, /analytics_events/);
  assert.doesNotMatch(sql, /get_kutadgu_analytics/);
  assert.doesNotMatch(sql, /get_kutadgu_book_stock_sum/);
  assert.match(setup, /create policy "public can insert analytics" on public\.analytics_events for insert to anon,authenticated with check \(true\)/);
  assert.match(setup, /create policy "admin can upload book covers" on storage\.objects for insert to authenticated\nwith check \(bucket_id = 'book-covers' and public\.is_kutadgu_admin\(\)\)/);
});

test("member cart/favorites/order INSERT are not AAL2-gated", () => {
  assert.match(setup, /create policy "favorite owner access" on public\.member_favorites for all to authenticated\nusing \(user_id = auth\.uid\(\) and public\.is_member_active\(\)\)/);
  assert.match(setup, /create policy "cart owner access" on public\.member_cart_items for all to authenticated\nusing \(user_id = auth\.uid\(\) and public\.is_member_active\(\)\)/);
  assert.match(setup, /create policy "member can create own orders" on public\.orders for insert to authenticated\nwith check \(user_id = auth\.uid\(\) and public\.is_member_active\(\)\)/);
  const fav = policyBlock(setup, "favorite owner access");
  const cart = policyBlock(setup, "cart owner access");
  const memberInsert = policyBlock(setup, "member can create own orders");
  const memberSelect = policyBlock(setup, "member can read own orders");
  const adminSelect = policyBlock(setup, "admin can read all orders");
  [fav, cart, memberInsert, memberSelect, adminSelect].forEach((block) => {
    assert.doesNotMatch(block, /aal2/i);
  });
});

test("frontend still writes books and set_member_status without client-side AAL2 SQL", () => {
  assert.match(adminJs, /db\.from\("books"\)\.insert/);
  assert.match(adminJs, /db\.from\("books"\)\.update/);
  assert.match(adminJs, /db\.from\("books"\)\.delete\(\)/);
  assert.match(adminJs, /db\.rpc\("set_member_status",\{member_id:memberId,new_status:nextStatus\}\)/);
  assert.doesNotMatch(adminJs, /from\("books"\).*aal2/s);
  assert.match(adminMfa, /function evaluateAccess/);
  assert.match(adminMfa, /getAuthenticatorAssuranceLevel/);
});

test("password reset TokenHash and Google OAuth routing unchanged", () => {
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
console.log("stage2c-aal2-books-rpc-tests ok");
