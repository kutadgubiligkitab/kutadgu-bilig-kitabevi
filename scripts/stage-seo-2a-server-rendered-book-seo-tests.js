#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const publicBook = require("../kutadgu-public-book.js");
const seo = require("../kutadgu-book-seo.js");
const handler = require("../api/book-public.js");

const FROZEN = {
  "shop.js": "f4f040bb8d1e0cfa0cb881a7411e9cf1b7db043ab61e98f1322a55208b7cd8ab",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5"
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

function jsonLd(html) {
  const match = html.match(/<script id="kutadguBookSchema" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "missing kutadguBookSchema");
  return JSON.parse(match[1]);
}

async function run() {
  await test("valid active book gets unique server-rendered title, description, canonical, robots, and JSON-LD", async () => {
    const row = sampleBook();
    const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assert.match(out.body, /<title>تارىخىمىزدىكى خاقانلار - قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
    assert.doesNotMatch(out.body, /<title>كىتاب - قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
    assert.ok(out.body.includes('content="تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش."'));
    assert.ok(out.body.includes('<link rel="canonical" href="https://www.kutadgubilik.com/book/217">'));
    assert.match(out.body, /<meta\s+name=["']robots["']\s+content=["']index, follow["']>/i);
    assert.ok(out.body.includes('property="og:title" content="تارىخىمىزدىكى خاقانلار"'));
    assert.ok(out.body.includes('property="og:url" content="https://www.kutadgubilik.com/book/217"'));
    assert.ok(out.body.includes('property="og:image" content="https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/1789316012810.webp"'));
    const payload = jsonLd(out.body);
    assert.strictEqual(payload["@context"], "https://schema.org");
    const bookNode = payload["@graph"].find((node) => node["@type"] === "Book");
    const crumbs = payload["@graph"].find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(bookNode);
    assert.strictEqual(bookNode.name, "تارىخىمىزدىكى خاقانلار");
    assert.strictEqual(bookNode.url, "https://www.kutadgubilik.com/book/217");
    assert.ok(crumbs);
    assert.strictEqual(crumbs.itemListElement[2].item, "https://www.kutadgubilik.com/book/217");
    assert.strictEqual((out.body.match(/rel=["']canonical["']/gi) || []).length, 1);
    assert.strictEqual((out.body.match(/name=["']robots["']/gi) || []).length, 1);
    assert.strictEqual((out.body.match(/id=["']kutadguBookSchema["']/gi) || []).length, 1);
    assert.deepStrictEqual(seo.buildBookJsonLd(publicBook.publicSeoBook(row, "217"), {
      canonical: "https://www.kutadgubilik.com/book/217",
      authorName: seo.storefrontAuthor(publicBook.publicSeoBook(row, "217")),
      image: row.image_url,
      visible: true,
      stockKey: "in"
    })["@graph"][0].name, bookNode.name);
  });

  await test("hostile catalog strings are escaped and unsafe covers are omitted", async () => {
    const row = sampleBook({
      id: 9,
      title: "</title><script>alert(1)</script>",
      author: "<img src=x onerror=alert(1)>",
      description: 'x" onmouseover="alert(1)',
      image_url: "javascript:alert(1)",
      publisher: "<b>nope</b>",
      category: "تارىخىي رومانلار"
    });
    const out = await invoke("/book/9", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assert.ok(out.body.includes("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.doesNotMatch(out.body, /<script>alert\(1\)<\/script>/);
    assert.ok(out.body.includes("&lt;img src=x onerror=alert(1)&gt;") || out.body.includes("\\u003c"));
    assert.doesNotMatch(out.body, /property=["']og:image["'][^>]*javascript:/i);
    const payload = jsonLd(out.body);
    const bookNode = payload["@graph"].find((node) => node["@type"] === "Book");
    assert.ok(!bookNode.image);
    assert.ok(!out.body.includes("javascript:alert(1)"));
  });

  await test("missing/inactive books stay 404 noindex without book schema or clean canonical", async () => {
    const missing = await invoke("/book/999999999", async () => jsonResponse(200, []));
    assert.strictEqual(missing.status, 404);
    assert.match(missing.body, /noindex/i);
    assert.doesNotMatch(missing.body, /kutadguBookSchema/);
    assert.doesNotMatch(missing.body, /https:\/\/www\.kutadgubilik\.com\/book\/999999999/);
    assert.doesNotMatch(missing.body, /content=["']index, follow["']/);
  });

  await test("lookup URL stays read-only anon and does not select private columns", () => {
    const url = publicBook.publicBookLookupUrl("217");
    assert.ok(url.includes("is_active=eq.true"));
    assert.doesNotMatch(url, /select=\*/);
    assert.doesNotMatch(url, /submission_status|sales_count|legacy_id|is_kutadgu_admin/);
    const cols = publicBook.PUBLIC_SEO_SELECT.split(",");
    assert.ok(cols.includes("publish_year"));
    assert.ok(cols.includes("translator"));
    assert.ok(cols.includes("pages"));
    assert.ok(cols.includes("cover_type"));
    assert.ok(cols.includes("book_size"));
    assert.ok(cols.includes("interior_print_type"));
    assert.ok(cols.includes("is_color_print"));
    assert.ok(!cols.includes("language"));
    assert.ok(!cols.includes("publish_date"));
    const mapped = publicBook.publicSeoBook(sampleBook(), "217");
    assert.strictEqual(mapped.publishYear, "2020");
    assert.ok(!Object.prototype.hasOwnProperty.call(mapped, "language"));
    assert.ok(!Object.prototype.hasOwnProperty.call(mapped, "publishDate"));
    const src = fs.readFileSync(path.join(root, "kutadgu-public-book.js"), "utf8")
      + fs.readFileSync(path.join(root, "api/book-public.js"), "utf8");
    assert.doesNotMatch(src, /service_role/i);
    assert.doesNotMatch(src, /\.insert\(|\.update\(|\.delete\(/);
  });

  await test("legacy query URL 308 behavior is unchanged and protected files stay frozen", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    const html = (vercel.rewrites || []).find((rule) => rule.source === "/book.html" && rule.destination === "/api/legacy-book-redirect");
    const numeric = (vercel.rewrites || []).find((rule) => rule.source === "/book/:id(\\d+)");
    assert.ok(html);
    assert.strictEqual(numeric.destination, "/api/book-public?id=:id");
    const htmlIdx = (vercel.rewrites || []).indexOf(html);
    const numericIdx = (vercel.rewrites || []).indexOf(numeric);
    assert.ok(htmlIdx < numericIdx);
    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(sha256(rel), FROZEN[rel], rel);
    });
    const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
      cwd: root,
      encoding: "utf8"
    });
    const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
    [

      "kutadgu-search-rank.js",
      "kutadgu-ai-search.js",
      "api/ai-search.js",
      "vercel.json"
    ].forEach((rel) => {
      assert.ok(!files.includes(rel), rel);
    });
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " SEO 2A test(s) failed");
    process.exit(1);
  }
  console.log("stage-seo-2a-server-rendered-book-seo-tests ok");
});
