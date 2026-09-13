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

const sql = read("STAGE92_BOOK_STAFF_SECURITY.sql");
const setup = read("SUPABASE_SETUP.sql");
const stage2b = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");
const stage2cBooks = read("STAGE2C_AAL2_BOOKS_WRITE_RLS.sql");
const stage2cStorage = read("STAGE2C_AAL2_STORE_STORAGE_RLS.sql");
const stage70 = read("STAGE70_STORAGE_POLICY_HARDENING.sql");
const adminJs = read("admin.js");
const adminHtml = read("admin.html");

const ADMIN_BOOK_POLICIES = [
  "admin can insert books",
  "admin can update books",
  "admin can delete books",
  "admin can read all books",
  "public can read active books",
  "aal2 required to insert books",
  "aal2 required to update books",
  "aal2 required to delete books"
];
const ADMIN_COVER_POLICIES = [
  "admin can upload book covers",
  "admin can update book covers",
  "admin can delete book covers",
  "aal2 required to insert book covers",
  "aal2 required to update book covers",
  "aal2 required to delete book covers"
];

function functionBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`CREATE OR REPLACE FUNCTION ${escaped}\([\s\S]*?\$[a-z]*\$;`,
    "i"
  ));
  assert.ok(match, "missing function " + name);
  return match[0];
}

function policyBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`CREATE POLICY "${escaped}"[\s\S]*?;`,
    "i"
  ));
  assert.ok(match, "missing policy " + name);
  return match[0];
}

function rlsAllows(policies, ctx) {
  const applicable = policies.filter((p) => p.cmd === ctx.cmd);
  const permissive = applicable.filter((p) => p.permissive);
  const restrictive = applicable.filter((p) => !p.permissive);
  if (!permissive.length) return false;
  return permissive.some((p) => p.check(ctx)) && restrictive.every((p) => p.check(ctx));
}

const coverPolicies = [
  {
    cmd: "INSERT",
    permissive: true,
    check: (ctx) => ctx.bucket === "book-covers" && ctx.isAdmin === true
  },
  {
    cmd: "INSERT",
    permissive: true,
    check: (ctx) =>
      ctx.bucket === "book-covers"
      && ctx.isStaff === true
      && typeof ctx.name === "string"
      && ctx.name.startsWith("staff/" + ctx.uid + "/")
      && !ctx.name.includes("..")
  },
  {
    cmd: "INSERT",
    permissive: false,
    check: (ctx) => ctx.bucket !== "book-covers" || ctx.aal === "aal2"
  },
  {
    cmd: "UPDATE",
    permissive: true,
    check: (ctx) => ctx.bucket === "book-covers" && ctx.isAdmin === true
  },
  {
    cmd: "UPDATE",
    permissive: false,
    check: (ctx) => ctx.bucket !== "book-covers" || ctx.aal === "aal2"
  },
  {
    cmd: "DELETE",
    permissive: true,
    check: (ctx) => ctx.bucket === "book-covers" && ctx.isAdmin === true
  },
  {
    cmd: "DELETE",
    permissive: false,
    check: (ctx) => ctx.bucket !== "book-covers" || ctx.aal === "aal2"
  }
];

const booksWritePolicies = [
  { cmd: "UPDATE", permissive: true, check: (ctx) => ctx.isAdmin === true },
  { cmd: "UPDATE", permissive: false, check: (ctx) => ctx.aal === "aal2" },
  { cmd: "DELETE", permissive: true, check: (ctx) => ctx.isAdmin === true },
  { cmd: "DELETE", permissive: false, check: (ctx) => ctx.aal === "aal2" },
  { cmd: "INSERT", permissive: true, check: (ctx) => ctx.isAdmin === true },
  { cmd: "INSERT", permissive: false, check: (ctx) => ctx.aal === "aal2" }
];

test("migration is reviewed SQL only and does not rewrite catalog rows", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /SET is_active\s*=/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.books\s+SET[\s\S]*WHERE\s+submission_status\s+IS\s+NULL/i);
});

test("admin_users and is_kutadgu_admin() are not replaced or weakened", () => {
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.admin_users/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.admin_users/i);
  assert.doesNotMatch(sql, /ALTER TABLE\s+public\.admin_users/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.is_kutadgu_admin/i);
  assert.doesNotMatch(sql, /DROP FUNCTION(?: IF EXISTS)? public\.is_kutadgu_admin/i);
  assert.match(setup, /create or replace function public\.is_kutadgu_admin\(\)/);
  assert.match(setup, /from public\.admin_users where user_id = auth\.uid\(\)/);
  const helper = functionBlock(sql, "public.is_kutadgu_book_staff");
  assert.match(helper, /SECURITY DEFINER/i);
  assert.match(helper, /STABLE/i);
  assert.match(helper, /SET search_path = public/i);
  assert.match(helper, /book_staff_users/);
  assert.match(helper, /active = true/);
  assert.doesNotMatch(helper, /admin_users/);
  assert.doesNotMatch(helper, /is_kutadgu_admin/);
});

