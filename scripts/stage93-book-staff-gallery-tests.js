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

const sql = read("STAGE93_BOOK_STAFF_GALLERY.sql");
const stage92 = read("STAGE92_BOOK_STAFF_SECURITY.sql");
const galleryConstraint = read("GALLERY_IMAGES_MIGRATION.sql");
const adminJs = read("admin.js");
const shopJs = read("shop.js");
const staffJs = read("book-staff.js");

function functionBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`CREATE OR REPLACE FUNCTION ${escaped}\([\s\S]*?\$[a-z]*\$;`,
    "i"
  ));
  assert.ok(match, "missing function " + name);
  return match[0];
}

const ORIGIN = "https://fxlojnqwyojqjskfggmh.supabase.co";
const PUBLIC_PREFIX = ORIGIN + "/storage/v1/object/public/book-covers/";

function staffGalleryAllowed(uid, url) {
  const prefix = PUBLIC_PREFIX + "staff/" + uid + "/gallery/";
  if (url == null) return true;
  if (typeof url !== "string") return false;
  const t = url.trim();
  if (!t) return false;
  if (t.length > 2000) return false;
  if (t.includes("..") || /[?#@]/.test(t) || /^(javascript|data|vbscript|file):/i.test(t)) return false;
  if (!t.startsWith(prefix)) return false;
  const rest = t.slice(prefix.length);
  if (!rest || rest.includes("/") || !/^[A-Za-z0-9._-]+$/.test(rest)) return false;
  return true;
}

test("Stage93 is a review-only submit_book_for_approval replacement", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(sql, /Does not apply itself to production/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.submit_book_for_approval\(payload jsonb\)/);
  assert.doesNotMatch(sql, /CREATE POLICY|ALTER TABLE|DROP POLICY|ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /approve_staff_book_submission|reject_staff_book_submission/);
  assert.doesNotMatch(sql, /ALTER TABLE|DROP CONSTRAINT|CREATE POLICY/);
  assert.match(galleryConstraint, /jsonb_array_length\(gallery_images\) <= 4/);
});

test("gallery_images is allowed and other publication fields stay forbidden", () => {
  const fn = functionBlock(sql, "public.submit_book_for_approval");
  const forbidden = fn.match(/v_forbidden text\[\] := ARRAY\[[\s\S]*?\];/);
  const allowed = fn.match(/v_allowed text\[\] := ARRAY\[[\s\S]*?\];/);
  assert.ok(forbidden && allowed, "missing allowed/forbidden arrays");
  assert.doesNotMatch(forbidden[0], /'gallery_images'/);
  assert.match(allowed[0], /'gallery_images'/);
  assert.match(forbidden[0], /'is_active'/);
  assert.match(forbidden[0], /'is_available'/);
  assert.match(forbidden[0], /'submission_status'/);
  assert.match(forbidden[0], /'submitted_by'/);
  assert.match(fn, /auth\.jwt\(\)->>'aal'\) IS DISTINCT FROM 'aal2'/);
  assert.match(fn, /is_kutadgu_book_staff\(\)/);
  assert.match(fn, /false,\s*false,\s*false,\s*false,\s*false,\s*false,\s*0,\s*'pending',\s*v_uid,\s*now\(\)/);
  assert.doesNotMatch(fn, /is_active\s*=\s*true/);
  assert.doesNotMatch(fn, /payload->>'is_active'/);
  assert.match(stage92, /'gallery_images'/);
});

