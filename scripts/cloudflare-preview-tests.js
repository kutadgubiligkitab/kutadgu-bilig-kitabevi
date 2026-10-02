#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const preview = require("../cloudflare/preview-dispatch.js");
const headers = require("../cloudflare/security-headers.js");
const images = require("../kutadgu-image-storage.js");
const upload = require("../cloudflare/r2-cover-upload.js");
const inventory = require("./r2-cover-inventory.js");
const copyVerify = require("./r2-cover-copy-verify.js");
const r2 = require("./r2-s3-client.js");
const previewDev = require("./cloudflare-preview-dev.js");
const publicBook = require("../kutadgu-public-book.js");
const listing = require("../kutadgu-category-listing.js");
const sitemap = require("../kutadgu-sitemap.js");
const seo = require("../kutadgu-book-seo.js");
const aiSearch = require("../kutadgu-ai-search.js");

const root = path.join(__dirname, "..");
const SUPABASE_IMAGE = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/106.webp";
const R2_IMAGE = "https://covers.example.com/book-covers/book/106.webp";
const SECRET = "r2-secret-must-not-leak";

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.stack || err);
  });
}

function httpResponse(status, body, extra) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headerMap = {};
  Object.keys(extra || {}).forEach((key) => { headerMap[String(key).toLowerCase()] = extra[key]; });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return headerMap[String(name).toLowerCase()] || null; } },
    json: async () => (typeof body === "string" ? JSON.parse(text) : body),
    text: async () => text,
    arrayBuffer: async () => Buffer.from(text),
    body: text
  };
}

function diskAsset(extra) {
  const map = extra || {};
  return async function readAsset(filePath) {
    if (Object.prototype.hasOwnProperty.call(map, filePath)) {
      return new Response(map[filePath], { status: 200 });
    }
    const rel = String(filePath || "").replace(/^\/+/, "");
    const abs = path.join(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) return new Response("missing", { status: 404 });
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response("missing", { status: 404 });
    return new Response(fs.readFileSync(abs), { status: 200 });
  };
}

function baseDeps(fetchImpl, extraAssets) {
  return {
    publicBook,
    listing,
    sitemap,
    seo,
    aiSearch,
    fetchImpl,
    readAsset: diskAsset(extraAssets)
  };
}

function request(url, method, body, headerList) {
  return new Request(url, { method: method || "GET", body, headers: headerList });
}

const bookRow = {
  id: "106",
  title: "سىناق كىتاب",
  author: "ئاپتور",
  description: "قىسقا چۈشەندۈرۈش يېتەرلىك.",
  image_url: SUPABASE_IMAGE,
  category: "رومان",
  publisher: "نەشر",
  isbn: "",
  price: 12,
  stock: 4,
  stock_status: "in",
  source: "romanlar.html",
  publish_year: "2020",
  translator: "",
  pages: "100",
  cover_type: "",
  book_size: "",
  interior_print_type: "",
  is_color_print: false
};

function catalogFetch(mode) {
  return async function fetchImpl(url) {
    const href = String(url);
    if (mode === "fail") throw new Error("offline");
    if (href.includes("id=eq.")) {
      if (mode === "missing") return httpResponse(200, []);
      if (mode === "r2-image") return httpResponse(200, [Object.assign({}, bookRow, { image_url: R2_IMAGE })]);
      return httpResponse(200, [bookRow]);
    }
    if (href.includes("legacy_id")) {
      return httpResponse(200, [{
        id: 106,
        legacy_id: null,
        is_active: true,
        updated_at: "2026-01-02T00:00:00.000Z"
      }], { "content-range": "0-0/1" });
    }
    if (href.includes("/rest/v1/books")) {
      return httpResponse(200, [{
        id: 106,
        title: "تىزىملىك كىتاب",
        author: "ئاپتور",
        image_url: mode === "r2-image" ? R2_IMAGE : SUPABASE_IMAGE,
        price: 12,
        stock: 4,
        stock_status: "in",
        source: "romanlar.html",
        is_active: true
      }]);
    }
    return httpResponse(404, { message: "unexpected" });
  };
}

function jwt(payload) {
  return "eyJhbGciOiJub25lIn0." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".sig";
}

const jobs = [];

jobs.push(test("vercel redirect and rewrite paths stay classified the same way", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  vercel.redirects.forEach((rule) => {
    const found = preview.classifyPath(rule.source, "");
    assert.strictEqual(found.kind, "redirect", rule.source);
    assert.strictEqual(found.location, rule.destination, rule.source);
  });
  const categories = new Set(sitemap.CATEGORY_HUB_SLUGS.map((slug) => "/" + slug));
  vercel.rewrites.forEach((rule) => {
    if (rule.source.includes(":")) return;
    if (rule.source.startsWith("/kbg/")) {
      assert.ok(preview.posthogUpstream(rule.source.replace(":path(.*)", "array.js"), ""));
      return;
    }
    const found = preview.classifyPath(rule.source, "");
    if (categories.has(rule.source)) assert.strictEqual(found.kind, "category", rule.source);
    else if (rule.destination === "/api/book-public") assert.strictEqual(found.kind, "book", rule.source);
    else if (rule.destination === "/api/sitemap-index") assert.strictEqual(found.kind, "sitemap-index");
    else if (rule.destination === "/api/sitemap-books") assert.strictEqual(found.kind, "sitemap-books");
    else if (rule.destination.endsWith(".html")) assert.strictEqual(found.kind, "rewrite", rule.source);
  });
  sitemap.CATEGORY_HUB_SLUGS.forEach((slug) => {
    assert.strictEqual(preview.classifyPath("/" + slug, "").kind, "category", slug);
    assert.strictEqual(preview.classifyPath("/" + slug + "-1", "").kind, "asset", slug);
  });
  assert.strictEqual(preview.classifyPath("/book.html", "?id=122").kind, "legacy-redirect");
  assert.strictEqual(preview.classifyPath("/book", "?id=122").kind, "legacy-redirect");
  assert.strictEqual(preview.classifyPath("/book/122", "").kind, "book");
  assert.strictEqual(preview.classifyPath("/book/not-a-number", "").kind, "book");
  assert.strictEqual(preview.classifyPath("/sitemap-books-2.xml", "").page, "2");
  assert.strictEqual(preview.posthogUpstream("/kbg/static/array.js", ""), "https://eu-assets.i.posthog.com/static/array.js");
  assert.strictEqual(preview.posthogUpstream("/kbg/array/config.js", ""), "https://eu-assets.i.posthog.com/array/config.js");
  assert.strictEqual(preview.posthogUpstream("/kbg/e/", ""), "https://eu.i.posthog.com/e/");
  assert.strictEqual(preview.posthogUpstream("/kbg/batch/", "?ip=1"), "https://eu.i.posthog.com/batch/?ip=1");
}));

