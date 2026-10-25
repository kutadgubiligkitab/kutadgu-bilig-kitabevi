"use strict";

const fs = require("fs");
const path = require("path");

const PRODUCTION = "https://www.kutadgubilik.com";
const BOOK_COVER_STORAGE_PATH = "/storage/v1/object/public/book-covers/";
const BOOK_COVER_STUB_PATH = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");
const BOOK_COVER_STUB = fs.readFileSync(BOOK_COVER_STUB_PATH);
const BOOK_SHELL_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "book-shell.html"));
const liveBookCoverPages = new WeakSet();
const mockedBookCoverCounts = new WeakMap();

function isSupabaseBookCoverStorageUrl(url) {
  const raw = String(url || "");
  if (!raw) return false;
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname || raw;
  } catch (err) {}
  return pathname.includes(BOOK_COVER_STORAGE_PATH);
}

function mockedBookCoverRequests(page) {
  return mockedBookCoverCounts.get(page) || 0;
}

function allowLiveBookCovers(page) {
  if (page) liveBookCoverPages.add(page);
}

async function stubNumericBookDocuments(page, ids) {
  const allow = new Set((ids || []).map((id) => String(id)));
  await page.route("**/book/**", async (route) => {
    const req = route.request();
    const method = req.method();
    if (method !== "GET" && method !== "HEAD") return route.continue();
    let pathname = "";
    try {
      pathname = new URL(req.url()).pathname;
    } catch (err) {
      return route.continue();
    }
    const match = pathname.match(/^\/book\/(\d+)\/?$/);
    if (!match || !allow.has(match[1])) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: method === "HEAD" ? "" : BOOK_SHELL_HTML
    });
  });
}

function shouldMockBookCoverStorage(page) {
  return !page || !liveBookCoverPages.has(page);
}

function fulfillBookCoverStorageStub(route, request, page) {
  mockedBookCoverCounts.set(page, mockedBookCoverRequests(page) + 1);
  const method = String(request && request.method() || "GET").toUpperCase();
  const headers = {
    "Cache-Control": "no-store",
    "Content-Length": String(BOOK_COVER_STUB.length)
  };
  if (method === "HEAD") {
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      headers,
      body: ""
    });
  }
  return route.fulfill({
    status: 200,
    contentType: "image/png",
    headers,
    body: BOOK_COVER_STUB
  });
}

async function installBookCoverEgressGuard(page) {
  if (!page || typeof page.route !== "function") return;
  await page.route("**/storage/v1/object/public/book-covers/**", async (route) => {
    const req = route.request();
    const method = String(req.method() || "").toUpperCase();
    const url = req.url();
    if (method !== "GET" && method !== "HEAD") return route.fallback();
    if (!isSupabaseBookCoverStorageUrl(url)) return route.fallback();
    if (!shouldMockBookCoverStorage(page)) return route.continue();
    return fulfillBookCoverStorageStub(route, req, page);
  });
}

function logMockedBookCoverSummary(testInfo, page) {
  const n = mockedBookCoverRequests(page);
  if (!n) return n;
  const label = testInfo && Array.isArray(testInfo.titlePath) ? testInfo.titlePath.join(" › ") : "test";
  console.log(`[e2e] mocked ${n} Supabase book-covers Storage request(s) (${label})`);
  return n;
}

function targetOrigin(page) {
  const url = page.context()._options?.baseURL || PRODUCTION;
  return String(url).replace(/\/+$/, "");
}

function adminCreds() {
  const email = String(process.env.KUTADGU_ADMIN_EMAIL || "").trim();
  const password = String(process.env.KUTADGU_ADMIN_PASSWORD || "").trim();
  if (!email || !password) return null;
  return { email, password };
}

