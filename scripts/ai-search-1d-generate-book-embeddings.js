#!/usr/bin/env node
"use strict";

/**
 * AI Search 1D — server-only book embedding backfill (code preparation).
 *
 * Default: DRY RUN (read catalog + embedding metadata, report, exit).
 * Real generation requires BOTH --apply AND
 * AI_SEARCH_1D_CONFIRM_PROJECT matching the expected project ref,
 * plus a Supabase URL whose host is {ref}.supabase.co for that project.
 *
 * Writes (apply only): public.book_embeddings
 * Never writes: public.books
 *
 * This file is not loaded by the storefront. It does not load .env files.
 * Secrets come from process.env only and must never be logged.
 *
 * Env (names only; do not commit values):
 *   SUPABASE_URL                 public project URL (optional; repo default exists)
 *   SUPABASE_SERVICE_ROLE_KEY    required to read embedding metadata / upsert
 *   OPENAI_API_KEY               required only with --apply when work remains
 *   AI_SEARCH_1D_CONFIRM_PROJECT required with --apply; must equal the project ref
 */

const crypto = require("crypto");

const SOURCE_VERSION = "kutadgu-book-embedding-v1";
const SOURCE_FIELDS = Object.freeze([
  "title",
  "author",
  "category",
  "publisher",
  "translator",
  "description"
]);
const EXCLUDED_FIELDS = Object.freeze([
  "price",
  "stock",
  "image_url",
  "sales_count",
  "is_new",
  "is_recommended",
  "is_available",
  "availability",
  "submission_status",
  "isbn",
  "cover",
  "image"
]);
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 25;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const MAX_RETRIES = 3;
const RETRY_STATUSES = Object.freeze([429, 500, 502, 503, 504]);
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EXPECTED_PROJECT_REF = "fxlojnqwyojqjskfggmh";
const APPLY_CONFIRM_ENV = "AI_SEARCH_1D_CONFIRM_PROJECT";
const DEFAULT_SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const BOOK_SELECT = "id,title,author,category,publisher,translator,description,is_active,submission_status";
const EMBEDDING_META_SELECT = "book_id,embedding_model,source_text_hash";
const SECRET_ENV_NAMES = Object.freeze([
  "OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
]);

