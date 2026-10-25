"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

async function main() {
  const manifestPath = path.join(__dirname, "..", "artifacts", "cover-variants", "generated-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const candidates = manifest.files.filter((item) => item.width >= 700 && item.variants && item.variants.some((variant) => variant.width === 480)).slice(0, 40);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const scored = [];
  for (const source of candidates) {
    const response = await page.request.get(source.sourceUrl);
    if (!response.ok()) continue;
    const body = Buffer.from(await response.body());
    const score = await page.evaluate(async ({ encodedSource }) => {
      const raw = Uint8Array.from(atob(encodedSource), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw]));
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 120;
      const ctx = canvas.getContext("2d");
      const crop = Math.min(bitmap.height, Math.round(bitmap.width / 3));
      ctx.drawImage(bitmap, 0, 0, bitmap.width, crop, 0, 0, 240, 120);
      const data = ctx.getImageData(0, 0, 240, 120).data;
      let edges = 0;
      for (let y = 1; y < 120; y += 1) {
        for (let x = 1; x < 240; x += 2) {
          const index = (y * 240 + x) * 4;
          const left = (y * 240 + x - 1) * 4;
          if (Math.abs(data[index] - data[left]) + Math.abs(data[index + 1] - data[left + 1]) + Math.abs(data[index + 2] - data[left + 2]) > 48) edges += 1;
        }
      }
      const variant = document.createElement("canvas");
      variant.width = 480;
      variant.height = Math.max(1, Math.round(bitmap.height * (480 / bitmap.width)));
      variant.getContext("2d").drawImage(bitmap, 0, 0, variant.width, variant.height);
      const variantBlob = await new Promise((resolve) => variant.toBlob(resolve, "image/webp", 0.82));
      const variantBitmap = await createImageBitmap(variantBlob);
      const preview = document.createElement("canvas");
      preview.width = 480;
      preview.height = 120;
      const previewCtx = preview.getContext("2d");
      previewCtx.drawImage(bitmap, 0, 0, bitmap.width, crop, 0, 0, 240, 120);
      previewCtx.drawImage(variantBitmap, 0, 0, variantBitmap.width, Math.min(variantBitmap.height, Math.round(variantBitmap.width / 3)), 240, 0, 240, 120);
      const previewBlob = await new Promise((resolve) => preview.toBlob(resolve, "image/png"));
      bitmap.close();
      variantBitmap.close();
      const bytes = new Uint8Array(await previewBlob.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 32768));
      return { edges, preview: btoa(binary), variantBytes: variantBlob.size };
    }, { encodedSource: body.toString("base64") });
    scored.push({ source, edges: score.edges, preview: score.preview, variantBytes: score.variantBytes });
  }
  await browser.close();
  scored.sort((a, b) => b.edges - a.edges);
  const dir = path.join(__dirname, "..", "artifacts", "cover-variants", "comparisons");
  fs.mkdirSync(dir, { recursive: true });
  manifest.comparisons = scored.slice(0, 3).map((item, index) => {
    const name = "comparison-" + (index + 1) + ".png";
    fs.writeFileSync(path.join(dir, name), Buffer.from(item.preview, "base64"));
    const variant480 = item.source.variants.find((variant) => variant.width === 480);
    return {
      id: item.source.id,
      sourceKey: item.source.sourceKey,
      width: item.source.width,
      height: item.source.height,
      originalBytes: item.source.originalBytes,
      variant480Bytes: variant480 ? variant480.bytes : item.variantBytes,
      edgeScore: item.edges,
      file: "artifacts/cover-variants/comparisons/" + name,
      note: "Left is the original top crop. Right is the same crop from the 480w q0.82 derivative."
    };
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest.comparisons.map((item) => ({ id: item.id, key: item.sourceKey, edges: item.edgeScore, originalBytes: item.originalBytes, variant480Bytes: item.variant480Bytes })), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
