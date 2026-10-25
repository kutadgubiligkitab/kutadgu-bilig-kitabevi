"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const QUALITIES = [0.75, 0.82, 0.86, 0.92];
const WIDTHS = [480, 960];

function draw(ctx, kind, width, height) {
  ctx.clearRect(0, 0, width, height);
  if (kind === "transparent") {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#1d4e39";
    ctx.font = "600 28px sans-serif";
    ctx.fillText("قۇتادغۇ بىلىك", 24, 80);
    ctx.fillStyle = "#8b1e1e";
    ctx.fillRect(24, 120, 90, 90);
    return;
  }
  ctx.fillStyle = kind === "dark" ? "#1a120e" : "#f4efe6";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = kind === "dark" ? "#f3e6c8" : "#24170f";
  ctx.font = "600 22px sans-serif";
  ctx.fillText("قۇتادغۇ بىلىك", 18, 48);
  ctx.font = "600 20px sans-serif";
  ctx.fillText("古兰经注", 18, 88);
  ctx.font = "600 16px sans-serif";
  ctx.fillText("Kutadgu Bilig 2013", 18, 124);
  ctx.fillStyle = kind === "dark" ? "#c4553a" : "#6d3b2b";
  for (let y = 150; y < height - 20; y += 18) ctx.fillRect(18, y, width - 36, 2);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const report = await page.evaluate(async ({ qualities, widths }) => {
    function paint(kind, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: true });
      ctx.clearRect(0, 0, width, height);
      if (kind !== "transparent") {
        ctx.fillStyle = kind === "dark" ? "#1a120e" : "#f4efe6";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.fillStyle = kind === "dark" ? "#f3e6c8" : "#24170f";
      ctx.font = "600 22px sans-serif";
      ctx.fillText("قۇتادغۇ بىلىك", 18, 48);
      ctx.font = "600 20px sans-serif";
      ctx.fillText("古兰经注", 18, 88);
      ctx.font = "600 16px sans-serif";
      ctx.fillText("Kutadgu Bilig 2013", 18, 124);
      if (kind !== "transparent") {
        ctx.fillStyle = kind === "dark" ? "#c4553a" : "#6d3b2b";
        for (let y = 150; y < height - 20; y += 18) ctx.fillRect(18, y, width - 36, 2);
      } else {
        ctx.fillStyle = "#1d4e39";
        ctx.fillRect(24, 140, 80, 80);
      }
      return canvas;
    }
    function pixels(canvas) {
      return canvas.getContext("2d", { alpha: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    }
    async function blobOf(canvas, quality) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      return blob;
    }
    const rows = [];
    for (const width of widths) {
      const height = Math.round(width * 1.5);
      for (const kind of ["light", "dark", "transparent"]) {
        const source = paint(kind, width, height);
        const sourcePx = pixels(source);
        const master = await blobOf(source, 0.92);
        for (const quality of qualities) {
          const blob = await blobOf(source, quality);
          const bitmap = await createImageBitmap(blob);
          const decoded = document.createElement("canvas");
          decoded.width = width;
          decoded.height = height;
          const ctx = decoded.getContext("2d", { alpha: true });
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const next = pixels(decoded);
          let changed = 0;
          let alphaLost = 0;
          const samples = sourcePx.length / 4;
          for (let i = 0; i < sourcePx.length; i += 4) {
            const sourceAlpha = sourcePx[i + 3];
            const nextAlpha = next[i + 3];
            if (sourceAlpha < 250 && nextAlpha > sourceAlpha + 8) alphaLost += 1;
            if (Math.abs(sourcePx[i] - next[i]) > 12 || Math.abs(sourcePx[i + 1] - next[i + 1]) > 12 || Math.abs(sourcePx[i + 2] - next[i + 2]) > 12 || Math.abs(sourceAlpha - nextAlpha) > 12) changed += 1;
          }
          rows.push({
            kind,
            width,
            height,
            quality,
            bytes: blob.size,
            masterBytes: master.size,
            changedRatio: Number((changed / samples).toFixed(4)),
            alphaLost
          });
        }
      }
    }
    return rows;
  }, { qualities: QUALITIES, widths: WIDTHS });
  await browser.close();
  const dir = path.join(__dirname, "..", "artifacts", "cover-variants");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "quality.json"), JSON.stringify({ qualities: QUALITIES, widths: WIDTHS, rows: report }, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
