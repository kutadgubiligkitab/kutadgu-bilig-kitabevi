"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const variants = require("../kutadgu-cover-variants.js");
const cover = require("../kutadgu-cover-image.js");
const { buildManifest, main } = require("./cover-variant-manifest.js");

const ORIGINAL = "https://www.kutadgubilik.com/__r2/book-covers/311/cover.webp";

assert.strictEqual(cover.MAX_EDGE, 1600);
assert.strictEqual(cover.WEBP_QUALITY, 0.92);
assert.notStrictEqual(variants.WEBP_QUALITY, 0.75);
assert.deepStrictEqual(variants.WIDTHS, [480, 960]);

assert.strictEqual(
  variants.variantObjectKey("book-covers/311/cover.webp", 480),
  "book-covers/variants/v1/w480/311/cover.webp.webp"
);
assert.notStrictEqual(
  variants.variantObjectKey("book-covers/311/cover.jpg", 480),
  variants.variantObjectKey("book-covers/311/cover.png", 480)
);
assert.notStrictEqual(
  variants.variantObjectKey("book-covers/311/cover.jpg", 480),
  variants.variantObjectKey("book-covers/311/cover-2.jpg", 480)
);
assert.strictEqual(variants.variantObjectKey("book-covers/hero/banner.webp", 480), "");
assert.strictEqual(variants.variantObjectKey("book-covers/313/cover.gif", 480), "");
assert.strictEqual(variants.variantObjectKey("book-covers/variants/v1/w480/311/cover.webp", 480), "");
assert.strictEqual(variants.variantObjectKey("https://evil.example/x.webp", 480), "");
assert.deepStrictEqual(variants.eligibleWidths(), []);
assert.deepStrictEqual(variants.eligibleWidths(300), []);
assert.deepStrictEqual(variants.eligibleWidths(640), [480]);
assert.deepStrictEqual(variants.eligibleWidths(1600), [480, 960]);

assert.strictEqual(variants.srcsetFor(ORIGINAL), "");
variants.useAvailability({
  sources: {
    "book-covers/311/cover.webp": {
      width: 1600,
      height: 2400,
      variants: [
        { width: 480, height: 720, bytes: 10, key: variants.variantObjectKey("book-covers/311/cover.webp", 480) },
        { width: 960, height: 1440, bytes: 20, key: variants.variantObjectKey("book-covers/311/cover.webp", 960) }
      ]
    },
    "book-covers/312/cover.webp": {
      width: 800,
      height: 1200,
      variants: [
        { width: 480, height: 720, bytes: 10, key: variants.variantObjectKey("book-covers/312/cover.webp", 480) }
      ]
    }
  }
});
const set = variants.srcsetFor(ORIGINAL);
assert.ok(set.includes("/__r2/book-covers/variants/v1/w480/311/cover.webp.webp 480w"));
assert.ok(set.includes("/__r2/book-covers/variants/v1/w960/311/cover.webp.webp 960w"));
assert.ok(!set.includes(" 1600w"));
assert.ok(!variants.srcsetFor("https://www.kutadgubilik.com/__r2/book-covers/312/cover.webp").includes("960w"));
assert.ok(variants.deliveryAttributes(ORIGINAL, variants.DETAIL_SIZES).includes('sizes="(max-width: 700px) min(92vw, 560px), 560px"'));
variants.useAvailability(require("../data/cover-variant-availability.json"));
assert.strictEqual(variants.srcsetFor(ORIGINAL), "");
assert.strictEqual(variants.srcsetFor("https://www.kutadgubilik.com/__r2/book-covers/hero/banner.webp"), "");
assert.strictEqual(variants.deliveryAttributes(ORIGINAL, variants.DETAIL_SIZES), "");

const manifest = buildManifest(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "cover-variant-sources.json"), "utf8")));
assert.strictEqual(manifest.dryRun, true);
assert.strictEqual(manifest.plans[0].variants.length, 2);
assert.strictEqual(manifest.plans[1].skip, "not-larger-than-variant");
assert.strictEqual(manifest.plans[2].skip, "ineligible");
assert.strictEqual(manifest.plans[3].skip, "ineligible");
assert.strictEqual(manifest.plans[4].skip, "ineligible");
assert.strictEqual(manifest.uploadCount, 2);

