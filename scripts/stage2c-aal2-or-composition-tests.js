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

const repair = read("STAGE2C_AAL2_RESTRICTIVE_REPAIR.sql");
const sqlFiles = fs.readdirSync(root).filter((f) => f.endsWith(".sql"));

const AAL2_POLICY_NAMES = [
  "aal2 required to insert books",
  "aal2 required to update books",
  "aal2 required to delete books",
  "aal2 required to update orders",
  "aal2 required to insert store_settings",
  "aal2 required to update store_settings",
  "aal2 required to insert store_announcements",
  "aal2 required to update store_announcements",
  "aal2 required to delete store_announcements",
  "aal2 required to insert store_announcement_settings",
  "aal2 required to update store_announcement_settings",
  "aal2 required to insert store_homepage_about",
  "aal2 required to update store_homepage_about",
  "aal2 required to insert store_hero_settings",
  "aal2 required to update store_hero_settings",
  "aal2 required to insert store_hero_store_slides",
  "aal2 required to update store_hero_store_slides",
  "aal2 required to delete store_hero_store_slides",
  "aal2 required to insert store_hero_campaigns",
  "aal2 required to update store_hero_campaigns",
  "aal2 required to delete store_hero_campaigns",
  "aal2 required to insert book covers",
  "aal2 required to update book covers",
  "aal2 required to delete book covers"
];

function rlsAllows(policies, ctx) {
  const applicable = policies.filter((p) => p.cmd === ctx.cmd);
  const permissive = applicable.filter((p) => p.permissive);
  const restrictive = applicable.filter((p) => !p.permissive);
  if (!permissive.length) return false;
  const anyPermissive = permissive.some((p) => p.check(ctx));
  const allRestrictive = restrictive.every((p) => p.check(ctx));
  return anyPermissive && allRestrictive;
}

function booksUpdatePolicies(aal2Permissive) {
  return [
    { cmd: "UPDATE", permissive: true, check: (ctx) => ctx.isAdmin === true },
    { cmd: "UPDATE", permissive: aal2Permissive, check: (ctx) => ctx.aal === "aal2" }
  ];
}

function ordersUpdatePolicies(aal2Permissive) {
  return [
    { cmd: "UPDATE", permissive: true, check: (ctx) => ctx.isAdmin === true },
    { cmd: "UPDATE", permissive: aal2Permissive, check: (ctx) => ctx.aal === "aal2" }
  ];
}

function storeSettingsUpdatePolicies(aal2Permissive) {
  return [
    { cmd: "UPDATE", permissive: true, check: (ctx) => ctx.isAdmin === true },
    { cmd: "UPDATE", permissive: aal2Permissive, check: (ctx) => ctx.aal === "aal2" }
  ];
}

function matrix(policies) {
  return {
    memberAal1: rlsAllows(policies, { cmd: "UPDATE", isAdmin: false, aal: "aal1" }),
    memberAal2: rlsAllows(policies, { cmd: "UPDATE", isAdmin: false, aal: "aal2" }),
    adminAal1: rlsAllows(policies, { cmd: "UPDATE", isAdmin: true, aal: "aal1" }),
    adminAal2: rlsAllows(policies, { cmd: "UPDATE", isAdmin: true, aal: "aal2" })
  };
}

