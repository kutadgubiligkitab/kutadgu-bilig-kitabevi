"use strict";

/**
 * AI Search 1E — isolated backend query path.
 * Not loaded by the storefront. Independent of Normal Search.
 * Disabled unless AI_SEARCH_ENABLED is exactly "true".
 */

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 1536;
const MATCH_COUNT = 12;
const MATCH_RPC = "match_active_books_ai";
const ENABLED_ENV = "AI_SEARCH_ENABLED";
const MIN_QUERY_CHARS = 2;
const MAX_QUERY_CHARS = 300;
const MAX_BODY_BYTES = 4096;
const OPENAI_TIMEOUT_MS = 8000;
const RPC_TIMEOUT_MS = 8000;
const RESULT_FIELDS = Object.freeze([
  "id",
  "title",
  "author",
  "category",
  "price",
  "image_url",
  "stock",
  "similarity"
]);
const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});

function isEnabled(env) {
  return String((env && env[ENABLED_ENV]) || "") === "true";
}

function normalizeQuery(value) {
  if (value == null) return "";
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function queryError(normalized) {
  if (!normalized) return "invalid_query";
  if (normalized.length < MIN_QUERY_CHARS) return "invalid_query";
  if (normalized.length > MAX_QUERY_CHARS) return "invalid_query";
  return "";
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  Object.keys(JSON_HEADERS).forEach((key) => res.setHeader(key, JSON_HEADERS[key]));
  res.end(JSON.stringify(payload));
}

function genericError() {
  return { ok: false, error: "unavailable" };
}

function secretValues(env) {
  const out = [];
  ["OPENAI_API_KEY"].forEach((name) => {
    const value = String((env && env[name]) || "").trim();
    if (value) out.push(value);
  });
  return out;
}

function redact(value, env) {
  let text = String(value == null ? "" : value);
  secretValues(env).forEach((secret) => {
    text = text.split(secret).join("[redacted]");
  });
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return text;
}

async function readJsonBody(req) {
  if (req && req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return { ok: true, value: req.body };
  }
  let raw = "";
  if (req && Buffer.isBuffer(req.body)) raw = req.body.toString("utf8");
  else if (req && typeof req.body === "string") raw = req.body;
  else {
    raw = await new Promise((resolve, reject) => {
      if (!req || typeof req.on !== "function") {
        resolve("");
        return;
      }
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error("payload_too_large"), { code: "payload_too_large" }));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  if (!String(raw).trim()) return { ok: false, code: "invalid_query" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, code: "invalid_query" };
  }
}

function validateQueryEmbedding(payload) {
  const data = payload && Array.isArray(payload.data) ? payload.data.slice() : null;
  if (!data || data.length !== 1) {
    const err = new Error("embedding_count_mismatch");
    err.code = "embedding_invalid";
    throw err;
  }
  const row = data[0];
  if (!row || Number(row.index || 0) !== 0) {
    const err = new Error("embedding_index_mismatch");
    err.code = "embedding_invalid";
    throw err;
  }
  const vector = row.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    const err = new Error("embedding_dimension_mismatch");
    err.code = "embedding_invalid";
    throw err;
  }
  for (let i = 0; i < vector.length; i += 1) {
    if (typeof vector[i] !== "number" || !Number.isFinite(vector[i])) {
      const err = new Error("embedding_non_finite");
      err.code = "embedding_invalid";
      throw err;
    }
  }
  return vector;
}

function publicResult(row) {
  if (!row || typeof row !== "object") return null;
  const id = Number(row.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const similarity = Number(row.similarity);
  const priceNum = row.price == null || row.price === "" ? NaN : Number(row.price);
  const stockNum = row.stock == null || row.stock === "" ? NaN : Number(row.stock);
  return {
    id,
    title: String(row.title == null ? "" : row.title),
    author: String(row.author == null ? "" : row.author),
    category: String(row.category == null ? "" : row.category),
    price: Number.isFinite(priceNum) ? priceNum : null,
    image_url: String(row.image_url == null ? "" : row.image_url),
    stock: row.stock == null || row.stock === "" ? null : (Number.isFinite(stockNum) ? stockNum : null),
    similarity: Number.isFinite(similarity) ? similarity : 0
  };
}

function sanitizeResults(rows) {
  if (!Array.isArray(rows)) {
    const err = new Error("rpc_invalid");
    err.code = "rpc_invalid";
    throw err;
  }
  return rows.map(publicResult).filter(Boolean);
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, Object.assign({}, init, { signal: controller.signal }));
  } catch (err) {
    const error = new Error("upstream_timeout");
    error.code = err && err.name === "AbortError" ? "timeout" : "network";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function embedQuery(fetchImpl, apiKey, query, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
      input: query
    })
  }, timeoutMs || OPENAI_TIMEOUT_MS);
  if (!response || !response.ok) {
    const err = new Error("openai_http");
    err.code = "openai_http";
    err.status = response && response.status;
    throw err;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    const error = new Error("openai_json");
    error.code = "embedding_invalid";
    throw error;
  }
  return validateQueryEmbedding(payload);
}