jobs.push(test("preview config does not bind the production domain", () => {
  const text = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  assert.doesNotMatch(text.split('"env"')[0], /kutadgubilik\.com/);
  assert.doesNotMatch(text, /vercel\.app/);
  const config = JSON.parse(text);
  assert.strictEqual(config.name, "kutadgu-cloudflare-preview");
  assert.strictEqual(config.workers_dev, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(config, "routes"));
  assert.ok(!Object.prototype.hasOwnProperty.call(config, "route"));
  assert.ok(!Object.prototype.hasOwnProperty.call(config, "zone_id"));
  assert.strictEqual(config.vars.KUTADGU_HOST_MODE, "preview");
  assert.strictEqual(config.vars.KUTADGU_R2_UPLOAD_ENABLED, "false");
  assert.strictEqual(config.vars.KUTADGU_R2_PUBLIC_BASE_URL, "");
  assert.strictEqual(config.vars.KUTADGU_R2_READ_ENABLED, "true");
  assert.strictEqual(config.vars.AI_SEARCH_ENABLED, "false");
  assert.strictEqual(config.r2_buckets[0].binding, "COVERS");
  assert.strictEqual(config.r2_buckets[0].bucket_name, "kutadgu-covers-preview");
  const prod = config.env.production;
  assert.strictEqual(prod.name, "kutadgu-cloudflare-production");
  assert.strictEqual(prod.workers_dev, true);
  assert.strictEqual(prod.preview_urls, false);
  assert.deepStrictEqual(prod.routes.map((rule) => rule.pattern).sort(), ["kutadgubilik.com", "www.kutadgubilik.com"]);
  assert.ok(prod.routes.every((rule) => rule.custom_domain === true && rule.zone_name === "kutadgubilik.com"));
  assert.ok(prod.routes.every((rule) => !String(rule.pattern).includes("*")));
  assert.ok(!Object.prototype.hasOwnProperty.call(prod, "route"));
  assert.strictEqual(prod.vars.KUTADGU_HOST_MODE, "production");
  assert.strictEqual(prod.vars.AI_SEARCH_ENABLED, "true");
  assert.strictEqual(prod.vars.KUTADGU_R2_READ_ENABLED, "true");
  assert.strictEqual(prod.vars.KUTADGU_R2_UPLOAD_ENABLED, "true");
  assert.strictEqual(prod.vars.KUTADGU_R2_OVERWRITE, "false");
  assert.strictEqual(prod.vars.KUTADGU_R2_PUBLIC_BASE_URL, "");
  assert.strictEqual(prod.r2_buckets[0].binding, "COVERS");
  assert.strictEqual(prod.r2_buckets[0].bucket_name, "kutadgu-covers-preview");
  assert.doesNotMatch(text, /OPENAI_API_KEY/);
  assert.doesNotMatch(text, /production-cutover-routes/);
  const cutover = JSON.parse(fs.readFileSync(path.join(root, "cloudflare/production-cutover-routes.json"), "utf8"));
  assert.strictEqual(cutover.status, "custom-domains");
  assert.strictEqual(cutover.worker, "kutadgu-cloudflare-production");
  assert.ok(cutover.routes.some((rule) => rule.pattern === "www.kutadgubilik.com" && rule.custom_domain === true));
  assert.ok(cutover.routes.some((rule) => rule.pattern === "kutadgubilik.com" && rule.custom_domain === true));
  const workerFirst = config.assets.run_worker_first;
  assert.ok(Array.isArray(workerFirst));
  assert.ok(workerFirst.length < 100);
  const requiredWorkerFirst = [
    "/",
    "/*.html",
    "/.*",
    "/api/*",
    "/book",
    "/book/*",
    "/c/*",
    "/__r2",
    "/__r2/*",
    "/kbg",
    "/kbg/*",
    "/sitemap.xml",
    "/sitemap-books.xml",
    "/sitemap-books-*.xml",
    "/books",
    "/order-info",
    "/privacy",
    "/returns",
    "/delete-account",
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
    "/admin.js",
    "/catalog-bibliography.js",
    "/supabase-config.js"
  ];
  for (const rule of requiredWorkerFirst) {
    assert.ok(workerFirst.includes(rule), rule);
  }
  for (const blocked of ["/*", "/*.css", "/*.js", "/*.png", "/*.webp", "/*.woff2"]) {
    assert.equal(workerFirst.includes(blocked), false, blocked);
  }
  assert.strictEqual(config.assets.html_handling, "none");
  assert.strictEqual(config.assets.not_found_handling, "none");
  assert.strictEqual(config.assets.binding, "ASSETS");
  const dev = previewDev.previewDevConfig();
  assert.strictEqual(path.resolve(dev.config.assets.directory), root);
  assert.ok(path.relative(dev.config.assets.directory, dev.configDir).startsWith(".."));
  assert.strictEqual(dev.config.main, path.join(root, "cloudflare", "worker.js"));
  assert.ok(!Object.prototype.hasOwnProperty.call(dev.config, "routes"));
  const devTop = Object.assign({}, dev.config);
  delete devTop.env;
  assert.doesNotMatch(JSON.stringify(devTop), /kutadgubilik\.com|vercel\.app/);
  fs.rmSync(dev.configDir, { recursive: true, force: true });
  const worker = fs.readFileSync(path.join(root, "cloudflare/worker.js"), "utf8");
  assert.doesNotMatch(worker, /R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|OPENAI_API_KEY/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "kutadgu-image-storage.js"), "utf8"), /R2_SECRET_ACCESS_KEY|SECRET_ACCESS_KEY/);
}));

