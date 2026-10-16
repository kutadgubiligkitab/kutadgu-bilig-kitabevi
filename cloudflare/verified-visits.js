"use strict";

const visitCountry = require("./analytics-visit-country.js");

const COOKIE_NAME = "kb_visit";
const ACTION = "visit";
const PROOF_TTL_SECONDS = 12 * 60 * 60;
const COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5000;
const PRODUCTION_HOSTS = Object.freeze(["kutadgubilik.com", "www.kutadgubilik.com"]);
const DUMMY_KEY = /^[123]x00000000000000000000/i;

function normalizeHost(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}

function isProductionHost(hostname) {
  return PRODUCTION_HOSTS.indexOf(normalizeHost(hostname)) !== -1;
}

function productionMode(env, hostname) {
  return String((env && env.KUTADGU_HOST_MODE) || "") === "production" || isProductionHost(hostname);
}

function expectedHosts(env, hostname) {
  const host = normalizeHost(hostname);
  if (productionMode(env, host)) return PRODUCTION_HOSTS.slice();
  return String((env && env.KUTADGU_VISIT_HOSTS) || "")
    .split(",")
    .map(normalizeHost)
    .filter((item) => item && item !== "localhost" && item !== "127.0.0.1" && item !== "::1");
}

function cleanSecret(value) {
  return String(value || "").trim();
}

function dummyKey(value) {
  return DUMMY_KEY.test(cleanSecret(value));
}

function configurationProblem(env, hostname) {
  const siteKey = cleanSecret(env && env.TURNSTILE_SITE_KEY);
  const secret = cleanSecret(env && env.TURNSTILE_SECRET_KEY);
  const signing = cleanSecret(env && env.VISIT_SIGNING_SECRET);
  if (!siteKey || !secret || signing.length < 32) return "missing";
  if (productionMode(env, hostname) && (dummyKey(siteKey) || dummyKey(secret))) return "test_key";
  if (!expectedHosts(env, hostname).length) return "missing";
  return "";
}

function bytesToB64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToString(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToB64url(new Uint8Array(signature));
}

function uuidV4() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

function isUuidV4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

function readCookie(request, name) {
  const header = String(request.headers.get("cookie") || "");
  const parts = header.split(";");
  for (let i = 0; i < parts.length; i += 1) {
    const piece = parts[i].trim();
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    if (piece.slice(0, eq).trim() === name) return piece.slice(eq + 1).trim();
  }
  return "";
}

async function readIdentity(request, env, nowSeconds) {
  const signing = cleanSecret(env && env.VISIT_SIGNING_SECRET);
  if (signing.length < 32) return null;
  const raw = readCookie(request, COOKIE_NAME);
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "kbv1") return null;
  const expected = await hmac(signing, parts[0] + "." + parts[1]);
  if (!safeEqual(expected, parts[2])) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch (err) {
    return null;
  }
  if (!payload || payload.v !== 1 || !isUuidV4(payload.id)) return null;
  const iat = Number(payload.iat);
  const exp = Number(payload.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (iat > nowSeconds + 60) return null;
  if (nowSeconds - iat > COOKIE_MAX_AGE_SECONDS) return null;
  return {
    id: String(payload.id).toLowerCase(),
    iat,
    exp,
    current: exp > nowSeconds
  };
}

async function issueCookie(identity, env, hostname, nowSeconds) {
  const payload = JSON.stringify({
    v: 1,
    id: identity,
    iat: nowSeconds,
    exp: nowSeconds + PROOF_TTL_SECONDS
  });
  const body = bytesToB64url(new TextEncoder().encode(payload));
  const signature = await hmac(cleanSecret(env.VISIT_SIGNING_SECRET), "kbv1." + body);
  const host = normalizeHost(hostname);
  const domain = isProductionHost(host) ? "; Domain=.kutadgubilik.com" : "";
  return COOKIE_NAME + "=kbv1." + body + "." + signature
    + "; Path=/; Max-Age=" + COOKIE_MAX_AGE_SECONDS
    + "; HttpOnly; Secure; SameSite=Lax" + domain;
}

function jsonResult(status, body, extraHeaders) {
  const headers = Object.assign({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store"
  }, extraHeaders || {});
  return { status, body: JSON.stringify(body), headers };
}

function serverKey(env) {
  return String((env && env.SUPABASE_SECRET_KEY) || "").trim();
}

function fetchImpl(source) {
  if (source && typeof source.fetchImpl === "function") return source.fetchImpl;
  return globalThis.fetch.bind(globalThis);
}

async function rpc(env, source, name, args) {
  const key = serverKey(env);
  if (!key) return { ok: false, status: 0, body: null };
  const response = await fetchImpl(source)(visitCountry.SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args || {})
  });
  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

async function noteOutage(env, source) {
  try {
    await rpc(env, source, "kutadgu_note_verified_outage", {});
  } catch (err) {
    return;
  }
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) return null;
  const text = await request.text();
  if (text.length > 4096) return null;
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function hostOf(request) {
  try {
    return new URL(request.url).hostname;
  } catch (err) {
    return "";
  }
}

