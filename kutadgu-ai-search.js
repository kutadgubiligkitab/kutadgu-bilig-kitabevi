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
const CANDIDATE_COUNT = 24;
const MATCH_RPC = "match_active_books_ai";
const CATEGORY_RPC = "list_active_books_by_categories_ai";
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
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value == null ? "" : value), "utf8");
}

function payloadTooLarge() {
  return Object.assign(new Error("payload_too_large"), { code: "payload_too_large" });
}

function raceAbort(signal, work) {
  if (signal && signal.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    Promise.resolve(work).then(
      (value) => {
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
        resolve(value);
      },
      (err) => {
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
        reject(err);
      }
    );
  });
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
  if (req && Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_BODY_BYTES) throw payloadTooLarge();
    const raw = req.body.toString("utf8");
    if (!raw.trim()) return { ok: false, code: "invalid_query" };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      return { ok: false, code: "invalid_query" };
    }
  }
  if (req && typeof req.body === "string") {
    if (utf8ByteLength(req.body) > MAX_BODY_BYTES) throw payloadTooLarge();
    if (!req.body.trim()) return { ok: false, code: "invalid_query" };
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch (err) {
      return { ok: false, code: "invalid_query" };
    }
  }
  if (req && req.body != null && typeof req.body === "object") {
    let serialized;
    try {
      serialized = JSON.stringify(req.body);
    } catch (err) {
      return { ok: false, code: "invalid_query" };
    }
    if (utf8ByteLength(serialized) > MAX_BODY_BYTES) throw payloadTooLarge();
    return { ok: true, value: req.body };
  }
  const raw = await new Promise((resolve, reject) => {
    if (!req || typeof req.on !== "function") {
      resolve("");
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      if (overflow) return;
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += piece.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        reject(payloadTooLarge());
        return;
      }
      chunks.push(piece);
    });
    req.on("end", () => {
      if (overflow) return;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
  if (utf8ByteLength(raw) > MAX_BODY_BYTES) throw payloadTooLarge();
  if (!String(raw).trim()) return { ok: false, code: "invalid_query" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, code: "invalid_query" };
  }
}

function embeddingInvalid(message) {
  const err = new Error(message);
  err.code = "embedding_invalid";
  return err;
}

