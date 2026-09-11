#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const seo = require("../kutadgu-book-seo.js");
const publicBook = require("../kutadgu-public-book.js");
const handler = require("../api/book-public.js");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const bookShell = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");

let failed = 0;
function test(name, fn) {
  const run = fn && fn.constructor && fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  });
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function fakeDocument() {
  return {
    head: {
      nodes: [],
      querySelector(selector) {
        if (selector === 'meta[name="robots"]') return this.nodes.find((n) => n.name === "robots") || null;
        if (selector === 'link[rel="canonical"]') return this.nodes.find((n) => n.rel === "canonical") || null;
        if (selector === "#kutadguBookSchema") return this.nodes.find((n) => n.id === "kutadguBookSchema") || null;
        return null;
      },
      createElement(tagName) {
        return {
          tagName,
          name: "",
          rel: "",
          content: "",
          href: "",
          id: "",
          parentNode: null,
          setAttribute(k, v) { this[k] = v; }
        };
      },
      appendChild(node) {
        node.parentNode = this;
        this.nodes.push(node);
      }
    }
  };
}

function readSeoState(doc) {
  const robots = doc.head.querySelector('meta[name="robots"]');
  const canonical = doc.head.querySelector('link[rel="canonical"]');
  return {
    robots: robots ? robots.content : "",
    canonical: canonical ? canonical.href : ""
  };
}

function simulateDecorateSeo({ pathname, search, pageBookHydrationDone, book, visible }) {
  const location = { pathname, search: search || "" };
  const documentRef = fakeDocument();
  if (seo.shouldDeferNumericCleanDetailSeo(location, { pageBookHydrationDone })) {
    return readSeoState(documentRef);
  }
  const b = book;
  if (!b || (!visible && !(b && b.isRemote === true))) {
    if (seo.shouldApplyUnresolvedDetailSeo(location)) seo.applyUnresolvedDetailDocument(documentRef);
    return readSeoState(documentRef);
  }
  const indexable = !!visible && /^\d+$/.test(String(b.id || "").trim());
  const canonical = seo.bookCanonicalUrl(b.id);
  const robotsNode = documentRef.head.createElement("meta");
  robotsNode.setAttribute("name", "robots");
  robotsNode.setAttribute("content", indexable ? "index, follow" : "noindex, follow");
  documentRef.head.appendChild(robotsNode);
  const link = documentRef.head.createElement("link");
  link.setAttribute("rel", "canonical");
  link.setAttribute("href", canonical);
  documentRef.head.appendChild(link);
  return readSeoState(documentRef);
}

