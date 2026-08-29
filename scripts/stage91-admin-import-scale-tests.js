#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Scale = require("../admin-import-scale.js");
const V = require("../catalog-visibility.js");

const ROOT = path.join(__dirname, "..");
let failed = 0;
const wroteProduction = [];

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log("PASS", name);
    } catch (err) {
      failed += 1;
      console.error("FAIL", name, err && err.stack ? err.stack : err);
    }
  })();
}

function normalizeIsbn(value) {
  return String(value || "").replace(/\D/g, "");
}

function titleAuthorKey(title, author) {
  return `${String(title || "").trim().toLocaleLowerCase("ug")}|||${String(author || "").trim().toLocaleLowerCase("ug")}`;
}

function isbnForIndex(i) {
  return `978${String(i).padStart(10, "0")}`;
}

function makeCatalog(n, extra = {}) {
  const books = [];
  for (let i = 1; i <= n; i++) {
    books.push({
      id: i,
      title: extra.titleFor ? extra.titleFor(i) : `Title ${i}`,
      author: extra.authorFor ? extra.authorFor(i) : `Author ${i}`,
      isbn: extra.isbnFor ? extra.isbnFor(i) : isbnForIndex(i),
      legacy_id: extra.legacyFor ? extra.legacyFor(i) : ""
    });
  }
  return books;
}

function mockClient(catalog, { maxRows = 1000 } = {}) {
  const queries = [];
  const client = {
    queries,
    writes: 0,
    from(table) {
      if (table !== "books") throw new Error("unexpected table " + table);
      const q = {
        table,
        selectCols: null,
        inCol: null,
        inVals: null,
        from: 0,
        to: null
      };
      const chain = {
        select(cols) {
          q.selectCols = cols;
          return chain;
        },
        in(col, vals) {
          q.inCol = col;
          q.inVals = (vals || []).map(String);
          return chain;
        },
        insert() {
          client.writes += 1;
          wroteProduction.push("insert");
          return Promise.resolve({ data: null, error: new Error("tests must not write") });
        },
        update() {
          client.writes += 1;
          wroteProduction.push("update");
          return Promise.resolve({ data: null, error: new Error("tests must not write") });
        },
        delete() {
          client.writes += 1;
          wroteProduction.push("delete");
          return Promise.resolve({ data: null, error: new Error("tests must not write") });
        },
        range(from, to) {
          q.from = from;
          q.to = to;
          queries.push({ ...q, inVals: q.inVals ? q.inVals.slice() : null });
          let rows = catalog.slice();
          if (q.inCol && q.inVals) {
            const want = new Set(q.inVals);
            rows = rows.filter((row) => want.has(String(row[q.inCol] == null ? "" : row[q.inCol])));
          }
          const sliced = rows.slice(from, to + 1);
          const capped = sliced.slice(0, maxRows);
          return Promise.resolve({ data: capped, error: null });
        }
      };
      return chain;
    },
    rpc(name) {
      queries.push({ rpc: name });
      return Promise.resolve({ data: null, error: { message: "rpc not stubbed" } });
    }
  };
  return client;
}

const scaleOpts = {
  isbnColumn: true,
  hasLegacy: true,
  normalizeIsbn,
  titleAuthorKey
};

function applyPreview(mapped, maps) {
  return mapped.map((row) => {
    const isbnKey = normalizeIsbn(row.isbn);
    const out = { ...row, duplicate: null, allowed: true };
    if (row.legacy_id && maps.existingLegacy.has(row.legacy_id)) {
      out.duplicate = "legacy";
      out.allowed = false;
      return out;
    }
    if (isbnKey && maps.existingIsbn.has(isbnKey)) {
      out.duplicate = "isbn";
      out.allowed = false;
      return out;
    }
    const t = maps.existingTitle.get(titleAuthorKey(row.title, row.author));
    if (t) {
      out.duplicate = "title";
      out.allowed = false;
      return out;
    }
    return out;
  });
}

async function loadAgainst(catalog, mapped) {
  const client = mockClient(catalog);
  const maps = await Scale.loadExistingForImport(client, mapped, scaleOpts);
  const preview = applyPreview(mapped, maps);
  return { client, maps, preview };
}

const jobs = [];