test("existing Admin and AAL2 books/storage policies are not dropped", () => {
  ADMIN_BOOK_POLICIES.concat(ADMIN_COVER_POLICIES).forEach((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(sql, new RegExp(String.raw`DROP POLICY IF EXISTS "${escaped}"`, "i"), name);
  });
  assert.match(setup, /create policy "admin can insert books"/);
  assert.match(setup, /create policy "admin can update books"/);
  assert.match(setup, /create policy "admin can delete books"/);
  assert.match(stage2b, /CREATE POLICY "admin can read all books"/);
  assert.match(stage2cBooks, /CREATE POLICY "aal2 required to update books"/);
  assert.match(stage2cStorage, /CREATE POLICY "aal2 required to insert book covers"/);
  assert.match(stage70, /admin can upload book covers/);
});

test("Book Staff have no books UPDATE or DELETE policy and no direct INSERT policy", () => {
  const creates = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/gi)].map((m) => m[0]);
  const booksPolicies = creates.filter((block) => /ON public\.books/i.test(block));
  assert.strictEqual(booksPolicies.length, 0);
  creates.forEach((block) => {
    if (/ON public\.books/i.test(block)) {
      assert.doesNotMatch(block, /FOR UPDATE/i);
      assert.doesNotMatch(block, /FOR DELETE/i);
      assert.doesNotMatch(block, /FOR INSERT/i);
    }
  });
  assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR (UPDATE|DELETE|INSERT)[\s\S]*ON public\.books/i);
  assert.strictEqual(rlsAllows(booksWritePolicies, { cmd: "UPDATE", isAdmin: false, isStaff: true, aal: "aal2" }), false);
  assert.strictEqual(rlsAllows(booksWritePolicies, { cmd: "DELETE", isAdmin: false, isStaff: true, aal: "aal2" }), false);
  assert.strictEqual(rlsAllows(booksWritePolicies, { cmd: "INSERT", isAdmin: false, isStaff: true, aal: "aal2" }), false);
  assert.strictEqual(rlsAllows(booksWritePolicies, { cmd: "UPDATE", isAdmin: true, aal: "aal2" }), true);
  assert.strictEqual(rlsAllows(booksWritePolicies, { cmd: "DELETE", isAdmin: true, aal: "aal2" }), true);
});

test("staff cover INSERT is own-path only; no staff UPDATE or DELETE", () => {
  const insert = policyBlock(sql, "book staff can upload own covers");
  assert.match(insert, /FOR INSERT/);
  assert.match(insert, /TO authenticated/);
  assert.match(insert, /bucket_id = 'book-covers'/);
  assert.match(insert, /is_kutadgu_book_staff\(\)/);
  assert.match(insert, /staff\/' \|\| auth\.uid\(\)::text \|\| '\/\%/);
  assert.match(insert, /position\('\.\.' in name\) = 0/);
  assert.doesNotMatch(insert, /FOR UPDATE/i);
  assert.doesNotMatch(insert, /FOR DELETE/i);
  assert.doesNotMatch(sql, /book staff can update/i);
  assert.doesNotMatch(sql, /book staff can delete/i);

  const uid = "11111111-1111-1111-1111-111111111111";
  const staffAal2Own = {
    cmd: "INSERT", bucket: "book-covers", isAdmin: false, isStaff: true, aal: "aal2", uid,
    name: "staff/" + uid + "/cover.webp"
  };
  const staffAal2Other = { ...staffAal2Own, name: "staff/other-user/cover.webp" };
  const staffAal2AdminPath = { ...staffAal2Own, name: "102.webp" };
  const staffAal1Own = { ...staffAal2Own, aal: "aal1" };
  const staffUpdate = { ...staffAal2Own, cmd: "UPDATE" };
  const staffDelete = { ...staffAal2Own, cmd: "DELETE" };
  const adminAal2 = {
    cmd: "INSERT", bucket: "book-covers", isAdmin: true, isStaff: false, aal: "aal2", uid, name: "102.webp"
  };

  assert.strictEqual(rlsAllows(coverPolicies, staffAal2Own), true);
  assert.strictEqual(rlsAllows(coverPolicies, staffAal2Other), false);
  assert.strictEqual(rlsAllows(coverPolicies, staffAal2AdminPath), false);
  assert.strictEqual(rlsAllows(coverPolicies, staffAal1Own), false);
  assert.strictEqual(rlsAllows(coverPolicies, staffUpdate), false);
  assert.strictEqual(rlsAllows(coverPolicies, staffDelete), false);
  assert.strictEqual(rlsAllows(coverPolicies, adminAal2), true);
  assert.strictEqual(rlsAllows(coverPolicies, { ...adminAal2, cmd: "UPDATE" }), true);
  assert.strictEqual(rlsAllows(coverPolicies, { ...adminAal2, cmd: "DELETE" }), true);
});