function validateQueryEmbedding(payload) {
  if (!payload || typeof payload !== "object") {
    throw embeddingInvalid("embedding_payload_invalid");
  }
  if (Object.prototype.hasOwnProperty.call(payload, "model") && payload.model !== EMBEDDING_MODEL) {
    throw embeddingInvalid("embedding_model_mismatch");
  }
  const data = Array.isArray(payload.data) ? payload.data : null;
  if (!data || data.length !== 1) {
    throw embeddingInvalid("embedding_count_mismatch");
  }
  const row = data[0];
  if (!row || typeof row !== "object" || row.index !== 0) {
    throw embeddingInvalid("embedding_index_mismatch");
  }
  const vector = row.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw embeddingInvalid("embedding_dimension_mismatch");
  }
  for (let i = 0; i < vector.length; i += 1) {
    if (typeof vector[i] !== "number" || !Number.isFinite(vector[i])) {
      throw embeddingInvalid("embedding_non_finite");
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

/*
 * AI-local relevance (1G-2). Cosine similarity stays the base signal.
 * Lexical bonuses are bounded so they cannot replace semantics.
 * No absolute 0.5 similarity floor — historical novels can sit near 0.30–0.36.
 */
const LEXICAL_TITLE = Object.freeze({ exact: 0.16, prefix: 0.10, contains: 0.06 });
const LEXICAL_AUTHOR = Object.freeze({ exact: 0.18, prefix: 0.12, contains: 0.08 });
const LEXICAL_CATEGORY = Object.freeze({ exact: 0.14, prefix: 0.10, contains: 0.07 });
const MAX_LEXICAL_BONUS = 0.28;
const CATEGORY_INTENT_BONUS = 0.12;
const AUTHOR_IN_QUERY_BONUS = 0.16;
const MIN_AUTHOR_CHARS = 4;
const RELATIVE_KEEP_RATIO = 0.72;
const SCORE_CLIFF = 0.10;
const CATEGORY_INTENT_RULES = Object.freeze([
  { needles: Object.freeze(["بالىلار"]), category: "بالىلار كىتابلىرى" },
  { needles: Object.freeze(["تەربىيە", "پەرزەنت تەربىيەسى"]), category: "پەرزەنت تەربىيەسى" },
  { needles: Object.freeze(["تارىخىي رومان"]), category: "تارىخىي رومانلار" },
  { needles: Object.freeze(["دىنىي"]), category: "دىنىي كىتابلار" },
  { needles: Object.freeze(["گرامماتىكا", "گىرامماتىكا"]), category: "گرامماتىكا" },
  { needles: Object.freeze(["لۇغەت"]), category: "لۇغەت" },
  { needles: Object.freeze(["دەرسلىك"]), category: "دەرسلىك" }
]);

function fieldMatchBonus(fieldValue, query, weights) {
  const field = normalizeQuery(fieldValue);
  if (!field || !query) return 0;
  if (field === query) return weights.exact;
  if (field.indexOf(query) === 0) return weights.prefix;
  if (field.indexOf(query) !== -1 || query.indexOf(field) !== -1) return weights.contains;
  return 0;
}

function intendedCategories(query) {
  const out = [];
  CATEGORY_INTENT_RULES.forEach((rule) => {
    if (rule.needles.some((needle) => query.indexOf(needle) !== -1)) out.push(rule.category);
  });
  return out;
}

function authorCoreName(author) {
  const raw = normalizeQuery(author);
  return raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

function authorInQueryBonus(author, query) {
  const name = authorCoreName(author);
  if (!name || name.length < MIN_AUTHOR_CHARS) return 0;
  return query.indexOf(name) !== -1 ? AUTHOR_IN_QUERY_BONUS : 0;
}

function scoreAiCandidate(row, query) {
  const similarity = Number(row && row.similarity);
  const semantic = Number.isFinite(similarity) ? similarity : 0;
  let lexical = 0;
  lexical += fieldMatchBonus(row && row.title, query, LEXICAL_TITLE);
  lexical += fieldMatchBonus(row && row.author, query, LEXICAL_AUTHOR);
  lexical += fieldMatchBonus(row && row.category, query, LEXICAL_CATEGORY);
  if (lexical > MAX_LEXICAL_BONUS) lexical = MAX_LEXICAL_BONUS;
  const cat = normalizeQuery(row && row.category);
  const intent = intendedCategories(query).some((target) => cat === target) ? CATEGORY_INTENT_BONUS : 0;
  const authorBoost = authorInQueryBonus(row && row.author, query);
  return semantic + lexical + intent + authorBoost;
}

function dropWeakTail(ranked) {
  if (!ranked.length) return [];
  const best = ranked[0].score;
  const kept = [ranked[0]];
  for (let i = 1; i < ranked.length && kept.length < MATCH_COUNT; i += 1) {
    const row = ranked[i];
    const prev = kept[kept.length - 1];
    if (row.score < best * RELATIVE_KEEP_RATIO) break;
    if (prev.score - row.score >= SCORE_CLIFF) break;
    kept.push(row);
  }
  return kept;
}

function mergeAiCandidates(vectorRows, categoryRows) {
  const byId = Object.create(null);
  const out = [];
  function add(row) {
    if (!row || !Number.isFinite(row.id) || row.id <= 0) return;
    if (byId[row.id]) return;
    byId[row.id] = true;
    out.push(row);
  }
  (vectorRows || []).forEach(add);
  (categoryRows || []).forEach(add);
  return out;
}

function capRanked(ranked) {
  return ranked.slice(0, MATCH_COUNT).map((item) => item.row);
}

function selectRelevantResults(query, candidates) {
  const q = normalizeQuery(query);
  const ranked = (candidates || []).map((row, index) => ({
    row,
    index,
    score: scoreAiCandidate(row, q)
  })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.row.similarity !== a.row.similarity) return b.row.similarity - a.row.similarity;
    return a.index - b.index;
  });

  const authorMatches = ranked.filter((item) => authorInQueryBonus(item.row.author, q) > 0);
  if (authorMatches.length) return capRanked(authorMatches);

  const intents = intendedCategories(q);
  if (intents.length) {
    const intentMatches = ranked.filter((item) => {
      const cat = normalizeQuery(item.row.category);
      return intents.some((target) => cat === target);
    });
    if (intentMatches.length) return capRanked(intentMatches);
  }

  return dropWeakTail(ranked).map((item) => item.row);
}

async function fetchJsonThen(fetchImpl, url, init, timeoutMs, mapPayload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await raceAbort(
      controller.signal,
      Promise.resolve().then(() => fetchImpl(url, Object.assign({}, init, { signal: controller.signal })))
    );
    if (!response || !response.ok) {
      const err = new Error("upstream_http");
      err.code = "http";
      err.status = response && response.status;
      throw err;
    }
    let payload;
    try {
      if (!response || typeof response.json !== "function") {
        throw new Error("missing_json");
      }
      payload = await raceAbort(
        controller.signal,
        Promise.resolve().then(() => response.json())
      );
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      const error = new Error("upstream_json");
      error.code = "invalid_json";
      throw error;
    }
    return mapPayload(payload);
  } catch (err) {
    if (err && (err.code === "http" || err.code === "invalid_json" || err.code === "embedding_invalid" || err.code === "rpc_invalid")) {
      throw err;
    }
    const error = new Error("upstream_timeout");
    error.code = err && err.name === "AbortError" ? "timeout" : "network";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function embedQuery(fetchImpl, apiKey, query, timeoutMs) {
  try {
    return await fetchJsonThen(fetchImpl, OPENAI_EMBEDDINGS_URL, {
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
    }, timeoutMs || OPENAI_TIMEOUT_MS, validateQueryEmbedding);
  } catch (err) {
    if (err && err.code === "http") {
      const error = new Error("openai_http");
      error.code = "openai_http";
      error.status = err.status;
      throw error;
    }
    if (err && err.code === "invalid_json") {
      const error = new Error("openai_json");
      error.code = "embedding_invalid";
      throw error;
    }
    throw err;
  }
}

async function matchBooks(fetchImpl, vector, timeoutMs) {
  const url = SUPABASE_URL + "/rest/v1/rpc/" + MATCH_RPC;
  try {
    return await fetchJsonThen(fetchImpl, url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query_embedding: vector,
        match_count: CANDIDATE_COUNT
      })
    }, timeoutMs || RPC_TIMEOUT_MS, sanitizeResults);
  } catch (err) {
    if (err && err.code === "http") {
      const error = new Error("rpc_http");
      error.code = "rpc_http";
      throw error;
    }
    if (err && err.code === "invalid_json") {
      const error = new Error("rpc_json");
      error.code = "rpc_invalid";
      throw error;
    }
    throw err;
  }
}

