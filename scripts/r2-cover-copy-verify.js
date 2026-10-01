#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const inventory = require("./r2-cover-inventory.js");

const BUCKET = "kutadgu-covers-preview";
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const CONCURRENCY = 4;
const MAX_OBJECTS = 4000;
const MAX_BYTES = 1024 * 1024 * 1024;
const repoRoot = path.resolve(__dirname, "..");
const manifestDir = path.join(repoRoot, ".tmp", "r2-cover-migration");
const manifestPath = path.join(manifestDir, "manifest.json");
const wranglerBin = path.join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function imageMagic(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.length >= 6) {
    const head = buf.slice(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  return "";
}

function readPreviewConfig() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8"));
}

function assertPreviewConfig() {
  const config = readPreviewConfig();
  if (config.name !== "kutadgu-cloudflare-preview") throw new Error("preview-worker-name");
  if (config.routes || config.route || config.zone_id) throw new Error("preview-has-routes");
  if (!config.vars || config.vars.KUTADGU_R2_UPLOAD_ENABLED !== "false") throw new Error("r2-upload-enabled");
  if (!config.vars || config.vars.KUTADGU_R2_PUBLIC_BASE_URL !== "") throw new Error("r2-public-base-set");
  const binding = config.r2_buckets && config.r2_buckets[0];
  if (!binding || binding.binding !== "COVERS" || binding.bucket_name !== BUCKET) throw new Error("r2-binding");
  return config;
}

function buildRecords(rows) {
  const byKey = new Map();
  const skipped = [];
  let references = 0;
  (rows || []).forEach((row) => {
    inventory.planCopies([row]).forEach((plan) => {
      references += 1;
      if (plan.action !== "copy") {
        skipped.push({
          bookIds: [row && row.id],
          sourceUrl: String(plan.sourceUrl || ""),
          key: "",
          contentType: "",
          sourceBytes: 0,
          sourceSha256: "",
          status: "SKIPPED_NON_SUPABASE",
          reason: plan.reason || "not-supabase-public-object"
        });
        return;
      }
      const found = byKey.get(plan.key);
      if (found) {
        if (found.bookIds.indexOf(row && row.id) === -1) found.bookIds.push(row && row.id);
        found.duplicateRefs += 1;
        return;
      }
      byKey.set(plan.key, {
        bookIds: [row && row.id],
        sourceUrl: plan.sourceUrl,
        key: plan.key,
        contentType: plan.contentType,
        sourceBytes: 0,
        sourceSha256: "",
        destBytes: 0,
        destSha256: "",
        destContentType: "",
        status: "planned",
        reason: "",
        duplicateRefs: 0
      });
    });
  });
  return { planned: Array.from(byKey.values()), skipped: skipped, references: references };
}

function decideExisting(sourceSha, sourceBytes, destSha, destBytes) {
  if (destSha === sourceSha && destBytes === sourceBytes) return "VERIFIED_EXISTING";
  return "CONFLICT";
}

function interpretGet(code, text) {
  if (/not authenticated|Authentication error/i.test(text)) return "auth";
  if (code === 0) return "present";
  if (/does not exist/i.test(text)) return "absent";
  return "error";
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const jobs = [];
  for (let i = 0; i < width; i += 1) jobs.push(worker());
  await Promise.all(jobs);
  return out;
}

async function readSource(url) {
  let response;
  try {
    response = await fetch(url, { redirect: "manual" });
  } catch (err) {
    return { ok: false, reason: "fetch-error", status: 0 };
  }
  if (response.status !== 200) {
    return { ok: false, reason: "http-" + response.status, status: response.status };
  }
  const buf = Buffer.from(await response.arrayBuffer());
  const magic = imageMagic(buf);
  if (!magic || !buf.length) {
    return { ok: false, reason: "invalid-image", status: 200, bytes: buf.length };
  }
  const headerType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return {
    ok: true,
    bytes: buf.length,
    sha256: sha256(buf),
    contentType: headerType.indexOf("image/") === 0 ? headerType : magic,
    buf: buf
  };
}

function writeManifest(doc) {
  fs.mkdirSync(manifestDir, { recursive: true });
  const tmp = manifestPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, manifestPath);
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function runWrangler(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [wranglerBin].concat(args), {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      err += "\ntimeout";
    }, 90000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, text: out + "\n" + err });
    });
  });
}

