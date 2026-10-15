"use strict";

const visitCountry = require("./analytics-visit-country.js");

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const PUBLIC_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const MAX_BODY_BYTES = 2048;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function emptyResult(status) {
  return { status, body: "" };
}

function serverKey(env) {
  return String((env && env.SUPABASE_SECRET_KEY) || "").trim();
}

function headerValue(request, name) {
  if (!request || !request.headers || typeof request.headers.get !== "function") return "";
  return String(request.headers.get(name) || "");
}

function bearerToken(request) {
  const value = headerValue(request, "authorization").trim();
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  if (!match) return "";
  const token = match[1];
  if (!token || token.length > 8192) return "";
  return token;
}

async function readBoundedBody(request) {
  const declared = Number(request && request.headers && request.headers.get && request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  if (!request || typeof request.text !== "function") return { ok: true, body: "" };
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return { ok: false, status: 413 };
  return { ok: true, body };
}

function pagePath(text) {
  let parsed;
  try {
    parsed = JSON.parse(text || "");
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!Object.prototype.hasOwnProperty.call(parsed, "page_path")) return "";
  const page = parsed.page_path;
  if (page == null) return "";
  if (typeof page !== "string" || page.length > 500) return null;
  return page;
}

async function verifiedUserId(fetchImpl, token) {
  const response = await fetchImpl(SUPABASE_URL + "/auth/v1/user", {
    method: "GET",
    headers: {
      apikey: PUBLIC_KEY,
      Authorization: "Bearer " + token,
      Accept: "application/json"
    }
  });
  if (!response || response.status !== 200) return "";
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch (err) {
    return "";
  }
  const id = String(payload && payload.id || "").trim().toLowerCase();
  return UUID_RE.test(id) ? id : "";
}

async function recordVisit(env, fetchImpl, userId, page, country, observedAt) {
  const key = serverKey(env);
  return fetchImpl(SUPABASE_URL + "/rest/v1/rpc/record_member_last_visit", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_page: page,
      p_country: country,
      p_observed_at: observedAt
    })
  });
}

function observationTime(deps) {
  const now = deps && typeof deps.now === "function" ? deps.now() : new Date();
  const date = now instanceof Date ? now : new Date(now);
  return date.toISOString();
}

async function handleMemberVisit(request, env, deps) {
  const observedAt = observationTime(deps);
  const method = String((request && request.method) || "GET").toUpperCase();
  if (method !== "POST") return emptyResult(405);
  const limited = await readBoundedBody(request);
  if (!limited.ok) return emptyResult(limited.status || 413);
  const page = pagePath(limited.body);
  if (page == null) return emptyResult(400);
  const token = bearerToken(request);
  const fetchImpl = deps && deps.fetchImpl;
  if (!token) return emptyResult(401);
  if (!serverKey(env) || typeof fetchImpl !== "function") return emptyResult(503);
  let userId = "";
  try {
    userId = await verifiedUserId(fetchImpl, token);
  } catch (err) {
    return emptyResult(401);
  }
  if (!userId) return emptyResult(401);
  const country = visitCountry.trustedCountry(request && request.cf);
  let stored;
  try {
    stored = await recordVisit(env, fetchImpl, userId, page, country, observedAt);
  } catch (err) {
    return emptyResult(503);
  }
  if (stored && stored.status >= 200 && stored.status < 300) return emptyResult(204);
  return emptyResult(503);
}

module.exports = {
  SUPABASE_URL,
  PUBLIC_KEY,
  handleMemberVisit
};
