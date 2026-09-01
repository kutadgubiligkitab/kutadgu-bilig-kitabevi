/*
  Stage 7 — server-side book sitemap helpers (Node / Vercel).
  Not loaded in the browser. Catalog rows are fetched in 1000-item Range
  pages so a 20k catalog never becomes one in-memory storefront payload.

  Deploy: Vercel rewrites /sitemap.xml → /api/sitemap-index and
  /sitemap-books.xml → /api/sitemap-books. Static /sitemap-pages.xml is
  the public page list. robots.txt points at the index URL.
*/
"use strict";

const SITE_ORIGIN = "https://www.kutadgubilik.com";
const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const FETCH_PAGE_SIZE = 1000;
const URLS_PER_SITEMAP = 40000;
const PRIVATE_PATH_MARKERS = [
  "/admin.html",
  "/admin-quality-preview.html",
  "/account.html",
  "/reset-password.html",
  "/cart.html",
  "/favorites.html",
  "/my-books.html"
];

const PUBLIC_PAGE_PATHS = [
  "/",
  "/adabiyat.html",
  "/romanlar.html",
  "/tarikhiy-romanlar.html",
  "/sheirlar.html",
  "/hekayiler.html",
  "/dastanlar.html",
  "/dunya-edebiyati.html",
  "/adabiyat-roman.html",
  "/uyghur-adabiyati.html",
  "/universal.html",
  "/tibb.html",
  "/derslik.html",
  "/terbiye.html",
  "/dini.html",
  "/children.html",
  "/order-info.html",
  "/privacy.html",
  "/returns.html"
];