jobs.push(test("static homepage, books rewrite, cache headers, and 404 stay intact", async () => {
  const deps = baseDeps(catalogFetch("ok"), { "/UKIJCJK.woff2": "font" });
  const home = await preview.dispatch(request("http://127.0.0.1:8787/"), {}, deps);
  assert.strictEqual(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /<html/i);
  assert.strictEqual(home.headers.get("X-Content-Type-Options"), "nosniff");
  assert.strictEqual(home.headers.get("Strict-Transport-Security"), null);
  assert.strictEqual(home.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.strictEqual(home.headers.get("Content-Security-Policy-Report-Only"), headers.PRODUCTION_CSP_REPORT_ONLY);
  assert.ok(home.headers.get("Content-Security-Policy-Report-Only").includes("https://fxlojnqwyojqjskfggmh.supabase.co"));
  const indexRedirect = await preview.dispatch(request("http://127.0.0.1:8787/index.html?x=1"), {}, deps);
  assert.strictEqual(indexRedirect.status, 308);
  assert.strictEqual(indexRedirect.headers.get("Location"), "/?x=1");
  const books = await preview.dispatch(request("http://127.0.0.1:8787/books"), {}, deps);
  assert.strictEqual(books.status, 200);
  assert.match(await books.text(), /books|كىتاب/i);
  const booksHtml = await preview.dispatch(request("http://127.0.0.1:8787/books.html"), {}, deps);
  assert.strictEqual(booksHtml.status, 308);
  assert.strictEqual(booksHtml.headers.get("Location"), "/books");
  const shop = await preview.dispatch(request("http://127.0.0.1:8787/shop.js?v=138"), {}, deps);
  assert.strictEqual(shop.headers.get("Cache-Control"), headers.STOREFRONT_CODE);
  const adminJs = await preview.dispatch(request("http://127.0.0.1:8787/admin.js?v=79"), {}, deps);
  assert.strictEqual(adminJs.headers.get("Cache-Control"), headers.NO_STORE);
  const idle = await preview.dispatch(request("http://127.0.0.1:8787/admin-idle.js"), {}, deps);
  assert.strictEqual(idle.headers.get("Cache-Control"), headers.STOREFRONT_CODE);
  const font = await preview.dispatch(request("http://127.0.0.1:8787/UKIJCJK.woff2"), {}, deps);
  assert.strictEqual(font.headers.get("Cache-Control"), headers.LONG_ASSET);
  const missing = await preview.dispatch(request("http://127.0.0.1:8787/missing-page"), {}, deps);
  assert.strictEqual(missing.status, 404);
  assert.match(await missing.text(), /404/);
  const posted = await preview.dispatch(request("http://127.0.0.1:8787/", "POST"), {}, deps);
  assert.strictEqual(posted.status, 405);
  const head = await preview.dispatch(request("http://127.0.0.1:8787/", "HEAD"), {}, deps);
  assert.strictEqual(head.status, 200);
  assert.strictEqual(await head.text(), "");
  const hidden = await preview.dispatch(request("http://127.0.0.1:8787/.env"), {}, deps);
  assert.strictEqual(hidden.status, 404);
}));

jobs.push(test("production hosts are refused and R2 can be added beside Supabase in report-only CSP", async () => {
  const deps = baseDeps(catalogFetch("ok"));
  const production = await preview.dispatch(request("https://www.kutadgubilik.com/"), {}, deps);
  assert.strictEqual(production.status, 421);
  const alias = await preview.dispatch(request("https://kutadgu-bilig-kitab.vercel.app/books"), {}, deps);
  assert.notStrictEqual(alias.status, 421);
  const env = { KUTADGU_R2_PUBLIC_BASE_URL: "https://covers.example.com/unused" };
  const home = await preview.dispatch(request("http://127.0.0.1:8787/"), env, deps);
  const csp = home.headers.get("Content-Security-Policy-Report-Only");
  assert.ok(csp.includes("https://fxlojnqwyojqjskfggmh.supabase.co"));
  assert.ok(csp.includes("https://covers.example.com"));
  assert.doesNotMatch(csp, /\*/);
  assert.strictEqual(home.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.ok(!csp.split("connect-src")[1].includes("covers.example.com"));
  const bad = headers.cspReportOnly({ KUTADGU_R2_PUBLIC_BASE_URL: "http://covers.example.com" });
  assert.strictEqual(bad, headers.PRODUCTION_CSP_REPORT_ONLY);
}));

jobs.push(test("category, book, legacy, and sitemap responses keep status, SEO, and cache headers", async () => {
  const deps = baseDeps(catalogFetch("ok"));
  const category = await preview.dispatch(request("http://127.0.0.1:8787/adabiyat"), {}, deps);
  assert.strictEqual(category.status, 200);
  const categoryHtml = await category.text();
  assert.ok(categoryHtml.includes(SUPABASE_IMAGE));
  assert.ok(categoryHtml.includes("https://www.kutadgubilik.com/"));
  assert.match(categoryHtml, /application\/ld\+json/);
  assert.strictEqual(category.headers.get("Cache-Control"), listing.SUCCESS_CACHE_CONTROL);
  const categoryHead = await preview.dispatch(request("http://127.0.0.1:8787/romanlar", "HEAD"), {}, deps);
  assert.strictEqual(categoryHead.status, 200);
  assert.strictEqual(await categoryHead.text(), "");
  assert.strictEqual(categoryHead.headers.get("Content-Type"), "text/html; charset=utf-8");
  const book = await preview.dispatch(request("http://127.0.0.1:8787/book/106"), {}, deps);
  assert.strictEqual(book.status, 200);
  const bookHtml = await book.text();
  assert.ok(bookHtml.includes('rel="canonical" href="https://www.kutadgubilik.com/book/106"'));
  assert.ok(bookHtml.includes('property="og:image" content="' + SUPABASE_IMAGE + '"'));
  const schema = bookHtml.match(/<script id="kutadguBookSchema" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(schema);
  const jsonLd = JSON.parse(schema[1]);
  assert.ok(JSON.stringify(jsonLd).includes(SUPABASE_IMAGE));
  assert.ok(JSON.stringify(jsonLd).includes("https://www.kutadgubilik.com/book/106"));
  assert.strictEqual(book.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
  const bookHead = await preview.dispatch(request("http://127.0.0.1:8787/book/106", "HEAD"), {}, deps);
  assert.strictEqual(bookHead.status, 200);
  assert.strictEqual(await bookHead.text(), "");
  const missing = await preview.dispatch(request("http://127.0.0.1:8787/book/999999999"), {}, baseDeps(catalogFetch("missing")));
  assert.strictEqual(missing.status, 404);
  assert.match(await missing.text(), /noindex, follow/);
  const invalid = await preview.dispatch(request("http://127.0.0.1:8787/book/not-a-number"), {}, deps);
  assert.strictEqual(invalid.status, 404);
  assert.doesNotMatch(await invalid.text(), /application\/ld\+json/);
  const failedLookup = await preview.dispatch(request("http://127.0.0.1:8787/book/106"), {}, baseDeps(catalogFetch("fail")));
  assert.strictEqual(failedLookup.status, 503);
  const legacy = await preview.dispatch(request("http://127.0.0.1:8787/book.html?id=122&utm=src"), {}, deps);
  assert.strictEqual(legacy.status, 308);
  assert.strictEqual(legacy.headers.get("Location"), "/book/122?utm=src");
  assert.strictEqual(legacy.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  const legacyBad = await preview.dispatch(request("http://127.0.0.1:8787/book.html?id=children-3"), {}, deps);
  assert.strictEqual(legacyBad.status, 404);
  const index = await preview.dispatch(request("http://127.0.0.1:8787/sitemap.xml"), {}, deps);
  assert.strictEqual(index.status, 200);
  const indexXml = await index.text();
  assert.ok(indexXml.includes("https://www.kutadgubilik.com/sitemap-books.xml"));
  assert.ok(indexXml.includes("https://www.kutadgubilik.com/sitemap-pages.xml"));
  assert.strictEqual(index.headers.get("Cache-Control"), "public, s-maxage=3600, stale-while-revalidate=86400");
  const booksXml = await preview.dispatch(request("http://127.0.0.1:8787/sitemap-books.xml"), {}, deps);
  assert.strictEqual(booksXml.status, 200);
  assert.ok((await booksXml.text()).includes("https://www.kutadgubilik.com/book/106"));
  const page = await preview.dispatch(request("http://127.0.0.1:8787/sitemap-books-2.xml", "HEAD"), {}, deps);
  assert.strictEqual(page.status, 200);
  assert.strictEqual(await page.text(), "");
  const down = await preview.dispatch(request("http://127.0.0.1:8787/sitemap.xml"), {}, baseDeps(catalogFetch("fail")));
  assert.strictEqual(down.status, 503);
  assert.strictEqual(down.headers.get("Cache-Control"), "no-store");
  const r2Book = await preview.dispatch(request("http://127.0.0.1:8787/book/106"), { KUTADGU_R2_PUBLIC_BASE_URL: "https://covers.example.com" }, baseDeps(catalogFetch("r2-image")));
  assert.ok((await r2Book.text()).includes(R2_IMAGE));
  const r2Category = await preview.dispatch(request("http://127.0.0.1:8787/adabiyat"), { KUTADGU_R2_PUBLIC_BASE_URL: "https://covers.example.com" }, baseDeps(catalogFetch("r2-image")));
  assert.ok((await r2Category.text()).includes(R2_IMAGE));
}));

jobs.push(test("AI search route keeps GET, POST, disabled, and enabled contracts", async () => {
  const vector = new Array(aiSearch.EMBEDDING_DIMENSIONS).fill(0.01);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init && init.method, body: init && init.body, headers: init && init.headers });
    if (String(url) === aiSearch.OPENAI_EMBEDDINGS_URL) {
      return httpResponse(200, { model: aiSearch.EMBEDDING_MODEL, data: [{ index: 0, embedding: vector }] });
    }
    if (String(url).includes("match_active_books_ai")) {
      return httpResponse(200, [{
        id: 5,
        title: "نەتىجە",
        author: "A",
        category: "t",
        price: 1,
        image_url: R2_IMAGE,
        stock: 1,
        similarity: 0.91
      }]);
    }
    if (String(url).includes("list_active_books_by_categories")) return httpResponse(200, []);
    return httpResponse(404, {});
  };
  const deps = baseDeps(fetchImpl);
  const get = await preview.dispatch(request("http://127.0.0.1:8787/api/ai-search"), {}, deps);
  assert.strictEqual(get.status, 405);
  assert.strictEqual((await get.json()).error, "method_not_allowed");
  assert.strictEqual(get.headers.get("Cache-Control"), "no-store");
  const disabled = await preview.dispatch(request("http://127.0.0.1:8787/api/ai-search", "POST", JSON.stringify({ query: "qqqq" }), { "Content-Type": "application/json" }), {}, deps);
  assert.strictEqual(disabled.status, 503);
  assert.strictEqual((await disabled.json()).error, "disabled");
  const previewKey = ["sk", "preview", "test"].join("-");
  const rpcKey = "test-supabase-rpc-key";
  const enabled = await preview.dispatch(request("http://127.0.0.1:8787/api/ai-search", "POST", JSON.stringify({ query: "qqqq" }), { "Content-Type": "application/json" }), { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: previewKey, SUPABASE_SECRET_KEY: rpcKey }, deps);
  assert.strictEqual(enabled.status, 200);
  const payload = await enabled.json();
  assert.strictEqual(payload.ok, true);
  assert.ok(payload.count >= 1);
  assert.strictEqual(payload.results[0].image_url, R2_IMAGE);
  assert.ok(!JSON.stringify(payload).includes(previewKey));
  assert.ok(!JSON.stringify(payload).includes(rpcKey));
  const rpcCall = calls.find((call) => String(call.url).includes("match_active_books_ai"));
  assert.ok(rpcCall);
  assert.strictEqual(rpcCall.headers.apikey, rpcKey);
  assert.strictEqual(rpcCall.headers.Authorization, "Bearer " + rpcKey);
  assert.ok(calls.some((call) => call.method === "POST" && call.url === aiSearch.OPENAI_EMBEDDINGS_URL));
}));

jobs.push(test("PostHog proxy preserves the vercel upstream and does not add preview hosts to the browser allowlist", async () => {
  let seen = "";
  const deps = baseDeps(async (url, init) => {
    seen = String(url) + " " + (init && init.method);
    return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
  });
  const proxied = await preview.dispatch(request("http://127.0.0.1:8787/kbg/static/array.js"), {}, deps);
  assert.strictEqual(proxied.status, 200);
  assert.strictEqual(seen, "https://eu-assets.i.posthog.com/static/array.js GET");
  const config = fs.readFileSync(path.join(root, "posthog-config.js"), "utf8");
  assert.ok(!config.includes("workers.dev"));
  assert.match(config, /www\.kutadgubilik\.com/);
}));

jobs.push(test("image storage accepts Supabase and a future R2 host without rewriting or keeping write secrets", () => {
  const config = images.publicImageConfig({
    r2PublicBase: "https://covers.example.com/path",
    r2SecretAccessKey: SECRET,
    accessKeyId: "AKIAFAKEKEY"
  });
  assert.strictEqual(config.r2PublicBase, "https://covers.example.com");
  assert.ok(!JSON.stringify(config).includes(SECRET));
  assert.strictEqual(images.classifyImageUrl(SUPABASE_IMAGE, config).kind, "supabase");
  assert.strictEqual(images.classifyImageUrl(R2_IMAGE, config).kind, "r2");
  assert.strictEqual(images.displayImageUrl(SUPABASE_IMAGE, config), SUPABASE_IMAGE);
  assert.strictEqual(images.supabaseObjectKey(SUPABASE_IMAGE), "book-covers/book/106.webp");
  assert.strictEqual(images.supabaseObjectKey(R2_IMAGE), "");
  assert.strictEqual(images.isAcceptedImageUrl(SUPABASE_IMAGE, {}), true);
  assert.strictEqual(images.isAcceptedImageUrl(R2_IMAGE, config), true);
  assert.strictEqual(images.isAcceptedImageUrl("javascript:alert(1)", config), false);
  assert.strictEqual(images.futurePublicUrl("book-covers/book/106.webp", config), "https://covers.example.com/book-covers/book/106.webp");
  const canonical = "https://www.kutadgubilik.com/__r2/book-covers/book/106.webp";
  assert.strictEqual(images.classifyImageUrl(canonical, {}).kind, "r2");
  assert.strictEqual(images.classifyImageUrl(SUPABASE_IMAGE, {}).kind, "supabase");
  assert.strictEqual(images.isAcceptedImageUrl(canonical, {}), true);
  assert.strictEqual(images.isAcceptedImageUrl(SUPABASE_IMAGE, {}), true);
  assert.strictEqual(images.displayImageUrl(canonical, {}), canonical);
  assert.strictEqual(images.displayImageUrl(SUPABASE_IMAGE, {}), SUPABASE_IMAGE);
  const Safe = require(path.join(root, "kutadgu-safe-url.js"));
  assert.strictEqual(Safe.isSafeCoverUrl(canonical), true);
  assert.strictEqual(Safe.isSafeCoverUrl(SUPABASE_IMAGE), true);
}));

jobs.push(test("R2 admin upload stays disabled and requires Supabase auth plus AAL2 admin before any write", async () => {
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    const href = String(url);
    if (href.endsWith("/auth/v1/user")) return httpResponse(200, { id: "user" });
    if (href.endsWith("/rpc/is_kutadgu_admin")) return httpResponse(200, true);
    return httpResponse(404, {});
  };
  const quiet = baseDeps(async () => { fetches += 1; throw new Error("should not fetch"); });
  const disabled = await preview.dispatch(request("http://127.0.0.1:8787/api/r2-cover-upload", "POST", "x"), { R2_SECRET_ACCESS_KEY: SECRET }, quiet);
  assert.strictEqual(disabled.status, 404);
  assert.strictEqual(fetches, 0);
  assert.ok(!(await disabled.text()).includes(SECRET));
  const bucket = {
    objects: new Map(),
    async head(key) { return this.objects.has(key) ? { key } : null; },
    async put(key, bytes) { this.objects.set(key, bytes); }
  };
  const previewEnv = {
    KUTADGU_HOST_MODE: "preview",
    KUTADGU_R2_UPLOAD_ENABLED: "true",
    COVERS: bucket
  };
  const previewBlocked = await upload.handleR2CoverUpload(request("https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev/api/r2-cover-upload", "POST", "x"), previewEnv, { fetchImpl });
  assert.strictEqual(previewBlocked.status, 404);
  assert.strictEqual(bucket.objects.size, 0);
  const env = {
    KUTADGU_HOST_MODE: "production",
    KUTADGU_R2_UPLOAD_ENABLED: "true",
    KUTADGU_R2_PUBLIC_BASE_URL: "",
    KUTADGU_R2_OVERWRITE: "false",
    R2_SECRET_ACCESS_KEY: SECRET,
    COVERS: bucket
  };
  const offHost = await upload.handleR2CoverUpload(request("http://127.0.0.1:8787/api/r2-cover-upload", "POST", "x"), env, { fetchImpl });
  assert.strictEqual(offHost.status, 404);
  const anon = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", "x"), env, { fetchImpl });
  assert.strictEqual(anon.status, 401);
  assert.strictEqual(bucket.objects.size, 0);
  const low = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", "x", {
    Authorization: "Bearer " + jwt({ aal: "aal1" })
  }), env, { fetchImpl });
  assert.strictEqual(low.status, 403);
  assert.strictEqual((JSON.parse(low.body)).error, "aal2_required");
  const denied = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", "x", {
    Authorization: "Bearer " + jwt({ aal: "aal2" })
  }), env, {
    fetchImpl: async (url) => {
      if (String(url).endsWith("/auth/v1/user")) return httpResponse(200, { id: "user" });
      return httpResponse(200, false);
    }
  });
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(JSON.parse(denied.body).error, "admin_required");
  const body = Buffer.from("webp");
  const unbound = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", body, {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/webp",
    "x-kutadgu-object-key": "book-covers/book/new.webp"
  }), { KUTADGU_HOST_MODE: "production", KUTADGU_R2_UPLOAD_ENABLED: "true" }, { fetchImpl });
  assert.strictEqual(unbound.status, 503);
  assert.strictEqual(JSON.parse(unbound.body).error, "r2_unbound");
  const badType = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", body, {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/gif",
    "x-kutadgu-object-key": "book-covers/book/new.gif"
  }), env, { fetchImpl });
  assert.strictEqual(badType.status, 400);
  assert.strictEqual(JSON.parse(badType.body).error, "invalid_object");
  const traversal = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", body, {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/webp",
    "x-kutadgu-object-key": "book-covers/../secret.webp"
  }), env, { fetchImpl });
  assert.strictEqual(traversal.status, 400);
  const huge = Buffer.alloc(upload.MAX_BYTES + 1);
  const tooBig = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", huge, {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/webp",
    "Content-Length": String(huge.length),
    "x-kutadgu-object-key": "book-covers/book/huge.webp"
  }), env, { fetchImpl });
  assert.strictEqual(tooBig.status, 413);
  assert.strictEqual(bucket.objects.size, 0);
  const ok = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", body, {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/webp",
    "x-kutadgu-object-key": "book-covers/book/new.webp"
  }), env, { fetchImpl });
  assert.strictEqual(ok.status, 201);
  const stored = JSON.parse(ok.body);
  assert.strictEqual(stored.key, "book-covers/book/new.webp");
  assert.strictEqual(stored.url, "https://www.kutadgubilik.com/__r2/book-covers/book/new.webp");
  assert.ok(!Object.prototype.hasOwnProperty.call(stored, "publicUrl"));
  assert.ok(!ok.body.includes(SECRET));
  assert.ok(!ok.body.includes("r2.dev"));
  assert.strictEqual(bucket.objects.has("book-covers/book/new.webp"), true);
  const again = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", body, {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/webp",
    "x-kutadgu-object-key": "book-covers/book/new.webp"
  }), env, { fetchImpl });
  assert.strictEqual(again.status, 409);
  const staffId = "11111111-1111-4111-8111-111111111111";
  const staffFetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/auth/v1/user")) return httpResponse(200, { id: staffId });
    if (href.endsWith("/rpc/is_kutadgu_admin")) return httpResponse(200, false);
    if (href.endsWith("/rpc/is_kutadgu_book_staff")) return httpResponse(200, true);
    return httpResponse(404, {});
  };
  const staffHeaders = {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/webp"
  };
  const staffOutside = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", body, Object.assign({}, staffHeaders, {
    "x-kutadgu-object-key": "book-covers/book/staff.webp"
  })), env, { fetchImpl: staffFetch });
  assert.strictEqual(staffOutside.status, 403);
  const staffOk = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", body, Object.assign({}, staffHeaders, {
    "x-kutadgu-object-key": "book-covers/staff/" + staffId + "/cover.webp"
  })), env, { fetchImpl: staffFetch });
  assert.strictEqual(staffOk.status, 201);
  assert.strictEqual(JSON.parse(staffOk.body).url, "https://www.kutadgubilik.com/__r2/book-covers/staff/" + staffId + "/cover.webp");
  const heroKey = "book-covers/hero/store-slides/slot-1-11111111-1111-4111-8111-111111111111.webp";
  const heroBody = Buffer.from("webp-hero");
  const heroHeaders = {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "Content-Type": "image/webp",
    "x-kutadgu-object-key": heroKey
  };
  const hero = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", heroBody, heroHeaders), env, { fetchImpl });
  assert.strictEqual(hero.status, 201);
  assert.strictEqual(JSON.parse(hero.body).url, "https://www.kutadgubilik.com/__r2/" + heroKey);
  const heroStaff = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", heroBody, Object.assign({}, heroHeaders, {
    "x-kutadgu-object-key": heroKey
  })), env, { fetchImpl: staffFetch });
  assert.strictEqual(heroStaff.status, 403);
  const heroLoose = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", heroBody, Object.assign({}, heroHeaders, {
    "x-kutadgu-object-key": "book-covers/hero/store-slides/evil.webp"
  })), env, { fetchImpl });
  assert.strictEqual(heroLoose.status, 400);
  const heroHuge = Buffer.alloc(upload.HERO_MAX_BYTES + 1);
  const heroTooBig = await upload.handleR2CoverUpload(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", heroHuge, Object.assign({}, heroHeaders, {
    "Content-Length": String(heroHuge.length)
  })), env, { fetchImpl });
  assert.strictEqual(heroTooBig.status, 413);
  assert.strictEqual(bucket.objects.has(heroKey), true);
}));

