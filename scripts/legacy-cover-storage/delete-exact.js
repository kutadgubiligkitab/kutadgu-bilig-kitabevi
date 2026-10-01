#!/usr/bin/env node
"use strict";

/**
 * Delete only exact paths listed in deletion-manifest.json.
 *
 * Storage API, one object per request:
 *   DELETE /storage/v1/object/book-covers/<exact-path>
 *
 * Refuses SQL, wildcard, prefix, bucket deletion, Class C, and Class E.
 * Dry-run unless --apply is present. The service-role key is read from
 * SUPABASE_SERVICE_ROLE_KEY and is never printed or written.
 */

const fs = require("fs");
const path = require("path");

const root = __dirname;
const deletion = JSON.parse(fs.readFileSync(path.join(root, "deletion-manifest.json"), "utf8"));
const protectedSnapshot = JSON.parse(fs.readFileSync(path.join(root, "protected-snapshot.json"), "utf8"));
const approved = new Map(deletion.objects.map((row) => [row.objectPath, row]));
const protectedPaths = new Set(protectedSnapshot.objects.map((row) => row.objectPath));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return "";
  return process.argv[index + 1] || "";
}

function rejectUnsafe(objectPath) {
  if (!objectPath || typeof objectPath !== "string") return "missing-path";
  if (objectPath !== objectPath.trim()) return "unstripped-path";
  if (objectPath.startsWith("/") || objectPath.endsWith("/")) return "folder-path";
  if (objectPath.split("/").some((part) => !part || part === "." || part === "..")) return "dot-segment";
  if (/[*?{}\[\]]/.test(objectPath)) return "wildcard";
  if (protectedPaths.has(objectPath) || objectPath.startsWith("staff/")) return "protected";
  if (!approved.has(objectPath)) return "not-in-deletion-manifest";
  for (const kept of protectedPaths) {
    if (kept.startsWith(objectPath + "/") || objectPath.startsWith(kept + "/")) return "prefix-collision";
  }
  return "";
}

function encodeObjectPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

async function deleteOne(objectPath) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply");
  const endpoint = base.replace(/\/$/, "") + "/storage/v1/object/book-covers/" + encodeObjectPath(objectPath);
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      authorization: "Bearer " + key,
      apikey: key
    }
  });
  return response.status;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = Number(argValue("--limit") || "0");
  const only = argValue("--path");
  let paths = only ? [only] : deletion.objects.map((row) => row.objectPath);
  const classFilter = argValue("--class");
  if (classFilter) {
    paths = paths.filter((objectPath) => approved.get(objectPath) && approved.get(objectPath).class === classFilter);
  }
  if (limit > 0) paths = paths.slice(0, limit);
  const problems = paths.map((objectPath) => ({ objectPath, reason: rejectUnsafe(objectPath) })).filter((item) => item.reason);
  if (problems.length) {
    console.error(JSON.stringify({ refused: problems.slice(0, 20), refusedCount: problems.length }));
    process.exit(1);
  }
  if (!paths.length) {
    console.error("no paths selected");
    process.exit(2);
  }
  for (const objectPath of paths) {
    const row = approved.get(objectPath);
    let status = 0;
    if (apply) status = await deleteOne(objectPath);
    if (apply && status !== 200) {
      console.error(JSON.stringify({ stopped: true, objectPath, status }));
      process.exit(1);
    }
    console.log(JSON.stringify({
      action: apply ? "deleted" : "dry-run",
      class: row.class,
      objectPath,
      bytes: row.bytes,
      sha256: row.sha256,
      status
    }));
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
