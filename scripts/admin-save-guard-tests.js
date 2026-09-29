#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Guard = require(path.join(root, "admin-save-guard.js"));
const Cover = require(path.join(root, "kutadgu-cover-image.js"));
const adminJs = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");

let failed = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.stack || err.message);
      }));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.stack || err.message);
  }
}

function slice(src, start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return src.slice(a, b);
}

test("timeout constants stay long enough for a slow upload", () => {
  assert.strictEqual(Guard.MAX_COVER_BYTES, Cover.MAX_COVER_BYTES);
  assert.strictEqual(Guard.MAX_COVER_BYTES, 50 * 1024 * 1024);
  assert.ok(Guard.STORAGE_UPLOAD_MS >= 180000);
  assert.ok(Guard.BOOK_WRITE_MS >= 30000);
  assert.ok(Guard.DHASH_PAGE_MS >= 30000);
  assert.ok(Guard.IMAGE_DECODE_MS >= 45000);
  assert.ok(Guard.IMAGE_ENCODE_MS >= 30000);
  assert.ok(Guard.DUPLICATE_MS >= 20000);
  assert.ok(Guard.FINGERPRINT_MS >= 20000);
  assert.ok(Guard.CATALOG_REFRESH_MS >= 30000);
  assert.match(Guard.WRITE_TIMEOUT_MESSAGE, /تىزىملىكىنى تەكشۈرۈپ/);
  assert.match(Guard.WRITE_TIMEOUT_MESSAGE, /مۇلازىمېتىر يېزىشنى تاماملىغان بولۇشى مۇمكىن/);
  assert.match(Guard.STATUS.duplicates, /تەكرارلىق/);
  assert.match(Guard.STATUS.cover, /مۇقاۋا تەكشۈرۈلىۋاتىدۇ/);
  assert.match(Guard.STATUS.coverPage(2), /بەت 2/);
  assert.match(Guard.STATUS.prepare, /تەييارلىنىۋاتىدۇ/);
  assert.match(Guard.STATUS.uploadCover, /مۇقاۋا يوللىنىۋاتىدۇ/);
  assert.match(Guard.STATUS.gallery(1, 3), /1 \/ 3/);
  assert.match(Guard.STATUS.saving, /كىتاب ساقلىنىۋاتىدۇ/);
  assert.match(Guard.STATUS.saved, /كىتاب ساقلاندى/);
  assert.match(Guard.STATUS.refresh, /تىزىملىك يېڭىلىنىۋاتىدۇ/);
  assert.match(Guard.STATUS.confirm, /جەزملەنمىسى كۈتۈلىۋاتىدۇ/);
  assert.match(Guard.STATUS.refreshFailed, /كىتاب ساقلاندى/);
  assert.match(Guard.STATUS.refreshFailed, /تىزىملىك يېڭىلانمىدى/);
});

test("withTimeout resolves a fast call and passes the abort signal", async () => {
  let seen = null;
  const value = await Guard.withTimeout((signal) => {
    seen = signal;
    return Promise.resolve("ok");
  }, 1000, "duplicate");
  assert.strictEqual(value, "ok");
  assert.ok(seen && typeof seen.aborted === "boolean");
  assert.strictEqual(seen.aborted, false);
});

