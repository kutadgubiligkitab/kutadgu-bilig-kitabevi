"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
globalThis.KUTADGU_APP_CONFIG = {
  catalogCategories: [
    { source: "romanlar.html", label: "رومانلار" },
    { source: "tibb.html", label: "تېبابەت ۋە ساغلاملىق" }
  ]
};
const directory = require("../kutadgu-book-categories.js");

directory.applyPublic({
  categories: [
    { id: 1, slug: "romanlar", source: "romanlar.html", label: "رومانلار يېڭى", summary: "", icon: "📖", sort_order: 10 },
    { id: 2, slug: "yeni-tur", source: "yeni-tur.html", label: "يېڭى تۈر", summary: "يېڭى", icon: "📚", sort_order: 20 }
  ],
  redirects: [{ slug: "dictionary", source: "dictionary.html", target_slug: "grammar", target_source: "grammar.html" }]
});

assert.strictEqual(directory.authoritative(), true);
assert.strictEqual(directory.currentLabel("رومانلار"), "رومانلار يېڭى");
assert.strictEqual(directory.currentLabel("تېبابەت ۋە ساغلاملىق"), "");
assert.strictEqual(directory.selectionPairs({ includeSource: "tibb.html" }).find((pair) => pair[0] === "tibb.html")[1], "تېبابەت ۋە ساغلاملىق");
assert.strictEqual(directory.selectionPairs({ includeSource: "tibb.html", includeLabel: "يېڭى تېبابەت" }).find((pair) => pair[0] === "tibb.html")[1], "يېڭى تېبابەت");
assert.strictEqual(directory.redirectFor("dictionary").target_slug, "grammar");
assert.ok(directory.visible().every((row) => row.slug !== "tibb"));

directory.applyFailure("http");
assert.strictEqual(directory.snapshot().mode, "authoritative");
assert.strictEqual(directory.currentLabel("رومانلار"), "رومانلار يېڭى");

const sitemap = require("../kutadgu-sitemap.js");
const listing = require("../kutadgu-category-listing.js");
const xml = sitemap.appendManagedCategories(
  '<?xml version="1.0"?><urlset><url><loc>https://www.kutadgubilik.com/romanlar</loc></url></urlset>',
  [{ slug: "romanlar" }, { slug: "yeni-tur" }, { slug: "../admin" }]
);
assert.strictEqual(xml.match(/\/yeni-tur</g).length, 1);
assert.strictEqual(xml.match(/\/romanlar</g).length, 1);
assert.strictEqual(xml.includes("../admin"), false);

const html = listing.applyDynamicCategoryDocument(
  '<html><head><title>old</title><link rel="canonical" href="https://www.kutadgubilik.com/universal"></head><body><h1>old</h1><div class="books-grid"></div></body></html>',
  { slug: "yeni-tur", label: "يېڭى تۈر", source: "yeni-tur.html" },
  []
);
assert.ok(html.includes("<title>يېڭى تۈر | قۇتادغۇبىلىك كىتابخانىسى</title>"));
assert.ok(html.includes("https://www.kutadgubilik.com/yeni-tur"));
assert.ok(html.includes("<h1>يېڭى تۈر</h1>"));
const universal = listing.applyDynamicCategoryDocument(
  fs.readFileSync(path.join(__dirname, "../universal.html"), "utf8"),
  { slug: "yeni-tur", label: "يېڭى تۈر", source: "yeni-tur.html" },
  []
);
assert.ok(universal.includes("<h1>يېڭى تۈر</h1>"));
assert.ok(universal.includes('data-catalog-source="yeni-tur.html"'));
assert.ok(!universal.includes('data-catalog-source="universal.html"'));
assert.ok(universal.includes('content="https://www.kutadgubilik.com/yeni-tur"'));
assert.ok(!universal.includes("https://www.kutadgubilik.com/universal"));
assert.ok(!universal.includes("ئۇنىۋېرسال ئەسەرلەر"));
const roman = listing.applyCategoryDocument(
  fs.readFileSync(path.join(__dirname, "../romanlar.html"), "utf8"),
  "romanlar",
  [],
  { slug: "romanlar", source: "romanlar.html", label: "رومانلار يېڭى", summary: "يېڭى قىسقىچە" }
);
assert.ok(roman.includes("<h1>رومانلار يېڭى</h1>"));
assert.ok(roman.includes('data-catalog-source="romanlar.html"'));
assert.ok(roman.includes("يېڭى قىسقىچە"));
assert.ok(!roman.includes("<h1>\n            رومان"));

