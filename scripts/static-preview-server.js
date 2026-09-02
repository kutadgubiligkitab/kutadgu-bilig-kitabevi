#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

const sitemap = require(path.join(root, "kutadgu-sitemap.js"));
const CATEGORY_HUBS = new Set(sitemap.CATEGORY_HUB_SLUGS || []);

function hubSlugFromPathname(pathname) {
  const raw = String(pathname || "");
  if (!raw.startsWith("/") || raw === "/") return "";
  const rest = raw.slice(1);
  if (rest.includes("/") || rest.includes("\\")) return "";
  if (CATEGORY_HUBS.has(rest)) return rest;
  if (rest.endsWith(".html")) {
    const slug = rest.slice(0, -5);
    if (CATEGORY_HUBS.has(slug)) return slug;
  }
  return "";
}

function isSitemapPath(pathname) {
  return pathname === "/sitemap.xml"
    || pathname === "/sitemap-books.xml"
    || /^\/sitemap-books-\d+\.xml$/.test(pathname);
}

function sitemapPageFromPath(pathname) {
  const match = String(pathname || "").match(/^\/sitemap-books-(\d+)\.xml$/i);
  return match ? Number(match[1]) : 1;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/index.html") {
    send(res, 308, { Location: `/${url.search}` }, "");
    return;
  }
  const hubSlug = hubSlugFromPathname(url.pathname);
  if (hubSlug && url.pathname.endsWith(".html")) {
    send(res, 308, { Location: `/${hubSlug}${url.search}` }, "");
    return;
  }
  if (/^\/book\.html$/i.test(url.pathname)) {
    const bookId = String(url.searchParams.get("id") || "").trim();
    if (/^\d+$/.test(bookId)) {
      const params = new URLSearchParams(url.search);
      params.delete("id");
      const rest = params.toString();
      send(res, 308, { Location: `/book/${bookId}${rest ? `?${rest}` : ""}` }, "");
      return;
    }
  }
  if (isSitemapPath(url.pathname)) {
    const build = url.pathname === "/sitemap.xml"
      ? sitemap.buildIndexSitemapXml()
      : sitemap.buildBooksSitemapXml(sitemapPageFromPath(url.pathname));
    build.then((xml) => {
      send(res, 200, { "Content-Type": "application/xml; charset=utf-8" }, xml);
    }).catch(() => {
      send(res, 502, { "Content-Type": "text/plain; charset=utf-8" }, "sitemap proxy failed");
    });
    return;
  }
  let rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (hubSlug && !url.pathname.endsWith(".html")) rel = `${hubSlug}.html`;
  if (/^\/book\/[^/]+\/?$/.test(url.pathname)) rel = "book.html";
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(root, rel);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    send(res, 403, { "Content-Type": "text/plain" }, "forbidden");
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "not found");
      return;
    }
    send(res, 200, { "Content-Type": TYPES[path.extname(abs)] || "application/octet-stream" }, data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`static preview http://127.0.0.1:${port}/`);
});
