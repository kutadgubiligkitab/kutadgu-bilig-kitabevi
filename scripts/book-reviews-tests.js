#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const reviews = require("../book-reviews.js");
const storefront = fs.readFileSync(path.join(root, "book-reviews.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin-book-reviews.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "STAGE107_BOOK_REVIEWS.sql"), "utf8");
const shell = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");

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

test("review text rejects empty and oversized values", () => {
  assert.strictEqual(reviews.validateReviewBody("   ").ok, false);
  assert.strictEqual(reviews.validateReviewBody("").reason, "empty");
  assert.strictEqual(reviews.validateReviewBody("  ياخشى كىتاب  ").ok, true);
  assert.strictEqual(reviews.validateReviewBody("  ياخشى كىتاب  ").value, "ياخشى كىتاب");
  assert.strictEqual(reviews.validateReviewBody("ئ".repeat(2000)).ok, true);
  assert.strictEqual(reviews.validateReviewBody("ئ".repeat(2001)).reason, "long");
});

test("pending copy is the agreed Uyghur message", () => {
  assert.strictEqual(reviews.PENDING_MESSAGE, "باھايىڭىز تەستىقنى ساقلاۋاتىدۇ. تەستىقلانغاندىن كېيىن بۇ كىتاب بېتىدە كۆرۈنىدۇ.");
});

test("storefront renders review text through text nodes and does not moderate", () => {
  assert.match(storefront, /textContent/);
  assert.doesNotMatch(storefront, /innerHTML/);
  assert.doesNotMatch(storefront, /moderate_book_review|is_kutadgu_admin/);
  assert.match(storefront, /submitLock/);
  assert.match(storefront, /book_id: Number\(bookId\)/);
  assert.match(storefront, /my_book_review_status/);
  assert.doesNotMatch(storefront, /\.in\("status"/);
  assert.doesNotMatch(storefront, /user_id:/);
});

test("admin moderation is a separate AAL2 client path", () => {
  assert.match(admin, /moderate_book_review/);
  assert.match(admin, /aal !== "aal2"/);
  assert.match(admin, /decisionLock/);
  assert.match(admin, /textContent/);
  assert.doesNotMatch(admin, /innerHTML|email/);
  assert.match(adminHtml, /data-admin-section="reviews"/);
  assert.match(adminHtml, /data-admin-section-panel="reviews"/);
  assert.match(adminHtml, /admin-book-reviews\.js\?v=2/);
  assert.match(shell, /book-reviews\.js\?v=3/);
  assert.match(shell, /book-reviews\.css\?v=2/);
  assert.match(shell, /shop\.js\?v=143/);
});

test("review SQL keeps anonymous reads off the admin helper", () => {
  const publicPolicy = sql.slice(sql.indexOf("public reads approved reviews of active books"), sql.indexOf("member reads own book reviews"));
  assert.match(publicPolicy, /to anon, authenticated/);
  assert.match(publicPolicy, /status = 'approved'/);
  assert.match(publicPolicy, /b\.is_active = true/);
  assert.doesNotMatch(publicPolicy, /is_kutadgu_admin/);
  assert.match(sql, /book_id bigint not null references public\.books \(id\)/);
  assert.match(sql, /new\.user_id := auth\.uid\(\)/);
  assert.match(sql, /new\.status := 'pending'/);
  assert.match(sql, /where status = 'pending'/);
  assert.match(sql, /grant insert \(book_id, body\)/);
  assert.doesNotMatch(sql, /grant update|grant delete/i);
  assert.match(sql, /revoke all on function public\.moderate_book_review\(uuid, text\) from public, anon/);
  assert.match(sql, /function public\.my_book_review_status\(p_book_id bigint\)/);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /revoke all on function public\.my_book_review_status\(bigint\) from public, anon/);
  assert.match(sql, /grant execute on function public\.my_book_review_status\(bigint\) to authenticated/);
  assert.doesNotMatch(sql, /p\.email|profiles\.email/);
});

if (failed) {
  console.error(failed + " book review test(s) failed");
  process.exit(1);
}
console.log("book-reviews-tests ok");
