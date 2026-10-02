"use strict";

const headers = require("./security-headers.js");
const upload = require("./r2-cover-upload.js");
const coverRead = require("./r2-cover-read.js");
const images = require("../kutadgu-image-storage.js");
const sitemap = require("../kutadgu-sitemap.js");
const sharedCartLinks = require("../kutadgu-shared-cart-links.js");

const PRODUCTION_HOSTS = Object.freeze([
  "kutadgubilik.com",
  "www.kutadgubilik.com"
]);

const HTML_REDIRECTS = Object.freeze({
  "/index.html": "/",
  "/adabiyat.html": "/adabiyat",
  "/romanlar.html": "/romanlar",
  "/tarikhiy-romanlar.html": "/tarikhiy-romanlar",
  "/sheirlar.html": "/sheirlar",
  "/hekayiler.html": "/hekayiler",
  "/dastanlar.html": "/dastanlar",
  "/dunya-edebiyati.html": "/dunya-edebiyati",
  "/adabiyat-roman.html": "/adabiyat-roman",
  "/uyghur-adabiyati.html": "/uyghur-adabiyati",
  "/universal.html": "/universal",
  "/tibb.html": "/tibb",
  "/derslik.html": "/derslik",
  "/terbiye.html": "/terbiye",
  "/dini.html": "/dini",
  "/children.html": "/children",
  "/dictionary.html": "/dictionary",
  "/grammar.html": "/grammar",
  "/books.html": "/books",
  "/order-info.html": "/order-info",
  "/privacy.html": "/privacy",
  "/returns.html": "/returns",
  "/delete-account.html": "/delete-account"
});

const CLEAN_REWRITES = Object.freeze({
  "/books": "/books.html",
  "/order-info": "/order-info.html",
  "/privacy": "/privacy.html",
  "/returns": "/returns.html",
  "/delete-account": "/delete-account.html"
});

const CATEGORY_SLUGS = new Set(sitemap.CATEGORY_HUB_SLUGS);

function normalizeHost(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}

function isProductionHostname(hostname) {
  return PRODUCTION_HOSTS.indexOf(normalizeHost(hostname)) !== -1;
}

function hasDotSegment(pathname) {
  return String(pathname || "")
    .split("/")
    .some((part) => part.startsWith("."));
}

function posthogUpstream(pathname, search) {
  const path = String(pathname || "");
  const query = String(search || "");
  if (path.startsWith("/kbg/static/")) {
    return "https://eu-assets.i.posthog.com/static/" + path.slice("/kbg/static/".length) + query;
  }
  if (path.startsWith("/kbg/array/")) {
    return "https://eu-assets.i.posthog.com/array/" + path.slice("/kbg/array/".length) + query;
  }
  if (path === "/kbg" || path.startsWith("/kbg/")) {
    const rest = path === "/kbg" ? "" : path.slice("/kbg/".length);
    return "https://eu.i.posthog.com/" + rest + query;
  }
  return "";
}

function classifyPath(pathname, search) {
  const path = String(pathname || "");
  const query = String(search || "");
  if (hasDotSegment(path)) return { kind: "deny" };
  const posthog = posthogUpstream(path, query);
  if (posthog) return { kind: "posthog", upstream: posthog };
  if (path === "/api/ai-search") return { kind: "ai-search" };
  if (path === "/api/r2-cover-upload") return { kind: "r2-upload" };
  if (path === "/api/r2-hero-delete") return { kind: "r2-hero-delete" };
  if (path === "/__r2" || path.startsWith("/__r2/")) return { kind: "r2-read" };
  if (path === "/sitemap.xml" || path === "/api/sitemap-index") return { kind: "sitemap-index" };
  if (path === "/sitemap-books.xml" || path === "/api/sitemap-books") {
    const page = path === "/api/sitemap-books" ? pageFromSearch(query) : "1";
    return { kind: "sitemap-books", page };
  }
  const paged = path.match(/^\/sitemap-books-(\d+)\.xml$/);
  if (paged) return { kind: "sitemap-books", page: paged[1] };
  if (Object.prototype.hasOwnProperty.call(HTML_REDIRECTS, path)) {
    return { kind: "redirect", location: HTML_REDIRECTS[path] + query };
  }
  if (isLegacyBookQuery(path, query)) return { kind: "legacy-redirect" };
  if (
    path === "/api/book-public"
    || path === "/book"
    || path === "/book.html"
    || /^\/book\/[^/]+$/.test(path)
  ) {
    return { kind: "book" };
  }
  if (path === "/api/category-listing") return { kind: "category" };
  const slug = path.charAt(0) === "/" ? path.slice(1) : path;
  if (slug && CATEGORY_SLUGS.has(slug)) return { kind: "category", slug };
  if (Object.prototype.hasOwnProperty.call(CLEAN_REWRITES, path)) {
    return { kind: "rewrite", file: CLEAN_REWRITES[path] };
  }
  const shortPage = sharedCartLinks.SHORT_PAGE_RE.exec(path);
  if (shortPage) return { kind: "shared-cart-page", code: shortPage[1] };
  if (path === "/api/shared-cart") return { kind: "shared-cart-create" };
  const shortRead = sharedCartLinks.READ_PATH_RE.exec(path);
  if (shortRead) return { kind: "shared-cart-read", code: shortRead[1] };
  return { kind: "asset", file: path === "/" ? "/index.html" : path };
}

