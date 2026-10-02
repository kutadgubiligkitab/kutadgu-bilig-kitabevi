"use strict";

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const CANONICAL_ORIGIN = "https://www.kutadgubilik.com";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/;
const SHORT_PAGE_RE = /^\/c\/([ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8})$/;
const READ_PATH_RE = /^\/api\/shared-cart\/([ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8})$/;
const MAX_ITEMS = 80;
const MAX_QTY = 99;
const MAX_BODY_BYTES = 8192;
const MAX_ID_LENGTH = 18;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const INSERT_ATTEMPTS = 5;
const CREATE_LIMIT = 300;
const CREATE_WINDOW_MINUTES = 10;
const CREATE_DAY_LIMIT = 1000;
const CREATE_WINDOW_HOURS = 24;
const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});

function serverKey(env) {
  return String((env && env.SUPABASE_SECRET_KEY) || "").trim();
}

function jsonResult(status, body) {
  return { status, headers: JSON_HEADERS, body };
}

function unavailable() {
  return jsonResult(503, { ok: false, error: "unavailable" });
}

function invalid(error) {
  return jsonResult(400, { ok: false, error: error || "invalid" });
}

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value == null ? "" : value), "utf8");
}

function generateShortCode() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw Object.assign(new Error("unavailable"), { code: "unavailable" });
  }
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let code = "";
  while (code.length < 8) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    for (let index = 0; index < bytes.length && code.length < 8; index += 1) {
      const byte = bytes[index];
      if (byte >= limit) continue;
      code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

function canonicalShortUrl(code) {
  return CANONICAL_ORIGIN + "/c/" + code;
}

function asCanonicalId(value) {
  const id = String(value == null ? "" : value).trim();
  if (!/^\d{1,18}$/.test(id)) return "";
  return id;
}

function asCreateQty(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_QTY) return null;
  return value;
}

function normalizeCreateItems(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid" };
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "invalid" };
  if (items.length > MAX_ITEMS * 4) return { ok: false, error: "too_many" };
  const map = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "invalid" };
    const id = asCanonicalId(item.id);
    const qty = asCreateQty(item.qty);
    if (!id || qty == null) return { ok: false, error: "invalid" };
    if (id.length > MAX_ID_LENGTH) return { ok: false, error: "invalid" };
    const prev = map.get(id) || 0;
    map.set(id, Math.min(MAX_QTY, prev + qty));
  }
  if (map.size > MAX_ITEMS) return { ok: false, error: "too_many" };
  const normalized = [];
  for (const pair of map) normalized.push({ id: pair[0], qty: pair[1] });
  return { ok: true, items: normalized };
}

function normalizeStoredItems(value) {
  if (!Array.isArray(value)) return [];
  const map = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = asCanonicalId(item.id);
    const qty = typeof item.qty === "number" ? item.qty : Number(item.qty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) continue;
    const prev = map.get(id) || 0;
    map.set(id, Math.min(MAX_QTY, prev + qty));
  }
  if (map.size === 0 || map.size > MAX_ITEMS) return [];
  const items = [];
  for (const pair of map) items.push({ id: pair[0], qty: pair[1] });
  return items;
}

function isExpired(expiresAt, nowMs) {
  const time = Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(time)) return true;
  return time <= nowMs;
}

function insertRow(code, items, nowMs) {
  return {
    code,
    items: items.map((item) => ({ id: item.id, qty: item.qty })),
    expires_at: new Date(nowMs + RETENTION_MS).toISOString()
  };
}

function sharedCartItemsValid(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) return false;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const keys = Object.keys(item);
    if (keys.length !== 2 || keys.indexOf("id") === -1 || keys.indexOf("qty") === -1) return false;
    if (typeof item.id !== "string" || !/^\d{1,18}$/.test(item.id)) return false;
    if (typeof item.qty !== "number" || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) return false;
  }
  return true;
}

function rpcResult(payload) {
  let value = payload;
  if (typeof value === "string") {
    const trimmed = value.trim();
    try {
      value = JSON.parse(trimmed);
    } catch (err) {
      value = trimmed;
    }
  }
  if (value === "ok" || value === "conflict" || value === "rate_limited" || value === "invalid") return value;
  return "";
}

function parseJson(raw) {
  if (utf8ByteLength(raw) > MAX_BODY_BYTES) return { ok: false, error: "invalid" };
  try {
    return { ok: true, value: JSON.parse(String(raw || "")) };
  } catch (err) {
    return { ok: false, error: "invalid" };
  }
}

async function readBody(options) {
  if (typeof options.body === "string") return options.body;
  if (options.body == null) return "";
  return String(options.body);
}

function declaredBodyBytes(request) {
  const headers = request && request.headers;
  if (!headers || typeof headers.get !== "function") return null;
  const declared = headers.get("content-length");
  if (declared == null || declared === "") return null;
  const size = Number(declared);
  if (!Number.isFinite(size)) return null;
  return size;
}

async function cancelBody(body) {
  if (body && typeof body.cancel === "function") {
    try {
      await body.cancel();
    } catch (err) {
      /* The caller already has a size decision. */
    }
  }
}

