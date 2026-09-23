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
assert.match(repair, /fingerprintSelectedCover\(file,book\.id\)/);
assert.match(repair, /repairQuery\.eq\("image_url",book\.image_url\)/);

const bulk = admin.slice(admin.indexOf("const acceptedCoverJobs=[]"));
assert.ok(bulk.indexOf("const acceptedCoverJobs=[]") === 0);
assert.match(bulk.slice(0, 3500), /patch\.cover_sha256=hash/);
assert.match(bulk.slice(0, 3500), /patch\.cover_dhash=visualHash/);
assert.match(bulk.slice(0, 3500), /fingerprintSelectedCover\(job\.file,job\.id\)/);
assert.match(admin, /function releaseCoverSelection\(\)/);
assert.match(admin, /coverFormEpoch!==coverEpochAtSave/);
assert.match(admin, /KNOWN_SAMPLE_COVER_SHA256/);
assert.match(admin, /image_url:""/);
assert.doesNotMatch(sliceFn(admin, "function rowToUpdate(row){", "function queueRepairButtonHtml"), /rec\.image_url=row\.image_url/);

const shop = read("shop.js");
const ai = read("kutadgu-ai-search-ui.js");
assert.ok(shop.includes("carousel-sample-cover"));
assert.ok(shop.includes("sample-book-cover(?:\\(\\d+\\))?"));
assert.match(shop, /data-cover-book/);
assert.match(shop, /bound&&bound!==state\.bookId/);
assert.match(ai, /carousel-sample-cover/);
assert.match(ai, /data-ai-cover-book/);
assert.match(ai, /img\.isConnected/);
assert.match(read("book-staff.js"), /rejectUnsafeStaffCover/);
assert.match(read("admin-catalog-productivity.js"), /تېز تەھرىردە مۇقاۋا ئالماشتۇرۇلمايدۇ/);

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

  const audit = require("./audit-book-covers.js");
  audit.verifyKnownSamples();
  assert.strictEqual(audit.mutationAllowed(), false);
  const classified = audit.classifyRecords([
    { id: 1, title: "A", image_url: "https://cdn.example/a.webp", sha256: "a".repeat(64), dhash: "0123456789abcdef" },
    { id: 2, title: "B", image_url: "https://cdn.example/a.webp", sha256: "a".repeat(64), dhash: "0123456789abcdef" },
    { id: 3, title: "C", image_url: "", sha256: "", dhash: "" },
    { id: 4, title: "D", image_url: "https://cdn.example/missing.webp", broken: true },
    { id: 5, title: "E", image_url: "/sample-book-cover.png", sha256: audit.SAMPLE_SHA["sample-book-cover.png"], dhash: audit.SAMPLE_DHASH["sample-book-cover.png"] },
    { id: 6, title: "F", image_url: "https://cdn.example/book-covers/99/cover.webp".replace("book-covers/", "storage/v1/object/public/book-covers/"), sha256: "b".repeat(64), dhash: "fedcba9876543210" }
  ]);
  const byId = Object.fromEntries(classified.map((row) => [row.id, row.state]));
  assert.strictEqual(byId[1], "EXACT_DUPLICATE");
  assert.strictEqual(byId[2], "EXACT_DUPLICATE");
  assert.strictEqual(byId[3], "NO_COVER");
  assert.strictEqual(byId[4], "BROKEN_URL");
  assert.strictEqual(byId[5], "KNOWN_SAMPLE");
  assert.strictEqual(byId[6], "WRONG_OWNERSHIP");
  const visual = audit.classifyRecords([
    { id: 7, title: "G", image_url: "https://cdn.example/g.webp", sha256: "c".repeat(64), dhash: "aaaaaaaaaaaaaaaa" },
    { id: 8, title: "H", image_url: "https://cdn.example/h.webp", sha256: "d".repeat(64), dhash: "aaaaaaaaaaaaaaaa" }
  ]);
  assert.deepStrictEqual(visual.map((row) => row.state), ["VISUAL_DUPLICATE", "VISUAL_DUPLICATE"]);

  const calls = [];
  global.presentBookCols = new Set(["cover_sha256", "cover_dhash"]);
  global.canonicalBookId = (id) => id ? String(id) : "";
  global.isMissingCoverSha256ColumnError = () => false;
  global.disableCoverSha256Column = () => {};
  global.db = {
    from() {
      return {
        select() { return this; },
        or(value) { calls.push(value); return this; },
        limit() { return this; },
        neq() { return Promise.resolve({ data: [{ id: 9, title: "Other" }], error: null }); }
      };
    }
  };
  const findCoverFingerprintConflict = new Function(lookup + "\nreturn findCoverFingerprintConflict;")();
  const conflict = await findCoverFingerprintConflict("ab".repeat(32), "cd".repeat(8), "1");
  assert.strictEqual(conflict.id, 9);
  assert.match(calls[0], /cover_sha256\.eq\./);
  assert.match(calls[0], /cover_dhash\.eq\./);

  const { spawnSync } = require("child_process");
  const refused = spawnSync(process.execPath, [path.join(root, "scripts/audit-book-covers.js"), "--apply-safe"], { encoding: "utf8" });
  assert.notStrictEqual(refused.status, 0);
  assert.match(refused.stderr + refused.stdout, /REFUSING MUTATION/);
  assert.doesNotMatch(refused.stderr + refused.stdout, /UPDATE public\.books/i);
  console.log("cover integrity guard tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