function productionOrigin() {
  return SITE_ORIGIN;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isCanonicalBookId(value) {
  return /^\d+$/.test(String(value == null ? "" : value).trim());
}

function isActiveRow(row) {
  return row && row.is_active === true;
}

function trustworthyLastmod(value) {
  if (value == null || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) return "";
  return date.toISOString().slice(0, 10);
}

function bookCanonicalUrl(id) {
  const canonical = String(id == null ? "" : id).trim();
  if (!isCanonicalBookId(canonical)) return "";
  return `${SITE_ORIGIN}/book.html?id=${encodeURIComponent(canonical)}`;
}

function rowToSitemapEntry(row) {
  if (!isActiveRow(row)) return null;
  const loc = bookCanonicalUrl(row.id);
  if (!loc) return null;
  const lastmod = trustworthyLastmod(row.updated_at) || trustworthyLastmod(row.created_at);
  return lastmod ? { loc, lastmod, id: String(row.id).trim() } : { loc, id: String(row.id).trim() };
}

function uniqueBookEntries(rows) {
  const seen = new Set();
  const entries = [];
  (rows || []).forEach(row => {
    const entry = rowToSitemapEntry(row);
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    entries.push(entry);
  });
  return entries;
}

function locLooksPrivate(loc) {
  const path = String(loc || "");
  return PRIVATE_PATH_MARKERS.some(marker => path.includes(marker));
}

function buildUrlsetXml(entries) {
  const body = (entries || [])
    .filter(entry => entry && entry.loc && !locLooksPrivate(entry.loc))
    .map(entry => {
      const lastmod = entry.lastmod
        ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`
        : "";
      return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function buildSitemapIndexXml(locs) {
  const body = (locs || [])
    .map(loc => `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

function publicPageEntries() {
  return PUBLIC_PAGE_PATHS.map(path => ({
    loc: path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`
  }));
}

function sitemapPageCount(total, perPage = URLS_PER_SITEMAP) {
  const n = Number(total) || 0;
  if (n <= 0) return 1;
  return Math.max(1, Math.ceil(n / perPage));
}

function bookSitemapLocs(total) {
  const pages = sitemapPageCount(total);
  if (pages === 1) return [`${SITE_ORIGIN}/sitemap-books.xml`];
  return Array.from({ length: pages }, (_, i) => `${SITE_ORIGIN}/sitemap-books-${i + 1}.xml`);
}

function indexLocs(total) {
  return [`${SITE_ORIGIN}/sitemap-pages.xml`, ...bookSitemapLocs(total)];
}

function parsePageParam(value) {
  const n = parseInt(String(value == null || value === "" ? "1" : value), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function sliceForSitemapPage(entries, page, perPage = URLS_PER_SITEMAP) {
  const p = parsePageParam(page);
  const start = (p - 1) * perPage;
  return (entries || []).slice(start, start + perPage);
}

async function supabaseGet(path, rangeStart, rangeEnd, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetchFn(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "count=exact",
      "Range-Unit": "items",
      Range: `${rangeStart}-${rangeEnd}`
    }
  });
  const text = await response.text();
  let json = [];
  try {
    json = text ? JSON.parse(text) : [];
  } catch (err) {
    json = [];
  }
  const range = response.headers.get("content-range") || "";
  const totalMatch = range.match(/\/(\d+|\*)$/);
  const total = totalMatch && totalMatch[1] !== "*" ? Number(totalMatch[1]) : (Array.isArray(json) ? json.length : 0);
  if (!response.ok && response.status !== 206 && response.status !== 416) {
    const error = new Error(`Supabase sitemap fetch failed (${response.status})`);
    error.status = response.status;
    error.body = text.slice(0, 300);
    throw error;
  }
  return { rows: Array.isArray(json) ? json : [], total: Number.isFinite(total) ? total : 0, status: response.status };
}

const BOOKS_SELECT = "select=id,legacy_id,is_active,updated_at,created_at&is_active=eq.true&order=id.asc";

async function countActiveBooks(fetchImpl) {
  const { total } = await supabaseGet(`books?${BOOKS_SELECT}`, 0, 0, fetchImpl);
  return total;
}

async function fetchActiveBookRows(rangeStart = 0, limit = URLS_PER_SITEMAP, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const start = Math.max(0, Number(rangeStart) || 0);
  const maxRows = Math.max(1, Number(limit) || URLS_PER_SITEMAP);
  const last = start + maxRows - 1;
  const firstEnd = Math.min(start + FETCH_PAGE_SIZE - 1, last);
  const first = await supabaseGet(`books?${BOOKS_SELECT}`, start, firstEnd, fetchFn);
  const rows = first.rows.slice();
  const total = first.total;
  const stop = Math.min(last, Math.max(total - 1, start));
  for (let from = start + FETCH_PAGE_SIZE; from <= stop; from += FETCH_PAGE_SIZE) {
    const to = Math.min(from + FETCH_PAGE_SIZE - 1, stop);
    const page = await supabaseGet(`books?${BOOKS_SELECT}`, from, to, fetchFn);
    rows.push(...page.rows);
  }
  return { rows, total };
}

async function buildPagesSitemapXml() {
  return buildUrlsetXml(publicPageEntries());
}

async function buildIndexSitemapXml(fetchImpl) {
  const total = await countActiveBooks(fetchImpl);
  return buildSitemapIndexXml(indexLocs(total));
}

async function buildBooksSitemapXml(page, fetchImpl) {
  const p = parsePageParam(page);
  const start = (p - 1) * URLS_PER_SITEMAP;
  const { rows } = await fetchActiveBookRows(start, URLS_PER_SITEMAP, fetchImpl);
  const entries = uniqueBookEntries(rows);
  return buildUrlsetXml(entries);
}

const api = {
  SITE_ORIGIN,
  FETCH_PAGE_SIZE,
  URLS_PER_SITEMAP,
  PUBLIC_PAGE_PATHS,
  PRIVATE_PATH_MARKERS,
  productionOrigin,
  escapeXml,
  isCanonicalBookId,
  isActiveRow,
  trustworthyLastmod,
  bookCanonicalUrl,
  rowToSitemapEntry,
  uniqueBookEntries,
  locLooksPrivate,
  buildUrlsetXml,
  buildSitemapIndexXml,
  publicPageEntries,
  sitemapPageCount,
  bookSitemapLocs,
  indexLocs,
  parsePageParam,
  sliceForSitemapPage,
  countActiveBooks,
  fetchActiveBookRows,
  buildPagesSitemapXml,
  buildIndexSitemapXml,
  buildBooksSitemapXml
};

if (typeof module === "object" && module.exports) module.exports = api;
