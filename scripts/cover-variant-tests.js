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
  "book-covers/variants/v1/w480/311/cover.webp"
);
assert.strictEqual(variants.variantObjectKey("book-covers/hero/banner.webp", 480), "");
assert.strictEqual(variants.variantObjectKey("book-covers/313/cover.gif", 480), "");
assert.strictEqual(variants.variantObjectKey("book-covers/variants/v1/w480/311/cover.webp", 480), "");
assert.strictEqual(variants.variantObjectKey("https://evil.example/x.webp", 480), "");
assert.deepStrictEqual(variants.eligibleWidths(300), []);
assert.deepStrictEqual(variants.eligibleWidths(640), [480]);
assert.deepStrictEqual(variants.eligibleWidths(1600), [480, 960]);

const set = variants.srcsetFor(ORIGINAL);
assert.ok(set.includes("/__r2/book-covers/variants/v1/w480/311/cover.webp 480w"));
assert.ok(set.includes("/__r2/book-covers/variants/v1/w960/311/cover.webp 960w"));
assert.ok(!set.includes(" 1600w"));
assert.strictEqual(variants.srcsetFor("https://www.kutadgubilik.com/__r2/book-covers/hero/banner.webp"), "");
assert.ok(variants.deliveryAttributes(ORIGINAL, variants.DETAIL_SIZES).includes('sizes="(max-width: 700px) min(92vw, 560px), 560px"'));

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

console.log("cover variant tests passed");