test("submit_book_for_approval forces pending inactive and rejects client publication fields", () => {
  const fn = functionBlock(sql, "public.submit_book_for_approval");
  assert.match(fn, /auth\.uid\(\)/);
  assert.match(fn, /is_kutadgu_book_staff\(\)/);
  assert.match(fn, /auth\.jwt\(\)->>'aal'\) IS DISTINCT FROM 'aal2'/);
  assert.match(fn, /'id'/);
  assert.match(fn, /'created_at'/);
  assert.match(fn, /'updated_at'/);
  assert.match(fn, /'sales_count'/);
  assert.match(fn, /'is_active'/);
  assert.match(fn, /'is_recommended'/);
  assert.match(fn, /'is_new'/);
  assert.match(fn, /'is_bestseller'/);
  assert.match(fn, /'is_featured'/);
  assert.match(fn, /Client may not set publication or identity fields/);
  assert.match(fn, /submission_status,\s*submitted_by,\s*submitted_at/);
  assert.match(fn, /false,\s*false,\s*false,\s*false,\s*false,\s*0,\s*'pending',\s*v_uid,\s*now\(\)/);
  assert.match(fn, /price must be non-negative/);
  assert.match(fn, /stock must be non-negative/);
  assert.doesNotMatch(fn, /is_active\s*=\s*true/);
  assert.doesNotMatch(fn, /is_new\s*=\s*true/);
  assert.doesNotMatch(fn, /payload->>'is_active'/);
  assert.doesNotMatch(fn, /payload->>'sales_count'/);
  assert.doesNotMatch(fn, /payload->>'is_recommended'/);
});

test("existing books remain approved via column default without catalog rewrite", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS submission_status text NOT NULL DEFAULT 'approved'/);
  assert.match(sql, /submission_status IN \('approved', 'pending', 'rejected'\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS submitted_by uuid NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS submitted_at timestamptz NULL/);
});

test("Admin staff management and approval RPCs require Admin plus AAL2", () => {
  ["public.add_kutadgu_book_staff", "public.set_kutadgu_book_staff_active", "public.approve_staff_book_submission", "public.reject_staff_book_submission"].forEach((name) => {
    const fn = functionBlock(sql, name);
    assert.match(fn, /is_kutadgu_admin\(\)/, name);
    assert.match(fn, /auth\.jwt\(\)->>'aal'\) IS DISTINCT FROM 'aal2'/, name);
    assert.doesNotMatch(fn, /INSERT\s+INTO\s+public\.admin_users/i, name);
  });
  const add = functionBlock(sql, "public.add_kutadgu_book_staff");
  assert.match(add, /FROM auth\.users u/);
  assert.match(add, /RETURN v_user_id/);
  assert.doesNotMatch(add, /u\.email,/);
  assert.doesNotMatch(add, /raw_user_meta_data/);
  const approve = functionBlock(sql, "public.approve_staff_book_submission");
  assert.match(approve, /submission_status = 'approved'/);
  assert.match(approve, /is_active = true/);
  assert.match(approve, /submission_status = 'pending'/);
  const reject = functionBlock(sql, "public.reject_staff_book_submission");
  assert.match(reject, /submission_status = 'rejected'/);
  assert.match(reject, /is_active = false/);
  assert.match(reject, /submission_status = 'pending'/);
});

test("this stage does not change Admin UI or public storefront files", () => {
  assert.doesNotMatch(sql, /admin\.html|admin\.js/);
  assert.match(adminJs, /./);
  assert.match(adminHtml, /./);
});

if (failed) {
  console.error("\n" + failed + " stage92 book staff security test(s) failed");
  process.exit(1);
}
console.log("stage92-book-staff-security-tests ok");
