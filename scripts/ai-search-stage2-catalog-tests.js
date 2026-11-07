#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Ai = require("../kutadgu-ai-search.js");
const SeriesRoutes = require("../kutadgu-series-routes.js");
const AiUi = require("../kutadgu-ai-search-ui.js");
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
    state.calls.push({ url: href, body: init && init.body, headers: init && init.headers });
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
    if (/reserve_ai_search_paid_call$/.test(href)) {
      state.reserve = (state.reserve || 0) + 1;
      if (state.reserveStatus) {
        return { ok: false, status: state.reserveStatus, async json() { return { message: "budget missing" }; } };
      }
      return { ok: true, status: 200, async json() { return [{ allowed: state.reserveAllowed !== false, remaining_micro_usd: 900000 }]; } };
    }
    if (/match_active_books_ai$/.test(href)) {
      state.vector += 1;
      return { ok: true, status: 200, async json() { return state.vectorRows || []; } };
    }
    if (/list_active_books_by_categories_ai$/.test(href)) {
      return { ok: true, status: 200, async json() { return []; } };
    }
    if (/map_public_books_to_catalog_units$/.test(href)) {
      state.map = (state.map || 0) + 1;
      return { ok: true, status: 200, async json() { return state.mapRows || []; } };
    }
    if (/list_public_book_series_routes$/.test(href)) {
      state.routes = (state.routes || 0) + 1;
      if (state.routesStatus) return { ok: false, status: state.routesStatus, async json() { return { message: "missing" }; } };
      return { ok: true, status: 200, async json() { return state.seriesRoutes || []; } };
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
    { method: "POST", headers: { "cf-connecting-ip": "203.0.113.8" }, body: { query } },
    res,
    {
      env: Object.assign({
        AI_SEARCH_ENABLED: "true",
        OPENAI_API_KEY: "test-openai-key",
        SUPABASE_SECRET_KEY: "test-supabase-rpc-key",
        AI_SEARCH_IP_HASH_SECRET: "test-ip-hash-secret"
      }, envExtra || {}),
      trustedClientIp: "203.0.113.8",
      fetchImpl: makeFetch(state)
    }
  );
  return { status: res.statusCode, json: JSON.parse(res.chunks.join("") || "null"), state };
}