async function readBoundedCreateBody(request) {
  const declared = declaredBodyBytes(request);
  const stream = request && request.body;
  if (declared != null && declared > MAX_BODY_BYTES) {
    await cancelBody(stream);
    return { ok: false, status: 413 };
  }
  if (!stream || typeof stream.getReader !== "function") {
    return { ok: true, body: "" };
  }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      const size = value && value.byteLength ? value.byteLength : 0;
      if (total + size > MAX_BODY_BYTES) {
        await cancelBody(reader);
        return { ok: false, status: 413 };
      }
      if (size) {
        chunks.push(value);
        total += size;
      }
    }
  } catch (err) {
    await cancelBody(reader);
    return { ok: false, status: 413 };
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: new TextDecoder("utf-8").decode(merged) };
}

async function createLink(env, fetchImpl, row) {
  const key = serverKey(env);
  const response = await fetchImpl(SUPABASE_URL + "/rest/v1/rpc/create_shared_cart_link", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      p_code: row.code,
      p_items: row.items,
      p_expires_at: row.expires_at
    })
  });
  let payload = "";
  try {
    if (response && typeof response.text === "function") payload = await response.text();
    else if (response && typeof response.json === "function") payload = JSON.stringify(await response.json());
  } catch (err) {
    payload = "";
  }
  return { status: response && response.status, payload };
}

async function readLink(env, fetchImpl, code) {
  const key = serverKey(env);
  const response = await fetchImpl(
    SUPABASE_URL + "/rest/v1/shared_cart_links?code=eq." + encodeURIComponent(code) + "&select=items,expires_at&limit=1",
    {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        Accept: "application/json"
      }
    }
  );
  if (!response || !response.ok) return { ok: false, status: response ? response.status : 0 };
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, row: null };
  return { ok: true, row: rows[0] };
}

async function handleCreate(options, normalized) {
  const env = options.env;
  const fetchImpl = options.fetchImpl;
  const generate = options.generateCode || generateShortCode;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (!serverKey(env) || typeof fetchImpl !== "function") return unavailable();
  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt += 1) {
    let code = "";
    try {
      code = String(generate() || "");
    } catch (err) {
      return unavailable();
    }
    if (!CODE_RE.test(code)) return unavailable();
    const row = insertRow(code, normalized.items, nowMs);
    if (!sharedCartItemsValid(row.items)) return invalid("invalid");
    let created = null;
    try {
      created = await createLink(env, fetchImpl, row);
    } catch (err) {
      return unavailable();
    }
    const outcome = rpcResult(created && created.payload);
    if (created && created.status === 200 && outcome === "ok") {
      return jsonResult(200, { ok: true, code, url: canonicalShortUrl(code) });
    }
    if (created && created.status === 200 && outcome === "conflict") continue;
    if (created && created.status === 200 && outcome === "rate_limited") {
      return jsonResult(429, { ok: false, error: "rate_limited" });
    }
    if (created && created.status === 200 && outcome === "invalid") return invalid("invalid");
    return unavailable();
  }
  return unavailable();
}

async function handleRead(options, code) {
  const env = options.env;
  const fetchImpl = options.fetchImpl;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (!CODE_RE.test(code)) return jsonResult(404, { ok: false, error: "not_found" });
  if (!serverKey(env) || typeof fetchImpl !== "function") return unavailable();
  let loaded;
  try {
    loaded = await readLink(env, fetchImpl, code);
  } catch (err) {
    return unavailable();
  }
  if (!loaded.ok) return unavailable();
  if (!loaded.row) return jsonResult(404, { ok: false, error: "not_found" });
  if (isExpired(loaded.row.expires_at, nowMs)) return jsonResult(404, { ok: false, error: "expired" });
  const items = normalizeStoredItems(loaded.row.items);
  if (!items.length) return jsonResult(404, { ok: false, error: "not_found" });
  return jsonResult(200, { ok: true, items });
}

async function handleSharedCartApi(options) {
  const source = options || {};
  const method = String(source.method || "GET").toUpperCase();
  const pathname = String(source.pathname || "");
  try {
    if (pathname === "/api/shared-cart") {
      if (method !== "POST") return jsonResult(405, { ok: false, error: "method" });
      const raw = await readBody(source);
      if (utf8ByteLength(raw) > MAX_BODY_BYTES) return invalid("invalid");
      const parsed = parseJson(raw);
      if (!parsed.ok) return invalid(parsed.error);
      const normalized = normalizeCreateItems(parsed.value);
      if (!normalized.ok) return invalid(normalized.error);
      return await handleCreate(source, normalized);
    }
    const match = READ_PATH_RE.exec(pathname);
    if (match) {
      if (method !== "GET" && method !== "HEAD") return jsonResult(405, { ok: false, error: "method" });
      return await handleRead(source, match[1]);
    }
    return jsonResult(404, { ok: false, error: "not_found" });
  } catch (err) {
    return unavailable();
  }
}

module.exports = {
  SUPABASE_URL,
  CANONICAL_ORIGIN,
  ALPHABET,
  CODE_RE,
  SHORT_PAGE_RE,
  READ_PATH_RE,
  MAX_ITEMS,
  MAX_QTY,
  MAX_BODY_BYTES,
  RETENTION_MS,
  CREATE_LIMIT,
  CREATE_WINDOW_MINUTES,
  CREATE_DAY_LIMIT,
  CREATE_WINDOW_HOURS,
  readBoundedCreateBody,
  generateShortCode,
  canonicalShortUrl,
  normalizeCreateItems,
  normalizeStoredItems,
  isExpired,
  insertRow,
  sharedCartItemsValid,
  rpcResult,
  handleSharedCartApi
};
