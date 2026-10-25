"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const variants = require("../kutadgu-cover-variants.js");

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function postRpc(fetchImpl, name, body) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 15000) : 0;
  try {
    const response = await fetchImpl(SUPABASE_URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
    const payload = await response.json();
    if (!response.ok || payload == null) throw new Error(name + " failed (" + response.status + ")");
    return payload;
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error(name + " stalled");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rememberSource(sources, seen, url, id) {
  const raw = String(url || "").trim();
  const key = variants.objectKeyFromCoverUrl(raw);
  if (!key) {
    sources.skipped.push({ id: String(id || ""), reason: "not-a-private-cover" });
    return;
  }
  if (seen.has(key)) return;
  seen.add(key);
  sources.list.push({ url: raw, key, id: String(id || "") });
}

async function collectPublicCoverSources(fetchImpl) {
  const fetchPage = fetchImpl || fetch;
  const units = [];
  const seenUnits = new Set();
  let total = null;
  let offset = 0;
  while (offset <= 1000000) {
    const payload = await postRpc(fetchPage, "query_public_book_catalog", { p_query: { offset, limit: 100, sort: "title" } });
    if (!Array.isArray(payload.items)) throw new Error("catalogue incomplete");
    if (total == null) total = Number(payload.total);
    if (!Number.isFinite(total)) throw new Error("catalogue incomplete");
    if (payload.items.length === 0 && units.length < total) throw new Error("catalogue stalled");
    payload.items.forEach((row) => {
      const id = String(row && (row.unit_id || row.id) || "");
      if (!id || seenUnits.has(id)) return;
      seenUnits.add(id);
      units.push(row);
    });
    if (units.length >= total) break;
    if (payload.items.length < 100) throw new Error("catalogue stalled");
    offset += payload.items.length;
  }
  if (units.length !== total) throw new Error("catalogue incomplete");
  const again = await postRpc(fetchPage, "query_public_book_catalog", { p_query: { offset: 0, limit: 1, sort: "title" } });
  if (Number(again.total) !== total) throw new Error("catalogue changed");
  const entries = [];
  let sitemapOffset = 0;
  while (entries.length < total && sitemapOffset <= 1000000) {
    const sitemap = await postRpc(fetchPage, "list_public_book_volume_sitemap_entries", { p_offset: sitemapOffset, p_limit: 1000 });
    if (Number(sitemap.total) !== total) throw new Error("catalogue changed");
    const page = Array.isArray(sitemap.items) ? sitemap.items : null;
    if (!page || (page.length === 0 && entries.length < total)) throw new Error("catalogue stalled");
    entries.push(...page);
    if (page.length < 1000) break;
    sitemapOffset += page.length;
  }
  if (entries.length !== total) throw new Error("catalogue incomplete");
  const groups = entries.filter((entry) => entry && entry.kind === "group" && Number(entry.group_id) > 0);
  const sources = { list: [], skipped: [] };
  const seen = new Set();
  units.forEach((row) => rememberSource(sources, seen, row.image_url || row.image || row.representative_image_url, row.unit_id || row.id));
  for (const group of groups) {
    const detail = await postRpc(fetchPage, "get_public_book_volume_group_storefront", {
      p_group_id: Number(group.group_id),
      p_slug: null,
      p_child_book_id: null
    });
    const members = detail && Array.isArray(detail.members) ? detail.members : null;
    if (!members || members.length < 2) throw new Error("catalogue incomplete");
    members.forEach((member) => rememberSource(sources, seen, member && member.image_url, "book:" + (member && member.book_id)));
  }
  return {
    catalogueUnits: total,
    groupCount: groups.length,
    sources: sources.list,
    skipped: sources.skipped
  };
}

async function main() {
  if (process.argv.includes("--upload")) throw new Error("This command writes local files only. It does not upload to R2.");
  const catalog = await collectPublicCoverSources(fetch);
  const sources = catalog.sources;
  const skipped = catalog.skipped.slice();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const outDir = path.join(__dirname, "..", "artifacts", "cover-variants", "local");
  const comparisonDir = path.join(__dirname, "..", "artifacts", "cover-variants", "comparisons");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(comparisonDir, { recursive: true });
  const files = [];
  const comparisons = [];
  for (const source of sources) {
    let response;
    try {
      response = await page.request.get(source.url);
    } catch (error) {
      files.push({ sourceKey: source.key, sourceUrl: source.url, id: source.id, skip: "unreadable" });
      continue;
    }
    if (!response.ok()) {
      files.push({ sourceKey: source.key, sourceUrl: source.url, id: source.id, skip: "unreadable", status: response.status() });
      continue;
    }
    const body = Buffer.from(await response.body());
      if (variants.isAnimatedImage(body, response.headers()["content-type"] || "")) {
      files.push({ sourceKey: source.key, sourceUrl: source.url, id: source.id, originalBytes: body.length, sourceSha256: sha256(body), skip: "animated-or-unsupported" });
      continue;
    }
    let encoded;
    try {
      encoded = await page.evaluate(async ({ encodedSource, quality }) => {
      function asBase64(bytes) {
        let binary = "";
        for (let index = 0; index < bytes.length; index += 32768) {
          binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 32768));
        }
        return btoa(binary);
      }
      const raw = Uint8Array.from(atob(encodedSource), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw]));
      const width = bitmap.width;
      const height = bitmap.height;
      const made = [];
      let variant480 = null;
      for (const target of [480, 960]) {
        if (target >= width) continue;
        const canvas = document.createElement("canvas");
        canvas.width = target;
        canvas.height = Math.max(1, Math.round(height * (target / width)));
        const ctx = canvas.getContext("2d", { alpha: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const encodedBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (!encodedBlob) continue;
        const bytes = new Uint8Array(await encodedBlob.arrayBuffer());
        made.push({ width: target, height: canvas.height, bytes: bytes.length, base64: asBase64(bytes) });
        if (target === 480) variant480 = await createImageBitmap(encodedBlob);
      }
      const preview = document.createElement("canvas");
      preview.width = 480;
      preview.height = 90;
      const previewCtx = preview.getContext("2d");
      const cropHeight = Math.min(height, Math.round(width / 4));
      previewCtx.drawImage(bitmap, 0, 0, width, cropHeight, 0, 0, 240, 90);
      if (variant480) previewCtx.drawImage(variant480, 0, 0, variant480.width, Math.min(variant480.height, Math.round(variant480.width / 4)), 240, 0, 240, 90);
      const previewBlob = await new Promise((resolve) => preview.toBlob(resolve, "image/png"));
      bitmap.close();
      if (variant480) variant480.close();
      const previewBytes = previewBlob ? new Uint8Array(await previewBlob.arrayBuffer()) : new Uint8Array();
      return { width, height, made, preview: previewBytes.length ? asBase64(previewBytes) : "" };
    }, { encodedSource: body.toString("base64"), quality: variants.WEBP_QUALITY });
    } catch (error) {
      files.push({ sourceKey: source.key, sourceUrl: source.url, id: source.id, originalBytes: body.length, sourceSha256: sha256(body), skip: "decode-failed" });
      continue;
    }
    const variantsMade = [];
    encoded.made.forEach((item) => {
      const key = variants.variantObjectKey(source.key, item.width);
      const file = key.replace(/\//g, "__");
      fs.writeFileSync(path.join(outDir, file), Buffer.from(item.base64, "base64"));
      const bytes = Buffer.from(item.base64, "base64");
      variantsMade.push({ width: item.width, height: item.height, bytes: bytes.length, sha256: sha256(bytes), key, file: "artifacts/cover-variants/local/" + file });
    });
    files.push({
      id: source.id,
      sourceKey: source.key,
      sourceUrl: source.url,
      width: encoded.width,
      height: encoded.height,
      originalBytes: body.length,
      sourceSha256: sha256(body),
      skip: variantsMade.length ? "" : (encoded.width <= 480 ? "not-larger-than-variant" : "unsupported"),
      variants: variantsMade
    });
    if (comparisons.length < 3 && encoded.preview && encoded.width >= 700 && variantsMade.length) {
      const name = "comparison-" + (comparisons.length + 1) + ".png";
      fs.writeFileSync(path.join(comparisonDir, name), Buffer.from(encoded.preview, "base64"));
      comparisons.push({ id: source.id, sourceKey: source.key, width: encoded.width, height: encoded.height, originalBytes: body.length, variant480Bytes: (variantsMade.find((item) => item.width === 480) || {}).bytes || 0, file: "artifacts/cover-variants/comparisons/" + name });
    }
  }
  await browser.close();
  const manifest = {
    dryRun: true,
    uploaded: false,
    generatedAt: new Date().toISOString(),
    catalogueUnits: catalog.catalogueUnits,
    groupCount: catalog.groupCount,
    readUnits: sources.length + skipped.length,
    privateCovers: sources.length,
    derivedFiles: files.reduce((sum, item) => sum + (item.variants ? item.variants.length : 0), 0),
    skipped,
    comparisons,
    files
  };
  const target = path.join(__dirname, "..", "artifacts", "cover-variants", "generated-manifest.json");
  const recorded = new Set(files.map((item) => item.sourceKey));
  const missing = sources.filter((item) => !recorded.has(item.key));
  if (missing.length) throw new Error("catalogue incomplete: " + missing.length + " eligible covers were not recorded");
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ catalogueUnits: manifest.catalogueUnits, groupCount: manifest.groupCount, privateCovers: manifest.privateCovers, derivedFiles: manifest.derivedFiles, comparisons: manifest.comparisons.length }, null, 2));
}

module.exports = { collectPublicCoverSources };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
