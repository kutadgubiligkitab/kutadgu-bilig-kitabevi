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
  const firstDrop = sql.search(/DROP POLICY IF EXISTS\s+"Public can view book covers"/);
  assert.ok(firstDrop > 0);
  const preflight = sql.slice(sql.indexOf("BEGIN;"), firstDrop);
  const doBlocks = [...sql.matchAll(/DO \$\$[\s\S]*?END\n\$\$;/g)].map((m) => m[0]);
  assert.ok(doBlocks[0], "preflight DO block");
  assert.match(preflight, /RAISE EXCEPTION/);
  assert.match(doBlocks[0], /stage70_assert_protective_semantics\('Stage 70 aborted:'\)/);
  assert.match(sql, /Do not silently recreate missing protective policies/);
  assert.doesNotMatch(preflight, /CREATE POLICY/i);
  assert.doesNotMatch(doBlocks[0], /stage70_assert_remaining_invariants/);
  LEGACY.forEach((name) => {
    assert.doesNotMatch(preflight, new RegExp(`DROP POLICY IF EXISTS "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });
});

test("post-checks abort if legacy remains or protective policies vanish", () => {
  const afterDrops = sql.slice(sql.lastIndexOf('DROP POLICY IF EXISTS "Authenticated can delete book covers"'));
  assert.match(afterDrops, /legacy policy "%" still exists/);
  assert.match(afterDrops, /required protective policy "%" is missing/);
  assert.match(afterDrops, /stage70_assert_protective_semantics\('Stage 70 aborted after drop:'\)/);
  assert.match(afterDrops, /stage70_assert_remaining_invariants\(\)/);
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

test("semantic checks use catalog metadata rather than name-only existence", () => {
  assert.match(sql, /pg_catalog\.pg_policy/);
  assert.match(sql, /pg_catalog\.pg_get_expr\(pol\.polqual, pol\.polrelid\)/);
  assert.match(sql, /pg_catalog\.pg_get_expr\(pol\.polwithcheck, pol\.polrelid\)/);
  assert.match(sql, /pol\.polcmd/);
  assert.match(sql, /pol\.polpermissive/);
  assert.match(sql, /pol\.polroles/);
  assert.match(sql, /pg_temp\.stage70_norm\(/);
  assert.match(sql, /regexp_replace\([\s\S]*'::\[a-z0-9_\.\]\+'/);
  assert.doesNotMatch(sql, /pg_get_expr\([^)]+\)\s*(=|<>|IS NOT DISTINCT FROM)\s*'/);
  const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (pg_temp\.stage70_\w+)/g)].map((m) => m[1]);
  assert.ok(created.length >= 10, "expected pg_temp Stage 70 validators");
  created.forEach((name) => {
    assert.match(name, /^pg_temp\.stage70_/);
  });
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION (?!pg_temp\.stage70_)/);
});

test("name-only fake protective policies are rejected", () => {
  assert.match(sql, /Name-only fakes are rejected/);
  assert.match(sql, /name-only fake \(unrestricted\)/);
  assert.match(sql, /stage70_is_unrestricted/);
  assert.match(sql, /p_norm IN \('', 'true'\)/);
  const doBlocks = [...sql.matchAll(/DO \$\$[\s\S]*?END\n\$\$;/g)].map((m) => m[0]);
  assert.strictEqual(doBlocks.length, 2, "preflight DO and post-check DO");
  assert.match(doBlocks[0], /stage70_assert_protective_semantics\('Stage 70 aborted:'\)/);
  assert.doesNotMatch(doBlocks[0], /stage70_assert_remaining_invariants/);
  assert.match(doBlocks[1], /stage70_assert_protective_semantics\('Stage 70 aborted after drop:'\)/);
  assert.match(doBlocks[1], /stage70_assert_remaining_invariants\(\)/);
});

test("Admin policies must contain is_kutadgu_admin, be PERMISSIVE, and match commands", () => {
  assert.match(sql, /does not require is_kutadgu_admin\(\)/);
  assert.ok(sql.includes("is_kutadgu_admin\\s*\\(\\s*\\)"), "admin check uses normalized is_kutadgu_admin()");
  assert.match(sql, /is not PERMISSIVE/);
  assert.match(sql, /polpermissive IS DISTINCT FROM TRUE/);
  assert.match(sql, /has unexpected command/);
  assert.match(sql, /is not granted to authenticated/);
  assert.match(sql, /is not scoped to bucket_id = ''book-covers''/);
  assert.match(sql, /'admin can upload book covers', 'a', false, true/);
  assert.match(sql, /'admin can update book covers', 'w', true, true/);
  assert.match(sql, /'admin can delete book covers', 'd', true, false/);
});

test("AAL2 policies must be RESTRICTIVE and keep outside-bucket behavior", () => {
  assert.match(sql, /is not RESTRICTIVE/);
  assert.match(sql, /polpermissive IS DISTINCT FROM FALSE/);
  assert.match(sql, /does not require JWT aal2 for book-covers/);
  assert.match(sql, /weakens outside-bucket behavior/);
  assert.match(sql, /auth\.jwt\(\)/);
  assert.ok(sql.includes("->>\\s*''aal''"), "aal claim is matched after cast-stripping");
  assert.ok(sql.includes("bucket_id\\s+is distinct from\\s+''book-covers''"), "outside-bucket OR is required");
  assert.match(sql, /'aal2 required to insert book covers', 'a', false, true/);
  assert.match(sql, /'aal2 required to update book covers', 'w', true, true/);
  assert.match(sql, /'aal2 required to delete book covers', 'd', true, false/);
});

test("no broad SELECT or generic authenticated write can survive under another name", () => {
  const remainingStart = sql.indexOf("CREATE OR REPLACE FUNCTION pg_temp.stage70_assert_remaining_invariants");
  const remainingEnd = sql.indexOf("$stage70$;", remainingStart);
  assert.ok(remainingStart > 0 && remainingEnd > remainingStart);
  const remaining = sql.slice(remainingStart, remainingEnd);
  LEGACY.forEach((name) => {
    assert.doesNotMatch(remaining, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
  assert.match(remaining, /SELECT policy "%" still grants bucket-wide book-covers access/);
  assert.match(remaining, /PERMISSIVE write policy "%" on book-covers bypasses is_kutadgu_admin\(\)/);
  assert.match(remaining, /polcmd IN \('r', '\*'\)/);
  assert.match(remaining, /polcmd IN \('a', 'w', 'd', '\*'\)/);
  assert.match(remaining, /stage70_applies_to_role\(r\.polroles, 'anon'\)/);
  assert.match(remaining, /stage70_applies_to_role\(r\.polroles, 'authenticated'\)/);
  assert.match(remaining, /rel\.relname = 'objects'/);
  assert.match(remaining, /book-covers public is %, expected true/);
  assert.doesNotMatch(remaining, /AND pol\.polname = /);
});


if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("stage70-storage-policy-hardening-tests ok");
