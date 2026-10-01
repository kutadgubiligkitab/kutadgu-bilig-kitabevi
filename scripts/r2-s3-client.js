"use strict";

const crypto = require("crypto");

const EMPTY_PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function signingKey(secret, dateStamp) {
  const kDate = hmac("AWS4" + secret, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function encodeKey(value) {
  return String(value || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function amzDate(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function assertCopyMethod(method) {
  if (method !== "GET" && method !== "HEAD" && method !== "PUT") {
    throw new Error("r2-method-not-allowed");
  }
}

function signedFetch(options) {
  const method = String(options.method || "GET").toUpperCase();
  assertCopyMethod(method);
  const now = options.now instanceof Date ? options.now : new Date();
  const stamp = amzDate(now);
  const dateStamp = stamp.slice(0, 8);
  const body = options.body == null ? Buffer.alloc(0) : Buffer.from(options.body);
  const payloadHash = method === "PUT" ? sha256Hex(body) : EMPTY_PAYLOAD_HASH;
  const host = String(options.accountId || "") + ".r2.cloudflarestorage.com";
  const canonicalUri = "/" + encodeKey(options.bucket) + (options.key ? "/" + encodeKey(options.key) : "");
  const query = options.query || "";
  const headerMap = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp
  };
  if (options.contentType && method === "PUT") headerMap["content-type"] = options.contentType;
  const names = Object.keys(headerMap).sort();
  const canonicalHeaders = names.map((name) => name + ":" + headerMap[name] + "\n").join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = dateStamp + "/auto/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(options.secretAccessKey, dateStamp))
    .update(stringToSign)
    .digest("hex");
  const authorization = "AWS4-HMAC-SHA256 Credential=" + options.accessKeyId + "/" + scope
    + ", SignedHeaders=" + signedHeaders
    + ", Signature=" + signature;
  const url = "https://" + host + canonicalUri + (query ? "?" + query : "");
  const requestHeaders = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    Authorization: authorization
  };
  if (headerMap["content-type"]) requestHeaders["Content-Type"] = headerMap["content-type"];
  return {
    url,
    method,
    headers: requestHeaders,
    body: method === "PUT" ? body : undefined,
    authorization
  };
}

function createR2Client(options) {
  const fetchImpl = options.fetchImpl;
  async function send(method, key, body, contentType, query) {
    const signed = signedFetch({
      method,
      accountId: options.accountId,
      bucket: options.bucket,
      key,
      body,
      contentType,
      query,
      secretAccessKey: options.secretAccessKey,
      accessKeyId: options.accessKeyId,
      now: options.now,
      fetchImpl
    });
    const response = await fetchImpl(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.body
    });
    return response;
  }
  return {
    head(key) { return send("HEAD", key); },
    put(key, body, contentType) { return send("PUT", key, body, contentType); },
    list(prefix) {
      const query = "list-type=2&prefix=" + encodeURIComponent(prefix || "");
      return send("GET", "", null, "", query);
    }
  };
}

module.exports = {
  EMPTY_PAYLOAD_HASH,
  signedFetch,
  createR2Client
};