jobs.push(test("R2 hero delete is admin-only and cannot remove book covers", async () => {
  const heroKey = "book-covers/hero/store-slides/slot-2-11111111-1111-4111-8111-111111111111.png";
  const deleted = [];
  const bucket = {
    async delete(key) { deleted.push(key); }
  };
  const env = {
    KUTADGU_HOST_MODE: "production",
    KUTADGU_R2_UPLOAD_ENABLED: "true",
    COVERS: bucket
  };
  const adminFetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/auth/v1/user")) return httpResponse(200, { id: "admin" });
    if (href.endsWith("/rpc/is_kutadgu_admin")) return httpResponse(200, true);
    if (href.includes("/rest/v1/store_hero_store_slides")) return httpResponse(200, []);
    return httpResponse(404, {});
  };
  const previewBlocked = await upload.handleR2HeroDelete(request("https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev/api/r2-hero-delete", "POST", "", {
    "x-kutadgu-object-key": heroKey
  }), { KUTADGU_HOST_MODE: "preview", KUTADGU_R2_UPLOAD_ENABLED: "true", COVERS: bucket }, { fetchImpl: adminFetch });
  assert.strictEqual(previewBlocked.status, 404);
  const anon = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", ""), env, { fetchImpl: adminFetch });
  assert.strictEqual(anon.status, 401);
  const low = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", "", {
    Authorization: "Bearer " + jwt({ aal: "aal1" }),
    "x-kutadgu-object-key": heroKey
  }), env, { fetchImpl: adminFetch });
  assert.strictEqual(low.status, 403);
  assert.strictEqual(JSON.parse(low.body).error, "aal2_required");
  const staffId = "11111111-1111-4111-8111-111111111111";
  const staff = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", "", {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "x-kutadgu-object-key": heroKey
  }), env, {
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.endsWith("/auth/v1/user")) return httpResponse(200, { id: staffId });
      if (href.endsWith("/rpc/is_kutadgu_admin")) return httpResponse(200, false);
      return httpResponse(200, true);
    }
  });
  assert.strictEqual(staff.status, 403);
  const bookKey = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", "", {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "x-kutadgu-object-key": "book-covers/book/106.webp"
  }), env, { fetchImpl: adminFetch });
  assert.strictEqual(bookKey.status, 400);
  const traversal = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", "", {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "x-kutadgu-object-key": "book-covers/hero/store-slides/../book/106.webp"
  }), env, { fetchImpl: adminFetch });
  assert.strictEqual(traversal.status, 400);
  const referenced = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", "", {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "x-kutadgu-object-key": heroKey
  }), env, {
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.endsWith("/auth/v1/user")) return httpResponse(200, { id: "admin" });
      if (href.endsWith("/rpc/is_kutadgu_admin")) return httpResponse(200, true);
      if (href.includes("/rest/v1/store_hero_store_slides")) return httpResponse(200, [{ id: "row" }]);
      return httpResponse(404, {});
    }
  });
  assert.strictEqual(referenced.status, 409);
  assert.strictEqual(JSON.parse(referenced.body).error, "still_referenced");
  const failedCheck = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", "", {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "x-kutadgu-object-key": heroKey
  }), env, {
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.endsWith("/auth/v1/user")) return httpResponse(200, { id: "admin" });
      if (href.endsWith("/rpc/is_kutadgu_admin")) return httpResponse(200, true);
      return httpResponse(500, {});
    }
  });
  assert.strictEqual(failedCheck.status, 503);
  assert.deepStrictEqual(deleted, []);
  const ok = await upload.handleR2HeroDelete(request("https://www.kutadgubilik.com/api/r2-hero-delete", "POST", "", {
    Authorization: "Bearer " + jwt({ aal: "aal2" }),
    "x-kutadgu-object-key": heroKey
  }), env, { fetchImpl: adminFetch });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(deleted, [heroKey]);
  const routed = await preview.dispatch(request("http://127.0.0.1:8787/api/r2-hero-delete", "POST", ""), { KUTADGU_R2_UPLOAD_ENABLED: "true" }, { fetchImpl: adminFetch });
  assert.strictEqual(routed.status, 404);
}));

