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
const CATALOG_PAGE_SIZE = 100;
const URLS_PER_SITEMAP = 40000;
const SITEMAP_URL_LIMIT = 50000;
const SITEMAP_BYTE_LIMIT = 50 * 1024 * 1024;
const PRIVATE_PATH_MARKERS = [
  "/admin.html",
  "/admin-quality-preview.html",
  "/account.html",
  "/reset-password.html",
  "/cart.html",
  "/favorites.html",
  "/my-books.html",
  "/book-staff.html"
];

const CATEGORY_HUB_SLUGS = [
  "adabiyat",
  "romanlar",
  "tarikhiy-romanlar",
  "sheirlar",
  "hekayiler",
  "dastanlar",
  "dunya-edebiyati",
  "adabiyat-roman",
  "uyghur-adabiyati",
  "universal",
  "tibb",
  "derslik",
  "terbiye",
  "dini",
  "children",
  "dictionary",
  "grammar",
  "iqtisad",
  "taamlar"
];

const PUBLIC_INFO_SLUGS = [
  "order-info",
  "privacy",
  "returns",
  "delete-account"
];

const PUBLIC_PAGE_PATHS = [
  "/",
  "/books",
  ...CATEGORY_HUB_SLUGS.map(slug => `/${slug}`),
  ...PUBLIC_INFO_SLUGS.map(slug => `/${slug}`)
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
  return `${SITE_ORIGIN}/book/${canonical}`;
}

function rowToSitemapEntry(row) {
  if (!isActiveRow(row)) return null;
  const loc = bookCanonicalUrl(row.id);
  if (!loc) return null;
  const lastmod = trustworthyLastmod(row.updated_at) || trustworthyLastmod(row.created_at);
  return lastmod ? { loc, lastmod, id: String(row.id).trim() } : { loc, id: String(row.id).trim() };
}

function groupedSitemapEnabled(options) {
  const env = options && options.env ? options.env : (typeof process !== "undefined" ? process.env : {});
  return String(env && env.MULTI_VOLUME_BOOKS_ENABLED || "") === "true";
}

function groupedRowToSitemapEntry(row) {
  if (!row || typeof row !== "object") return null;
  const kind = String(row.kind || "book");
  const slug = String(row.slug || row.group_slug || "").trim().toLowerCase();
  const id = String((row.book_id == null ? row.id : row.book_id) == null ? "" : (row.book_id == null ? row.id : row.book_id)).trim();
  let loc = "";
  if (kind === "group" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) loc = `${SITE_ORIGIN}/volume-group/${slug}`;
  else if (kind === "book") loc = bookCanonicalUrl(id);
  if (!loc) return null;
  const lastmod = trustworthyLastmod(row.updated_at) || trustworthyLastmod(row.created_at);
  return lastmod ? { loc, lastmod, id: `${kind}:${kind === "group" ? slug : id}` } : { loc, id: `${kind}:${kind === "group" ? slug : id}` };
}