const out = path.join(__dirname, "..", "artifacts", "cover-variants", "fixture-manifest.json");
main(["node", "cover-variant-manifest.js", path.join(__dirname, "fixtures", "cover-variant-sources.json"), "--out", out]);
assert.strictEqual(JSON.parse(fs.readFileSync(out, "utf8")).dryRun, true);
assert.throws(() => main(["node", "cover-variant-manifest.js", "--upload"]), /does not upload/);

const shop = fs.readFileSync(path.join(__dirname, "..", "shop.js"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "kutadgu-public-book.js"), "utf8");
const upload = fs.readFileSync(path.join(__dirname, "..", "kutadgu-cover-image.js"), "utf8");
assert.match(shop, /dropFailedDeliveryCandidate/);
assert.match(shop, /cover-zoom-overlay/);
assert.match(shop, /KutadguCoverVariants/);
assert.match(server, /DETAIL_SIZES/);
assert.match(server, /og:image/);
assert.match(upload, /uploadDeliveryVariants/);
assert.ok(upload.indexOf("payload.url!==expected") < upload.indexOf("uploadDeliveryVariants"));

const quality = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", "cover-variants", "quality.json"), "utf8"));
const light = quality.rows.filter((row) => row.kind === "light" && row.width === 480);
const at = (q) => light.find((row) => row.quality === q);
assert.ok(at(0.82).changedRatio <= at(0.92).changedRatio + 0.001);
assert.ok(at(0.75).changedRatio > at(0.82).changedRatio);
assert.ok(quality.rows.every((row) => row.alphaLost === 0));
assert.strictEqual(variants.isAnimatedImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "image/gif"), true);
assert.strictEqual(variants.isAnimatedImage(Buffer.from("RIFFxxxxWEBPANIM"), "image/webp"), true);
assert.strictEqual(variants.isAnimatedImage(Buffer.from("RIFFxxxxWEBPVP8 "), "image/webp"), false);

const staffId = "11111111-1111-4111-8111-111111111111";
const staffSource = "book-covers/staff/" + staffId + "/cover.webp";
const staffVariant = variants.variantObjectKey(staffSource, 480);
assert.ok(staffVariant.indexOf("book-covers/staff/" + staffId + "/variants/v1/w480/") === 0);
assert.ok(staffVariant.endsWith("cover.webp.webp"));
assert.ok(variants.variantObjectKey("book-covers/staff/" + staffId + "/variants/v1/w480/cover.webp.webp", 480) === "");

const uploadHandler = require("../cloudflare/r2-cover-upload.js");
function jwt(payload) {
  return "eyJhbGciOiJub25lIn0." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".sig";
}
function httpResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function uploadRequest(key, bytes, extra) {
  return new Request("https://www.kutadgubilik.com/api/r2-cover-upload", {
    method: "POST",
    body: bytes,
    headers: Object.assign({
      Authorization: "Bearer " + jwt({ aal: "aal2" }),
      "Content-Type": "image/webp",
      "x-kutadgu-object-key": key
    }, extra || {})
  });
}
const bucket = {
  objects: new Map(),
  failAvailability: false,
  hangAvailability: false,
  async head(key) { return this.objects.has(key) ? { key } : null; },
  async get(key) {
    if (this.hangAvailability && String(key).endsWith("availability.json")) return new Promise(() => {});
    if (!this.objects.has(key)) return null;
    const body = this.objects.get(key);
    return { body, etag: "etag-" + String(body).length, text: async () => Buffer.isBuffer(body) ? body.toString("utf8") : String(body) };
  },
  async put(key, bytes) {
    if (this.failAvailability && String(key).endsWith("availability.json")) throw new Error("availability-failed");
    this.objects.set(key, typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes));
  }
};
const env = {
  KUTADGU_HOST_MODE: "production",
  KUTADGU_R2_UPLOAD_ENABLED: "true",
  KUTADGU_R2_OVERWRITE: "false",
  COVERS: bucket
};
function authFetch(admin) {
  return async (url) => {
    const href = String(url);
    if (href.endsWith("/auth/v1/user")) return httpResponse(200, { id: staffId });
    if (href.endsWith("/rpc/is_kutadgu_admin")) return httpResponse(200, admin);
    if (href.endsWith("/rpc/is_kutadgu_book_staff")) return httpResponse(200, !admin);
    return httpResponse(404, {});
  };
}

