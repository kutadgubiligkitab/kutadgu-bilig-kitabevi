#!/usr/bin/env node
"use strict";
/**
 * Count storefront Supabase REST reads with production writes aborted.
 * Uses a non-local hostname so book_view_stats is not skipped as a local preview.
 * Does not send analytics inserts or view-count writes.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const origin = `http://measure.kutadgu.test:${port}`;

function classify(url, method) {
  const u = String(url);
  const m = String(method || "GET").toUpperCase();
  if (!/supabase\.co\/rest\/v1\//.test(u)) return null;
  if (m !== "GET" && m !== "HEAD") return "write";
  if (/\/book_view_stats/.test(u)) {
    const ids = (u.match(/book_id=in\.\(([^)]*)\)/) || [])[1] || "";
    return ids === "415" || ids === "" && /book_id=eq\.415/.test(u) ? "view_stats_415" : "view_stats_other";
  }
  if (/\/books/.test(u) && /is_active=eq\.false/.test(u)) return "inactive_books";
  if (/\/books/.test(u) && /sales_count=gt\.0/.test(u) && m === "HEAD") return "sales_count_head";
  if (/\/books/.test(u)) return "books";
  return "other_rest";
}

function bookRow(id, extra) {
  return Object.assign({
    id: id,
    title: "كىتاب " + id,
    author: "ئاپتور",
    price: 12,
    stock: 4,
    is_active: true,
    is_available: true,
    is_recommended: true,
    is_new: true,
    sales_count: 2,
    category: "رومان",
    source: "roman",
    created_at: "2024-06-01T00:00:00.000Z",
    image_url: "",
    submission_status: "approved"
  }, extra || {});
}

const NEWEST = [101, 102, 103, 104].map((id) => bookRow(id));
const RECOMMENDED = [201, 202, 203, 204].map((id) => bookRow(id, { is_recommended: true, sales_count: 0 }));
const RELATED = [301, 302, 303].map((id) => bookRow(id, { category: "رومان", source: "roman" }));
const DETAIL = bookRow(415, { title: "تەپسىلات 415", category: "رومان", source: "roman" });
const BOOKS = NEWEST.concat(RECOMMENDED, RELATED, [DETAIL]);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "content-range, Content-Range"
};

function json(body, status, headers) {
  const payload = Array.isArray(body) ? body : [];
  const total = payload.length;
  const end = Math.max(0, total - 1);
  return {
    status: status || 200,
    contentType: "application/json",
    headers: Object.assign({
      "content-range": total ? ("0-" + end + "/" + total) : "*/0"
    }, CORS, headers || {}),
    body: JSON.stringify(payload)
  };
}

async function measure(pagePath) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--host-resolver-rules=MAP measure.kutadgu.test 127.0.0.1"]
  });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__kutadguFetchLog = [];
    const orig = window.fetch.bind(window);
    window.fetch = function (input) {
      try { window.__kutadguFetchLog.push(String(input && input.url || input)); } catch (err) {}
      return orig.apply(this, arguments);
    };
  });
  page.on("pageerror", (err) => console.error("PAGEERROR", pagePath, err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("CONSOLE", pagePath, msg.text());
  });
  const counts = {
    total_rest: 0,
    books: 0,
    view_stats_415: 0,
    view_stats_other: 0,
    sales_count_head: 0,
    inactive_books: 0,
    other_rest: 0,
    writes_blocked: 0
  };
  const urls = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = decodeURIComponent(req.url());
    const method = req.method();
    if (/supabase\.co/.test(url)) {
      if (method !== "GET" && method !== "HEAD") {
        counts.writes_blocked += 1;
        await route.abort();
        return;
      }
      const kind = classify(url, method);
      if (kind && kind !== "write") {
        counts.total_rest += 1;
        counts[kind] += 1;
        urls.push(method + " " + url.replace(/^https?:\/\/[^/]+/, ""));
      }
      if (/\/book_view_stats/.test(url)) {
        const ids = ((url.match(/book_id=in\.\(([^)]*)\)/) || [])[1] || "").split(",").filter(Boolean);
        const rows = ids.map((id) => ({ book_id: id, total_views: 40 }));
        await new Promise((resolve) => setTimeout(resolve, 450));
        await route.fulfill(json(rows));
        return;
      }
      if (method === "HEAD") {
        const total = /sales_count=gt\.0/.test(url) ? 2 : 8;
        await route.fulfill({
          status: 200,
          headers: Object.assign({
            "content-range": "0-0/" + total,
            "content-type": "application/json"
          }, CORS),
          body: ""
        });
        return;
      }
      if (/is_active=eq\.false/.test(url)) {
        await route.fulfill(json([]));
        return;
      }
      if (/\/rest\/v1\/books/.test(url)) {
        let rows = BOOKS.slice();
        const one = url.match(/[?&]id=eq\.(\d+)/);
        const many = url.match(/[?&]id=in\.\(([^)]*)\)/);
        if (/is_recommended=eq\.true/.test(url)) rows = RECOMMENDED.slice();
        else if (one) rows = BOOKS.filter((row) => String(row.id) === one[1]);
        else if (many) {
          const wanted = new Set(many[1].split(","));
          rows = BOOKS.filter((row) => wanted.has(String(row.id)));
        } else if (/order=created_at/.test(url)) rows = NEWEST.slice();
        await route.fulfill(json(rows));
        return;
      }
      await route.fulfill(json([]));
      return;
    }
    if (/posthog|analytics\.google|google-analytics|googletagmanager/.test(url)) {
      await route.abort();
      return;
    }
    const parsed = new URL(url);
    if (parsed.hostname === "measure.kutadgu.test") {
      if (parsed.pathname === "/book/415") {
        let html = fs.readFileSync(path.join(root, "book-shell.html"), "utf8");
        html = html.replace("<body ", '<body data-book-id="415" ');
        await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
        return;
      }
      let rel = parsed.pathname === "/" ? "index.html" : decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
      const abs = path.join(root, rel);
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        await route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
        return;
      }
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".png": "image/png",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
        ".svg": "image/svg+xml"
      };
      await route.fulfill({
        status: 200,
        contentType: types[path.extname(abs)] || "application/octet-stream",
        body: fs.readFileSync(abs)
      });
      return;
    }
    await route.abort();
  });
  const response = await page.goto(origin + pagePath, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  counts.document_status = response ? response.status() : 0;
  counts.page_fetches = await page.evaluate(() => ({
    href: location.href,
    bookId: document.body && document.body.dataset ? document.body.dataset.bookId : "",
    booted: !!window.__kutadguBookViewsBooted,
    title: (document.querySelector("h1") || {}).textContent || "",
    unavailable: !!document.querySelector(".detail-unavailable-panel"),
    related: !!document.querySelector("[data-detail-related]"),
    fetches: window.__kutadguFetchLog || []
  })).catch((err) => ({ error: String(err) }));
  await browser.close();
  return { counts, urls };
}

async function main() {
  const home = await measure("/");
  const book = await measure("/book/415");
  const report = { homepage: home, book415: book };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