test("server gallery validation accepts own URLs and rejects unsafe payloads", () => {
  const fn = functionBlock(sql, "public.submit_book_for_approval");
  assert.match(fn, /gallery_images must be a JSON array/);
  assert.match(fn, /gallery_images may contain at most 4 items/);
  assert.match(fn, /gallery_images items must be strings/);
  assert.match(fn, /gallery_images URL is invalid/);
  assert.match(fn, /gallery_images must be book-covers staff gallery URLs for this user/);
  assert.match(fn, /v_gallery_len := jsonb_array_length\(payload->'gallery_images'\)/);
  assert.match(fn, /IF v_gallery_len > 4 THEN/);
  assert.match(fn, /v_gallery := '\[\]'::jsonb/);
  assert.match(fn, /v_gallery := v_gallery \|\| jsonb_build_array\(v_gallery_url\)/);
  const uid = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const own = PUBLIC_PREFIX + "staff/" + uid + "/gallery/a.jpg";
  assert.strictEqual(staffGalleryAllowed(uid, own), true);
  assert.strictEqual(staffGalleryAllowed(uid, PUBLIC_PREFIX + "staff/" + other + "/gallery/a.jpg"), false);
  assert.strictEqual(staffGalleryAllowed(uid, PUBLIC_PREFIX + "staff/" + uid + "/cover.jpg"), false);
  assert.strictEqual(staffGalleryAllowed(uid, "https://evil.example/storage/v1/object/public/book-covers/staff/" + uid + "/gallery/a.jpg"), false);
  assert.strictEqual(staffGalleryAllowed(uid, own + "?x=1"), false);
  assert.strictEqual(staffGalleryAllowed(uid, own + "#x"), false);
  assert.strictEqual(staffGalleryAllowed(uid, PUBLIC_PREFIX + "staff/" + uid + "/gallery/../a.jpg"), false);
  assert.strictEqual(staffGalleryAllowed(uid, "javascript:alert(1)"), false);
  assert.strictEqual(staffGalleryAllowed(uid, "data:image/png;base64,xx"), false);
  assert.strictEqual(staffGalleryAllowed(uid, ""), false);
  assert.match(fn, /javascript\|data\|vbscript\|file/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_book_for_approval\(jsonb\) TO authenticated/);
});

test("staff client still cannot write books or use admin privileges", () => {
  assert.doesNotMatch(staffJs, /\.from\("books"\)\.(insert|update|upsert|delete)/);
  assert.doesNotMatch(staffJs, /is_kutadgu_admin/);
  assert.doesNotMatch(staffJs, /admin_users/);
  assert.match(staffJs, /rpc\("submit_book_for_approval",\{payload:payload\}\)/);
  assert.match(staffJs, /level!=="aal2"/);
  assert.match(staffJs, /staff\/"\+String\(uid\)\+"\/gallery\//);
  assert.match(staffJs, /upsert:false/);
});

test("Admin pending review shows gallery read-only and approval RPCs stay unchanged", () => {
  assert.match(adminJs, /gallery_images,submitted_by,submitted_at,submission_status"/);
  assert.match(adminJs, /function pendingGalleryUrls/);
  assert.match(adminJs, /admin-submission-gallery/);
  assert.match(adminJs, /isSafeCoverUrl\(url\)/);
  const renderStart = adminJs.indexOf("function renderPendingSubmissions(");
  const renderEnd = adminJs.indexOf("\nasync function loadPendingSubmissions(");
  const render = adminJs.slice(renderStart, renderEnd);
  assert.doesNotMatch(render, /type="file"|data-gallery-remove|galleryDraft/);
  assert.match(adminJs, /approve_staff_book_submission/);
  assert.match(adminJs, /reject_staff_book_submission/);
  const review = adminJs.slice(adminJs.indexOf("async function reviewStaffSubmission("), adminJs.indexOf("\nfunction bindPendingSubmissionActions("));
  assert.doesNotMatch(review, /\.from\("books"\)\.update/);
});

test("storefront gallery helper is unchanged and still reads galleryImages arrays", () => {
  assert.match(shopJs, /function detailGallerySlides\(book\)/);
  assert.match(shopJs, /normalizeGalleryImages\(book\?\.galleryImages\|\|\[\],book\?\.image\|\|""\)/);
  assert.doesNotMatch(sql, /kutadgu-logo|hero-brand|sample-book-cover/);
});

if (failed) {
  console.error("\n" + failed + " stage93 book-staff gallery test(s) failed");
  process.exit(1);
}
console.log("stage93-book-staff-gallery-tests ok");
