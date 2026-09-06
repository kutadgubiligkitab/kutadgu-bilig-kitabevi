"use strict";

const visibility = require("./catalog-visibility.js");

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

function publicBookLookupUrl(id) {
  const canonical = String(id == null ? "" : id).trim();
  return `${SUPABASE_URL}/rest/v1/books?select=id&id=eq.${encodeURIComponent(canonical)}&is_active=eq.true`;
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
    const found = rows.some((row) => String(row && row.id) === canonical);
    return found ? { outcome: "found" } : { outcome: "missing" };
  } catch (err) {
    const name = err && err.name;
    return { outcome: "error", reason: name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
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
  missingBookHtml,
  lookupFailureHtml
};
