#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const sql = fs.readFileSync(path.join(root, "STAGE113_ADMIN_MEMBER_DIRECTORY.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "STAGE113_ADMIN_MEMBER_DIRECTORY_ROLLBACK.sql"), "utf8");
const cart = fs.readFileSync(path.join(root, "admin-member-cart.js"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL", name, error && error.message);
  }
}

test("the directory page is an admin AAL2 read with one shared filter", () => {
  assert.match(sql, /coalesce\(public\.is_kutadgu_admin\(\), false\) is not true/);
  assert.match(sql, /auth\.jwt\(\)->>'aal'\) is distinct from 'aal2'/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /stable/);
  assert.match(sql, /with filtered as/);
  assert.match(sql, /p\.status is distinct from 'suspended'/);
  assert.match(sql, /exists \(\s*select 1 from public\.member_cart_items c where c\.user_id = p\.id\s*\)/);
  assert.match(sql, /coalesce\(p\.country, ''\) ilike v_like escape '\\'/);
  assert.match(sql, /coalesce\(p\.city, ''\) ilike v_like escape '\\'/);
  assert.match(sql, /replace\(replace\(replace\(v_query, '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'/);
  assert.match(sql, /order by p\.created_at desc nulls last, p\.id desc/);
  assert.match(sql, /limit 20/);
  assert.match(sql, /'confirmed', 'processing', 'shipped', 'completed'/);
  assert.match(sql, /revoke all on function public\.admin_member_directory_page\(text, text, text, integer\) from public, anon/);
  assert.match(sql, /grant execute on function public\.admin_member_directory_page\(text, text, text, integer\) to authenticated/);
  assert.doesNotMatch(sql, /create policy|grant select|grant insert|grant update|grant delete|favorites/i);
  assert.match(rollback, /drop function if exists public\.admin_member_directory_page\(text, text, text, integer\)/);
  assert.doesNotMatch(rollback, /drop policy|drop table/i);
});

test("the members screen asks the server and keeps the cart action", () => {
  assert.match(html, /id="memberStatusFilter"/);
  assert.match(html, /id="memberCartFilter"/);
  assert.match(html, /id="adminMemberPager"/);
  assert.match(html, /admin\.js\?v=91/);
  assert.match(html, /admin-member-cart\.js\?v=3/);
  assert.match(html, /admin\.css\?v=50/);
  assert.match(admin, /admin_member_directory_page/);
  assert.match(admin, /MEMBER_PAGE_SIZE=20/);
  assert.match(admin, /data-member-cart="\$\{esc\(m\.id\)\}">سېۋەتنى كۆرۈش/);
  assert.match(admin, /set_member_status/);
  assert.doesNotMatch(admin, /from\("profiles"\)\.select\("\*"\)/);
  const load = admin.slice(admin.indexOf("async function loadMembers"), admin.indexOf("const COUNTED_ORDER_STATUSES"));
  const auth = admin.slice(admin.indexOf("function discardUnownedMemberDirectory"), admin.indexOf("const COUNTED_ORDER_STATUSES"));
  assert.match(load, /p_query:context\.query/);
  assert.match(load, /p_status:context\.status/);
  assert.match(load, /p_cart:context\.cart/);
  assert.match(load, /p_page:context\.page/);
  assert.match(load, /generation!==memberDirectoryGeneration/);
  assert.equal((load.match(/finishMemberDirectoryAuth\(/g)||[]).length, 2);
  assert.match(load, /adminId:after\.id/);
  assert.match(load, /keepOwnedDirectoryFailure/);
  assert.match(auth, /after\.id!==before\.id/);
  assert.match(auth, /committed\.adminId===admin\.id/);
  assert.doesNotMatch(load, /\.from\("profiles"\)|\.from\("orders"\)|\.from\("member_cart_items"\)/);
  const hydrate = admin.slice(admin.indexOf("async function hydrateOrderMemberProfiles"), admin.indexOf("function bindMemberDirectory"));
  assert.match(hydrate, /const cache=profileById/);
  assert.match(hydrate, /cache!==profileById/);
  assert.match(hydrate, /after\.id!==before\.id/);
  assert.match(hydrate, /cache\.set\(row\.id,row\)/);
  assert.doesNotMatch(hydrate, /profileById\.set\(/);
  assert.match(cart, /function syncList\(ids\)/);
  assert.match(cart, /syncList: syncList/);
});

if (failed) {
  console.error("\n" + failed + " admin member directory test(s) failed");
  process.exit(1);
}
console.log("admin-member-directory-tests ok");
