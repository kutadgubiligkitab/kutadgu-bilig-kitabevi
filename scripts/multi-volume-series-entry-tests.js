"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
global.KUTADGU_APP_CONFIG = { featureFlags: { multiVolumeBooks: false } };
require(path.join(root, "admin-volume-groups.js"));
const groups = global.KutadguAdminVolumeGroups;
const volumes = require(path.join(root, "kutadgu-volume-groups.js"));

const requestId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function cover(position) {
  return `https://www.kutadgubilik.com/__r2/book-covers/series-new/${requestId}/part-${position}-stamp.webp`;
}
function part(position, price) {
  return { title: "", price, stock: 4, isbn: "", imageUrl: cover(position), main: position === 1 };
}
function entry(count, price) {
  return groups.seriesEntryPayload({
    requestId,
    title: "ئويغانغان زېمىن",
    author: "ئابدۇرېھىم ئۆتكۈر",
    category: "تارىخىي رومانلار",
    source: "tarikhiy-romanlar.html",
    description: "سىناق",
    completeSetPrice: price,
    parts: Array.from({ length: count }, (_, index) => part(index + 1, 100 + index))
  });
}

assert.strictEqual(volumes.groupSetPrice({
  complete_set_price: "750",
  members: [{ price: 370 }, { price: 399 }]
}), 750);
assert.strictEqual(volumes.groupSetPrice({
  complete_set_price: null,
  members: [{ price: 370 }, { price: 399 }]
}), 769);

[2, 3, 9].forEach((count) => {
  const built = entry(count, "");
  assert.strictEqual(built.ok, true, built.message);
  assert.strictEqual(built.payload.parts.length, count);
  assert.strictEqual(built.payload.complete_set_price, null);
  assert.strictEqual(built.payload.representative_position, 1);
  assert.strictEqual(built.payload.parts[0].volume_label, "1-قىسىم");
  assert.strictEqual(built.payload.parts[count - 1].price, 100 + count - 1);
});

const explicit = entry(2, 750);
assert.strictEqual(explicit.ok, true);
assert.strictEqual(explicit.payload.complete_set_price, 750);
assert.notStrictEqual(explicit.payload.complete_set_price, 100 + 101);

const missingCover = groups.seriesEntryPayload({
  requestId,
  title: "نام",
  category: "تارىخىي رومانلار",
  source: "tarikhiy-romanlar.html",
  completeSetPrice: "",
  parts: [part(1, 10), { ...part(2, 20), imageUrl: "" }]
});
assert.strictEqual(missingCover.ok, false);

const sql = fs.readFileSync(path.join(root, "STAGE131_BOOK_VOLUME_SERIES_ENTRY.sql"), "utf8");
assert.match(sql, /Admin AAL2 required/);
assert.match(sql, /book_volume_series_requests/);
assert.match(sql, /admin_create_book_volume_series/);
assert.match(sql, /idempotency_payload_mismatch/);
assert.match(sql, /series_not_private/);
assert.match(sql, /explicit_price_replaced/);
assert.match(sql, /series_draft/);
assert.match(sql, /admin_get_book_volume_series_request/);
assert.match(sql, /series_draft_cover_is_referenced/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /submission_status = 'series_draft'/);
assert.doesNotMatch(sql, /UPDATE public\.book_volume_groups\s+SET[\s\S]{0,80}WHERE id = 1/);
assert.match(sql, /list_public_book_volume_part_prices/);
assert.match(fs.readFileSync(path.join(root, "app-config.js"), "utf8"), /multiVolumeBooks:false/);

console.log("multi-volume series entry: PASS");