async function matchBooks(fetchImpl, vector, timeoutMs) {
  const url = SUPABASE_URL + "/rest/v1/rpc/" + MATCH_RPC;
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query_embedding: vector,
      match_count: MATCH_COUNT
    })
  }, timeoutMs || RPC_TIMEOUT_MS);
  if (!response || !response.ok) {
    const err = new Error("rpc_http");
    err.code = "rpc_http";
    throw err;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    const error = new Error("rpc_json");
    error.code = "rpc_invalid";
    throw error;
  }
  return sanitizeResults(payload);
}

async function runSearch(options) {
  const opts = options || {};
  const env = opts.env || {};
  const fetchImpl = opts.fetchImpl;
  const query = normalizeQuery(opts.query);
  const invalid = queryError(query);
  if (invalid) {
    return { status: 400, body: { ok: false, error: "invalid_query" }, openaiCalls: 0, supabaseCalls: 0 };
  }
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return { status: 503, body: genericError(), openaiCalls: 0, supabaseCalls: 0 };
  }
  const vector = await embedQuery(fetchImpl, apiKey, query, opts.openaiTimeoutMs);
  const results = await matchBooks(fetchImpl, vector, opts.rpcTimeoutMs);
  return {
    status: 200,
    body: { ok: true, results },
    openaiCalls: 1,
    supabaseCalls: 1
  };
}

async function handleAiSearch(req, res, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || fetch;
  const calls = { openai: 0, supabase: 0 };
  const wrappedFetch = async (url, init) => {
    const href = String(url || "");
    if (/api\.openai\.com/.test(href)) calls.openai += 1;
    if (/\/rest\/v1\//.test(href)) calls.supabase += 1;
    return fetchImpl(url, init);
  };

  const method = String((req && req.method) || "GET").toUpperCase();
  if (method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return { openaiCalls: 0, supabaseCalls: 0 };
  }
  if (!isEnabled(env)) {
    sendJson(res, 503, { ok: false, error: "disabled" });
    return { openaiCalls: 0, supabaseCalls: 0 };
  }

  let parsed;
  try {
    parsed = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: "invalid_query" });
    return { openaiCalls: 0, supabaseCalls: 0 };
  }
  if (!parsed || !parsed.ok) {
    sendJson(res, 400, { ok: false, error: "invalid_query" });
    return { openaiCalls: 0, supabaseCalls: 0 };
  }

  try {
    const result = await runSearch({
      env,
      fetchImpl: wrappedFetch,
      query: parsed.value && parsed.value.query,
      openaiTimeoutMs: opts.openaiTimeoutMs,
      rpcTimeoutMs: opts.rpcTimeoutMs
    });
    sendJson(res, result.status, result.body);
    return {
      openaiCalls: calls.openai,
      supabaseCalls: calls.supabase
    };
  } catch (err) {
    sendJson(res, 503, genericError());
    return {
      openaiCalls: calls.openai,
      supabaseCalls: calls.supabase,
      failed: true,
      code: err && err.code
    };
  }
}

module.exports = {
  SUPABASE_URL,
  OPENAI_EMBEDDINGS_URL,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  MATCH_COUNT,
  MATCH_RPC,
  ENABLED_ENV,
  MIN_QUERY_CHARS,
  MAX_QUERY_CHARS,
  RESULT_FIELDS,
  isEnabled,
  normalizeQuery,
  queryError,
  redact,
  validateQueryEmbedding,
  sanitizeResults,
  publicResult,
  handleAiSearch,
  runSearch
};
