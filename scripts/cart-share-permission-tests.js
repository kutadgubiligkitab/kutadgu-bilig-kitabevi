#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const links = require("../kutadgu-shared-cart-links.js");
const preview = require("../cloudflare/preview-dispatch.js");

const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");
const member = fs.readFileSync(path.join(root, "member.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "STAGE121_CART_SHARE_PERMISSIONS.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "STAGE121_CART_SHARE_PERMISSIONS_ROLLBACK.sql"), "utf8");
const stage105 = fs.readFileSync(path.join(root, "STAGE105_SHARED_CART_LINKS.sql"), "utf8");
const stage113 = fs.readFileSync(path.join(root, "STAGE113_ADMIN_MEMBER_DIRECTORY.sql"), "utf8");
const stage120 = fs.readFileSync(path.join(root, "STAGE120_WEBSITE_FEEDBACK.sql"), "utf8");

let failed = 0;
const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(
        () => console.log("PASS", name),
        (err) => {
          failed += 1;
          console.error("FAIL", name, err && err.stack || err);
        }
      ));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack || err);
  }
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, startNeedle);
  return src.slice(start, end);
}

function rpcText(value) {
  return {
    status: 200,
    text: async () => JSON.stringify(value)
  };
}

test("permission SQL checks eligibility inside the create transaction", () => {
  const creator = sliceBetween(sql, "create or replace function public.create_member_shared_cart_link", "revoke all on function public.my_cart_share_permission");
  assert.match(creator, /security definer/);
  assert.match(creator, /set search_path = pg_catalog, public/);
  assert.match(creator, /v_uid uuid := auth\.uid\(\)/);
  assert.match(creator, /perform pg_catalog\.pg_advisory_xact_lock\(841211211\)/);
  const lockAt = creator.indexOf("pg_advisory_xact_lock(841211211)");
  const rateAt = creator.indexOf("pg_advisory_xact_lock(841050105)");
  const insertAt = creator.indexOf("insert into public.shared_cart_links");
  assert.ok(lockAt > 0 && lockAt < rateAt && rateAt < insertAt);
  assert.match(creator, /v_status is distinct from 'active'/);
  assert.match(creator, /coalesce\(v_global, false\) is not true and coalesce\(v_granted, false\) is not true/);
  assert.match(creator, /return 'denied'/);
  const insert = creator.slice(creator.indexOf("insert into public.shared_cart_links"));
  assert.match(insert, /insert into public\.shared_cart_links \(code, items, expires_at\)/);
  assert.match(insert, /now\(\) \+ interval '30 days'/);
  assert.doesNotMatch(insert, /p_expires_at\)/);
  assert.match(creator, /interval '30 days 5 minutes'/);
  assert.match(creator, /replaced by the database clock plus/);
  assert.doesNotMatch(insert, /user_id|account/);
  assert.match(sql, /grant execute on function public\.create_member_shared_cart_link\(text, jsonb, timestamptz\) to authenticated/);
  assert.match(sql, /revoke all on function public\.create_member_shared_cart_link\(text, jsonb, timestamptz\) from public, anon, authenticated, service_role/);
  assert.match(sql, /revoke all on table public\.cart_share_grants from public, anon, authenticated, service_role/);
  assert.match(sql, /alter table public\.cart_share_grants force row level security/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /insert into public\.cart_share_settings \(id, global_enabled\)\s+values \(1, false\)\s+on conflict \(id\) do nothing/);
  assert.doesNotMatch(sql, /update public\.profiles|alter table public\.profiles/i);
});

test("admin writes use the same lock and do not rewrite the other setting", () => {
  const globalFn = sliceBetween(sql, "create or replace function public.admin_set_cart_share_global", "create or replace function public.admin_set_cart_share_grant");
  const grantFn = sliceBetween(sql, "create or replace function public.admin_set_cart_share_grant", "create or replace function public.create_member_shared_cart_link");
  assert.match(globalFn, /is_kutadgu_admin\(\)/);
  assert.match(globalFn, /aal2/);
  assert.match(globalFn, /pg_advisory_xact_lock\(841211211\)/);
  assert.match(globalFn, /set global_enabled = v_enabled/);
  assert.doesNotMatch(globalFn, /cart_share_grants/);
  assert.match(grantFn, /pg_advisory_xact_lock\(841211211\)/);
  assert.match(grantFn, /on conflict \(user_id\) do update/);
  assert.doesNotMatch(grantFn, /global_enabled/);
  assert.match(grantFn, /auth\.users/);
});

