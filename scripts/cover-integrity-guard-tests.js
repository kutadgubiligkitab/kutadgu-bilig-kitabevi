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
const review = sliceFn(admin, "async function reviewStaffSubmission(bookId,action){", "function bindPendingSubmissionActions(){");
assert.match(review, /fingerprintRemoteCover/);
assert.match(review, /if\(!approvalFp\)throw new Error\("مۇقاۋىسى يوق كىتابنى تەستىقلىغىلى بولمايدۇ\."\)/);
assert.match(review, /stampApprovedCoverFingerprint/);
assert.match(review, /db\.rpc\(rpcName,\{p_book_id:Number\(id\)\}\)/);
assert.doesNotMatch(review, /\.from\("books"\)\.update/);
const stamp = sliceFn(admin, "async function stampApprovedCoverFingerprint(id,approvalFp){", "async function reviewStaffSubmission(bookId,action){");
assert.match(stamp, /\.from\("books"\)\.update\(\{cover_sha256:approvalFp\.hash,cover_dhash:approvalFp\.visual\}\)/);
assert.match(stamp, /\.eq\("image_url",approvalFp\.imageUrl\)/);
assert.doesNotMatch(stamp, /image_url:|title:|price:|stock:|isbn:|submission_status/);
const stampAt = review.indexOf("stampApprovedCoverFingerprint");
const rpcAt = review.indexOf("db.rpc(rpcName");
assert.ok(stampAt >= 0 && rpcAt > stampAt);

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
    { id: 6, title: "F", image_url: "https://cdn.example/book-covers/99/cover.webp".replace("book-covers/", "storage/v1/object/public/book-covers/"), sha256: "b".repeat(64), dhash: "fedcba9876543210" },
    { id: 10, title: "Shared prefix", image_url: "https://cdn.example/storage/v1/object/public/book-covers/book/1.webp", sha256: "e".repeat(64), dhash: "1111111111111111" }
  ]);
  const byId = Object.fromEntries(classified.map((row) => [row.id, row.state]));
  assert.strictEqual(byId[1], "EXACT_DUPLICATE");
  assert.strictEqual(byId[2], "EXACT_DUPLICATE");
  assert.strictEqual(byId[3], "NO_COVER");
  assert.strictEqual(byId[4], "BROKEN_URL");
  assert.strictEqual(byId[5], "KNOWN_SAMPLE");
  assert.strictEqual(byId[6], "WRONG_OWNERSHIP");
  assert.strictEqual(byId[10], "HEALTHY_UNIQUE");
  const visual = audit.classifyRecords([
    { id: 7, title: "G", image_url: "https://cdn.example/g.webp", sha256: "c".repeat(64), dhash: "aaaaaaaaaaaaaaaa" },
    { id: 8, title: "H", image_url: "https://cdn.example/h.webp", sha256: "d".repeat(64), dhash: "aaaaaaaaaaaaaaaa" }
  ]);
  assert.deepStrictEqual(visual.map((row) => row.state), ["EXACT_VISUAL_DUPLICATE", "EXACT_VISUAL_DUPLICATE"]);
  assert.strictEqual(audit.dhashDistance("0".repeat(16), "0".repeat(16)), 0);
  assert.strictEqual(audit.dhashDistance("0".repeat(16), "0".repeat(15) + "1"), 1);
  assert.strictEqual(audit.dhashDistance("0".repeat(16), "0".repeat(15) + "7"), 3);
  assert.strictEqual(audit.dhashDistance("zzzz", "0".repeat(16)), null);
  assert.strictEqual(audit.dhashDistance("", null), null);
  assert.strictEqual(audit.COVER_DHASH_REVIEW_DISTANCE, 5);
  const near = audit.classifyRecords([
    { id: 11, title: "بىرىنچى", image_url: "https://cdn.example/11.webp", sha256: "1".repeat(64), dhash: "0".repeat(16) },
    { id: 12, title: "ئىككىنچى", image_url: "https://cdn.example/12.webp", sha256: "2".repeat(64), dhash: "0".repeat(15) + "1" }
  ]);
  assert.deepStrictEqual(near.map((row) => row.state), ["NEAR_VISUAL_DUPLICATE", "NEAR_VISUAL_DUPLICATE"]);
  assert.ok(near.every((row) => row.state !== "HEALTHY_UNIQUE"));
  const far = audit.classifyRecords([
    { id: 13, title: "يىراق", image_url: "https://cdn.example/13.webp", sha256: "3".repeat(64), dhash: "0".repeat(16) },
    { id: 14, title: "باشقا", image_url: "https://cdn.example/14.webp", sha256: "4".repeat(64), dhash: "f".repeat(16) }
  ]);
  assert.deepStrictEqual(far.map((row) => row.state), ["HEALTHY_UNIQUE", "HEALTHY_UNIQUE"]);
  const replacement = {
    bookId: "20",
    path: "20/old.webp",
    imageUrl: "https://cdn.example/20/old.webp",
    sha256: "9".repeat(64),
    dhash: "f".repeat(16)
  };
  const bad = { id: 20, sha256: "8".repeat(64), dhash: "0".repeat(16), state: "EXACT_DUPLICATE" };
  assert.strictEqual(audit.evaluateHistoricalReplacement(bad, [replacement, { ...replacement, path: "20/other.webp", sha256: "7".repeat(64) }]).replacement, null);
  assert.strictEqual(audit.evaluateHistoricalReplacement(bad, [{ ...replacement, sample: true }]).replacement, null);
  assert.strictEqual(audit.evaluateHistoricalReplacement(bad, [{ ...replacement, dhash: "0".repeat(15) + "1" }]).replacement, null);
  assert.strictEqual(audit.evaluateHistoricalReplacement(bad, [replacement]).replacement.path, "20/old.webp");
  const backfill = audit.buildBackfillChanges([
    { id: 1, state: "HEALTHY_UNIQUE", image_url: "https://cdn.example/a.webp", sha256: "a".repeat(64), dhash: "0123456789abcdef", cover_sha256: null, cover_dhash: null },
    { id: 2, state: "EXACT_DUPLICATE", image_url: "https://cdn.example/b.webp", sha256: "b".repeat(64), dhash: "fedcba9876543210" },
    { id: 3, state: "NEAR_VISUAL_DUPLICATE", image_url: "https://cdn.example/c.webp", sha256: "c".repeat(64), dhash: "1111111111111111" },
    { id: 4, state: "EXACT_VISUAL_DUPLICATE", image_url: "https://cdn.example/d.webp", sha256: "d".repeat(64), dhash: "2222222222222222" },
    { id: 5, state: "NO_COVER", image_url: "", sha256: "", dhash: "" }
  ]);
  assert.deepStrictEqual(backfill.map((row) => row.id), [1]);
  assert.deepStrictEqual(Object.keys(backfill[0].patch).sort(), ["cover_dhash", "cover_sha256"]);
  const dupBackfill = audit.buildBackfillChanges([
    { id: 30, state: "HEALTHY_UNIQUE", image_url: "https://cdn.example/30.webp", sha256: "e".repeat(64), dhash: "3333333333333333" },
    { id: 31, state: "HEALTHY_UNIQUE", image_url: "https://cdn.example/31.webp", sha256: "e".repeat(64), dhash: "4444444444444444" }
  ]);
  assert.deepStrictEqual(dupBackfill, []);
  assert.deepStrictEqual(audit.buildSafeRepairChanges([{ id: 9, state: "NEAR_VISUAL_DUPLICATE", image_url: "https://cdn.example/9.webp", replacement: replacement }]), []);
  assert.strictEqual(audit.mutationMode(["--audit"], { KUTADGU_COVER_REPAIR_APPLY: "1", SUPABASE_SERVICE_ROLE_KEY: "secret" }).mutate, false);
  assert.strictEqual(audit.mutationMode(["--apply-safe"], {}).refuse, "gate");
  assert.strictEqual(audit.mutationMode(["--backfill"], { KUTADGU_COVER_REPAIR_APPLY: "1" }).refuse, "service");
  const conflicted = await audit.applyChanges({ url: "https://example.test", key: "k" }, [{
    id: 41,
    title: "قۇر",
    reason: "backfill-healthy",
    expectedImageUrl: "https://cdn.example/41.webp",
    expectedSha: null,
    expectedDhash: null,
    patch: { cover_sha256: "a".repeat(64), cover_dhash: "0123456789abcdef" }
  }], async () => ({ ok: true, status: 200, json: async () => [] }));
  assert.strictEqual(conflicted[0].conflict, true);
  assert.strictEqual(conflicted[0].ok, false);
  const unique = await audit.applyChanges({ url: "https://example.test", key: "k" }, [{
    id: 42,
    title: "تاق",
    reason: "backfill-healthy",
    expectedImageUrl: "https://cdn.example/42.webp",
    expectedSha: null,
    expectedDhash: null,
    patch: { cover_sha256: "b".repeat(64), cover_dhash: "abcdefabcdefabcd" }
  }], async () => ({ ok: false, status: 409, json: async () => ({ code: "23505" }) }));
  assert.strictEqual(unique[0].uniqueConflict, true);
  assert.strictEqual(unique[0].ok, false);

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

  const adminDistance = sliceFn(admin, "function dhashDistance(hashA,hashB){", "function isSampleDemoCoverUrl(src){");
  const adminDhashDistance = new Function(adminDistance + "\nreturn dhashDistance;")();
  assert.strictEqual(adminDhashDistance("0".repeat(16), "0".repeat(15) + "1"), 1);
  assert.match(admin, /const COVER_DHASH_REVIEW_DISTANCE=5/);
  const fpFn = sliceFn(admin, "async function fingerprintSelectedCover(file,excludeId){", "function duplicateCoverShaError(error){");
  assert.match(fpFn, /findCoverFingerprintConflict\(hash,visual,excludeId\)/);
  assert.match(fpFn, /exactVisual\.length\)throw new Error\(duplicateCoverMessage\(exactVisual\[0\]\)\)/);
  assert.ok(fpFn.indexOf("confirmNearCoverMatch") > fpFn.indexOf("findCoverFingerprintConflict"));
  const nearFn = sliceFn(admin, "function nearCoverDecisionMessage(match){", "async function optimizeCover(file){");
  let warning = "";
  global.confirm = (message) => { warning = message; return false; };
  const confirmNearCoverMatch = new Function(nearFn + "\nreturn confirmNearCoverMatch;")();
  await assert.rejects(() => confirmNearCoverMatch([{ id: 77, title: "سىناق كىتاب", distance: 2 }]), /جەزملەنمىدى/);
  assert.match(warning, /سىناق كىتاب/);
  assert.match(warning, /ID 77/);
  assert.match(warning, /2/);
  global.confirm = () => true;
  await confirmNearCoverMatch([{ id: 78, title: "باشقا", distance: 1 }]);
  const nearLookup = sliceFn(admin, "async function findCoverNearDhashMatches(dhash,excludeId){", "function nearCoverDecisionMessage(match){");
  global.presentBookCols = new Set(["cover_sha256", "cover_dhash"]);
  global.canonicalBookId = (id) => id ? String(id) : "";
  global.isMissingCoverSha256ColumnError = () => false;
  global.disableCoverSha256Column = () => {};
  global.COVER_DHASH_REVIEW_DISTANCE = 5;
  global.dhashDistance = adminDhashDistance;
  global.db = {
    from() {
      return {
        select() { return this; },
        not() { return this; },
        order() { return this; },
        range() {
          return Promise.resolve({ data: [
            { id: 1, title: "Keep", cover_dhash: "0".repeat(16) },
            { id: 2, title: "Near", cover_dhash: "0".repeat(15) + "1" },
            { id: 3, title: "Far", cover_dhash: "f".repeat(16) }
          ], error: null });
        }
      };
    }
  };
  const findCoverNearDhashMatches = new Function(nearLookup + "\nreturn findCoverNearDhashMatches;")();
  const nearHits = await findCoverNearDhashMatches("0".repeat(16), "");
  assert.deepStrictEqual(nearHits.map((row) => row.id), [1, 2]);
  assert.strictEqual(nearHits[1].distance, 1);

  const { spawnSync } = require("child_process");
  const cleanEnv = { ...process.env };
  delete cleanEnv.SUPABASE_SERVICE_ROLE_KEY;
  delete cleanEnv.KUTADGU_COVER_REPAIR_APPLY;
  const refused = spawnSync(process.execPath, [path.join(root, "scripts/audit-book-covers.js"), "--apply-safe"], { encoding: "utf8", env: cleanEnv });
  assert.notStrictEqual(refused.status, 0);
  assert.match(refused.stderr + refused.stdout, /REFUSING MUTATION/);
  assert.doesNotMatch(refused.stderr + refused.stdout, /UPDATE public\.books/i);
  const refusedBackfill = spawnSync(process.execPath, [path.join(root, "scripts/audit-book-covers.js"), "--backfill"], { encoding: "utf8", env: cleanEnv });
  assert.strictEqual(refusedBackfill.status, 1);
  assert.match(refusedBackfill.stderr + refusedBackfill.stdout, /REFUSING MUTATION/);
  const noService = { ...cleanEnv, KUTADGU_COVER_REPAIR_APPLY: "1" };
  const applyNoRole = spawnSync(process.execPath, [path.join(root, "scripts/audit-book-covers.js"), "--apply-safe"], { encoding: "utf8", env: noService });
  assert.strictEqual(applyNoRole.status, 2);
  assert.match(applyNoRole.stderr + applyNoRole.stdout, /PRODUCTION REPAIR NOT APPLIED/);
  const backfillNoRole = spawnSync(process.execPath, [path.join(root, "scripts/audit-book-covers.js"), "--backfill"], { encoding: "utf8", env: noService });
  assert.strictEqual(backfillNoRole.status, 2);
  assert.match(backfillNoRole.stderr + backfillNoRole.stdout, /PRODUCTION REPAIR NOT APPLIED/);
  console.log("cover integrity guard tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
