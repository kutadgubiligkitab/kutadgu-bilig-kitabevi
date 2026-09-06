#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const publicBook = require("../kutadgu-public-book.js");
const handler = require("../api/book-public.js");

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

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { if (body != null) this.chunks.push(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); }
  };
}

async function invoke(url, method, fetchImpl) {
  const orig = global.fetch;
  if (fetchImpl) global.fetch = fetchImpl;
  const res = mockRes();
  try {
    await handler({ url, method: method || "GET" }, res);
  } finally {
    if (fetchImpl) global.fetch = orig;
  }
  return {
    status: res.statusCode,
    location: res.headers.location || "",
    body: res.chunks.join(""),
    type: res.headers["content-type"] || ""
  };
}

function jsonResponse(status, body) {
  return {
    status,
    async json() { return body; }
  };
}

async function run() {
  await test("vercel rewrites numeric /book/:id to the public existence gate", () => {
    const numeric = (vercel.rewrites || []).find((rule) => rule.source === "/book/:id(\\d+)");
    const shell = (vercel.rewrites || []).find((rule) => rule.source === "/book/:id");
    assert.ok(numeric);
    assert.strictEqual(numeric.destination, "/api/book-public?id=:id");
    assert.ok(shell);
    assert.strictEqual(shell.destination, "/book-shell.html");
    const nIdx = (vercel.rewrites || []).findIndex((rule) => rule.source === "/book/:id(\\d+)");
    const sIdx = (vercel.rewrites || []).findIndex((rule) => rule.source === "/book/:id");
    assert.ok(nIdx < sIdx);
    assert.ok(fs.existsSync(path.join(root, "api/book-public.js")));
    assert.ok(fs.existsSync(path.join(root, "book-shell.html")));
  });

  await test("existence lookup uses anon public select=id and is_active=eq.true", () => {
    const url = publicBook.publicBookLookupUrl("106");
    assert.ok(url.includes("/rest/v1/books?"));
    assert.ok(url.includes("select=id"));
    assert.ok(url.includes("id=eq.106"));
    assert.ok(url.includes("is_active=eq.true"));
    assert.ok(!/service_role/i.test(url));
    assert.ok(!/select=\*/.test(url));
    const src = fs.readFileSync(path.join(root, "kutadgu-public-book.js"), "utf8")
      + fs.readFileSync(path.join(root, "api/book-public.js"), "utf8");
    assert.doesNotMatch(src, /service_role/i);
    assert.doesNotMatch(src, /service-role/i);
  });

  await test("found public row is found; empty or inactive filter miss is missing", async () => {
    const found = await publicBook.lookupPublicNumericBook("106", {
      fetchImpl: async () => jsonResponse(200, [{ id: 106 }])
    });
    assert.strictEqual(found.outcome, "found");
    const missing = await publicBook.lookupPublicNumericBook("999999999", {
      fetchImpl: async () => jsonResponse(200, [])
    });
    assert.strictEqual(missing.outcome, "missing");
    const hidden = await publicBook.lookupPublicNumericBook("12", {
      fetchImpl: async () => jsonResponse(200, [])
    });
    assert.strictEqual(hidden.outcome, "missing");
  });

  await test("backend failures are error, not missing", async () => {
    const timeout = await publicBook.lookupPublicNumericBook("106", {
      timeoutMs: 20,
      fetchImpl: (_url, init) => new Promise((_, reject) => {
        const signal = init && init.signal;
        if (!signal) return;
        const fail = () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      })
    });
    assert.strictEqual(timeout.outcome, "error");
    const boom = await publicBook.lookupPublicNumericBook("106", {
      fetchImpl: async () => jsonResponse(500, { message: "nope" })
    });
    assert.strictEqual(boom.outcome, "error");
    const net = await publicBook.lookupPublicNumericBook("106", {
      fetchImpl: async () => { throw new Error("offline"); }
    });
    assert.strictEqual(net.outcome, "error");
  });

  await test("handler GET/HEAD found=200, missing=404, failure=503", async () => {
    const foundGet = await invoke("/book/106", "GET", async () => jsonResponse(200, [{ id: 106 }]));
    assert.strictEqual(foundGet.status, 200);
    assert.ok(foundGet.body.includes("data-dynamic-book"));
    assert.ok(!foundGet.body.includes("كىتاب تېپىلمىدى"));

    const foundHead = await invoke("/api/book-public?id=106", "HEAD", async () => jsonResponse(200, [{ id: "106" }]));
    assert.strictEqual(foundHead.status, 200);
    assert.strictEqual(foundHead.body, "");

    const missingGet = await invoke("/book/999999999", "GET", async () => jsonResponse(200, []));
    assert.strictEqual(missingGet.status, 404);
    assert.ok(missingGet.body.includes("noindex"));
    assert.ok(missingGet.body.includes("كىتاب تېپىلمىدى"));
    assert.ok(!missingGet.body.includes("@type"));
    assert.ok(!missingGet.body.includes("kutadguBookSchema"));
    assert.ok(!/canonical[^>]+999999999/.test(missingGet.body));

    const missingHead = await invoke("/book/999999999", "HEAD", async () => jsonResponse(200, []));
    assert.strictEqual(missingHead.status, 404);
    assert.strictEqual(missingHead.body, "");

    const fail = await invoke("/book/106", "GET", async () => jsonResponse(503, { error: "x" }));
    assert.strictEqual(fail.status, 503);
    assert.notStrictEqual(fail.status, 404);
    assert.ok(fail.body.includes("ۋاقىتلىق خاتالىق"));
  });

  await test("legacy 308 rewrites remain in front of the existence gate", () => {
    const html = (vercel.rewrites || []).find((rule) => rule.source === "/book.html" && rule.destination === "/api/legacy-book-redirect");
    const bare = (vercel.rewrites || []).find((rule) => rule.source === "/book" && rule.destination === "/api/legacy-book-redirect");
    assert.ok(html && bare);
    const htmlIdx = (vercel.rewrites || []).findIndex((rule) => rule.source === "/book.html" && rule.destination === "/api/legacy-book-redirect");
    const numericIdx = (vercel.rewrites || []).findIndex((rule) => rule.source === "/book/:id(\\d+)");
    assert.ok(htmlIdx >= 0 && numericIdx > htmlIdx);
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("All public book status tests passed");
}

run();