function pageFromSearch(search) {
  try {
    return new URLSearchParams(String(search || "")).get("page") || "1";
  } catch (err) {
    return "1";
  }
}

function isLegacyBookQuery(pathname, search) {
  if (pathname !== "/book" && pathname !== "/book.html" && pathname !== "/api/legacy-book-redirect") {
    return false;
  }
  try {
    return /^\d+$/.test(String(new URLSearchParams(search || "").get("id") || "").trim());
  } catch (err) {
    return false;
  }
}

function hostOf(request) {
  try {
    return new URL(request.url).hostname;
  } catch (err) {
    return "";
  }
}

function applyHeaders(headerList, env, cacheControl, hostname) {
  const out = new Headers(headerList || {});
  if (cacheControl) out.set("Cache-Control", cacheControl);
  headers.applySecurity(out, env, hostname);
  return out;
}

function textResponse(status, body, env, headerList, cacheControl, hostname) {
  const out = applyHeaders(headerList, env, cacheControl, hostname);
  return new Response(body, { status, headers: out });
}

function emptyHead(response) {
  if (!response) return response;
  return new Response(null, { status: response.status, headers: response.headers });
}

async function readAsset(request, env, deps, filePath) {
  if (deps && typeof deps.readAsset === "function") return deps.readAsset(filePath);
  const url = new URL(request.url);
  const target = new URL(filePath, url.origin);
  return env.ASSETS.fetch(new Request(target.toString(), { method: "GET" }));
}

function previewPageSource(request, env) {
  const url = new URL(request.url);
  return {
    r2ReadEnabled: env && env.KUTADGU_R2_READ_ENABLED,
    hostMode: env && env.KUTADGU_HOST_MODE,
    hostname: url.hostname,
    origin: url.origin,
    pathname: url.pathname
  };
}

function decoratePreviewHtml(body, request, env) {
  const source = previewPageSource(request, env);
  return images.injectPreviewBoot(images.rewritePreviewHtmlImages(body, source), source);
}

async function finishAsset(request, env, deps, filePath, statusOverride) {
  const method = String(request.method || "GET").toUpperCase();
  const asset = await readAsset(request, env, deps, filePath);
  const status = statusOverride || asset.status;
  if (status === 404 && filePath !== "/404.html") {
    return finishAsset(request, env, deps, "/404.html", 404);
  }
  const outHeaders = applyHeaders(asset.headers, env, headers.cacheControlForPath(filePath), hostOf(request));
  if (!outHeaders.get("Content-Type") && /\.html$/i.test(filePath)) {
    outHeaders.set("Content-Type", "text/html; charset=utf-8");
  }
  const htmlFile = /\.html$/i.test(filePath);
  if (method !== "HEAD" && htmlFile) {
    const decorated = decoratePreviewHtml(await asset.text(), request, env);
    if (decorated !== undefined) {
      outHeaders.delete("content-length");
      return new Response(decorated, {
        status: status === 404 ? 404 : asset.status,
        headers: outHeaders
      });
    }
  }
  return new Response(method === "HEAD" ? null : asset.body, {
    status: status === 404 ? 404 : asset.status,
    headers: outHeaders
  });
}