test("repair SQL is reviewed-only and does not rewrite rows or drop Admin policies", () => {
  assert.match(repair, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.doesNotMatch(repair, /\b(UPDATE|INSERT|DELETE)\s+public\.(books|orders|store_settings)\b/i);
  assert.doesNotMatch(repair, /\bTRUNCATE\b/i);
  assert.doesNotMatch(repair, /DROP TABLE/i);
  assert.doesNotMatch(repair, /service_role/);
  assert.doesNotMatch(repair, /DROP POLICY IF EXISTS "admin can update books"/);
  assert.doesNotMatch(repair, /DROP POLICY IF EXISTS "admin can update orders"/);
  assert.doesNotMatch(repair, /CREATE OR REPLACE FUNCTION public\.is_kutadgu_admin/i);
});

test("repair recreates every confirmed AAL2 mutation policy AS RESTRICTIVE", () => {
  AAL2_POLICY_NAMES.forEach((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(repair, new RegExp(String.raw`DROP POLICY IF EXISTS "${escaped}"`, "i"), name);
    const create = repair.match(new RegExp(
      String.raw`CREATE POLICY "${escaped}"[\s\S]*?(?=DROP POLICY|CREATE POLICY|DO \$\$|COMMIT;)`,
      "i"
    ));
    assert.ok(create, "missing CREATE " + name);
    assert.match(create[0], /AS RESTRICTIVE/i, name);
    assert.doesNotMatch(create[0], /AS PERMISSIVE/i, name);
    assert.doesNotMatch(create[0], /FOR SELECT/i, name);
    assert.doesNotMatch(create[0], /TO anon/i, name);
  });
  assert.match(repair, /p\.polpermissive/);
  assert.match(repair, /AAL2 write policies must be RESTRICTIVE/);
});

test("no SQL file creates an AAL2-required policy without AS RESTRICTIVE", () => {
  sqlFiles.forEach((file) => {
    const src = read(file);
    const creates = [...src.matchAll(/CREATE POLICY\s+"aal2 required[^"]+"[\s\S]*?;/gi)].map((m) => m[0]);
    const compact = [...src.matchAll(/create policy "aal2 required[^"]+" on [\s\S]*?;/gi)].map((m) => m[0]);
    creates.concat(compact).forEach((block) => {
      assert.match(block, /as restrictive/i, file + " " + block.slice(0, 80));
    });
  });
});

test("OR-combined PERMISSIVE AAL2 is the production bug: non-admin AAL2 can mutate", () => {
  const books = matrix(booksUpdatePolicies(true));
  const orders = matrix(ordersUpdatePolicies(true));
  const store = matrix(storeSettingsUpdatePolicies(true));
  assert.strictEqual(books.memberAal1, false);
  assert.strictEqual(books.memberAal2, true, "permissive AAL2-only policy must be treated as the OR bug");
  assert.strictEqual(books.adminAal1, true, "admin AAL1 would still pass a permissive AAL2-only OR");
  assert.strictEqual(books.adminAal2, true);
  assert.strictEqual(orders.memberAal2, true);
  assert.strictEqual(store.memberAal2, true);
});

test("RESTRICTIVE AAL2 ANDs with Admin: non-admin AAL2 cannot mutate; admin AAL2 can", () => {
  const books = matrix(booksUpdatePolicies(false));
  const orders = matrix(ordersUpdatePolicies(false));
  const store = matrix(storeSettingsUpdatePolicies(false));
  [
    ["books", books],
    ["orders", orders],
    ["store_settings", store]
  ].forEach(([label, result]) => {
    assert.strictEqual(result.memberAal1, false, label + " member AAL1");
    assert.strictEqual(result.memberAal2, false, label + " member AAL2 must be denied");
    assert.strictEqual(result.adminAal1, false, label + " admin AAL1 must be denied");
    assert.strictEqual(result.adminAal2, true, label + " admin AAL2 must be allowed");
  });
});

test("repair does not add a new permissive AAL2-only write policy", () => {
  const creates = [...repair.matchAll(/CREATE POLICY[\s\S]*?;/gi)].map((m) => m[0]);
  assert.ok(creates.length >= AAL2_POLICY_NAMES.length);
  creates.forEach((block) => {
    assert.match(block, /AS RESTRICTIVE/i);
    assert.doesNotMatch(block, /AS PERMISSIVE/i);
  });
});

test("member SELECT / own-row writes stay outside this repair", () => {
  assert.doesNotMatch(repair, /public can read active books/i);
  assert.doesNotMatch(repair, /members can insert own orders/i);
  assert.doesNotMatch(repair, /favorites/i);
  assert.doesNotMatch(repair, /cart_items/i);
  assert.doesNotMatch(repair, /analytics_events/i);
});

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("stage2c-aal2-or-composition-tests ok");
