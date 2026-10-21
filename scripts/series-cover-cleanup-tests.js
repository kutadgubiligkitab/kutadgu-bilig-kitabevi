"use strict";

const assert = require("assert");
const upload = require("../cloudflare/r2-cover-upload.js");
const preview = require("../cloudflare/preview-dispatch.js");

function jwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return "e30." + body + ".sig";
}
function request(url, headers) {
  return {
    method: "POST",
    url,
    headers: {
      get(name) { return headers[String(name).toLowerCase()] || ""; }
    }
  };
}
const draft = "book-covers/series-new/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/part-1-stamp.webp";
const env = {
  KUTADGU_HOST_MODE: "production",
  KUTADGU_R2_UPLOAD_ENABLED: "true",
  COVERS: { delete: async (key) => { deleted.push(key); } }
};
let deleted = [];

function adminFetch(rows) {
  return async (url) => {
    const href = String(url);
    const body = href.endsWith("/auth/v1/user")
      ? { id: "admin" }
      : href.endsWith("/rpc/is_kutadgu_admin")
        ? true
        : rows;
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

(async () => {
  assert.strictEqual(preview.classifyPath("/api/r2-series-cover-delete", "").kind, "r2-series-cover-delete");
  assert.strictEqual(upload.isSeriesDraftKey(draft), true);
  assert.strictEqual(upload.isSeriesDraftKey("book-covers/book/156.webp"), false);
  assert.strictEqual(upload.isSeriesDraftKey("book-covers/hero/store-slides/slot-1-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp"), false);

  const headers = {
    authorization: "Bearer " + jwt({ aal: "aal2" }),
    "x-kutadgu-object-key": "book-covers/book/156.webp"
  };
  const blocked = await upload.handleR2SeriesCoverDelete(
    request("https://www.kutadgubilik.com/api/r2-series-cover-delete", headers),
    env,
    { fetchImpl: adminFetch([]) }
  );
  assert.strictEqual(blocked.status, 400);
  assert.deepStrictEqual(deleted, []);

  const low = await upload.handleR2SeriesCoverDelete(
    request("https://www.kutadgubilik.com/api/r2-series-cover-delete", {
      authorization: "Bearer " + jwt({ aal: "aal1" }),
      "x-kutadgu-object-key": draft
    }),
    env,
    { fetchImpl: adminFetch([]) }
  );
  assert.strictEqual(low.status, 403);

  const referenced = await upload.handleR2SeriesCoverDelete(
    request("https://www.kutadgubilik.com/api/r2-series-cover-delete", {
      authorization: "Bearer " + jwt({ aal: "aal2" }),
      "x-kutadgu-object-key": draft
    }),
    env,
    { fetchImpl: adminFetch([{ id: 1 }]) }
  );
  assert.strictEqual(referenced.status, 409);
  assert.deepStrictEqual(deleted, []);

  const removed = await upload.handleR2SeriesCoverDelete(
    request("https://www.kutadgubilik.com/api/r2-series-cover-delete", {
      authorization: "Bearer " + jwt({ aal: "aal2" }),
      "x-kutadgu-object-key": draft
    }),
    env,
    { fetchImpl: adminFetch([]) }
  );
  assert.strictEqual(removed.status, 200);
  assert.deepStrictEqual(deleted, [draft]);
  console.log("series cover cleanup: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
