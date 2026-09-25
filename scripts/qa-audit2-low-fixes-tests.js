#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const seo = require("../kutadgu-book-seo.js");
const handler = require("../api/book-public.js");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

let failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  });
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function titleOf(html) {
  const match = String(html).match(/<title>([\s\S]*?)<\/title>/);
  return match ? match[1] : "";
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { if (body != null) this.chunks.push(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); }
  };
}

async function invoke(url, fetchImpl) {
  const orig = global.fetch;
  if (fetchImpl) global.fetch = fetchImpl;
  const res = mockRes();
  try {
    await handler({ url, method: "GET" }, res);
  } finally {
    if (fetchImpl) global.fetch = orig;
  }
  return { status: res.statusCode, body: res.chunks.join("") };
}

function jsonResponse(status, body) {
  return {
    status,
    async json() { return body; }
  };
}

function rewrite(source, destination) {
  return (vercel.rewrites || []).find((rule) => rule.source === source && rule.destination === destination);
}

async function run() {
  await test("adabiyat-roman title is distinct from romanlar and stays indexable", () => {
    const novels = read("romanlar.html");
    const literary = read("adabiyat-roman.html");
    const novelsTitle = "رومانلار - قۇتادغۇبىلىك كىتابخانىسى";
    const literaryTitle = "ئەدەبىيات رومانلىرى - قۇتادغۇبىلىك كىتابخانىسى";
    assert.strictEqual(titleOf(novels), novelsTitle);
    assert.strictEqual(titleOf(literary), literaryTitle);
    assert.notStrictEqual(titleOf(novels), titleOf(literary));
    assert.match(literary, /<link rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/adabiyat-roman">/);
    assert.match(novels, /<link rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/romanlar">/);
    assert.match(literary, /name="description" content="قۇتادغۇبىلىك كىتابخانىسىدىكى ئەدەبىيات رومانلىرى بۆلىمىنى كۆرۈڭ ۋە WhatsApp ئارقىلىق زاكاز قىلىڭ\."/);
    assert.match(literary, /name="robots" content="index, follow"/);
    assert.match(literary, /<h1>\s*رومانلار\s*<\/h1>/);
  });

  await test("header search focus ring is keyboard-only and unfocused input stays borderless", () => {
    const css = read("public-header.css");
    const focus = css.match(/\.kutadgu-header-search:has\(input:focus-visible\)\s*\{[^}]+\}/);
    assert.ok(focus);
    assert.match(focus[0], /border-color:\s*#fff/);
    assert.match(focus[0], /outline:\s*3px solid/);
    const input = css.match(/\.kutadgu-header-search input\s*\{[^}]+\}/);
    assert.ok(input);
    assert.match(input[0], /outline:\s*none/);
    assert.match(input[0], /border:\s*0/);
    assert.match(read("public-header.js"), /public-header\.css\?v=5/);
  });

  await test("invalid book paths rewrite to the public handler, not the generic shell", () => {
    assert.ok(rewrite("/book/:id(\\d+)", "/api/book-public?id=:id"));
    assert.ok(rewrite("/book/:id", "/api/book-public?id=:id"));
    assert.ok(rewrite("/book.html", "/api/book-public"));
    assert.ok(rewrite("/book", "/api/book-public"));
    assert.ok(rewrite("/book.html", "/api/legacy-book-redirect"));
    assert.ok(rewrite("/book", "/api/legacy-book-redirect"));
    const legacyHtml = rewrite("/book.html", "/api/legacy-book-redirect");
    const legacyBare = rewrite("/book", "/api/legacy-book-redirect");
    assert.strictEqual(legacyHtml.has[0].value, "\\d+");
    assert.strictEqual(legacyBare.has[0].value, "\\d+");
    assert.ok(!(vercel.rewrites || []).some((rule) => rule.destination === "/book-shell.html"));
    assert.strictEqual(seo.legacyNumericIdRedirectPath("?id=415"), "/book/415");
    assert.strictEqual(seo.legacyNumericIdRedirectPath("?id=415&utm_source=test"), "/book/415?utm_source=test");
    assert.strictEqual(seo.legacyNumericIdRedirectPath("?id=abc"), "");
    assert.strictEqual(seo.legacyNumericIdRedirectPath("?id="), "");
    assert.ok(fs.existsSync(path.join(root, "book-shell.html")));
    assert.doesNotMatch(read("book-shell.html"), /name=["']robots["']/i);
  });

  await test("non-numeric and bare book URLs are HTTP 404 noindex", async () => {
    for (const url of ["/book/abc", "/api/book-public?id=abc", "/book.html", "/book", "/book/not-a-number", "/book.html?id=children-3"]) {
      const res = await invoke(url);
      assert.strictEqual(res.status, 404, url);
      assert.match(res.body, /noindex/);
      assert.doesNotMatch(res.body, /kutadguBookSchema/);
      assert.doesNotMatch(res.body, /data-dynamic-book/);
      assert.match(res.body, /كىتاب تېپىلمىدى/);
    }
  });

  await test("missing numeric id is 404 and a found numeric id stays a rendered book", async () => {
    const missing = await invoke("/book/999999999", async () => jsonResponse(200, []));
    assert.strictEqual(missing.status, 404);
    assert.match(missing.body, /noindex/);
    assert.doesNotMatch(missing.body, /data-dynamic-book/);

    const found = await invoke("/book/415", async () => jsonResponse(200, [{
      id: 415,
      title: "سىناق كىتاب",
      author: "سىناق",
      description: "چۈشەندۈرۈش"
    }]));
    assert.strictEqual(found.status, 200);
    assert.match(found.body, /index, follow/);
    assert.match(found.body, /data-dynamic-book/);
    assert.match(found.body, /سىناق كىتاب/);
    assert.match(found.body, /https:\/\/www\.kutadgubilik\.com\/book\/415/);
    assert.doesNotMatch(found.body, /كىتاب تېپىلمىدى/);
  });

  if (failed) {
    console.error("\n" + failed + " audit2 low-fix test(s) failed");
    process.exit(1);
  }
  console.log("qa-audit2-low-fixes-tests ok");
}

run();
