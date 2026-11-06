#!/usr/bin/env node
"use strict";
const assert = require("assert");
const preview = require("../cloudflare/preview-dispatch.js");
const Ai = require("../kutadgu-ai-search.js");
const SeriesRoutes = require("../kutadgu-series-routes.js");

const SECRET = "test-ip-hash-secret";
const RPC = "test-supabase-rpc-key";
let failed = 0;

function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log("PASS", name);
  }).catch((error) => {
    failed += 1;
    console.error("FAIL", name, error && error.message);
  });
}

function vector() {
  return new Array(Ai.EMBEDDING_DIMENSIONS).fill(0.02);
}

function makeFetch(state) {
  return async function fetchImpl(url) {
    const href = String(url);
    state.order.push(href);
    if (/api\.openai\.com/.test(href)) {
      state.openai += 1;
      return { ok: true, status: 200, async json() { return { model: Ai.EMBEDDING_MODEL, data: [{ index: 0, embedding: vector() }] }; } };
    }
    if (/search_public_catalog_lexical$/.test(href)) {
      if (state.catalogStatus) return { ok: false, status: state.catalogStatus, async json() { return { message: "missing" }; } };
      return { ok: true, status: 200, async json() { return state.catalogRows || []; } };
    }
    if (/reserve_ai_search_paid_call$/.test(href)) {
      state.reserve += 1;
      if (state.reserveStatus) return { ok: false, status: state.reserveStatus, async json() { return { message: "missing" }; } };
      return { ok: true, status: 200, async json() { return [{ allowed: state.reserveAllowed !== false, remaining_micro_usd: 999900 }]; } };
    }
    if (/match_active_books_ai$/.test(href)) {
      return { ok: true, status: 200, async json() { return state.vectorRows || []; } };
    }
    if (/map_public_books_to_catalog_units$/.test(href)) {
      state.map = (state.map || 0) + 1;
      return { ok: true, status: 200, async json() { return state.mapRows || []; } };
    }
    if (/list_public_book_series_routes$/.test(href)) {
      return { ok: true, status: 200, async json() { return state.seriesRoutes || []; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
}

async function post(query, headers, env, state) {
  const response = await preview.dispatch(new Request("http://127.0.0.1:8787/api/ai-search", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
    body: JSON.stringify({ query })
  }), Object.assign({
    AI_SEARCH_ENABLED: "true",
    OPENAI_API_KEY: "test-openai-key",
    SUPABASE_SECRET_KEY: RPC,
    AI_SEARCH_IP_HASH_SECRET: SECRET
  }, env || {}), {
    aiSearch: Ai,
    fetchImpl: makeFetch(state)
  });
  return { status: response.status, json: await response.json(), state };
}

function fresh(extra) {
  return Object.assign({ order: [], openai: 0, reserve: 0, catalogRows: [], vectorRows: [] }, extra || {});
}

async function run() {
  const neighbor = {
    id: 5,
    title: "مۇناسىۋەتسىز",
    author: "A",
    category: "رومان",
    price: 10,
    image_url: "",
    stock: 1,
    similarity: 0.8
  };

  await test("a trusted Cloudflare identity reserves a paid call before OpenAI", async () => {
    const state = fresh({ vectorRows: [neighbor] });
    const out = await post("مەنىسى يېقىن ئىزدەش", { "cf-connecting-ip": "203.0.113.8" }, {}, state);
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.results.length, 1);
    assert.strictEqual(state.reserve, 1);
    assert.strictEqual(state.openai, 1);
    const reserveAt = state.order.findIndex((url) => /reserve_ai_search_paid_call/.test(url));
    const openaiAt = state.order.findIndex((url) => /api\.openai\.com/.test(url));
    assert.ok(reserveAt >= 0 && reserveAt < openaiAt);
  });

  await test("an exact catalog title does not call OpenAI", async () => {
    const state = fresh({
      catalogRows: [{ id: 36, title: "يەر ئانا", author: "چىڭغىز ئايتماتوۋ", category: "دۇنيا ئەدەبىياتى", price: 10, image_url: "", stock: 1, description: "" }]
    });
    const out = await post("يەر ئانا", { "cf-connecting-ip": "203.0.113.8" }, {}, state);
    assert.strictEqual(out.json.results[0].id, 36);
    assert.strictEqual(state.openai, 0);
    assert.strictEqual(state.reserve, 0);
  });

  await test("missing, spoofed, or unkeyed identity blocks paid calls", async () => {
    const missing = await post("مەنىسى يېقىن ئىزدەش", {}, {}, fresh({ vectorRows: [neighbor] }));
    assert.strictEqual(missing.json.semantic, "unavailable");
    assert.strictEqual(missing.state.openai, 0);
    const spoofed = await post("مەنىسى يېقىن ئىزدەش", { "x-forwarded-for": "198.51.100.4" }, {}, fresh({ vectorRows: [neighbor] }));
    assert.strictEqual(spoofed.state.openai, 0);
    assert.strictEqual(spoofed.state.reserve, 0);
    const unkeyed = await post("مەنىسى يېقىن ئىزدەش", { "cf-connecting-ip": "203.0.113.8" }, { AI_SEARCH_IP_HASH_SECRET: "" }, fresh({ vectorRows: [neighbor] }));
    assert.strictEqual(unkeyed.state.openai, 0);
  });

  await test("a missing catalog or budget function does not call OpenAI", async () => {
    const catalog = await post("يەر ئانا", { "cf-connecting-ip": "203.0.113.8" }, {}, fresh({ catalogStatus: 404, vectorRows: [neighbor] }));
    assert.strictEqual(catalog.status, 503);
    assert.strictEqual(catalog.state.openai, 0);
    assert.strictEqual(catalog.state.reserve, 0);
    const budget = await post("مەنىسى يېقىن ئىزدەش", { "cf-connecting-ip": "203.0.113.8" }, {}, fresh({ reserveStatus: 404, vectorRows: [neighbor] }));
    assert.strictEqual(budget.json.semantic, "unavailable");
    assert.strictEqual(budget.state.openai, 0);
    const exhausted = await post("مەنىسى يېقىن ئىزدەش", { "cf-connecting-ip": "203.0.113.8" }, {}, fresh({ reserveAllowed: false, vectorRows: [neighbor] }));
    assert.strictEqual(exhausted.state.openai, 0);
  });

  await test("the adapter returns one series card or the requested volume", async () => {
    const member = {
      id: 41,
      title: "ئويغانغان زېمىن 1. قىسىم",
      author: "ئابدۇرېھىم ئۆتكۈر",
      category: "تارىخىي رومان",
      price: 40,
      image_url: "https://example.invalid/member/41.webp",
      stock: 1,
      description: "",
      series_title: "ئويغانغان زېمىن",
      series_slug: "oyghanghan-zemin",
      series_group_id: 77,
      series_member_count: 2,
      series_lowest_price: 15,
      series_image_url: "https://example.invalid/series/oyghanghan-zemin.webp",
      series_representative_id: 41
    };
    const series = await post("ئويغانغان زېمىن", { "cf-connecting-ip": "203.0.113.8" }, {}, fresh({
      catalogRows: [member, Object.assign({}, member, { id: 42, title: "ئويغانغان زېمىن 2. قىسىم", price: 15 })]
    }));
    assert.strictEqual(series.json.results.length, 1);
    assert.strictEqual(series.json.results[0].kind, "group");
    assert.strictEqual(series.json.results[0].price, 15);
    assert.strictEqual(series.json.results[0].image_url, member.series_image_url);
    assert.strictEqual(SeriesRoutes.groupPath(series.json.results[0]), "/series/oyghanghan-zemin");
    assert.strictEqual(series.state.openai, 0);
    const volume = await post(member.title, { "cf-connecting-ip": "203.0.113.8" }, {}, fresh({ catalogRows: [member] }));
    assert.strictEqual(volume.json.results[0].id, 41);
    assert.notStrictEqual(volume.json.results[0].kind, "group");
    assert.strictEqual(volume.state.openai, 0);
  });

  await test("a mapped semantic series uses the canonical slug and keeps its price and cover", async () => {
    const cover = "https://example.invalid/series/oyghanghan-zemin.webp";
    const state = fresh({
      vectorRows: [
        { id: 156, title: "ئويغانغان زېمىن 1. قىسىم", author: "ئابدۇرېھىم ئۆتكۈر", category: "تارىخىي رومان", price: 40, image_url: "https://example.invalid/member.webp", stock: 1, similarity: 0.82 },
        { id: 901, title: "تاق كىتاب", author: "باشقا", category: "رومان", price: 11, image_url: "https://example.invalid/standalone.webp", stock: 1, similarity: 0.7 }
      ],
      mapRows: [
        {
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
          matched_book_ids: [156]
        },
        {
          kind: "book",
          id: 901,
          title: "تاق كىتاب",
          author: "باشقا",
          category: "رومان",
          price: 11,
          image_url: "https://example.invalid/standalone.webp",
          representative_book_id: 901,
          matched_book_ids: [901]
        }
      ],
      seriesRoutes: [{ group_id: 156, legacy_slug: "series-156", public_slug: "oyghanghan-zemin" }]
    });
    const out = await post("مەنىسى يېقىن ئىزدەش", { "cf-connecting-ip": "203.0.113.8" }, { MULTI_VOLUME_BOOKS_ENABLED: "true" }, state);
    const series = out.json.results.find((row) => row.kind === "group");
    assert.ok(series);
    assert.strictEqual(series.group_slug, "series-156");
    assert.strictEqual(series.public_slug, "oyghanghan-zemin");
    assert.strictEqual(series.price, 18);
    assert.strictEqual(series.image_url, cover);
    assert.strictEqual(SeriesRoutes.groupPath(series), "/series/oyghanghan-zemin");
    assert.ok(out.json.results.some((row) => row.id === 901 && row.kind !== "group"));
    assert.strictEqual(state.openai, 1);
    assert.ok(state.map >= 1);
  });
}

run().then(() => {
  if (failed) {
    console.error(failed + " cloudflare AI search test(s) failed");
    process.exit(1);
  }
  console.log("ai-search-stage2-cloudflare-tests ok");
});
