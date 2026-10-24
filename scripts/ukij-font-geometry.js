#!/usr/bin/env node
"use strict";

/*
Measuring once, immediately after a viewport, theme, or weight change, is not
stable. The first pass reported eight differences, mostly vertical positions,
plus one brand line-height. A later single measurement, 600ms after navigation,
still reported the book-shell title at 1280px light normal as y 208 on the
baseline and y 209 on the optimized pages. Repeating that immediate measurement
on the compact-range tree reported four differences, all the book-shell title
at 1280px: baseline y 208 and optimized y 207, for light and dark and for
normal and bold. Size, line height, weight, and family matched in every case.
Two rounded samples can match while the position is still crossing a pixel.
On the book page at 1280px the title moved from about 206.5 to 205, and one
origin rounded to 206 for two frames while the other had already reached 205.
Stability therefore uses the unrounded boxes. The recorded comparison stays
rounded and exact. Pass --immediate to repeat the unsettled single measurement.
*/

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

async function readBoxes(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const boxOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
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

function quantize(value) {
  if (typeof value === "number") return Math.round(value * 64) / 64;
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) next[key] = quantize(item);
  return next;
}

function publish(sample) {
  const box = (value) => {
    if (!value) return null;
    return {
      x: Math.round(value.x),
      y: Math.round(value.y),
      w: Math.round(value.w),
      h: Math.round(value.h),
      size: value.size,
      weight: value.weight,
      line: value.line,
      family: value.family
    };
  };
  return {
    overflow: sample.overflow,
    title: box(sample.title),
    brand: box(sample.brand),
    input: box(sample.input),
    price: box(sample.price)
  };
}

async function frames(page, count) {
  await page.evaluate((count) => new Promise((resolve) => {
    let left = count;
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), count);
}

async function measure(page, width, theme, weight, immediate) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(({ theme, weight }) => {
    document.body.classList.toggle("dark-mode", theme === "dark");
    document.body.style.fontWeight = weight === "bold" ? "700" : "400";
  }, { theme, weight });
  if (immediate) return publish(await readBoxes(page));
  await page.evaluate(() => document.fonts.ready);
  await frames(page, 2);
  let previous = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readBoxes(page);
    const signature = JSON.stringify(quantize(current));
    if (previous && previous === signature) return publish(current);
    previous = signature;
    await frames(page, 2);
  }
  throw new Error(`geometry did not settle at ${width} ${theme} ${weight}`);
}

async function collect(origin, immediate) {
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
    if (immediate) await page.waitForTimeout(600);
    else await frames(page, 2);
    fonts[name] = [...new Set(seen)];
    page.off("request", onRequest);
    rows[name] = {};
    for (const width of widths) {
      for (const theme of ["light", "dark"]) {
        for (const weight of ["normal", "bold"]) {
          rows[name][`${width}-${theme}-${weight}`] = await measure(page, width, theme, weight, immediate);
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
  const immediate = process.argv.includes("--immediate");
  const origins = process.argv.slice(2).filter((arg) => arg !== "--immediate");
  const baseline = origins[0];
  const optimized = origins[1];
  if (!baseline || !optimized) {
    console.error("usage: node scripts/ukij-font-geometry.js [--immediate] <baseline-origin> <optimized-origin>");
    process.exit(1);
  }
  const before = await collect(baseline, immediate);
  const after = await collect(optimized, immediate);
  const diffs = differ(before, after);
  console.log(JSON.stringify({
    mode: immediate ? "immediate" : "settled",
    baselineFonts: before.fonts,
    optimizedFonts: after.fonts,
    differences: diffs.length,
    diffs: diffs.slice(0, 30)
  }, null, 2));
  if (diffs.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