(async () => {
  const bytes = Buffer.from("webp");
  const master = await uploadHandler.handleR2CoverUpload(uploadRequest(staffSource, bytes), env, { fetchImpl: authFetch(false) });
  assert.strictEqual(master.status, 201);
  const owned = await uploadHandler.handleR2CoverUpload(uploadRequest(staffVariant, bytes, {
    "x-kutadgu-source-key": staffSource,
    "x-kutadgu-source-width": "1000",
    "x-kutadgu-source-height": "1500"
  }), env, { fetchImpl: authFetch(false) });
  assert.strictEqual(owned.status, 201);
  assert.strictEqual(JSON.parse(owned.body).key, staffVariant);
  assert.strictEqual(JSON.parse(owned.body).availability, "published");
  assert.ok(bucket.objects.has(variants.availabilityDocumentKey(staffSource)));
  assert.ok(!bucket.objects.has(variants.GLOBAL_AVAILABILITY_KEY));
  const globalVariant = await uploadHandler.handleR2CoverUpload(uploadRequest("book-covers/variants/v1/w480/staff/" + staffId + "/cover.webp.webp", bytes), env, { fetchImpl: authFetch(false) });
  assert.strictEqual(globalVariant.status, 403);
  assert.strictEqual(JSON.parse(globalVariant.body).error, "admin_required");
  const other = await uploadHandler.handleR2CoverUpload(uploadRequest("book-covers/staff/22222222-2222-4222-8222-222222222222/variants/v1/w480/cover.webp.webp", bytes), env, { fetchImpl: authFetch(false) });
  assert.strictEqual(other.status, 403);
  const adminVariant = variants.variantObjectKey("book-covers/311/cover.webp", 480);
  const adminOk = await uploadHandler.handleR2CoverUpload(uploadRequest(adminVariant, bytes), env, { fetchImpl: authFetch(true) });
  assert.strictEqual(adminOk.status, 201);

  const sourceKey = "book-covers/311/cover.webp";
  const expected = cover.canonicalPrivateCoverUrl(sourceKey);
  variants.useAvailability({ sources: {} });
  const started = Date.now();
  const stalled = await cover.postR2CoverUpload({
    token: "token",
    objectKey: sourceKey,
    contentType: "image/webp",
    body: Uint8Array.from([1, 2, 3, 4]).buffer,
    variantBudgetMs: 30,
    encodeVariants() { return new Promise(() => {}); },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, url: expected, key: sourceKey }) })
  });
  assert.strictEqual(stalled, expected);
  assert.ok(Date.now() - started < 500);
  assert.strictEqual(variants.srcsetFor(ORIGINAL), "");

  let variantCalls = 0;
  const fetchStall = await cover.postR2CoverUpload({
    token: "token",
    objectKey: sourceKey,
    contentType: "image/webp",
    body: Uint8Array.from([1, 2, 3, 4]).buffer,
    variantBudgetMs: 30,
    encodeVariants() {
      return [{ width: 480, height: 720, sourceWidth: 1600, sourceHeight: 2400, bytes: 8, body: Uint8Array.from([9]).buffer }];
    },
    fetchImpl: async (url, init) => {
      const key = init.headers["x-kutadgu-object-key"];
      if (key === sourceKey) return { ok: true, json: async () => ({ ok: true, url: expected, key: sourceKey }) };
      variantCalls += 1;
      return new Promise(() => {});
    }
  });
  assert.strictEqual(fetchStall, expected);
  assert.strictEqual(variantCalls, 1);
  assert.strictEqual(variants.srcsetFor(ORIGINAL), "");

  const variantKey = variants.variantObjectKey(sourceKey, 480);
  const denied = await cover.postR2CoverUpload({
    token: "token",
    objectKey: sourceKey,
    contentType: "image/webp",
    body: Uint8Array.from([1, 2, 3, 4]).buffer,
    variantBudgetMs: 200,
    encodeVariants() {
      return [{ width: 480, height: 720, sourceWidth: 1600, sourceHeight: 2400, bytes: 8, body: Uint8Array.from([9]).buffer }];
    },
    fetchImpl: async (url, init) => {
      const key = init.headers["x-kutadgu-object-key"];
      if (key === sourceKey) return { ok: true, status: 201, json: async () => ({ ok: true, url: expected, key: sourceKey }) };
      return { ok: false, status: 403, json: async () => ({ ok: false, error: "admin_required" }) };
    }
  });
  assert.strictEqual(denied, expected);
  assert.strictEqual(variants.srcsetFor(ORIGINAL), "");

  const accepted = await cover.postR2CoverUpload({
    token: "token",
    objectKey: sourceKey,
    contentType: "image/webp",
    body: Uint8Array.from([1, 2, 3, 4]).buffer,
    variantBudgetMs: 200,
    encodeVariants() {
      return [{ width: 480, height: 720, sourceWidth: 1600, sourceHeight: 2400, bytes: 8, body: Uint8Array.from([9]).buffer }];
    },
    fetchImpl: async (url, init) => {
      const key = init.headers["x-kutadgu-object-key"];
      if (key === sourceKey) return { ok: true, status: 201, json: async () => ({ ok: true, url: expected, key: sourceKey }) };
      return { ok: true, status: 201, json: async () => ({ ok: true, key: variantKey, url: variants.publicUrlForKey(variantKey), availability: "published" }) };
    }
  });
  assert.strictEqual(accepted, expected);
  assert.ok(variants.srcsetFor(ORIGINAL).includes("480w"));
  assert.ok(!variants.srcsetFor(ORIGINAL).includes("960w"));

  const books = require("../kutadgu-public-book.js");
  variants.useAvailability({
    sources: {
      "book-covers/311/cover.webp": {
        width: 800,
        height: 1200,
        variants: [{ width: 480, height: 720, bytes: 10, key: variants.variantObjectKey("book-covers/311/cover.webp", 480) }]
      }
    }
  });
  const shell = '<html><head><title>old</title></head><body><div class="book-cover-box"><img src="" alt="" hidden></div><div class="book-detail-info"><h1>old</h1></div></body></html>';
  const page = books.applyFoundPublicBookHead(shell, "311", {
    id: "311",
    title: "قۇتادغۇ بىلىك",
    image_url: ORIGINAL
  });
  assert.match(page, /w480\/311\/cover\.webp\.webp 480w/);
  assert.match(page, /cover\.webp 800w/);
  assert.ok(!variants.deliveryAttributes(ORIGINAL, variants.CARD_SIZES).includes("800w"));
  assert.doesNotMatch(page, /960w/);
  assert.match(page, /property="og:image"/);
  assert.ok(!page.includes("960w"));

  const durableSource = "book-covers/420/cover.webp";
  const durableUrl = "https://www.kutadgubilik.com/__r2/" + durableSource;
  const durableVariant = variants.variantObjectKey(durableSource, 480);
  const durable = await uploadHandler.handleR2CoverUpload(uploadRequest(durableVariant, bytes, {
    "x-kutadgu-source-key": durableSource,
    "x-kutadgu-source-width": "1600",
    "x-kutadgu-source-height": "2400"
  }), env, { fetchImpl: authFetch(true) });
  assert.strictEqual(durable.status, 201);
  assert.strictEqual(JSON.parse(durable.body).availability, "published");
  variants.resetAvailabilityMemory();
  assert.strictEqual(variants.srcsetFor(durableUrl), "");
  await variants.readPublishedAvailability({ bucket, sourceUrl: durableUrl, now: 1000 });
  assert.ok(variants.srcsetFor(durableUrl, variants.CARD_SIZES).includes("480w"));
  assert.ok(variants.srcsetFor(durableUrl, variants.DETAIL_SIZES).includes("1600w"));
  const freshPage = books.applyFoundPublicBookHead(shell, "420", { id: "420", title: "يېڭى", image_url: durableUrl });
  assert.match(freshPage, /w480\/420\/cover\.webp\.webp 480w/);
  assert.match(freshPage, /420\/cover\.webp 1600w/);

  const stored = JSON.parse(bucket.objects.get(variants.GLOBAL_AVAILABILITY_KEY).toString("utf8"));
  stored.sources[durableSource].variants.push({ width: 960, height: 1440, bytes: 4, key: variants.variantObjectKey(durableSource, 960) });
  bucket.objects.set(variants.GLOBAL_AVAILABILITY_KEY, Buffer.from(JSON.stringify(stored)));
  await variants.readPublishedAvailability({ bucket, sourceUrl: durableUrl, now: 2000 });
  assert.ok(!variants.srcsetFor(durableUrl).includes("960w"));
  await variants.readPublishedAvailability({ bucket, sourceUrl: durableUrl, now: 1000 + variants.AVAILABILITY_CACHE_MS + 1 });
  assert.ok(variants.srcsetFor(durableUrl).includes("960w"));

  const staffUrl = "https://www.kutadgubilik.com/__r2/" + staffSource;
  variants.resetAvailabilityMemory();
  await variants.readPublishedAvailability({ bucket, sourceUrl: staffUrl, now: 5000 });
  assert.ok(variants.srcsetFor(staffUrl).includes("480w"));
  assert.ok(variants.srcsetFor(staffUrl).includes("/staff/" + staffId + "/variants/"));

  bucket.failAvailability = true;
  const failedSource = "book-covers/421/cover.webp";
  const failedVariant = variants.variantObjectKey(failedSource, 480);
  const failed = await uploadHandler.handleR2CoverUpload(uploadRequest(failedVariant, bytes, {
    "x-kutadgu-source-key": failedSource,
    "x-kutadgu-source-height": "1500",
    "x-kutadgu-source-width": "1200"
  }), env, { fetchImpl: authFetch(true) });
  assert.strictEqual(failed.status, 201);
  assert.strictEqual(JSON.parse(failed.body).availability, "unpublished");
  assert.ok(bucket.objects.has(failedVariant));
  variants.resetAvailabilityMemory();
  await variants.readPublishedAvailability({ bucket, sourceUrl: "https://www.kutadgubilik.com/__r2/" + failedSource, now: 90000 });
  assert.strictEqual(variants.srcsetFor("https://www.kutadgubilik.com/__r2/" + failedSource), "");
  bucket.failAvailability = false;

  const mismatched = await uploadHandler.handleR2CoverUpload(uploadRequest("book-covers/staff/" + staffId + "/other.webp", bytes, {
    "x-kutadgu-source-key": "book-covers/311/cover.webp",
    "x-kutadgu-source-width": "1600",
    "x-kutadgu-source-height": "2400"
  }), env, { fetchImpl: authFetch(false) });
  assert.strictEqual(mismatched.status, 201);
  assert.strictEqual(JSON.parse(mismatched.body).availability, "unpublished");

  const hanging = {
    async get() { return new Promise(() => {}); },
    async put() { throw new Error("should not publish"); }
  };
  const timed = Date.now();
  const timeoutResult = await variants.publishStoredAvailability(hanging, {
    sourceKey: durableSource,
    sourceWidth: 1600,
    sourceHeight: 2400,
    variantKey: durableVariant,
    budgetMs: 30
  });
  assert.strictEqual(timeoutResult.published, false);
  assert.ok(Date.now() - timed < 500);

  const inventory = require("./cover-variant-generate.js");
  const memberCover = "https://www.kutadgubilik.com/__r2/book-covers/book/member.webp";
  const representativeCover = "https://www.kutadgubilik.com/__r2/book-covers/book/representative.webp";
  const calls = [];
  const fakeFetch = async (url, init) => {
    const name = String(url).split("/").pop();
    const body = JSON.parse(init.body);
    calls.push(name + ":" + JSON.stringify(body));
    if (name === "query_public_book_catalog") {
      if (body.p_query.offset === 0 && body.p_query.limit === 1) return { ok: true, json: async () => ({ total: 2, items: [] }) };
      return { ok: true, json: async () => ({ total: 2, items: [
        { unit_id: "book:1", kind: "book", image_url: representativeCover },
        { unit_id: "group:9", kind: "group", group_id: 9, image_url: representativeCover }
      ] }) };
    }
    if (name === "list_public_book_volume_sitemap_entries") {
      return { ok: true, json: async () => ({ total: 2, items: [
        { unit_id: "book:1", kind: "book" },
        { unit_id: "group:9", kind: "group", group_id: 9 }
      ] }) };
    }
    if (name === "get_public_book_volume_group_storefront") {
      return { ok: true, json: async () => ({ group_id: 9, members: [
        { book_id: 1, image_url: representativeCover },
        { book_id: 2, image_url: memberCover }
      ] }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const found = await inventory.collectPublicCoverSources(fakeFetch);
  assert.deepStrictEqual(found.sources.map((item) => item.key).sort(), [
    "book-covers/book/member.webp",
    "book-covers/book/representative.webp"
  ]);
  assert.strictEqual(found.catalogueUnits, 2);
  await assert.rejects(() => inventory.collectPublicCoverSources(async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith("query_public_book_catalog") && body.p_query.limit === 1) return { ok: true, json: async () => ({ total: 2, items: [] }) };
    if (String(url).endsWith("query_public_book_catalog")) return { ok: true, json: async () => ({ total: 1, items: [{ unit_id: "book:1", kind: "book", image_url: representativeCover }] }) };
    return { ok: true, json: async () => ({ total: 1, items: [] }) };
  }), /catalogue changed|catalogue incomplete/);
  console.log("cover variant tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
