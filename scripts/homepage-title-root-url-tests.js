#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
  }
}

const HOME_TITLE = "قۇتادغۇبىلىك كىتابخانىسى";

test("homepage <title> is exactly the store name", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const match = html.match(/<title>([^<]*)<\/title>/);
  assert.ok(match, "missing title tag");
  assert.strictEqual(match[1], HOME_TITLE);
  assert.doesNotMatch(html, /<title>[^<]*—/);
});

test("homepage canonical and og:url are custom-domain root, not index.html", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.kutadgubilig\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.kutadgubilig\.com\/">/);
  assert.doesNotMatch(html, /kutadgubilig\.com\/index\.html/);
  assert.doesNotMatch(html, /rel="canonical" href="https:\/\/kutadgu-bilig-kitab\.vercel\.app\/"/);
});

test("homepage logo points to /", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /<a href="\/" class="logo">/);
  assert.doesNotMatch(html, /href="index\.html"/);
});

test("book detail brand/home links point to / not index.html", () => {
  const html = fs.readFileSync(path.join(root, "book.html"), "utf8");
  assert.match(html, /class="detail-brand" href="\/"/);
  assert.match(html, /class="back-link" href="\/#books"/);
  assert.doesNotMatch(html, /href="index\.html/);
});

test("vercel permanently redirects /index.html to / once", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const redirects = vercel.redirects || [];
  const home = redirects.filter((r) => r.source === "/index.html");
  assert.strictEqual(home.length, 1);
  assert.strictEqual(home[0].destination, "/");
  assert.strictEqual(home[0].permanent, true);
  assert.ok(!redirects.some((r) => r.source === "/" && r.destination === "/index.html"));
  assert.ok(!redirects.some((r) => r.source === "/" && r.destination === "/"));
});

test("shop.js resets homepage title and only sets book titles on detail pages", () => {
  const src = fs.readFileSync(path.join(root, "shop.js"), "utf8");
  assert.match(src, /const HOMEPAGE_DOCUMENT_TITLE="قۇتادغۇبىلىك كىتابخانىسى"/);
  assert.match(src, /function applyHomepageDocumentTitle\(\)/);
  assert.match(src, /if\(isStorefrontHomepage\(\)\)\{\s*applyHomepageDocumentTitle\(\);\s*return;/);
  assert.match(src, /if\(!book\|\|!isBookDetailDocument\(\)\)return;/);
  assert.match(src, /pageshow/);
});

test("mobile home navigation uses / not index.html", () => {
  const src = fs.readFileSync(path.join(root, "mobile.js"), "utf8");
  assert.match(src, /\["باش بەت", "\/"/);
  assert.match(src, /brand\.href = "\/"/);
  assert.doesNotMatch(src, /\["باش بەت", "index\.html"/);
  assert.doesNotMatch(src, /brand\.href = "index\.html"/);
});

test("admin storefront shortcut still uses relative index.html", () => {
  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  assert.match(html, /href="index\.html"/);
});

test("robots and sitemap origin strategy unchanged", () => {
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  assert.match(robots, /Sitemap: https:\/\/www\.kutadgubilig\.com\/sitemap\.xml/);
  const sitemap = fs.readFileSync(path.join(root, "kutadgu-sitemap.js"), "utf8");
  assert.match(sitemap, /const SITE_ORIGIN = "https:\/\/www\.kutadgubilig\.com"/);
  assert.doesNotMatch(robots, /kutadgu-bilig-kitab\.vercel\.app/);
});

if (failed) process.exit(1);
console.log("homepage-title-root-url tests passed");
