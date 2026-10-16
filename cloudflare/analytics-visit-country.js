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

function emptyResult(status, eventId, attestationOutage) {
  return {
    status,
    body: "",
    eventId: eventId || "",
    attestationOutage: Boolean(attestationOutage),
    headers: { "Cache-Control": "private, no-store" }
  };
}

function storedEventId(row) {
  const value = row && row.event_id != null ? String(row.event_id).trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : "";
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

function ingestResult(status, text) {
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    body = null;
  }
  return { status, text, body };
}

async function ingestEvent(env, fetchImpl, event, visitorId) {
  const key = serverKey(env);
  const response = await fetchImpl(SUPABASE_URL + "/rest/v1/rpc/kutadgu_ingest_analytics_event", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      p_event: event,
      p_visitor_id: visitorId || null
    })
  });
  const text = await response.text();
  return ingestResult(response.status, text);
}

function storedStatus(stored, eventId) {
  if (stored.status === 409) return emptyResult(409, eventId);
  if (stored.status >= 200 && stored.status < 300) {
    const outcome = stored.body && stored.body.result;
    if (outcome === "inserted") return emptyResult(204, eventId);
    if (outcome === "retry" || outcome === "conflict") return emptyResult(409, eventId);
    if (outcome === "rejected") return emptyResult(400);
  }
  return null;
}

async function handleAnalyticsEvent(request, env, deps, visitorId) {
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
  const trustedVisitor = typeof visitorId === "string" && visitorId ? visitorId : null;
  let stored;
  try {
    stored = await ingestEvent(env, fetchImpl, withCountry, trustedVisitor);
    if (missingCountryColumn(stored.status, stored.text)) {
      stored = await ingestEvent(env, fetchImpl, row, trustedVisitor);
    }
  } catch (err) {
    return emptyResult(503, "", Boolean(trustedVisitor));
  }
  const mapped = storedStatus(stored, storedEventId(row));
  if (mapped) return mapped;
  return emptyResult(503, "", Boolean(trustedVisitor));
}

module.exports = {
  SUPABASE_URL,
  MAX_BODY_BYTES,
  trustedCountry,
  rowFromBody,
  handleAnalyticsEvent
};
