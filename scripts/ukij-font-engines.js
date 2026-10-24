#!/usr/bin/env node
"use strict";

const { firefox, webkit } = require("playwright");
// Playwright's bundled Firefox and WebKit. This is not a physical iPhone or Safari.

const origin = process.argv[2] || "http://127.0.0.1:4173";

async function widthIn(browserType, block) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const seen = [];
  if (block) await page.route("**/*UKIJCJK*", (route) => route.abort());
  else {
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/UKIJCJK/.test(path)) seen.push(path.split("/").pop());
    });
  }
  await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  const width = await page.evaluate(() => {
    const span = document.createElement("span");
    span.textContent = "كىتابخانىسى";
    span.style.cssText = 'position:absolute;font-size:32px;font-weight:700;font-family:"UKIJ CJK", Arial, sans-serif';
    document.body.appendChild(span);
    return span.getBoundingClientRect().width;
  });
  await browser.close();
  return { width, seen: [...new Set(seen)] };
}

async function widths(browserType) {
  const without = await widthIn(browserType, true);
  const withFont = await widthIn(browserType, false);
  return {
    seen: withFont.seen,
    without: without.width,
    withFont: withFont.width,
    changed: without.width !== withFont.width
  };
}

async function main() {
  for (const [name, browserType] of [["firefox", firefox], ["webkit", webkit]]) {
    try {
      const result = await widths(browserType);
      console.log(JSON.stringify({ browser: name, ...result }));
    } catch (err) {
      console.log(JSON.stringify({ browser: name, error: String(err && err.message || err).split("\n")[0] }));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