function memberCreds() {
  const email = String(process.env.KUTADGU_MEMBER_EMAIL || "").trim();
  const password = String(process.env.KUTADGU_MEMBER_PASSWORD || "").trim();
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Block catalog/order/analytics writes. Allow GET catalog + Auth token exchange.
 * Default maintenance_mode to false so the suite does not depend on the live flag.
 * Default also stubs Supabase public book-covers Storage GETs/HEADs with a tiny local PNG
 * so CI does not download real cover bytes. Pass { allowLiveBookCovers: true } to opt out.
 * Repeated read probes (view totals, catalog availability, inactive index, sales HEAD)
 * are fulfilled locally. Live select=* book GETs still continue. A missing grouped
 * catalog fixture is not forwarded as the original RPC; call allowLiveCatalogReads
 * before a test that intentionally reads that RPC.
 */
function isBookViewStatsRead(url, method) {
  const verb = String(method || "").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return false;
  return String(url || "").includes("/rest/v1/book_view_stats");
}

function isCatalogAvailabilityProbe(url, method) {
  const verb = String(method || "").toUpperCase();
  if (verb !== "HEAD" && verb !== "GET") return false;
  let parsed;
  try {
    parsed = new URL(String(url || ""), "https://example.supabase.co");
  } catch (err) {
    return false;
  }
  if (!parsed.pathname.endsWith("/books")) return false;
  const select = parsed.searchParams.get("select") || "";
  if (select !== "id") return false;
  if ((parsed.searchParams.get("is_active") || "") !== "eq.true") return false;
  if (parsed.searchParams.has("sales_count")) return false;
  const keys = [...parsed.searchParams.keys()];
  return keys.every((key) => key === "select" || key === "is_active");
}

function isPositiveSalesHead(url, method) {
  if (String(method || "").toUpperCase() !== "HEAD") return false;
  let parsed;
  try {
    parsed = new URL(String(url || ""), "https://example.supabase.co");
  } catch (err) {
    return false;
  }
  if (!parsed.pathname.endsWith("/books")) return false;
  return (parsed.searchParams.get("select") || "") === "id" && (parsed.searchParams.get("sales_count") || "") === "gt.0";
}

function isInactiveIndexRead(url, method) {
  const verb = String(method || "").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return false;
  let parsed;
  try {
    parsed = new URL(String(url || ""), "https://example.supabase.co");
  } catch (err) {
    return false;
  }
  if (!parsed.pathname.endsWith("/books")) return false;
  const select = parsed.searchParams.get("select") || "";
  return select === "id,legacy_id" && (parsed.searchParams.get("is_active") || "") === "eq.false";
}

const CATALOG_BRIDGE_HEADER = "x-kutadgu-catalog-bridge";
const CATALOG_INDEX_PAGE = 1000;

function isCatalogBridgeProbe(req) {
  const header = String(req.headers()[CATALOG_BRIDGE_HEADER] || "");
  if (!header) return false;
  try {
    return new URL(req.url()).pathname.endsWith("/books");
  } catch (err) {
    return false;
  }
}

function quotePostgrestValue(value) {
  return `"${String(value).replace(/["\\]/g, "")}"`;
}

function remoteOrderForCatalogSort(mode) {
  if (mode === "priceLow") return "price.asc.nullslast,id.asc";
  if (mode === "priceHigh") return "price.desc.nullslast,id.asc";
  if (mode === "title") return "title.asc,id.asc";
  if (mode === "author") return "author.asc,id.asc";
  if (mode === "bestseller") return "sales_count.desc,created_at.desc.nullslast,id.asc";
  if (mode === "recommended") return "is_recommended.desc,created_at.desc.nullslast,id.asc";
  return "created_at.desc.nullslast,id.asc";
}

function postgrestSearchPattern(value) {
  const text = String(value || "").trim().replace(/[%\s]+/g, " ");
  if (!text) return "";
  return `*${text.split(" ").filter(Boolean).join("*")}*`;
}

function numericCatalogIds(ids) {
  const out = [];
  (Array.isArray(ids) ? ids : []).forEach((raw) => {
    const text = String(raw == null ? "" : raw).trim();
    const prefixed = /^(?:book|group):([1-9][0-9]*)$/.exec(text);
    const id = prefixed ? prefixed[1] : (/^[1-9][0-9]*$/.test(text) ? text : "");
    if (id && out.indexOf(id) < 0) out.push(id);
  });
  return out;
}

function catalogBooksUrl(origin, query, flags) {
  const params = new URLSearchParams();
  params.set("select", flags && flags.discoveryIndex ? "id,is_active" : "*");
  params.set("is_active", "eq.true");
  const ids = numericCatalogIds(query && query.ids);
  if (query && Array.isArray(query.ids)) params.set("id", ids.length ? `in.(${ids.join(",")})` : "eq.-1");
  if (query && query.source) params.set("source", `eq.${query.source}`);
  else if (query && Array.isArray(query.sources) && query.sources.length) {
    params.set("source", `in.(${query.sources.map(quotePostgrestValue).join(",")})`);
  }
  if (query && query.category) params.set("category", `eq.${query.category}`);
  if (query && query.min_price != null && query.min_price !== "" && Number.isFinite(Number(query.min_price))) {
    params.append("price", `gte.${query.min_price}`);
  }
  if (query && query.max_price != null && query.max_price !== "" && Number.isFinite(Number(query.max_price))) {
    params.append("price", `lte.${query.max_price}`);
  }
  if (query && query.bestseller) params.set("sales_count", "gt.0");
  if (query && query.new_only) params.set("is_new", "eq.true");
  if (query && query.recommended) params.set("is_recommended", "eq.true");
  const creditId = String(query && query.credit_id || "").trim().toLowerCase();
  const creditRole = String(query && query.credit_role || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(creditId) && creditRole) {
    params.set("select", "*,book_credits!inner(identity_id,role)");
    params.set("book_credits.identity_id", `eq.${creditId}`);
    params.set("book_credits.role", `eq.${creditRole}`);
  }
  const pattern = postgrestSearchPattern(query && query.search);
  if (pattern) {
    const columns = ["title", "author", "category", "translator", "publisher"];
    const parts = columns.map((column) => `${column}.ilike.${pattern}`);
    const digits = String(query.search || "").replace(/[\s-]+/g, "").toUpperCase();
    if (/^[0-9X]{10}$/.test(digits) || /^[0-9X]{13}$/.test(digits)) {
      parts.push(`isbn.ilike.*${digits}*`);
      parts.push(`isbn.eq.${digits}`);
    }
    params.set("or", `(${parts.join(",")})`);
  }
  params.set("order", flags && flags.discoveryIndex ? "id.asc" : remoteOrderForCatalogSort(query && query.sort));
  return `${origin}/rest/v1/books?${params.toString()}`;
}

function totalFromContentRange(value) {
  const match = String(value || "").match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

function nextIndexCursor(from, chunkLength, contentRange, status, requested) {
  const header = String(contentRange || "").trim();
  const ranged = /^(\d+)-(\d+)\/(\d+|\*)$/.exec(header);
  const star = /^\*\/(\d+)$/.exec(header);
  let total = null;
  let end = null;
  const code = Number(status) || 0;
  const size = Math.max(0, Number(chunkLength) || 0);
  const start = Math.max(0, Number(from) || 0);
  const ask = Math.max(1, Number(requested) || CATALOG_INDEX_PAGE);
  if (ranged) {
    end = Number(ranged[2]);
    if (ranged[3] !== "*") total = Number(ranged[3]);
  } else if (star) total = Number(star[1]);
  if (!size) {
    if (Number.isFinite(total) && start < total) return { done: false, truncated: true, next: start, total };
    return { done: true, truncated: false, next: start, total };
  }
  const next = Number.isFinite(end) ? end + 1 : start + size;
  if (Number.isFinite(total)) {
    if (next >= total) return { done: true, truncated: false, next, total };
    if (next <= start) return { done: false, truncated: true, next: start, total };
    return { done: false, truncated: false, next, total };
  }
  if (code === 206 && size < ask) return { done: false, truncated: true, next, total: null };
  if (size < ask) return { done: true, truncated: false, next, total: null };
  return { done: false, truncated: false, next, total: null };
}

function catalogItemFromBookRow(row) {
  if (!row || typeof row !== "object") return null;
  const kind = String(row.kind || row.catalogKind || "book") === "group" ? "group" : "book";
  const id = String(row.id == null ? "" : row.id).trim();
  const groupId = String(row.group_id == null ? "" : row.group_id).trim();
  if (kind === "group" && !/^[1-9][0-9]*$/.test(groupId)) return null;
  if (!/^[1-9][0-9]*$/.test(id)) return null;
  const slug = String(row.group_slug || row.slug || "").trim();
  const unitKey = kind === "group" ? `group:${groupId}` : `book:${id}`;
  return {
    ...row,
    kind,
    id,
    group_id: kind === "group" ? groupId : null,
    group_slug: kind === "group" ? slug : "",
    slug: kind === "group" ? slug : row.slug,
    unit_key: unitKey,
    unit_id: unitKey,
    representative_book_id: row.representative_book_id || id,
    member_book_ids: Array.isArray(row.member_book_ids) ? row.member_book_ids : [],
    member_prices: Array.isArray(row.member_prices) ? row.member_prices : [],
    member_count: Number(row.member_count) || (Array.isArray(row.member_book_ids) ? row.member_book_ids.length : 0),
    is_active: row.is_active !== false
  };
}

async function readBridgedBooks(page, route, url, from, to) {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const incoming = route.request().headers();
  let contentRange = "";
  const onResponse = (response) => {
    if (response.request().headers()[CATALOG_BRIDGE_HEADER] !== token) return;
    contentRange = response.headers()["content-range"] || contentRange;
  };
  page.on("response", onResponse);
  try {
    const result = await page.evaluate(async ({ url: target, from: start, to: end, header, token: marker, apikey, authorization }) => {
      const headers = {
        Accept: "application/json",
        Prefer: "count=exact",
        Range: `${start}-${end}`,
        "Range-Unit": "items",
        [header]: marker
      };
      if (apikey) headers.apikey = apikey;
      if (authorization) headers.Authorization = authorization;
      const response = await fetch(target, { method: "GET", headers });
      return {
        status: response.status,
        contentRange: response.headers.get("content-range") || "",
        body: await response.text()
      };
    }, {
      url,
      from,
      to,
      header: CATALOG_BRIDGE_HEADER,
      token,
      apikey: incoming.apikey || "",
      authorization: incoming.authorization || ""
    });
    return { ...result, contentRange: contentRange || result.contentRange || "" };
  } catch (err) {
    return null;
  } finally {
    page.off("response", onResponse);
  }
}

const LIVE_CATALOG_READS = Symbol.for("kutadgu.allowLiveCatalogReads");

function allowLiveCatalogReads(page) {
  if (page) page[LIVE_CATALOG_READS] = true;
}

function allowsLiveCatalogReads(page) {
  return !!(page && page[LIVE_CATALOG_READS]);
}

async function continueOriginal(route) {
  try { await route.continue(); } catch (err) {}
}

function unmockedBridge(result) {
  if (!result || result.status !== 599) return false;
  return /unmocked_catalog_bridge/.test(String(result.body || ""));
}

async function rejectCatalogBridge(route, result) {
  const status = result && Number.isFinite(Number(result.status)) && Number(result.status) >= 400
    ? Number(result.status)
    : 599;
  const body = result && result.body
    ? String(result.body)
    : JSON.stringify({ message: "catalog_bridge_failed", code: "catalog_bridge_failed" });
  try {
    await route.fulfill({
      status,
      contentType: "application/json",
      body
    });
  } catch (err) {}
}

async function bridgeQueryPublicBookCatalog(page, route) {
  let payload = {};
  try { payload = route.request().postDataJSON() || {}; } catch (err) { payload = {}; }
  const query = payload.p_query && typeof payload.p_query === "object" ? payload.p_query : {};
  const offset = Math.max(0, Number(query.offset) || 0);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 24));
  let origin = "https://fxlojnqwyojqjskfggmh.supabase.co";
  try { origin = new URL(route.request().url()).origin; } catch (err) {}
  const url = catalogBooksUrl(origin, query);
  let result;
  try {
    result = await readBridgedBooks(page, route, url, offset, offset + limit - 1);
  } catch (err) {
    return rejectCatalogBridge(route, null);
  }
  if (!result || unmockedBridge(result)) {
    if (unmockedBridge(result) && allowsLiveCatalogReads(page)) return continueOriginal(route);
    return rejectCatalogBridge(route, result);
  }
  if (result.status === 416) {
    const total = totalFromContentRange(result.contentRange);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: Number.isFinite(total) ? total : offset, has_more: false })
    });
  }
  if (result.status >= 400) {
    return route.fulfill({
      status: result.status,
      contentType: "application/json",
      body: result.body || JSON.stringify({ message: "catalog_failed" })
    });
  }
  let rows = [];
  try { rows = JSON.parse(result.body || "[]"); } catch (err) { rows = null; }
  if (!Array.isArray(rows)) {
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "catalog_invalid" })
    });
  }
  let items = rows.map(catalogItemFromBookRow).filter(Boolean);
  if (offset === 0 && items.length > limit) items = items.slice(0, limit);
  const exact = totalFromContentRange(result.contentRange);
  const total = Number.isFinite(exact) ? exact : null;
  const hasMore = Number.isFinite(exact) ? offset + items.length < exact : items.length === limit;
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items, total, has_more: hasMore })
  });
}

