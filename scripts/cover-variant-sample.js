"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const KEYS = [
  "book-covers/107/1788094588301.webp",
  "book-covers/132/1789315153076.webp",
  "book-covers/165/1789224059997.webp",
  "book-covers/282/1789596347386.webp"
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const rows = [];
  for (const key of KEYS) {
    const url = "https://www.kutadgubilik.com/__r2/" + key;
    const response = await page.request.get(url);
    const body = await response.body();
    const measured = await page.evaluate(async ({ bytes, qualities }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/webp" });
      const bitmap = await createImageBitmap(blob);
      const width = bitmap.width;
      const height = bitmap.height;
      const results = [];
      for (const quality of qualities) {
        for (const target of [480, 960]) {
          if (target >= width) {
            results.push({ quality, width: target, skipped: true });
            continue;
          }
          const canvas = document.createElement("canvas");
          canvas.width = target;
          canvas.height = Math.max(1, Math.round(height * (target / width)));
          const ctx = canvas.getContext("2d", { alpha: true });
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const encoded = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
          results.push({ quality, width: target, height: canvas.height, bytes: encoded ? encoded.size : 0, skipped: false });
        }
      }
      bitmap.close();
      return { width, height, results };
    }, { bytes: [...body], qualities: [0.82, 0.92] });
    rows.push({ key, originalBytes: body.length, ...measured });
  }
  await browser.close();
  const dir = path.join(__dirname, "..", "artifacts", "cover-variants");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sample-bytes.json"), JSON.stringify({ readOnly: true, uploaded: false, rows }, null, 2));
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