jobs.push(test("A 500-row catalog duplicate detection", async () => {
  const catalog = makeCatalog(500);
  const mapped = [
    { title: "Title 42", author: "Author 42", isbn: isbnForIndex(42), legacy_id: "" },
    { title: "Brand New", author: "Someone", isbn: "97800000000999", legacy_id: "" }
  ];
  const { preview, client } = await loadAgainst(catalog, mapped);
  assert.strictEqual(preview[0].duplicate, "isbn");
  assert.strictEqual(preview[1].duplicate, null);
  assert.ok(client.queries.every((q) => q.inCol), "must not unfiltered-scan");
  assert.strictEqual(client.writes, 0);
}));

jobs.push(test("B 1,500 rows — duplicate above index 1000 still detected", async () => {
  const catalog = makeCatalog(1500);
  const target = catalog[1199];
  assert.strictEqual(target.id, 1200);
  const mapped = [{ title: target.title, author: target.author, isbn: target.isbn, legacy_id: "" }];
  const unfiltered = mockClient(catalog);
  const truncated = await unfiltered.from("books").select("id,title,author,isbn").range(0, 9999);
  assert.strictEqual(truncated.data.length, 1000);
  assert.ok(!truncated.data.some((b) => b.id === 1200), "old range(0,9999) silently misses row 1200");

  const { preview, maps, client } = await loadAgainst(catalog, mapped);
  assert.ok(maps.existingIsbn.has(normalizeIsbn(target.isbn)));
  assert.strictEqual(preview[0].duplicate, "isbn");
  assert.ok(client.queries.every((q) => q.inCol));
  assert.ok(client.queries.every((q) => q.to - q.from + 1 <= 1000 || q.inCol));
}));

jobs.push(test("C 5,000-row catalog duplicate detection", async () => {
  const catalog = makeCatalog(5000);
  const target = catalog[4320];
  const mapped = [{ title: target.title, author: target.author, isbn: target.isbn, legacy_id: "" }];
  const { preview } = await loadAgainst(catalog, mapped);
  assert.strictEqual(preview[0].duplicate, "isbn");
}));

jobs.push(test("D 20,000-row model — no silent truncation", async () => {
  const catalog = makeCatalog(20000);
  const target = catalog[15499];
  assert.strictEqual(target.id, 15500);
  const mapped = [{ title: target.title, author: target.author, isbn: target.isbn, legacy_id: "" }];
  const { preview, client } = await loadAgainst(catalog, mapped);
  assert.strictEqual(preview[0].duplicate, "isbn");
  assert.ok(client.queries.length > 0);
  assert.ok(client.queries.every((q) => q.inCol), "must never unfiltered-read 20k");
  const returned = client.queries.reduce((n, q) => n + (q.to - q.from + 1), 0);
  assert.ok(returned < 20000, "must not request a full-catalog window");
  const sameTitle = makeCatalog(1200, {
    titleFor: () => "Shared Title",
    authorFor: (i) => `Author ${i}`,
    isbnFor: (i) => isbnForIndex(i)
  });
  const pageClient = mockClient(sameTitle);
  const maps = await Scale.loadExistingForImport(pageClient, [
    { title: "Shared Title", author: "Author 1100", isbn: "", legacy_id: "" }
  ], scaleOpts);
  assert.ok(maps.existingTitle.has(titleAuthorKey("Shared Title", "Author 1100")));
  const titleQueries = pageClient.queries.filter((q) => q.inCol === "title");
  assert.ok(titleQueries.length >= 2, "title matches above 1000 must page");
}));

jobs.push(test("E ISBN duplicate detected", async () => {
  const catalog = makeCatalog(80);
  const { preview } = await loadAgainst(catalog, [
    { title: "Other Title", author: "Other Author", isbn: isbnForIndex(7), legacy_id: "" }
  ]);
  assert.strictEqual(preview[0].duplicate, "isbn");
}));

jobs.push(test("F title+author duplicate detected", async () => {
  const catalog = makeCatalog(80);
  const { preview } = await loadAgainst(catalog, [
    { title: "Title 11", author: "Author 11", isbn: "", legacy_id: "" }
  ]);
  assert.strictEqual(preview[0].duplicate, "title");
}));

