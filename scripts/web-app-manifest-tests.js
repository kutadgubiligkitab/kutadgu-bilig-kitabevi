#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const NAME = "قۇتادغۇبىلىك كىتابخانىسى";

function read(rel) {
  return fs.readFileSync(path.join(root, rel));
}

const manifest = JSON.parse(read("kutadgu.webmanifest").toString("utf8"));
const index = read("index.html").toString("utf8");
const png = read("kutadgu-logo.png");

assert.strictEqual(manifest.id, "/");
assert.strictEqual(manifest.name, NAME);
assert.strictEqual(manifest.short_name, NAME);
assert.strictEqual(manifest.start_url, "/");
assert.strictEqual(manifest.scope, "/");
assert.strictEqual(manifest.display, "standalone");
assert.strictEqual(manifest.lang, "ug");
assert.strictEqual(manifest.dir, "rtl");
assert.strictEqual(manifest.background_color, "#f6f0e5");
assert.strictEqual(manifest.theme_color, "#4b3327");
assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, "orientation"), false);
assert.deepStrictEqual(manifest.icons, [
  { src: "/kutadgu-icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/kutadgu-icon-512.png", sizes: "512x512", type: "image/png" }
]);
assert.ok(!/maskable|sizes"\s*:\s*"any"|serviceWorker|beforeinstallprompt/i.test(JSON.stringify(manifest)));

assert.strictEqual(png.toString("ascii", 12, 16), "IHDR");
assert.strictEqual(png.readUInt32BE(16), 1254);
assert.strictEqual(png.readUInt32BE(20), 1254);
assert.strictEqual(crypto.createHash("sha256").update(png).digest("hex"), "ca0afbb2b5f4a7552073520c13215cfbf4254eb5a81eca7ac0b53b10f6e777c9");

assert.strictEqual((index.match(/rel="manifest"/g) || []).length, 1);
assert.ok(index.includes('<link rel="manifest" href="/kutadgu.webmanifest">'));
assert.strictEqual((index.match(/rel="icon"/g) || []).length, 2);
assert.strictEqual((index.match(/rel="apple-touch-icon"/g) || []).length, 1);
function pngSize(name, width) {
  const body = read(name);
  assert.strictEqual(body.toString("ascii", 12, 16), "IHDR");
  assert.strictEqual(body.readUInt32BE(16), width);
  assert.strictEqual(body.readUInt32BE(20), width);
}
pngSize("kutadgu-icon-192.png", 192);
pngSize("kutadgu-icon-512.png", 512);
assert.match(index, /shop\.js\?v=[1-9]\d*/);
assert.ok(!/serviceWorker|beforeinstallprompt/i.test(index));
assert.ok(!read("shop.js").toString("utf8").includes("serviceWorker.register"));

console.log("web-app-manifest-tests ok");