function memberBookIds(row) {
  const raw = row && row.member_book_ids;
  if (!Array.isArray(raw) || !raw.length) return null;
  const ids = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i += 1) {
    const id = String(raw[i] == null ? "" : raw[i]).trim();
    if (!isCanonicalBookId(id) || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function rememberSitemapEntry(entries, seen, entry) {
  if (!entry || !entry.loc || locLooksPrivate(entry.loc)) return;
  const previous = seen.get(entry.loc);
  if (!previous) {
    seen.set(entry.loc, entry);
    entries.push(entry);
    return;
  }
  if (!previous.lastmod && entry.lastmod) previous.lastmod = entry.lastmod;
}

function entriesFromCatalogUnits(units) {
  const entries = [];
  const seen = new Map();
  (units || []).forEach(row => {
    if (!row || typeof row !== "object") throw new Error("Catalog sitemap unit is incomplete");
    const kind = String(row.kind || "");
    if (kind === "group") {
      const ids = memberBookIds(row);
      if (!ids) throw new Error("Catalog sitemap group omitted its public members");
      const count = Number(row.member_count);
      if (Number.isFinite(count) && count !== ids.length) throw new Error("Catalog sitemap group member count does not match");
      rememberSitemapEntry(entries, seen, groupedRowToSitemapEntry(row));
      ids.forEach(id => {
        const loc = bookCanonicalUrl(id);
        if (!loc) throw new Error("Catalog sitemap member has no canonical URL");
        rememberSitemapEntry(entries, seen, { loc, id: `book:${id}` });
      });
      return;
    }
    if (kind === "book") {
      const entry = groupedRowToSitemapEntry(row);
      if (!entry) throw new Error("Catalog sitemap book has no canonical URL");
      rememberSitemapEntry(entries, seen, entry);
      return;
    }
    throw new Error("Catalog sitemap unit is not a public book or group");
  });
  return entries;
}

async function fetchGroupedSitemapRows(offset, limit, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const start = Math.max(0, Number(offset) || 0);
  const wanted = Math.max(1, Number(limit) || URLS_PER_SITEMAP);
  const rows = [];
  let total = null;
  while (rows.length < wanted) {
    const pageSize = Math.min(FETCH_PAGE_SIZE, wanted - rows.length);
    const response = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/list_public_book_volume_sitemap_entries`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ p_offset: start + rows.length, p_limit: pageSize })
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (err) {}
    if (!response.ok) throw new Error(`Grouped sitemap fetch failed (${response.status})`);
    const batch = Array.isArray(payload) ? payload : (Array.isArray(payload && payload.items) ? payload.items : []);
    const parsedTotal = Number(payload && payload.total);
    if (Number.isFinite(parsedTotal)) total = parsedTotal;
    rows.push(...batch);
    if (batch.length < pageSize || (Number.isFinite(total) && start + rows.length >= total)) break;
  }
  return { rows, total: Number.isFinite(total) ? total : rows.length };
}

async function fetchPublicCatalogUnits(fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const units = [];
  const seen = new Set();
  let total = null;
  let offset = 0;
  while (offset <= 1000000) {
    const response = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/query_public_book_catalog`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        p_query: { offset, limit: CATALOG_PAGE_SIZE, sort: "title" }
      })
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (err) {}
    if (!response.ok || !payload || !Array.isArray(payload.items) || !Number.isFinite(Number(payload.total))) {
      throw new Error(`Catalog sitemap fetch failed (${response && response.status})`);
    }
    const parsedTotal = Number(payload.total);
    if (total == null) total = parsedTotal;
    else if (parsedTotal !== total) throw new Error("Catalog sitemap total changed during the read");
    let added = 0;
    payload.items.forEach(row => {
      const key = String(row && row.unit_id || "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      units.push(row);
      added += 1;
    });
    const hasMore = payload.has_more === true;
    if (!hasMore) break;
    if (!payload.items.length || added === 0) throw new Error("Catalog sitemap page made no progress");
    offset += payload.items.length;
  }
  if (seen.size !== total) throw new Error("Catalog sitemap read did not match the reported total");
  return units;
}

function sitemapEntryBytes(entry) {
  const lastmod = entry && entry.lastmod
    ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`
    : "";
  return Buffer.byteLength(
    `  <url>\n    <loc>${escapeXml(entry && entry.loc)}</loc>${lastmod}\n  </url>`,
    "utf8"
  );
}

function paginateSitemapEntries(entries, options) {
  const requested = Number(options && options.perPage) || URLS_PER_SITEMAP;
  const perPage = Math.min(Math.max(1, requested), SITEMAP_URL_LIMIT);
  const maxBytes = Number(options && options.maxBytes) || SITEMAP_BYTE_LIMIT;
  const overhead = Buffer.byteLength(
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n\n</urlset>\n",
    "utf8"
  );
  const pages = [];
  let current = [];
  let bytes = overhead;
  const sizeWith = (entry, count) => sitemapEntryBytes(entry) + (count ? 1 : 0);
  (entries || []).forEach(entry => {
    if (current.length && (current.length >= perPage || bytes + sizeWith(entry, current.length) > maxBytes)) {
      pages.push(current);
      current = [];
      bytes = overhead;
    }
    bytes += sizeWith(entry, current.length);
    current.push(entry);
  });
  if (!pages.length || current.length) pages.push(current);
  return pages;
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

function bookSitemapLocsForPages(pageCount) {
  const pages = Math.max(1, Number(pageCount) || 1);
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

function appendManagedCategories(xml, categories) {
  const source = String(xml || "");
  if (!source.includes("</urlset>")) return source;
  const extras = (categories || []).filter((row) => {
    const slug = String(row && row.slug || "").trim();
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !source.includes("/" + slug + "<");
  });
  if (!extras.length) return source;
  const block = extras.map((row) => `  <url><loc>${escapeXml(SITE_ORIGIN + "/" + row.slug)}</loc></url>`).join("\n");
  return source.replace("</urlset>", block + "\n</urlset>");
}

async function buildPagesSitemapXml() {
  return buildUrlsetXml(publicPageEntries());
}

async function groupedSitemapPages(fetchImpl) {
  const units = await fetchPublicCatalogUnits(fetchImpl);
  return paginateSitemapEntries(entriesFromCatalogUnits(units));
}

async function buildIndexSitemapXml(fetchImpl, options) {
  if (groupedSitemapEnabled(options)) {
    const pages = await groupedSitemapPages(fetchImpl);
    return buildSitemapIndexXml([`${SITE_ORIGIN}/sitemap-pages.xml`, ...bookSitemapLocsForPages(pages.length)]);
  }
  const total = await countActiveBooks(fetchImpl);
  return buildSitemapIndexXml(indexLocs(total));
}

async function buildBooksSitemapXml(page, fetchImpl, options) {
  const p = parsePageParam(page);
  if (groupedSitemapEnabled(options)) {
    const pages = await groupedSitemapPages(fetchImpl);
    return buildUrlsetXml(pages[p - 1] || []);
  }
  const start = (p - 1) * URLS_PER_SITEMAP;
  const { rows } = await fetchActiveBookRows(start, URLS_PER_SITEMAP, fetchImpl);
  const entries = uniqueBookEntries(rows);
  return buildUrlsetXml(entries);
}

const api = {
  SITE_ORIGIN,
  FETCH_PAGE_SIZE,
  CATALOG_PAGE_SIZE,
  URLS_PER_SITEMAP,
  SITEMAP_URL_LIMIT,
  SITEMAP_BYTE_LIMIT,
  CATEGORY_HUB_SLUGS,
  PUBLIC_INFO_SLUGS,
  PUBLIC_PAGE_PATHS,
  PRIVATE_PATH_MARKERS,
  appendManagedCategories,
  productionOrigin,
  escapeXml,
  isCanonicalBookId,
  isActiveRow,
  trustworthyLastmod,
  bookCanonicalUrl,
  rowToSitemapEntry,
  uniqueBookEntries,
  groupedSitemapEnabled,
  groupedRowToSitemapEntry,
  memberBookIds,
  entriesFromCatalogUnits,
  fetchGroupedSitemapRows,
  fetchPublicCatalogUnits,
  paginateSitemapEntries,
  bookSitemapLocsForPages,
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