jobs.push(test("G unrelated import row remains allowed", async () => {
  const catalog = makeCatalog(200);
  const { preview } = await loadAgainst(catalog, [
    { title: "Unrelated Book", author: "New Author", isbn: "97811111111111", legacy_id: "" }
  ]);
  assert.strictEqual(preview[0].duplicate, null);
  assert.strictEqual(preview[0].allowed, true);
}));

jobs.push(test("H 80-row insert batch unchanged", () => {
  const admin = fs.readFileSync(path.join(ROOT, "admin.js"), "utf8");
  assert.ok(/const IMPORT_BATCH=80;/.test(admin));
  assert.ok(/i\+=IMPORT_BATCH/.test(admin));
}));

jobs.push(test("I Admin list still 40/page", () => {
  const admin = fs.readFileSync(path.join(ROOT, "admin.js"), "utf8");
  assert.ok(/const PAGE_SIZE=40;/.test(admin));
  assert.ok(/listPage\*PAGE_SIZE/.test(admin));
}));

jobs.push(test("J no full 20k storefront fetch", () => {
  const shop = fs.readFileSync(path.join(ROOT, "shop.js"), "utf8");
  assert.ok(/function pageSize\(\)\{return window\.innerWidth<=700\?12:24\}/.test(shop));
  assert.ok(/select=id,legacy_id&is_active=eq\.false/.test(shop));
  assert.ok(!/while\(from<5000\)/.test(shop));
  assert.ok(!/\.range\(0,\s*9999\)/.test(shop));
  const listing = shop.match(/Range:`\$\{from\}-\$\{to\}`/g) || [];
  assert.ok(listing.length >= 1);
}));

jobs.push(test("K inactive ids beyond 5000 handled", async () => {
  const inactive = [];
  for (let i = 1; i <= 6001; i++) inactive.push({ id: 100000 + i, legacy_id: i === 6001 ? "beyond-5000" : "" });
  const fetchPage = async (from, to) => inactive.slice(from, to + 1);
  const keys = await V.loadInactiveKeysPaged(fetchPage, { pageSize: 1000 });
  assert.ok(keys.has("106001"));
  assert.ok(keys.has("beyond-5000"));
  assert.strictEqual(keys.size, 6002);

  const capped = new Set();
  let from = 0;
  while (from < 5000) {
    const rows = await fetchPage(from, from + 999);
    if (!rows.length) break;
    V.collectInactiveKeys(rows).forEach((k) => capped.add(k));
    if (rows.length < 1000) break;
    from += 1000;
  }
  assert.ok(!capped.has("106001"), "old 5000 cap missed last page");
  assert.ok(!capped.has("beyond-5000"));
}));

jobs.push(test("L no production data writes during tests", async () => {
  assert.deepStrictEqual(wroteProduction, []);
  const sql = fs.readFileSync(path.join(ROOT, "STAGE91_ADMIN_IMPORT_SCALE.sql"), "utf8");
  assert.ok(!/\b(insert|update|delete)\b/i.test(sql.replace(/INSERT\/UPDATE\/DELETE/g, "")));
  const client = mockClient(makeCatalog(3));
  client.rpc = async (name) => {
    assert.strictEqual(name, "get_kutadgu_book_stock_sum");
    return { data: 42, error: null };
  };
  const sum = await Scale.fetchStockSumRpc(client);
  assert.deepStrictEqual(sum, { ok: true, total: 42 });
  const missing = await Scale.fetchStockSumRpc(mockClient([]));
  assert.strictEqual(missing.ok, false);
}));

jobs.push(test("admin.js no longer uses range(0,9999)", () => {
  const admin = fs.readFileSync(path.join(ROOT, "admin.js"), "utf8");
  assert.ok(!/\.range\(0,\s*9999\)/.test(admin));
  assert.ok(/KutadguAdminImportScale/.test(admin));
  assert.ok(/get_kutadgu_book_stock_sum/.test(fs.readFileSync(path.join(ROOT, "admin-import-scale.js"), "utf8")));
}));

Promise.all(jobs).then(() => {
  if (failed) {
    console.error(failed + " failed");
    process.exit(1);
  }
  console.log("All Stage 9.1 admin import scale tests passed");
});