function jsonResponse(status, body) {
  return { status, async json() { return body; } };
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

async function invokeBookPublic(url, fetchImpl) {
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

async function run() {
  await test("A: valid numeric clean URL does not get temporary noindex while hydration is pending", () => {
    const pending = simulateDecorateSeo({
      pathname: "/book/108",
      pageBookHydrationDone: false,
      book: null,
      visible: false
    });
    assert.strictEqual(pending.robots, "");
    assert.strictEqual(pending.canonical, "");
    assert.ok(!seo.shouldApplyUnresolvedDetailSeo({ pathname: "/book/108" }));
    assert.ok(seo.shouldDeferNumericCleanDetailSeo({ pathname: "/book/108" }, { pageBookHydrationDone: false }));
    assert.ok(!seo.shouldDeferNumericCleanDetailSeo({ pathname: "/book/108" }, { pageBookHydrationDone: true }));
  });

  await test("shop.js defers decorateDetail SEO until numeric page-book hydration finishes", () => {
    const hydrate = sliceBetween(shop, "let pageBookHydrationDone=false;", "function resolveStoredBookId(id){");
    assert.match(hydrate, /finally\{\s*pageBookHydrationDone=true;/);
    const decorate = sliceBetween(shop, "function decorateDetail(){", "function bindDynamicActions(");
    assert.match(decorate, /shouldDeferNumericCleanDetailSeo/);
    assert.match(decorate, /pageBookHydrationDone/);
    assert.match(decorate, /paintUnauthorizedDetail\(\)/);
    const paint = sliceBetween(shop, "function paintUnauthorizedDetail(){", "function decorateDetail(){");
    assert.match(paint, /shouldApplyUnresolvedDetailSeo/);
    assert.match(paint, /applyUnresolvedDetailDocument/);
  });

  await test("B: valid numeric book ends with index, follow and /book/<id> canonical", () => {
    const done = simulateDecorateSeo({
      pathname: "/book/108",
      pageBookHydrationDone: true,
      book: { id: "108", title: "Test", isRemote: true },
      visible: true
    });
    assert.strictEqual(done.robots, "index, follow");
    assert.strictEqual(done.canonical, "https://www.kutadgubilik.com/book/108");
    assert.match(shop, /indexable\?"index, follow":"noindex, follow"/);
    assert.match(shop, /isStorefrontVisible\(book\)&&\/\^\\d\+\$\/\.test/);
    assert.ok(shop.includes("updateBookSeo(b)"));
  });

  await test("C: genuinely missing/inactive numeric books remain noindex", async () => {
    const found = await invokeBookPublic("/book/108", async () => jsonResponse(200, [{ id: 108 }]));
    assert.strictEqual(found.status, 200);
    assert.ok(found.body.includes('<link rel="canonical" href="https://www.kutadgubilik.com/book/108">'));
    assert.match(found.body, /<meta\s+name=["']robots["']\s+content=["']index, follow["']>/i);
    assert.strictEqual((found.body.match(/rel=["']canonical["']/gi) || []).length, 1);
    assert.ok(found.body.includes("data-dynamic-book"));
    assert.ok(!found.body.includes("كىتاب تېپىلمىدى"));

    const missing = await invokeBookPublic("/book/999999999", async () => jsonResponse(200, []));
    assert.strictEqual(missing.status, 404);
    assert.match(missing.body, /noindex/i);
    assert.ok(!missing.body.includes("kutadguBookSchema"));
    assert.ok(!missing.body.includes("https://www.kutadgubilik.com/book/999999999"));
    assert.doesNotMatch(missing.body, /content=["']index, follow["']/i);

    const hiddenLookup = await publicBook.lookupPublicNumericBook("12", {
      fetchImpl: async () => jsonResponse(200, [])
    });
    assert.strictEqual(hiddenLookup.outcome, "missing");

    const inactive = simulateDecorateSeo({
      pathname: "/book/12",
      pageBookHydrationDone: true,
      book: { id: "12", title: "Hidden", isRemote: true, isActive: false },
      visible: false
    });
    assert.strictEqual(inactive.robots, "noindex, follow");
    assert.strictEqual(inactive.canonical, "https://www.kutadgubilik.com/book/12");
    assert.ok(!inactive.canonical.endsWith("/book.html"));
  });

  await test("D: bare /book and unresolved legacy cases keep noindex + /book.html canonical", () => {
    for (const loc of [
      { pathname: "/book", search: "" },
      { pathname: "/book.html", search: "" },
      { pathname: "/book/children-3", search: "" },
      { pathname: "/book.html", search: "?id=children-3" }
    ]) {
      assert.ok(seo.shouldApplyUnresolvedDetailSeo(loc), JSON.stringify(loc));
      assert.ok(!seo.shouldDeferNumericCleanDetailSeo(loc, { pageBookHydrationDone: false }), JSON.stringify(loc));
      const state = simulateDecorateSeo({
        pathname: loc.pathname,
        search: loc.search,
        pageBookHydrationDone: false,
        book: null,
        visible: false
      });
      assert.strictEqual(state.robots, "noindex, follow", JSON.stringify(loc));
      assert.strictEqual(state.canonical, "https://www.kutadgubilik.com/book.html", JSON.stringify(loc));
    }
    assert.strictEqual(seo.numericCleanBookIdFromLocation({ pathname: "/book/108", search: "?id=99" }), "108");
    assert.strictEqual(seo.numericCleanBookIdFromLocation({ pathname: "/book.html", search: "?id=108" }), "");
  });

  await test("E: book-shell first byte stays free of robots/canonical; cache pins bumped", () => {
    assert.ok(!/meta[^>]*name=["']robots["']/i.test(bookShell));
    assert.ok(!/rel=["']canonical["']/i.test(bookShell));
    assert.ok(!bookShell.includes("noindex"));
    assert.match(bookShell, /kutadgu-book-seo\.js\?v=4/);
    assert.match(bookShell, /shop\.js\?v=122/);
    assert.match(shop, /applyUnresolvedDetailDocument/);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " failed");
    process.exit(1);
  }
  console.log("\nbook-detail-seo-hydration-race-tests ok");
});
