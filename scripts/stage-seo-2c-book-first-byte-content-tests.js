#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const publicBook = require("../kutadgu-public-book.js");
const handler = require("../api/book-public.js");
const seo = require("../kutadgu-book-seo.js");

const FROZEN = {
  "shop.js": "f4f040bb8d1e0cfa0cb881a7411e9cf1b7db043ab61e98f1322a55208b7cd8ab",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "home-hero-content.js": "dddb9141d6b06414b44577524473dd48d28a7021f64abfcbac5c3f6ce0ad023b",
  "vercel.json": "b51d5f9089a7a7eee23de77b07115bcbf351f312cf7e7f3c608e14cd707e4665"
};

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  });
}

function sha256(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex");
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

function jsonResponse(status, body) {
  return { status, async json() { return body; } };
}

async function invoke(url, fetchImpl) {
  const orig = global.fetch;
  global.fetch = fetchImpl;
  const res = mockRes();
  try {
    await handler({ url, method: "GET" }, res);
  } finally {
    global.fetch = orig;
  }
  return { status: res.statusCode, body: res.chunks.join("") };
}

function sampleBook(extra) {
  return Object.assign({
    id: 217,
    title: "تارىخىمىزدىكى خاقانلار",
    author: "نۇرۇللا مۇئمىن يۇلغۇن",
    description: "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.",
    image_url: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/1789316012810.webp",
    category: "تارىخىي رومانلار",
    publisher: "قۇتادغۇبىلىك",
    isbn: "9786051234567",
    price: 232,
    stock: 15,
    source: "tarikhiy-romanlar.html",
    publish_year: "2020"
  }, extra || {});
}

function detailH1(html) {
  const match = html.match(/<div class="book-detail-info">\s*<h1>([\s\S]*?)<\/h1>/);
  return match ? match[1] : "";
}

function coverImg(html) {
  const match = html.match(/<div class="book-cover-box">\s*(<img\b[^>]*>)\s*<\/div>/);
  return match ? match[1] : "";
}

async function run() {
  await test("valid book first HTML has real title, author, cover, and catalog description", async () => {
    const row = sampleBook();
    const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(detailH1(out.body), "تارىخىمىزدىكى خاقانلار");
    assert.doesNotMatch(out.body, /<div class="book-detail-info">\s*<h1>كىتاب<\/h1>/);
    assert.strictEqual((out.body.match(/<div class="book-detail-info">\s*<h1>/g) || []).length, 1);
    assert.match(out.body, /<div class="book-author">ئاپتورى: نۇرۇللا مۇئمىن يۇلغۇن<\/div>/);
    const img = coverImg(out.body);
    assert.match(img, /src="https:\/\/fxlojnqwyojqjskfggmh\.supabase\.co\/storage\/v1\/object\/public\/book-covers\/book\/1789316012810\.webp"/);
    assert.match(img, /alt="تارىخىمىزدىكى خاقانلار كىتاب مۇقاۋىسى"/);
    assert.doesNotMatch(img, /\bhidden\b/);
    assert.match(out.body, /<section class="dynamic-book-description">/);
    assert.match(out.body, /<p>تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش\.<\/p>/);
    assert.doesNotMatch(out.body, /<section class="dynamic-book-description" hidden>/);
    assert.match(out.body, /<title>تارىخىمىزدىكى خاقانلار - قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
    assert.ok(out.body.includes('<link rel="canonical" href="https://www.kutadgubilik.com/book/217">'));
    assert.match(out.body, /<meta\s+name=["']robots["']\s+content=["']index,\s*follow["']/i);
    assert.ok(out.body.includes('property="og:title" content="تارىخىمىزدىكى خاقانلار"'));
    assert.ok(out.body.includes('property="og:url" content="https://www.kutadgubilik.com/book/217"'));
    assert.strictEqual((out.body.match(/id=["']kutadguBookSchema["']/gi) || []).length, 1);
    assert.strictEqual((out.body.match(/<div class="book-cover-box">/g) || []).length, 1);
    assert.strictEqual((out.body.match(/class="dynamic-book-description"/g) || []).length, 1);
    assert.strictEqual((out.body.match(/class="book-author"/g) || []).length, 1);
  });

  await test("placeholder author stays hidden and empty description stays hidden", async () => {
    const row = sampleBook({ author: "—", description: "   " });
    const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
    assert.strictEqual(detailH1(out.body), "تارىخىمىزدىكى خاقانلار");
    assert.match(out.body, /<div class="book-author" hidden><\/div>/);
    assert.doesNotMatch(out.body, /ئاپتورى: —/);
    assert.strictEqual(seo.storefrontAuthor(publicBook.publicSeoBook(row, "217")), "");
    assert.match(out.body, /<section class="dynamic-book-description" hidden>/);
    assert.doesNotMatch(out.body, /قۇتادغۇبىلىك كىتابخانىسى<\/p>/);
  });

  await test("unsafe cover stays hidden and never appears in the body img", async () => {
    for (const image_url of ["javascript:alert(1)", "data:image/png;base64,abc"]) {
      const row = sampleBook({ image_url, description: "" });
      const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
      const img = coverImg(out.body);
      assert.match(img, /\bhidden\b/, image_url);
      assert.doesNotMatch(img, /javascript:/i);
      assert.doesNotMatch(img, /data:image/i);
      assert.doesNotMatch(out.body, /javascript:alert\(1\)/);
      assert.doesNotMatch(out.body, /data:image\/png;base64,abc/);
      assert.match(img, /src=""/);
    }
  });

  await test("hostile catalog strings are escaped in first-byte body fields", async () => {
    const row = sampleBook({
      id: 9,
      title: "</h1><script>alert(1)</script>",
      author: "<img src=x onerror=alert(1)>",
      description: "</p><script>alert(2)</script>",
      image_url: "javascript:alert(1)"
    });
    const out = await invoke("/book/9", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assert.ok(out.body.includes("&lt;/h1&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.doesNotMatch(out.body, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(out.body, /<script>alert\(2\)<\/script>/);
    assert.ok(out.body.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(out.body.includes("&lt;/p&gt;&lt;script&gt;alert(2)&lt;/script&gt;"));
    assert.doesNotMatch(out.body, /javascript:alert\(1\)/);
    assert.match(out.body, /<title>&lt;\/h1&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; - قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
  });

  await test("missing book stays 404 noindex without first-byte catalog body", async () => {
    const missing = await invoke("/book/999999999", async () => jsonResponse(200, []));
    assert.strictEqual(missing.status, 404);
    assert.match(missing.body, /noindex/i);
    assert.doesNotMatch(missing.body, /kutadguBookSchema/);
    assert.doesNotMatch(missing.body, /class="book-detail-info"/);
    assert.doesNotMatch(missing.body, /dynamic-book-description/);
  });

  await test("legacy redirects stay in front and protected files stay frozen", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    const html = (vercel.rewrites || []).find((rule) => rule.source === "/book.html" && rule.destination === "/api/legacy-book-redirect");
    const numeric = (vercel.rewrites || []).find((rule) => rule.source === "/book/:id(\\d+)");
    assert.ok(html);
    assert.strictEqual(numeric.destination, "/api/book-public?id=:id");
    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(sha256(rel), FROZEN[rel], rel);
    });
    const src = fs.readFileSync(path.join(root, "kutadgu-public-book.js"), "utf8")
      + fs.readFileSync(path.join(root, "api/book-public.js"), "utf8");
    assert.doesNotMatch(src, /service_role/i);
    assert.doesNotMatch(src, /\.insert\(|\.update\(|\.delete\(/);
    const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
      cwd: root,
      encoding: "utf8"
    });
    const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
    [

      "kutadgu-search-rank.js",
      "kutadgu-ai-search.js",
      "api/ai-search.js",
      "vercel.json",
      "home-hero-content.js",

    ].forEach((rel) => {
      assert.ok(!files.includes(rel), rel);
    });
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " SEO 2C first-byte content test(s) failed");
    process.exit(1);
  }
  console.log("stage-seo-2c-book-first-byte-content-tests ok");
});
