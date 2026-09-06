#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const seo = require("../kutadgu-book-seo.js");
const handler = require("../api/legacy-book-redirect.js");

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed++;
    console.error("FAIL", name, err && err.message);
  });
}

function numericBookRedirect(source) {
  return (vercel.redirects || []).find((rule) => (
    rule.source === source
    && rule.destination === "/book/:id"
    && rule.permanent === true
    && Array.isArray(rule.has)
    && rule.has[0]
    && rule.has[0].type === "query"
    && rule.has[0].key === "id"
    && rule.has[0].value === "(?<id>\\d+)"
  ));
}

function matchesNumericId(value) {
  return new RegExp("^" + "(?<id>\\d+)" + "$").test(String(value == null ? "" : value));
}

async function run() {
  await test("numeric legacy book URLs are platform redirects, not static-file rewrites", () => {
    const html = numericBookRedirect("/book.html");
    const bare = numericBookRedirect("/book");
    assert.ok(html, "/book.html?id=<digits> must 308 via redirects");
    assert.ok(bare, "/book?id=<digits> must 308 via redirects");
    assert.ok(!(vercel.rewrites || []).some((rule) => rule.source === "/book.html"));
    assert.ok(!(vercel.rewrites || []).some((rule) => String(rule.destination || "").includes("legacy-book-redirect")));
    const clean = (vercel.rewrites || []).find((rule) => rule.source === "/book/:id");
    assert.ok(clean);
    assert.strictEqual(clean.destination, "/book.html");
    const shell = (vercel.rewrites || []).find((rule) => rule.source === "/book" && rule.destination === "/book.html");
    assert.ok(shell);
    const redirectIdx = (vercel.redirects || []).findIndex((rule) => rule.source === "/book.html");
    const indexIdx = (vercel.redirects || []).findIndex((rule) => rule.source === "/index.html");
    assert.ok(redirectIdx >= 0);
    assert.ok(indexIdx > redirectIdx, "book query redirects must be registered as redirects, before later static-file rules");
  });

  await test("numeric ID matching is strict and non-numeric book.html is not redirected", () => {
    assert.ok(matchesNumericId("106"));
    assert.ok(matchesNumericId("0"));
    assert.ok(!matchesNumericId(""));
    assert.ok(!matchesNumericId("abc"));
    assert.ok(!matchesNumericId("12.5"));
    assert.ok(!matchesNumericId("children-3"));
    assert.ok(!matchesNumericId("106a"));
    const blanket = (vercel.redirects || []).filter((rule) => rule.source === "/book.html" && !rule.has);
    assert.strictEqual(blanket.length, 0);
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "" }), "");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=" }), "");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=abc" }), "");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=106" }), "/book/106");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book", search: "?id=106" }), "/book/106");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book/106", search: "" }), "");
  });

  await test("platform redirects use named numeric capture to /book/:id (query extras may pass through)", () => {
    const html = numericBookRedirect("/book.html");
    assert.strictEqual(html.destination, "/book/:id");
    assert.ok(!String(html.destination).includes("?"));
  });

  await test("legacy-book-redirect helper remains for direct API use and extra query stripping", async () => {
    assert.ok(fs.existsSync(path.join(root, "api/legacy-book-redirect.js")));
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
      end() {}
    };
    await handler({ url: "/api/legacy-book-redirect?id=106&utm_source=test" }, res);
    assert.strictEqual(res.statusCode, 308);
    assert.strictEqual(res.headers.location, "/book/106?utm_source=test");
    assert.ok(!/[?&]id=/.test(res.headers.location.replace("utm_source=test", "")));
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("All legacy book query redirect tests passed");
}

run();