async function listBooksByCategories(fetchImpl, categories, timeoutMs) {
  const names = (categories || []).filter((name) => typeof name === "string" && name);
  if (!names.length) return [];
  const url = SUPABASE_URL + "/rest/v1/rpc/" + CATEGORY_RPC;
  try {
    return await fetchJsonThen(fetchImpl, url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        categories: names,
        match_count: CANDIDATE_COUNT
      })
    }, timeoutMs || RPC_TIMEOUT_MS, sanitizeResults);
  } catch (err) {
    const error = new Error("category_rpc");
    error.code = "category_rpc";
    throw error;
  }
}

async function runSearch(options) {
  const opts = options || {};
  const env = opts.env || {};
  const fetchImpl = opts.fetchImpl;
  if (typeof opts.query !== "string") {
    return { status: 400, body: { ok: false, error: "invalid_query" }, openaiCalls: 0, supabaseCalls: 0 };
  }
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
  const vectorRows = await matchBooks(fetchImpl, vector, opts.rpcTimeoutMs);
  let candidates = vectorRows;
  const intents = intendedCategories(query);
  if (intents.length) {
    try {
      const categoryRows = await listBooksByCategories(fetchImpl, intents, opts.rpcTimeoutMs);
      if (categoryRows && categoryRows.length) {
        candidates = mergeAiCandidates(vectorRows, categoryRows);
      }
    } catch (err) {
      candidates = vectorRows;
    }
  }
  const results = selectRelevantResults(query, candidates);
  return {
    status: 200,
    body: { ok: true, results, count: results.length },
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
  CANDIDATE_COUNT,
  MATCH_RPC,
  CATEGORY_RPC,
  ENABLED_ENV,
  MIN_QUERY_CHARS,
  MAX_QUERY_CHARS,
  MAX_BODY_BYTES,
  RESULT_FIELDS,
  isEnabled,
  normalizeQuery,
  queryError,
  redact,
  validateQueryEmbedding,
  sanitizeResults,
  publicResult,
  scoreAiCandidate,
  selectRelevantResults,
  mergeAiCandidates,
  intendedCategories,
  handleAiSearch,
  runSearch
};
