"use strict";

const images = require("../kutadgu-image-storage.js");

const MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = Object.freeze({
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/png": ".png"
});

const CANONICAL_COVER_ORIGIN = "https://www.kutadgubilik.com";

function uploadEnabled(env) {
  return String((env && env.KUTADGU_R2_UPLOAD_ENABLED) || "") === "true";
}

function requestHost(request) {
  try {
    return String(new URL(request.url).hostname || "")
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^\[|\]$/g, "");
  } catch (err) {
    return "";
  }
}

function productionUpload(request, env) {
  if (images.hostMode(env) !== "production" || !uploadEnabled(env)) return false;
  const host = requestHost(request);
  return host === "www.kutadgubilik.com" || host === "kutadgubilik.com";
}

function canonicalCoverUrl(key) {
  const path = images.privateReadPath(key);
  if (!path) return "";
  return CANONICAL_COVER_ORIGIN + path;
}

function staffOwnedKey(key, userId) {
  const id = String(userId || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return false;
  return String(key || "").toLowerCase().indexOf("book-covers/staff/" + id + "/") === 0;
}

function overwriteEnabled(env) {
  return String((env && env.KUTADGU_R2_OVERWRITE) || "") === "true";
}

function bearerToken(request) {
  const header = String(request.headers.get("authorization") || "");
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  const body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
  try {
    const json = typeof Buffer !== "undefined"
      ? Buffer.from(padded, "base64").toString("utf8")
      : atob(padded);
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch (err) {
    return null;
  }
}

function safeObjectKey(raw, contentType) {
  const key = String(raw || "").trim().replace(/^\/+/, "");
  if (!key || key.length > 512) return "";
  if (key.indexOf("..") !== -1 || key.indexOf("\\") !== -1) return "";
  if (!/^book-covers\/[A-Za-z0-9._/-]+$/.test(key)) return "";
  const expected = IMAGE_TYPES[String(contentType || "").toLowerCase()];
  if (!expected) return "";
  const lower = key.toLowerCase();
  if (expected === ".jpg" && !/\.(?:jpg|jpeg)$/.test(lower)) return "";
  if (expected !== ".jpg" && !lower.endsWith(expected)) return "";
  return key;
}

function jsonResponse(status, payload, env, extra) {
  const headers = new Headers(extra || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return { status, headers, body: JSON.stringify(payload) };
}

async function readJson(response) {
  if (!response || typeof response.json !== "function") return null;
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function rpcFlag(fetchImpl, token, name) {
  const response = await fetchImpl(images.SUPABASE_ORIGIN + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: images.SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: "{}"
  });
  if (!response || !response.ok) return false;
  return (await readJson(response)) === true;
}

async function handleR2CoverUpload(request, env, deps) {
  const sourceEnv = env || {};
  if (!productionUpload(request, sourceEnv)) {
    return {
      status: 404,
      headers: new Headers({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }),
      body: "not found"
    };
  }
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }
  const token = bearerToken(request);
  if (!token) return jsonResponse(401, { ok: false, error: "auth_required" });
  const fetchImpl = (deps && deps.fetchImpl) || fetch;
  const userResponse = await fetchImpl(images.SUPABASE_ORIGIN + "/auth/v1/user", {
    method: "GET",
    headers: {
      apikey: images.SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + token
    }
  });
  if (!userResponse || !userResponse.ok) {
    return jsonResponse(401, { ok: false, error: "auth_required" });
  }
  const user = await readJson(userResponse);
  const userId = String(user && user.id || "");
  if (!userId) return jsonResponse(401, { ok: false, error: "auth_required" });
  const payload = decodeJwtPayload(token);
  const aal = String((payload && payload.aal) || "").toLowerCase();
  if (aal !== "aal2") return jsonResponse(403, { ok: false, error: "aal2_required" });
  const isAdmin = await rpcFlag(fetchImpl, token, "is_kutadgu_admin");
  const isStaff = isAdmin ? false : await rpcFlag(fetchImpl, token, "is_kutadgu_book_staff");
  if (!isAdmin && !isStaff) return jsonResponse(403, { ok: false, error: "admin_required" });
  const bucket = sourceEnv.COVERS;
  if (!bucket || typeof bucket.put !== "function" || typeof bucket.head !== "function") {
    return jsonResponse(503, { ok: false, error: "r2_unbound" });
  }
  const contentType = String(request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const key = safeObjectKey(request.headers.get("x-kutadgu-object-key"), contentType);
  if (!key) return jsonResponse(400, { ok: false, error: "invalid_object" });
  if (!isAdmin && !staffOwnedKey(key, userId)) {
    return jsonResponse(403, { ok: false, error: "admin_required" });
  }
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return jsonResponse(413, { ok: false, error: "too_large" });
  }
  const bytes = await request.arrayBuffer();
  if (!bytes || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) {
    return jsonResponse(413, { ok: false, error: "too_large" });
  }
  const existing = await bucket.head(key);
  if (existing && !overwriteEnabled(sourceEnv)) {
    return jsonResponse(409, { ok: false, error: "exists" });
  }
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable"
    }
  });
  const url = canonicalCoverUrl(key);
  if (!url) return jsonResponse(400, { ok: false, error: "invalid_object" });
  return jsonResponse(201, { ok: true, key, url });
}

module.exports = {
  MAX_BYTES,
  CANONICAL_COVER_ORIGIN,
  uploadEnabled,
  productionUpload,
  canonicalCoverUrl,
  staffOwnedKey,
  safeObjectKey,
  handleR2CoverUpload
};
