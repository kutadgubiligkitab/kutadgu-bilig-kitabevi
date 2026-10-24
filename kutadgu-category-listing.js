"use strict";

const fs = require("fs");
const path = require("path");
const sitemap = require("./kutadgu-sitemap.js");
const seo = require("./kutadgu-book-seo.js");
const safeUrl = require("./kutadgu-safe-url.js");
const stock = require("./kutadgu-stock.js");
const publicBook = require("./kutadgu-public-book.js");

const ROOT = typeof __dirname === "undefined" ? "" : __dirname;
const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const FETCH_TIMEOUT_MS = 8000;
const SUCCESS_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
const FAILURE_CACHE_CONTROL = "no-store";

/* Literature children and the two related hubs whose nav parent is /adabiyat. */
const PARENT_SLUG = Object.freeze({
  romanlar: "adabiyat",
  "tarikhiy-romanlar": "adabiyat",
  sheirlar: "adabiyat",
  hekayiler: "adabiyat",
  dastanlar: "adabiyat",
  "dunya-edebiyati": "adabiyat",
  "adabiyat-roman": "adabiyat",
  "uyghur-adabiyati": "adabiyat"
});

const ADABIYAT_SOURCES = Object.freeze([
  "romanlar.html",
  "tarikhiy-romanlar.html",
  "sheirlar.html",
  "hekayiler.html",
  "dastanlar.html",
  "dunya-edebiyati.html"
]);

const CATEGORY_SELECT = [
  "id",
  "title",
  "author",
  "image_url",
  "price",
  "stock",
  "stock_status",
  "source",
  "is_active"
].join(",");

const CATEGORY_SLUGS = sitemap.CATEGORY_HUB_SLUGS.slice();

function isCategorySlug(value) {
  return CATEGORY_SLUGS.indexOf(String(value || "").trim()) >= 0;
}

function templateFile(slug) {
  return `${slug}.html`;
}

function templatePath(slug) {
  if (!isCategorySlug(slug)) return "";
  return path.join(ROOT, templateFile(slug));
}

function catalogSources(slug) {
  if (!isCategorySlug(slug)) return [];
  if (slug === "adabiyat") return ADABIYAT_SOURCES.slice();
  return [`${slug}.html`];
}

function quotePostgrest(value) {
  return `"${String(value || "").replace(/"/g, "")}"`;
}

function categoryBooksQueryUrl(sources, offset, limit) {
  const list = (sources || []).filter(Boolean);
  if (!list.length) return "";
  /* Single-source eq filters must stay unquoted. PostgREST treats
     source=eq."romanlar.html" as a non-match and returns []. The in.()
     form used by the literature hub keeps the same quoting as shop.js. */
  const sourceFilter = list.length === 1
    ? `source=eq.${String(list[0]).replace(/[&?#]/g, "")}`
    : `source=in.(${list.map(quotePostgrest).join(",")})`;
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(1, Math.min(PAGE_SIZE, Number(limit) || PAGE_SIZE));
  return `${SUPABASE_URL}/rest/v1/books?select=${CATEGORY_SELECT}&is_active=eq.true&${sourceFilter}&order=id.asc&limit=${size}&offset=${start}`;
}

