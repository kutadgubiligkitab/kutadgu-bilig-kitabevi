"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const migration = read("STAGE87_COVER_INTEGRITY.sql");
const admin = read("admin.js");
const config = read("supabase-config.js");
const premium = read("premium-ux.js");

function sliceFn(src, startLabel, endLabel) {
  const start = src.indexOf(startLabel);
  const end = endLabel ? src.indexOf(endLabel, start + startLabel.length) : src.length;
  assert.ok(start >= 0, "missing " + startLabel);
  assert.ok(end > start, "missing end after " + startLabel);
  return src.slice(start, end);
}

assert.match(migration, /ADD COLUMN IF NOT EXISTS cover_sha256 text NULL/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS cover_dhash text NULL/);
assert.match(migration, /books_cover_sha256_format_chk/);
assert.match(migration, /books_cover_dhash_format_chk/);
assert.match(migration, /\^\[0-9a-f\]\{64\}\$/);
assert.match(migration, /\^\[0-9a-f\]\{16\}\$/);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS books_cover_sha256_unique_idx/);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS books_cover_dhash_unique_idx/);
assert.match(migration, /WHERE cover_sha256 IS NOT NULL/);
assert.match(migration, /WHERE cover_dhash IS NOT NULL/);
assert.doesNotMatch(migration, /UPDATE\s+public\.books/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.books/i);
assert.doesNotMatch(migration, /\bDELETE\b/i);
assert.doesNotMatch(migration, /TRUNCATE/i);
assert.doesNotMatch(migration, /ROW LEVEL SECURITY/i);
assert.doesNotMatch(migration, /image_url\s*=/i);
assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
assert.match(migration, /^BEGIN;/m);
assert.match(migration, /^COMMIT;/m);

assert.match(config, /cover_sha256:\s*false/);
assert.match(config, /cover_dhash:\s*false/);

assert.match(admin, /async function detectOptionalCoverSha256Column/);
assert.match(admin, /select\("cover_sha256,cover_dhash"\)/);
assert.match(admin, /function enableCoverSha256Column/);
assert.match(admin, /function disableCoverSha256Column/);

const shaFn = sliceFn(admin, "async function coverSha256(file){", "async function coverDhash(file){");
assert.match(shaFn, /crypto\.subtle\.digest\("SHA-256",bytes\)/);
const dhashFn = sliceFn(admin, "async function coverDhash(file){", "async function findCoverFingerprintConflict");
assert.match(dhashFn, /canvas\.width=9;canvas\.height=8/);
assert.match(dhashFn, /gray\(x,y\)>gray\(x\+1,y\)/);

const lookup = sliceFn(admin, "async function findCoverFingerprintConflict", "function duplicateCoverShaError");
assert.match(lookup, /cover_sha256\.eq\./);
assert.match(lookup, /cover_dhash\.eq\./);
assert.match(lookup, /\.or\(filters\.join\(","\)\)/);
assert.doesNotMatch(lookup, /\.eq\("cover_sha256",key\)/);

const save = sliceFn(admin, "async function saveBook(e){", "async function toggleActive(id){");
assert.match(save, /if\(!isEdit&&!pendingSave&&!coverFile\)/);
assert.match(save, /يېڭى كىتابقا مۇقاۋا رەسىمى تاللاش كېرەك/);
assert.match(save, /row\.cover_sha256=coverHash;row\.cover_dhash=coverVisualHash/);
const preview = sliceFn(admin, "function skipAuthPreviewCoverUrl(id,file){", "async function uploadCover(id,file){");
assert.match(preview, /admin-preview-covers/);
assert.doesNotMatch(preview, /sample-book-cover/);
const upload = sliceFn(admin, "async function uploadCover(id,file){", "async function persistBookRow");
assert.match(upload, /if\(!file\)return editing\?\.image_url\|\|""/);
assert.match(upload, /if\(!db&&window\.__kutadguSkipAdminAuth\)return skipAuthPreviewCoverUrl/);
assert.doesNotMatch(upload, /sample-book-cover/);

const repair = sliceFn(admin, "async function confirmCoverRepair(){", "function refreshImportPreviewFromInputs(){");
assert.match(repair, /payload\.cover_sha256=hash/);
assert.match(repair, /payload\.cover_dhash=visualHash/);
assert.match(repair, /findCoverFingerprintConflict\(hash,visualHash,book\.id\)/);

const bulk = admin.slice(admin.indexOf("const coverResults=await ImportCovers.mapPool"));
assert.ok(bulk.indexOf("const coverResults=await ImportCovers.mapPool") === 0);
assert.match(bulk.slice(0, 2500), /patch\.cover_sha256=hash/);
assert.match(bulk.slice(0, 2500), /patch\.cover_dhash=visualHash/);
assert.match(bulk.slice(0, 2500), /findCoverFingerprintConflict\(hash,visualHash,job\.id\)/);

assert.match(premium, /function isSampleDemoCover/);
assert.match(premium, /if\(!value\|\|isSampleDemoCover\(value\)\)return ""/);
assert.match(premium, /book-cover-unavailable/);
assert.doesNotMatch(premium, /fallbackCover\s*=/);
assert.doesNotMatch(premium, /\.src\s*=\s*["'][^"']*sample-book-cover/);
assert.doesNotMatch(premium, /src=["']\/sample-book-cover\.png["']/);
assert.doesNotMatch(premium, /src=["']\/carousel-sample-cover\.png["']/);

(async () => {
  global.window = global;
  const coverSha256 = new Function(shaFn + "\nreturn coverSha256;")();
  const bytes = Buffer.from("kutadgu-cover-integrity");
  const digest = await coverSha256({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  const expected = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.strictEqual(digest, expected);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.strictEqual(await coverSha256(null), "");
  console.log("cover integrity guard tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