async function bridgeDiscoveryUnitIds(page, route) {
  let payload = {};
  try { payload = route.request().postDataJSON() || {}; } catch (err) { payload = {}; }
  const start = Math.max(0, Number(payload.p_offset) || 0);
  const limit = Math.max(1, Math.min(5000, Number(payload.p_limit) || 5000));
  let origin = "https://fxlojnqwyojqjskfggmh.supabase.co";
  try { origin = new URL(route.request().url()).origin; } catch (err) {}
  const url = catalogBooksUrl(origin, {}, { discoveryIndex: true });
  const keys = [];
  const seen = new Set();
  let from = start;
  let guard = 0;
  while (keys.length < limit && guard < 10000) {
    guard += 1;
    const ask = Math.min(CATALOG_INDEX_PAGE, limit - keys.length);
    let result;
    try {
      result = await readBridgedBooks(page, route, url, from, from + ask - 1);
    } catch (err) {
      return rejectCatalogBridge(route, null);
    }
    if (!result || unmockedBridge(result)) {
      if (unmockedBridge(result) && allowsLiveCatalogReads(page)) return continueOriginal(route);
      return rejectCatalogBridge(route, result);
    }
    if (result.status >= 400 && result.status !== 416) {
      return route.fulfill({
        status: result.status,
        contentType: "application/json",
        body: result.body || JSON.stringify({ message: "catalog_failed" })
      });
    }
    let rows = [];
    if (result.status !== 416) {
      try { rows = JSON.parse(result.body || "[]"); } catch (err) { rows = null; }
      if (!Array.isArray(rows)) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "catalog_invalid" })
        });
      }
    }
    rows.forEach((row) => {
      if (!row || row.is_active === false) return;
      const id = String(row.id == null ? "" : row.id).trim();
      if (!/^[1-9][0-9]*$/.test(id)) return;
      const key = String(row.kind || "") === "group" && /^[1-9][0-9]*$/.test(String(row.group_id || ""))
        ? `group:${row.group_id}`
        : `book:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
    const step = nextIndexCursor(from, rows.length, result.contentRange, result.status, ask);
    if (step.truncated) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Catalog id index was truncated" })
      });
    }
    if (step.done || keys.length >= limit) break;
    if (!(step.next > from)) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Catalog id index did not advance" })
      });
    }
    from = step.next;
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(keys.slice(0, limit))
  });
}

const CATEGORY_DIRECTORY_ROWS = [
  { source: "romanlar.html", label: "رومانلار" },
  { source: "tarikhiy-romanlar.html", label: "تارىخىي رومانلار" },
  { source: "sheirlar.html", label: "شېئىرلار" },
  { source: "hekayiler.html", label: "ھېكايىلەر" },
  { source: "dastanlar.html", label: "داستانلار" },
  { source: "dunya-edebiyati.html", label: "دۇنيا ئەدەبىياتى" },
  { source: "adabiyat-roman.html", label: "ئەدەبىيات رومانلىرى" },
  { source: "uyghur-adabiyati.html", label: "ئۇيغۇر ئەدەبىياتى" },
  { source: "universal.html", label: "ئۇنىۋېرسال" },
  { source: "tibb.html", label: "تېبابەت ۋە ساغلاملىق" },
  { source: "derslik.html", label: "دەرسلىك" },
  { source: "terbiye.html", label: "پەرزەنت تەربىيەسى" },
  { source: "dini.html", label: "دىنىي كىتابلار" },
  { source: "children.html", label: "بالىلار كىتابلىرى" },
  { source: "dictionary.html", label: "لۇغەت" },
  { source: "grammar.html", label: "گرامماتىكا" },
  { source: "iqtisad.html", label: "ئىقتىساد" },
  { source: "taamlar.html", label: "تائاملار" }
];

function categoryDirectoryBody(extraRows) {
  const rows = CATEGORY_DIRECTORY_ROWS.concat(extraRows || []).filter((row) => row && row.source && row.label);
  const categories = rows.filter((row) => !row.is_hidden && !row.retired).map((row, index) => ({
    id: index + 1,
    slug: String(row.source).replace(/\.html$/, ""),
    source: row.source,
    label: row.label,
    summary: row.summary || "",
    icon: row.icon || "📚",
    sort_order: index + 1,
    is_hidden: false,
    retired: false
  }));
  return { categories, direct: categories.map((row) => ({ ...row })), redirects: [] };
}

async function installCategoryDirectoryFixture(page, options = {}) {
  const body = options.body || categoryDirectoryBody(options.extra);
  const hold = options.hold || null;
  await page.route("**/rpc/list_public_book_categories**", async (route) => {
    if (hold && typeof hold.wait === "function") await hold.wait();
    const next = typeof options.bodyFor === "function" ? options.bodyFor() : body;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(next)
    });
  });
  return body;
}

async function installReadSafeNetwork(page, opts = {}) {
  if (opts && opts.allowLiveBookCovers) allowLiveBookCovers(page);
  await installBookCoverEgressGuard(page);
  await page.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const isWrite = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
    if (!isWrite) {
      if ((method === "GET" || method === "HEAD") && isSupabaseBookCoverStorageUrl(url)) {
        if (!shouldMockBookCoverStorage(page)) return route.continue();
        return fulfillBookCoverStorageStub(route, req, page);
      }
      if (url.includes("/rest/v1/store_settings")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ key: "maintenance_mode", value: false }])
        });
      }
      if (url.includes("/rest/v1/store_announcements")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]"
        });
      }
      if (url.includes("/rest/v1/store_announcement_settings")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ id: 1, rotation_interval_seconds: 5 }])
        });
      }
      if (
        url.includes("/rest/v1/store_hero_settings") ||
        url.includes("/rest/v1/store_hero_store_slides") ||
        url.includes("/rest/v1/store_hero_campaigns") ||
        url.includes("/rest/v1/store_homepage_about") ||
        url.includes("/rest/v1/store_shop_hours")
      ) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ code: "PGRST205", message: "Could not find the table" })
        });
      }
      if (isBookViewStatsRead(url, method)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]"
        });
      }
      if (isCatalogAvailabilityProbe(url, method)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: method === "HEAD" ? "" : "[]"
        });
      }
      if (isPositiveSalesHead(url, method)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "*/0" },
          body: ""
        });
      }
      if (isInactiveIndexRead(url, method)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "*/0" },
          body: "[]"
        });
      }
      return route.continue();
    }
    if (url.includes("/auth/v1/")) return route.continue();
    if (/\/rest\/v1\/(analytics_events|orders|books|profiles|admin_users|store_settings|store_announcements|store_announcement_settings|store_homepage_about|store_shop_hours|rpc\/create_member_order)/.test(url)) {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: "[]"
      });
    }
    if (method === "POST" && /\/rpc\/query_public_book_catalog(?:\?|$)/.test(url)) {
      return bridgeQueryPublicBookCatalog(page, route);
    }
    if (method === "POST" && /\/rpc\/list_public_book_volume_discovery_unit_ids(?:\?|$)/.test(url)) {
      return bridgeDiscoveryUnitIds(page, route);
    }
    return route.continue();
  });
  await installCatalogBridgeProbe(page);
}

function catalogBridgeMiss(route) {
  if (!isCatalogBridgeProbe(route.request())) return route.fallback();
  return route.fulfill({
    status: 599,
    contentType: "application/json",
    body: JSON.stringify({ message: "unmocked_catalog_bridge", code: "unmocked_catalog_bridge" })
  });
}

async function installCatalogBridgeProbe(target) {
  await target.route("**/rest/v1/books**", catalogBridgeMiss);
}

async function installCatalogRpcBridge(context) {
  await installCatalogBridgeProbe(context);
  await context.route("**/rest/v1/rpc/query_public_book_catalog**", async (route) => {
    const frame = route.request().frame();
    const page = frame && frame.page();
    if (!page) return rejectCatalogBridge(route, null);
    return bridgeQueryPublicBookCatalog(page, route);
  });
  await context.route("**/rest/v1/rpc/list_public_book_volume_discovery_unit_ids**", async (route) => {
    const frame = route.request().frame();
    const page = frame && frame.page();
    if (!page) return rejectCatalogBridge(route, null);
    return bridgeDiscoveryUnitIds(page, route);
  });
}

async function waitForShop(page) {
  await page.waitForFunction(() => {
    if (!window.kutadguShop || typeof window.kutadguShop.add !== "function") return false;
    if (Array.isArray(window.KUTADGU_LIVE_CATALOG)) return true;
    return false;
  }, { timeout: 45_000 });
}

async function clearShopStorage(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("kutadgu-cart-v1");
      localStorage.removeItem("kutadgu-cart-display-v1");
      localStorage.removeItem("kutadgu-favorites-v1");
      localStorage.removeItem("kutadgu-recent-v1");
      localStorage.removeItem("kutadgu-customer-v1");
      localStorage.removeItem("kutadgu-shop-owner-v1");
    } catch (e) {}
  });
}

async function readCart(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]");
    } catch (e) {
      return [];
    }
  });
}

async function readFavs(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("kutadgu-favorites-v1") || "[]");
    } catch (e) {
      return [];
    }
  });
}

async function badgeCount(page) {
  const n = await page.locator(".cart-count").first().textContent().catch(() => "0");
  return Number(String(n || "0").trim()) || 0;
}

async function openFresh(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForShop(page);
}

function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err && err.message ? err.message : err)));
  return errors;
}

function detailPathFor(id) {
  const raw = String(id || "").trim();
  if (/^\d+$/.test(raw)) return `/book/${raw}`;
  return `/book.html?id=${encodeURIComponent(raw)}`;
}

function legacyBookHtmlPath(id) {
  return `/book.html?id=${encodeURIComponent(String(id || "").trim())}`;
}

function searchTokenFromTitle(title) {
  const token = String(title || "")
    .replace(/[%_*,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (token.length < 2) {
    throw new Error(`[e2e] discovered book title is too short to search: ${JSON.stringify(title)}`);
  }
  return token;
}

function packLiveBook(row) {
  const id = String(row && row.id != null ? row.id : "").trim();
  const title = String(row && row.title ? row.title : "").trim();
  const legacyId = String(row && (row.legacyId || row.legacy_id) ? (row.legacyId || row.legacy_id) : "").trim();
  if (!id || !title) return null;
  return {
    id,
    title,
    legacyId,
    detailPath: detailPathFor(id),
    legacyDetailPath: legacyId ? detailPathFor(legacyId) : "",
    searchToken: searchTokenFromTitle(title)
  };
}

async function readLiveCatalogPage(page) {
  return page.evaluate(async () => {
    if (!window.kutadguShop || typeof window.kutadguShop.queryCatalog !== "function") {
      return { error: "kutadguShop.queryCatalog is not available" };
    }
    try {
      const result = await window.kutadguShop.queryCatalog({ offset: 0, pageSize: 1, sort: "title" });
      const book = result && Array.isArray(result.items) ? result.items[0] : null;
      if (!book) return { empty: true, total: result && result.total };
      return {
        id: book.id,
        title: book.title,
        legacyId: book.legacyId || book.legacy_id || ""
      };
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  });
}

async function fetchFirstLegacyCatalogRow(page) {
  return page.evaluate(async () => {
    const cfg = window.KUTADGU_SUPABASE_CONFIG || {};
    const url = String(cfg.url || "").replace(/\/+$/, "");
    const key = String(cfg.anonKey || cfg.publishableKey || "");
    if (!url || !key) return { missing: "supabase-config" };
    try {
      const endpoint = `${url}/rest/v1/books?select=id,title,legacy_id&is_active=eq.true&legacy_id=not.is.null&order=id.asc`;
      const response = await fetch(endpoint, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "count=exact",
          "Range-Unit": "items",
          Range: "0-0"
        }
      });
      if (!response.ok) return { error: `HTTP ${response.status}` };
      const rows = await response.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return { empty: true };
      return { id: row.id, title: row.title, legacy_id: row.legacy_id };
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  });
}

/**
 * Discover one existing active storefront book via the same queryCatalog path
 * the app uses (pageSize 1, title.asc). Does not write to the catalog.
 * Cached per Playwright page so a test does not repeat the lookup.
 */
async function discoverLiveBook(page) {
  allowLiveCatalogReads(page);
  const cached = page.__kutadguLiveBook;
  if (cached && cached.id) return cached;
  const shopReady = await page.evaluate(() => !!(window.kutadguShop && typeof window.kutadguShop.queryCatalog === "function")).catch(() => false);
  if (!shopReady) await openFresh(page, "/");
  else await waitForShop(page);
  const row = await readLiveCatalogPage(page);
  if (row && row.error) {
    throw new Error(`[e2e] live catalog lookup failed: ${row.error}`);
  }
  const book = packLiveBook(row);
  if (!book) {
    throw new Error("[e2e] No active catalog book available for live E2E (queryCatalog pageSize=1, sort=title).");
  }
  page.__kutadguLiveBook = book;
  return book;
}

/**
 * Live book that has a non-empty legacy_id. Returns null when none exists
 * so the caller can skip — never inserts a catalog row.
 */
async function discoverLiveBookWithLegacy(page) {
  const book = await discoverLiveBook(page);
  if (book.legacyId) return book;
  const extra = await fetchFirstLegacyCatalogRow(page);
  if (!extra || extra.missing || extra.empty || extra.error) return null;
  const packed = packLiveBook(extra);
  if (!packed || !packed.legacyId) return null;
  return packed;
}

async function waitForHydratedCartTitle(page, expectedTitle) {
  const want = String(expectedTitle || "").trim();
  try {
    await page.waitForFunction((expected) => {
      const t = document.querySelector("#cartItems .cart-title")?.textContent?.trim() || "";
      if (!t) return false;
      if (!expected) return true;
      return t === expected || t.includes(expected);
    }, want, { timeout: 20_000 });
  } catch (err) {
    const actual = await page.locator("#cartItems .cart-title").first().textContent().catch(() => "");
    throw new Error(
      `[e2e] cart line did not hydrate live book title. actual=${JSON.stringify(String(actual || "").trim())} expected=${JSON.stringify(want)}`
    );
  }
}

async function waitForDetailTitle(page, expectedTitle) {
  const want = String(expectedTitle || "").trim();
  try {
    await page.waitForFunction((expected) => {
      const h1 = document.querySelector(".book-detail-info h1");
      const t = h1 && h1.textContent && h1.textContent.trim();
      if (!t || t === "كىتاب" || t.length < 2) return false;
      if (!expected) return true;
      return t === expected || t.includes(expected) || expected.includes(t);
    }, want, { timeout: 45_000 });
  } catch (err) {
    const actual = await page.locator(".book-detail-info h1").textContent().catch(() => "");
    throw new Error(
      `[e2e] book detail title stayed at placeholder or did not match. actual=${JSON.stringify(String(actual || "").trim())} expected=${JSON.stringify(want || "(any non-placeholder title)")}`
    );
  }
  return page.locator(".book-detail-info h1").innerText();
}

/** Control carousel mode payloads for both static catalog and remote queries. */
async function installCarouselCatalogStub(page, flags) {
  const recommended = flags.recommended === true;
  const newest = flags.newest === true;
  const bestseller = flags.bestseller === true;
  const bookCount = Math.max(1, Number(flags.bookCount) || 1);
  const featuredCount = flags.featuredCount == null ? null : Math.max(0, Number(flags.featuredCount) || 0);
  const failFeatured = flags.failFeatured === true;
  const failModes = {
    recommended: flags.failRecommended === true,
    newest: flags.failNewest === true,
    bestseller: flags.failBestseller === true
  };
  const holdNewest = flags.holdNewest === true;
  const passIdIn = flags.passIdIn === true;
  const pageRecommended = flags.pageRecommended === true;
  const holdRecommendedAppend = flags.holdRecommendedAppend === true;
  const recommendedTotal = Math.max(1, Number(flags.recommendedTotal) || 24);
  const recommendedStartId = Number(flags.recommendedStartId) || 97000;
  await page.addInitScript(({ recommended, newest, bestseller, bookCount, featuredCount, failFeatured, failModes, holdNewest, passIdIn, pageRecommended, holdRecommendedAppend, recommendedTotal, recommendedStartId }) => {
    window.__kutadguPositiveSalesCount = bestseller ? 3 : 0;
    let catalog = [];
    Object.defineProperty(window, "KITAP_CATALOG", {
      configurable: true,
      enumerable: true,
      get() { return catalog; },
      set(arr) {
        let rows = Array.isArray(arr) ? arr : [];
        if (featuredCount != null) rows = rows.slice(0, featuredCount);
        catalog = rows.map((book, i) => ({
          ...book,
          is_recommended: !!(recommended && i < bookCount),
          is_new: !!(newest && i < bookCount),
          sales_count: bestseller && i < bookCount ? 4 : 0
        }));
      }
    });
    const origFetch = window.fetch.bind(window);
    const jsonResponse = (rows, head, contentRange) => {
      const list = Array.isArray(rows) ? rows : [];
      const last = Math.max(0, list.length - 1);
      return new Response(head ? null : JSON.stringify(list), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-range": contentRange || (list.length ? `0-${last}/${list.length}` : "*/0")
        }
      });
    };
    const stubBook = (extra) => ({
      id: extra.id || 91001,
      title: extra.title || "Carousel Stub Book",
      author: "تەست",
      price: 25,
      category: "رومانلار",
      image_url: "sample-book-cover.png",
      is_active: true,
      is_recommended: extra.is_recommended === true,
      is_new: extra.is_new === true,
      sales_count: Number(extra.sales_count) || 0
    });
    const stubBooks = (extra) => Array.from({ length: bookCount }, (_, i) => stubBook({
      ...extra,
      id: (extra.id || 91001) + i,
      title: `${extra.title || "Carousel Stub Book"} ${i + 1}`
    }));
    const abortError = () => {
      const error = new Error("Aborted");
      error.name = "AbortError";
      return error;
    };
    const waitIfAborted = (init) => {
      const signal = init && init.signal;
      if (!signal) return null;
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    };
    const holdNewestQuery = async (init) => {
      if (!holdNewest) return;
      window.__carouselNewestHold = window.__carouselNewestHold || new Promise((resolve) => {
        window.__releaseCarouselNewest = resolve;
      });
      const aborted = waitIfAborted(init);
      if (!aborted) {
        await window.__carouselNewestHold;
        return;
      }
      await Promise.race([window.__carouselNewestHold, aborted]);
    };
    const requestRange = (init) => {
      const headers = (init && init.headers) || {};
      const raw = typeof headers.get === "function"
        ? (headers.get("Range") || headers.get("range") || "")
        : (headers.Range || headers.range || "");
      const match = String(raw).match(/(\d+)\s*-\s*(\d+)/);
      if (!match) return { from: 0, to: Math.max(0, recommendedTotal - 1) };
      return { from: Number(match[1]), to: Number(match[2]) };
    };
    const holdRecommendedAppendQuery = async (init, from) => {
      if (!holdRecommendedAppend || from <= 0) return;
      window.__carouselRecommendedHeld = true;
      window.__carouselRecommendedHold = window.__carouselRecommendedHold || new Promise((resolve) => {
        window.__releaseCarouselRecommended = resolve;
      });
      const aborted = waitIfAborted(init);
      if (!aborted) {
        await window.__carouselRecommendedHold;
        return;
      }
      await Promise.race([window.__carouselRecommendedHold, aborted]);
    };
    const recommendedPages = pageRecommended
      ? Array.from({ length: recommendedTotal }, (_, i) => stubBook({
        is_recommended: true,
        id: recommendedStartId + i,
        title: `Paid ${recommendedStartId + i}`
      }))
      : [];
    const failJson = () => new Response(JSON.stringify({ message: "homepage-state-stub-error" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
    window.fetch = async (input, init) => {
      const url = String(typeof input === "string" ? input : input && input.url || "");
      const method = String((init && init.method) || (typeof input === "object" && input && input.method) || "GET").toUpperCase();
      if (!url.includes("/rest/v1/books")) return origFetch(input, init);
      if (/[?&]id=eq\./.test(url)) return origFetch(input, init);
      if (passIdIn && /[?&]id=in\./.test(url)) return origFetch(input, init);
      if (method === "HEAD" && url.includes("sales_count=gt.0")) {
        return new Response(null, { status: 200, headers: { "content-range": `0-0/${bestseller ? 3 : 0}` } });
      }
      if (method === "HEAD" && url.includes("is_active=eq.true")) {
        return new Response(null, { status: 200, headers: { "content-range": "0-0/12" } });
      }
      if (url.includes("is_active=eq.false")) return jsonResponse([]);
      if (url.includes("is_recommended=eq.true")) {
        if (failModes.recommended) return failJson();
        if (!recommended) return jsonResponse([]);
        if (pageRecommended) {
          const range = requestRange(init);
          await holdRecommendedAppendQuery(init, range.from);
          const slice = recommendedPages.slice(range.from, range.to + 1);
          const end = range.from + Math.max(0, slice.length - 1);
          const contentRange = slice.length ? `${range.from}-${end}/${recommendedPages.length}` : `*/${recommendedPages.length}`;
          return jsonResponse(slice, false, contentRange);
        }
        return jsonResponse(stubBooks({ is_recommended: true, id: 91001, title: "Recommended Stub" }));
      }
      if (url.includes("is_new=eq.true")) {
        await holdNewestQuery(init);
        if (failModes.newest) return failJson();
        return jsonResponse(newest ? stubBooks({ is_new: true, id: 92001, title: "Newest Stub" }) : []);
      }
      if (url.includes("sales_count=gt.0")) {
        if (failModes.bestseller) return failJson();
        return jsonResponse(bestseller ? stubBooks({ sales_count: 4, id: 93001, title: "Bestseller Stub" }) : []);
      }
      if (failFeatured) {
        const headers = (init && init.headers) || {};
        const range = String(headers.Range || headers.range || "");
        if (range === "0-19" || range.startsWith("0-19")) return failJson();
      }
      if (featuredCount != null) {
        return jsonResponse(Array.from({ length: featuredCount }, (_, i) => stubBook({
          id: 94001 + i,
          title: `Featured Stub ${i + 1}`
        })));
      }
      return jsonResponse([]);
    };
  }, { recommended, newest, bestseller, bookCount, featuredCount, failFeatured, failModes, holdNewest, passIdIn, pageRecommended, holdRecommendedAppend, recommendedTotal, recommendedStartId });
}

async function installAnnouncementFixtures(page, opts) {
  const options = opts || {};
  const missing = options.missing === true;
  const interval = options.interval == null ? 5 : Number(options.interval);
  const rows = Array.isArray(options.announcements) ? options.announcements : [];
  await page.route("**/rest/v1/store_announcement_settings**", async (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    if (missing) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ code: "PGRST205", message: "table not found" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 1, rotation_interval_seconds: interval }])
    });
  });
  await page.route("**/rest/v1/store_announcements**", async (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    if (missing) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ code: "PGRST205", message: "table not found" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows)
    });
  });
}

module.exports = {
  PRODUCTION,
  targetOrigin,
  adminCreds,
  memberCreds,
  BOOK_COVER_STORAGE_PATH,
  BOOK_COVER_STUB_PATH,
  BOOK_COVER_STUB,
  isSupabaseBookCoverStorageUrl,
  isBookViewStatsRead,
  isCatalogAvailabilityProbe,
  isPositiveSalesHead,
  isInactiveIndexRead,
  mockedBookCoverRequests,
  allowLiveBookCovers,
  allowLiveCatalogReads,
  stubNumericBookDocuments,
  installBookCoverEgressGuard,
  logMockedBookCoverSummary,
  CATEGORY_DIRECTORY_ROWS,
  categoryDirectoryBody,
  installCategoryDirectoryFixture,
  installReadSafeNetwork,
  installCatalogRpcBridge,
  installCarouselCatalogStub,
  installAnnouncementFixtures,
  waitForShop,
  clearShopStorage,
  readCart,
  readFavs,
  badgeCount,
  openFresh,
  collectPageErrors,
  waitForDetailTitle,
  waitForHydratedCartTitle,
  detailPathFor,
  legacyBookHtmlPath,
  searchTokenFromTitle,
  discoverLiveBook,
  discoverLiveBookWithLegacy
};
