#!/usr/bin/env node
"use strict";

/*
  Read-only book cover audit by default.
  Mutations require KUTADGU_COVER_REPAIR_APPLY=1 and a service-role key.
  This file never contains credentials.
*/

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SAMPLE_SHA = {
  "sample-book-cover.png": "596d3ed8ffab73b6c5b9059cd97cba5e12e9222da66dd0efe5bf3eaaa4aae183",
  "sample-book-cover(1).png": "596d3ed8ffab73b6c5b9059cd97cba5e12e9222da66dd0efe5bf3eaaa4aae183",
  "carousel-sample-cover.png": "2e144fd20d419c3360b53dca21ce97df2f105b7f637cc48644b043fddb4bc6b9"
};
const SAMPLE_DHASH = {
  "sample-book-cover.png": "6305088ce639c9a0",
  "sample-book-cover(1).png": "6305088ce639c9a0",
  "carousel-sample-cover.png": "6305088ce638c9a0"
};
const KNOWN_SAMPLE_SHA = new Set(Object.values(SAMPLE_SHA));
const KNOWN_SAMPLE_DHASH = new Set(Object.values(SAMPLE_DHASH));
const SAMPLE_NAME = /(?:^|\/)(?:sample-book-cover(?:\(\d+\))?|carousel-sample-cover)\.png(?:$|\?)/i;
// Production pairwise dHash distances on the live 274-book catalog cluster at 0
// (exact bytes) and 1–5 (same artwork after resize or recompression). Distance 4
// is empty. From 6 upward the tail mixes looser series designs with unrelated
// books, so those pairs stay out of automatic review. Known sample variants
// differ by distance 1, which this threshold includes. Near matches are review
// evidence only and are never auto-repaired.
const COVER_DHASH_REVIEW_DISTANCE = 5;
const DHASH_RE = /^[0-9a-f]{16}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isSampleName(url) {
  return SAMPLE_NAME.test(String(url || "").trim());
}

