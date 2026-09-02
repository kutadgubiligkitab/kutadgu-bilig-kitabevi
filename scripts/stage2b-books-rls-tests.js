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

const sql = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");
const setup = read("SUPABASE_SETUP.sql");
const member = read("member.js");
const resetJs = read("reset-password.js");
const shop = read("shop.js");
const adminJs = read("admin.js");

function policyBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`create policy "${escaped}"[\s\S]*?(?=drop policy|create policy|grant |revoke |--|$)`,
    "i"
  ));
  assert.ok(match, "missing policy " + name);
  return match[0];
}

test("books RLS stays enabled and no book rows are rewritten", () => {
  assert.match(sql, /ALTER TABLE public\.books ENABLE ROW LEVEL SECURITY/);
  assert.match(setup, /alter table public\.books enable row level security/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\s+public\.books\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
});

test("legacy USING (true) public SELECT policies are dropped", () => {
  assert.match(sql, /DROP POLICY IF EXISTS "Public can view books" ON public\.books/);
  assert.match(sql, /DROP POLICY IF EXISTS "public can read books" ON public\.books/);
  assert.match(setup, /drop policy if exists "Public can view books" on public\.books/);
  assert.match(setup, /drop policy if exists "public can read books" on public\.books/);
  assert.doesNotMatch(sql, /create policy "public can read books"/i);
  assert.doesNotMatch(sql, /create policy "Public can view books"/i);
  assert.doesNotMatch(setup, /create policy "public can read books" on public\.books for select to anon,authenticated using \(true\)/);
});

test("no remaining books SELECT policy uses USING (true)", () => {
  const setupBooks = setup.slice(setup.indexOf("-- 6) Row Level Security"));
  const booksSelect = [...setupBooks.matchAll(/create policy "([^"]+)" on public\.books for select[\s\S]*?;/gi)]
    .map((m) => m[0]);
  assert.ok(booksSelect.length >= 2, "expected public + admin SELECT policies");
  booksSelect.forEach((block) => {
    assert.doesNotMatch(block, /using \(true\)/i);
  });
  const created = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) => m[0]);
  assert.ok(created.length >= 2);
  created.forEach((block) => {
    assert.doesNotMatch(block, /USING \(true\)/);
  });
});

test("canonical public active-books SELECT policy exists for anon and authenticated", () => {
  const pub = policyBlock(sql, "public can read active books");
  assert.match(pub, /FOR SELECT/);
  assert.match(pub, /TO anon, authenticated/);
  assert.match(pub, /USING \(is_active = true\)/);
  assert.match(setup, /create policy "public can read active books" on public\.books for select to anon,authenticated using \(is_active = true\)/);
});

test("authenticated admin SELECT policy uses is_kutadgu_admin()", () => {
  const admin = policyBlock(sql, "admin can read all books");
  assert.match(admin, /FOR SELECT/);
  assert.match(admin, /TO authenticated/);
  assert.doesNotMatch(admin, /TO anon/);
  assert.match(admin, /USING \(public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "admin can read all books" on public\.books for select to authenticated using \(public\.is_kutadgu_admin\(\)\)/);
});

test("admin INSERT UPDATE DELETE stay gated by is_kutadgu_admin()", () => {
  assert.match(setup, /create policy "admin can insert books" on public\.books for insert to authenticated with check \(public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "admin can update books" on public\.books for update to authenticated using \(public\.is_kutadgu_admin\(\)\) with check \(public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "admin can delete books" on public\.books for delete to authenticated using \(public\.is_kutadgu_admin\(\)\)/);
  assert.doesNotMatch(sql, /admin can insert books/);
  assert.doesNotMatch(sql, /admin can update books/);
  assert.doesNotMatch(sql, /admin can delete books/);
});

test("anon EXECUTE on is_kutadgu_admin is revoked; authenticated EXECUTE is kept", () => {
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.is_kutadgu_admin\(\) FROM anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.is_kutadgu_admin\(\) TO authenticated/);
  assert.doesNotMatch(sql, /REVOKE EXECUTE ON FUNCTION public\.is_kutadgu_admin\(\) FROM authenticated/);
  assert.match(setup, /revoke execute on function public\.is_kutadgu_admin\(\) from anon/);
  assert.match(setup, /grant execute on function public\.is_kutadgu_admin\(\) to authenticated/);
  assert.doesNotMatch(setup, /grant execute on function public\.is_kutadgu_admin\(\) to anon, authenticated/);
  const fn = setup.match(/create or replace function public\.is_kutadgu_admin\(\)[\s\S]*?\$\$;/);
  assert.ok(fn);
  assert.match(fn[0], /select exists \(select 1 from public\.admin_users where user_id = auth\.uid\(\)\)/);
});

test("storefront still requests active books; Admin still loads unfiltered lists", () => {
  assert.match(shop, /if\(!state\.includeInactive\)params\.set\("is_active","eq\.true"\)/);
  assert.match(shop, /\/rest\/v1\/books\?select=id&is_active=eq\.true/);
  assert.match(adminJs, /db\.from\("books"\)\.select\("id",\{count:"exact",head:true\}\)/);
  assert.match(adminJs, /db\.from\("books"\)\.select\("id",\{count:"exact",head:true\}\)\.eq\("is_active",true\)/);
});

test("auth password-reset and Google OAuth files are untouched by this SQL change", () => {
  assert.match(member, /resetPasswordForEmail/);
  assert.match(member, /signInWithOAuth\(\{provider:"google",options:\{redirectTo\}\}/);
  assert.match(member, /flowType:"pkce"/);
  assert.match(resetJs, /verifyOtp\(\{token_hash:info\.tokenHash,type:"recovery"\}\)/);
  assert.doesNotMatch(resetJs, /exchangeCodeForSession/);
});

test("migration is reviewed SQL only and does not grant service_role", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /search_path/);
});

if (failed) process.exit(1);
console.log("stage2b-books-rls-tests ok");
