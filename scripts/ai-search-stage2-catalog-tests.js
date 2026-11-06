#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Ai = require("../kutadgu-ai-search.js");
const catalog = require("./fixtures/public-catalog-search-stage2.json");

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  });
}

function book(row, extra) {
  return Object.assign({
    id: row.id,
    title: row.title,
    author: row.author || "",
    category: row.category || "",
    price: 10,
    image_url: "",
    stock: 1,
    similarity: 0,
    description: row.has_description ? "ئاممىۋى چۈشەندۈرۈش" : "",
    series_title: row.series_title || "",
    series_slug: row.series_slug || "",
    series_member_count: row.series_title ? 2 : 0
  }, extra || {});
}

function fakeVector(seed) {
  const out = new Array(Ai.EMBEDDING_DIMENSIONS);
  for (let i = 0; i < out.length; i += 1) out[i] = Number(((seed + i) % 97) / 97);
  return out;
}

function mockRes() {
  return { statusCode: 0, chunks: [], setHeader() {}, end(body) { this.chunks.push(body); } };
}

function makeFetch(state) {
  return async function fetchImpl(url, init) {
    const href = String(url);
    state.calls.push({ url: href, body: init && init.body });
    if (/api\.openai\.com/.test(href)) {
      state.openai += 1;
      if (state.openaiFail) {
        return { ok: false, status: 429, async json() { return { error: { message: "quota" } }; } };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { model: Ai.EMBEDDING_MODEL, data: [{ index: 0, embedding: fakeVector(4) }] };
        }
      };
    }
    if (/search_public_catalog_lexical$/.test(href)) {
      state.catalog += 1;
      if (state.catalogStatus) {
        return { ok: false, status: state.catalogStatus, async json() { return { message: "catalog" }; } };
      }
      return { ok: true, status: 200, async json() { return state.catalogRows || []; } };
    }
    if (/match_active_books_ai$/.test(href)) {
      state.vector += 1;
      return { ok: true, status: 200, async json() { return state.vectorRows || []; } };
    }
    if (/list_active_books_by_categories_ai$/.test(href)) {
      return { ok: true, status: 200, async json() { return []; } };
    }
    if (/book_embeddings/.test(href) || /\/rest\/v1\/books/.test(href)) {
      state.forbidden = true;
      return { ok: false, status: 403, async json() { return { message: "forbidden" }; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
}

async function search(query, envExtra, stateExtra) {
  const state = Object.assign({ calls: [], openai: 0, catalog: 0, vector: 0, forbidden: false }, stateExtra || {});
  const res = mockRes();
  await Ai.handleAiSearch(
    { method: "POST", body: { query } },
    res,
    {
      env: Object.assign({
        AI_SEARCH_ENABLED: "true",
        OPENAI_API_KEY: "test-openai-key",
        SUPABASE_SECRET_KEY: "test-supabase-rpc-key"
      }, envExtra || {}),
      fetchImpl: makeFetch(state)
    }
  );
  return { status: res.statusCode, json: JSON.parse(res.chunks.join("") || "null"), state };
}

async function run() {
  await test("public fixture contains every active approved book", () => {
    assert.strictEqual(catalog.length, 604);
    const ids = new Set(catalog.map((row) => row.id));
    assert.strictEqual(ids.size, 604);
    assert.ok(catalog.some((row) => row.has_description === false));
    assert.strictEqual(catalog.filter((row) => !row.has_description).length, 139);
  });

  await test("every public title is found exactly, including books without a description", () => {
    const distractor = book({ id: 900001, title: "مۇناسىۋەتسىز كىتاب", author: "باشقا", category: "رومان" }, { similarity: 0.91 });
    catalog.forEach((row) => {
      const found = Ai.selectRelevantResults(row.title, [book(row), distractor]);
      assert.ok(found.length >= 1, row.title);
      assert.strictEqual(found[0].id, row.id, row.title);
      assert.ok(!found.some((item) => item.id === 900001), row.title);
    });
    const children = catalog.filter((row) => row.category === "بالىلار كىتابلىرى" && !row.has_description);
    assert.ok(children.length >= 100);
    children.forEach((row) => {
      const found = Ai.selectRelevantResults(row.title, [book(row, { description: "" })]);
      assert.strictEqual(found[0].id, row.id);
    });
  });

  await test("authors, published series, and the historical category alias match", () => {
    const authored = catalog.find((row) => row.author && row.author.length >= 4 && row.title.indexOf(row.author) === -1);
    const byAuthor = Ai.selectRelevantResults(authored.author, [book(authored), book({ id: 900002, title: "باشقا", author: "باشقا ئاپتور", category: "رومان" })]);
    assert.strictEqual(byAuthor[0].id, authored.id);

    const series = catalog.find((row) => row.series_title && row.title !== row.series_title);
    assert.ok(series);
    const seriesHit = Ai.selectRelevantResults(series.series_title, [{
      id: series.id,
      title: series.series_title,
      author: series.author,
      category: series.category,
      similarity: 0,
      kind: "group",
      group_slug: series.series_slug,
      member_count: 2
    }]);
    assert.strictEqual(seriesHit[0].title, series.series_title);

    const historical = catalog.filter((row) => row.category === "تارىخىي رومان").slice(0, 3);
    const ranked = Ai.selectRelevantResults("تارىخىي رومان", historical.map((row) => book(row, { title: "باشقا نام " + row.id })).concat([
      book({ id: 900003, title: "رومان", author: "باشقا", category: "رومان" })
    ]));
    assert.deepStrictEqual(ranked.map((row) => row.id).sort(), historical.map((row) => row.id).sort());
  });

  await test("a query matching nothing in the public catalog stays empty", () => {
    const query = "قۇرۇق ئىزدەش سىنىقى xyz";
    const rows = catalog.map((row) => book(row));
    assert.deepStrictEqual(Ai.selectRelevantResults(query, rows), []);
  });

  await test("inactive and unapproved rows are dropped before a result is returned", () => {
    const row = book(catalog[0]);
    assert.deepStrictEqual(Ai.selectRelevantResults(row.title, [Object.assign({}, row, { is_active: false })]), []);
    assert.deepStrictEqual(Ai.selectRelevantResults(row.title, [Object.assign({}, row, { submission_status: "pending" })]), []);
  });

  await test("a published series title is returned as the series, not a private group", async () => {
    const series = catalog.find((row) => row.series_title && row.title !== row.series_title);
    const out = await search(series.series_title, {}, {
      catalogRows: [book(series, { title: series.title })]
    });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.results[0].kind, "group");
    assert.strictEqual(out.json.results[0].title, series.series_title);
    assert.strictEqual(out.json.results[0].group_slug, series.series_slug);
    assert.strictEqual(out.state.openai, 0);
  });

  await test("catalog keyword hits do not call OpenAI, and a closed budget still returns them", async () => {
    const row = catalog.find((item) => item.title === "يەر ئانا") || catalog[0];
    const hit = await search(row.title, {}, { catalogRows: [book(row)] });
    assert.strictEqual(hit.status, 200);
    assert.strictEqual(hit.json.results[0].id, row.id);
    assert.strictEqual(hit.state.openai, 0);
    assert.strictEqual(hit.state.catalog, 1);
    assert.strictEqual(hit.state.vector, 0);
    assert.ok(!("description" in hit.json.results[0]));
    assert.ok(!hit.state.forbidden);

    const budget = await search(row.title, { AI_SEARCH_PAID_CALLS_REMAINING: "0" }, { catalogRows: [book(row)] });
    assert.strictEqual(budget.json.results[0].id, row.id);
    assert.strictEqual(budget.state.openai, 0);
  });

  await test("OpenAI failure still returns the catalog match", async () => {
    const row = catalog[10];
    const out = await search(row.title, {}, { catalogRows: [book(row)], openaiFail: true });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.results[0].id, row.id);
    assert.strictEqual(out.state.openai, 0);
  });

  await test("semantic fallback accepts only a high-confidence neighbor", async () => {
    const neighbor = book(catalog[20], { similarity: 0.8, title: "مۇناسىۋەتسىز ماۋزۇ" });
    const high = await search("مەنىسى يېقىن ئىزدەش", {}, { catalogRows: [], vectorRows: [neighbor] });
    assert.strictEqual(high.status, 200);
    assert.strictEqual(high.json.results[0].id, neighbor.id);
    assert.strictEqual(high.state.openai, 1);
    assert.ok(high.json.results[0].similarity >= Ai.SEMANTIC_ACCEPT_FLOOR);

    const low = await search("مەنىسى يېقىن ئىزدەش", {}, {
      catalogRows: [],
      vectorRows: [book(catalog[21], { similarity: 0.4, title: "يەنە بىر ماۋزۇ" })]
    });
    assert.deepStrictEqual(low.json.results, []);
    assert.strictEqual(low.state.openai, 1);
  });

  await test("a reached spend limit returns no invented semantic book", async () => {
    const out = await search("مەنىسى يېقىن ئىزدەش", { AI_SEARCH_PAID_CALLS_REMAINING: "0" }, {
      catalogRows: [],
      vectorRows: [book(catalog[22], { similarity: 0.9 })]
    });
    assert.strictEqual(out.status, 200);
    assert.deepStrictEqual(out.json.results, []);
    assert.strictEqual(out.state.openai, 0);
    assert.strictEqual(out.state.vector, 0);
  });

  await test("a missing catalog function keeps the previous vector path", async () => {
    const out = await search("بالىلار تەربىيەسى", {}, {
      catalogStatus: 404,
      vectorRows: [book({ id: 12, title: "بالىلار تەربىيەسى", author: "A", category: "پەرزەنت تەربىيەسى" }, { similarity: 0.8 })]
    });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.results[0].id, 12);
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.vector, 1);
  });

  await test("the catalog function is service-role only and is not applied", () => {
    const sql = fs.readFileSync(path.join(root, "STAGE_AI_SEARCH_2_PUBLIC_CATALOG_LEXICAL.sql"), "utf8");
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog, public, private/);
    assert.match(sql, /b\.is_active IS TRUE/);
    assert.match(sql, /b\.submission_status = 'approved'/);
    assert.match(sql, /private\.kutadgu_public_volume_groups\(\)/);
    assert.match(sql, /left\(b\.description, 2500\)/);
    assert.match(sql, /AS safe/);
    assert.match(sql, /char_length\(v\.safe\) >= 3/);
    assert.doesNotMatch(sql, /ILIKE '%' \|\| replace\(replace/);
    assert.match(sql, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 24\), 1\), 24\)/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.search_public_catalog_lexical\(text\[\], text\[\], integer\)/);
    assert.match(sql, /FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.search_public_catalog_lexical\(text\[\], text\[\], integer\)\s+TO service_role/);
    assert.doesNotMatch(sql, /TO anon/);
    assert.doesNotMatch(sql, /TO authenticated/);
    assert.doesNotMatch(sql, /TO PUBLIC/);
    assert.doesNotMatch(sql, /INSERT |UPDATE |DELETE |ALTER TABLE|CREATE POLICY|DROP POLICY/);
    assert.doesNotMatch(sql, /book_embeddings/);
    const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
    assert.doesNotMatch(pkg, /STAGE_AI_SEARCH_2_PUBLIC_CATALOG_LEXICAL/);
    const src = fs.readFileSync(path.join(root, "kutadgu-ai-search.js"), "utf8");
    assert.match(src, /search_public_catalog_lexical/);
    assert.doesNotMatch(src, /book_embeddings/);
    assert.doesNotMatch(src, /\/rest\/v1\/books/);
  });

  await test("known spelling variants still fold before the catalog call", () => {
    assert.ok(Ai.queryVariants("چىڭگىز ئايتماتوۋ").indexOf("چىڭغىز ئايتماتوۋ") !== -1);
    assert.ok(Ai.categoryNamesForQuery("تارىخىي رومان").indexOf("تارىخىي رومان") !== -1);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search stage 2 test(s) failed");
    process.exit(1);
  }
  console.log("ai-search-stage2-catalog-tests ok");
});
