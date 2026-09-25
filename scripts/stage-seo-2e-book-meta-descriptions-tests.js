#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const seo = require("../kutadgu-book-seo.js");
const handler = require("../api/book-public.js");

const ICON = '<link rel="icon" type="image/png" href="/kutadgu-logo.png">';
const STORE = "قۇتادغۇبىلىك كىتابخانىسى";

const FROZEN = {
  "shop.js": "536334e5b0a5d6ba364fb1326a6a388023a68da1cada1d1d09ba9215ef2d7916",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
  "book-shell.html": "685b3d7e3065d832f4922f6268c1cfbf7a2eb1325a443598cb3946ab86184aac",
  "index.html": "caee90498fc0ef3f6c128efe6b915559a59be659d9f1264e2bc4521c5c5fbc4d",
  "home-hero-content.js": "dddb9141d6b06414b44577524473dd48d28a7021f64abfcbac5c3f6ce0ad023b",
  "vercel.json": "80ccb08cc43391f2bc7d230fbe785b817fc02446a41097be1a1e7dacc2c4adc6"
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
  await test("A: real catalog description remains the meta description source", () => {
    const book = {
      title: "يەر ئانا",
      author: "چىڭغىز ئايتماتوۋ",
      description: "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.",
      category: "رومان",
      publisher: "مىللەتلەر نەشرىياتى",
      publishYear: "1970"
    };
    assert.strictEqual(seo.metaDescription(book), "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.");
    assert.doesNotMatch(seo.metaDescription(book), /ئاپتور:/);
    assert.doesNotMatch(seo.metaDescription(book), /تۈرى:/);
  });

  await test("B: missing description builds a factual Uyghur fallback", () => {
    const text = seo.metaDescription({
      title: "يەر ئانا",
      author: "چىڭغىز ئايتماتوۋ",
      description: "   ",
      category: "رومان",
      publisher: "مىللەتلەر نەشرىياتى",
      publishYear: "1970"
    });
    assert.match(text, /^يەر ئانا — /);
    assert.match(text, /ئاپتور: چىڭغىز ئايتماتوۋ/);
    assert.match(text, /تۈرى: رومان/);
    assert.match(text, /نەشرىيات: مىللەتلەر نەشرىياتى/);
    assert.match(text, /نەشر يىلى: 1970/);
    assert.match(text, /قۇتادغۇبىلىك كىتابخانىسى/);
    assert.doesNotMatch(text, /best book|recommended|ئەڭ ياخشى/i);
    assert.ok(text.length >= 80);
    assert.ok(text.length <= 170);
  });

  await test("C: missing optional fields omit labels and junk tokens", () => {
    const text = seo.metaDescription({
      title: "كىتاب",
      author: "",
      description: "",
      category: "—",
      publisher: "undefined",
      publishYear: "999"
    });
    assert.strictEqual(text, `كىتاب — ${STORE}`);
    assert.doesNotMatch(text, /undefined|null/i);
    assert.doesNotMatch(text, /ئاپتور:/);
    assert.doesNotMatch(text, /تۈرى:/);
    assert.doesNotMatch(text, /نەشرىيات:/);
    assert.doesNotMatch(text, /نەشر يىلى:/);
    assert.doesNotMatch(text, /\.\s*\./);
    assert.doesNotMatch(text, /:\s*[\.،]/);
  });

  await test("D: placeholder authors are not emitted", () => {
    ["—", "ئاپتور ئىسمى", ""].forEach((author) => {
      const text = seo.metaDescription({
        title: "يەر ئانا",
        author,
        description: "",
        category: "رومان"
      });
      assert.doesNotMatch(text, /ئاپتور:/, author);
      assert.doesNotMatch(text, /ئاپتور ئىسمى/);
      assert.match(text, /يەر ئانا/);
      assert.match(text, /تۈرى: رومان/);
    });
  });

  await test("E: different books produce different fallback descriptions", () => {
    const a = seo.metaDescription({
      title: "يەر ئانا",
      author: "چىڭغىز ئايتماتوۋ",
      description: "",
      category: "رومان"
    });
    const b = seo.metaDescription({
      title: "ئىز",
      author: "ئابدۇرېھىم ئۆتكۈر",
      description: "",
      category: "شېئىرلار"
    });
    assert.notStrictEqual(a, b);
    assert.match(a, /يەر ئانا/);
    assert.match(b, /ئىز/);
  });

  await test("F: hostile catalog strings cannot break the meta tag", async () => {
    const row = sampleBook({
      id: 9,
      title: 'كىتاب " & <script>',
      author: 'ئاپتور "onmouseover=alert(1)"',
      description: "",
      category: "</h1><script>alert(1)</script>",
      publisher: 'نەشرىيات & "quote"',
      publish_year: "2020"
    });
    const out = await invoke("/book/9", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    const meta = metaName(out.body, "description");
    assert.ok(meta);
    assert.ok(meta.includes("&lt;script&gt;") || meta.includes("&lt;"));
    assert.doesNotMatch(out.body, /<meta name="description"[^>]*<script>/i);
    assert.doesNotMatch(out.body, /<script>alert\(1\)<\/script>/);
    assert.ok(meta.includes("&quot;") || meta.includes("&amp;"));
    assert.match(out.body, /<div class="book-detail-info">\s*<h1>/);
    assert.doesNotMatch(out.body, /<section class="dynamic-book-description"[^>]*>\s*<h2>كىتاب ھەققىدە<\/h2>\s*<p>[^<]/);
    const bookNode = bookNodeOf(jsonLd(out.body));
    assert.strictEqual(bookNode.description, seo.metaDescription({
      title: row.title,
      author: row.author,
      description: "",
      category: row.category,
      publisher: row.publisher,
      publishYear: row.publish_year
    }));
    assert.doesNotMatch(bookNode.description, /دانە|ئېتىبار|ئەرزان|ھەقسىز يەتكۈزۈش/);
  });

  await test("G: Stage 2A/2C/2D first-byte behavior stays in place", async () => {
    const row = sampleBook();
    const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assert.ok(out.body.includes('<link rel="canonical" href="https://www.kutadgubilik.com/book/217">'));
    assert.match(out.body, /<meta\s+name=["']robots["']\s+content=["']index,\s*follow["']/i);
    assert.ok(out.body.includes('property="og:title" content="تارىخىمىزدىكى خاقانلار"'));
    assert.ok(out.body.includes('property="og:url" content="https://www.kutadgubilik.com/book/217"'));
    assert.strictEqual(metaName(out.body, "description"), "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.");
    assert.ok(out.body.includes('property="og:description" content="تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش."'));
    const payload = jsonLd(out.body);
    const bookNode = bookNodeOf(payload);
    assert.strictEqual(bookNode.description, "تارىخىي رومان ھەققىدە قىسقىچە چۈشەندۈرۈش.");
    assert.ok(payload["@graph"].some((node) => node["@type"] === "BreadcrumbList"));
    assert.ok(out.body.includes(ICON));
    assert.strictEqual((out.body.match(/rel=["']icon["']/gi) || []).length, 1);
    assert.match(out.body, /<div class="book-detail-info">\s*<h1>تارىخىمىزدىكى خاقانلار<\/h1>/);
    assert.match(out.body, /<section class="dynamic-book-description">/);
    const missing = await invoke("/book/999999999", async () => jsonResponse(200, []));
    assert.strictEqual(missing.status, 404);
    assert.match(missing.body, /noindex/i);
    assert.doesNotMatch(missing.body, /kutadguBookSchema/);
  });

  await test("H: protected product files stay frozen", () => {
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
      "book-shell.html",
      "index.html",

      "favorites.js",
      "member.js"
    ].forEach((rel) => {
      assert.ok(!files.includes(rel), rel);
    });
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " SEO 2E meta description test(s) failed");
    process.exit(1);
  }
  console.log("stage-seo-2e-book-meta-descriptions-tests ok");
});
