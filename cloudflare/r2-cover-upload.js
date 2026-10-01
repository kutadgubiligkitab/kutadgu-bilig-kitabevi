"use strict";

const images = require("../kutadgu-image-storage.js");

const MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = Object.freeze({
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/png": ".png"
});

function uploadEnabled(env) {
  return String((env && env.KUTADGU_R2_UPLOAD_ENABLED) || "") === "true";
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

async function handleR2CoverUpload(request, env, deps) {
  const sourceEnv = env || {};
  if (!uploadEnabled(sourceEnv)) {
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
  const payload = decodeJwtPayload(token);
  const aal = String((payload && payload.aal) || "").toLowerCase();
  if (aal !== "aal2") return jsonResponse(403, { ok: false, error: "aal2_required" });
  const adminResponse = await fetchImpl(images.SUPABASE_ORIGIN + "/rest/v1/rpc/is_kutadgu_admin", {
    method: "POST",
    headers: {
      apikey: images.SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: "{}"
  });
  let isAdmin = false;
  if (adminResponse && adminResponse.ok && typeof adminResponse.json === "function") {
    try {
      isAdmin = (await adminResponse.json()) === true;
    } catch (err) {
      isAdmin = false;
    }
  }
  if (!isAdmin) return jsonResponse(403, { ok: false, error: "admin_required" });
  const bucket = sourceEnv.COVERS;
  if (!bucket || typeof bucket.put !== "function" || typeof bucket.head !== "function") {
    return jsonResponse(503, { ok: false, error: "r2_unbound" });
  }
  const contentType = String(request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const key = safeObjectKey(request.headers.get("x-kutadgu-object-key"), contentType);
  if (!key) return jsonResponse(400, { ok: false, error: "invalid_object" });
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
  const publicUrl = images.futurePublicUrl(key, {
    r2PublicBase: sourceEnv.KUTADGU_R2_PUBLIC_BASE_URL || ""
  });
  return jsonResponse(201, { ok: true, key, publicUrl });
}

module.exports = {
  MAX_BYTES,
  uploadEnabled,
  safeObjectKey,
  handleR2CoverUpload
};
