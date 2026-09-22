"use strict";

const visibility = require("./catalog-visibility.js");
const seo = require("./kutadgu-book-seo.js");
const safeUrl = require("./kutadgu-safe-url.js");
const bib = require("./catalog-bibliography.js");
const stock = require("./kutadgu-stock.js");
const { bookCanonicalUrl } = seo;

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const LOOKUP_TIMEOUT_MS = 4000;

function isCanonicalBookId(value) {
  return visibility.isCanonicalBookId(value);
}

function parseNumericBookId(req) {
  let href = String((req && req.url) || "/");
  if (!/^https?:\/\//i.test(href)) href = `https://example.invalid${href.startsWith("/") ? "" : "/"}${href}`;
  let url;
  try {
    url = new URL(href);
  } catch (err) {
    return "";
  }
  const fromQuery = String(url.searchParams.get("id") || "").trim();
  if (isCanonicalBookId(fromQuery)) return fromQuery;
  const pathMatch = String(url.pathname || "").match(/^\/book\/(\d+)\/?$/);
  return pathMatch ? pathMatch[1] : "";
}

const PUBLIC_SEO_SELECT = [
  "id",
  "title",
  "author",
  "description",
  "image_url",
  "category",
  "publisher",
  "isbn",
  "price",
  "stock",
  "stock_status",
  "source",
  "publish_year",
  "translator",
  "pages",
  "cover_type",
  "book_size",
  "interior_print_type",
  "is_color_print"
].join(",");

function publicBookLookupUrl(id) {
  const canonical = String(id == null ? "" : id).trim();
  return `${SUPABASE_URL}/rest/v1/books?select=${PUBLIC_SEO_SELECT}&id=eq.${encodeURIComponent(canonical)}&is_active=eq.true`;
}

function publicSeoBook(row, id) {
  const canonical = String(id == null ? "" : id).trim();
  if (!row || String(row.id) !== canonical) return null;
  const priceNum = row.price == null || row.price === "" ? NaN : Number(row.price);
  const stockNum = row.stock == null || row.stock === "" ? NaN : Number(row.stock);
  return {
    id: canonical,
    title: String(row.title == null ? "" : row.title).trim(),
    author: String(row.author == null ? "" : row.author).trim(),
    description: String(row.description == null ? "" : row.description).trim(),
    image: String(row.image_url == null ? "" : row.image_url).trim(),
    image_url: String(row.image_url == null ? "" : row.image_url).trim(),
    category: String(row.category == null ? "" : row.category).trim(),
    publisher: String(row.publisher == null ? "" : row.publisher).trim(),
    isbn: String(row.isbn == null ? "" : row.isbn).trim(),
    price: Number.isFinite(priceNum) ? priceNum : null,
    stock: Number.isFinite(stockNum) ? stockNum : null,
    stockStatus: String(row.stock_status == null ? "" : row.stock_status).trim(),
    stock_status: String(row.stock_status == null ? "" : row.stock_status).trim(),
    source: String(row.source == null ? "" : row.source).trim(),
    publishYear: String(row.publish_year == null ? "" : row.publish_year).trim(),
    translator: String(row.translator == null ? "" : row.translator).trim(),
    pages: row.pages == null || row.pages === "" ? "" : String(row.pages).trim(),
    coverType: bib.normalizeCoverType(row.cover_type) || "",
    bookSize: bib.normalizeBookSize(row.book_size) || "",
    interiorPrintType: bib.normalizeInteriorPrintType(row.interior_print_type) || "",
    isColorPrint: row.is_color_print === true || row.is_color_print === "true"
  };
}

function seoStockKey(book) {
  if (stock && typeof stock.storefrontStockInfo === "function") {
    const info = stock.storefrontStockInfo(book, { stockEnforcement: true });
    if (info && ["in", "low", "out"].includes(info.key)) return info.key;
  }
  const text = book && book.stock != null && book.stock !== "" ? String(book.stock).trim() : "";
  if (!/^(0|[1-9]\d*)$/.test(text)) return "";
  const qty = Number(text);
  if (qty <= 0) return "out";
  if (qty <= 3) return "low";
  return "in";
}

function publicCoverAbsoluteUrl(book) {
  const raw = String((book && (book.image || book.image_url)) || "").trim();
  if (!raw) return "";
  if (!safeUrl.isSafeCoverUrl(raw)) return "";
  return seo.absoluteUrl(raw) || "";
}

function escapeAttr(value) {
  return safeUrl.escapeAttr(value);
}

function escapeHtml(value) {
  return safeUrl.escapeHtml(value);
}

function publishYearForMeta(book) {
  const published = seo.datePublishedIfTrustworthy(book);
  return published ? published.slice(0, 4) : "";
}

function renderBookMetaRow(label, value) {
  if (!bib.detailMetaVisible(value)) return "";
  const shown = String(value).trim();
  return `<div class="book-meta-row"><div class="book-meta-label">${escapeHtml(label)}</div><div class="book-meta-value">${escapeHtml(shown)}</div></div>`;
}

function renderBookMeta(book) {
  return [
    renderBookMetaRow("ئاپتورى", seo.storefrontAuthor(book)),
    renderBookMetaRow("تەرجىمە قىلغۇچى", book && book.translator),
    renderBookMetaRow("نەشرىيات", book && book.publisher),
    renderBookMetaRow("نەشر يىلى", publishYearForMeta(book)),
    renderBookMetaRow("ISBN", seo.storefrontIsbn(book)),
    renderBookMetaRow("بەت سانى", book && book.pages),
    renderBookMetaRow("مۇقاۋا تۈرى", bib.coverTypeLabel(book && book.coverType)),
    renderBookMetaRow("كىتاب ئۆلچىمى", bib.bookSizeLabel(book && book.bookSize)),
    renderBookMetaRow("ئىچكى بېسىلىشى", bib.interiorPrintDetailValue(book)),
    renderBookMetaRow("كىتاب تۈرى", book && book.category)
  ].join("");
}

function replaceFirst(html, findRe, replacement) {
  let seen = false;
  return String(html || "").replace(findRe, (match) => {
    if (seen) return match;
    seen = true;
    return replacement;
  });
}

function bookDocumentTitle(book) {
  const title = String((book && book.title) || "").trim();
  if (!title) return "";
  return `${title} - قۇتادغۇبىلىك كىتابخانىسى`;
}

async function lookupPublicNumericBook(id, options) {
  const canonical = String(id == null ? "" : id).trim();
  if (!isCanonicalBookId(canonical)) return { outcome: "invalid" };
  const fetchFn = (options && options.fetchImpl) || fetch;
  const timeoutMs = Number((options && options.timeoutMs) || LOOKUP_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(publicBookLookupUrl(canonical), {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (response.status !== 200 && response.status !== 206) {
      return { outcome: "error", reason: `http-${response.status}`, status: response.status };
    }
    let rows;
    try {
      rows = await response.json();
    } catch (err) {
      return { outcome: "error", reason: "bad-json" };
    }
    if (!Array.isArray(rows)) return { outcome: "error", reason: "bad-json" };
    const row = rows.find((item) => String(item && item.id) === canonical);
    if (!row) return { outcome: "missing" };
    const book = publicSeoBook(row, canonical);
    return book ? { outcome: "found", book } : { outcome: "missing" };
  } catch (err) {
    const name = err && err.name;
    return { outcome: "error", reason: name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

function injectBeforeHeadClose(html, tag) {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
  }
  return `${html}\n${tag}`;
}

function upsertFirstTag(html, findRe, tag) {
  if (findRe.test(html)) return html.replace(findRe, tag);
  return injectBeforeHeadClose(html, tag);
}

function keepFirstTag(html, findRe) {
  let seen = false;
  return html.replace(findRe, (match) => {
    if (seen) return "";
    seen = true;
    return match;
  });
}

function upsertNamedMeta(html, attrName, attrValue, tag) {
  const findRe = new RegExp(
    `<meta\\s+[^>]*${attrName}=["']${attrValue}["'][^>]*>`,
    "i"
  );
  return upsertFirstTag(html, findRe, tag);
}

function safeJsonLd(payload) {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

function applyBookSpecificSeo(html, book, canonicalHref) {
  const title = String(book.title || "").trim();
  if (!title) return html;
  const documentTitle = bookDocumentTitle(book);
  const description = seo.metaDescription(book);
  const authorName = seo.storefrontAuthor(book);
  const image = publicCoverAbsoluteUrl(book);
  const jsonLd = seo.buildBookJsonLd(book, {
    canonical: canonicalHref,
    authorName,
    image,
    visible: true,
    stockKey: seoStockKey(book)
  });

  let out = html;
  out = upsertFirstTag(out, /<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(documentTitle)}</title>`);
  if (description) {
    out = upsertNamedMeta(out, "name", "description", `<meta name="description" content="${escapeAttr(description)}">`);
  }
  out = upsertNamedMeta(out, "property", "og:locale", '<meta property="og:locale" content="ug">');
  out = upsertNamedMeta(out, "property", "og:title", `<meta property="og:title" content="${escapeAttr(title)}">`);
  if (description) {
    out = upsertNamedMeta(out, "property", "og:description", `<meta property="og:description" content="${escapeAttr(description)}">`);
  }
  out = upsertNamedMeta(out, "property", "og:url", `<meta property="og:url" content="${escapeAttr(canonicalHref)}">`);
  if (image) {
    out = upsertNamedMeta(out, "property", "og:image", `<meta property="og:image" content="${escapeAttr(image)}">`);
    out = upsertNamedMeta(
      out,
      "property",
      "og:image:alt",
      `<meta property="og:image:alt" content="${escapeAttr(`${title} كىتاب مۇقاۋىسى`)}">`
    );
  }
  out = upsertNamedMeta(
    out,
    "name",
    "twitter:card",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`
  );
  out = upsertNamedMeta(out, "name", "twitter:title", `<meta name="twitter:title" content="${escapeAttr(title)}">`);
  if (description) {
    out = upsertNamedMeta(out, "name", "twitter:description", `<meta name="twitter:description" content="${escapeAttr(description)}">`);
  }
  if (image) {
    out = upsertNamedMeta(out, "name", "twitter:image", `<meta name="twitter:image" content="${escapeAttr(image)}">`);
  }

  const schemaTag = `<script id="kutadguBookSchema" type="application/ld+json">${safeJsonLd(jsonLd)}</script>`;
  if (/<script\s+id=["']kutadguBookSchema["'][\s\S]*?<\/script>/i.test(out)) {
    out = out.replace(/<script\s+id=["']kutadguBookSchema["'][\s\S]*?<\/script>/i, schemaTag);
  } else {
    out = injectBeforeHeadClose(out, schemaTag);
  }

  out = keepFirstTag(out, /<title>[\s\S]*?<\/title>/gi);
  out = keepFirstTag(out, /<meta\s+name=["']description["'][^>]*>/gi);
  out = keepFirstTag(out, /<meta\s+property=["']og:title["'][^>]*>/gi);
  out = keepFirstTag(out, /<meta\s+property=["']og:description["'][^>]*>/gi);
  out = keepFirstTag(out, /<meta\s+property=["']og:url["'][^>]*>/gi);
  out = keepFirstTag(out, /<script\s+id=["']kutadguBookSchema["'][\s\S]*?<\/script>/gi);
  return out;
}

function applyBookSpecificBody(html, book) {
  const title = String((book && book.title) || "").trim();
  if (!title) return String(html || "");
  let out = String(html || "");
  const safeTitle = escapeHtml(title);
  out = replaceFirst(
    out,
    /<div class="book-detail-info">\s*<h1>[\s\S]*?<\/h1>/,
    `<div class="book-detail-info">\n        <h1>${safeTitle}</h1>`
  );

  const authorName = seo.storefrontAuthor(book);
  if (authorName) {
    out = replaceFirst(
      out,
      /<div class="book-author">[\s\S]*?<\/div>/,
      `<div class="book-author">ئاپتورى: ${escapeHtml(authorName)}</div>`
    );
  } else {
    out = replaceFirst(
      out,
      /<div class="book-author">[\s\S]*?<\/div>/,
      '<div class="book-author" hidden></div>'
    );
  }

  const image = publicCoverAbsoluteUrl(book);
  if (image) {
    const alt = escapeAttr(`${title} كىتاب مۇقاۋىسى`);
    out = replaceFirst(
      out,
      /<div class="book-cover-box">\s*<img\b[^>]*>\s*<\/div>/,
      `<div class="book-cover-box"><img src="${escapeAttr(image)}" alt="${alt}"></div>`
    );
  }

  const description = String(book.description || "").trim();
  if (description) {
    out = replaceFirst(
      out,
      /<section class="dynamic-book-description"[^>]*>\s*<h2>كىتاب ھەققىدە<\/h2>\s*<p><\/p>\s*<\/section>/,
      `<section class="dynamic-book-description">\n          <h2>كىتاب ھەققىدە</h2>\n          <p>${escapeHtml(description)}</p>\n        </section>`
    );
  }

  const metaHtml = renderBookMeta(book);
  out = replaceFirst(out, /<div class="book-meta"><\/div>/, `<div class="book-meta">${metaHtml}</div>`);
  return out;
}

/* First-byte head for FOUND public numeric books. Fail-closed: invalid ids leave HTML unchanged. */
function applyFoundPublicBookHead(html, id, book) {
  const canonical = String(id == null ? "" : id).trim();
  if (!isCanonicalBookId(canonical)) return String(html || "");
  const href = bookCanonicalUrl(canonical);
  let out = String(html || "");
  const robotsMeta = '<meta name="robots" content="index, follow">';
  const canonicalLink = `<link rel="canonical" href="${escapeAttr(href)}">`;
  out = upsertFirstTag(out, /<meta\s+name=["']robots["'][^>]*>/i, robotsMeta);
  out = upsertFirstTag(out, /<link\s+rel=["']canonical["'][^>]*>/i, canonicalLink);
  out = keepFirstTag(out, /<meta\s+name=["']robots["'][^>]*>/gi);
  out = keepFirstTag(out, /<link\s+rel=["']canonical["'][^>]*>/gi);
  if (book && String(book.id) === canonical) {
    out = applyBookSpecificSeo(out, book, href);
    out = applyBookSpecificBody(out, book);
  }
  return out;
}

function missingBookHtml() {
  return `<!DOCTYPE html>
<html lang="ug" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, follow">
  <title>كىتاب تېپىلمىدى - قۇتادغۇبىلىك كىتابخانىسى</title>
  <link rel="stylesheet" href="/theme.css?v=9">
  <link rel="stylesheet" href="/shop.css?v=53">
</head>
<body class="detail-page-body">
  <main class="book-detail-page" style="padding:48px 0">
    <p class="detail-brand"><a class="detail-brand" href="/">قۇتادغۇبىلىك كىتابخانىسى</a></p>
    <h1>كىتاب تېپىلمىدى</h1>
    <p>بۇ كىتاب ئاممىۋى كاتالوگتا يوق ياكى كۆرسىتىلمەيدۇ.</p>
    <p><a class="back-link" href="/#books">كىتابلارغا قايتىش</a></p>
  </main>
</body>
</html>
`;
}

function lookupFailureHtml() {
  return `<!DOCTYPE html>
<html lang="ug" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, follow">
  <title>ۋاقىتلىق خاتالىق - قۇتادغۇبىلىك كىتابخانىسى</title>
  <link rel="stylesheet" href="/theme.css?v=9">
  <link rel="stylesheet" href="/shop.css?v=53">
</head>
<body class="detail-page-body">
  <main class="book-detail-page" style="padding:48px 0">
    <h1>ۋاقىتلىق خاتالىق</h1>
    <p>كىتابنى ھازىرچە تەكشۈرگىلى بولمىدى. سەل تۇرۇپ قايتا سىناڭ.</p>
    <p><a class="back-link" href="/#books">كىتابلارغا قايتىش</a></p>
  </main>
</body>
</html>
`;
}

module.exports = {
  SUPABASE_URL,
  LOOKUP_TIMEOUT_MS,
  isCanonicalBookId,
  parseNumericBookId,
  publicBookLookupUrl,
  lookupPublicNumericBook,
  applyFoundPublicBookHead,
  publicSeoBook,
  seoStockKey,
  PUBLIC_SEO_SELECT,
  missingBookHtml,
  lookupFailureHtml
};
