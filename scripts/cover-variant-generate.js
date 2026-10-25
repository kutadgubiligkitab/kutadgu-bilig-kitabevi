"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const variants = require("../kutadgu-cover-variants.js");

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";

async function fetchCatalog() {
  const units = [];
  const seen = new Set();
  let total = null;
  let offset = 0;
  while (offset <= 1000000) {
    const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/query_public_book_catalog", {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ p_query: { offset, limit: 100, sort: "title" } })
    });
    const payload = await response.json();
    if (!response.ok || !payload || !Array.isArray(payload.items)) {
      throw new Error("Catalogue read failed (" + response.status + ")");
    }
    if (total == null) total = Number(payload.total);
    payload.items.forEach((row) => {
      const id = String(row && (row.unit_id || row.id) || "");
      if (!id || seen.has(id)) return;
      seen.add(id);
      units.push(row);
    });
    if (payload.items.length < 100 || units.length >= total) break;
    offset += payload.items.length;
  }
  return { units, total };
}

function sourceOf(row) {
  const url = String(row.image_url || row.image || row.representative_image_url || "").trim();
  const key = variants.objectKeyFromCoverUrl(url);
  return key ? { url, key, id: String(row.unit_id || row.id || "") } : null;
}

async function main() {
  if (process.argv.includes("--upload")) throw new Error("This command writes local files only. It does not upload to R2.");
  const catalog = await fetchCatalog();
  const sources = [];
  const skipped = [];
  catalog.units.forEach((row) => {
    const source = sourceOf(row);
    if (!source) {
      skipped.push({ id: String(row.unit_id || row.id || ""), reason: "not-a-private-cover" });
      return;
    }
    sources.push(source);
  });
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
      files.push({ sourceKey: source.key, sourceUrl: source.url, id: source.id, originalBytes: body.length, skip: "animated-or-unsupported" });
      continue;
    }
    const encoded = await page.evaluate(async ({ encodedSource, quality }) => {
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
    const variantsMade = [];
    encoded.made.forEach((item) => {
      const key = variants.variantObjectKey(source.key, item.width);
      const file = key.replace(/\//g, "__");
      fs.writeFileSync(path.join(outDir, file), Buffer.from(item.base64, "base64"));
      variantsMade.push({ width: item.width, height: item.height, bytes: item.bytes, key, file: "artifacts/cover-variants/local/" + file });
    });
    files.push({
      id: source.id,
      sourceKey: source.key,
      sourceUrl: source.url,
      width: encoded.width,
      height: encoded.height,
      originalBytes: body.length,
      skip: variantsMade.length ? "" : (encoded.width <= 480 ? "not-larger-than-variant" : ""),
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
    catalogueUnits: catalog.total,
    readUnits: catalog.units.length,
    privateCovers: sources.length,
    derivedFiles: files.reduce((sum, item) => sum + (item.variants ? item.variants.length : 0), 0),
    skipped,
    comparisons,
    files
  };
  const target = path.join(__dirname, "..", "artifacts", "cover-variants", "generated-manifest.json");
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ catalogueUnits: manifest.catalogueUnits, privateCovers: manifest.privateCovers, derivedFiles: manifest.derivedFiles, comparisons: manifest.comparisons.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
