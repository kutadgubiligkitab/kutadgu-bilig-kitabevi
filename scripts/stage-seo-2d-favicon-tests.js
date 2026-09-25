#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const handler = require("../api/book-public.js");

const ICON = '<link rel="icon" type="image/png" href="/kutadgu-logo.png">';
const HOME_TITLE = "قۇتادغۇبىلىك كىتابخانىسى";
const HOME_SNIPPET = "قۇتادغۇبىلىك كىتابخانىسى — ئۇيغۇرچە كىتابلار، ئەدەبىيات، تارىخ، دىن، تەربىيە ۋە پەن-مائارىپقا دائىر نادىر ئەسەرلەرنى بىر يەردىن تېپىش ۋە زاكاز قىلىشقا بولىدىغان ئىشەنچلىك كىتابخانا.";

const LOGO = {
  "kutadgu-logo.png": "ca0afbb2b5f4a7552073520c13215cfbf4254eb5a81eca7ac0b53b10f6e777c9",
  "kutadgu-logo.webp": "56c2df5da45f9fb41c880b502183173d3cb71f52f0f21f5d1fcc990804b2081a"
};

const FROZEN = {
  "shop.js": "99cf02a2501d90dc95fedeb21bf623b686fe1429e1dbaa4388275bec46761986",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "8a707bef59a78f276d445ed0a472eb531e1ed5f2633f9e5be8401ab5a02e6063",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
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

function headOf(html) {
  const match = String(html || "").match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  return match ? match[1] : "";
}

function iconCount(html) {
  return (String(html || "").match(/rel=["']icon["']/gi) || []).length;
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

async function run() {
  await test("homepage has exactly one first-byte favicon in head", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const head = headOf(html);
    assert.ok(head.includes(ICON));
    assert.strictEqual(iconCount(html), 1);
    assert.strictEqual(iconCount(head), 1);
    assert.doesNotMatch(html, /rel=["']shortcut icon["']/i);
    assert.doesNotMatch(html, /rel=["']apple-touch-icon["']/i);
    assert.doesNotMatch(html, /href=["']kutadgu-logo\.png["']/);
    assert.doesNotMatch(html, /href=["']\/kutadgu-logo\.png\?/);
    const png = fs.readFileSync(path.join(root, "kutadgu-logo.png"));
    assert.strictEqual(png.slice(0, 8).toString("binary"), "\x89PNG\r\n\x1a\n");
    assert.strictEqual(png.readUInt32BE(16), 1254);
    assert.strictEqual(png.readUInt32BE(20), 1254);
  });

  await test("book-shell first HTML has exactly one matching favicon", () => {
    const html = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
    const head = headOf(html);
    assert.ok(head.includes(ICON));
    assert.strictEqual(iconCount(html), 1);
    assert.strictEqual(iconCount(head), 1);
    assert.doesNotMatch(html, /rel=["']shortcut icon["']/i);
    assert.doesNotMatch(html, /href=["']kutadgu-logo\.png["']/);
  });

  await test("found book first-byte HTML keeps favicon and Stage 2A/2C head and body", async () => {
    const row = sampleBook();
    const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assert.ok(headOf(out.body).includes(ICON));
    assert.strictEqual(iconCount(out.body), 1);
    assert.match(out.body, /<title>تارىخىمىزدىكى خاقانلار - قۇتادغۇبىلىك كىتابخانىسى<\/title>/);
    assert.ok(out.body.includes('<link rel="canonical" href="https://www.kutadgubilik.com/book/217">'));
    assert.match(out.body, /<meta\s+name=["']robots["']\s+content=["']index,\s*follow["']/i);
    assert.strictEqual((out.body.match(/id=["']kutadguBookSchema["']/gi) || []).length, 1);
    assert.match(out.body, /<div class="book-detail-info">\s*<h1>تارىخىمىزدىكى خاقانلار<\/h1>/);
  });

  await test("homepage title canonical robots and JSON-LD stay unchanged", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const title = html.match(/<title>([^<]*)<\/title>/);
    assert.ok(title);
    assert.strictEqual(title[1], HOME_TITLE);
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.kutadgubilik\.com\/">/);
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.ok(html.includes(`<meta name="description" content="${HOME_SNIPPET}">`));
    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLd);
    const data = JSON.parse(jsonLd[1]);
    assert.ok(data["@graph"].some((n) => n["@type"] === "BookStore"));
    assert.ok(data["@graph"].some((n) => n["@type"] === "WebSite"));
  });

  await test("existing logo files stay unchanged and protected files stay frozen", () => {
    Object.keys(LOGO).forEach((rel) => {
      assert.strictEqual(sha256(rel), LOGO[rel], rel);
    });
    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(sha256(rel), FROZEN[rel], rel);
    });
    const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
      cwd: root,
      encoding: "utf8"
    });
    const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
    [
      "kutadgu-logo.png",
      "kutadgu-logo.webp",

      "kutadgu-search-rank.js",
      "kutadgu-ai-search.js",
      "api/ai-search.js",
      "api/book-public.js",
      "home-hero-content.js",

      "favorites.js",
      "member.js"
    ].forEach((rel) => {
      assert.ok(!files.includes(rel), rel);
    });
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " SEO 2D favicon test(s) failed");
    process.exit(1);
  }
  console.log("stage-seo-2d-favicon-tests ok");
});
