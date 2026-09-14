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
    console.error("FAIL", name, err && err.message);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function functionBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`CREATE OR REPLACE FUNCTION ${escaped}\([\s\S]*?\$[a-z_]*\$;`,
    "i"
  ));
  assert.ok(match, "missing function " + name);
  return match[0];
}

const sql = read("STAGE94_PENDING_BOOK_EDIT.sql");
const adminJs = read("admin.js");
const adminHtml = read("admin.html");
const staffJs = read("book-staff.js");
const memberJs = read("member.js");
const shopJs = read("shop.js");
const isolation = read("scripts/auth-session-isolation-tests.js");
const mfa = read("scripts/stage2c-admin-mfa-tests.js");
const fn = functionBlock(sql, "public.update_pending_staff_book_submission");

test("STAGE94 is review-only and does not rewrite RLS or approval RPCs", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(sql, /Does not apply itself to production/);
  assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY|ALTER TABLE/);
  assert.doesNotMatch(sql, /approve_staff_book_submission|reject_staff_book_submission|submit_book_for_approval/);
  assert.doesNotMatch(sql, /service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.update_pending_staff_book_submission\(bigint, jsonb\) TO authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.update_pending_staff_book_submission\(bigint, jsonb\) FROM anon/);
});

test("pending edit RPC is Full Admin + AAL2 and cannot publish", () => {
  assert.match(fn, /auth\.uid\(\) IS NULL/);
  assert.match(fn, /is_kutadgu_admin\(\)/);
  assert.match(fn, /auth\.jwt\(\)->>'aal'\) IS DISTINCT FROM 'aal2'/);
  assert.doesNotMatch(fn, /is_kutadgu_book_staff\(\)/);
  assert.match(fn, /'is_active'/);
  assert.match(fn, /'is_available'/);
  assert.match(fn, /'submission_status'/);
  assert.match(fn, /payload \?\| v_forbidden/);
  assert.match(fn, /submission_status = 'pending'/);
  assert.match(fn, /AND submission_status = 'pending'/);
  assert.doesNotMatch(fn, /is_active\s*=/);
  assert.doesNotMatch(fn, /is_available\s*=/);
  assert.match(fn, /gallery_images may contain at most 4 items/);
  assert.match(fn, /Only pending staff submissions can be edited/);
});

test("whitelist matches production catalog fields only", () => {
  const allowed = fn.match(/v_allowed text\[\] := ARRAY\[[\s\S]*?\];/);
  assert.ok(allowed);
  [
    "title", "author", "category", "source", "price", "stock", "isbn",
    "translator", "publisher", "publish_year", "pages", "cover_type",
    "book_size", "description", "image_url", "gallery_images",
    "original_price", "dimensions", "is_color_print", "interior_print_type"
  ].forEach((col) => {
    assert.match(allowed[0], new RegExp("'" + col + "'"));
  });
  assert.doesNotMatch(allowed[0], /'language'|'sales_count'|'href'/);
  const forbidden = fn.match(/v_forbidden text\[\] := ARRAY\[[\s\S]*?\];/);
  assert.ok(forbidden);
  assert.doesNotMatch(forbidden[0], /'original_price'|'dimensions'|'is_color_print'|'interior_print_type'/);
  assert.match(fn, /original_price must be a non-negative number/);
  assert.match(fn, /is_color_print must be a boolean/);
  assert.match(fn, /invalid interior_print_type/);
  assert.match(fn, /left\(btrim\(COALESCE\(payload->>'dimensions', ''\)\), 120\)/);
  assert.match(fn, /original_price = CASE WHEN payload \? 'original_price'/);
  assert.match(fn, /dimensions = CASE WHEN payload \? 'dimensions'/);
});

test("Admin client reuses the existing editor and pending save skips books.update", () => {
  assert.match(adminJs, /applyPendingEditChrome\(isPendingSubmissionRow\(b\)\)/);
  assert.match(adminJs, /openPendingSubmissionEdit/);
  assert.match(adminJs, /persistPendingSubmission/);
  assert.match(adminJs, /rpc\("update_pending_staff_book_submission"/);
  const saveStart = adminJs.indexOf("async function saveBook(");
  const saveEnd = adminJs.indexOf("\nasync function toggleActive(");
  const save = adminJs.slice(saveStart, saveEnd);
  assert.match(save, /const pendingSave=pendingEditMode\|\|isPendingSubmissionRow\(editing\)/);
  assert.match(save, /ئۆزگەرتىشلەر ساقلىنىپ بولدى/);
  assert.doesNotMatch(save, /Save and Approve/);
  assert.match(adminHtml, /id="pendingOriginalPrice"/);
  assert.match(adminHtml, />ئەسلى باھا</);
  assert.match(adminHtml, /id="pendingDimensions"/);
  assert.match(adminHtml, />ئۆلچەم</);
  assert.match(adminHtml, /id="pendingColorPrint"/);
  assert.match(adminHtml, />رەڭلىك بېسىش</);
  assert.match(adminJs, /ئىچكى بېسىش تىپى/);
  assert.match(adminJs, /fillPendingReviewFields/);
  assert.match(adminJs, /readPendingReviewFields/);
  const pendingPayload = adminJs.slice(adminJs.indexOf("function pendingEditPayload("), adminJs.indexOf("async function persistPendingSubmission("));
  assert.match(pendingPayload, /original_price/);
  assert.match(pendingPayload, /dimensions/);
  assert.match(pendingPayload, /is_color_print/);
  assert.match(pendingPayload, /interior_print_type/);
});

test("Book Staff and Member clients cannot call pending edit", () => {
  assert.doesNotMatch(staffJs, /update_pending_staff_book_submission/);
  assert.doesNotMatch(staffJs, /\.from\("books"\)\.(insert|update|upsert|delete)/);
  assert.doesNotMatch(memberJs, /update_pending_staff_book_submission/);
  assert.doesNotMatch(shopJs, /update_pending_staff_book_submission/);
  assert.match(staffJs, /rpc\("submit_book_for_approval"/);
});

test("PR 160 isolation and MFA tests remain in the suite", () => {
  assert.match(isolation, /kutadgu-admin-auth-v1/);
  assert.match(isolation, /kutadgu-member-auth-v1/);
  assert.match(mfa, /aal2|AAL2|mfa/i);
  assert.match(adminJs, /kutadgu-admin-auth-v1|KutadguAdmin/);
});

if (failed) {
  console.error("\n" + failed + " stage94 pending book edit test(s) failed");
  process.exit(1);
}
console.log("stage94-pending-book-edit-tests ok");
