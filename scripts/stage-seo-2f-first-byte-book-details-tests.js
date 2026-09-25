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

const ICON = '<link rel="icon" type="image/png" href="/kutadgu-logo.png">';
const META_LABELS = [
  "ئاپتورى",
  "تەرجىمە قىلغۇچى",
  "نەشرىيات",
  "نەشر يىلى",
  "ISBN",
  "بەت سانى",
  "مۇقاۋا تۈرى",
  "كىتاب ئۆلچىمى",
  "ئىچكى بېسىلىشى",
  "كىتاب تۈرى"
];

const FROZEN = {
  "shop.js": "9d92a63b107c2a7fec82d5cb5a6f7fc01760b89207434a1855e7f738d43ae527",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "kutadgu-book-seo.js": "be6e4e0d5a499f5bb8fddc46aa42df04c856c87ec2276195c51875b336736a80",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
  "book-shell.html": "9376b9f374abd8b8670dfd0387832ee9a5cdb6127ee9a1764d22f1dbd7dc3042",
  "index.html": "d23c1cd43dad8df41b9b5ca7bfff11ce7613fd9c7d1eb3ed7427cef26e674d09",
  "home-hero-content.js": "dddb9141d6b06414b44577524473dd48d28a7021f64abfcbac5c3f6ce0ad023b",
  "vercel.json": "5f7c347d0b8ac2a40bac10ba0ee0189abaa774e01d83d25af3c15b8f68f75d15"
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
    translator: "ئابدۇللا تۆمۈر",
    description: "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.",
    image_url: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/1789316012810.webp",
    category: "تارىخىي رومانلار",
    publisher: "قۇتادغۇبىلىك",
    isbn: "9786051234567",
    price: 232,
    stock: 15,
    source: "tarikhiy-romanlar.html",
    publish_year: "2020",
    pages: 320,
    cover_type: "hardcover",
    book_size: "A5",
    interior_print_type: "bw",
    is_color_print: false
  }, extra || {});
}

function metaBlock(html) {
  const match = html.match(/<div class="book-meta">([\s\S]*?)<\/div>\s*<section class="dynamic-book-description"/);
  return match ? match[1] : "";
}