function isSampleCover(value) {
  return /(?:^|\/)(?:sample-book-cover(?:\(\d+\))?|carousel-sample-cover)\.png(?:$|[?#])/i.test(String(value || "").trim());
}

function displayAuthor(value) {
  const author = String(value || "").replace(/\s+/g, " ").trim();
  if (!author || author === "—" || author === "ئاپتور ئىسمى") return "";
  return author;
}

function priceText(value) {
  if (value == null || value === "") return "باھا تېخى بېكىتىلمىگەن";
  const n = Number(value);
  if (!Number.isFinite(n)) return "باھا تېخى بېكىتىلمىگەن";
  return `${n.toLocaleString("tr-TR")} ₺`;
}

function finiteAmount(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(amount) ? amount : null;
}

function seriesPartCount(book) {
  if (!book) return 0;
  const raw = book.memberCount != null && book.memberCount !== ""
    ? book.memberCount
    : (book.member_count != null && book.member_count !== "" ? book.member_count : null);
  const direct = raw == null ? NaN : Number(raw);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const ids = Array.isArray(book.memberBookIds) ? book.memberBookIds : (Array.isArray(book.member_book_ids) ? book.member_book_ids : []);
  if (ids.length) return ids.length;
  const prices = Array.isArray(book.memberPrices) ? book.memberPrices : (Array.isArray(book.member_prices) ? book.member_prices : []);
  return prices.length || 0;
}

function seriesCardLabel(book) {
  const title = String(book && book.title || "").trim();
  const count = seriesPartCount(book);
  if (!(count > 0)) return title;
  return title ? `${title} ${count} قىسىم` : `${count} قىسىم`;
}

function seriesSetAmount(book) {
  const explicit = finiteAmount(book && (book.completeSetPrice != null ? book.completeSetPrice : book.complete_set_price));
  const effective = finiteAmount(book && (book.effectiveSetPrice != null ? book.effectiveSetPrice : book.effective_set_price));
  const raw = book && (Array.isArray(book.memberPrices) ? book.memberPrices : (Array.isArray(book.member_prices) ? book.member_prices : []));
  const parts = (raw || []).map(finiteAmount);
  if (explicit != null) return explicit;
  if (effective != null) return effective;
  const expected = seriesPartCount(book);
  if (expected > 0 && parts.length === expected && parts.every((amount) => amount != null)) {
    return parts.reduce((sum, amount) => sum + amount, 0);
  }
  return null;
}

function cardCoverSrc(book) {
  const abs = publicBook.publicCoverAbsoluteUrl(book);
  if (abs && !isSampleCover(abs)) return abs;
  const raw = String((book && (book.image || book.image_url)) || "").trim();
  if (!raw || isSampleCover(raw) || !safeUrl.isSafeCoverUrl(raw)) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    const local = seo.absoluteUrl(raw);
    if (local && /^https:\/\/www\.kutadgubilik\.com\//.test(local) && !isSampleCover(local)) return local;
  }
  return "";
}

function coverHtml(book) {
  const src = cardCoverSrc(book);
  if (!src) return `<span class="book-cover-unavailable" aria-hidden="true"></span>`;
  const id = String(book.id);
  const alt = safeUrl.escapeAttr(`${book.title || "كىتاب"} كىتاب مۇقاۋىسى`);
  const safeSrc = safeUrl.escapeAttr(src);
  return `<img src="${safeSrc}" alt="${alt}" width="320" height="460" loading="lazy" decoding="async" data-cover-src="${safeSrc}" data-cover-book="${safeUrl.escapeAttr(id)}">`;
}

function cartButton(book, info) {
  const id = safeUrl.escapeAttr(book.id);
  if (info && info.canBuy === false) {
    const mark = `<span class="cart-blocked-mark" aria-hidden="true">✕</span>`;
    return `<button type="button" class="add-to-cart is-cart-unavailable" data-cart-id="${id}" disabled aria-disabled="true" aria-label="تۈگەپ كەتتى">🛒 ${mark} تۈگەپ كەتتى</button>`;
  }
  return `<button type="button" class="add-to-cart" data-cart-id="${id}">🛒 سېۋەتكە سېلىش</button>`;
}

function listingCardMarkup(book) {
  const id = String(book.id);
  const isGroup = book.kind === "group" && book.group_slug;
  const href = isGroup ? `/volume-group/${book.group_slug}` : `/book/${id}`;
  const visibleTitle = isGroup ? (seriesCardLabel(book) || book.title || "كىتاب") : (book.title || "كىتاب");
  const title = safeUrl.escapeHtml(visibleTitle);
  const titleAttr = isGroup ? ` title="${safeUrl.escapeAttr(visibleTitle)}"` : "";
  const authorName = displayAuthor(book.author);
  const authorBlock = authorName
    ? `<p class="book-author">ئاپتورى: ${safeUrl.escapeHtml(authorName)}</p>`
    : `<p class="book-author" hidden></p>`;
  const info = isGroup ? { key: "unknown", label: "", canBuy: true } : stock.storefrontStockInfo(book, { stockEnforcement: true });
  const state = info.key === "out" ? "is-stock-out" : info.key === "low" ? "is-stock-low" : "";
  const stateClass = state ? ` ${state}` : "";
  const badge = !isGroup && info.label && info.key !== "in" && info.key !== "unknown"
    ? `<span class="stock-badge stock-${safeUrl.escapeAttr(info.key)}">${safeUrl.escapeHtml(info.label)}</span>`
    : "";
  const cover = `<span class="cover-stock-wrap${stateClass}">${coverHtml(book)}</span>`;
  const priceLabel = isGroup ? priceText(seriesSetAmount(book)) : priceText(book.price);
  return `<article class="book-card${stateClass}" data-live-book-id="${safeUrl.escapeAttr(id)}">
    <a class="book-image${stateClass}" href="${href}">
      ${cover}
    </a>
    <div class="book-info">
      <h2 class="book-title"${titleAttr}>${title}</h2>
      ${authorBlock}
      ${badge}
      <div class="book-price">${safeUrl.escapeHtml(priceLabel)}</div>
      <div class="book-actions">
        <a class="detail-button" href="${href}">${isGroup ? "تەپسىلاتى" : "تەپسىلات"}</a>
        ${isGroup ? "" : `${cartButton(book, info)}
        <button type="button" class="favorite-button" data-fav-id="${safeUrl.escapeAttr(id)}" aria-label="ياقتۇرۇش">♡</button>
        <button type="button" class="share-button" data-share-id="${safeUrl.escapeAttr(id)}" aria-label="ھەمبەھىرلەش">🔗</button>`}
      </div>
    </div>
  </article>`;
}

function normalizeCategoryRow(row, allowedSources) {
  if (!row || row.is_active !== true) return null;
  const id = String(row.id == null ? "" : row.id).trim();
  if (!seo.isCanonicalBookId(id)) return null;
  const source = String(row.source || "").trim();
  if (!allowedSources || allowedSources.indexOf(source) < 0) return null;
  const priceNum = row.price == null || row.price === "" ? null : Number(row.price);
  const stockNum = row.stock == null || row.stock === "" ? null : Number(row.stock);
  const book = {
    id,
    title: String(row.title == null ? "" : row.title).trim(),
    author: String(row.author == null ? "" : row.author).trim(),
    image: String(row.image_url == null ? "" : row.image_url).trim(),
    image_url: String(row.image_url == null ? "" : row.image_url).trim(),
    price: Number.isFinite(priceNum) ? priceNum : null,
    stock: Number.isFinite(stockNum) ? stockNum : null,
    stockStatus: String(row.stock_status == null ? "" : row.stock_status).trim(),
    source
  };
  if (row.kind === "group") {
    book.kind = "group";
    book.group_slug = String(row.group_slug || row.slug || "").trim();
    const rawCount = row.member_count == null || row.member_count === "" ? null : Number(row.member_count);
    if (Number.isInteger(rawCount) && rawCount > 0) book.member_count = rawCount;
    const ids = Array.isArray(row.member_book_ids) ? row.member_book_ids.map((value) => String(value)) : [];
    if (ids.length) book.member_book_ids = ids;
    if (Array.isArray(row.member_prices)) book.member_prices = row.member_prices.map(finiteAmount);
    book.complete_set_price = finiteAmount(row.complete_set_price);
    book.effective_set_price = finiteAmount(row.effective_set_price);
  }
  return book;
}

function rowsToBooks(rows, allowedSources) {
  const seen = new Set();
  const books = [];
  (rows || []).forEach((row) => {
    const book = normalizeCategoryRow(row, allowedSources);
    if (!book || seen.has(book.id)) return;
    seen.add(book.id);
    books.push(book);
  });
  books.sort((a, b) => Number(a.id) - Number(b.id));
  return books;
}

async function loadCategoryBooks(slug, options) {
  const sources = options && Array.isArray(options.sources) && options.sources.length
    ? options.sources
    : catalogSources(slug);
  if (!sources.length) throw new Error("unknown-category");
  const env = options && options.env ? options.env : (typeof process !== "undefined" ? process.env : {});
  if (String(env && env.MULTI_VOLUME_BOOKS_ENABLED || "") === "true") {
    return loadGroupedCategoryBooks(sources, options);
  }
  const fetchFn = (options && options.fetchImpl) || fetch;
  const timeoutMs = Number((options && options.timeoutMs) || FETCH_TIMEOUT_MS);
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = categoryBooksQueryUrl(sources, page * PAGE_SIZE, PAGE_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(url, {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });
    } catch (err) {
      throw new Error("catalog-network");
    } finally {
      clearTimeout(timer);
    }
    if (!response || (response.status !== 200 && response.status !== 206)) {
      throw new Error("catalog-http");
    }
    let batch;
    try {
      batch = await response.json();
    } catch (err) {
      throw new Error("catalog-json");
    }
    if (!Array.isArray(batch)) throw new Error("catalog-json");
    rows.push.apply(rows, batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rowsToBooks(rows, sources);
}

async function loadGroupedCategoryBooks(sources, options) {
  const fetchFn = (options && options.fetchImpl) || fetch;
  const timeoutMs = Number((options && options.timeoutMs) || FETCH_TIMEOUT_MS);
  const rows = [];
  const size = 100;
  let total = null;
  for (let page = 0; page < 50; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/query_public_book_catalog`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ p_query: { sources, sort: "new", offset: page * size, limit: size } }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response || response.status !== 200) throw new Error("catalog-http");
    const payload = await response.json();
    const batch = Array.isArray(payload) ? payload : (Array.isArray(payload && payload.items) ? payload.items : null);
    if (!batch) throw new Error("catalog-json");
    rows.push(...batch);
    const parsedTotal = Number(payload && payload.total);
    if (Number.isFinite(parsedTotal)) total = parsedTotal;
    if (batch.length < size || (Number.isFinite(total) && rows.length >= total)) break;
  }
  return rowsToBooks(rows, sources);
}

function textOf(html, re) {
  const match = String(html || "").match(re);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function headingName(html) {
  return textOf(html, /<h1>\s*([^<]+?)\s*<\/h1>/i);
}

function navLinkName(html, href) {
  const escaped = String(href).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return textOf(html, new RegExp(`<a href="${escaped}"[^>]*>([\\s\\S]*?)</a>`, "i"));
}

function breadcrumbList(html, slug) {
  const origin = seo.productionOrigin();
  const homeName = navLinkName(html, "/") || "باش بەت";
  const currentName = headingName(html) || slug;
  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: homeName,
      item: `${origin}/`
    }
  ];
  const parent = PARENT_SLUG[slug] || "";
  if (parent && isCategorySlug(parent)) {
    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      name: navLinkName(html, `/${parent}`) || "ئەدەبىيات",
      item: `${origin}/${parent}`
    });
  }
  items.push({
    "@type": "ListItem",
    position: items.length + 1,
    name: currentName,
    item: `${origin}/${slug}`
  });
  return { "@type": "BreadcrumbList", itemListElement: items };
}

function scriptJson(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

function nodeTypes(node) {
  return [].concat(node && node["@type"]);
}

function upsertStructuredData(html, slug) {
  const re = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i;
  const match = String(html || "").match(re);
  if (!match) throw new Error("missing-jsonld");
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (err) {
    throw new Error("bad-jsonld");
  }
  let collection = null;
  if (nodeTypes(data).indexOf("CollectionPage") >= 0) {
    collection = Object.assign({}, data);
    delete collection["@context"];
  } else if (Array.isArray(data["@graph"])) {
    collection = data["@graph"].find((node) => nodeTypes(node).indexOf("CollectionPage") >= 0) || null;
  }
  if (!collection) throw new Error("missing-collection");
  const graph = {
    "@context": "https://schema.org",
    "@graph": [collection, breadcrumbList(html, slug)]
  };
  return String(html).replace(re, scriptJson(graph));
}

function decorateGridOpen(openTag) {
  let open = String(openTag || "").replace(/\s*$/, "");
  if (!/data-ssr-catalog=/.test(open)) open += ' data-ssr-catalog="1"';
  if (!/\sdata-catalog-ready=/.test(open)) open += ' data-catalog-ready=""';
  if (/\saria-busy="true"/.test(open)) open = open.replace(/\saria-busy="true"/, ' aria-busy="false"');
  else if (!/aria-busy=/.test(open)) open += ' aria-busy="false"';
  return open;
}

function replaceBooksGrid(html, cardsHtml) {
  const source = String(html || "");
  const start = source.indexOf('<div class="books-grid"');
  if (start < 0) throw new Error("missing-grid");
  const openEnd = source.indexOf(">", start);
  if (openEnd < 0) throw new Error("missing-grid");
  const open = decorateGridOpen(source.slice(start, openEnd));
  let depth = 1;
  let i = openEnd + 1;
  while (i < source.length && depth > 0) {
    const nextOpen = source.toLowerCase().indexOf("<div", i);
    const nextClose = source.toLowerCase().indexOf("</div>", i);
    if (nextClose < 0) throw new Error("unclosed-grid");
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) {
        return source.slice(0, start) + open + ">" + cardsHtml + source.slice(nextClose);
      }
      i = nextClose + 6;
    }
  }
  throw new Error("unclosed-grid");
}

function escapeMeta(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function replaceMetaContent(html, key, content) {
  const safe = escapeMeta(content);
  const nameFirst = new RegExp(`(<meta\\b[^>]*\\b(?:name|property)=["']${key}["'][^>]*\\bcontent=["'])[^"']*(["'])`, "i");
  const contentFirst = new RegExp(`(<meta\\b[^>]*\\bcontent=["'])[^"']*(["'][^>]*\\b(?:name|property)=["']${key}["'])`, "i");
  if (nameFirst.test(html)) return html.replace(nameFirst, `$1${safe}$2`);
  if (contentFirst.test(html)) return html.replace(contentFirst, `$1${safe}$2`);
  return html;
}

function rewriteCollectionJson(html, label, summary, url) {
  const re = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i;
  const match = String(html || "").match(re);
  if (!match) return html;
  let data;
  try { data = JSON.parse(match[1]); } catch (err) { return html; }
  const applyNode = (node) => {
    if (!node || typeof node !== "object" || nodeTypes(node).indexOf("CollectionPage") < 0) return;
    node.name = label;
    node.description = summary;
    node.url = url;
  };
  applyNode(data);
  if (Array.isArray(data["@graph"])) data["@graph"].forEach(applyNode);
  return String(html).replace(re, scriptJson(data));
}

function applyManagedCategoryChrome(html, category) {
  const slug = String(category && category.slug || "").trim();
  const source = String(category && category.source || `${slug}.html`).trim();
  const label = String(category && category.label || slug).trim();
  const summary = String(category && category.summary || "").trim() || `بۇ بۆلۈمدە ${label} كىتابلىرى كۆرۈنىدۇ.`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("unknown-category");
  if (source !== `${slug}.html`) throw new Error("unknown-category");
  const safeLabel = escapeMeta(label);
  const safeSummary = escapeMeta(summary);
  const url = `https://www.kutadgubilik.com/${slug}`;
  const title = `${label} | قۇتادغۇبىلىك كىتابخانىسى`;
  let out = String(html || "");
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeMeta(title)}</title>`);
  out = replaceMetaContent(out, "description", summary);
  out = replaceMetaContent(out, "og:title", title);
  out = replaceMetaContent(out, "og:description", summary);
  out = replaceMetaContent(out, "og:url", url);
  out = replaceMetaContent(out, "twitter:title", title);
  out = replaceMetaContent(out, "twitter:description", summary);
  out = out.replace(/(<link rel="canonical" href=")[^"]+(")/i, `$1${url}$2`);
  out = out.replace(/(<h1[^>]*>)[^<]*(<\/h1>)/i, `$1${safeLabel}$2`);
  out = out.replace(/(<p class="category-hub-intro">)[^<]*(<\/p>)/i, `$1${safeSummary}$2`);
  out = out.replace(/(<a\b[^>]*\baria-current="page"[^>]*>)[^<]*(<\/a>)/i, `$1${safeLabel}$2`);
  if (/<div class="books-grid"[^>]*\sdata-catalog-source="/i.test(out)) {
    out = out.replace(/(<div class="books-grid"[^>]*\sdata-catalog-source=")[^"]*(")/gi, `$1${escapeMeta(source)}$2`);
  } else {
    out = out.replace(/<div class="books-grid"/i, `<div class="books-grid" data-catalog-source="${escapeMeta(source)}"`);
  }
  out = rewriteCollectionJson(out, label, summary, url);
  return out;
}

function applyCategoryDocument(html, slug, books, category) {
  if (!isCategorySlug(slug)) throw new Error("unknown-category");
  let out = String(html || "");
  if (category) out = applyManagedCategoryChrome(out, Object.assign({ slug }, category));
  const cards = (books || []).map(listingCardMarkup).join("");
  return upsertStructuredData(replaceBooksGrid(out, cards), slug);
}

function applyDynamicCategoryDocument(html, category, books) {
  const slug = String(category && category.slug || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("unknown-category");
  const out = applyManagedCategoryChrome(html, category);
  const cards = (books || []).map(listingCardMarkup).join("");
  const replaced = replaceBooksGrid(out, cards);
  try {
    return upsertStructuredData(replaced, slug);
  } catch (err) {
    if (err && err.message === "missing-jsonld") return replaced;
    throw err;
  }
}

async function fetchPublicCategoryDirectory(fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const response = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/list_public_book_categories`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  if (!response) return { status: 0, body: null };
  let body = null;
  if (response.status === 200) {
    try { body = await response.json(); } catch (err) { body = null; }
  }
  return { status: response.status, body };
}

function failureDocument(html) {
  const fallback = "<!DOCTYPE html><html lang=\"ug\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex, follow\"><title>قۇتادغۇبىلىك كىتابخانىسى</title></head><body></body></html>";
  let out = String(html || "");
  if (!out.trim()) return fallback;
  if (/<meta\s+name=["']robots["'][^>]*>/i.test(out)) {
    out = out.replace(/<meta\s+name=["']robots["'][^>]*>/gi, '<meta name="robots" content="noindex, follow">');
  } else {
    out = out.replace(/<head[^>]*>/i, (tag) => `${tag}<meta name="robots" content="noindex, follow">`);
  }
  return out;
}

function readTemplate(slug) {
  const file = templatePath(slug);
  if (!file) return "";
  return fs.readFileSync(file, "utf8");
}

function parseCategorySlug(req) {
  let href = String((req && req.url) || "/");
  if (!/^https?:\/\//i.test(href)) href = `https://example.invalid${href.startsWith("/") ? "" : "/"}${href}`;
  let url;
  try {
    url = new URL(href);
  } catch (err) {
    return "";
  }
  const fromQuery = String(url.searchParams.get("slug") || "").trim();
  if (isCategorySlug(fromQuery)) return fromQuery;
  const pathName = String(url.pathname || "").replace(/\/+$/, "");
  const fromPath = pathName.startsWith("/") ? pathName.slice(1) : pathName;
  if (fromPath && !fromPath.includes("/") && isCategorySlug(fromPath)) return fromPath;
  return "";
}

module.exports = {
  CATEGORY_SLUGS,
  PARENT_SLUG,
  ADABIYAT_SOURCES,
  CATEGORY_SELECT,
  SUCCESS_CACHE_CONTROL,
  FAILURE_CACHE_CONTROL,
  isCategorySlug,
  templateFile,
  templatePath,
  catalogSources,
  categoryBooksQueryUrl,
  displayAuthor,
  cardCoverSrc,
  listingCardMarkup,
  normalizeCategoryRow,
  rowsToBooks,
  loadCategoryBooks,
  loadGroupedCategoryBooks,
  breadcrumbList,
  applyCategoryDocument,
  applyDynamicCategoryDocument,
  fetchPublicCategoryDirectory,
  failureDocument,
  readTemplate,
  parseCategorySlug
};