test("rollback removes permission storage and leaves shared links", () => {
  assert.match(rollback, /drop function if exists public\.create_member_shared_cart_link\(text, jsonb, timestamptz\)/);
  assert.match(rollback, /drop table if exists public\.cart_share_grants/);
  assert.match(rollback, /drop table if exists public\.cart_share_settings/);
  assert.doesNotMatch(rollback, /drop table if exists public\.shared_cart_links|drop function if exists public\.create_shared_cart_link/i);
});

test("historical cart, directory, and feedback SQL stay untouched by this feature", () => {
  assert.doesNotMatch(stage105, /create_member_shared_cart_link|cart_share_grants|cart_share_settings/);
  assert.match(stage105, /GRANT EXECUTE ON FUNCTION public\.create_shared_cart_link\(text, jsonb, timestamptz\) TO service_role/);
  assert.match(stage113, /p\.id is distinct from auth\.uid\(\)/);
  assert.doesNotMatch(stage113, /cart_share/);
  assert.doesNotMatch(stage120, /cart_share/);
  assert.doesNotMatch(member, /my_cart_share_permission|cart_share_grants|create_member_shared_cart_link/);
  const signOut = sliceBetween(member, "async function signOut()", "async function resetPassword");
  assert.ok(signOut.indexOf("KutadguWebsiteFeedback.beginSignOut") < signOut.indexOf("noteCartShareSignOut"));
  assert.ok(signOut.indexOf("noteCartShareSignOut") < signOut.indexOf("abandonMemberShopSync"));
  assert.ok(signOut.indexOf("noteCartShareSignOut") < signOut.indexOf("auth.signOut"));
  assert.doesNotMatch(signOut, /rememberSignOutContext|restoreRejectedSignOut|localStorage|getSession/);
  const authHook = member.slice(member.indexOf("db.auth.onAuthStateChange"), member.indexOf("const proven=await recoverProvenMemberSession"));
  assert.doesNotMatch(authHook, /noteCartShare/);
});

