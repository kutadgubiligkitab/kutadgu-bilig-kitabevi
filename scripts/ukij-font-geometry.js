#!/usr/bin/env node
"use strict";

const { chromium } = require("playwright");

const pages = [
  ["home", "/"],
  ["category", "/romanlar.html"],
  ["book", "/book-shell.html"],
  ["cart", "/cart.html"],
  ["account", "/account.html"],
  ["admin", "/admin.html"],
  ["staff", "/book-staff.html"]
];
const widths = [320, 390, 768, 1280];

async function blockWrites(page) {
  await page.route("**/*", (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") return route.abort();
    if (/analytics|posthog|visit-count|visit-proof|analytics-event|analytics_events/i.test(url)) return route.abort();
    return route.continue();
  });
}

async function measure(page, width, theme, weight) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(({ theme, weight }) => {
    document.body.classList.toggle("dark-mode", theme === "dark");
    document.body.style.fontWeight = weight === "bold" ? "700" : "400";
  }, { theme, weight });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const root = document.documentElement;
    const boxOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        size: style.fontSize,
        weight: style.fontWeight,
        line: style.lineHeight,
        family: style.fontFamily
      };
    };
    return {
      overflow: root.scrollWidth - root.clientWidth,
      title: boxOf("h1"),
      brand: boxOf(".kutadgu-brand-text"),
      input: boxOf("input, textarea"),
      price: boxOf("[class*='price'], .book-price, .price")
    };
  });
}

async function collect(origin) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await blockWrites(page);
  const rows = {};
  const fonts = {};
  for (const [name, path] of pages) {
    const seen = [];
    const onRequest = (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/UKIJCJK/.test(pathname)) seen.push(pathname.split("/").pop());
    };
    page.on("request", onRequest);
    await page.goto(origin + path, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    fonts[name] = [...new Set(seen)];
    page.off("request", onRequest);
    rows[name] = {};
    for (const width of widths) {
      for (const theme of ["light", "dark"]) {
        for (const weight of ["normal", "bold"]) {
          rows[name][`${width}-${theme}-${weight}`] = await measure(page, width, theme, weight);
        }
      }
    }
  }
  await browser.close();
  return { fonts, rows };
}

function differ(left, right) {
  const diffs = [];
  for (const page of Object.keys(left.rows)) {
    for (const key of Object.keys(left.rows[page])) {
      const a = left.rows[page][key];
      const b = right.rows[page][key];
      const fields = ["overflow", "title", "brand", "input", "price"];
      for (const field of fields) {
        if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
          diffs.push({ page, key, field, baseline: a[field], optimized: b[field] });
        }
      }
    }
  }
  return diffs;
}

async function main() {
  const baseline = process.argv[2];
  const optimized = process.argv[3];
  if (!baseline || !optimized) {
    console.error("usage: node scripts/ukij-font-geometry.js <baseline-origin> <optimized-origin>");
    process.exit(1);
  }
  const before = await collect(baseline);
  const after = await collect(optimized);
  const diffs = differ(before, after);
  console.log(JSON.stringify({ baselineFonts: before.fonts, optimizedFonts: after.fonts, differences: diffs.length, diffs: diffs.slice(0, 30) }, null, 2));
  if (diffs.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
