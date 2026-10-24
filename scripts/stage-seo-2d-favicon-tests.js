#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const handler = require("../api/book-public.js");

const ICONS = [
  '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
  '<link rel="icon" type="image/png" href="/kutadgu-favicon-32.png" sizes="32x32">',
  '<link rel="apple-touch-icon" type="image/png" href="/kutadgu-apple-touch-icon.png" sizes="180x180">'
];
const HOME_TITLE = "قۇتادغۇبىلىك كىتابخانىسى";
const HOME_SNIPPET = "قۇتادغۇبىلىك كىتابخانىسى — ئۇيغۇرچە كىتابلار، ئەدەبىيات، تارىخ، دىن، تەربىيە ۋە پەن-مائارىپقا دائىر نادىر ئەسەرلەرنى بىر يەردىن تېپىش ۋە زاكاز قىلىشقا بولىدىغان ئىشەنچلىك كىتابخانا.";

const LOGO = {
  "kutadgu-logo.png": "ca0afbb2b5f4a7552073520c13215cfbf4254eb5a81eca7ac0b53b10f6e777c9",
  "kutadgu-logo.webp": "56c2df5da45f9fb41c880b502183173d3cb71f52f0f21f5d1fcc990804b2081a"
};

const FROZEN = {
  "shop.js": "b936827448e092e7f22dcd74237a13a45e7b89283f8ad0d715d7ef328e304e38",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "kutadgu-ai-search.js": "e336cdeb44545592f3a4325bd83ff4204341e0f565e298c5c4c576d70c3c15a8",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147",
  "api/book-public.js": "95ad0b3468e160f5f8571d8ed838b61d917bb08c77991ce47062c9c96860df57",
  "home-hero-content.js": "321456761d14ebc084304539d81dc24e666a637e488e3e8014491c937dce064a",
  "vercel.json": "b423a3edf3d199d8b3703dade4dc355b3124a3a9b0e93ab1e724acd69c6b63a7"
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

function assertIcons(html) {
  const head = headOf(html);
  ICONS.forEach((tag) => assert.ok(head.includes(tag), tag));
  assert.strictEqual(iconCount(html), 2);
  assert.strictEqual(iconCount(head), 2);
  assert.strictEqual((html.match(/rel=["']apple-touch-icon["']/gi) || []).length, 1);
  assert.doesNotMatch(html, /rel=["']shortcut icon["']/i);
  assert.doesNotMatch(html, /maskable/i);
}

function pngSize(buf) {
  assert.strictEqual(buf.slice(0, 8).toString("binary"), "\x89PNG\r\n\x1a\n");
  assert.strictEqual(buf.toString("ascii", 12, 16), "IHDR");
  assert.strictEqual(buf.readUInt8(25), 6);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webpSize(buf) {
  assert.strictEqual(buf.toString("ascii", 0, 4), "RIFF");
  assert.strictEqual(buf.toString("ascii", 8, 12), "WEBP");
  const kind = buf.toString("ascii", 12, 16);
  if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (kind === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error("unexpected webp chunk " + kind);
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
  await test("homepage head declares the favicon, png icon, and apple touch icon", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assertIcons(html);
    assert.doesNotMatch(html, /href=["']kutadgu-logo\.png["']/);
    assert.doesNotMatch(html, /href=["']\/kutadgu-logo\.png\?/);
    const png = fs.readFileSync(path.join(root, "kutadgu-logo.png"));
    assert.deepStrictEqual(pngSize(png), { width: 1254, height: 1254 });
  });

  await test("book-shell first HTML uses the same icon links", () => {
    const html = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
    assertIcons(html);
    assert.doesNotMatch(html, /href=["']kutadgu-logo\.png["']/);
  });

  await test("found book first-byte HTML keeps favicon and Stage 2A/2C head and body", async () => {
    const row = sampleBook();
    const out = await invoke("/book/217", async () => jsonResponse(200, [row]));
    assert.strictEqual(out.status, 200);
    assertIcons(out.body);
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

  await test("small derivatives and the icon file decode at their declared sizes", () => {
    assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(root, "kutadgu-logo-128.png"))), { width: 128, height: 128 });
    assert.deepStrictEqual(webpSize(fs.readFileSync(path.join(root, "kutadgu-logo-128.webp"))), { width: 128, height: 128 });
    assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(root, "kutadgu-favicon-32.png"))), { width: 32, height: 32 });
    assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(root, "kutadgu-apple-touch-icon.png"))), { width: 180, height: 180 });
    assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(root, "kutadgu-icon-192.png"))), { width: 192, height: 192 });
    assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(root, "kutadgu-icon-512.png"))), { width: 512, height: 512 });
    const ico = fs.readFileSync(path.join(root, "favicon.ico"));
    assert.strictEqual(ico.readUInt16LE(0), 0);
    assert.strictEqual(ico.readUInt16LE(2), 1);
    assert.strictEqual(ico.readUInt16LE(4), 3);
    [16, 32, 48].forEach((size, index) => {
      const at = 6 + index * 16;
      assert.strictEqual(ico.readUInt8(at), size);
      assert.strictEqual(ico.readUInt8(at + 1), size);
      const bytes = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      assert.deepStrictEqual(pngSize(ico.subarray(offset, offset + bytes)), { width: size, height: size });
    });
  });

  await test("category, cart, branded 404, and generated book errors share the icon links", () => {
    ["romanlar.html", "cart.html", "404.html"].forEach((rel) => {
      assertIcons(fs.readFileSync(path.join(root, rel), "utf8"));
    });
    const generated = fs.readFileSync(path.join(root, "kutadgu-public-book.js"), "utf8");
    ICONS.forEach((tag) => assert.strictEqual(generated.split(tag).length - 1, 2, tag));
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
    console.error("\n" + failed + " SEO 2D favicon test(s) failed");
    process.exit(1);
  }
  console.log("stage-seo-2d-favicon-tests ok");
});
