#!/usr/bin/env node
"use strict";

const fs = require("fs");
const images = require("../kutadgu-image-storage.js");
const r2 = require("./r2-s3-client.js");

const COPY_CONFIRM = "COPY_COVERS_NOW";

function guessType(key) {
  const lower = String(key || "").toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function galleryList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function imageEntries(row) {
  const out = [];
  if (row && row.image_url) out.push(row.image_url);
  galleryList(row && row.gallery_images).forEach((item) => {
    if (typeof item === "string") out.push(item);
    else if (item && item.url) out.push(item.url);
  });
  return out;
}

function inventoryCounts(rows, source) {
  const counts = { rows: 0, images: 0, supabase: 0, r2: 0, https: 0, site: 0, other: 0, empty: 0, unsafe: 0 };
  (rows || []).forEach((row) => {
    counts.rows += 1;
    const urls = imageEntries(row);
    if (!urls.length) counts.empty += 1;
    urls.forEach((url) => {
      counts.images += 1;
      const kind = images.classifyImageUrl(url, source).kind;
      if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += 1;
      else counts.other += 1;
    });
  });
  return counts;
}

function planCopies(rows) {
  const plans = [];
  (rows || []).forEach((row) => {
    imageEntries(row).forEach((url) => {
      const key = images.supabaseObjectKey(url);
      if (!key) {
        plans.push({ id: row && row.id, action: "skip", reason: "not-supabase-public-object", sourceUrl: String(url || "") });
        return;
      }
      plans.push({
        id: row && row.id,
        action: "copy",
        sourceUrl: images.displayImageUrl(url),
        key,
        contentType: guessType(key)
      });
    });
  });
  return plans;
}

function redact(text, env) {
  let out = String(text == null ? "" : text);
  ["R2_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID", "OPENAI_API_KEY"].forEach((name) => {
    const value = String((env && env[name]) || "");
    if (value) out = out.split(value).join("[redacted]");
  });
  return out;
}

function readRows(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("inventory-file-must-be-an-array");
  return parsed;
}

function publicInventoryUrl() {
  return images.SUPABASE_ORIGIN + "/rest/v1/books?select=id,image_url,gallery_images&is_active=eq.true&order=id.asc";
}

async function fetchLiveRows(fetchImpl) {
  const rows = [];
  for (let page = 0; page < 20; page += 1) {
    const start = page * 1000;
    const response = await fetchImpl(publicInventoryUrl(), {
      method: "GET",
      headers: {
        apikey: images.SUPABASE_PUBLISHABLE_KEY,
        Authorization: "Bearer " + images.SUPABASE_PUBLISHABLE_KEY,
        Accept: "application/json",
        Range: start + "-" + (start + 999)
      }
    });
    if (!response || (response.status !== 200 && response.status !== 206)) {
      throw new Error("inventory-read-failed");
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("inventory-read-failed");
    batch.forEach((row) => rows.push(row));
    if (batch.length < 1000) break;
  }
  return rows;
}

function credentials(env) {
  return {
    accountId: String((env && env.R2_ACCOUNT_ID) || "").trim(),
    accessKeyId: String((env && env.R2_ACCESS_KEY_ID) || "").trim(),
    secretAccessKey: String((env && env.R2_SECRET_ACCESS_KEY) || "").trim(),
    bucket: String((env && env.R2_BUCKET) || "").trim()
  };
}

function credentialsReady(value) {
  return !!(value.accountId && value.accessKeyId && value.secretAccessKey && value.bucket);
}

async function executeCopies(plans, env, deps) {
  const lines = [];
  const creds = credentials(env);
  const overwrite = String((env && env.KUTADGU_R2_OVERWRITE) || "") === "true";
  const client = (deps && deps.client) || r2.createR2Client(Object.assign({ fetchImpl: deps.fetchImpl }, creds));
  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i];
    if (plan.action !== "copy") {
      lines.push("skip id=" + plan.id + " reason=" + plan.reason);
      continue;
    }
    const head = await client.head(plan.key);
    const exists = head && (head.status === 200 || head.ok === true);
    if (exists && !overwrite) {
      lines.push("keep id=" + plan.id + " key=" + plan.key);
      continue;
    }
    const source = await deps.fetchImpl(plan.sourceUrl, { method: "GET" });
    if (!source || !source.ok) {
      lines.push("fail id=" + plan.id + " key=" + plan.key + " reason=source-http");
      continue;
    }
    const body = Buffer.from(await source.arrayBuffer());
    const put = await client.put(plan.key, body, plan.contentType);
    if (!put || !(put.ok || put.status === 200)) {
      lines.push("fail id=" + plan.id + " key=" + plan.key + " reason=put-http");
      continue;
    }
    lines.push((exists ? "replace" : "put") + " id=" + plan.id + " key=" + plan.key);
  }
  return lines;
}