async function assertRemoteBucket() {
  const info = await runWrangler(["r2", "bucket", "info", BUCKET]);
  if (info.code !== 0 || info.text.indexOf("name:") === -1 || info.text.indexOf(BUCKET) === -1) {
    throw new Error("bucket-info-failed");
  }
  if (/kutadgu-covers(?!-preview)/.test(info.text)) throw new Error("unexpected-bucket");
  const access = await runWrangler(["r2", "bucket", "dev-url", "get", BUCKET]);
  if (access.code !== 0 || !/disabled/i.test(access.text)) throw new Error("r2-public-access-not-disabled");
}

function objectArgs(command, key, extra) {
  const args = ["r2", "object", command, BUCKET + "/" + key, "--remote"].concat(extra || []);
  if (args.indexOf("delete") !== -1) throw new Error("delete-forbidden");
  if (args[3].indexOf(BUCKET + "/") !== 0) throw new Error("bucket-mismatch");
  return args;
}

async function downloadDestination(key) {
  const file = path.join(manifestDir, "work", crypto.randomBytes(8).toString("hex"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const result = await runWrangler(objectArgs("get", key, ["--file", file]));
  const state = interpretGet(result.code, result.text);
  if (state === "auth") throw new Error("wrangler-auth");
  if (state !== "present") {
    fs.rmSync(file, { force: true });
    return { state: state, text: result.text.slice(0, 240) };
  }
  const buf = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return { state: "present", bytes: buf.length, sha256: sha256(buf) };
}

async function uploadObject(key, buf, contentType) {
  const file = path.join(manifestDir, "work", crypto.randomBytes(8).toString("hex"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  const result = await runWrangler(objectArgs("put", key, [
    "--file", file,
    "--content-type", contentType,
    "--cache-control", CACHE_CONTROL
  ]));
  fs.rmSync(file, { force: true });
  if (/not authenticated|Authentication error/i.test(result.text)) throw new Error("wrangler-auth");
  return result.code === 0 && /Upload complete/i.test(result.text);
}

function summaryOf(doc) {
  const objects = doc.objects || [];
  const count = (status) => objects.filter((item) => item.status === status).length;
  const bytes = (status) => objects.filter((item) => item.status === status).reduce((sum, item) => sum + (item.destBytes || 0), 0);
  return {
    books: doc.books || 0,
    references: doc.references || 0,
    uniquePlanned: doc.uniquePlanned || 0,
    duplicates: doc.duplicates || 0,
    skipped: (doc.skipped || []).length,
    sourceFailed: count("SOURCE_FAILED"),
    verifiedCopied: count("VERIFIED_COPIED"),
    verifiedExisting: count("VERIFIED_EXISTING"),
    conflict: count("CONFLICT"),
    verifyFailed: count("VERIFY_FAILED"),
    sourceBytes: doc.totalSourceBytes || 0,
    verifiedBytes: bytes("VERIFIED_COPIED") + bytes("VERIFIED_EXISTING")
  };
}

async function inventoryFromRows(rows) {
  const built = buildRecords(rows);
  const readable = [];
  await mapPool(built.planned, CONCURRENCY, async (item) => {
    const source = await readSource(item.sourceUrl);
    if (!source.ok) {
      item.status = "SOURCE_FAILED";
      item.reason = source.reason;
      item.sourceBytes = source.bytes || 0;
      return;
    }
    item.sourceBytes = source.bytes;
    item.sourceSha256 = source.sha256;
    item.contentType = source.contentType;
    item.status = "planned";
    readable.push(item);
  });
  const totalSourceBytes = built.planned.reduce((sum, item) => sum + (item.sourceBytes || 0), 0);
  const duplicates = built.planned.reduce((sum, item) => sum + item.duplicateRefs, 0);
  const doc = {
    generatedAt: new Date().toISOString(),
    bucket: BUCKET,
    books: new Set(rows.map((row) => row && row.id)).size,
    references: built.references,
    uniquePlanned: built.planned.length,
    duplicates: duplicates,
    totalSourceBytes: totalSourceBytes,
    objects: built.planned,
    skipped: built.skipped
  };
  if (doc.uniquePlanned > MAX_OBJECTS || totalSourceBytes > MAX_BYTES) {
    doc.stopped = "inventory-volume";
    writeManifest(doc);
    throw new Error("inventory-volume");
  }
  writeManifest(doc);
  return doc;
}

async function copyPlanned(doc) {
  assertPreviewConfig();
  await assertRemoteBucket();
  let stopped = "";
  let finished = 0;
  await mapPool(doc.objects, CONCURRENCY, async (item) => {
    if (stopped) return;
    if (item.status !== "planned") return;
    const source = await readSource(item.sourceUrl);
    if (!source.ok || source.sha256 !== item.sourceSha256 || source.bytes !== item.sourceBytes) {
      item.status = "SOURCE_FAILED";
      item.reason = source.ok ? "source-changed" : source.reason;
      return;
    }
    let dest;
    try {
      dest = await downloadDestination(item.key);
    } catch (err) {
      stopped = err.message;
      return;
    }
    if (dest.state === "error") {
      item.status = "VERIFY_FAILED";
      item.reason = "destination-read";
      return;
    }
    if (dest.state === "present") {
      const decision = decideExisting(item.sourceSha256, item.sourceBytes, dest.sha256, dest.bytes);
      item.destBytes = dest.bytes;
      item.destSha256 = dest.sha256;
      item.status = decision;
      if (decision === "CONFLICT") item.reason = "existing-bytes-differ";
      return;
    }
    const uploaded = await uploadObject(item.key, source.buf, item.contentType);
    if (!uploaded) {
      item.status = "VERIFY_FAILED";
      item.reason = "put-failed";
      return;
    }
    const check = await downloadDestination(item.key);
    if (check.state !== "present" || check.sha256 !== item.sourceSha256 || check.bytes !== item.sourceBytes) {
      item.status = "VERIFY_FAILED";
      item.reason = "hash-mismatch";
      item.destBytes = check.bytes || 0;
      item.destSha256 = check.sha256 || "";
      return;
    }
    item.status = "VERIFIED_COPIED";
    item.destBytes = check.bytes;
    item.destSha256 = check.sha256;
    item.destContentType = item.contentType;
    finished += 1;
    if (finished % 25 === 0) console.log("progress=" + finished + " status=" + item.status);
  });
  if (stopped) throw new Error(stopped);
  doc.verifiedAt = new Date().toISOString();
  writeManifest(doc);
  return doc;
}

async function main(argv) {
  const copy = argv.indexOf("--copy") !== -1;
  assertPreviewConfig();
  if (!copy) {
    const live = await inventory.run(["--live"], {}, {
      fetchImpl: globalThis.fetch.bind(globalThis),
      io: { log() {} }
    });
    if (!live || live.exitCode !== 0) {
      console.error("catalog read failed");
      return 2;
    }
    const raw = await fetchCatalogRows();
    const doc = await inventoryFromRows(raw);
    const planned = doc.objects.filter((item) => item.status === "planned").length;
    const failed = doc.objects.filter((item) => item.status === "SOURCE_FAILED").length;
    console.log("books=" + doc.books
      + " references=" + doc.references
      + " unique=" + doc.uniquePlanned
      + " duplicates=" + doc.duplicates
      + " planned=" + planned
      + " source_failed=" + failed
      + " skipped=" + doc.skipped.length
      + " source_bytes=" + doc.totalSourceBytes);
    console.log("manifest=" + manifestPath);
    console.log("dry-run: no R2 writes");
    return 0;
  }
  const doc = readManifest();
  if (doc.bucket !== BUCKET) throw new Error("manifest-bucket");
  const done = await copyPlanned(doc);
  const stats = summaryOf(done);
  console.log(JSON.stringify(stats));
  if (stats.conflict || stats.verifyFailed) return 2;
  if (stats.verifiedCopied + stats.verifiedExisting !== stats.uniquePlanned - stats.sourceFailed) return 2;
  return 0;
}

async function fetchCatalogRows() {
  const images = require("../kutadgu-image-storage.js");
  const rows = [];
  for (let page = 0; page < 20; page += 1) {
    const start = page * 1000;
    const response = await fetch(inventory.publicInventoryUrl(), {
      method: "GET",
      headers: {
        apikey: images.SUPABASE_PUBLISHABLE_KEY,
        Authorization: "Bearer " + images.SUPABASE_PUBLISHABLE_KEY,
        Accept: "application/json",
        Range: start + "-" + (start + 999)
      }
    });
    if (!response || (response.status !== 200 && response.status !== 206)) throw new Error("catalog-read-failed");
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("catalog-read-failed");
    batch.forEach((row) => rows.push(row));
    if (batch.length < 1000) break;
  }
  return rows;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    console.error(err && err.message ? err.message : "copy-verify-failed");
    process.exit(2);
  });
}

module.exports = {
  BUCKET,
  CACHE_CONTROL,
  buildRecords,
  decideExisting,
  interpretGet,
  imageMagic,
  sha256,
  summaryOf,
  assertPreviewConfig,
  objectArgs
};
