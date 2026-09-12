"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pagePath = path.join(root, "404.html");
const vercelPath = path.join(root, "vercel.json");

const EXPECTED_REWRITE_SOURCES = [
  "/sitemap.xml",
  "/sitemap-books.xml",
  "/sitemap-books-:page(\\d+).xml",
  "/adabiyat",
  "/romanlar",
  "/tarikhiy-romanlar",
  "/sheirlar",
  "/hekayiler",
  "/dastanlar",
  "/dunya-edebiyati",
  "/adabiyat-roman",
  "/uyghur-adabiyati",
  "/universal",
  "/tibb",
  "/derslik",
  "/terbiye",
  "/dini",
  "/children",
  "/dictionary",
  "/grammar",
  "/books",
  "/order-info",
  "/privacy",
  "/returns",
  "/book.html",
  "/book",
  "/book/:id(\\d+)",
  "/book/:id",
  "/book.html",
  "/book",
  "/kbg/static/:path*",
  "/kbg/array/:path*",
  "/kbg/:path*",
];

function test(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

const html = fs.readFileSync(pagePath, "utf8");
const vercel = JSON.parse(fs.readFileSync(vercelPath, "utf8"));

test("404.html exists at the storefront root", () => {
  assert.ok(fs.existsSync(pagePath));
});

test("html language is Uyghur and direction is RTL", () => {
  assert.match(html, /<html\b[^>]*\blang="ug"/i);
  assert.match(html, /<html\b[^>]*\bdir="rtl"/i);
});

test("has a clear title", () => {
  assert.match(html, /<title>\s*404[^<]*<\/title>/i);
});

test("visible 404 and Uyghur not-found copy exist", () => {
  assert.match(html, />\s*404\s*</);
  assert.ok(html.includes("بۇ بەت تېپىلمىدى"));
  assert.ok(html.includes("سىز ئىزدىگەن بەت مەۋجۇت ئەمەس ياكى يۆتكەلگەن بولۇشى مۇمكىن."));
});

test("a normal link back to / exists", () => {
  assert.match(html, /<a\b[^>]*\bhref="\/"/);
  assert.ok(html.includes("باش بەتكە قايتىش"));
});

test("robots is noindex,follow", () => {
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="noindex,follow"\s*>/i
  );
});

test("there is no meta refresh and no JavaScript", () => {
  assert.doesNotMatch(html, /http-equiv\s*=\s*["']?refresh/i);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /\bon[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test("does not load storefront app, auth, cart, or order scripts", () => {
  const forbidden = [
    "shop.js",
    "supabase",
    "kutadgu-auth",
    "kutadgu-cart",
    "kutadgu-order",
    "kutadgu-account",
    "admin",
  ];
  for (const token of forbidden) {
    assert.doesNotMatch(html, new RegExp(token, "i"), token);
  }
});

test("vercel.json has no catch-all rewrite", () => {
  const rewrites = vercel.rewrites || [];
  const catchAll = rewrites.filter((rule) => {
    const source = String(rule.source || "");
    return (
      source === "/(.*)" ||
      source === "/:path*" ||
      source === "/*" ||
      source === "/(.*)*" ||
      /404\.html$/i.test(String(rule.destination || ""))
    );
  });
  assert.deepStrictEqual(catchAll, []);
});

test("existing known route rewrites remain untouched", () => {
  const sources = (vercel.rewrites || []).map((rule) => rule.source);
  assert.deepStrictEqual(sources, EXPECTED_REWRITE_SOURCES);
  const bySource = (source, destination) =>
    (vercel.rewrites || []).find(
      (rule) => rule.source === source && rule.destination === destination
    );
  assert.ok(bySource("/adabiyat", "/adabiyat.html"));
  assert.ok(bySource("/books", "/books.html"));
  assert.ok(bySource("/book/:id(\\d+)", "/api/book-public?id=:id"));
  assert.ok(bySource("/book/:id", "/book-shell.html"));
  assert.ok(bySource("/book", "/book-shell.html"));
  assert.ok(
    bySource("/kbg/static/:path*", "https://eu-assets.i.posthog.com/static/:path*")
  );
  assert.ok(
    bySource("/kbg/array/:path*", "https://eu.i.posthog.com/array/:path*")
  );
  assert.ok(bySource("/kbg/:path*", "https://eu.i.posthog.com/:path*"));
});

console.log("l3-custom-404-page-tests: all passed");