test("shop hides the action until the current account is confirmed", () => {
  const share = sliceBetween(shop, "async function shareCartLink()", "async function importSharedCartFromQuery()");
  const identity = sliceBetween(shop, "function noteCartShareAuth(", "async function shareCartLink()");
  assert.match(shop, /cartShareVisible\(\)\?`<button type="button" class="checkout-secondary" id="shareCart">/);
  assert.match(identity, /db\.rpc\("my_cart_share_permission"\)/);
  assert.match(identity, /noteCartShareAuth/);
  assert.match(identity, /scheduleCartShareRetry/);
  assert.match(identity, /cartShareAttempts>=3/);
  assert.match(identity, /if\(!cartShareStill\(seq,id\)\)return/);
  assert.match(identity, /cartShareSeq\+=1/);
  assert.match(identity, /cartShareBusy=false/);
  assert.match(share, /if\(cartShareBusy\)return/);
  assert.match(share, /Authorization:"Bearer "\+token/);
  assert.match(share, /permission\.data!==true/);
  assert.match(share, /sessionResult\.error/);
  assert.match(share, /sessionUser!==shareOwner/);
  assert.match(share, /sessionUser!==cartShareSdkId/);
  assert.match(share, /response\.status===401\|\|response\.status===403/);
  assert.match(share, /if\(cartShareBusySeq===shareSeq\)\{cartShareBusy=false;cartShareBusySeq=0\}/);
  assert.match(share, /if\(!cartShareStill\(shareSeq,shareOwner\)\)return/);
  const importFn = sliceBetween(shop, "async function fetchShortSharedCart", "function sharedCartWriteReady");
  assert.match(importFn, /\/api\/shared-cart\//);
  assert.doesNotMatch(importFn, /Authorization/);
  assert.match(cartHtml, /id="whatsappOrder"/);
  assert.match(cartHtml, /id="prepareOrder"/);
  assert.match(cartHtml, /id="copyOrder"/);
  assert.match(cartHtml, /id="shareOrder"/);
  assert.doesNotMatch(cartHtml, /id="shareCart"/);
  assert.match(cartHtml, /shop\.js\?v=168/);
});

test("admin reads one batched permission payload and ignores a stale write", () => {
  const load = sliceBetween(admin, "async function loadCartShareState", "function retryCartShareState");
  const globalWrite = sliceBetween(admin, "async function setCartShareGlobal", "async function setCartShareGrant");
  const grantWrite = sliceBetween(admin, "async function setCartShareGrant", "function renderMembers");
  assert.strictEqual(admin.split('db.rpc("admin_cart_share_state"').length, 2);
  assert.match(load, /p_user_ids:\(ids\|\|\[\]\)\.slice\(0,20\)/);
  assert.doesNotMatch(sliceBetween(admin, "function renderMembers()", "function renderMemberPager"), /db\.rpc\("admin_cart_share_state"/);
  assert.match(admin, /ساقلانغان ئالاھىدە ئىجازەت/);
  assert.match(admin, /if\(state\.globalEnabled\)return `<span class="admin-member-share-saved"/);
  assert.match(globalWrite, /after\.aal!=="aal2"/);
  assert.match(globalWrite, /cartShareAdmin\.pendingKey="global"/);
  assert.ok(globalWrite.indexOf('cartShareAdmin.pendingKey="global"') < globalWrite.indexOf("await readMemberAdmin()"));
  assert.match(globalWrite, /cartShareWriteCurrent\(op,"global"\)/);
  assert.match(sliceBetween(admin, "function cartShareWriteCurrent", "async function reloadCartShareAfterWrite"), /pendingKey===key/);
  assert.match(load, /cartShareAdmin\.readOp!==readOp/);
  assert.ok(load.indexOf("cartShareReadSeq") < load.indexOf('db.rpc("admin_cart_share_state"'));
  assert.match(grantWrite, /payload\.user_id/);
  assert.match(grantWrite, /key==="self"&&userId!==before\.id/);
  assert.match(adminHtml, /id="cartShareControls"/);
  assert.match(adminHtml, /id="cartShareGlobal"/);
  assert.match(adminHtml, /admin\.js\?v=119/);
  assert.match(adminHtml, /admin\.css\?v=58/);
  const members = sliceBetween(adminHtml, 'id="memberManagement"', 'id="adminMemberList"');
  assert.ok(members.indexOf("cartShareControls") > 0);
  assert.ok(members.indexOf("cartShareControls") < members.indexOf("adminMemberFilters"));
});