jobs.push(test("R2 inventory dry-run counts and copies nothing unless explicitly confirmed", async () => {
  const file = path.join(os.tmpdir(), "kutadgu-cover-inventory.json");
  fs.writeFileSync(file, JSON.stringify([
    { id: 106, image_url: SUPABASE_IMAGE, gallery_images: [R2_IMAGE] },
    { id: 2, image_url: "" }
  ]));
  const counts = inventory.inventoryCounts(JSON.parse(fs.readFileSync(file, "utf8")), {
    r2PublicBase: "https://covers.example.com"
  });
  assert.strictEqual(counts.supabase, 1);
  assert.strictEqual(counts.r2, 1);
  const plans = inventory.planCopies(JSON.parse(fs.readFileSync(file, "utf8")));
  assert.strictEqual(plans.filter((plan) => plan.action === "copy").length, 1);
  assert.strictEqual(plans[0].sourceUrl, SUPABASE_IMAGE);
  assert.strictEqual(plans[0].key, "book-covers/book/106.webp");
  const silent = { log() {} };
  const dry = await inventory.run(["--file", file], { R2_SECRET_ACCESS_KEY: SECRET }, {
    io: silent,
    fetchImpl: async () => { throw new Error("network"); }
  });
  assert.strictEqual(dry.exitCode, 0);
  assert.ok(dry.lines.some((line) => line.includes("dry-run")));
  assert.ok(dry.lines.every((line) => !line.includes(SECRET)));
  const unconfirmed = await inventory.run(["--file", file, "--copy"], {
    R2_SECRET_ACCESS_KEY: SECRET,
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "access",
    R2_BUCKET: "bucket"
  }, { io: silent, fetchImpl: async () => { throw new Error("network"); } });
  assert.strictEqual(unconfirmed.exitCode, 2);
  const puts = [];
  const copied = await inventory.run(["--file", file, "--copy"], {
    KUTADGU_R2_COPY_CONFIRM: inventory.COPY_CONFIRM,
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: SECRET,
    R2_BUCKET: "kutadgu-covers-preview"
  }, {
    io: silent,
    client: {
      async head() { return { status: 404, ok: false }; },
      async put(key) { puts.push(key); return { status: 200, ok: true }; }
    },
    fetchImpl: async () => httpResponse(200, "image-bytes")
  });
  assert.strictEqual(copied.exitCode, 0);
  assert.deepStrictEqual(puts, ["book-covers/book/106.webp"]);
  assert.ok(copied.lines.every((line) => !line.includes(SECRET)));
  const kept = [];
  await inventory.run(["--file", file, "--copy"], {
    KUTADGU_R2_COPY_CONFIRM: inventory.COPY_CONFIRM,
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: SECRET,
    R2_BUCKET: "kutadgu-covers-preview"
  }, {
    io: silent,
    client: {
      async head() { return { status: 200, ok: true }; },
      async put(key) { kept.push(key); return { status: 200, ok: true }; }
    },
    fetchImpl: async () => { throw new Error("should not download"); }
  });
  assert.deepStrictEqual(kept, []);
  const liveCalls = [];
  const live = await inventory.run(["--live"], {}, {
    io: silent,
    fetchImpl: async (url, init) => {
      liveCalls.push({ url: String(url), method: init.method, range: init.headers.Range });
      return httpResponse(200, [{ id: 1, image_url: SUPABASE_IMAGE }]);
    }
  });
  assert.strictEqual(live.exitCode, 0);
  assert.strictEqual(liveCalls.length, 1);
  assert.strictEqual(liveCalls[0].method, "GET");
  assert.strictEqual(liveCalls[0].url, inventory.publicInventoryUrl());
  assert.match(inventory.publicInventoryUrl(), /is_active=eq\.true/);
  const source = fs.readFileSync(path.join(root, "scripts/r2-cover-inventory.js"), "utf8");
  assert.doesNotMatch(source, /\.update\(|\.delete\(|service_role|DELETE FROM/i);
  const signed = r2.signedFetch({
    method: "PUT",
    accountId: "account",
    bucket: "kutadgu-covers-preview",
    key: "book-covers/book/1.webp",
    body: Buffer.from("x"),
    contentType: "image/webp",
    accessKeyId: "access-key",
    secretAccessKey: SECRET,
    now: new Date("2026-01-02T03:04:05.000Z")
  });
  assert.strictEqual(signed.method, "PUT");
  assert.ok(!signed.url.includes(SECRET));
  assert.ok(!signed.headers.Authorization.includes(SECRET));
  assert.throws(() => r2.signedFetch({ method: "DELETE", accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: SECRET }), /r2-method-not-allowed/);
  const client = r2.createR2Client({
    accountId: "account",
    bucket: "kutadgu-covers-preview",
    accessKeyId: "access-key",
    secretAccessKey: SECRET,
    fetchImpl: async () => httpResponse(200, "")
  });
  assert.deepStrictEqual(Object.keys(client).sort(), ["head", "list", "put"]);
  fs.unlinkSync(file);
}));

jobs.push(test("R2 copy verifier refuses deletes, other buckets, and conflicting bytes", () => {
  const source = fs.readFileSync(path.join(root, "scripts/r2-cover-copy-verify.js"), "utf8");
  assert.strictEqual(copyVerify.BUCKET, "kutadgu-covers-preview");
  assert.doesNotMatch(source, /r2 object delete|object delete|\.delete\(/);
  assert.match(source, /--remote/);
  assert.strictEqual(copyVerify.decideExisting("abc", 4, "abc", 4), "VERIFIED_EXISTING");
  assert.strictEqual(copyVerify.decideExisting("abc", 4, "def", 4), "CONFLICT");
  assert.strictEqual(copyVerify.interpretGet(1, "The specified key does not exist."), "absent");
  assert.strictEqual(copyVerify.interpretGet(0, "Download complete."), "present");
  assert.strictEqual(copyVerify.interpretGet(1, "Authentication error"), "auth");
  const args = copyVerify.objectArgs("put", "book-covers/book/1.webp", ["--file", "x"]);
  assert.strictEqual(args[3], "kutadgu-covers-preview/book-covers/book/1.webp");
  assert.ok(args.includes("--remote"));
  assert.throws(() => copyVerify.objectArgs("delete", "book-covers/book/1.webp", []), /delete-forbidden/);
  const records = copyVerify.buildRecords([
    { id: 1, image_url: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/1.webp", gallery_images: [] },
    { id: 2, image_url: "https://example.com/cover.webp", gallery_images: ["https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/1.webp"] }
  ]);
  assert.strictEqual(records.planned.length, 1);
  assert.deepStrictEqual(records.planned[0].bookIds, [1, 2]);
  assert.strictEqual(records.planned[0].duplicateRefs, 1);
  assert.strictEqual(records.skipped.length, 1);
  assert.strictEqual(records.skipped[0].status, "SKIPPED_NON_SUPABASE");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.strictEqual(copyVerify.imageMagic(png), "image/png");
  assert.strictEqual(copyVerify.imageMagic(Buffer.from("not-an-image")), "");
}));

jobs.push(test("private preview R2 reads stay same-origin, verified, and off for production", async () => {
  const payload = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]);
  const calls = [];
  const bucket = {
    calls,
    async get(name) {
      this.calls.push(["get", name]);
      if (name !== "book-covers/book/106.webp") return null;
      return {
        size: payload.length,
        httpEtag: '"etag-106"',
        httpMetadata: { contentType: "image/webp", cacheControl: images.IMMUTABLE_CACHE },
        body: payload,
        writeHttpMetadata(out) {
          out.set("content-type", "image/webp");
          out.set("cache-control", images.IMMUTABLE_CACHE);
        }
      };
    },
    async head(name) {
      this.calls.push(["head", name]);
      if (name !== "book-covers/book/106.webp") return null;
      return {
        size: payload.length,
        httpEtag: '"etag-106"',
        httpMetadata: { contentType: "image/webp", cacheControl: images.IMMUTABLE_CACHE },
        writeHttpMetadata(out) {
          out.set("content-type", "image/webp");
          out.set("cache-control", images.IMMUTABLE_CACHE);
        }
      };
    },
    async list() { this.calls.push(["list"]); throw new Error("list-forbidden"); },
    async put() { this.calls.push(["put"]); throw new Error("put-forbidden"); },
    async delete() { this.calls.push(["delete"]); throw new Error("delete-forbidden"); }
  };
  const env = {
    KUTADGU_R2_READ_ENABLED: "true",
    KUTADGU_R2_UPLOAD_ENABLED: "false",
    KUTADGU_R2_PUBLIC_BASE_URL: "",
    COVERS: bucket
  };
  const deps = baseDeps(catalogFetch("ok"));
  const previewOrigin = "https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev";
  const readUrl = previewOrigin + "/__r2/book-covers/book/106.webp";
  const got = await preview.dispatch(request(readUrl), env, deps);
  assert.strictEqual(got.status, 200);
  assert.deepStrictEqual(Buffer.from(await got.arrayBuffer()), payload);
  assert.strictEqual(got.headers.get("content-type"), "image/webp");
  assert.strictEqual(got.headers.get("cache-control"), images.IMMUTABLE_CACHE);
  assert.strictEqual(got.headers.get("etag"), '"etag-106"');
  assert.strictEqual(got.headers.get("content-length"), String(payload.length));
  assert.strictEqual(got.headers.get("location"), null);
  assert.strictEqual(got.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.deepStrictEqual(calls, [["get", "book-covers/book/106.webp"]]);
  const head = await preview.dispatch(request(readUrl, "HEAD"), env, deps);
  assert.strictEqual(head.status, 200);
  assert.strictEqual(await head.text(), "");
  assert.strictEqual(head.headers.get("content-type"), "image/webp");
  assert.strictEqual(head.headers.get("etag"), '"etag-106"');
  const missing = await preview.dispatch(request(previewOrigin + "/__r2/book-covers/book/missing.webp"), env, deps);
  assert.strictEqual(missing.status, 404);
  const traversals = [
    previewOrigin + "/__r2/book-covers/%2e%2e/secret",
    previewOrigin + "/__r2/book-covers/%5csecret",
    previewOrigin + "/__r2/book-covers/%252e%252e/x.webp",
    previewOrigin + "/__r2/other/a.webp",
    previewOrigin + "/__r2/",
    previewOrigin + "/__r2/book-covers/"
  ];
  for (const url of traversals) {
    const rejected = await preview.dispatch(request(url), env, deps);
    assert.ok(rejected.status === 400 || rejected.status === 404, url);
  }
  const deleted = await preview.dispatch(request(readUrl, "DELETE"), env, deps);
  assert.strictEqual(deleted.status, 405);
  const put = await preview.dispatch(request(readUrl, "PUT", payload), env, deps);
  assert.strictEqual(put.status, 405);
  assert.ok(calls.every((call) => call[0] === "get" || call[0] === "head"));
  const quiet = { ...bucket, calls: [] };
  const disabled = await preview.dispatch(request(readUrl), { COVERS: quiet, KUTADGU_R2_READ_ENABLED: "false" }, deps);
  assert.strictEqual(disabled.status, 404);
  assert.deepStrictEqual(quiet.calls, []);
  const production = await preview.dispatch(request("https://www.kutadgubilik.com/__r2/book-covers/book/106.webp"), env, deps);
  assert.strictEqual(production.status, 421);
  const previewConfig = {
    r2ReadEnabled: true,
    hostname: "kutadgu-cloudflare-preview.kutadgu-preview.workers.dev",
    origin: previewOrigin
  };
  assert.strictEqual(images.previewImageUrl(SUPABASE_IMAGE, previewConfig), readUrl);
  assert.strictEqual(images.previewImageUrl(SUPABASE_IMAGE, {
    r2ReadEnabled: true,
    hostname: "www.kutadgubilik.com",
    origin: "https://www.kutadgubilik.com"
  }), SUPABASE_IMAGE);
  assert.strictEqual(images.previewImageUrl("https://example.com/cover.webp", previewConfig), "https://example.com/cover.webp");
  assert.strictEqual(images.previewImageUrl(SUPABASE_IMAGE, { hostname: "127.0.0.1" }), SUPABASE_IMAGE);
  const once = images.previewFallbackTarget({ src: readUrl, origin: SUPABASE_IMAGE, fallback: "" });
  assert.strictEqual(once.action, "fallback");
  assert.strictEqual(once.src, SUPABASE_IMAGE);
  assert.strictEqual(images.previewFallbackTarget({ src: once.src, origin: SUPABASE_IMAGE, fallback: once.fallback }).action, "ignore");
  assert.strictEqual(images.previewFallbackTarget({ src: readUrl, origin: SUPABASE_IMAGE, fallback: "1" }).action, "ignore");
  assert.strictEqual(images.installPreviewCoverBridge({
    documentElement: { getAttribute() { return ""; }, setAttribute() {} },
    location: { pathname: "/" }
  }, { r2ReadEnabled: true, hostname: "www.kutadgubilik.com", pathname: "/" }), false);
  const category = await preview.dispatch(request("http://127.0.0.1:8787/adabiyat"), env, deps);
  const categoryHtml = await category.text();
  const categoryImgs = categoryHtml.match(/<img\b[^>]*>/gi) || [];
  assert.ok(categoryImgs.some((tag) => tag.includes('src="http://127.0.0.1:8787/__r2/book-covers/book/106.webp"')));
  assert.ok(categoryImgs.every((tag) => !/src=["']https:\/\/fxlojnqwyojqjskfggmh\.supabase\.co/.test(tag)));
  assert.ok(categoryHtml.includes('data-kutadgu-cover-origin="' + SUPABASE_IMAGE + '"'));
  assert.ok(categoryHtml.includes("https://www.kutadgubilik.com/"));
  assert.ok(categoryHtml.includes('src="/kutadgu-preview-r2-images.js"'));
  const book = await preview.dispatch(request("http://127.0.0.1:8787/book/106"), env, deps);
  const bookHtml = await book.text();
  assert.ok(bookHtml.includes('rel="canonical" href="https://www.kutadgubilik.com/book/106"'));
  assert.ok(bookHtml.includes('property="og:image" content="' + SUPABASE_IMAGE + '"'));
  const schema = bookHtml.match(/<script id="kutadguBookSchema" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(JSON.parse(schema[1]).image === SUPABASE_IMAGE || JSON.stringify(JSON.parse(schema[1])).includes(SUPABASE_IMAGE));
  assert.ok((bookHtml.match(/<img\b[^>]*>/gi) || []).some((tag) => tag.includes("/__r2/book-covers/book/106.webp")));
  const admin = await preview.dispatch(request("http://127.0.0.1:8787/admin.html"), env, deps);
  const adminHtml = await admin.text();
  assert.ok(!adminHtml.includes("kutadgu-preview-r2-images.js"));
  const uploadOff = await preview.dispatch(request("http://127.0.0.1:8787/api/r2-cover-upload", "POST", "x"), env, deps);
  assert.strictEqual(uploadOff.status, 404);
  const readSource = fs.readFileSync(path.join(root, "cloudflare/r2-cover-read.js"), "utf8");
  assert.doesNotMatch(readSource, /\.list\(|\.put\(|\.delete\(|r2\.dev|R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "kutadgu-preview-r2-images.js"), "utf8"), /R2_SECRET_ACCESS_KEY|SECRET_ACCESS_KEY/);
}));

jobs.push(test("preview and production host policies stay independent", async () => {
  const payload = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]);
  const calls = [];
  const bucket = {
    calls,
    async get(name) {
      this.calls.push(["get", name]);
      if (name !== "book-covers/book/106.webp") return null;
      return {
        size: payload.length,
        httpEtag: '"etag-106"',
        httpMetadata: { contentType: "image/webp", cacheControl: images.IMMUTABLE_CACHE },
        body: payload,
        writeHttpMetadata(out) {
          out.set("content-type", "image/webp");
          out.set("cache-control", images.IMMUTABLE_CACHE);
        }
      };
    },
    async head(name) {
      this.calls.push(["head", name]);
      return this.get(name);
    },
    async list() { throw new Error("list-forbidden"); },
    async put() { throw new Error("put-forbidden"); },
    async delete() { throw new Error("delete-forbidden"); }
  };
  const previewEnv = {
    KUTADGU_HOST_MODE: "preview",
    AI_SEARCH_ENABLED: "true",
    KUTADGU_R2_READ_ENABLED: "true",
    KUTADGU_R2_UPLOAD_ENABLED: "false",
    KUTADGU_R2_OVERWRITE: "false",
    KUTADGU_R2_PUBLIC_BASE_URL: "",
    COVERS: bucket
  };
  const productionEnv = {
    KUTADGU_HOST_MODE: "production",
    AI_SEARCH_ENABLED: "true",
    KUTADGU_R2_READ_ENABLED: "true",
    KUTADGU_R2_UPLOAD_ENABLED: "false",
    KUTADGU_R2_OVERWRITE: "false",
    KUTADGU_R2_PUBLIC_BASE_URL: "",
    COVERS: bucket
  };
  const deps = baseDeps(catalogFetch("ok"));
  const previewWww = await preview.dispatch(request("https://www.kutadgubilik.com/"), previewEnv, deps);
  const previewApex = await preview.dispatch(request("https://kutadgubilik.com/books"), previewEnv, deps);
  const previewAlias = await preview.dispatch(request("https://kutadgu-bilig-kitab.vercel.app/"), previewEnv, deps);
  assert.strictEqual(previewWww.status, 421);
  assert.strictEqual(previewApex.status, 421);
  assert.notStrictEqual(previewAlias.status, 421);
  assert.strictEqual(previewWww.headers.get("Strict-Transport-Security"), null);
  const local = await preview.dispatch(request("http://127.0.0.1:8787/"), productionEnv, deps);
  assert.strictEqual(local.status, 200);
  assert.strictEqual(local.headers.get("Strict-Transport-Security"), null);
  assert.strictEqual(local.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  const www = await preview.dispatch(request("https://www.kutadgubilik.com/"), productionEnv, deps);
  assert.strictEqual(www.status, 200);
  assert.strictEqual(www.headers.get("Strict-Transport-Security"), headers.HSTS_VALUE);
  assert.strictEqual(www.headers.get("X-Frame-Options"), "DENY");
  const apex = await preview.dispatch(request("https://kutadgubilik.com/books?x=1"), productionEnv, deps);
  assert.strictEqual(apex.status, 308);
  assert.strictEqual(apex.headers.get("Location"), "https://www.kutadgubilik.com/books?x=1");
  assert.strictEqual(apex.headers.get("Strict-Transport-Security"), headers.HSTS_VALUE);
  const validationHost = "https://kutadgu-cloudflare-production.kutadgu-preview.workers.dev/";
  const validation = await preview.dispatch(request(validationHost), productionEnv, deps);
  assert.strictEqual(validation.status, 200);
  assert.strictEqual(validation.headers.get("Strict-Transport-Security"), headers.HSTS_VALUE);
  const alias = await preview.dispatch(request("https://kutadgu-bilig-kitab.vercel.app/"), productionEnv, deps);
  assert.strictEqual(alias.status, 421);
  const readUrl = "https://www.kutadgubilik.com/__r2/book-covers/book/106.webp";
  const read = await preview.dispatch(request(readUrl), productionEnv, deps);
  assert.strictEqual(read.status, 200);
  assert.deepStrictEqual(Buffer.from(await read.arrayBuffer()), payload);
  assert.strictEqual(read.headers.get("Strict-Transport-Security"), headers.HSTS_VALUE);
  assert.ok(!String(read.headers.get("location") || "").includes("r2.dev"));
  const bookRow = { image_url: SUPABASE_IMAGE };
  const rewritten = images.rewritePreviewHtmlImages('<img src="' + bookRow.image_url + '">', {
    r2ReadEnabled: true,
    hostMode: "production",
    hostname: "www.kutadgubilik.com",
    origin: "https://www.kutadgubilik.com",
    pathname: "/"
  });
  assert.strictEqual(bookRow.image_url, SUPABASE_IMAGE);
  assert.ok(rewritten.includes('src="https://www.kutadgubilik.com/__r2/book-covers/book/106.webp"'));
  assert.ok(rewritten.includes('data-kutadgu-cover-origin="' + SUPABASE_IMAGE + '"'));
  assert.ok(!rewritten.includes("r2.dev"));
  const category = await preview.dispatch(request("https://www.kutadgubilik.com/adabiyat"), productionEnv, deps);
  const categoryHtml = await category.text();
  assert.ok(categoryHtml.includes('src="https://www.kutadgubilik.com/__r2/book-covers/book/106.webp"'));
  assert.ok(categoryHtml.includes('content="production"'));
  assert.ok(categoryHtml.includes('data-kutadgu-cover-origin="' + SUPABASE_IMAGE + '"'));
  const book = await preview.dispatch(request("https://www.kutadgubilik.com/book/106"), productionEnv, deps);
  const bookHtml = await book.text();
  const schema = bookHtml.match(/<script id="kutadguBookSchema" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(JSON.stringify(JSON.parse(schema[1])).includes(SUPABASE_IMAGE));
  const uploadOff = await preview.dispatch(request("https://www.kutadgubilik.com/api/r2-cover-upload", "POST", "x"), productionEnv, deps);
  assert.strictEqual(uploadOff.status, 404);
  let openaiCalls = 0;
  const aiDeps = baseDeps(async (url) => {
    if (String(url) === aiSearch.OPENAI_EMBEDDINGS_URL) openaiCalls += 1;
    throw new Error("upstream-should-not-run");
  });
  const missingKey = await preview.dispatch(request("https://www.kutadgubilik.com/api/ai-search", "POST", JSON.stringify({ query: "qqqq" }), { "Content-Type": "application/json" }), productionEnv, aiDeps);
  assert.strictEqual(missingKey.status, 503);
  assert.strictEqual((await missingKey.json()).error, "unavailable");
  assert.strictEqual(openaiCalls, 0);
  assert.strictEqual(missingKey.headers.get("Strict-Transport-Security"), headers.HSTS_VALUE);
}));

jobs.push(test("app link files are public and other dot paths stay denied", async () => {
  const env = { KUTADGU_HOST_MODE: "production" };
  const deps = baseDeps(async () => { throw new Error("association files do not call upstream"); });
  const sha = "2C:D7:46:A1:20:BA:11:D7:28:66:26:80:C7:44:C2:84:28:EF:0C:2F:D9:5C:D0:C6:6F:3F:55:E2:9A:28:44:FC";
  for (const filePath of ["/.well-known/assetlinks.json", "/.well-known/apple-app-site-association"]) {
    assert.strictEqual(preview.classifyPath(filePath, "").kind, "app-link");
    assert.strictEqual(preview.methodAllowed("app-link", "GET"), true);
    assert.strictEqual(preview.methodAllowed("app-link", "HEAD"), true);
    assert.strictEqual(preview.methodAllowed("app-link", "POST"), false);
    const get = await preview.dispatch(request("https://www.kutadgubilik.com" + filePath), env, deps);
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.headers.get("content-type"), "application/json");
    assert.strictEqual(get.headers.get("location"), null);
    const head = await preview.dispatch(request("https://www.kutadgubilik.com" + filePath, "HEAD"), env, deps);
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.headers.get("content-type"), "application/json");
    assert.strictEqual(head.headers.get("location"), null);
    assert.strictEqual(await head.text(), "");
    const post = await preview.dispatch(request("https://www.kutadgubilik.com" + filePath, "POST", "{}"), env, deps);
    assert.strictEqual(post.status, 405);
  }
  const android = await (await preview.dispatch(request("https://www.kutadgubilik.com/.well-known/assetlinks.json"), env, deps)).json();
  assert.strictEqual(android[0].target.package_name, "com.kutadgubilig.kitabevi");
  assert.deepStrictEqual(android[0].target.sha256_cert_fingerprints, [sha]);
  assert.ok(android[0].relation.includes("delegate_permission/common.handle_all_urls"));
  const apple = await (await preview.dispatch(request("https://www.kutadgubilik.com/.well-known/apple-app-site-association"), env, deps)).json();
  assert.strictEqual(apple.applinks.details.length, 1);
  assert.strictEqual(apple.applinks.details[0].appID, "8QU554PCLF.com.kutadgubilig.kitabevi");
  assert.deepStrictEqual(apple.applinks.details[0].paths, ["/c/*"]);
  const denied = ["/.git/config", "/.env", "/.vercel/project.json", "/.well-known/secret", "/.well-known/assetlinks.json.bak"];
  for (const filePath of denied) {
    assert.strictEqual(preview.classifyPath(filePath, "").kind, "deny");
    const response = await preview.dispatch(request("http://127.0.0.1:8787" + filePath), {}, deps);
    assert.strictEqual(response.status, 404);
  }
  for (const filePath of ["/test-results/", "/playwright-report/"]) {
    const response = await preview.dispatch(request("http://127.0.0.1:8787" + filePath), {}, deps);
    assert.strictEqual(response.status, 404);
  }
  assert.strictEqual(preview.classifyPath("/c/Ab3K7xQ2", "").kind, "shared-cart-page");
  const cart = await preview.dispatch(request("http://127.0.0.1:8787/c/Ab3K7xQ2"), {}, deps);
  assert.strictEqual(cart.status, 200);
  assert.match(cart.headers.get("content-type") || "", /text\/html/);
  const html = await cart.text();
  assert.ok(html.includes("shop.js"));
  assert.ok(!html.includes(sha));
}));

Promise.all(jobs).then(() => {
  if (failed) {
    console.error("\n" + failed + " cloudflare preview test(s) failed");
    process.exit(1);
  }
  console.log("cloudflare-preview-tests ok");
});
