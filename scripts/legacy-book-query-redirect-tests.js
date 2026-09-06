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

function numericQueryRewrite(source) {
  return (vercel.rewrites || []).find((rule) => (
    rule.source === source
    && rule.destination === "/api/legacy-book-redirect"
    && Array.isArray(rule.has)
    && rule.has[0]
    && rule.has[0].type === "query"
    && rule.has[0].key === "id"
    && rule.has[0].value === "\\d+"
  ));
}

function rewriteIndex(predicate) {
  return (vercel.rewrites || []).findIndex(predicate);
}

function locationHasIdQuery(location) {
  return /(?:\?|&)id=/.test(String(location || ""));
}

async function invokeRedirect(url) {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end() {}
  };
  await handler({ url }, res);
  return res;
}

async function run() {
  await test("physical book.html is gone so Vercel rewrites can reach the 308 helper", () => {
    assert.ok(!fs.existsSync(path.join(root, "book.html")), "book.html must not exist; Vercel serves files before rewrites");
    assert.ok(fs.existsSync(path.join(root, "book-shell.html")));
    assert.ok(!(vercel.redirects || []).some((rule) => rule.destination === "/book/:id"));
  });

  await test("numeric legacy query rewrites to the helper before the detail shell", () => {
    const html = numericQueryRewrite("/book.html");
    const bare = numericQueryRewrite("/book");
    assert.ok(html, "/book.html?id=<digits> must rewrite to /api/legacy-book-redirect");
    assert.ok(bare, "/book?id=<digits> must rewrite to /api/legacy-book-redirect");
    const htmlIdx = rewriteIndex((rule) => rule.source === "/book.html" && rule.destination === "/api/legacy-book-redirect");
    const htmlShellIdx = rewriteIndex((rule) => rule.source === "/book.html" && rule.destination === "/book-shell.html");
    const bareIdx = rewriteIndex((rule) => rule.source === "/book" && rule.destination === "/api/legacy-book-redirect");
    const pathIdx = rewriteIndex((rule) => rule.source === "/book/:id");
    const shellIdx = rewriteIndex((rule) => rule.source === "/book" && rule.destination === "/book-shell.html");
    assert.ok(htmlIdx >= 0 && htmlIdx < htmlShellIdx);
    assert.ok(bareIdx >= 0 && pathIdx >= 0 && pathIdx < shellIdx);
    assert.ok(bareIdx < shellIdx);
    const clean = (vercel.rewrites || []).find((rule) => rule.source === "/book/:id");
    assert.strictEqual(clean.destination, "/book-shell.html");
    assert.strictEqual(
      (vercel.redirects || []).filter((rule) => rule.source === "/book.html").length,
      0
    );
  });

  await test("numeric ID matching is strict and non-numeric book.html is not rewritten to the helper", () => {
    assert.ok(/^\d+$/.test("106"));
    assert.ok(!/^\d+$/.test(""));
    assert.ok(!/^\d+$/.test("abc"));
    assert.ok(!/^\d+$/.test("12.5"));
    assert.ok(!/^\d+$/.test("children-3"));
    assert.ok(!/^\d+$/.test("106a"));
    const html = numericQueryRewrite("/book.html");
    assert.strictEqual(html.has[0].value, "\\d+");
    assert.ok(!(vercel.redirects || []).some((rule) => rule.source === "/book.html"));
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "" }), "");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=" }), "");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=abc" }), "");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book.html", search: "?id=106" }), "/book/106");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book", search: "?id=106" }), "/book/106");
    assert.strictEqual(seo.legacyBookRedirectPath({ pathname: "/book/106", search: "" }), "");
  });

  await test("helper Location is exactly /book/106 and never keeps id as query", async () => {
    const html = await invokeRedirect("/book.html?id=106");
    assert.strictEqual(html.statusCode, 308);
    assert.strictEqual(html.headers.location, "/book/106");
    assert.ok(!locationHasIdQuery(html.headers.location));

    const bare = await invokeRedirect("/book?id=106");
    assert.strictEqual(bare.statusCode, 308);
    assert.strictEqual(bare.headers.location, "/book/106");
    assert.ok(!locationHasIdQuery(bare.headers.location));

    const utm = await invokeRedirect("/book.html?id=106&utm_source=test");
    assert.strictEqual(utm.statusCode, 308);
    assert.strictEqual(utm.headers.location, "/book/106?utm_source=test");
    assert.ok(!locationHasIdQuery(utm.headers.location));

    const api = await invokeRedirect("/api/legacy-book-redirect?id=106&utm_source=test");
    assert.strictEqual(api.statusCode, 308);
    assert.strictEqual(api.headers.location, "/book/106?utm_source=test");
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("All legacy book query redirect tests passed");
}

run();