test("missing, denied, failed, and colliding creates fail closed", async () => {
  let fetches = 0;
  const missing = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    fetchImpl: async () => { fetches += 1; return rpcText("ok"); }
  });
  assert.strictEqual(missing.status, 401);
  assert.deepStrictEqual(missing.body, { ok: false, error: "denied" });
  assert.strictEqual(fetches, 0);

  const denied = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    authorization: "Bearer header.payload.signature",
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    fetchImpl: async () => rpcText("denied")
  });
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(denied.body.error, "denied");

  const broken = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    authorization: "Bearer header.payload.signature",
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    fetchImpl: async () => ({ status: 500, text: async () => "nope" })
  });
  assert.strictEqual(broken.status, 503);
  assert.strictEqual(broken.body.error, "unavailable");

  let attempt = 0;
  const seen = [];
  const created = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    authorization: "Bearer header.payload.signature",
    body: JSON.stringify({ items: [{ id: "246", qty: 2 }] }),
    generateCode: () => (attempt === 0 ? "Abcdefg2" : "Abcdefg3"),
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), authorization: init.headers.Authorization, apikey: init.headers.apikey });
      attempt += 1;
      return rpcText(attempt === 1 ? "conflict" : "ok");
    }
  });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.ok, true);
  assert.strictEqual(seen.length, 2);
  assert.match(seen[0].url, /\/rpc\/create_member_shared_cart_link$/);
  assert.strictEqual(seen[0].authorization, "Bearer header.payload.signature");
  assert.strictEqual(seen[0].apikey, links.PUBLIC_API_KEY);
  assert.notStrictEqual(seen[0].apikey, "service-secret");
  assert.doesNotMatch(seen[0].url, /create_shared_cart_link$/);

  const read = await links.handleSharedCartApi({
    method: "GET",
    pathname: "/api/shared-cart/Abcdefg2",
    env: { SUPABASE_SECRET_KEY: "service-secret" },
    fetchImpl: async (url, init) => {
      assert.match(String(url), /shared_cart_links/);
      assert.strictEqual(init.headers.Authorization, "Bearer service-secret");
      return { ok: true, status: 200, json: async () => [{ items: [{ id: "246", qty: 1 }], expires_at: "2099-01-01T00:00:00.000Z" }] };
    }
  });
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.body.ok, true);
});

test("the worker forwards the caller token and does not invent one", async () => {
  let seen = "";
  const response = await preview.dispatch(
    new Request("http://127.0.0.1:8787/api/shared-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer header.payload.signature" },
      body: JSON.stringify({ items: [{ id: "246", qty: 1 }] })
    }),
    { SUPABASE_SECRET_KEY: "service-secret" },
    {
      fetchImpl: async (url, init) => {
        seen = init.headers.Authorization;
        assert.match(String(url), /create_member_shared_cart_link/);
        assert.notStrictEqual(init.headers.apikey, "service-secret");
        return { status: 200, text: async () => JSON.stringify("ok") };
      }
    }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(seen, "Bearer header.payload.signature");
});

test("SQL filename guards allow only this feature's new files", () => {
  const neqFiles = [
    "scripts/discovery-category-split-hotfix-tests.js",
    "scripts/storefront-cards-1b-polish-tests.js",
    "scripts/storefront-cards-1a-polish-tests.js",
    "scripts/admin-book-staff-tests.js",
    "scripts/admin-submissions-tests.js"
  ];
  const setFiles = [
    "scripts/design-foundation-tests.js",
    "scripts/stage-seo-2h-category-listing-seo-tests.js",
    "scripts/storefront-cover-presentation-tests.js",
    "scripts/stage4b1-public-cards-tests.js"
  ];
  neqFiles.forEach((file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(text.includes('file !== "STAGE121_CART_SHARE_PERMISSIONS.sql"'), file);
    assert.ok(text.includes('file !== "STAGE121_CART_SHARE_PERMISSIONS_ROLLBACK.sql"'), file);
    assert.ok(!text.includes("STAGE999_UNRELATED.sql"), file);
  });
  setFiles.forEach((file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(text.includes('"STAGE121_CART_SHARE_PERMISSIONS.sql"'), file);
    assert.ok(text.includes('"STAGE121_CART_SHARE_PERMISSIONS_ROLLBACK.sql"'), file);
    assert.ok(!text.includes("STAGE999_UNRELATED.sql"), file);
  });
  const design = fs.readFileSync(path.join(root, "scripts/design-foundation-tests.js"), "utf8");
  assert.match(design, /\.sql\$\/i\.test\(file\) && !allowedSql\.has\(file\)/);
  const feedback = fs.readFileSync(path.join(root, "scripts/website-feedback-tests.js"), "utf8");
  const stage120Verify = fs.readFileSync(path.join(root, "scripts/stage120-isolated-verify.js"), "utf8");
  assert.ok(!feedback.includes("STAGE121_CART_SHARE_PERMISSIONS.sql"));
  assert.ok(!stage120Verify.includes("STAGE121_CART_SHARE_PERMISSIONS.sql"));
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error(failed + " cart-share permission test(s) failed");
    process.exit(1);
  }
  console.log("cart-share permission tests ok");
});
