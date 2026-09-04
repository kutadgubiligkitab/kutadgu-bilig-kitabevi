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

const sql = read("STAGE70_STORAGE_POLICY_HARDENING.sql");
const setup = read("SUPABASE_SETUP.sql");
const stage2c = read("STAGE2C_AAL2_STORE_STORAGE_RLS.sql");
const workflow = read(".github/workflows/stage10-regression.yml");
const pkg = read("package.json");
const adminJs = read("admin.js");
const shopJs = read("shop.js");

const LEGACY = [
  "Public can view book covers",
  "public can read book covers",
  "Authenticated can upload book covers",
  "Authenticated can update book covers",
  "Authenticated can delete book covers"
];
const PROTECTIVE = [
  "admin can upload book covers",
  "admin can update book covers",
  "admin can delete book covers",
  "aal2 required to insert book covers",
  "aal2 required to update book covers",
  "aal2 required to delete book covers"
];

function dropCount(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(String.raw`DROP POLICY IF EXISTS "${escaped}" ON storage\.objects`, "gi");
  return (source.match(re) || []).length;
}

test("migration is reviewed SQL only and does not rewrite data", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\s+(storage\.|public\.)/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /ALTER TABLE/i);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /\bGRANT\b/);
  assert.doesNotMatch(sql, /\bREVOKE\b/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /set public\s*=/i);
  assert.doesNotMatch(sql, /FOR ALL/i);
});

test("migration drops exactly the 5 legacy policies", () => {
  LEGACY.forEach((name) => {
    assert.strictEqual(dropCount(sql, name), 1, "drop once: " + name);
  });
  const drops = [...sql.matchAll(/DROP POLICY IF EXISTS "([^"]+)" ON storage\.objects/gi)].map((m) => m[1]);
  assert.deepStrictEqual(drops, LEGACY);
});

test("migration does not drop Admin or AAL2 policies", () => {
  PROTECTIVE.forEach((name) => {
    assert.strictEqual(dropCount(sql, name), 0, "must not drop " + name);
    assert.match(sql, new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  });
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "admin can upload book covers"/i);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "aal2 required to insert book covers"/i);
});

test("preflight aborts when bucket or protective policies are missing", () => {
  assert.match(sql, /book-covers bucket does not exist/);
  assert.match(sql, /book-covers public is %, expected true/);
  assert.match(sql, /required protective policy "%" is missing\. No policies were dropped/);
  assert.match(sql, /FROM storage\.buckets/);
  assert.match(sql, /b\.id = 'book-covers'/);
  assert.match(sql, /v_public IS DISTINCT FROM TRUE/);
  assert.match(sql, /pg_catalog\.pg_policies/);
  assert.match(sql, /p\.schemaname = 'storage'/);
  assert.match(sql, /p\.tablename = 'objects'/);
  const preflight = sql.slice(sql.indexOf("BEGIN;"), sql.indexOf("DROP POLICY IF EXISTS"));
  assert.match(preflight, /RAISE EXCEPTION/);
  assert.match(sql, /Do not silently recreate missing protective policies/);
  assert.doesNotMatch(preflight, /CREATE POLICY/i);
  LEGACY.forEach((name) => {
    assert.doesNotMatch(preflight, new RegExp(`DROP POLICY IF EXISTS "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });
});

test("post-checks abort if legacy remains or protective policies vanish", () => {
  const afterDrops = sql.slice(sql.lastIndexOf("DROP POLICY IF EXISTS"));
  assert.match(afterDrops, /legacy policy "%" still exists/);
  assert.match(afterDrops, /required protective policy "%" is missing/);
  LEGACY.forEach((name) => {
    assert.match(afterDrops, new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  });
  PROTECTIVE.forEach((name) => {
    assert.match(afterDrops, new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  });
});

test("setup keeps book-covers public and has no public Storage SELECT", () => {
  assert.match(setup, /insert into storage\.buckets \(id,name,public\) values \('book-covers','book-covers',true\)/);
  assert.match(setup, /on conflict \(id\) do update set public = true/);
  assert.doesNotMatch(setup, /create policy "public can read book covers"/i);
  assert.doesNotMatch(setup, /create policy "Public can view book covers"/i);
  assert.doesNotMatch(setup, /create policy "[^"]+" on storage\.objects for select/i);
  assert.doesNotMatch(setup, /on storage\.objects for select to anon,authenticated/i);
  LEGACY.forEach((name) => {
    assert.match(setup, new RegExp(String.raw`drop policy if exists "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" on storage\.objects`, "i"));
    assert.doesNotMatch(setup, new RegExp(String.raw`create policy "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i"));
  });
});

test("setup Admin writes still require is_kutadgu_admin and AAL2 remains", () => {
  assert.match(setup, /create policy "admin can upload book covers" on storage\.objects for insert to authenticated\nwith check \(bucket_id = 'book-covers' and public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "admin can update book covers" on storage\.objects for update to authenticated\nusing \(bucket_id = 'book-covers' and public\.is_kutadgu_admin\(\)\) with check \(bucket_id = 'book-covers' and public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "admin can delete book covers" on storage\.objects for delete to authenticated\nusing \(bucket_id = 'book-covers' and public\.is_kutadgu_admin\(\)\)/);
  assert.match(setup, /create policy "aal2 required to insert book covers" on storage\.objects as restrictive for insert to authenticated/);
  assert.match(setup, /create policy "aal2 required to update book covers" on storage\.objects as restrictive for update to authenticated/);
  assert.match(setup, /create policy "aal2 required to delete book covers" on storage\.objects as restrictive for delete to authenticated/);
  assert.match(stage2c, /CREATE POLICY "aal2 required to insert book covers"/);
  assert.match(stage2c, /CREATE POLICY "aal2 required to update book covers"/);
  assert.match(stage2c, /CREATE POLICY "aal2 required to delete book covers"/);
});

test("no anon INSERT UPDATE DELETE storage policy is introduced", () => {
  const created = [...setup.matchAll(/create policy "[^"]+" on storage\.objects[\s\S]*?;/gi)].map((m) => m[0]);
  assert.ok(created.length >= 6);
  created.forEach((block) => {
    assert.doesNotMatch(block, /TO anon/i);
    assert.doesNotMatch(block, /FOR SELECT/i);
    assert.doesNotMatch(block, /FOR ALL/i);
  });
  assert.doesNotMatch(sql, /TO anon/i);
  assert.doesNotMatch(sql, /create policy "Authenticated can upload book covers"/i);
});

test("no production SQL auto-execution from CI, package scripts, or browser", () => {
  assert.doesNotMatch(workflow, /STAGE70_STORAGE_POLICY_HARDENING/);
  assert.doesNotMatch(pkg, /STAGE70_STORAGE_POLICY_HARDENING/);
  assert.doesNotMatch(adminJs, /fetch\([^)]*STAGE70/);
  assert.doesNotMatch(adminJs, /psql|supabase\s+db\s+push/i);
  assert.doesNotMatch(shopJs, /STAGE70_STORAGE_POLICY_HARDENING/);
  assert.doesNotMatch(pkg, /\bpsql\b/);
});

test("application Storage usage is still upload plus getPublicUrl", () => {
  assert.match(adminJs, /storage\.from\(bucket\)\.upload/);
  assert.match(adminJs, /upsert:false/);
  assert.match(adminJs, /getPublicUrl\(path\)/);
  assert.doesNotMatch(adminJs, /storage\.from\([^)]+\)\.list\s*\(/);
  assert.doesNotMatch(shopJs, /\.storage\.from/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("stage70-storage-policy-hardening-tests ok");