async function run(argv, env, deps) {
  const args = argv || [];
  const copy = args.indexOf("--copy") !== -1 && args.indexOf("--dry-run") === -1;
  const live = args.indexOf("--live") !== -1;
  const fileFlag = args.indexOf("--file");
  const file = fileFlag >= 0 ? args[fileFlag + 1] : String((env && env.KUTADGU_COVER_INVENTORY_FILE) || "");
  const io = (deps && deps.io) || console;
  const lines = [];
  function log(line) {
    const safe = redact(line, env);
    lines.push(safe);
    io.log(safe);
  }
  let rows = null;
  if (file) {
    try {
      rows = readRows(file);
    } catch (err) {
      log("inventory file unreadable");
      return { exitCode: 2, lines, counts: inventoryCounts([]), plans: [] };
    }
  } else if (live) {
    try {
      rows = await fetchLiveRows((deps && deps.fetchImpl) || globalThis.fetch);
      log("inventory source=public-catalog-read");
    } catch (err) {
      log("inventory read failed");
      return { exitCode: 2, lines, counts: inventoryCounts([]), plans: [] };
    }
  } else {
    log("dry-run: no local inventory file; live catalog read not requested");
    return { exitCode: copy ? 2 : 0, lines, counts: inventoryCounts([]), plans: [] };
  }
  const config = { r2PublicBase: (env && env.KUTADGU_R2_PUBLIC_BASE_URL) || "" };
  const counts = inventoryCounts(rows, config);
  const plans = planCopies(rows);
  log("inventory rows=" + counts.rows
    + " images=" + counts.images
    + " supabase=" + counts.supabase
    + " r2=" + counts.r2
    + " other-https=" + counts.https
    + " empty=" + counts.empty
    + " unsafe=" + counts.unsafe);
  plans.forEach((plan) => {
    if (plan.action === "copy") log("plan copy id=" + plan.id + " key=" + plan.key);
    else log("plan skip id=" + plan.id + " reason=" + plan.reason);
  });
  if (!copy) {
    log("dry-run: no R2 writes and no deletions");
    return { exitCode: 0, lines, counts, plans };
  }
  if (String((env && env.KUTADGU_R2_COPY_CONFIRM) || "") !== COPY_CONFIRM) {
    log("refusing copy; confirmation is not set");
    return { exitCode: 2, lines, counts, plans };
  }
  if (!credentialsReady(credentials(env))) {
    log("refusing copy; R2 credentials are incomplete");
    return { exitCode: 2, lines, counts, plans };
  }
  const written = await executeCopies(plans, env, deps || {});
  written.forEach(log);
  return { exitCode: 0, lines, counts, plans };
}

if (require.main === module) {
  run(process.argv.slice(2), process.env, { fetchImpl: globalThis.fetch.bind(globalThis), io: console })
    .then((result) => process.exit(result.exitCode));
}

module.exports = {
  COPY_CONFIRM,
  publicInventoryUrl,
  inventoryCounts,
  planCopies,
  redact,
  run
};