test("withTimeout rejects, aborts, and ignores a late success", async () => {
  let aborted = false;
  let late = false;
  await assert.rejects(
    Guard.withTimeout((signal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      return new Promise((resolve) => {
        setTimeout(() => { late = true; resolve("late"); }, 80);
      });
    }, 30, "write"),
    (err) => {
      assert.strictEqual(err.code, "save-timeout");
      assert.strictEqual(err.step, "write");
      assert.strictEqual(Guard.isSaveTimeout(err), true);
      assert.strictEqual(err.message, Guard.WRITE_TIMEOUT_MESSAGE);
      return true;
    }
  );
  assert.strictEqual(aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(late, true);
});

test("applyAbort uses abortSignal only when the builder supports it", () => {
  const calls = [];
  const builder = {
    abortSignal(signal) { calls.push(signal); return this; }
  };
  const signal = new AbortController().signal;
  assert.strictEqual(Guard.applyAbort(builder, signal), builder);
  assert.strictEqual(calls[0], signal);
  const plain = { range() { return "page"; } };
  assert.strictEqual(Guard.applyAbort(plain, signal), plain);
  assert.strictEqual(Guard.applyAbort(builder, undefined), builder);
});

test("save UI names the steps and does not retry a timed-out write", () => {
  assert.match(adminHtml, /id="bookSaveStatus"/);
  assert.match(adminHtml, /admin-save-guard\.js\?v=1/);
  const save = slice(adminJs, "async function saveBook(e){", "async function toggleActive(id){");
  assert.match(save, /if\(saveInFlight\)return/);
  assert.match(save, /const attempt=\+\+saveAttempt/);
  assert.match(save, /coverFormEpoch!==coverEpochAtSave/);
  assert.match(save, /live===coverFile/);
  assert.match(save, /saveStatusText\("duplicates"\)/);
  assert.match(save, /saveStatusText\("cover"\)/);
  assert.match(save, /saveStatusText\("prepare"\)/);
  assert.match(save, /saveStatusText\("uploadCover"\)/);
  assert.match(save, /saveStatusText\("saving"\)/);
  assert.match(save, /saveStatusText\("saved"\)/);
  assert.match(slice(adminJs, "async function collectGalleryUrls(id){", "function coverByteLimit"), /STATUS\.gallery/);
  const confirmFn = slice(adminJs, "async function confirmNearCoverMatch(matches){", "async function optimizeCover(file){");
  assert.match(confirmFn, /setSaveStatus\(saveStatusText\("confirm"\)/);
  assert.match(confirmFn, /ئوخشاش مۇقاۋا جەزملەنمىسى كۈتۈلىۋاتىدۇ/);
  assert.match(save, /BOOK_WRITE_MS,"write"/);
  assert.doesNotMatch(save, /isSaveTimeout\([^)]*\)[\s\S]{0,80}runPersist/);
  const releaseAt = save.indexOf("releaseSaveUi();\n    await refreshCatalogAfterSave(attempt);");
  const failedAt = save.indexOf("ساقلاش مەغلۇپ بولدى");
  assert.ok(releaseAt > 0 && failedAt > releaseAt);
  const refresh = slice(adminJs, "async function refreshCatalogAfterSave(attempt){", "async function saveBook(e){");
  assert.match(refresh, /loadBooks\(\{signal,reportFailure:true\}\)/);
  assert.match(refresh, /loadStats\(\{signal,reportFailure:true\}\)/);
  assert.match(refresh, /refreshFailed/);
  assert.doesNotMatch(refresh, /ساقلاش مەغلۇپ بولدى/);
  assert.match(save, /if\(attempt!==saveAttempt\)return/);
  assert.match(save, /if\(attempt===saveAttempt\)releaseSaveUi\(\)/);
});

test("cover decode is shared and gallery failure stops the save", () => {
  const save = slice(adminJs, "async function saveBook(e){", "async function toggleActive(id){");
  assert.match(save, /decodeCoverBitmap\(coverFile\)/);
  assert.match(save, /optimizeUploadImage\(coverFile,\{bitmap\}\)/);
  assert.match(save, /fingerprintSelectedCover\(coverFile/);
  assert.ok(save.indexOf("coverSha256(file)") === -1);
  const fp = slice(adminJs, "async function fingerprintSelectedCover(file,excludeId", "function duplicateCoverShaError");
  assert.match(fp, /coverSha256\(file\)/);
  assert.match(fp, /hooks\.bitmap\?coverDhashFromBitmap\(hooks\.bitmap\):await coverDhash\(file\)/);
  const gallery = slice(adminJs, "async function collectGalleryUrls(id){", "function coverByteLimit");
  assert.match(gallery, /قوشۇمچە رەسىم /);
  assert.match(gallery, /يوللانمىدى\. ساقلاش توختىتىلدى/);
  assert.doesNotMatch(gallery, /continue/);
  assert.match(adminJs, /MAX_COVER_BYTES/);
  assert.match(adminJs, /بەك چوڭ \(ئەڭ چوڭ 50MB\)/);
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error("\n" + failed + " admin save guard test(s) failed");
    process.exit(1);
  }
  console.log("admin-save-guard-tests ok");
});
