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

function classifyRecords(records) {
  const ids = new Set(records.map((row) => String(row.id)));
  const bySha = new Map();
  const byVisual = new Map();
  records.forEach((row) => {
    if (row.sha256) {
      if (!bySha.has(row.sha256)) bySha.set(row.sha256, []);
      bySha.get(row.sha256).push(row.id);
    }
    if (row.dhash) {
      if (!byVisual.has(row.dhash)) byVisual.set(row.dhash, []);
      byVisual.get(row.dhash).push(row.id);
    }
  });
  return records.map((row) => {
    const url = String(row.image_url || "").trim();
    const owner = storageOwnerId(url);
    const suspicion = suspiciousUrl(url);
    const exactIds = row.sha256 ? (bySha.get(row.sha256) || []) : [];
    const visualIds = row.dhash ? (byVisual.get(row.dhash) || []) : [];
    const exact = exactIds.length > 1;
    const visual = !exact && visualIds.length > 1;
    const known = !!(row.sha256 && KNOWN_SAMPLE_SHA.has(row.sha256)) || !!(row.dhash && KNOWN_SAMPLE_DHASH.has(row.dhash));
    const broken = !!url && !!row.broken;
    const noCover = !url;
    const wrong = !!url && wrongOwnership(row, owner, ids);
    const needs = !noCover && !broken && !known && !wrong && !exact && !visual && (!!suspicion || !!row.rateLimited);
    let state = "HEALTHY_UNIQUE";
    if (row.conflict) state = "CONFLICT";
    else if (noCover) state = "NO_COVER";
    else if (broken) state = "BROKEN_URL";
    else if (known) state = "KNOWN_SAMPLE";
    else if (wrong) state = "WRONG_OWNERSHIP";
    else if (exact) state = "EXACT_DUPLICATE";
    else if (visual) state = "VISUAL_DUPLICATE";
    else if (needs) state = "NEEDS_REVIEW";
    else if (row.safeRepair) state = "SAFE_REPAIR";
    return {
      id: row.id,
      title: row.title || "",
      image_url: url,
      sha256: row.sha256 || "",
      dhash: row.dhash || "",
      state,
      owner,
      suspicion,
      exactIds: exactIds.length > 1 ? exactIds : [],
      visualIds: visualIds.length > 1 ? visualIds : [],
      evidence: row.evidence || suspicion || ""
    };
  });
}

function summarize(rows) {
  const counts = {
    TOTAL_BOOKS: rows.length,
    HEALTHY_UNIQUE: 0,
    EXACT_DUPLICATE: 0,
    VISUAL_DUPLICATE: 0,
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

async function main() {
  const mode = process.argv.includes("--apply-safe") ? "apply-safe" : process.argv.includes("--backfill") ? "backfill" : "audit";
  verifyKnownSamples();
  if (mode !== "audit" && !mutationAllowed()) {
    console.error("REFUSING MUTATION: set KUTADGU_COVER_REPAIR_APPLY=1 to apply safe repairs or backfill. No rows were changed.");
    process.exit(1);
  }
  const cfg = publicConfig();
  if (!cfg.url || !cfg.key) throw new Error("Supabase URL or key is unavailable");
  if (mode !== "audit" && !cfg.service) {
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
  const classified = classifyRecords(inspected);
  const counts = summarize(classified);
  const report = {
    auditedAt: new Date().toISOString(),
    mode,
    serviceRole: cfg.service,
    productionRepairApplied: false,
    storageHistory: "not-listed: service role required",
    counts,
    problems: classified.filter((row) => row.state !== "HEALTHY_UNIQUE" && row.state !== "NO_COVER")
  };
  const outDir = path.join(os.tmpdir(), "kutadgu-cover-audit");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(counts, null, 2));
  console.log("report=" + outFile);
  console.log("PRODUCTION REPAIR NOT APPLIED");
  const failed = counts.EXACT_DUPLICATE + counts.VISUAL_DUPLICATE + counts.KNOWN_SAMPLE + counts.BROKEN_URL + counts.WRONG_OWNERSHIP + counts.NEEDS_REVIEW + counts.CONFLICT;
  process.exit(failed ? 3 : 0);
}

module.exports = {
  SAMPLE_SHA,
  SAMPLE_DHASH,
  KNOWN_SAMPLE_SHA,
  KNOWN_SAMPLE_DHASH,
  classifyRecords,
  summarize,
  dhashFromGray,
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