function normalizeField(value) {
  if (value == null) return "";
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function buildSourceText(book) {
  const lines = [SOURCE_VERSION];
  SOURCE_FIELDS.forEach((field) => {
    const text = normalizeField(book && book[field]);
    if (!text) return;
    lines.push(field + ": " + text);
  });
  return lines.join("\n");
}

function hasEmbeddableText(book) {
  return SOURCE_FIELDS.some((field) => normalizeField(book && book[field]) !== "");
}

function hashSourceText(sourceText) {
  return crypto.createHash("sha256").update(String(sourceText || ""), "utf8").digest("hex");
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  return {
    apply: args.includes("--apply"),
    help: args.includes("--help") || args.includes("-h")
  };
}

function supabaseProjectRefFromUrl(url) {
  try {
    const raw = String(url || "").trim();
    const href = /:\/\//.test(raw) ? raw : "https://" + raw;
    const host = new URL(href).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match ? match[1] : "";
  } catch (err) {
    return "";
  }
}

function assertApplyConfirmed(env) {
  const confirm = String((env && env[APPLY_CONFIRM_ENV]) || "").trim();
  if (confirm !== EXPECTED_PROJECT_REF) {
    const err = new Error("apply_confirm_mismatch");
    err.code = "apply_confirm_mismatch";
    throw err;
  }
  const baseUrl = String((env && env.SUPABASE_URL) || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const ref = supabaseProjectRefFromUrl(baseUrl);
  if (ref !== EXPECTED_PROJECT_REF) {
    const err = new Error("apply_url_mismatch");
    err.code = "apply_url_mismatch";
    throw err;
  }
}

function chunk(items, size) {
  const out = [];
  const n = Math.max(1, Number(size) || BATCH_SIZE);
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function formatVector(values) {
  return "[" + values.join(",") + "]";
}

function secretValuesFromEnv(env) {
  const secrets = [];
  SECRET_ENV_NAMES.forEach((name) => {
    const value = String((env && env[name]) || "").trim();
    if (value) secrets.push(value);
  });
  const auth = String((env && env.Authorization) || "").trim();
  if (auth) secrets.push(auth);
  return secrets;
}

function redactSecrets(value, env) {
  let text = String(value == null ? "" : value);
  secretValuesFromEnv(env).forEach((secret) => {
    if (!secret) return;
    text = text.split(secret).join("[redacted]");
  });
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  text = text.replace(/(OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  return text;
}

function createLogger(logFn, env) {
  const write = typeof logFn === "function" ? logFn : console.log;
  return function log() {
    const parts = Array.prototype.slice.call(arguments).map((part) => redactSecrets(part, env));
    write.apply(null, parts);
  };
}

function classifyPlans(books, existingRows, model) {
  const embeddingModel = model || EMBEDDING_MODEL;
  const existingById = new Map();
  (existingRows || []).forEach((row) => {
    const id = Number(row && row.book_id);
    if (Number.isFinite(id)) existingById.set(id, row);
  });

  const missing = [];
  const stale = [];
  const unchanged = [];
  const skippedEmpty = [];
  const ignoredInactive = [];

  (books || []).forEach((book) => {
    const id = Number(book && book.id);
    if (!Number.isFinite(id)) return;
    if (book.is_active !== true || book.submission_status !== "approved") {
      ignoredInactive.push(id);
      return;
    }
    if (!hasEmbeddableText(book)) {
      skippedEmpty.push(id);
      return;
    }
    const sourceText = buildSourceText(book);
    const sourceTextHash = hashSourceText(sourceText);
    const plan = {
      bookId: id,
      sourceText,
      sourceTextHash,
      embeddingModel
    };
    const existing = existingById.get(id);
    if (!existing) {
      missing.push(plan);
      return;
    }
    const sameHash = String(existing.source_text_hash || "") === sourceTextHash;
    const sameModel = String(existing.embedding_model || "") === embeddingModel;
    if (sameHash && sameModel) {
      unchanged.push(plan);
      return;
    }
    plan.staleReason = !sameModel ? "model" : "hash";
    stale.push(plan);
  });

  return { missing, stale, unchanged, skippedEmpty, ignoredInactive };
}

function workList(classified) {
  return (classified.missing || []).concat(classified.stale || []);
}

function validateEmbeddingResponse(plans, payload) {
  const data = payload && Array.isArray(payload.data) ? payload.data.slice() : null;
  if (!data) {
    const err = new Error("embedding_response_invalid");
    err.code = "embedding_response_invalid";
    throw err;
  }
  if (data.length !== plans.length) {
    const err = new Error("embedding_count_mismatch");
    err.code = "embedding_count_mismatch";
    throw err;
  }
  data.sort((a, b) => Number(a && a.index) - Number(b && b.index));
  return plans.map((plan, expectedIndex) => {
    const row = data[expectedIndex];
    if (!row || Number(row.index) !== expectedIndex) {
      const err = new Error("embedding_index_mismatch");
      err.code = "embedding_index_mismatch";
      throw err;
    }
    const vector = row.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      const err = new Error("embedding_dimension_mismatch");
      err.code = "embedding_dimension_mismatch";
      throw err;
    }
    for (let i = 0; i < vector.length; i += 1) {
      if (typeof vector[i] !== "number" || !Number.isFinite(vector[i])) {
        const err = new Error("embedding_non_finite");
        err.code = "embedding_non_finite";
        throw err;
      }
    }
    return {
      book_id: plan.bookId,
      embedding: formatVector(vector),
      embedding_model: plan.embeddingModel,
      source_text_hash: plan.sourceTextHash
    };
  });
}

function isRetryableStatus(status) {
  return RETRY_STATUSES.indexOf(Number(status)) !== -1;
}

function requireEnv(env, name) {
  const value = String((env && env[name]) || "").trim();
  if (!value) {
    const err = new Error("missing_env_" + name);
    err.code = "missing_env";
    err.envName = name;
    throw err;
  }
  return value;
}

function supabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

function restUrl(baseUrl, table, query) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  return root + "/rest/v1/" + table + (query ? "?" + query : "");
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const error = new Error("invalid_json");
    error.code = "invalid_json";
    throw error;
  }
}

async function fetchWithRetry(fetchImpl, url, init, extras) {
  const sleep = extras && extras.sleep;
  const maxRetries = extras && extras.maxRetries != null ? extras.maxRetries : MAX_RETRIES;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(url, init);
    lastStatus = response && response.status;
    if (response && response.ok) return response;
    const retry = isRetryableStatus(lastStatus) && attempt < maxRetries;
    if (!retry) {
      const err = new Error("http_" + lastStatus);
      err.code = "http_error";
      err.status = lastStatus;
      err.failClosed = true;
      err.retryable = isRetryableStatus(lastStatus);
      throw err;
    }
    if (typeof sleep === "function") {
      await sleep(400 * Math.pow(2, attempt));
    }
  }
  const err = new Error("http_" + lastStatus);
  err.code = "http_error";
  err.status = lastStatus;
  err.failClosed = true;
  throw err;
}

async function fetchPagedSelect(fetchImpl, baseUrl, serviceKey, table, query, extras) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const url = restUrl(baseUrl, table, query);
    const response = await fetchWithRetry(fetchImpl, url, {
      method: "GET",
      headers: Object.assign({}, supabaseHeaders(serviceKey), {
        Range: from + "-" + to,
        Prefer: "count=exact"
      })
    }, extras);
    const batch = await readJson(response);
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push.apply(rows, batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadEligibleBooks(fetchImpl, baseUrl, serviceKey, extras) {
  const query =
    "select=" + BOOK_SELECT +
    "&is_active=eq.true" +
    "&submission_status=eq.approved" +
    "&order=id.asc";
  const rows = await fetchPagedSelect(fetchImpl, baseUrl, serviceKey, "books", query, extras);
  return rows.filter((row) => row && row.is_active === true && row.submission_status === "approved");
}

async function loadEmbeddingMeta(fetchImpl, baseUrl, serviceKey, extras) {
  return fetchPagedSelect(
    fetchImpl,
    baseUrl,
    serviceKey,
    "book_embeddings",
    "select=" + EMBEDDING_META_SELECT + "&order=book_id.asc",
    extras
  );
}

async function upsertEmbeddings(fetchImpl, baseUrl, serviceKey, rows, extras) {
  if (!rows || !rows.length) return;
  const url = restUrl(baseUrl, "book_embeddings", "on_conflict=book_id");
  if (!/\/book_embeddings\?/.test(url) || /\/books\?/.test(url)) {
    const err = new Error("refusing_non_embedding_write");
    err.code = "refusing_non_embedding_write";
    throw err;
  }
  const response = await fetchWithRetry(fetchImpl, url, {
    method: "POST",
    headers: Object.assign({}, supabaseHeaders(serviceKey), {
      Prefer: "resolution=merge-duplicates,return=minimal"
    }),
    body: JSON.stringify(rows)
  }, extras);
  return response;
}

async function embedBatch(fetchImpl, apiKey, plans, extras) {
  const response = await fetchWithRetry(fetchImpl, OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
      input: plans.map((plan) => plan.sourceText)
    })
  }, extras);
  const payload = await readJson(response);
  return validateEmbeddingResponse(plans, payload);
}

