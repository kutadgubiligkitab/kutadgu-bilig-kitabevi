#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const cart = fs.readFileSync(path.join(root, "admin-member-cart.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "STAGE112_ADMIN_MEMBER_CART.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "STAGE112_ADMIN_MEMBER_CART_ROLLBACK.sql"), "utf8");
const reviews = fs.readFileSync(path.join(root, "admin-book-reviews.js"), "utf8");
const member = fs.readFileSync(path.join(root, "member.js"), "utf8");

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

test("members list keeps its action and adds only the cart view", () => {
  assert.match(admin, /data-member-cart="\$\{esc\(m\.id\)\}">سېۋەتنى كۆرۈش/);
  assert.match(admin, /data-member-status="\$\{esc\(m\.id\)\}"/);
  assert.match(html, /id="memberCartPanel"/);
  assert.match(html, /id="memberCartIdentity"/);
  assert.match(html, /بۇ ئەزانىڭ تور بېتىدە ساقلانغان نۆۋەتتىكى سېۋىتى\. زاكاز ياكى سېتىۋېلىش ئەمەس\./);
  assert.match(html, /admin\.js\?v=89/);
  assert.match(html, /id="memberCartTitle" tabindex="-1"/);
  assert.match(html, /admin-member-cart\.js\?v=2/);
  assert.match(html, /admin\.css\?v=50/);
  assert.doesNotMatch(reviews, /admin_member_cart_page|سېۋەتنى كۆرۈش/);
});

test("the cart panel is read-only and does not store or log rows", () => {
  assert.match(cart, /admin_member_cart_page/);
  assert.match(cart, /سېۋەتتە كىتاب يوق\./);
  assert.match(cart, /سېۋەتنى ئوقۇش مەغلۇپ بولدى\./);
  assert.match(cart, /يېڭىلاش مەغلۇپ بولدى\./);
  assert.match(cart, /كىتاب ئۇچۇرى يوق/);
  assert.match(cart, /قايتا سىناش/);
  assert.match(cart, /pageSize: PAGE_SIZE/);
  assert.match(cart, /PAGE_SIZE = 100/);
  assert.match(cart, /textContent/);
  assert.doesNotMatch(cart, /innerHTML|localStorage|sessionStorage|console\.|catalog\.js|member_cart_items|kutadgu-cart-v1|\.update\(|\.insert\(|\.delete\(|\.from\(/);
  assert.doesNotMatch(member, /admin_member_cart_page/);
  const open = cart.slice(cart.indexOf("function openFrom"), cart.indexOf("function bind"));
  const load = cart.slice(cart.indexOf("async function load"), cart.indexOf("function openFrom"));
  const showRows = cart.slice(cart.indexOf("function showRows"), cart.indexOf("async function readAuth"));
  const showFailure = cart.slice(cart.indexOf("function showFailure"), cart.indexOf("function showRows"));
  assert.match(open, /revealPanel\(\)/);
  assert.match(cart, /heading\.focus\(\{ preventScroll: true \}\)/);
  assert.match(cart, /reason === "close" && openerUsable\(opener\)\) opener\.focus\(\)/);
  assert.doesNotMatch(load, /scrollTo|scrollIntoView|\.focus\(/);
  assert.doesNotMatch(showRows, /scrollTo|scrollIntoView|\.focus\(/);
  assert.doesNotMatch(showFailure, /scrollTo|scrollIntoView|\.focus\(/);
});

test("the read function enforces admin AAL2 and returns one page", () => {
  assert.match(sql, /coalesce\(public\.is_kutadgu_admin\(\), false\) is not true/);
  assert.match(sql, /auth\.jwt\(\)->>'aal'\) is distinct from 'aal2'/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /language plpgsql/);
  assert.match(sql, /stable/);
  assert.match(sql, /returns table \(\s*book_id text,\s*quantity integer,\s*title text\s*\)/);
  assert.match(sql, /left join public\.books b on b\.id::text = c\.book_id/);
  assert.match(sql, /order by c\.book_id asc/);
  assert.match(sql, /limit 100/);
  assert.match(sql, /revoke all on function public\.admin_member_cart_page\(uuid, text\) from public, anon/);
  assert.match(sql, /grant execute on function public\.admin_member_cart_page\(uuid, text\) to authenticated/);
  assert.doesNotMatch(sql, /insert |update |delete |create policy|grant select|grant insert|grant update|grant delete/i);
  assert.match(rollback, /drop function if exists public\.admin_member_cart_page\(uuid, text\)/);
  assert.doesNotMatch(rollback, /drop policy|drop table/i);
});

if (failed) {
  console.error("\n" + failed + " admin member cart test(s) failed");
  process.exit(1);
}
console.log("admin-member-cart-tests ok");