async function handleBook(request, env, deps) {
  const method = String(request.method || "GET").toUpperCase();
  const publicBook = deps.publicBook;
  const url = new URL(request.url);
  const req = { url: url.pathname + url.search, method };
  const id = publicBook.parseNumericBookId(req);
  if (!id) {
    return textResponse(404, method === "HEAD" ? null : publicBook.missingBookHtml(), env, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  const result = await publicBook.lookupPublicNumericBook(id, { fetchImpl: deps.fetchImpl });
  if (result.outcome === "found") {
    const shell = await readAsset(request, env, deps, "/book-shell.html");
    if (!shell || shell.status !== 200) {
      return textResponse(503, method === "HEAD" ? null : publicBook.lookupFailureHtml(), env, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }, undefined, hostOf(request));
    }
    const template = await shell.text();
    const html = decoratePreviewHtml(publicBook.applyFoundPublicBookHead(template, id, result.book), request, env);
    return textResponse(200, method === "HEAD" ? null : html, env, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    }, undefined, hostOf(request));
  }
  if (result.outcome === "missing" || result.outcome === "invalid") {
    return textResponse(404, method === "HEAD" ? null : publicBook.missingBookHtml(), env, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  return textResponse(503, method === "HEAD" ? null : publicBook.lookupFailureHtml(), env, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  }, undefined, hostOf(request));
}

async function handleCategory(request, env, deps, route) {
  const method = String(request.method || "GET").toUpperCase();
  const listing = deps.listing;
  const url = new URL(request.url);
  const req = { url: url.pathname + url.search, method };
  const slug = route.slug || listing.parseCategorySlug(req);
  if (!slug) {
    return textResponse(404, method === "HEAD" ? null : listing.failureDocument(""), env, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.FAILURE_CACHE_CONTROL,
      "X-Robots-Tag": "noindex, follow"
    }, undefined, hostOf(request));
  }
  const templateResponse = await readAsset(request, env, deps, "/" + slug + ".html");
  const template = templateResponse && templateResponse.status === 200 ? await templateResponse.text() : "";
  if (!template) {
    return textResponse(503, method === "HEAD" ? null : listing.failureDocument(""), env, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.FAILURE_CACHE_CONTROL,
      "X-Robots-Tag": "noindex, follow"
    }, undefined, hostOf(request));
  }
  try {
    const books = await listing.loadCategoryBooks(slug, { fetchImpl: deps.fetchImpl });
    const html = decoratePreviewHtml(listing.applyCategoryDocument(template, slug, books), request, env);
    return textResponse(200, method === "HEAD" ? null : html, env, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.SUCCESS_CACHE_CONTROL
    }, undefined, hostOf(request));
  } catch (err) {
    return textResponse(503, method === "HEAD" ? null : listing.failureDocument(template), env, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.FAILURE_CACHE_CONTROL,
      "X-Robots-Tag": "noindex, follow"
    }, undefined, hostOf(request));
  }
}

