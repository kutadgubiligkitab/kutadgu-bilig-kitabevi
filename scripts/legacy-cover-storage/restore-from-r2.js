#!/usr/bin/env node
"use strict";

/**
 * Restore selected book-cover objects from the private R2 copy back into
 * Supabase Storage. Reads scripts/legacy-cover-storage/restore-manifest.json.
 *
 * Dry-run unless --apply is present. Does not delete anything.
 * Credentials come from the environment and are never printed:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Bytes are downloaded from the canonical Cloudflare URL, which reads the
 * private R2 object. The upload uses the Storage HTTP API:
 *   POST /storage/v1/object/book-covers/<exact-path>
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "restore-manifest.json"), "utf8"));
const byPath = new Map(manifest.objects.map((row) => [row.objectPath, row]));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return "";
  return process.argv[index + 1] || "";
}

function requestedPaths() {
  const single = argValue("--path");
  const list = argValue("--paths");
  const paths = [];
  if (single) paths.push(single);
  if (list) paths.push(...list.split(",").map((item) => item.trim()).filter(Boolean));
  return paths;
}

function rejectUnsafe(objectPath) {
  if (!objectPath || typeof objectPath !== "string") return "missing-path";
  if (objectPath !== objectPath.trim()) return "unstripped-path";
  if (objectPath.startsWith("/") || objectPath.endsWith("/")) return "folder-path";
  if (objectPath.split("/").some((part) => !part || part === "." || part === "..")) return "dot-segment";
  if (/[*?{}\[\]]/.test(objectPath)) return "wildcard";
  if (objectPath.startsWith("staff/")) return "protected-staff-prefix";
  if (!byPath.has(objectPath)) return "not-in-restore-manifest";
  return "";
}

function encodeObjectPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

async function readCanonical(url) {
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error("canonical HTTP " + response.status);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return { bytes, sha256 };
}

async function uploadObject(row, bytes) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply");
  const endpoint = base.replace(/\/$/, "") + "/storage/v1/object/book-covers/" + encodeObjectPath(row.objectPath);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + key,
      apikey: key,
      "content-type": row.contentType,
      "cache-control": "public, max-age=31536000",
      "x-upsert": "true"
    },
    body: bytes
  });
  if (response.status !== 200 && response.status !== 201) {
    const detail = await response.text();
    throw new Error("storage upload HTTP " + response.status + " " + detail.slice(0, 180));
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const paths = requestedPaths();
  if (!paths.length) {
    console.error("Pass --path <exact/object/path> or --paths path1,path2");
    process.exit(2);
  }
  const problems = paths.map((objectPath) => ({ objectPath, reason: rejectUnsafe(objectPath) })).filter((item) => item.reason);
  if (problems.length) {
    console.error(JSON.stringify({ refused: problems }));
    process.exit(1);
  }
  for (const objectPath of paths) {
    const row = byPath.get(objectPath);
    const downloaded = await readCanonical(row.canonicalUrl);
    if (downloaded.bytes.length !== row.bytes || downloaded.sha256 !== row.sha256) {
      throw new Error("R2 bytes no longer match the restore manifest for " + objectPath);
    }
    if (apply) await uploadObject(row, downloaded.bytes);
    console.log(JSON.stringify({
      action: apply ? "restored" : "dry-run",
      class: row.class,
      objectPath,
      bytes: row.bytes,
      sha256: row.sha256,
      contentType: row.contentType
    }));
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
