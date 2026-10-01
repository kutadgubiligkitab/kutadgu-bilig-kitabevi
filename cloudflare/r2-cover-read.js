"use strict";

const headers = require("./security-headers.js");
const images = require("../kutadgu-image-storage.js");

function readEnabled(env) {
  return images.previewReadEnabled(env || {});
}

function textResult(status, body) {
  const out = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  return { status, headers: out, body };
}

function storedImageHeaders(object) {
  const out = new Headers();
  if (object && typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(out);
  const meta = object && object.httpMetadata || {};
  if (!out.get("content-type") && meta.contentType) out.set("content-type", meta.contentType);
  if (!out.get("cache-control")) out.set("cache-control", meta.cacheControl || images.IMMUTABLE_CACHE);
  const etag = object && (object.httpEtag || object.etag) || "";
  if (etag) out.set("etag", etag);
  if (object && object.size != null) out.set("content-length", String(object.size));
  return out;
}

async function handleR2CoverRead(request, env) {
  const sourceEnv = env || {};
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return textResult(405, "method not allowed");
  if (!readEnabled(sourceEnv)) return textResult(404, "not found");
  const url = new URL(request.url);
  if (!images.previewHostAllowsRead(url.hostname)) return textResult(404, "not found");
  const key = images.privateObjectKeyFromPath(url.pathname);
  if (!key) return textResult(400, "not found");
  const bucket = sourceEnv.COVERS;
  if (!bucket || typeof bucket.get !== "function") return textResult(404, "not found");
  const object = method === "HEAD" && typeof bucket.head === "function"
    ? await bucket.head(key)
    : await bucket.get(key);
  if (!object) return textResult(404, "not found");
  const out = storedImageHeaders(object);
  headers.applySecurity(out, sourceEnv);
  return {
    status: 200,
    headers: out,
    body: method === "HEAD" ? null : object.body
  };
}

module.exports = {
  handleR2CoverRead
};
