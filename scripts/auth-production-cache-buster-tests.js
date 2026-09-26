#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const REQUIRED = {
  "supabase-config.js": "22",
  "shop.js": "134",
  "member.js": "28"
};
const SCRIPT_SRC = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const SKIP_HTML = new Set([
  "admin-quality-preview.html"
]);

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.message);
  }
}

function walkHtml(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (["node_modules", "vendor", "test-results", "playwright-report", "tests"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function scriptName(src) {
  return String(src || "").split("?")[0].split("/").pop();
}

function scriptVersion(src) {
  const q = String(src || "").split("?")[1] || "";
  const m = /(?:^|&)v=(\d+)(?:&|$)/.exec(q);
  return m ? m[1] : "";
}

test("production HTML script tags pin current auth isolation assets", () => {
  const files = walkHtml(root, []);
  assert.ok(files.length >= 100, "expected production HTML pages, got " + files.length);
  const stale = [];
  const missingVersion = [];
  let shopPages = 0;
  let configPages = 0;
  let memberPages = 0;
  for (const file of files) {
    const rel = path.relative(root, file);
    if (SKIP_HTML.has(rel)) continue;
    const html = fs.readFileSync(file, "utf8");
    SCRIPT_SRC.lastIndex = 0;
    let match;
    while ((match = SCRIPT_SRC.exec(html))) {
      const src = match[1];
      const name = scriptName(src);
      if (!REQUIRED[name]) continue;
      if (name === "shop.js") shopPages += 1;
      if (name === "supabase-config.js") configPages += 1;
      if (name === "member.js") memberPages += 1;
      const ver = scriptVersion(src);
      if (!ver) missingVersion.push(rel + " -> " + src);
      else if (ver !== REQUIRED[name]) stale.push(rel + " -> " + src);
    }
  }
  assert.deepStrictEqual(stale, [], stale.join("\n"));
  assert.deepStrictEqual(missingVersion, [], missingVersion.join("\n"));
  assert.ok(shopPages >= 100, "expected shop.js on listing/detail pages, got " + shopPages);
  assert.ok(configPages >= 100, "expected supabase-config.js on storefront pages, got " + configPages);
  assert.strictEqual(memberPages, 2, "account.html and book-staff.html should be the only direct member.js pages");
});

test("admin-quality-preview.html is excluded because it is a noindex Admin CSS preview without auth scripts", () => {
  const html = fs.readFileSync(path.join(root, "admin-quality-preview.html"), "utf8");
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /supabase-config\.js/);
  assert.doesNotMatch(html, /shop\.js/);
  assert.doesNotMatch(html, /member\.js/);
});

test("dynamic Member loader and already-current pages stay on member.js v=28", () => {
  const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
  const account = fs.readFileSync(path.join(root, "account.html"), "utf8");
  const staff = fs.readFileSync(path.join(root, "book-staff.html"), "utf8");
  assert.match(shop, /member\.js\?v=28/);
  assert.doesNotMatch(shop, /member\.js\?v=(?:[0-9]|1\d|2[0-7])\b/);
  assert.match(account, /member\.js\?v=28/);
  assert.match(staff, /member\.js\?v=28/);
});

if (failed) {
  console.error("\n" + failed + " auth production cache-buster test(s) failed");
  process.exit(1);
}
console.log("auth-production-cache-buster-tests ok");
