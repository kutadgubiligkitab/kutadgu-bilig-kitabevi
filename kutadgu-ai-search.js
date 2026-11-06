"use strict";

/**
 * AI Search 1E — isolated backend query path.
 * Not loaded by the storefront. Independent of Normal Search.
 * Disabled unless AI_SEARCH_ENABLED is exactly "true".
 * The two AI RPCs use env.SUPABASE_SECRET_KEY only. The public
 * publishable key stays in the browser catalog clients.
 */

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 1536;
const MATCH_COUNT = 12;
const CANDIDATE_COUNT = 24;
const MATCH_RPC = "match_active_books_ai";
const CATEGORY_RPC = "list_active_books_by_categories_ai";
const CATALOG_RPC = "search_public_catalog_lexical";
const RESERVE_RPC = "reserve_ai_search_paid_call";
const MAP_UNITS_RPC = "map_public_books_to_catalog_units";
const SERIES_ROUTES_RPC = "list_public_book_series_routes";
const SEMANTIC_ACCEPT_FLOOR = 0.55;
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

function serverSupabaseKey(env) {
  return String((env && env.SUPABASE_SECRET_KEY) || "").trim();
}

function secretValues(env) {
  const out = [];
  ["OPENAI_API_KEY", "SUPABASE_SECRET_KEY"].forEach((name) => {
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
  const result = {
    id,
    title: String(row.title == null ? "" : row.title),
    author: String(row.author == null ? "" : row.author),
    category: String(row.category == null ? "" : row.category),
    price: Number.isFinite(priceNum) ? priceNum : null,
    image_url: String(row.image_url == null ? "" : row.image_url),
    stock: row.stock == null || row.stock === "" ? null : (Number.isFinite(stockNum) ? stockNum : null),
    similarity: Number.isFinite(similarity) ? similarity : 0
  };
  if (row.series_group_id) result.series_group_id = Number(row.series_group_id) || null;
  if (row.series_title) result.series_title = String(row.series_title);
  if (row.series_slug) result.series_slug = String(row.series_slug);
  if (row.series_member_count) result.series_member_count = Number(row.series_member_count) || 0;
  if (row.series_lowest_price != null && row.series_lowest_price !== "") result.series_lowest_price = Number(row.series_lowest_price);
  if (row.series_image_url) result.series_image_url = String(row.series_image_url);
  if (row.series_representative_id) result.series_representative_id = Number(row.series_representative_id) || null;
  if (row.series_author) result.series_author = String(row.series_author);
  if (row.kind === "group") {
    result.kind = "group";
    result.group_id = row.group_id == null ? null : Number(row.group_id);
    result.group_slug = String(row.group_slug || row.slug || "");
    result.public_slug = validPublicSlug(row.public_slug);
    result.member_count = Number(row.member_count) || 0;
  }
  return result;
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
 * AI-local relevance. scoreAiCandidate still keeps cosine as the base
 * signal for topic ties. selectRelevantResults applies stronger gates:
 * exact title, author, series, partial title, verified category, then
 * description. It does not return a vector neighbor by itself.
 * runSearch may add a semantic result only after those gates are empty
 * and similarity is at least SEMANTIC_ACCEPT_FLOOR.
 */
const SPELLING_FOLDS = Object.freeze([
  ["چىڭگىز", "چىڭغىز"],
  ["ئىسكەندەر نامە", "ئىسكەندەرنامە"],
  ["ئانا كارىنىنا", "ئاننا كارېنىنا"],
  ["ئانا كارېنىنا", "ئاننا كارېنىنا"],
  ["ئويغانغان زىمىن", "ئويغانغان زېمىن"]
]);
const LEXICAL_TITLE = Object.freeze({ exact: 0.16, prefix: 0.10, contains: 0.06 });
const LEXICAL_AUTHOR = Object.freeze({ exact: 0.18, prefix: 0.12, contains: 0.08 });
const LEXICAL_CATEGORY = Object.freeze({ exact: 0.14, prefix: 0.10, contains: 0.07 });
const MAX_LEXICAL_BONUS = 0.28;
const CATEGORY_INTENT_BONUS = 0.12;
const AUTHOR_IN_QUERY_BONUS = 0.16;
const MIN_AUTHOR_CHARS = 4;
const CATEGORY_INTENT_RULES = Object.freeze([
  { family: "child_parenting", needles: Object.freeze(["بالىلار"]), category: "بالىلار كىتابلىرى" },
  { family: "child_parenting", needles: Object.freeze(["تەربىيە", "پەرزەنت تەربىيەسى"]), category: "پەرزەنت تەربىيەسى" },
  { family: "historical_novel", needles: Object.freeze(["تارىخىي رومان"]), category: "تارىخىي رومانلار" },
  { family: "religious", needles: Object.freeze(["دىنىي"]), category: "دىنىي كىتابلار" },
  { family: "grammar", needles: Object.freeze(["گرامماتىكا", "گىرامماتىكا"]), category: "گرامماتىكا" },
  { family: "dictionary", needles: Object.freeze(["لۇغەت"]), category: "لۇغەت" },
  { family: "textbook", needles: Object.freeze(["دەرسلىك"]), category: "دەرسلىك" }
]);
const CATEGORY_ALIASES = Object.freeze({
  "تارىخىي رومانلار": Object.freeze(["تارىخىي رومان"])
});

function fieldMatchBonus(fieldValue, query, weights) {
  const field = normalizeQuery(fieldValue);
  if (!field || !query) return 0;
  if (field === query) return weights.exact;
  if (field.indexOf(query) === 0) return weights.prefix;
  if (field.indexOf(query) !== -1 || query.indexOf(field) !== -1) return weights.contains;
  return 0;
}

function resolveCategoryIntent(query) {
  const q = normalizeQuery(query);
  const families = [];
  const categories = [];
  const seenFamily = Object.create(null);
  const seenCategory = Object.create(null);
  CATEGORY_INTENT_RULES.forEach((rule) => {
    if (!rule.needles.some((needle) => q.indexOf(needle) !== -1)) return;
    if (!seenFamily[rule.family]) {
      seenFamily[rule.family] = true;
      families.push(rule.family);
    }
    if (!seenCategory[rule.category]) {
      seenCategory[rule.category] = true;
      categories.push(rule.category);
    }
  });
  let mode = "none";
  if (families.length === 1) mode = "clear";
  else if (families.length > 1) mode = "mixed";
  return { mode, families, categories };
}

function intendedCategories(query) {
  return resolveCategoryIntent(query).categories;
}

function categoryMatchesIntent(stored, targets) {
  const cat = normalizeQuery(stored);
  if (!cat) return false;
  return (targets || []).some((target) => {
    if (cat === target) return true;
    const aliases = CATEGORY_ALIASES[target] || [];
    return aliases.indexOf(cat) !== -1;
  });
}

function queryVariants(query) {
  const raw = normalizeQuery(query);
  const folded = foldSpelling(query);
  const out = [];
  [raw, folded].forEach((value) => {
    if (value && out.indexOf(value) === -1) out.push(value);
  });
  return out.slice(0, 4);
}

function categoryNamesForQuery(query) {
  const resolved = resolveCategoryIntent(query);
  if (resolved.mode !== "clear") return [];
  const names = [];
  resolved.categories.forEach((name) => {
    if (names.indexOf(name) === -1) names.push(name);
    (CATEGORY_ALIASES[name] || []).forEach((alias) => {
      if (names.indexOf(alias) === -1) names.push(alias);
    });
  });
  return names;
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

async function mapCandidatesToCatalogUnits(fetchImpl, candidates, timeoutMs, rpcKey) {
  const ids = (candidates || []).map(row => Number(row && row.id)).filter(id => Number.isFinite(id) && id > 0);
  if (!ids.length) return [];
  const url = SUPABASE_URL + "/rest/v1/rpc/" + MAP_UNITS_RPC;
  const rows = await fetchJsonThen(fetchImpl, url, {
    method: "POST",
    headers: {
      apikey: rpcKey,
      Authorization: "Bearer " + rpcKey,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_book_ids: ids })
  }, timeoutMs || RPC_TIMEOUT_MS, payload => {
    const values = Array.isArray(payload) ? payload : (Array.isArray(payload && payload.items) ? payload.items : null);
    if (!values) throw Object.assign(new Error("rpc_invalid"), { code: "rpc_invalid" });
    return values;
  });
  const similarityById = new Map((candidates || []).map(row => [String(row.id), Number(row.similarity) || 0]));
  return rows.map(row => {
    const matched = Array.isArray(row && row.matched_book_ids) ? row.matched_book_ids : [row && (row.id || row.book_id)];
    const similarity = matched.reduce((best, id) => Math.max(best, similarityById.get(String(id)) || 0), 0);
    return publicResult({ ...row, id: row.representative_book_id || row.id, similarity });
  }).filter(Boolean);
}

function readSeriesDirectory(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.filter((row) => row && Number(row.group_id) > 0 && validPublicSlug(row.public_slug)).map((row) => ({
    group_id: Number(row.group_id),
    legacy_slug: String(row.legacy_slug || ""),
    public_slug: validPublicSlug(row.public_slug)
  }));
}

async function loadPublicSeriesDirectory(fetchImpl, timeoutMs, rpcKey) {
  const url = SUPABASE_URL + "/rest/v1/rpc/" + SERIES_ROUTES_RPC;
  try {
    return await fetchJsonThen(fetchImpl, url, {
      method: "POST",
      headers: {
        apikey: rpcKey,
        Authorization: "Bearer " + rpcKey,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: "{}"
    }, timeoutMs || RPC_TIMEOUT_MS, readSeriesDirectory);
  } catch (err) {
    return [];
  }
}

function attachCanonicalSeriesSlugs(rows, directory) {
  const byId = Object.create(null);
  const byLegacy = Object.create(null);
  (directory || []).forEach((row) => {
    byId[String(row.group_id)] = row.public_slug;
    if (row.legacy_slug) byLegacy[row.legacy_slug] = row.public_slug;
  });
  return (rows || []).map((row) => {
    if (!row || row.kind !== "group") return row;
    const legacy = String(row.group_slug || "");
    const known = byId[String(row.group_id)] || byLegacy[legacy] || "";
    const explicit = validPublicSlug(row.public_slug);
    const publicSlug = known || (explicit && explicit !== legacy ? explicit : "");
    return Object.assign({}, row, { public_slug: publicSlug });
  });
}

function foldSpelling(value) {
  let text = normalizeQuery(value);
  SPELLING_FOLDS.forEach((pair) => {
    if (text.indexOf(pair[0]) !== -1) text = text.split(pair[0]).join(pair[1]);
  });
  return text;
}

function isPublicCandidate(row) {
  if (!row || typeof row !== "object") return false;
  if (row.is_active === false) return false;
  if (row.submission_status && row.submission_status !== "approved") return false;
  return true;
}

function titleRelation(title, query) {
  const field = foldSpelling(title);
  const q = foldSpelling(query);
  if (!field || !q) return "none";
  if (field === q) return "exact";
  if (q.length >= 3 && field.indexOf(q) === 0) return "prefix";
  if (q.length >= 3 && field.indexOf(q) !== -1) return "contains";
  if (field.length >= 6 && q.indexOf(field) !== -1) return "contains";
  return "none";
}

function authorMatchesQuery(author, query) {
  const name = foldSpelling(authorCoreName(author));
  const q = foldSpelling(query);
  if (!name || name.length < MIN_AUTHOR_CHARS || q.length < MIN_AUTHOR_CHARS) return false;
  return q.indexOf(name) !== -1 || name.indexOf(q) !== -1;
}

function descriptionMatchesQuery(row, query) {
  const desc = foldSpelling(row && row.description);
  const q = foldSpelling(query);
  if (!desc || q.length < 8) return false;
  return desc.indexOf(q) !== -1;
}

function bySimilarity(rows) {
  return rows.slice().sort((a, b) => {
    const diff = (Number(b.similarity) || 0) - (Number(a.similarity) || 0);
    if (diff) return diff;
    return Number(a.id) - Number(b.id);
  }).slice(0, MATCH_COUNT);
}

function selectRelevantResults(query, candidates) {
  const q = normalizeQuery(query);
  const list = (candidates || []).filter(isPublicCandidate);
  const exact = list.filter((row) => titleRelation(row.title, q) === "exact");
  if (exact.length) return bySimilarity(exact);

  const authors = list.filter((row) => authorMatchesQuery(row.author, q));
  if (authors.length) return bySimilarity(authors);

  const partial = list.filter((row) => {
    const relation = titleRelation(row.title, q);
    return relation === "prefix" || relation === "contains";
  });
  if (partial.length) return bySimilarity(partial);

  const resolved = resolveCategoryIntent(q);
  if (resolved.mode === "clear" && resolved.categories.length) {
    const intentMatches = list.filter((row) => categoryMatchesIntent(row.category, resolved.categories));
    if (intentMatches.length) return bySimilarity(intentMatches);
    return [];
  }

  const described = list.filter((row) => descriptionMatchesQuery(row, q));
  if (described.length) return bySimilarity(described);

  return [];
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

function readCatalogRows(rows) {
  if (!Array.isArray(rows)) {
    const err = new Error("rpc_invalid");
    err.code = "rpc_invalid";
    throw err;
  }
  return rows.map((row) => {
    const parsed = publicResult(row);
    if (!parsed) return null;
    parsed.description = String(row.description == null ? "" : row.description);
    parsed.series_title = String(row.series_title == null ? "" : row.series_title);
    parsed.series_slug = String(row.series_slug == null ? "" : row.series_slug);
    parsed.series_member_count = Number(row.series_member_count) || 0;
    parsed.series_group_id = Number(row.series_group_id) || null;
    parsed.series_lowest_price = row.series_lowest_price == null || row.series_lowest_price === "" ? null : Number(row.series_lowest_price);
    parsed.series_image_url = String(row.series_image_url == null ? "" : row.series_image_url);
    parsed.series_representative_id = Number(row.series_representative_id) || null;
    parsed.series_author = String(row.series_author == null ? "" : row.series_author);
    if (row.is_active === false) parsed.is_active = false;
    if (row.submission_status) parsed.submission_status = row.submission_status;
    return parsed;
  }).filter(Boolean);
}

function expandSeriesCandidates(rows, query) {
  const out = [];
  const seen = Object.create(null);
  (rows || []).forEach((row) => {
    if (!row) return;
    out.push(row);
    if (!row.series_title || titleRelation(row.series_title, query) === "none") return;
    out.push({
      id: row.id,
      title: row.series_title,
      author: row.author,
      category: row.category,
      price: null,
      image_url: row.series_image_url || "",
      stock: null,
      similarity: row.similarity || 0,
      description: "",
      kind: "group",
      group_id: row.series_group_id || null,
      group_slug: row.series_slug || "",
      public_slug: row.series_slug || "",
      member_count: row.series_member_count || 0,
      series_title: row.series_title,
      series_slug: row.series_slug || "",
      series_group_id: row.series_group_id || null,
      series_member_count: row.series_member_count || 0,
      series_lowest_price: row.series_lowest_price,
      series_image_url: row.series_image_url || "",
      series_representative_id: row.series_representative_id || row.id,
      series_author: row.series_author || row.author,
      is_active: row.is_active,
      submission_status: row.submission_status
    });
  });
  return out.filter((row) => {
    const key = row.kind === "group"
      ? "group:" + (row.public_slug || row.group_slug) + ":" + normalizeQuery(row.title)
      : "book:" + row.id + ":" + normalizeQuery(row.title);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function validPublicSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || "")) ? String(value) : "";
}

function canonicalSeriesSlug(row) {
  return validPublicSlug(row && (row.public_slug || row.series_slug || ""));
}

function seriesDisplay(row) {
  const slug = canonicalSeriesSlug(row);
  const groupId = Number(row && (row.series_group_id || row.group_id));
  if (!row || !slug || !Number.isFinite(groupId) || groupId <= 0) return null;
  const representative = Number(row.series_representative_id || row.representative_book_id || row.id);
  const lowest = row.series_lowest_price == null || row.series_lowest_price === "" ? NaN : Number(row.series_lowest_price);
  const mappedPrice = row.kind === "group" ? Number(row.price) : NaN;
  const price = Number.isFinite(lowest) ? lowest : (Number.isFinite(mappedPrice) ? mappedPrice : null);
  const legacy = validPublicSlug(row.group_slug || "");
  return publicResult({
    id: Number.isFinite(representative) && representative > 0 ? representative : row.id,
    title: row.series_title || row.title,
    author: row.series_author || row.author,
    category: row.category,
    price: price,
    image_url: row.series_image_url || (row.kind === "group" ? row.image_url : "") || "",
    stock: null,
    similarity: row.similarity || 0,
    kind: "group",
    group_id: groupId,
    group_slug: legacy || slug,
    public_slug: slug,
    member_count: row.series_member_count || row.member_count || 0
  });
}

function collapseGrouped(rows) {
  const out = [];
  const seen = Object.create(null);
  (rows || []).forEach((row) => {
    if (!row || out.length >= MATCH_COUNT) return;
    const groupId = Number(row.series_group_id || (row.kind === "group" ? row.group_id : 0));
    const slug = canonicalSeriesSlug(row);
    if (row.kind === "group") {
      if (!slug) return;
      const key = "g:" + groupId;
      if (seen[key]) return;
      seen[key] = true;
      const card = seriesDisplay(row);
      if (card) out.push(card);
      return;
    }
    if (groupId > 0 && slug) {
      const key = "g:" + groupId;
      if (seen[key]) return;
      seen[key] = true;
      const card = seriesDisplay(row);
      if (card) out.push(card);
      return;
    }
    const key = "b:" + row.id;
    if (seen[key]) return;
    seen[key] = true;
    const book = publicResult(row);
    if (book) out.push(book);
  });
  return out;
}

function presentSearchResults(query, candidates) {
  const expanded = expandSeriesCandidates(candidates, query).filter(isPublicCandidate);
  const exactBooks = [];
  const seenBook = Object.create(null);
  expanded.forEach((row) => {
    if (row.kind === "group" || titleRelation(row.title, query) !== "exact" || seenBook[row.id]) return;
    seenBook[row.id] = true;
    const book = publicResult(row);
    if (book) exactBooks.push(book);
  });
  if (exactBooks.length) return exactBooks.slice(0, MATCH_COUNT);

  const exactGroups = [];
  const seenGroup = Object.create(null);
  expanded.forEach((row) => {
    if (row.kind !== "group" || titleRelation(row.title, query) !== "exact") return;
    const card = seriesDisplay(row);
    if (!card || seenGroup[card.group_id]) return;
    seenGroup[card.group_id] = true;
    exactGroups.push(card);
  });
  if (exactGroups.length) return exactGroups.slice(0, MATCH_COUNT);

  const ranked = selectRelevantResults(query, expanded);
  return collapseGrouped(ranked);
}

async function clientIdentityHash(ip, secret) {
  const address = String(ip || "").trim();
  const keyText = String(secret || "");
  if (!address || keyText.length < 16 || !globalThis.crypto || !crypto.subtle) return "";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode("kutadgu-ai-search-v1:" + address));
  return Array.from(new Uint8Array(signature)).map((part) => part.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function readReserve(payload) {
  const row = Array.isArray(payload) ? payload[0] : payload;
  return !!(row && row.allowed === true);
}

async function reservePaidCall(fetchImpl, ipHash, timeoutMs, rpcKey) {
  if (!/^[a-f0-9]{32}$/.test(String(ipHash || ""))) return false;
  const url = SUPABASE_URL + "/rest/v1/rpc/" + RESERVE_RPC;
  try {
    return await fetchJsonThen(fetchImpl, url, {
      method: "POST",
      headers: {
        apikey: rpcKey,
        Authorization: "Bearer " + rpcKey,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_ip_hash: ipHash })
    }, timeoutMs || RPC_TIMEOUT_MS, readReserve);
  } catch (err) {
    return false;
  }
}

function acceptSemantic(rows) {
  const list = (rows || []).filter(isPublicCandidate).filter((row) => {
    return Number(row.similarity) >= SEMANTIC_ACCEPT_FLOOR;
  });
  return bySimilarity(list);
}

async function searchPublicCatalog(fetchImpl, query, timeoutMs, rpcKey) {
  const url = SUPABASE_URL + "/rest/v1/rpc/" + CATALOG_RPC;
  try {
    return await fetchJsonThen(fetchImpl, url, {
      method: "POST",
      headers: {
        apikey: rpcKey,
        Authorization: "Bearer " + rpcKey,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_queries: queryVariants(query),
        p_categories: categoryNamesForQuery(query),
        p_limit: CANDIDATE_COUNT
      })
    }, timeoutMs || RPC_TIMEOUT_MS, readCatalogRows);
  } catch (err) {
    if (err && err.code === "http" && err.status === 404) return null;
    if (err && err.code === "http") {
      const error = new Error("catalog_rpc");
      error.code = "catalog_rpc";
      throw error;
    }
    throw err;
  }
}

async function matchBooks(fetchImpl, vector, timeoutMs, rpcKey) {
  const url = SUPABASE_URL + "/rest/v1/rpc/" + MATCH_RPC;
  try {
    return await fetchJsonThen(fetchImpl, url, {
      method: "POST",
      headers: {
        apikey: rpcKey,
        Authorization: "Bearer " + rpcKey,
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

async function listBooksByCategories(fetchImpl, categories, timeoutMs, rpcKey) {
  const names = (categories || []).filter((name) => typeof name === "string" && name);
  if (!names.length) return [];
  const url = SUPABASE_URL + "/rest/v1/rpc/" + CATEGORY_RPC;
  try {
    return await fetchJsonThen(fetchImpl, url, {
      method: "POST",
      headers: {
        apikey: rpcKey,
        Authorization: "Bearer " + rpcKey,
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
  const rpcKey = serverSupabaseKey(env);
  if (!rpcKey) {
    return { status: 503, body: genericError(), openaiCalls: 0, supabaseCalls: 0 };
  }
  const catalogRows = await searchPublicCatalog(fetchImpl, query, opts.rpcTimeoutMs, rpcKey);
  if (!Array.isArray(catalogRows)) {
    return { status: 503, body: genericError(), openaiCalls: 0, supabaseCalls: 1 };
  }
  const lexical = presentSearchResults(query, catalogRows);
  if (lexical.length) {
    return {
      status: 200,
      body: { ok: true, results: lexical, count: lexical.length },
      openaiCalls: 0,
      supabaseCalls: 1
    };
  }
  const reserved = apiKey ? await reservePaidCall(fetchImpl, opts.clientIpHash, opts.rpcTimeoutMs, rpcKey) : false;
  if (!reserved) {
    return {
      status: 200,
      body: { ok: true, results: [], count: 0, semantic: "unavailable" },
      openaiCalls: 0,
      supabaseCalls: 1
    };
  }
  const vector = await embedQuery(fetchImpl, apiKey, query, opts.openaiTimeoutMs);
  const vectorRows = await matchBooks(fetchImpl, vector, opts.rpcTimeoutMs, rpcKey);
  let candidates = vectorRows;
  const resolved = resolveCategoryIntent(query);
  if (resolved.mode === "clear" && resolved.categories.length) {
    try {
      const categoryRows = await listBooksByCategories(fetchImpl, resolved.categories, opts.rpcTimeoutMs, rpcKey);
      if (categoryRows && categoryRows.length) {
        candidates = mergeAiCandidates(vectorRows, categoryRows);
      }
    } catch (err) {
      candidates = vectorRows;
    }
  }
  if (String(env.MULTI_VOLUME_BOOKS_ENABLED || "") === "true") {
    candidates = await mapCandidatesToCatalogUnits(fetchImpl, candidates, opts.rpcTimeoutMs, rpcKey);
    const directory = await loadPublicSeriesDirectory(fetchImpl, opts.rpcTimeoutMs, rpcKey);
    candidates = attachCanonicalSeriesSlugs(candidates, directory);
  }
  let results = presentSearchResults(query, candidates);
  if (!results.length) results = collapseGrouped(acceptSemantic(candidates));
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
      clientIpHash: await clientIdentityHash(opts.trustedClientIp, env.AI_SEARCH_IP_HASH_SECRET),
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
  CATALOG_RPC,
  RESERVE_RPC,
  MAP_UNITS_RPC,
  SEMANTIC_ACCEPT_FLOOR,
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
  foldSpelling,
  queryVariants,
  categoryNamesForQuery,
  selectRelevantResults,
  presentSearchResults,
  mergeAiCandidates,
  mapCandidatesToCatalogUnits,
  intendedCategories,
  resolveCategoryIntent,
  handleAiSearch,
  runSearch
};
