#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Ai = require("../kutadgu-ai-search.js");
const handler = require("../api/ai-search.js");

const FROZEN = {
  "kutadgu-search-rank.js": "87f083b9bfd62ce6ea0ce0df6bd796ca21a201a580b5ffb6dc3258326321831b",
  "shop.js": "3976a603d3057cb7872252048f40b3772ab63cd28216938924ba16a6c9e8a519"
};

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

function sha256(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex");
}

function fakeVector(seed) {
  const out = new Array(Ai.EMBEDDING_DIMENSIONS);
  for (let i = 0; i < out.length; i += 1) out[i] = Number(((seed + i) % 97) / 97);
  return out;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(body) { if (body != null) this.chunks.push(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); }
  };
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function makeFetch(state) {
  state.calls = [];
  return async function fetchImpl(url, init) {
    const href = String(url);
    const method = String((init && init.method) || "GET").toUpperCase();
    state.calls.push({ url: href, method, body: init && init.body, headers: init && init.headers });
    if (state.hangOpenAi && /api\.openai\.com/.test(href)) {
      return new Promise((_, reject) => {
        const signal = init && init.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }
    if (method === "POST" && href === Ai.OPENAI_EMBEDDINGS_URL) {
      if (state.openaiStatus && state.openaiStatus !== 200) {
        return jsonRes(state.openaiStatus, { error: { message: state.openaiMessage || "fail" } });
      }
      const payload = JSON.parse(init.body);
      const vector = state.vector || fakeVector(3);
      return jsonRes(200, {
        data: [{ index: state.openaiIndex == null ? 0 : state.openaiIndex, embedding: vector }]
      });
    }
    if (method === "POST" && /\/rest\/v1\/rpc\/match_active_books_ai$/.test(href)) {
      if (state.rpcStatus && state.rpcStatus !== 200) return jsonRes(state.rpcStatus, { message: "rpc fail" });
      return jsonRes(200, state.rpcRows || [{
        id: 12,
        title: "بالىلار تەربىيەسى",
        author: "A",
        category: "پەرزەنت تەربىيەسى",
        price: 80,
        image_url: "https://example.invalid/a.webp",
        stock: 4,
        similarity: 0.81,
        embedding: fakeVector(9),
        source_text_hash: "abc",
        embedding_model: "secret-model"
      }]);
    }
    if (/book_embeddings/.test(href) || /\/rest\/v1\/books/.test(href)) {
      state.forbidden = true;
      return jsonRes(403, { message: "forbidden table" });
    }
    return jsonRes(404, { message: "unexpected" });
  };
}

async function invoke(req, env, fetchImpl, extra) {
  const res = mockRes();
  const stats = await Ai.handleAiSearch(req, res, Object.assign({
    env: env || {},
    fetchImpl: fetchImpl || makeFetch({})
  }, extra || {}));
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.chunks.join(""),
    json: res.chunks.join("") ? JSON.parse(res.chunks.join("")) : null,
    stats
  };
}

async function run() {
  await test("AI Search is disabled by default with zero upstream calls", async () => {
    const state = {};
    const out = await invoke({ method: "POST", body: { query: "بالىلار تەربىيەسى" } }, {}, makeFetch(state));
    assert.strictEqual(out.status, 503);
    assert.strictEqual(out.json.ok, false);
    assert.strictEqual(out.json.error, "disabled");
    assert.strictEqual(out.headers["cache-control"], "no-store");
    assert.strictEqual(state.calls.length, 0);
    assert.strictEqual(out.stats.openaiCalls, 0);
    assert.strictEqual(out.stats.supabaseCalls, 0);
    assert.strictEqual(Ai.isEnabled({}), false);
    assert.strictEqual(Ai.isEnabled({ AI_SEARCH_ENABLED: "TRUE" }), false);
    assert.strictEqual(Ai.isEnabled({ AI_SEARCH_ENABLED: "1" }), false);
    assert.strictEqual(Ai.isEnabled({ AI_SEARCH_ENABLED: "true" }), true);
  });

  await test("only POST is allowed", async () => {
    const state = {};
    const get = await invoke({ method: "GET" }, { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" }, makeFetch(state));
    assert.strictEqual(get.status, 405);
    assert.strictEqual(get.json.error, "method_not_allowed");
    assert.strictEqual(state.calls.length, 0);
    const put = await invoke({ method: "PUT", body: { query: "بالىلار" } }, { AI_SEARCH_ENABLED: "true" }, makeFetch(state));
    assert.strictEqual(put.status, 405);
    assert.strictEqual(state.calls.length, 0);
  });

  await test("invalid empty and too-long queries are rejected without upstream calls", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" };
    const state = {};
    const fetchImpl = makeFetch(state);
    const missing = await invoke({ method: "POST", body: {} }, env, fetchImpl);
    assert.strictEqual(missing.status, 400);
    const empty = await invoke({ method: "POST", body: { query: "   " } }, env, fetchImpl);
    assert.strictEqual(empty.status, 400);
    const short = await invoke({ method: "POST", body: { query: "ا" } }, env, fetchImpl);
    assert.strictEqual(short.status, 400);
    const long = await invoke({ method: "POST", body: { query: "ك".repeat(301) } }, env, fetchImpl);
    assert.strictEqual(long.status, 400);
    assert.strictEqual(state.calls.length, 0);
    assert.strictEqual(Ai.normalizeQuery("  بالىلار\n\nتەربىيەسى  "), "بالىلار تەربىيەسى");
    assert.strictEqual(Ai.normalizeQuery("\u0065\u0301"), "é");
  });

  await test("enabled search uses text-embedding-3-large at 1536 and match_active_books_ai count 12", async () => {
    const state = {};
    const out = await invoke(
      { method: "POST", body: { query: "  بالىلار   تەربىيەسى  ", match_count: 99, model: "other" } },
      { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" },
      makeFetch(state)
    );
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.ok, true);
    assert.strictEqual(out.json.results.length, 1);
    assert.strictEqual(out.json.results[0].id, 12);
    assert.deepStrictEqual(Object.keys(out.json.results[0]).sort(), Ai.RESULT_FIELDS.slice().sort());
    assert.ok(!("embedding" in out.json.results[0]));
    assert.ok(!("source_text_hash" in out.json.results[0]));
    assert.ok(!("embedding_model" in out.json.results[0]));
    const openai = state.calls.find((call) => call.url === Ai.OPENAI_EMBEDDINGS_URL);
    const rpc = state.calls.find((call) => /rpc\/match_active_books_ai$/.test(call.url));
    assert.ok(openai && rpc);
    const openaiBody = JSON.parse(openai.body);
    assert.strictEqual(openaiBody.model, "text-embedding-3-large");
    assert.strictEqual(openaiBody.dimensions, 1536);
    assert.strictEqual(openaiBody.input, "بالىلار تەربىيەسى");
    const rpcBody = JSON.parse(rpc.body);
    assert.strictEqual(rpcBody.match_count, 12);
    assert.strictEqual(rpcBody.query_embedding.length, 1536);
    assert.ok(state.calls.every((call) => !/book_embeddings/.test(call.url)));
    assert.ok(state.calls.every((call) => call.method === "POST"));
    assert.ok(state.calls.every((call) => !/service_role/i.test(JSON.stringify(call.headers))));
    assert.ok(!state.forbidden);
  });

  await test("malformed and non-finite OpenAI vectors fail closed without RPC", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" };
    const shortState = { vector: fakeVector(1).slice(0, 8) };
    const short = await invoke({ method: "POST", body: { query: "بالىلار تەربىيەسى" } }, env, makeFetch(shortState));
    assert.strictEqual(short.status, 503);
    assert.strictEqual(short.json.error, "unavailable");
    assert.ok(!shortState.calls.some((call) => /rpc\//.test(call.url)));

    const nanVec = fakeVector(2);
    nanVec[0] = Number.NaN;
    const nanState = { vector: nanVec };
    const nan = await invoke({ method: "POST", body: { query: "بالىلار تەربىيەسى" } }, env, makeFetch(nanState));
    assert.strictEqual(nan.status, 503);
    assert.ok(!nanState.calls.some((call) => /rpc\//.test(call.url)));
    assert.doesNotMatch(JSON.stringify(nan.json), /sk-|Bearer |embedding/);
  });

  await test("timeout and OpenAI HTTP errors fail closed without leaking upstream bodies", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "super-secret-openai-value" };
    const hang = {};
    const timed = await invoke(
      { method: "POST", body: { query: "بالىلار تەربىيەسى" } },
      env,
      makeFetch(Object.assign(hang, { hangOpenAi: true })),
      { openaiTimeoutMs: 20 }
    );
    assert.strictEqual(timed.status, 503);
    assert.strictEqual(timed.json.error, "unavailable");
    assert.doesNotMatch(timed.body, /super-secret-openai-value/);

    const billed = { openaiStatus: 429, openaiMessage: "insufficient_quota super-secret-openai-value" };
    const rate = await invoke({ method: "POST", body: { query: "بالىلار تەربىيەسى" } }, env, makeFetch(billed));
    assert.strictEqual(rate.status, 503);
    assert.doesNotMatch(rate.body, /insufficient_quota|super-secret-openai-value/);
    assert.ok(!billed.calls.some((call) => /rpc\//.test(call.url)));
  });

  await test("Supabase RPC failure is a generic temporary error", async () => {
    const state = { rpcStatus: 500 };
    const out = await invoke(
      { method: "POST", body: { query: "بالىلار تەربىيەسى" } },
      { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" },
      makeFetch(state)
    );
    assert.strictEqual(out.status, 503);
    assert.strictEqual(out.json.error, "unavailable");
    assert.doesNotMatch(out.body, /rpc fail/);
  });

  await test("module never uses service role or writes tables", () => {
    const src = fs.readFileSync(path.join(root, "kutadgu-ai-search.js"), "utf8");
    const apiSrc = fs.readFileSync(path.join(root, "api/ai-search.js"), "utf8");
    assert.match(src, /match_active_books_ai/);
    assert.match(src, /match_count: MATCH_COUNT/);
    assert.doesNotMatch(src, /book_embeddings/);
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(apiSrc, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(src, /method:\s*"PATCH"|method:\s*"PUT"|method:\s*"DELETE"/);
    assert.doesNotMatch(src, /\/rest\/v1\/books/);
    assert.match(src, /sb_publishable_/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, ".env.example"), "utf8"), /AI_SEARCH_ENABLED\s*=\s*true/);
  });

  await test("existing Normal Search files remain byte-identical and unused by this API", () => {
    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(sha256(rel), FROZEN[rel], rel);
    });
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const rank = fs.readFileSync(path.join(root, "kutadgu-search-rank.js"), "utf8");
    assert.doesNotMatch(shop, /ai-search|match_active_books_ai|AI_SEARCH_ENABLED/);
    assert.doesNotMatch(rank, /ai-search|match_active_books_ai/);
    const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    assert.ok(!(vercel.rewrites || []).some((rule) => /ai-search/.test(JSON.stringify(rule))));
    assert.ok(fs.existsSync(path.join(root, "api/ai-search.js")));
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.doesNotMatch(html, /\/api\/ai-search/);
  });

  await test("handler module is the isolated Vercel entry", async () => {
    const orig = global.fetch;
    const state = {};
    global.fetch = makeFetch(state);
    const res = mockRes();
    try {
      await handler({ method: "POST", body: { query: "بالىلار تەربىيەسى" } }, res);
    } finally {
      global.fetch = orig;
    }
    const body = JSON.parse(res.chunks.join(""));
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(body.error, "disabled");
    assert.strictEqual(state.calls.length, 0);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search 1E test(s) failed");
    process.exit(1);
  }
  console.log("stage-ai-search-1e-backend-api-tests ok");
});