function metaLabels(html) {
  return [...metaBlock(html).matchAll(/<div class="book-meta-label">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
}

function metaValue(html, label) {
  const re = new RegExp(
    `<div class="book-meta-row"><div class="book-meta-label">${label}</div><div class="book-meta-value">([\\s\\S]*?)<\\/div><\\/div>`
  );
  const match = metaBlock(html).match(re);
  return match ? match[1] : "";
}

function metaName(html, name) {
  const match = html.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function bookNodeOf(payload) {
  return payload["@graph"].find((node) => {
    const type = node && node["@type"];
    return type === "Book" || (Array.isArray(type) && type.includes("Book"));
  });
}

function jsonLd(html) {
  const match = html.match(/<script id="kutadguBookSchema" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "missing kutadguBookSchema");
  return JSON.parse(match[1]);
}

async function run() {
  await test("A: valid active book first-byte .book-meta contains factual rows", async () => {
    const out = await invoke("/book/217", async () => jsonResponse(200, [sampleBook()]));
    assert.strictEqual(out.status, 200);
    const block = metaBlock(out.body);
    assert.ok(block.trim());
    assert.strictEqual(metaValue(out.body, "ئاپتورى"), "نۇرۇللا مۇئمىن يۇلغۇن");
    assert.strictEqual(metaValue(out.body, "تەرجىمە قىلغۇچى"), "ئابدۇللا تۆمۈر");
    assert.strictEqual(metaValue(out.body, "نەشرىيات"), "قۇتادغۇبىلىك");
    assert.strictEqual(metaValue(out.body, "نەشر يىلى"), "2020");
    assert.strictEqual(metaValue(out.body, "ISBN"), "9786051234567");
    assert.strictEqual(metaValue(out.body, "بەت سانى"), "320");
    assert.strictEqual(metaValue(out.body, "كىتاب تۈرى"), "تارىخىي رومانلار");
  });

  await test("B: first-byte row order matches shop.js client order", async () => {
    const out = await invoke("/book/217", async () => jsonResponse(200, [sampleBook()]));
    assert.deepStrictEqual(metaLabels(out.body), META_LABELS);
  });

  await test("C: missing optional fields produce no empty/unknown rows", async () => {
    const row = sampleBook({
      translator: "",
      publisher: "",
      isbn: "",
      pages: null,
      cover_type: "",
      book_size: null,
      interior_print_type: "",
      is_color_print: false,
      publish_year: "",
      category: "unknown"
    });
    const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
    const labels = metaLabels(out.body);
    assert.deepStrictEqual(labels, ["ئاپتورى"]);
    assert.doesNotMatch(metaBlock(out.body), /undefined|null/i);
    assert.doesNotMatch(metaBlock(out.body), />unknown</i);
    assert.doesNotMatch(out.body, /<div class="book-meta-value"><\/div>/);
  });

  await test("D: placeholder author is omitted from .book-meta", async () => {
    const out = await invoke("/book/217", async () => jsonResponse(200, [sampleBook({ author: "—" })]));
    assert.ok(!metaLabels(out.body).includes("ئاپتورى"));
    assert.match(out.body, /<div class="book-author" hidden><\/div>/);
    assert.ok(metaLabels(out.body).includes("تەرجىمە قىلغۇچى"));
  });

  await test("E: bibliography labels use existing Uyghur helpers", async () => {
    const hard = await invoke("/book/217", async () => jsonResponse(200, [sampleBook({
      cover_type: "hardcover",
      book_size: "A4",
      interior_print_type: "color"
    })]));
    assert.strictEqual(metaValue(hard.body, "مۇقاۋا تۈرى"), "قاتتىق مۇقاۋىلىق");
    assert.strictEqual(metaValue(hard.body, "كىتاب ئۆلچىمى"), "A4");
    assert.strictEqual(metaValue(hard.body, "ئىچكى بېسىلىشى"), "رەڭلىك");

    const paper = await invoke("/book/217", async () => jsonResponse(200, [sampleBook({
      cover_type: "paperback",
      book_size: "B5",
      interior_print_type: "bw"
    })]));
    assert.strictEqual(metaValue(paper.body, "مۇقاۋا تۈرى"), "يۇمشاق مۇقاۋىلىق");
    assert.strictEqual(metaValue(paper.body, "كىتاب ئۆلچىمى"), "B5");
    assert.strictEqual(metaValue(paper.body, "ئىچكى بېسىلىشى"), "رەڭسىز");

    const colorFlag = await invoke("/book/217", async () => jsonResponse(200, [sampleBook({
      interior_print_type: "",
      is_color_print: true,
      book_size: "A5"
    })]));
    assert.strictEqual(metaValue(colorFlag.body, "ئىچكى بېسىلىشى"), "رەڭلىك");
    assert.strictEqual(metaValue(colorFlag.body, "كىتاب ئۆلچىمى"), "A5");
  });

  await test("F: hostile catalog strings are escaped in .book-meta-value", async () => {
    const row = sampleBook({
      id: 9,
      author: "</div><script>alert(1)</script>",
      translator: '<img src=x onerror=alert(1)>',
      publisher: 'نەشرىيات & "quote"',
      category: "</div><script>alert(2)</script>",
      description: ""
    });
    const out = await invoke("/book/9", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assert.ok(metaValue(out.body, "ئاپتورى").includes("&lt;script&gt;"));
    assert.ok(metaValue(out.body, "تەرجىمە قىلغۇچى").includes("&lt;img"));
    assert.ok(metaValue(out.body, "نەشرىيات").includes("&amp;") || metaValue(out.body, "نەشرىيات").includes("&quot;"));
    assert.ok(metaValue(out.body, "كىتاب تۈرى").includes("&lt;script&gt;"));
    assert.doesNotMatch(metaBlock(out.body), /<script>alert/);
    assert.doesNotMatch(out.body, /<script>alert\(1\)<\/script>/);
  });

  await test("G: no duplicate meta, H1, author, or description blocks", async () => {
    const out = await invoke("/book/217", async () => jsonResponse(200, [sampleBook()]));
    assert.strictEqual((out.body.match(/class="book-meta"/g) || []).length, 1);
    assert.strictEqual((out.body.match(/<div class="book-detail-info">\s*<h1>/g) || []).length, 1);
    assert.strictEqual((out.body.match(/class="book-author"/g) || []).length, 1);
    assert.strictEqual((out.body.match(/class="dynamic-book-description"/g) || []).length, 1);
  });

  await test("H/I/J/K: Stage 2A/2C/2D/2E first-byte behavior stays in place", async () => {
    const withDesc = await invoke("/book/217", async () => jsonResponse(200, [sampleBook()]));
    assert.match(withDesc.body, /<title>تارىخىمىزدىكى خاقانلار - قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
    assert.ok(withDesc.body.includes('<link rel="canonical" href="https://www.kutadgubilik.com/book/217">'));
    assert.match(withDesc.body, /<meta\s+name=["']robots["']\s+content=["']index,\s*follow["']/i);
    assert.ok(withDesc.body.includes('property="og:title" content="تارىخىمىزدىكى خاقانلار"'));
    assert.ok(withDesc.body.includes('property="og:url" content="https://www.kutadgubilik.com/book/217"'));
    assert.strictEqual(metaName(withDesc.body, "description"), "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.");
    const payload = jsonLd(withDesc.body);
    const bookNode = bookNodeOf(payload);
    assert.strictEqual(bookNode.description, "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.");
    assert.ok(payload["@graph"].some((node) => node["@type"] === "BreadcrumbList"));
    assert.match(withDesc.body, /<div class="book-detail-info">\s*<h1>تارىخىمىزدىكى خاقانلار<\/h1>/);
    assert.match(withDesc.body, /<div class="book-author">ئاپتورى: نۇرۇللا مۇئمىن يۇلغۇن<\/div>/);
    assert.match(withDesc.body, /alt="تارىخىمىزدىكى خاقانلار كىتاب مۇقاۋىسى"/);
    assert.match(withDesc.body, /<section class="dynamic-book-description">/);
    assert.match(withDesc.body, /<p>تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش\.<\/p>/);
    assert.ok(withDesc.body.includes(ICON));
    assert.strictEqual((withDesc.body.match(/rel=["']icon["']/gi) || []).length, 1);

    const noDesc = await invoke("/book/217", async () => jsonResponse(200, [sampleBook({ description: "" })]));
    assert.match(noDesc.body, /<section class="dynamic-book-description" hidden>/);
    assert.doesNotMatch(noDesc.body, /<p>ئاپتور:/);
    const fallback = metaName(noDesc.body, "description");
    assert.match(fallback, /تارىخىمىزدىكى خاقانلار/);
    assert.match(fallback, /ئاپتور: نۇرۇللا مۇئمىن يۇلغۇن/);
    assert.match(fallback, /قۇتادغۇبىلىك كىتابخانىسى/);
    const noDescLd = bookNodeOf(jsonLd(noDesc.body));
    assert.strictEqual(noDescLd.description, fallback);
  });

  await test("L: missing book stays 404 noindex without book-meta leak", async () => {
    const missing = await invoke("/book/999999999", async () => jsonResponse(200, []));
    assert.strictEqual(missing.status, 404);
    assert.match(missing.body, /noindex/i);
    assert.doesNotMatch(missing.body, /kutadguBookSchema/);
    assert.doesNotMatch(missing.body, /class="book-meta"/);
    assert.doesNotMatch(missing.body, /book-meta-row/);
  });

  await test("M: public select stays read-only and protected files stay frozen", () => {
    const url = publicBook.publicBookLookupUrl("217");
    assert.ok(url.includes("is_active=eq.true"));
    assert.doesNotMatch(url, /select=\*/);
    assert.doesNotMatch(url, /submission_status|sales_count|legacy_id|is_kutadgu_admin/);
    const cols = publicBook.PUBLIC_SEO_SELECT.split(",");
    [
      "translator",
      "pages",
      "cover_type",
      "book_size",
      "interior_print_type",
      "is_color_print"
    ].forEach((col) => assert.ok(cols.includes(col), col));
    assert.ok(!cols.includes("language"));
    assert.ok(!cols.includes("publish_date"));
    const src = fs.readFileSync(path.join(root, "kutadgu-public-book.js"), "utf8")
      + fs.readFileSync(path.join(root, "api/book-public.js"), "utf8");
    assert.doesNotMatch(src, /service_role/i);
    assert.doesNotMatch(src, /\.insert\(|\.update\(|\.delete\(/);
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
      "api/book-public.js",

      "favorites.js"
    ].forEach((rel) => {
      assert.ok(!files.includes(rel), rel);
    });
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " SEO 2F first-byte book detail test(s) failed");
    process.exit(1);
  }
  console.log("stage-seo-2f-first-byte-book-details-tests ok");
});
