#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Ai = require("../kutadgu-ai-search.js");
const handler = require("../api/ai-search.js");

const FROZEN = {
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "shop.js": "69b2b28337fa805d135594d02dc074780f3f0863c982b0d65db5cfd9366a688c"
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

function stalledBodyRes(status, signal) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return new Promise(() => {
        /* headers returned; body never resolves */
      });
    }
  };
}

function streamReq(chunks, method) {
  const req = new EventEmitter();
  req.method = method || "POST";
  process.nextTick(() => {
    (chunks || []).forEach((chunk) => req.emit("data", Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.emit("end");
  });
  return req;
}

function paddedBody(query, extraBytes) {
  return { query: query, padding: "x".repeat(extraBytes) };
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
    if (state.hangOpenAiBody && /api\.openai\.com/.test(href)) {
      return stalledBodyRes(200, init && init.signal);
    }
    if (state.hangRpcBody && /\/rest\/v1\/rpc\/match_active_books_ai$/.test(href)) {
      return stalledBodyRes(200, init && init.signal);
    }
    if (method === "POST" && href === Ai.OPENAI_EMBEDDINGS_URL) {
      if (state.openaiStatus && state.openaiStatus !== 200) {
        return jsonRes(state.openaiStatus, { error: { message: state.openaiMessage || "fail" } });
      }
      const vector = state.vector || fakeVector(3);
      const row = { embedding: vector };
      if (!state.omitIndex) {
        row.index = state.openaiIndex === undefined ? 0 : state.openaiIndex;
      }
      const payload = { data: [row] };
      if (state.extraEmbedding) payload.data.push(state.extraEmbedding);
      if (!state.omitModel) {
        payload.model = state.openaiModel === undefined ? Ai.EMBEDDING_MODEL : state.openaiModel;
      }
      return jsonRes(200, payload);
    }
    if (method === "POST" && /\/rest\/v1\/rpc\/list_active_books_by_categories_ai$/.test(href)) {
      return jsonRes(200, state.categoryRows || []);
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

  await test("enabled search uses text-embedding-3-large at 1536 and match_active_books_ai candidate window 24", async () => {
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
    assert.strictEqual(rpcBody.match_count, 24);
    assert.strictEqual(rpcBody.query_embedding.length, 1536);
    assert.strictEqual(out.json.count, 1);
    assert.ok(!("score" in out.json.results[0]));
    assert.ok(!("rerank" in out.json));
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
    assert.match(src, /match_count: CANDIDATE_COUNT/);
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

  await test("non-string queries are rejected before normalization with zero upstream calls", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" };
    const state = {};
    const fetchImpl = makeFetch(state);
    const cases = [{}, 123, true, ["books"]];
    for (const query of cases) {
      const out = await invoke({ method: "POST", body: { query } }, env, fetchImpl);
      assert.strictEqual(out.status, 400, "query=" + JSON.stringify(query));
      assert.strictEqual(out.json.error, "invalid_query");
    }
    assert.strictEqual(state.calls.length, 0);
    assert.strictEqual(Ai.normalizeQuery({}), "");
    assert.strictEqual(Ai.normalizeQuery(123), "");
  });

  await test("4KB body limit applies to object, string, Buffer, and streamed bodies", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" };
    const oversized = paddedBody("books", 5000);
    const objectState = {};
    const objectOut = await invoke({ method: "POST", body: oversized }, env, makeFetch(objectState));
    assert.strictEqual(objectOut.status, 400);
    assert.strictEqual(objectState.calls.length, 0);

    const json = JSON.stringify(oversized);
    assert.ok(Buffer.byteLength(json, "utf8") > Ai.MAX_BODY_BYTES);

    const stringState = {};
    const stringOut = await invoke({ method: "POST", body: json }, env, makeFetch(stringState));
    assert.strictEqual(stringOut.status, 400);
    assert.strictEqual(stringState.calls.length, 0);

    const bufferState = {};
    const bufferOut = await invoke({ method: "POST", body: Buffer.from(json, "utf8") }, env, makeFetch(bufferState));
    assert.strictEqual(bufferOut.status, 400);
    assert.strictEqual(bufferState.calls.length, 0);

    const streamState = {};
    const streamOut = await invoke(streamReq([json]), env, makeFetch(streamState));
    assert.strictEqual(streamOut.status, 400);
    assert.strictEqual(streamState.calls.length, 0);
  });

  await test("short query plus >4KB padding is rejected with zero upstream calls", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" };
    const state = {};
    const out = await invoke(
      { method: "POST", body: paddedBody("بالىلار", Ai.MAX_BODY_BYTES) },
      env,
      makeFetch(state)
    );
    assert.strictEqual(out.status, 400);
    assert.strictEqual(out.json.error, "invalid_query");
    assert.strictEqual(state.calls.length, 0);
    assert.strictEqual(out.stats.openaiCalls, 0);
    assert.strictEqual(out.stats.supabaseCalls, 0);
  });

  await test("OpenAI headers with a stalled body abort inside the deadline", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "super-secret-openai-value" };
    const state = { hangOpenAiBody: true };
    const started = Date.now();
    const out = await invoke(
      { method: "POST", body: { query: "بالىلار تەربىيەسى" } },
      env,
      makeFetch(state),
      { openaiTimeoutMs: 40 }
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, "elapsed=" + elapsed);
    assert.strictEqual(out.status, 503);
    assert.strictEqual(out.json.error, "unavailable");
    assert.doesNotMatch(out.body, /super-secret-openai-value|embedding|data/);
    assert.ok(!state.calls.some((call) => /rpc\//.test(call.url)));
  });

  await test("Supabase headers with a stalled body abort inside the deadline", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" };
    const state = { hangRpcBody: true };
    const started = Date.now();
    const out = await invoke(
      { method: "POST", body: { query: "بالىلار تەربىيەسى" } },
      env,
      makeFetch(state),
      { rpcTimeoutMs: 40 }
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, "elapsed=" + elapsed);
    assert.strictEqual(out.status, 503);
    assert.strictEqual(out.json.error, "unavailable");
    assert.doesNotMatch(out.body, /match_active_books_ai|embedding/);
    assert.strictEqual(state.calls.filter((call) => /rpc\//.test(call.url)).length, 1);
  });

  await test("OpenAI index, model, and vector mismatches fail closed without RPC", async () => {
    const env = { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" };
    const query = { method: "POST", body: { query: "بالىلار تەربىيەسى" } };

    const missing = { omitIndex: true };
    const missingOut = await invoke(query, env, makeFetch(missing));
    assert.strictEqual(missingOut.status, 503);
    assert.ok(!missing.calls.some((call) => /rpc\//.test(call.url)));

    const coerced = { openaiIndex: "0" };
    const coercedOut = await invoke(query, env, makeFetch(coerced));
    assert.strictEqual(coercedOut.status, 503);
    assert.ok(!coerced.calls.some((call) => /rpc\//.test(call.url)));

    const wrongIndex = { openaiIndex: 1 };
    const wrongIndexOut = await invoke(query, env, makeFetch(wrongIndex));
    assert.strictEqual(wrongIndexOut.status, 503);
    assert.ok(!wrongIndex.calls.some((call) => /rpc\//.test(call.url)));

    const wrongModel = { openaiModel: "text-embedding-ada-002" };
    const wrongModelOut = await invoke(query, env, makeFetch(wrongModel));
    assert.strictEqual(wrongModelOut.status, 503);
    assert.ok(!wrongModel.calls.some((call) => /rpc\//.test(call.url)));

    const twoRows = { extraEmbedding: { index: 1, embedding: fakeVector(4) } };
    const twoOut = await invoke(query, env, makeFetch(twoRows));
    assert.strictEqual(twoOut.status, 503);
    assert.ok(!twoRows.calls.some((call) => /rpc\//.test(call.url)));

    const infVec = fakeVector(5);
    infVec[3] = Number.POSITIVE_INFINITY;
    const infState = { vector: infVec };
    const infOut = await invoke(query, env, makeFetch(infState));
    assert.strictEqual(infOut.status, 503);
    assert.ok(!infState.calls.some((call) => /rpc\//.test(call.url)));

    const strVec = fakeVector(6);
    strVec[7] = "0.1";
    const strState = { vector: strVec };
    const strOut = await invoke(query, env, makeFetch(strState));
    assert.strictEqual(strOut.status, 503);
    assert.ok(!strState.calls.some((call) => /rpc\//.test(call.url)));
    assert.doesNotMatch(JSON.stringify(strOut.json), /embedding|text-embedding-ada-002/);
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