function storageOwnerId(imageUrl) {
  const match = String(imageUrl || "").match(/\/book-covers\/([^/?#]+)\//i);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
}

function bookStorageToken(id) {
  return String(id || "book").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "book";
}

function wrongOwnership(book, owner, ids) {
  if (!owner || owner === "book" || owner === "staff" || owner === "gallery") return false;
  const id = String(book.id);
  const token = bookStorageToken(id);
  if (owner === id || owner === token) return false;
  const known = ids || new Set();
  if (known.has(owner) && owner !== id) return true;
  return /^\d+$/.test(owner) && owner !== id;
}

function suspiciousUrl(url) {
  const t = String(url || "").trim();
  if (!t) return "";
  if (/^blob:/i.test(t)) return "blob-url";
  if (/^data:/i.test(t)) return "data-url";
  if (/^(?:javascript|vbscript|file):/i.test(t)) return "unsafe-url";
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(t)) return "local-url";
  if (/placeholder|placehold\.co|via\.placeholder|dummyimage/i.test(t)) return "placeholder-url";
  if (isSampleName(t)) return "sample-name";
  if (/\/gallery\//i.test(t)) return "gallery-path";
  return "";
}

function dhashDistance(hashA, hashB) {
  const a = String(hashA || "").trim().toLowerCase();
  const b = String(hashB || "").trim().toLowerCase();
  if (!DHASH_RE.test(a) || !DHASH_RE.test(b)) return null;
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

function possibleSeriesTitles(titles) {
  const bases = (titles || []).map((title) => String(title || "")
    .replace(/\d+\s*[-.ـ]?\s*(?:كىتاب|قىسىم|جلد|بۆلۈم|volume|vol\.?)/gi, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase());
  if (bases.length < 2 || bases.some((base) => base.length < 4)) return false;
  return bases.every((base) => base === bases[0]);
}

function dhashFromGray(raw) {
  if (!raw || raw.length < 72) return "";
  let bits = "";
  const gray = (x, y) => raw[y * 9 + x];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += gray(x, y) > gray(x + 1, y) ? "1" : "0";
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

function visualPairs(records, reviewDistance) {
  const limit = reviewDistance == null ? COVER_DHASH_REVIEW_DISTANCE : reviewDistance;
  const visual = records.filter((row) => DHASH_RE.test(String(row.dhash || "").toLowerCase()));
  const pairs = [];
  for (let i = 0; i < visual.length; i++) {
    for (let j = i + 1; j < visual.length; j++) {
      const left = visual[i];
      const right = visual[j];
      const distance = dhashDistance(left.dhash, right.dhash);
      if (distance == null || distance > limit) continue;
      const sameSha = !!(left.sha256 && left.sha256 === right.sha256);
      pairs.push({
        distance,
        sameSha,
        ids: [left.id, right.id],
        titles: [left.title || "", right.title || ""],
        sha256: [left.sha256 || "", right.sha256 || ""],
        dhash: [String(left.dhash).toLowerCase(), String(right.dhash).toLowerCase()],
        image_url: [String(left.image_url || ""), String(right.image_url || "")],
        width: [left.width || 0, right.width || 0],
        height: [left.height || 0, right.height || 0],
        possibleSeries: possibleSeriesTitles([left.title, right.title])
      });
    }
  }
  return pairs;
}

function distanceHistogram(records) {
  const buckets = {};
  const visual = records.filter((row) => DHASH_RE.test(String(row.dhash || "").toLowerCase()));
  for (let i = 0; i < visual.length; i++) {
    for (let j = i + 1; j < visual.length; j++) {
      const distance = dhashDistance(visual[i].dhash, visual[j].dhash);
      if (distance == null) continue;
      const key = distance > 16 ? "17+" : String(distance);
      buckets[key] = (buckets[key] || 0) + 1;
    }
  }
  return buckets;
}

function classifyRecords(records, options) {
  const reviewDistance = options && options.reviewDistance != null ? options.reviewDistance : COVER_DHASH_REVIEW_DISTANCE;
  const ids = new Set(records.map((row) => String(row.id)));
  const bySha = new Map();
  records.forEach((row) => {
    if (row.sha256) {
      if (!bySha.has(row.sha256)) bySha.set(row.sha256, []);
      bySha.get(row.sha256).push(row.id);
    }
  });
  const pairs = visualPairs(records, reviewDistance);
  const exactVisualIds = new Map();
  const nearIds = new Map();
  const nearest = new Map();
  pairs.forEach((pair) => {
    if (pair.sameSha) return;
    pair.ids.forEach((id, index) => {
      const other = pair.ids[1 - index];
      const bucket = pair.distance === 0 ? exactVisualIds : nearIds;
      if (!bucket.has(id)) bucket.set(id, []);
      bucket.get(id).push(other);
      const prev = nearest.get(id);
      if (!prev || pair.distance < prev.distance) nearest.set(id, { distance: pair.distance, id: other });
    });
  });
  return records.map((row) => {
    const url = String(row.image_url || "").trim();
    const owner = storageOwnerId(url);
    const suspicion = suspiciousUrl(url);
    const exactIds = row.sha256 ? (bySha.get(row.sha256) || []) : [];
    const exact = exactIds.length > 1;
    const exactVisual = !exact && (exactVisualIds.get(row.id) || []).length > 0;
    const near = !exact && !exactVisual && (nearIds.get(row.id) || []).length > 0;
    const known = !!(row.sha256 && KNOWN_SAMPLE_SHA.has(row.sha256)) || !!(row.dhash && KNOWN_SAMPLE_DHASH.has(row.dhash));
    const broken = !!url && !!row.broken;
    const noCover = !url;
    const wrong = !!url && wrongOwnership(row, owner, ids);
    const needs = !noCover && !broken && !known && !wrong && !exact && !exactVisual && !near && (!!suspicion || !!row.rateLimited);
    let state = "HEALTHY_UNIQUE";
    if (row.conflict) state = "CONFLICT";
    else if (noCover) state = "NO_COVER";
    else if (broken) state = "BROKEN_URL";
    else if (known) state = "KNOWN_SAMPLE";
    else if (wrong) state = "WRONG_OWNERSHIP";
    else if (exact) state = "EXACT_DUPLICATE";
    else if (exactVisual) state = "EXACT_VISUAL_DUPLICATE";
    else if (near) state = "NEAR_VISUAL_DUPLICATE";
    else if (needs) state = "NEEDS_REVIEW";
    else if (row.safeRepair && row.replacement) state = "SAFE_REPAIR";
    const nearMatch = nearest.get(row.id);
    return {
      id: row.id,
      title: row.title || "",
      image_url: url,
      sha256: row.sha256 || "",
      dhash: row.dhash || "",
      width: row.width || 0,
      height: row.height || 0,
      cover_sha256: row.cover_sha256 || null,
      cover_dhash: row.cover_dhash || null,
      state,
      owner,
      suspicion,
      exactIds: exactIds.length > 1 ? exactIds : [],
      exactVisualIds: exactVisualIds.get(row.id) || [],
      nearIds: nearIds.get(row.id) || [],
      nearestDistance: nearMatch ? nearMatch.distance : null,
      replacement: row.replacement || null,
      evidence: row.evidence || suspicion || ""
    };
  });
}

function exactShaGroups(rows) {
  const bySha = new Map();
  rows.forEach((row) => {
    if (!row.sha256 || !(row.exactIds && row.exactIds.length > 1)) return;
    if (!bySha.has(row.sha256)) bySha.set(row.sha256, []);
    bySha.get(row.sha256).push(row);
  });
  return [...bySha.values()].map((group) => ({
    distance: 0,
    exactSha: true,
    possibleSeries: possibleSeriesTitles(group.map((row) => row.title)),
    ids: group.map((row) => row.id),
    titles: group.map((row) => row.title),
    sha256: group.map((row) => row.sha256),
    dhash: group.map((row) => row.dhash),
    image_url: group.map((row) => row.image_url),
    width: group.map((row) => row.width),
    height: group.map((row) => row.height),
    decision: "EXACT_DUPLICATE",
    repair: "not-applied"
  }));
}

function groupPairs(pairs, distanceTest) {
  return pairs.filter(distanceTest).map((pair) => ({
    distance: pair.distance,
    exactSha: pair.sameSha,
    possibleSeries: pair.possibleSeries,
    ids: pair.ids,
    titles: pair.titles,
    sha256: pair.sha256,
    dhash: pair.dhash,
    image_url: pair.image_url,
    width: pair.width,
    height: pair.height,
    decision: pair.distance === 0 ? "EXACT_VISUAL_DUPLICATE" : "NEEDS_REVIEW",
    repair: "not-applied"
  }));
}

function summarize(rows) {
  const counts = {
    TOTAL_BOOKS: rows.length,
    HEALTHY_UNIQUE: 0,
    EXACT_DUPLICATE: 0,
    EXACT_VISUAL_DUPLICATE: 0,
    NEAR_VISUAL_DUPLICATE: 0,
    KNOWN_SAMPLE: 0,
    BROKEN_URL: 0,
    NO_COVER: 0,
    WRONG_OWNERSHIP: 0,
    SAFE_REPAIR: 0,
    NEEDS_REVIEW: 0,
    CONFLICT: 0
  };
  rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(counts, row.state)) counts[row.state] += 1;
  });
  return counts;
}

function objectivelyBadCover(row) {
  return row.state === "KNOWN_SAMPLE" || row.state === "WRONG_OWNERSHIP" || row.state === "EXACT_DUPLICATE" || row.state === "EXACT_VISUAL_DUPLICATE";
}

function evaluateHistoricalReplacement(book, candidates, reviewDistance) {
  const limit = reviewDistance == null ? COVER_DHASH_REVIEW_DISTANCE : reviewDistance;
  const bookId = String(book && book.id);
  const plausible = (candidates || []).filter((candidate) => {
    if (!candidate || candidate.broken || candidate.sample || candidate.usedByOtherBook) return false;
    if (String(candidate.bookId || "") !== bookId) return false;
    if (!candidate.path || !SHA_RE.test(candidate.sha256 || "") || !DHASH_RE.test(candidate.dhash || "")) return false;
    if (candidate.sha256 === book.sha256) return false;
    const distance = dhashDistance(candidate.dhash, book.dhash);
    if (distance == null || distance <= limit) return false;
    return true;
  });
  if (plausible.length !== 1) return { replacement: null, plausibleCount: plausible.length };
  return { replacement: plausible[0], plausibleCount: 1 };
}

function applyHistoricalReplacements(rows, candidatesById) {
  return rows.map((row) => {
    if (!objectivelyBadCover(row) || row.state === "NEAR_VISUAL_DUPLICATE") return row;
    const decision = evaluateHistoricalReplacement(row, candidatesById.get(String(row.id)) || []);
    if (!decision.replacement) return row;
    return {
      ...row,
      state: "SAFE_REPAIR",
      replacement: decision.replacement,
      evidence: "exactly one historical object in this book folder is visually different, not a sample, and unused by another book"
    };
  });
}

function fingerprintWritable(row) {
  return SHA_RE.test(row.sha256 || "") && DHASH_RE.test(String(row.dhash || "").toLowerCase());
}

function buildSafeRepairChanges(rows) {
  return rows.filter((row) => row.state === "SAFE_REPAIR" && row.replacement && row.replacement.imageUrl).map((row) => ({
    id: row.id,
    title: row.title,
    reason: "safe-repair",
    expectedImageUrl: row.image_url,
    expectedSha: row.cover_sha256 || null,
    expectedDhash: row.cover_dhash || null,
    patch: {
      image_url: row.replacement.imageUrl,
      cover_sha256: row.replacement.sha256,
      cover_dhash: row.replacement.dhash
    },
    evidence: row.evidence
  }));
}

function buildBackfillChanges(rows) {
  const changes = [];
  rows.forEach((row) => {
    if (row.state === "SAFE_REPAIR" && row.replacement && row.image_url === row.replacement.imageUrl && fingerprintWritable(row.replacement)) {
      changes.push({
        id: row.id,
        title: row.title,
        reason: "backfill-repaired",
        expectedImageUrl: row.image_url,
        expectedSha: row.cover_sha256 || null,
        expectedDhash: row.cover_dhash || null,
        patch: { cover_sha256: row.replacement.sha256, cover_dhash: row.replacement.dhash }
      });
      return;
    }
    if (row.state !== "HEALTHY_UNIQUE" || !fingerprintWritable(row) || !row.image_url) return;
    changes.push({
      id: row.id,
      title: row.title,
      reason: "backfill-healthy",
      expectedImageUrl: row.image_url,
      expectedSha: row.cover_sha256 || null,
      expectedDhash: row.cover_dhash || null,
      patch: { cover_sha256: row.sha256, cover_dhash: String(row.dhash).toLowerCase() }
    });
  });
  const blockedSha = new Set();
  const blockedVisual = new Set();
  const seenSha = new Map();
  const seenVisual = new Map();
  changes.forEach((change) => {
    const sha = change.patch.cover_sha256;
    const visual = change.patch.cover_dhash;
    if (seenSha.has(sha)) blockedSha.add(sha);
    if (seenVisual.has(visual)) blockedVisual.add(visual);
    seenSha.set(sha, change.id);
    seenVisual.set(visual, change.id);
  });
  return changes.filter((change) => !blockedSha.has(change.patch.cover_sha256) && !blockedVisual.has(change.patch.cover_dhash));
}

function mutationMode(argv, env) {
  const args = argv || [];
  const mode = args.includes("--apply-safe") ? "apply-safe" : args.includes("--backfill") ? "backfill" : "audit";
  if (mode === "audit") return { mode, mutate: false };
  if (!env || env.KUTADGU_COVER_REPAIR_APPLY !== "1") return { mode, mutate: false, refuse: "gate" };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { mode, mutate: false, refuse: "service" };
  return { mode, mutate: true };
}

function bookFilter(name, expected) {
  if (expected == null || expected === "") return name + "=is.null";
  return name + "=eq." + encodeURIComponent(String(expected));
}

async function patchBookCover(cfg, change, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const filters = [
    bookFilter("id", change.id),
    bookFilter("image_url", change.expectedImageUrl),
    bookFilter("cover_sha256", change.expectedSha),
    bookFilter("cover_dhash", change.expectedDhash)
  ];
  const res = await fetchFn(cfg.url + "/rest/v1/books?" + filters.join("&"), {
    method: "PATCH",
    headers: {
      apikey: cfg.key,
      Authorization: "Bearer " + cfg.key,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(change.patch)
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  const code = body && (body.code || (body.error && body.error.code));
  if (res.status === 409 || code === "23505") {
    return { ok: false, uniqueConflict: true, conflict: false, error: "unique-index" };
  }
  if (!res.ok) return { ok: false, uniqueConflict: false, conflict: false, error: "http-" + res.status };
  if (!Array.isArray(body) || !body.length) return { ok: false, uniqueConflict: false, conflict: true, error: "conflict" };
  return { ok: true, uniqueConflict: false, conflict: false, row: body[0] };
}

async function applyChanges(cfg, changes, fetchImpl) {
  const results = [];
  for (const change of changes) {
    const result = await patchBookCover(cfg, change, fetchImpl);
    results.push({
      id: change.id,
      title: change.title,
      reason: change.reason,
      expectedImageUrl: change.expectedImageUrl,
      patch: change.patch,
      ok: result.ok,
      conflict: !!result.conflict,
      uniqueConflict: !!result.uniqueConflict,
      error: result.error || ""
    });
  }
  return results;
}

function publicConfig() {
  const src = fs.readFileSync(path.join(ROOT, "supabase-config.js"), "utf8");
  const url = (src.match(/url:\s*"([^"]+)"/) || [])[1] || "";
  const anonKey = (src.match(/anonKey:\s*"([^"]+)"/) || [])[1] || "";
  return {
    url: process.env.SUPABASE_URL || url,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || anonKey,
    service: !!process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

function verifyKnownSamples() {
  const file = path.join(ROOT, "sample-book-cover.png");
  const bytes = fs.readFileSync(file);
  const digest = sha256(bytes);
  if (digest !== SAMPLE_SHA["sample-book-cover.png"]) {
    throw new Error("sample-book-cover.png SHA-256 does not match the known sample fingerprint");
  }
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

function ffmpegDhash(file) {
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name",
    "-of", "json",
    file
  ], { encoding: "utf8" });
  if (probe.status !== 0) return { broken: true, error: "ffprobe" };
  let meta = {};
  try { meta = JSON.parse(probe.stdout || "{}").streams[0] || {}; } catch (e) { return { broken: true, error: "ffprobe-json" }; }
  const raw = spawnSync("ffmpeg", [
    "-v", "error", "-i", file,
    "-vf", "scale=9:8,format=gray",
    "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"
  ], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  if (raw.status !== 0 || !raw.stdout || raw.stdout.length < 72) return { broken: true, error: "ffmpeg", width: meta.width, height: meta.height };
  return {
    broken: false,
    width: Number(meta.width) || 0,
    height: Number(meta.height) || 0,
    mime: meta.codec_name || "",
    dhash: dhashFromGray(raw.stdout)
  };
}

async function fetchBooks(cfg) {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const res = await fetch(cfg.url + "/rest/v1/books?select=id,title,isbn,price,stock,image_url,cover_sha256,cover_dhash,gallery_images,is_active&order=id.asc", {
      headers: {
        apikey: cfg.key,
        Authorization: "Bearer " + cfg.key,
        Range: from + "-" + to
      }
    });
    if (!res.ok) throw new Error("books select failed: " + res.status);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inspectImage(url) {
  let res = null;
  let lastError = "fetch";
  for (let attempt = 0; attempt < 6; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      res = await fetch(url, { signal: controller.signal, redirect: "follow" });
      if (res.status !== 429 && res.status !== 503) break;
      lastError = "http-" + res.status;
      await sleep(400 * (2 ** attempt));
    } catch (error) {
      lastError = error.name === "AbortError" ? "timeout" : "fetch";
      await sleep(400 * (2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  if (!res || !res.ok) {
    if (lastError === "http-429" || lastError === "http-503") return { broken: false, rateLimited: true, error: lastError };
    return { broken: true, error: res ? "http-" + res.status : lastError };
  }
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { broken: true, error: "empty" };
    const tmp = path.join(os.tmpdir(), "kutadgu-cover-" + crypto.randomBytes(8).toString("hex"));
    fs.writeFileSync(tmp, buf);
    try {
      const visual = ffmpegDhash(tmp);
      return {
        broken: visual.broken,
        error: visual.error || "",
        sha256: sha256(buf),
        dhash: visual.dhash || "",
        width: visual.width || 0,
        height: visual.height || 0,
        mime: res.headers.get("content-type") || visual.mime || "",
        bytes: buf.length
      };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } catch (error) {
    return { broken: true, error: "decode" };
  }
}

function mutationAllowed() {
  return process.env.KUTADGU_COVER_REPAIR_APPLY === "1";
}

async function listStoragePrefix(cfg, prefix, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const objects = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetchFn(cfg.url + "/storage/v1/object/list/book-covers", {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: "Bearer " + cfg.key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "created_at", order: "asc" } })
    });
    if (!res.ok) throw new Error("storage list failed: " + res.status);
    const chunk = await res.json();
    if (!Array.isArray(chunk) || !chunk.length) break;
    objects.push(...chunk.filter((entry) => entry && entry.id && entry.name && !String(entry.name).endsWith("/")));
    if (chunk.length < 100) break;
  }
  return objects;
}

function currentObjectName(imageUrl) {
  const match = String(imageUrl || "").match(/\/book-covers\/[^/?#]+\/([^/?#]+)$/i);
  return match ? decodeURIComponent(match[1]) : "";
}

async function inspectStorageHistory(cfg, rows, usedBySha, fetchImpl) {
  const candidatesById = new Map();
  const notes = [];
  for (const row of rows) {
    if (!objectivelyBadCover(row)) continue;
    const prefix = String(row.id) + "/";
    let listed = [];
    try {
      listed = await listStoragePrefix(cfg, prefix, fetchImpl);
    } catch (error) {
      notes.push({ id: row.id, error: error.message || "storage-list-failed" });
      candidatesById.set(String(row.id), []);
      continue;
    }
    const currentName = currentObjectName(row.image_url);
    const files = listed.filter((entry) => entry.name !== currentName);
    const inspected = [];
    for (const entry of files) {
      const imageUrl = cfg.url + "/storage/v1/object/public/book-covers/" + prefix + encodeURIComponent(entry.name).replace(/%2F/g, "/");
      await sleep(120);
      const image = await inspectImage(imageUrl);
      const digest = image.sha256 || "";
      const owners = usedBySha.get(digest) || [];
      inspected.push({
        bookId: String(row.id),
        path: prefix + entry.name,
        imageUrl,
        created_at: entry.created_at || "",
        updated_at: entry.updated_at || "",
        sha256: digest,
        dhash: image.dhash || "",
        mime: image.mime || "",
        width: image.width || 0,
        height: image.height || 0,
        bytes: image.bytes || 0,
        broken: !!image.broken,
        sample: !!(digest && KNOWN_SAMPLE_SHA.has(digest)) || !!(image.dhash && KNOWN_SAMPLE_DHASH.has(image.dhash)),
        usedByOtherBook: owners.some((id) => String(id) !== String(row.id))
      });
    }
    candidatesById.set(String(row.id), inspected);
    notes.push({ id: row.id, candidates: inspected.length });
  }
  return { candidatesById, notes };
}

function writePrivateReport(report) {
  const outDir = path.join(os.tmpdir(), "kutadgu-cover-audit");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  if (report.plannedChanges && report.plannedChanges.length) {
    fs.writeFileSync(path.join(outDir, "rollback.json"), JSON.stringify({
      at: report.auditedAt,
      changes: report.plannedChanges
    }, null, 2));
  }
  return outFile;
}

async function main() {
  const decision = mutationMode(process.argv, process.env);
  verifyKnownSamples();
  if (decision.refuse === "gate") {
    console.error("REFUSING MUTATION: set KUTADGU_COVER_REPAIR_APPLY=1 to apply safe repairs or backfill. No rows were changed.");
    process.exit(1);
  }
  const cfg = publicConfig();
  if (!cfg.url || !cfg.key) throw new Error("Supabase URL or key is unavailable");
  if (decision.refuse === "service" || (decision.mode !== "audit" && !cfg.service)) {
    console.error("PRODUCTION REPAIR NOT APPLIED: service-role credentials are unavailable. No rows were changed.");
    process.exit(2);
  }
  const books = await fetchBooks(cfg);
  const inspected = await mapPool(books, 2, async (book) => {
    await sleep(120);
    const url = String(book.image_url || "").trim();
    if (!url || /^(?:blob|data|javascript|file):/i.test(url)) {
      return { ...book, image_url: url, broken: !!url, evidence: suspiciousUrl(url) };
    }
    const image = await inspectImage(url);
    return {
      ...book,
      image_url: url,
      sha256: image.sha256 || "",
      dhash: image.dhash || "",
      broken: image.broken && !image.rateLimited,
      rateLimited: !!image.rateLimited,
      evidence: image.error || "",
      width: image.width,
      height: image.height,
      mime: image.mime,
      bytes: image.bytes
    };
  });
  let classified = classifyRecords(inspected);
  let storageHistory = cfg.service ? "listed" : "not-listed: service role required";
  if (cfg.service) {
    const usedBySha = new Map();
    inspected.forEach((row) => {
      if (!row.sha256) return;
      if (!usedBySha.has(row.sha256)) usedBySha.set(row.sha256, []);
      usedBySha.get(row.sha256).push(row.id);
    });
    const history = await inspectStorageHistory(cfg, classified, usedBySha);
    storageHistory = history.notes;
    classified = applyHistoricalReplacements(classified, history.candidatesById);
  }
  const pairs = visualPairs(classified, 12);
  const counts = summarize(classified);
  const plannedChanges = decision.mutate
    ? (decision.mode === "apply-safe" ? buildSafeRepairChanges(classified) : buildBackfillChanges(classified))
    : [];
  let mutations = [];
  if (decision.mutate && plannedChanges.length) {
    mutations = await applyChanges(cfg, plannedChanges);
  }
  const applied = mutations.filter((row) => row.ok).length;
  const report = {
    auditedAt: new Date().toISOString(),
    mode: decision.mode,
    reviewDistance: COVER_DHASH_REVIEW_DISTANCE,
    serviceRole: cfg.service,
    productionRepairApplied: applied > 0,
    storageHistory,
    histogram: distanceHistogram(inspected),
    counts,
    exactGroups: exactShaGroups(classified),
    exactVisualGroups: groupPairs(pairs, (pair) => pair.distance === 0 && !pair.sameSha),
    nearGroups: groupPairs(pairs, (pair) => pair.distance > 0 && pair.distance <= COVER_DHASH_REVIEW_DISTANCE && !pair.sameSha),
    distanceCandidates: groupPairs(pairs, (pair) => pair.distance > COVER_DHASH_REVIEW_DISTANCE && pair.distance <= 12 && !pair.sameSha),
    plannedChanges,
    mutations,
    problems: classified.filter((row) => row.state !== "HEALTHY_UNIQUE" && row.state !== "NO_COVER"),
    fingerprints: classified.map((row) => ({
      id: row.id,
      title: row.title,
      image_url: row.image_url,
      sha256: row.sha256,
      dhash: row.dhash,
      width: row.width,
      height: row.height,
      state: row.state
    }))
  };
  const outFile = writePrivateReport(report);
  console.log(JSON.stringify({ ...counts, reviewDistance: COVER_DHASH_REVIEW_DISTANCE, applied, conflicts: mutations.filter((row) => row.conflict).length, uniqueConflicts: mutations.filter((row) => row.uniqueConflict).length }, null, 2));
  console.log("report=" + outFile);
  if (decision.mode === "audit" || !decision.mutate || applied === 0) console.log("PRODUCTION REPAIR NOT APPLIED");
  else console.log("PRODUCTION REPAIR APPLIED " + applied);
  const failed = counts.EXACT_DUPLICATE + counts.EXACT_VISUAL_DUPLICATE + counts.NEAR_VISUAL_DUPLICATE + counts.KNOWN_SAMPLE + counts.BROKEN_URL + counts.WRONG_OWNERSHIP + counts.NEEDS_REVIEW + counts.CONFLICT;
  if (decision.mode === "audit") process.exit(failed ? 3 : 0);
  if (mutations.some((row) => row.uniqueConflict || (row.error && !row.conflict && !row.ok))) process.exit(4);
  process.exit(0);
}

module.exports = {
  SAMPLE_SHA,
  SAMPLE_DHASH,
  KNOWN_SAMPLE_SHA,
  KNOWN_SAMPLE_DHASH,
  COVER_DHASH_REVIEW_DISTANCE,
  classifyRecords,
  summarize,
  dhashFromGray,
  dhashDistance,
  possibleSeriesTitles,
  visualPairs,
  distanceHistogram,
  evaluateHistoricalReplacement,
  applyHistoricalReplacements,
  buildSafeRepairChanges,
  buildBackfillChanges,
  mutationMode,
  patchBookCover,
  applyChanges,
  sha256,
  isSampleName,
  wrongOwnership,
  storageOwnerId,
  suspiciousUrl,
  mutationAllowed,
  verifyKnownSamples
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}