async function verifyToken(token, env, hostname, source) {
  const secret = cleanSecret(env.TURNSTILE_SECRET_KEY);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetchImpl(source)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: controller ? controller.signal : undefined
    });
  } catch (err) {
    return { outcome: "outage" };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response || response.status !== 200) return { outcome: "outage" };
  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return { outcome: "outage" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { outcome: "outage" };
  const errors = Array.isArray(payload["error-codes"]) ? payload["error-codes"].map(String) : [];
  if (errors.indexOf("missing-input-secret") !== -1 || errors.indexOf("invalid-input-secret") !== -1) {
    return { outcome: "outage" };
  }
  if (errors.indexOf("internal-error") !== -1 && payload.success !== true) return { outcome: "outage" };
  if (payload.success !== true) return { outcome: "reject", errors };
  const tokenHost = normalizeHost(payload.hostname);
  const requestHost = normalizeHost(hostname);
  if (!tokenHost || tokenHost !== requestHost || expectedHosts(env, requestHost).indexOf(tokenHost) === -1) {
    return { outcome: "reject", errors: ["hostname"] };
  }
  if (payload.action !== ACTION) return { outcome: "reject", errors: ["action"] };
  return { outcome: "pass", hostname: tokenHost };
}

async function handleVisitConfig(request, env) {
  const host = hostOf(request);
  const problem = configurationProblem(env, host);
  return jsonResult(200, {
    configured: !problem,
    siteKey: problem ? null : cleanSecret(env.TURNSTILE_SITE_KEY),
    action: ACTION
  });
}

async function handleVisitProof(request, env, source) {
  const host = hostOf(request);
  const problem = configurationProblem(env, host);
  if (problem) {
    await noteOutage(env, source);
    return jsonResult(503, { ok: false, counted: false, reason: problem });
  }
  const body = await readJson(request);
  const token = body && typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 2048 || (body && body.action && body.action !== ACTION)) {
    return jsonResult(400, { ok: false, counted: false, reason: "missing_proof" });
  }
  const verdict = await verifyToken(token, env, host, source);
  if (verdict.outcome === "outage") {
    await noteOutage(env, source);
    return jsonResult(503, { ok: false, counted: false, reason: "verification_unavailable" });
  }
  const hash = await sha256Hex(token);
  if (verdict.outcome !== "pass") {
    return jsonResult(403, { ok: false, counted: false, reason: "verification_rejected" });
  }
  let consumed;
  try {
    consumed = await rpc(env, source, "kutadgu_consume_visit_proof", { p_token_hash: hash });
  } catch (err) {
    await noteOutage(env, source);
    return jsonResult(503, { ok: false, counted: false, reason: "verification_unavailable" });
  }
  if (consumed && consumed.body === false) {
    return jsonResult(403, { ok: false, counted: false, reason: "replayed_proof" });
  }
  if (!consumed || !consumed.ok || consumed.body !== true) {
    await noteOutage(env, source);
    return jsonResult(503, { ok: false, counted: false, reason: "verification_unavailable" });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const existing = await readIdentity(request, env, nowSeconds);
  const visitorId = existing ? existing.id : uuidV4();
  const cookie = await issueCookie(visitorId, env, host, nowSeconds);
  return jsonResult(200, { ok: true, counted: false, reason: "proof_accepted" }, { "set-cookie": cookie });
}

async function handleVisitCount(request, env, source) {
  const host = hostOf(request);
  const problem = configurationProblem(env, host);
  if (problem) {
    await noteOutage(env, source);
    return jsonResult(503, { ok: false, counted: false, reason: problem });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const identity = await readIdentity(request, env, nowSeconds);
  if (!identity) return jsonResult(403, { ok: false, counted: false, reason: "cookie_missing" });
  if (!identity.current) return jsonResult(403, { ok: false, counted: false, reason: "verification_expired" });
  const body = await readJson(request);
  const eventId = body && typeof body.event_id === "string" ? body.event_id.trim().toLowerCase() : "";
  if (!isUuidV4(eventId)) return jsonResult(400, { ok: false, counted: false, reason: "bad_event_id" });
  const country = visitCountry.trustedCountry(request.cf);
  const recorded = await rpc(env, source, "kutadgu_accept_verified_visit", {
    p_visitor_id: identity.id,
    p_event_id: eventId,
    p_country: country
  });
  if (!recorded.ok || typeof recorded.body !== "boolean") {
    await noteOutage(env, source);
    return jsonResult(503, { ok: false, counted: false, reason: "verification_unavailable" });
  }
  return jsonResult(200, { ok: true, counted: recorded.body, reason: recorded.body ? "accepted" : "suppressed" });
}

module.exports = {
  COOKIE_NAME,
  ACTION,
  PROOF_TTL_SECONDS,
  COOKIE_MAX_AGE_SECONDS,
  SITEVERIFY_URL,
  PRODUCTION_HOSTS,
  configurationProblem,
  expectedHosts,
  dummyKey,
  handleVisitConfig,
  handleVisitProof,
  handleVisitCount,
  readIdentity,
  issueCookie,
  uuidV4,
  isUuidV4
};