async function handleSitemap(request, env, deps, route) {
  const method = String(request.method || "GET").toUpperCase();
  try {
    const xml = route.kind === "sitemap-index"
      ? await deps.sitemap.buildIndexSitemapXml(deps.fetchImpl)
      : await deps.sitemap.buildBooksSitemapXml(route.page, deps.fetchImpl);
    return textResponse(200, method === "HEAD" ? null : xml, env, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
    }, undefined, hostOf(request));
  } catch (err) {
    const message = route.kind === "sitemap-index" ? "sitemap index unavailable" : "book sitemap unavailable";
    return textResponse(503, method === "HEAD" ? null : message, env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
}

async function handleLegacy(request, env, deps) {
  const url = new URL(request.url);
  const location = deps.seo.legacyNumericIdRedirectPath(url.search);
  if (!location) {
    return textResponse(404, null, env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  return textResponse(308, null, env, {
    Location: location,
    "Cache-Control": "public, max-age=0, must-revalidate"
  }, undefined, hostOf(request));
}

async function handleAi(request, env, deps) {
  const aiSearch = deps.aiSearch;
  const method = String(request.method || "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? "" : await request.text();
  const collected = { statusCode: 200, headers: {}, body: "" };
  const res = {
    headers: collected.headers,
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(payload) { collected.body = payload == null ? "" : String(payload); }
  };
  Object.defineProperty(res, "statusCode", {
    get() { return collected.statusCode; },
    set(value) { collected.statusCode = value; }
  });
  await aiSearch.handleAiSearch({ method, body, url: new URL(request.url).pathname }, res, {
    env,
    fetchImpl: deps.fetchImpl
  });
  const out = new Headers();
  Object.keys(collected.headers).forEach((key) => out.set(key, collected.headers[key]));
  headers.applySecurity(out, env, hostOf(request));
  return new Response(method === "HEAD" ? null : collected.body, {
    status: collected.statusCode || 200,
    headers: out
  });
}

async function handleSharedCartApiRoute(request, env, deps) {
  const method = String(request.method || "GET").toUpperCase();
  const result = await sharedCartLinks.handleSharedCartApi({
    method,
    pathname: new URL(request.url).pathname,
    body: method === "POST" ? await request.text() : "",
    env,
    fetchImpl: deps && deps.fetchImpl
  });
  return textResponse(result.status, method === "HEAD" ? null : JSON.stringify(result.body), env, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, undefined, hostOf(request));
}

async function handleSharedCartPage(request, env, deps) {
  const method = String(request.method || "GET").toUpperCase();
  const asset = await readAsset(request, env, deps, "/cart.html");
  if (!asset || asset.status !== 200 || typeof asset.text !== "function") {
    return textResponse(503, method === "HEAD" ? null : "cart unavailable", env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  let html = await asset.text();
  if (!/<base\b/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (open) => open + '<base href="/">');
  }
  const decorated = decoratePreviewHtml(html, request, env);
  if (decorated !== undefined) html = decorated;
  return textResponse(200, method === "HEAD" ? null : html, env, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, follow"
  }, undefined, hostOf(request));
}

async function handlePosthog(request, env, deps, route) {
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "HEAD") {
    return textResponse(405, method === "HEAD" ? null : "method not allowed", env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const init = { method, headers: {} };
  const contentType = request.headers.get("content-type");
  if (contentType) init.headers["Content-Type"] = contentType;
  if (method === "POST") init.body = await request.arrayBuffer();
  let upstream;
  try {
    upstream = await fetchImpl(route.upstream, init);
  } catch (err) {
    return textResponse(502, method === "HEAD" ? null : "posthog proxy failed", env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  const out = new Headers();
  const type = upstream.headers && upstream.headers.get && upstream.headers.get("content-type");
  if (type) out.set("Content-Type", type);
  headers.applySecurity(out, env, hostOf(request));
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: out
  });
}

function methodAllowed(kind, method) {
  if (kind === "shared-cart-create") return method === "POST";
  if (kind === "shared-cart-read" || kind === "shared-cart-page") return method === "GET" || method === "HEAD";
  if (kind === "redirect" || kind === "legacy-redirect" || kind === "ai-search" || kind === "r2-upload" || kind === "r2-hero-delete") {
    return true;
  }
  if (kind === "posthog") return method === "GET" || method === "POST" || method === "HEAD";
  return method === "GET" || method === "HEAD";
}

async function dispatch(request, env, deps) {
  const source = deps || {};
  const url = new URL(request.url);
  const method = String(request.method || "GET").toUpperCase();
  if (images.requestRefused(url.hostname, env)) {
    const message = images.hostMode(env) === "production"
      ? "production worker does not serve this host"
      : "preview worker does not serve the production host";
    return textResponse(421, message, env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  if (images.hostMode(env) === "production" && normalizeHost(url.hostname) === "kutadgubilik.com") {
    return textResponse(308, null, env, {
      Location: "https://www.kutadgubilik.com" + url.pathname + url.search,
      "Cache-Control": "public, max-age=0, must-revalidate"
    }, undefined, url.hostname);
  }
  const route = classifyPath(url.pathname, url.search);
  if (!methodAllowed(route.kind, method)) {
    return textResponse(405, method === "HEAD" ? null : "method not allowed", env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  if (route.kind === "deny") {
    return textResponse(404, method === "HEAD" ? null : "not found", env, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }, undefined, hostOf(request));
  }
  if (route.kind === "redirect") {
    return textResponse(308, null, env, {
      Location: route.location,
      "Cache-Control": "public, max-age=0, must-revalidate"
    }, undefined, hostOf(request));
  }
  if (route.kind === "legacy-redirect") return handleLegacy(request, env, source);
  if (route.kind === "posthog") return handlePosthog(request, env, source, route);
  if (route.kind === "ai-search") return handleAi(request, env, source);
  if (route.kind === "r2-upload" || route.kind === "r2-hero-delete") {
    const result = route.kind === "r2-hero-delete"
      ? await upload.handleR2HeroDelete(request, env, source)
      : await upload.handleR2CoverUpload(request, env, source);
    const out = applyHeaders(result.headers, env, "", hostOf(request));
    return new Response(method === "HEAD" ? null : result.body, { status: result.status, headers: out });
  }
  if (route.kind === "r2-read") {
    const result = await coverRead.handleR2CoverRead(request, env);
    return new Response(method === "HEAD" ? null : result.body, { status: result.status, headers: result.headers });
  }
  if (route.kind === "sitemap-index" || route.kind === "sitemap-books") {
    return handleSitemap(request, env, source, route);
  }
  if (route.kind === "shared-cart-create" || route.kind === "shared-cart-read") {
    return handleSharedCartApiRoute(request, env, source);
  }
  if (route.kind === "shared-cart-page") return handleSharedCartPage(request, env, source);
  if (route.kind === "book") return handleBook(request, env, source);
  if (route.kind === "category") return handleCategory(request, env, source, route);
  if (route.kind === "rewrite") return finishAsset(request, env, source, route.file);
  return finishAsset(request, env, source, route.file);
}

module.exports = {
  PRODUCTION_HOSTS,
  HTML_REDIRECTS,
  CLEAN_REWRITES,
  normalizeHost,
  isProductionHostname,
  posthogUpstream,
  classifyPath,
  dispatch,
  emptyHead
};
