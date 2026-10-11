#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const feedback = require(path.join(root, "feedback.js"));
const adminFeedback = require(path.join(root, "admin-feedback.js"));
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("blank and whitespace-only text is rejected", () => {
  ["", " ", "\n\t", " \n "].forEach((value) => {
    const result = feedback.normalizeBody(value);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "empty");
    assert.strictEqual(feedback.validationMessage(result.reason), feedback.EMPTY_MESSAGE);
  });
});

test("the exact limit is accepted and one more character is rejected", () => {
  const exact = "پ".repeat(2000);
  const over = "پ".repeat(2001);
  const ok = feedback.normalizeBody("  " + exact + "\n");
  const bad = feedback.normalizeBody(over);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.body, exact);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, "long");
  assert.strictEqual(feedback.validationMessage("long"), feedback.LONG_MESSAGE);
});

test("the same payload keeps its receipt and a changed payload does not", () => {
  const first = feedback.nextReceipt(null, "بىر");
  const same = feedback.nextReceipt(first, "بىر");
  const changed = feedback.nextReceipt(first, "ئىككى");
  assert.strictEqual(same.id, first.id);
  assert.notStrictEqual(changed.id, first.id);
  assert.strictEqual(changed.body, "ئىككى");
});

test("a stale account or epoch does not match", () => {
  assert.strictEqual(feedback.sameIdentity(1, "a", 1, "a"), true);
  assert.strictEqual(feedback.sameIdentity(1, "a", 2, "a"), false);
  assert.strictEqual(feedback.sameIdentity(1, "a", 1, "b"), false);
  assert.ok(!feedback.sameIdentity(1, "", 1, ""));
});

test("member and admin clients do not persist or render feedback as HTML", () => {
  const member = read("feedback.js");
  const admin = read("admin-feedback.js");
  [member, admin].forEach((source) => {
    assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML|analytics\.track|posthog/i);
  });
  assert.match(admin, /textContent/);
  assert.match(member, /beginSignOut/);
});

test("sign-out clears the draft before the auth request", () => {
  const member = read("member.js");
  const start = member.indexOf("async function signOut()");
  const body = member.slice(start, member.indexOf("async function resetPassword"));
  assert.ok(body.indexOf("KutadguWebsiteFeedback.beginSignOut") < body.indexOf("auth.signOut"));
  const signedOut = member.indexOf('event==="SIGNED_OUT"');
  assert.ok(member.indexOf("KutadguWebsiteFeedback.beginSignOut", signedOut) > signedOut);
});

test("admin logout clears the inbox through the existing private-clear function", () => {
  const admin = read("admin.js");
  const logout = admin.slice(admin.indexOf("async function logout()"), admin.indexOf("function openImport()"));
  assert.ok(logout.indexOf("clearPendingSubmissionPrivate()") < logout.indexOf("auth.signOut"));
  const clear = admin.slice(admin.indexOf("function clearPendingSubmissionPrivate()"), admin.indexOf("function clearPendingSubmissionPrivate()") + 1800);
  assert.match(clear, /KutadguAdminFeedback\.clear/);
  assert.match(admin, /ADMIN_SECTIONS=\[[^\]]*\"feedback\"/);
  assert.match(admin, /id==="feedback"&&window\.KutadguAdminFeedback/);
});

test("footer, page, and admin entry stay narrow", () => {
  assert.match(read("shop.js"), /<a href="\/feedback">پىكىر ۋە تەكلىپ<\/a>/);
  assert.match(read("account.html"), /<a href="\/feedback">پىكىر ۋە تەكلىپ<\/a>/);
  const page = read("feedback.html");
  assert.match(page, /noindex, follow/);
  assert.match(page, /href="\/account\.html"/);
  assert.doesNotMatch(page, /account\.html\?/);
  assert.doesNotMatch(page, /analytics\.js/);
  assert.match(page, /maxlength="2000"/);
  assert.match(read("admin.html"), /admin-feedback\.js\?v=1/);
  assert.match(read("admin.html"), /admin\.js\?v=106/);
  assert.match(read("admin.html"), /admin-book-reviews\.js\?v=7/);
  assert.match(read("admin.html"), /admin\.css\?v=54/);
  assert.match(read("index.html"), /shop\.js\?v=149/);
  assert.match(read("books.html"), /shop\.js\?v=148/);
  assert.match(read("book-shell.html"), /shop\.js\?v=148/);
  assert.match(read("cart.html"), /shop\.js\?v=142/);
});

test("feedback stays out of the public sitemap", () => {
  const sitemap = require(path.join(root, "kutadgu-sitemap.js"));
  assert.ok(!sitemap.PUBLIC_INFO_SLUGS.includes("feedback"));
  const pages = read("sitemap-pages.xml");
  assert.doesNotMatch(pages, /\/feedback/);
});

test("admin paging helpers stay bounded", () => {
  assert.strictEqual(adminFeedback.PAGE_SIZE, 10);
  assert.strictEqual(adminFeedback.pageCount(0), 1);
  assert.strictEqual(adminFeedback.pageCount(10), 1);
  assert.strictEqual(adminFeedback.pageCount(11), 2);
  assert.strictEqual(adminFeedback.clampPage(0, 3), 0);
  assert.strictEqual(adminFeedback.clampPage(10, 1), 0);
  assert.strictEqual(adminFeedback.clampPage(11, 5), 1);
  const text = adminFeedback.dateText("2026-01-02T03:04:00Z");
  assert.match(text, /2026-يىلى/);
  assert.match(text, /\d{2}:\d{2}$/);
  assert.strictEqual(adminFeedback.dateText(""), "—");
});

test("migration and rollback names stay narrow", () => {
  const sql = read("STAGE120_WEBSITE_FEEDBACK.sql");
  const rollback = read("STAGE120_WEBSITE_FEEDBACK_ROLLBACK.sql");
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /aal2/);
  assert.match(sql, /on delete cascade/);
  assert.match(sql, /revoke all on table public\.website_feedback from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.[^\n]+ to anon/i);
  assert.match(rollback, /drop table if exists public\.website_feedback/);
  assert.match(rollback, /deletes every stored suggestion/i);
});

if (failed) {
  console.error("\n" + failed + " website feedback test(s) failed");
  process.exit(1);
}
console.log("website-feedback-tests ok");