function summarize(classified, mode, wrote, openaiCalls) {
  return {
    mode,
    totalBooks: (classified.missing.length + classified.stale.length + classified.unchanged.length + classified.skippedEmpty.length),
    missing: classified.missing.length,
    stale: classified.stale.length,
    unchanged: classified.unchanged.length,
    skippedEmpty: classified.skippedEmpty.length,
    ignoredInactive: classified.ignoredInactive.length,
    toEmbed: workList(classified).length,
    wrote: wrote || 0,
    openaiCalls: openaiCalls || 0
  };
}

async function runBackfill(options) {
  const opts = options || {};
  const argv = opts.argv || process.argv;
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || fetch;
  const flags = parseArgs(argv);
  const log = createLogger(opts.log, env);
  const extras = { sleep: opts.sleep, maxRetries: opts.maxRetries };

  if (flags.help) {
    log("AI Search 1D embedding backfill. Default is dry-run.");
    log("Apply requires --apply and AI_SEARCH_1D_CONFIRM_PROJECT matching the project ref.");
    return { ok: true, help: true, openaiCalls: 0, wrote: 0 };
  }

  if (flags.apply) {
    assertApplyConfirmed(env);
  }

  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const baseUrl = String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const books = await loadEligibleBooks(fetchImpl, baseUrl, serviceKey, extras);
  const existing = await loadEmbeddingMeta(fetchImpl, baseUrl, serviceKey, extras);
  const classified = classifyPlans(books, existing, EMBEDDING_MODEL);
  const pending = workList(classified);

  if (!flags.apply) {
    const summary = summarize(classified, "dry-run", 0, 0);
    log("AI Search 1D dry-run");
    log("total_books=" + summary.totalBooks);
    log("missing=" + summary.missing);
    log("stale=" + summary.stale);
    log("unchanged=" + summary.unchanged);
    log("skipped_empty=" + summary.skippedEmpty);
    log("no OpenAI calls, no database writes");
    return Object.assign({ ok: true, classified, pending }, summary);
  }

  let openaiCalls = 0;
  let wrote = 0;
  if (!pending.length) {
    const summary = summarize(classified, "apply", 0, 0);
    log("AI Search 1D apply: nothing to embed");
    return Object.assign({ ok: true, classified, pending }, summary);
  }

  const apiKey = requireEnv(env, "OPENAI_API_KEY");
  const batches = chunk(pending, opts.batchSize || BATCH_SIZE);
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const rows = await embedBatch(fetchImpl, apiKey, batch, extras);
    openaiCalls += 1;
    await upsertEmbeddings(fetchImpl, baseUrl, serviceKey, rows, extras);
    wrote += rows.length;
    log("batch " + (i + 1) + "/" + batches.length + " upserted=" + rows.length);
  }

  const summary = summarize(classified, "apply", wrote, openaiCalls);
  log("AI Search 1D apply complete wrote=" + wrote);
  return Object.assign({ ok: true, classified, pending }, summary);
}

async function main() {
  try {
    const result = await runBackfill({
      argv: process.argv,
      env: process.env,
      fetchImpl: fetch
    });
    if (result && result.ok) process.exitCode = 0;
  } catch (err) {
    const log = createLogger(console.error, process.env);
    log("AI Search 1D failed:", err && (err.code || err.message) || "error");
    process.exitCode = 1;
  }
}

const api = {
  SOURCE_VERSION,
  SOURCE_FIELDS,
  EXCLUDED_FIELDS,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  BATCH_SIZE,
  OPENAI_EMBEDDINGS_URL,
  EXPECTED_PROJECT_REF,
  APPLY_CONFIRM_ENV,
  DEFAULT_SUPABASE_URL,
  BOOK_SELECT,
  EMBEDDING_META_SELECT,
  normalizeField,
  buildSourceText,
  hasEmbeddableText,
  hashSourceText,
  parseArgs,
  supabaseProjectRefFromUrl,
  assertApplyConfirmed,
  chunk,
  formatVector,
  redactSecrets,
  classifyPlans,
  workList,
  validateEmbeddingResponse,
  isRetryableStatus,
  runBackfill
};

module.exports = api;

if (require.main === module) {
  main();
}