async function run() {
  await test("a series card uses the canonical public slug without the route helper", () => {
    const previous = globalThis.KutadguSeriesRoutes;
    delete globalThis.KutadguSeriesRoutes;
    const series = {
      kind: "group",
      id: 156,
      group_id: 156,
      group_slug: "series-156",
      public_slug: "oyghanghan-zemin",
      title: "ئويغانغان زېمىن"
    };
    assert.strictEqual(AiUi.publicResultHref(series), "/series/oyghanghan-zemin");
    assert.strictEqual(AiUi.publicResultHref({
      kind: "group",
      id: 156,
      group_slug: "series-156",
      public_slug: "series-156"
    }), "/volume-group/series-156");
    assert.strictEqual(AiUi.publicResultHref({
      kind: "group",
      id: 123,
      group_slug: "series-156",
      public_slug: "series-123",
      public_slug_verified: true
    }), "/series/series-123");
    globalThis.KutadguSeriesRoutes = {
      groupPath(row) {
        assert.notStrictEqual(row.public_slug, "series-156");
        return row.public_slug ? "/series/" + row.public_slug : "/volume-group/" + row.slug;
      }
    };
    assert.strictEqual(AiUi.publicResultHref(series), "/series/oyghanghan-zemin");
    assert.strictEqual(AiUi.publicResultHref({
      kind: "group",
      id: 156,
      group_slug: "series-156",
      public_slug: "series-156"
    }), "/volume-group/series-156");
    assert.strictEqual(AiUi.publicResultHref({
      kind: "group",
      id: 123,
      group_slug: "series-123",
      public_slug: "series-123",
      public_slug_verified: true
    }), "/series/series-123");
    assert.strictEqual(AiUi.publicResultHref({
      kind: "group",
      id: 123,
      group_slug: "series-123",
      public_slug: "series-123"
    }), "/volume-group/series-123");
    assert.strictEqual(AiUi.publicResultHref({
      kind: "group",
      id: 156,
      group_slug: "series-156"
    }), "/volume-group/series-156");
    assert.strictEqual(AiUi.publicResultHref({
      kind: "group",
      id: 156,
      group_slug: "Not A Slug",
      public_slug: "also bad"
    }), "");
    assert.strictEqual(AiUi.publicResultHref({
      id: 157,
      title: "ئويغانغان زېمىن 1. قىسىم",
      public_slug: "oyghanghan-zemin",
      group_slug: "series-156"
    }), "/book/157");
    assert.strictEqual(AiUi.publicResultHref({ id: 901, title: "تاق كىتاب" }), "/book/901");
    if (previous) globalThis.KutadguSeriesRoutes = previous;
    else delete globalThis.KutadguSeriesRoutes;
  });

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
      catalogRows: [book(series, { title: series.title, series_group_id: 156 })]
    });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.results[0].kind, "group");
    assert.strictEqual(out.json.results[0].title, series.series_title);
    assert.strictEqual(out.json.results[0].group_id, 156);
    assert.strictEqual(out.json.results[0].group_slug, series.series_slug);
    assert.strictEqual(out.json.results[0].public_slug, series.series_slug);
    assert.strictEqual(SeriesRoutes.groupPath(out.json.results[0]), "/series/" + series.series_slug);
    assert.strictEqual(out.state.openai, 0);
  });

  await test("a general series search returns one series card and a volume search returns that book", () => {
    const members = catalog.filter((row) => row.series_slug === "oyghanghan-zemin");
    assert.ok(members.length >= 2);
    const rows = members.map((row, index) => book(row, {
      price: index === 0 ? 40 : 15,
      image_url: "https://example.invalid/member/" + row.id + ".webp",
      series_group_id: 77,
      series_member_count: members.length,
      series_lowest_price: 15,
      series_image_url: "https://example.invalid/series/oyghanghan-zemin.webp",
      series_representative_id: members[0].id,
      series_author: row.author
    }));
    const series = Ai.presentSearchResults("ئويغانغان زېمىن", rows);
    assert.strictEqual(series.length, 1);
    assert.strictEqual(series[0].kind, "group");
    assert.strictEqual(series[0].title, "ئويغانغان زېمىن");
    assert.strictEqual(series[0].price, 15);
    assert.strictEqual(series[0].image_url, "https://example.invalid/series/oyghanghan-zemin.webp");
    assert.strictEqual(SeriesRoutes.groupPath(series[0]), "/series/oyghanghan-zemin");
    const volume = Ai.presentSearchResults(members[0].title, rows);
    assert.strictEqual(volume.length, 1);
    assert.notStrictEqual(volume[0].kind, "group");
    assert.strictEqual(volume[0].id, members[0].id);
    assert.strictEqual(SeriesRoutes.groupPath(volume[0]), "");
  });

  await test("author and mixed results show each published series once", () => {
    const seriesA = catalog.filter((row) => row.series_slug === "oyghanghan-zemin").slice(0, 2);
    const seriesB = catalog.filter((row) => row.series_slug && row.series_slug !== "oyghanghan-zemin");
    const slugB = seriesB[0].series_slug;
    const membersB = catalog.filter((row) => row.series_slug === slugB).slice(0, 2);
    const standalone = catalog.find((row) => !row.series_slug && row.author);
    const rows = seriesA.map((row) => book(row, { series_group_id: 77, series_member_count: 2, series_lowest_price: 15, series_image_url: "https://example.invalid/a.webp", series_representative_id: seriesA[0].id }))
      .concat(membersB.map((row) => book(row, { series_group_id: 78, series_member_count: 2, series_lowest_price: 20, series_image_url: "https://example.invalid/b.webp", series_representative_id: membersB[0].id })))
      .concat([book(standalone)]);
    const author = seriesA[0].author;
    rows.forEach((row) => { row.author = author; });
    const found = Ai.presentSearchResults(author, rows);
    const groups = found.filter((row) => row.kind === "group");
    assert.strictEqual(groups.length, 2);
    assert.ok(found.some((row) => row.kind !== "group" && row.id === standalone.id));
    assert.strictEqual(found.length, 3);
  });

  await test("semantic candidates collapse a published series and still reject a weak score", async () => {
    const members = catalog.filter((row) => row.series_slug === "oyghanghan-zemin").slice(0, 2);
    const vectorRows = members.map((row) => book(row, {
      title: "مۇناسىۋەتسىز ماۋزۇ " + row.id,
      similarity: 0.9,
      series_group_id: 77,
      series_member_count: 2,
      series_lowest_price: 15,
      series_image_url: "https://example.invalid/series/oyghanghan-zemin.webp",
      series_representative_id: members[0].id
    }));
    const accepted = await search("مەنىسى يېقىن ئىزدەش", {}, { catalogRows: [], vectorRows });
    assert.strictEqual(accepted.json.results.length, 1);
    assert.strictEqual(accepted.json.results[0].kind, "group");
    assert.strictEqual(accepted.json.results[0].price, 15);
    assert.strictEqual(accepted.state.openai, 1);
    const weak = Ai.selectRelevantResults("مەنىسى يېقىن ئىزدەش", [book(catalog[3], { similarity: 0.99, title: "مۇناسىۋەتسىز" })]);
    assert.deepStrictEqual(weak, []);
  });

  await test("a mapped semantic series keeps its canonical slug, price, and cover", async () => {
    const cover = "https://example.invalid/series/oyghanghan-zemin.webp";
    const mapped = {
      kind: "group",
      id: 156,
      group_id: 156,
      group_slug: "series-156",
      title: "ئويغانغان زېمىن",
      author: "ئابدۇرېھىم ئۆتكۈر",
      category: "تارىخىي رومان",
      price: 18,
      image_url: cover,
      representative_book_id: 156,
      member_count: 2,
      matched_book_ids: [156, 157]
    };
    const standalone = {
      kind: "book",
      id: 901,
      title: "تاق كىتاب",
      author: "باشقا",
      category: "رومان",
      price: 11,
      image_url: "https://example.invalid/standalone.webp",
      representative_book_id: 901,
      matched_book_ids: [901]
    };
    const out = await search("مەنىسى يېقىن ئىزدەش", { MULTI_VOLUME_BOOKS_ENABLED: "true" }, {
      catalogRows: [],
      vectorRows: [
        book({ id: 156, title: "ئويغانغان زېمىن 1. قىسىم", author: "ئابدۇرېھىم ئۆتكۈر", category: "تارىخىي رومان" }, { similarity: 0.8 }),
        book({ id: 157, title: "ئويغانغان زېمىن 2. قىسىم", author: "ئابدۇرېھىم ئۆتكۈر", category: "تارىخىي رومان" }, { similarity: 0.7 }),
        book({ id: 901, title: "تاق كىتاب", author: "باشقا", category: "رومان" }, { similarity: 0.6 })
      ],
      mapRows: [mapped, standalone],
      seriesRoutes: [{ group_id: 156, legacy_slug: "series-156", public_slug: "oyghanghan-zemin" }]
    });
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.map, 1);
    assert.strictEqual(out.state.routes, 1);
    const series = out.json.results.find((row) => row.kind === "group");
    const single = out.json.results.find((row) => row.id === 901);
    assert.ok(series);
    assert.strictEqual(series.group_slug, "series-156");
    assert.strictEqual(series.public_slug, "oyghanghan-zemin");
    assert.strictEqual(series.price, 18);
    assert.strictEqual(series.image_url, cover);
    assert.strictEqual(series.member_count, 2);
    assert.strictEqual(SeriesRoutes.groupPath(series), "/series/oyghanghan-zemin");
    assert.ok(single);
    assert.notStrictEqual(single.kind, "group");
    const unresolved = await search("مەنىسى يېقىن ئىزدەش", { MULTI_VOLUME_BOOKS_ENABLED: "true" }, {
      catalogRows: [],
      vectorRows: [book({ id: 156, title: "ئويغانغان زېمىن 1. قىسىم", author: "A", category: "رومان" }, { similarity: 0.8 })],
      mapRows: [mapped],
      routesStatus: 404
    });
    assert.ok(!unresolved.json.results.some((row) => row.public_slug === "series-156" || row.group_slug === "series-156" && row.kind === "group"));
    assert.notStrictEqual(SeriesRoutes.groupPath(unresolved.json.results[0] || {}), "/series/series-156");
  });

  await test("a closed semantic service does not claim that no books exist", async () => {
    const out = await search("مەنىسى يېقىن ئىزدەش", {}, { catalogRows: [], reserveAllowed: false });
    assert.strictEqual(out.status, 200);
    assert.deepStrictEqual(out.json.results, []);
    assert.strictEqual(out.json.semantic, "unavailable");
    assert.strictEqual(out.state.openai, 0);
    const missingSecret = await search("مەنىسى يېقىن ئىزدەش", { AI_SEARCH_IP_HASH_SECRET: "" }, { catalogRows: [] });
    assert.strictEqual(missingSecret.json.semantic, "unavailable");
    assert.strictEqual(missingSecret.state.openai, 0);
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
    const out = await search("مەنىسى يېقىن ئىزدەش", {}, {
      catalogRows: [],
      reserveAllowed: false,
      vectorRows: [book(catalog[22], { similarity: 0.9 })]
    });
    assert.strictEqual(out.status, 200);
    assert.deepStrictEqual(out.json.results, []);
    assert.strictEqual(out.state.openai, 0);
    assert.strictEqual(out.state.vector, 0);
  });

  await test("a missing catalog function does not call OpenAI", async () => {
    const out = await search("بالىلار تەربىيەسى", {}, {
      catalogStatus: 404,
      vectorRows: [book({ id: 12, title: "بالىلار تەربىيەسى", author: "A", category: "پەرزەنت تەربىيەسى" }, { similarity: 0.8 })]
    });
    assert.strictEqual(out.status, 503);
    assert.strictEqual(out.state.openai, 0);
    assert.strictEqual(out.state.vector, 0);
    assert.strictEqual(out.state.reserve || 0, 0);
  });

  await test("a missing or refused budget does not call OpenAI", async () => {
    const missing = await search("مەنىسى يېقىن ئىزدەش", {}, {
      catalogRows: [],
      reserveStatus: 404,
      vectorRows: [book(catalog[22], { similarity: 0.9, title: "مۇناسىۋەتسىز" })]
    });
    assert.strictEqual(missing.status, 200);
    assert.deepStrictEqual(missing.json.results, []);
    assert.strictEqual(missing.state.openai, 0);
    const refused = await search("مەنىسى يېقىن ئىزدەش", {}, {
      catalogRows: [],
      reserveAllowed: false,
      vectorRows: [book(catalog[22], { similarity: 0.9, title: "مۇناسىۋەتسىز" })]
    });
    assert.deepStrictEqual(refused.json.results, []);
    assert.strictEqual(refused.state.openai, 0);
  });

  await test("semantic acceptance is only the numeric floor and is not live quality proof", async () => {
    const below = await search("مەنىسى يېقىن ئىزدەش", {}, {
      catalogRows: [],
      vectorRows: [book(catalog[23], { similarity: 0.549, title: "يەنە بىر ماۋزۇ" })]
    });
    assert.deepStrictEqual(below.json.results, []);
    const atFloor = await search("مەنىسى يېقىن ئىزدەش", {}, {
      catalogRows: [],
      vectorRows: [book(catalog[24], { similarity: 0.55, title: "باشقا ماۋزۇ" })]
    });
    assert.strictEqual(atFloor.json.results[0].id, catalog[24].id);
    assert.strictEqual(atFloor.state.openai, 1);
  });

  await test("the catalog function is service-role only and is not applied", () => {
    const sql = fs.readFileSync(path.join(root, "STAGE_AI_SEARCH_2_PUBLIC_CATALOG_LEXICAL.sql"), "utf8");
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog, public, private/);
    assert.match(sql, /b\.is_active IS TRUE/);
    assert.match(sql, /b\.submission_status = 'approved'/);
    assert.match(sql, /private\.kutadgu_public_volume_groups\(\)/);
    assert.match(sql, /left\(b\.description, 2500\)/);
    assert.match(sql, /description_matched boolean/);
    assert.match(sql, /category_matched boolean/);
    assert.match(sql, /FROM public\.book_categories/);
    assert.match(sql, /c\.is_hidden IS FALSE/);
    assert.match(sql, /c\.retired_at IS NULL/);
    assert.match(sql, /exact\.label = normalize\(b\.category, NFC\)[\s\S]*THEN 4/);
    assert.match(sql, /THEN 4[\s\S]*strpos\(normalize\(b\.title, NFC\), v\.q\) > 0[\s\S]*THEN 5/);
    assert.match(sql, /JOIN active_labels AS active ON active\.label = requested\.cat[\s\S]*THEN 7/);
    assert.match(sql, /char_length\(v\.q\) >= 8[\s\S]*THEN 8/);
    assert.match(sql, /query_keys AS/);
    assert.match(sql, /HAVING count\(\*\) >= 2/);
    assert.match(sql, /max\(key_length\) >= 6/);
    assert.match(sql, /chosen\.lexical_score DESC/);
    assert.match(sql, /term_support AS support/);
    assert.match(sql, /strpos\(normalize\(b\.title, NFC\), v\.q\) > 0/);
    assert.match(sql, /'book:' \|\| hits\.id::text/);
    assert.match(sql, /'group:' \|\| hits\.series_group_id::text/);
    assert.match(sql, /series_group_id/);
    assert.doesNotMatch(sql, /ILIKE/);
    assert.match(sql, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 24\), 1\), 24\)/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.search_public_catalog_lexical\(text\[\], text\[\], integer\)/);
    assert.match(sql, /FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.search_public_catalog_lexical\(text\[\], text\[\], integer\)\s+TO service_role/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_public_book_series_routes\(\) TO service_role/);
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

  await test("exact categories come from the directory flag, not a hardcoded name", async () => {
    assert.deepStrictEqual(Ai.categoryNamesForQuery("ئىقتىساد"), []);
    assert.deepStrictEqual(Ai.categoryNamesForQuery("يېڭى ئاپتوماتىك تۈر"), []);
    assert.deepStrictEqual(Ai.categoryNamesForQuery("بالىلار تارىخىي رومان"), []);
    assert.deepStrictEqual(
      Ai.categoryNamesForQuery("بالا تەربىيىسىدە ئاتا-ئانا نېمىلەرگە دىققەت قىلىشى كېرەك"),
      ["پەرزەنت تەربىيەسى"]
    );
    assert.deepStrictEqual(Ai.categoryNamesForQuery("بالا"), []);
    assert.deepStrictEqual(Ai.categoryNamesForQuery("تەربىيىسىدە"), []);
    assert.deepStrictEqual(Ai.categoryNamesForQuery("ئاتا-ئانا"), []);
    assert.ok(Ai.categoryNamesForQuery("تارىخىي رومان").indexOf("تارىخىي رومان") !== -1);
    const economics = catalog.filter((row) => row.category === "ئىقتىساد").map((row) => book(row, { category_matched: true }));
    const out = await search("ئىقتىساد", {}, { catalogRows: economics });
    assert.strictEqual(out.state.openai, 0);
    assert.ok(out.json.results.some((row) => row.id === 701));
    assert.ok(out.json.results.some((row) => row.id === 704));
    assert.ok(out.json.results.every((row) => row.category === "ئىقتىساد"));
    assert.equal("category_matched" in out.json.results[0], false);
    const fresh = await search("يېڭى ئاپتوماتىك تۈر", {}, {
      catalogRows: [book({ id: 91001, title: "يېڭى ماۋزۇ", author: "سىناق", category: "يېڭى ئاپتوماتىك تۈر" }, { category_matched: true })]
    });
    assert.strictEqual(fresh.json.results.length, 1);
    assert.strictEqual(fresh.json.results[0].id, 91001);
    assert.strictEqual(AiUi.publicResultHref(fresh.json.results[0]), "/book/91001");
    const historical = await search("رومان", {}, {
      catalogRows: [
        book({ id: 296, title: "قۇتادغۇبىلىك (رومانلاشتۇرۇلغان نۇسخىسى)", category: "رومان" }, { category_matched: true }),
        book({ id: 158, title: "ئىز", category: "تارىخىي رومان" }, { category_matched: false })
      ]
    });
    assert.deepStrictEqual(historical.json.results.map((row) => row.id), [296]);
  });

  await test("natural-language lexical evidence survives a weak vector list", async () => {
    const cases = [
      { query: "پۇلنى قانداق تېجەپ، بايلىقنى توغرا باشقۇرغىلى بولىدۇ", id: 701, title: "باي دادام نامرات دادام", category: "ئىقتىساد", description: "پۇلنى تېجەش ۋە بايلىقنى باشقۇرۇش" },
      { query: "قىرىق ياشقا بارغان ئاياللارنىڭ تۇرمۇشىدىكى ئۆزگىرىشلەر", id: 717, title: "ئاياللار 40 ياشتا", category: "پىسخىكىلىق ساغلاملىق", description: "قىرىق ياشقا بارغان ئاياللارنىڭ تۇرمۇشىدىكى ئۆزگىرىشلەر" },
      { query: "قەدىمكى ئۇيغۇر قاغانلىرىنىڭ تاشقا ئويۇلغان تارىخى", id: 146, title: "ئورخۇن ئۇيغۇر خانلىقىنىڭ قىسقىچە تارىخى", category: "تارىخىي ماتېرىيال", description: "قاغانلىرىنىڭ تاشقا ئويۇلغان تارىخى" },
      { query: "بالا تەربىيىسىدە ئاتا-ئانا نېمىلەرگە دىققەت قىلىشى كېرەك", id: 162, title: "ئىسلامدا ئەۋلاد تەربىيلەش ئۇسۇلى", category: "پەرزەنت تەربىيەسى", description: "بالا تەربىيىسىدە ئاتا-ئانا دىققىتى" },
      { query: "ئەندىشە ۋە غەم-قايغۇنى يەڭگىللىتىش يوللىرى", id: 476, title: "قايغۇرماڭ باتۇرلارچە ياشاڭ", category: "پىسخىكىلىق ساغلاملىق", description: "ئەندىشە ۋە غەم-قايغۇنى يەڭگىللىتىش" },
      { query: "ئۇيغۇر تىلىدىكى سۆز تۈرلىرى ۋە قوشۇمچىلارنى چۈشىنىش", id: 498, title: "ھازىرقى زامان ئۇيغۇرتىلى گرامماتىكىسى", category: "گرامماتىكا", description: "سۆز تۈرلىرى ۋە قوشۇمچىلار" },
      { query: "لەغمەن، پولۇ ۋە باشقا ئۇيغۇر تائاملىرىنى تەييارلاش", id: 709, title: "ئۇيغۇر تائاملىرى قامۇسى", category: "تائاملار", description: "لەغمەن ۋە پولۇ تەييارلاش" },
      { query: "تارىم دەرياسىنىڭ سۈيى ئازىيىشى ۋە تەبىئەتكە بولغان ئەندىشە", id: 142, title: "ئانا دەريانى ئىزدەپ", category: "پوۋېست ۋە ھېكايىلەر", description: "تارىم دەرياسىنىڭ سۈيى ئازىيىشى" }
    ];
    for (const item of cases) {
      const out = await search(item.query, {}, {
        catalogRows: [book({ id: item.id, title: item.title, category: item.category }, {
          description: item.description,
          description_matched: true
        })],
        vectorRows: [book({ id: 90001, title: "مۇناسىۋەتسىز ماتېرىيال", category: "ئۇنىۋېرسال" }, { similarity: 0.9 })]
      });
      assert.ok(out.json.results.some((row) => row.id === item.id), item.query);
      assert.ok(out.json.results.every((row) => row.id !== 90001), item.query);
      assert.equal("description" in out.json.results[0], false);
    }
  });

  await test("simulated lexical hits are not live semantic proof", async () => {
    const out = await search("لەغمەن، پولۇ ۋە باشقا ئۇيغۇر تائاملىرىنى تەييارلاش", {}, {
      catalogRows: [book({ id: 709, title: "ئۇيغۇر تائاملىرى قامۇسى", category: "تائاملار" }, {
        description_matched: true,
        description: "لەغمەن ۋە پولۇ"
      })],
      vectorRows: [book({ id: 709, title: "ئۇيغۇر تائاملىرى قامۇسى", category: "تائاملار" }, { similarity: 0.4359 })]
    });
    assert.strictEqual(out.json.results[0].id, 709);
    assert.ok(out.json.results[0].similarity < Ai.SEMANTIC_ACCEPT_FLOOR);
    const weakOnly = await search("لەغمەن، پولۇ ۋە باشقا ئۇيغۇر تائاملىرىنى تەييارلاش", {}, {
      catalogRows: [],
      vectorRows: [book({ id: 709, title: "ئۇيغۇر تائاملىرى قامۇسى", category: "تائاملار" }, { similarity: 0.4359 })]
    });
    assert.deepStrictEqual(weakOnly.json.results, []);
    assert.strictEqual(Ai.SEMANTIC_ACCEPT_FLOOR, 0.55);
  });

  await test("unrelated queries do not pass on a short token or a below-floor neighbor", async () => {
    const noise = await search("ھاۋارايىدىكى بۇلۇتلار", {}, {
      catalogRows: [book({ id: 42, title: "ئانا", category: "رومان" }, { description_matched: false, description: "ۋە" })],
      vectorRows: [book({ id: 42, title: "ئانا", category: "رومان" }, { similarity: 0.5 })]
    });
    assert.deepStrictEqual(noise.json.results, []);
    const closed = await search("پۇلنى تېجەپ بايلىقنى باشقۇرۇش", {}, {
      catalogRows: [book({ id: 701, title: "باي دادام نامرات دادام", category: "ئىقتىساد" }, { description_matched: true })],
      reserveAllowed: false,
      vectorRows: [book({ id: 90002, title: "باشقا", category: "ئۇنىۋېرسال" }, { similarity: 0.99 })]
    });
    assert.strictEqual(closed.json.results[0].id, 701);
    assert.strictEqual(closed.state.openai, 0);
  });

  await test("sb_secret keys are sent only as apikey", async () => {
    const secret = "sb_secret_mock_not_real";
    const legacy = "test-supabase-rpc-key";
    const row = catalog.find((item) => item.title === "ئىز");
    const modern = await search(row.title, { SUPABASE_SECRET_KEY: secret }, { catalogRows: [book(row)] });
    const legacyOut = await search(row.title, { SUPABASE_SECRET_KEY: legacy }, { catalogRows: [book(row)] });
    modern.state.calls.filter((call) => call.url.indexOf("/rest/v1/") !== -1).forEach((call) => {
      assert.strictEqual(call.headers.apikey, secret);
      assert.equal(Object.prototype.hasOwnProperty.call(call.headers, "Authorization"), false);
    });
    legacyOut.state.calls.filter((call) => call.url.indexOf("/rest/v1/") !== -1).forEach((call) => {
      assert.strictEqual(call.headers.apikey, legacy);
      assert.strictEqual(call.headers.Authorization, "Bearer " + legacy);
    });
    assert.strictEqual(modern.state.openai, 0);
    assert.equal(JSON.stringify(modern.json).indexOf(secret), -1);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search stage 2 test(s) failed");
    process.exit(1);
  }
  console.log("ai-search-stage2-catalog-tests ok");
});
