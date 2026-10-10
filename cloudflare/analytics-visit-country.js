"use strict";

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const MAX_BODY_BYTES = 8192;
const COLUMNS = [
  "event_name",
  "book_id",
  "search_query",
  "category",
  "result_count",
  "item_count",
  "order_total",
  "path",
  "session_id",
  "legacy_id",
  "meta",
  "visitor_id",
  "event_id"
];

function serverKey(env) {
  return String((env && env.SUPABASE_SECRET_KEY) || "").trim();
}

function trustedCountry(cf) {
  const raw = cf && typeof cf === "object" ? cf.country : "";
  const code = String(raw == null ? "" : raw).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX") return null;
  return code;
}

function emptyResult(status) {
  return {
    status,
    body: "",
    headers: { "Cache-Control": "private, no-store" }
  };
}

async function readBoundedBody(request) {
  const declared = Number(request && request.headers && request.headers.get && request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  if (!request || typeof request.text !== "function") return { ok: true, body: "" };
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return { ok: false, status: 413 };
  return { ok: true, body };
}

function rowFromBody(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = {};
  COLUMNS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) row[key] = parsed[key];
  });
  if (!row.event_name) return null;
  return row;
}

function missingCountryColumn(status, text) {
  return status === 400 && /country/i.test(String(text || "")) && /PGRST204|column/i.test(String(text || ""));
}

async function insertEvent(env, fetchImpl, row) {
  const key = serverKey(env);
  const response = await fetchImpl(SUPABASE_URL + "/rest/v1/analytics_events", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });
  const text = response.status === 400 ? await response.text() : "";
  return { status: response.status, text };
}

async function handleAnalyticsEvent(request, env, deps) {
  const method = String((request && request.method) || "GET").toUpperCase();
  if (method !== "POST") return emptyResult(405);
  const limited = await readBoundedBody(request);
  if (!limited.ok) return emptyResult(limited.status || 413);
  const row = rowFromBody(limited.body);
  if (!row) return emptyResult(400);
  const fetchImpl = deps && deps.fetchImpl;
  if (!serverKey(env) || typeof fetchImpl !== "function") return emptyResult(503);
  const country = trustedCountry(request && request.cf);
  const withCountry = Object.assign({}, row);
  if (country && row.event_name === "page_view") withCountry.country = country;
  let stored;
  try {
    stored = await insertEvent(env, fetchImpl, withCountry);
    if (missingCountryColumn(stored.status, stored.text)) {
      stored = await insertEvent(env, fetchImpl, row);
    }
  } catch (err) {
    return emptyResult(503);
  }
  if (stored.status === 409 || (stored.status >= 200 && stored.status < 300)) {
    return emptyResult(stored.status === 409 ? 409 : 204);
  }
  if (stored.status >= 500 || stored.status === 400 || stored.status === 401 || stored.status === 403 || stored.status === 404) {
    return emptyResult(503);
  }
  return emptyResult(503);
}

module.exports = {
  SUPABASE_URL,
  MAX_BODY_BYTES,
  trustedCountry,
  rowFromBody,
  handleAnalyticsEvent
};