const vm = require("vm");

function loadVendoredClient(sandbox) {
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../vendor/supabase-js-2.45.4.umd.js"), "utf8"),
    sandbox,
    { filename: "vendor/supabase-js-2.45.4.umd.js" }
  );
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json" }
  });
}

async function requestBody(input, init) {
  if (init && typeof init.body === "string") return JSON.parse(init.body);
  if (input && typeof input.text === "function") {
    const text = await input.text();
    return text ? JSON.parse(text) : {};
  }
  return {};
}

function rpcName(input) {
  const url = String(input && input.url || input);
  const match = url.match(/\/rpc\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function adminApi(fetchImpl) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    fetch: fetchImpl,
    Headers,
    Request,
    Response,
    TextEncoder,
    TextDecoder,
    crypto: global.crypto,
    document: {
      currentScript: { tagName: "SCRIPT", src: "https://example.test/vendor/supabase-js-2.45.4.umd.js" },
      baseURI: "https://example.test/",
      getElementsByTagName() { return []; },
      querySelector() { return null; },
      addEventListener() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  loadVendoredClient(sandbox);
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../admin-book-categories.js"), "utf8"),
    sandbox,
    { filename: "admin-book-categories.js" }
  );
  const db = sandbox.supabase.createClient("https://example.supabase.co", "anon-key", {
    global: { fetch: fetchImpl },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  sandbox.KutadguAdminBookCategories.init(db);
  return sandbox.KutadguAdminBookCategories;
}

async function repeatMove(fetchImpl) {
  const seen = [];
  const api = adminApi(async (input, init) => {
    const name = rpcName(input);
    const body = await requestBody(input, init);
    if (name === "admin_list_book_categories") return jsonResponse([]);
    seen.push(body);
    return fetchImpl(body, seen.length);
  });
  const args = { p_book_ids: [2], p_destination_id: 9, p_expected_book_ids: [2] };
  const first = await api.mutate("admin_move_books_to_category", args);
  const second = await api.mutate("admin_move_books_to_category", args);
  return { first, second, seen, attempts: api.state.attempts };
}

function samePayload(left, right) {
  assert.strictEqual(left.p_request_id, right.p_request_id);
  assert.deepStrictEqual(left.p_book_ids, right.p_book_ids);
  assert.strictEqual(left.p_destination_id, right.p_destination_id);
  assert.deepStrictEqual(left.p_expected_book_ids, right.p_expected_book_ids);
}

(async () => {
  const gateway = await repeatMove(async () => new Response("bad gateway", {
    status: 502,
    headers: { "content-type": "text/plain" }
  }));
  assert.strictEqual(gateway.first, false);
  assert.strictEqual(gateway.second, false);
  assert.strictEqual(gateway.seen.length, 2);
  samePayload(gateway.seen[0], gateway.seen[1]);
  assert.strictEqual(Object.keys(gateway.attempts).length, 1);

  const rejected = await repeatMove(async () => { throw new TypeError("Failed to fetch"); });
  assert.strictEqual(rejected.first, false);
  assert.strictEqual(rejected.second, false);
  samePayload(rejected.seen[0], rejected.seen[1]);
  assert.strictEqual(Object.keys(rejected.attempts).length, 1);

  const stored = new Map();
  let delivered = false;
  const recovered = await repeatMove(async (body) => {
    if (!stored.has(body.p_request_id)) {
      stored.set(body.p_request_id, { applied_books: 1, request_id: body.p_request_id });
    }
    if (!delivered) {
      delivered = true;
      throw new TypeError("Failed to fetch");
    }
    return jsonResponse(stored.get(body.p_request_id));
  });
  assert.strictEqual(recovered.first, false);
  assert.strictEqual(recovered.second, true);
  samePayload(recovered.seen[0], recovered.seen[1]);
  assert.strictEqual(stored.size, 1);
  assert.strictEqual(Object.keys(recovered.attempts).length, 0);

  const refused = await repeatMove(async () => jsonResponse({
    code: "55000",
    message: "category_not_empty",
    details: null,
    hint: null
  }, 400));
  assert.strictEqual(refused.first, false);
  assert.strictEqual(refused.second, false);
  assert.notStrictEqual(refused.seen[0].p_request_id, refused.seen[1].p_request_id);
  assert.deepStrictEqual(refused.seen[0].p_book_ids, refused.seen[1].p_book_ids);
  assert.strictEqual(Object.keys(refused.attempts).length, 0);

  console.log("book category client: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
