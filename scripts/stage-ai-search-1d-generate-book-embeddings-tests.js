#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Embed = require("./ai-search-1d-generate-book-embeddings.js");

const FROZEN = {
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "shop.js": "2fbde49a913b7eb888cb9b245386e2647cf01ec31de043c6e7fc197ef8afca0d"
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
  const out = new Array(Embed.EMBEDDING_DIMENSIONS);
  for (let i = 0; i < out.length; i += 1) out[i] = Number(((seed + i) % 97) / 97);
  return out;
}

function jsonResponse(status, body, extraHeaders) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: extraHeaders || {},
    async text() {
      return body == null ? "" : JSON.stringify(body);
    }
  };
}

function bookRow(overrides) {
  return Object.assign({
    id: 1,
    title: "ئانا",
    author: "چىڭگىز ئەيتىماتوف",
    category: "رومان",
    publisher: "شىنجاڭ",
    translator: "",
    description: "قىسقىچە چۈشەندۈرۈش.",
    is_active: true,
    submission_status: "approved",
    price: 99,
    stock: 4,
    isbn: "9781234567890",
    image_url: "https://example.invalid/cover.png",
    sales_count: 12,
    is_new: true,
    is_recommended: true,
    is_available: true
  }, overrides || {});
}

function applyEnv(overrides) {
  return Object.assign({
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    OPENAI_API_KEY: "test-openai-key",
    AI_SEARCH_1D_CONFIRM_PROJECT: Embed.EXPECTED_PROJECT_REF,
    SUPABASE_URL: Embed.DEFAULT_SUPABASE_URL
  }, overrides || {});
}

function makeFetchMock(state) {
  state.calls = [];
  state.openaiPosts = 0;
  state.embeddingWrites = 0;
  state.bookWrites = 0;
  state.openaiFailTimes = state.openaiFailTimes || 0;
  state.openaiStatus = state.openaiStatus || 200;
  return async function fetchMock(url, init) {
    const href = String(url);
    const method = String((init && init.method) || "GET").toUpperCase();
    state.calls.push({ url: href, method, body: init && init.body, headers: init && init.headers });
    if (method !== "GET" && /\/rest\/v1\/books(\?|$)/.test(href)) {
      state.bookWrites += 1;
      return jsonResponse(403, { message: "books writes forbidden in test" });
    }
    if (method === "GET" && /\/rest\/v1\/books\?/.test(href)) {
      return jsonResponse(200, state.books || []);
    }
    if (method === "GET" && /\/rest\/v1\/book_embeddings\?/.test(href)) {
      assert.match(href, /select=book_id,embedding_model,source_text_hash/);
      assert.doesNotMatch(href, /embedding,/);
      return jsonResponse(200, state.embeddings || []);
    }
    if (method === "POST" && href === Embed.OPENAI_EMBEDDINGS_URL) {
      state.openaiPosts += 1;
      if (state.openaiFailTimes > 0) {
        state.openaiFailTimes -= 1;
        return jsonResponse(state.openaiStatus, { error: { message: "retry" } });
      }
      const payload = JSON.parse(init.body);
      const input = payload.input;
      const data = input.map((_, index) => ({
        index,
        embedding: (state.vectors && state.vectors[index]) || fakeVector(index + 1)
      }));
      if (state.shuffleOpenAi) data.reverse();
      return jsonResponse(200, { data });
    }
    if (method === "POST" && /\/rest\/v1\/book_embeddings\?/.test(href)) {
      state.embeddingWrites += 1;
      if (state.failWriteAfter && state.embeddingWrites > state.failWriteAfter) {
        return jsonResponse(500, { message: "write failed" });
      }
      const rows = JSON.parse(init.body);
      state.upserts = (state.upserts || []).concat(rows);
      return jsonResponse(201, null);
    }
    return jsonResponse(404, { message: "unexpected " + method + " " + href });
  };
}

const sample = bookRow();
const sourceA = Embed.buildSourceText(sample);

async function run() {
  await test("source text uses NFC, trim, collapsed whitespace, and version marker", () => {
    const messy = bookRow({
      title: "  ئانا\n\n  ",
      author: "چىڭگىز   ئەيتىماتوف",
      description: "  قىسقىچە   چۈشەندۈرۈش.  "
    });
    const text = Embed.buildSourceText(messy);
    assert.strictEqual(text.split("\n")[0], "kutadgu-book-embedding-v1");
    assert.match(text, /^kutadgu-book-embedding-v1\n/);
    assert.doesNotMatch(text, /  /);
    assert.strictEqual(text, sourceA);
    const composed = Embed.normalizeField("\u0065\u0301");
    assert.strictEqual(composed, "é");
  });

  await test("fixed field order and empty fields are skipped", () => {
    const text = Embed.buildSourceText(sample);
    const lines = text.split("\n");
    assert.deepStrictEqual(lines, [
      "kutadgu-book-embedding-v1",
      "title: ئانا",
      "author: چىڭگىز ئەيتىماتوف",
      "category: رومان",
      "publisher: شىنجاڭ",
      "description: قىسقىچە چۈشەندۈرۈش."
    ]);
    assert.doesNotMatch(text, /translator:/);
    assert.deepStrictEqual(Embed.SOURCE_FIELDS, [
      "title", "author", "category", "publisher", "translator", "description"
    ]);
  });

  await test("SHA-256 is stable and volatile fields are excluded", () => {
    const a = Embed.hashSourceText(sourceA);
    const b = Embed.hashSourceText(Embed.buildSourceText(bookRow({ price: 1, stock: 0, isbn: "000", sales_count: 99 })));
    assert.strictEqual(a, b);
    assert.strictEqual(a, crypto.createHash("sha256").update(sourceA, "utf8").digest("hex"));
    assert.doesNotMatch(sourceA, /99|9781234567890|cover\.png|price:|stock:|isbn:|sales_count|is_new|is_recommended|is_available|submission_status/);
    Embed.EXCLUDED_FIELDS.forEach((field) => {
      assert.doesNotMatch(sourceA, new RegExp("\\b" + field + ":"));
    });
  });

  await test("only active approved books are planned", () => {
    const books = [
      bookRow({ id: 1 }),
      bookRow({ id: 2, is_active: false, submission_status: "approved" }),
      bookRow({ id: 3, is_active: true, submission_status: "pending" }),
      bookRow({ id: 4, title: "", author: "", category: "", publisher: "", translator: "", description: "" })
    ];
    const classified = Embed.classifyPlans(books, []);
    assert.deepStrictEqual(classified.missing.map((row) => row.bookId), [1]);
    assert.deepStrictEqual(classified.ignoredInactive, [2, 3]);
    assert.deepStrictEqual(classified.skippedEmpty, [4]);
  });

  await test("unchanged hash+model is skipped; hash or model change re-embeds", () => {
    const hash = Embed.hashSourceText(sourceA);
    const same = Embed.classifyPlans([sample], [{
      book_id: 1,
      embedding_model: Embed.EMBEDDING_MODEL,
      source_text_hash: hash
    }]);
    assert.strictEqual(same.unchanged.length, 1);
    assert.strictEqual(same.missing.length, 0);
    assert.strictEqual(same.stale.length, 0);

    const hashChange = Embed.classifyPlans([bookRow({ description: "باشقا تېكىست" })], [{
      book_id: 1,
      embedding_model: Embed.EMBEDDING_MODEL,
      source_text_hash: hash
    }]);
    assert.strictEqual(hashChange.stale[0].staleReason, "hash");

    const modelChange = Embed.classifyPlans([sample], [{
      book_id: 1,
      embedding_model: "text-embedding-3-small",
      source_text_hash: hash
    }]);
    assert.strictEqual(modelChange.stale[0].staleReason, "model");
  });

  await test("dry-run performs no OpenAI calls and no DB writes", async () => {
    const state = { books: [sample], embeddings: [] };
    const result = await Embed.runBackfill({
      argv: ["node", "script.js"],
      env: { SUPABASE_SERVICE_ROLE_KEY: "test-service-role" },
      fetchImpl: makeFetchMock(state),
      log() {}
    });
    assert.strictEqual(result.mode, "dry-run");
    assert.strictEqual(result.missing, 1);
    assert.strictEqual(result.openaiCalls, 0);
    assert.strictEqual(result.wrote, 0);
    assert.strictEqual(state.openaiPosts, 0);
    assert.strictEqual(state.embeddingWrites, 0);
    assert.strictEqual(state.bookWrites, 0);
    assert.ok(state.calls.every((call) => call.method === "GET"));
  });

  await test("apply requires explicit --apply guard and OpenAI key", async () => {
    const noFlag = Embed.parseArgs(["node", "script.js"]);
    assert.strictEqual(noFlag.apply, false);
    assert.strictEqual(Embed.parseArgs(["node", "script.js", "--apply"]).apply, true);

    const state = { books: [sample], embeddings: [] };
    await assert.rejects(
      () => Embed.runBackfill({
        argv: ["node", "script.js", "--apply"],
        env: applyEnv({ OPENAI_API_KEY: "" }),
        fetchImpl: makeFetchMock(state),
        log() {}
      }),
      (err) => err && err.envName === "OPENAI_API_KEY"
    );
    assert.strictEqual(state.openaiPosts, 0);
    assert.strictEqual(state.embeddingWrites, 0);
  });

  await test("apply requires confirm env and matching Supabase project URL", async () => {
    assert.strictEqual(Embed.EXPECTED_PROJECT_REF, "fxlojnqwyojqjskfggmh");
    assert.strictEqual(Embed.APPLY_CONFIRM_ENV, "AI_SEARCH_1D_CONFIRM_PROJECT");
    assert.strictEqual(
      Embed.supabaseProjectRefFromUrl("https://fxlojnqwyojqjskfggmh.supabase.co"),
      "fxlojnqwyojqjskfggmh"
    );

    const missing = { books: [sample], embeddings: [] };
    await assert.rejects(
      () => Embed.runBackfill({
        argv: ["node", "script.js", "--apply"],
        env: {
          SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
          OPENAI_API_KEY: "test-openai-key"
        },
        fetchImpl: makeFetchMock(missing),
        log() {}
      }),
      (err) => err && err.code === "apply_confirm_mismatch"
    );
    assert.strictEqual(missing.openaiPosts, 0);
    assert.strictEqual(missing.embeddingWrites, 0);
    assert.strictEqual(missing.calls.length, 0);

    const wrongConfirm = { books: [sample], embeddings: [] };
    await assert.rejects(
      () => Embed.runBackfill({
        argv: ["node", "script.js", "--apply"],
        env: applyEnv({ AI_SEARCH_1D_CONFIRM_PROJECT: "otherprojectref000" }),
        fetchImpl: makeFetchMock(wrongConfirm),
        log() {}
      }),
      (err) => err && err.code === "apply_confirm_mismatch"
    );
    assert.strictEqual(wrongConfirm.openaiPosts, 0);
    assert.strictEqual(wrongConfirm.embeddingWrites, 0);
    assert.strictEqual(wrongConfirm.calls.length, 0);

    const wrongUrl = { books: [sample], embeddings: [] };
    await assert.rejects(
      () => Embed.runBackfill({
        argv: ["node", "script.js", "--apply"],
        env: applyEnv({ SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co" }),
        fetchImpl: makeFetchMock(wrongUrl),
        log() {}
      }),
      (err) => err && err.code === "apply_url_mismatch"
    );
    assert.strictEqual(wrongUrl.openaiPosts, 0);
    assert.strictEqual(wrongUrl.embeddingWrites, 0);
    assert.strictEqual(wrongUrl.calls.length, 0);
  });

  await test("dry-run does not require OPENAI_API_KEY but does require service role", async () => {
    await assert.rejects(
      () => Embed.runBackfill({
        argv: ["node", "script.js"],
        env: {},
        fetchImpl: makeFetchMock({ books: [], embeddings: [] }),
        log() {}
      }),
      (err) => err && err.envName === "SUPABASE_SERVICE_ROLE_KEY"
    );
    const result = await Embed.runBackfill({
      argv: ["node", "script.js"],
      env: { SUPABASE_SERVICE_ROLE_KEY: "test-service-role" },
      fetchImpl: makeFetchMock({ books: [sample], embeddings: [] }),
      log() {}
    });
    assert.strictEqual(result.mode, "dry-run");
  });

  await test("apply batches 25, validates 1536-d vectors, upserts embeddings only", async () => {
    const books = [];
    for (let i = 1; i <= 26; i += 1) books.push(bookRow({ id: i, title: "كىتاب " + i }));
    const state = { books, embeddings: [] };
    const result = await Embed.runBackfill({
      argv: ["node", "script.js", "--apply"],
        env: applyEnv(),
      fetchImpl: makeFetchMock(state),
      log() {}
    });
    assert.strictEqual(result.mode, "apply");
    assert.strictEqual(result.openaiCalls, 2);
    assert.strictEqual(state.openaiPosts, 2);
    assert.strictEqual(state.embeddingWrites, 2);
    assert.strictEqual(result.wrote, 26);
    assert.strictEqual(state.bookWrites, 0);
    assert.ok(state.calls.some((call) => call.method === "POST" && /book_embeddings/.test(call.url)));
    assert.ok(state.calls.every((call) => call.method === "GET" || /book_embeddings|embeddings$/.test(call.url)));
    const firstWrite = JSON.parse(state.calls.find((call) => call.method === "POST" && /book_embeddings/.test(call.url)).body);
    assert.strictEqual(firstWrite.length, 25);
    assert.ok(firstWrite[0].embedding.startsWith("["));
    assert.strictEqual(firstWrite[0].embedding.split(",").length, 1536);
    assert.strictEqual(firstWrite[0].embedding_model, "text-embedding-3-large");
    assert.ok(!("price" in firstWrite[0]));
    const openaiBody = JSON.parse(state.calls.find((call) => call.url === Embed.OPENAI_EMBEDDINGS_URL).body);
    assert.strictEqual(openaiBody.model, "text-embedding-3-large");
    assert.strictEqual(openaiBody.dimensions, 1536);
    assert.strictEqual(openaiBody.input.length, 25);
  });

  await test("invalid vector length or non-finite values are rejected without writes", async () => {
    const short = await Embed.runBackfill({
      argv: ["node", "script.js", "--apply"],
        env: applyEnv(),
      fetchImpl: makeFetchMock({
        books: [sample],
        embeddings: [],
        vectors: [fakeVector(1).slice(0, 10)]
      }),
      log() {}
    }).then(() => "ok", (err) => err);
    assert.strictEqual(short.code, "embedding_dimension_mismatch");

    const nanState = {
      books: [sample],
      embeddings: [],
      vectors: [fakeVector(1)]
    };
    nanState.vectors[0][0] = Number.NaN;
    const nan = await Embed.runBackfill({
      argv: ["node", "script.js", "--apply"],
        env: applyEnv(),
      fetchImpl: makeFetchMock(nanState),
      log() {}
    }).then(() => "ok", (err) => err);
    assert.strictEqual(nan.code, "embedding_non_finite");
    assert.strictEqual(nanState.embeddingWrites, 0);
  });

  await test("OpenAI response indexes are remapped; mismatch fails closed", () => {
    const plans = [{ bookId: 7, sourceText: "a", sourceTextHash: "h", embeddingModel: Embed.EMBEDDING_MODEL }];
    const ok = Embed.validateEmbeddingResponse(plans, {
      data: [{ index: 0, embedding: fakeVector(3) }]
    });
    assert.strictEqual(ok[0].book_id, 7);
    assert.throws(
      () => Embed.validateEmbeddingResponse(plans, { data: [{ index: 1, embedding: fakeVector(3) }] }),
      (err) => err.code === "embedding_index_mismatch"
    );
    const shuffled = Embed.validateEmbeddingResponse(
      [
        { bookId: 1, sourceText: "a", sourceTextHash: "h1", embeddingModel: Embed.EMBEDDING_MODEL },
        { bookId: 2, sourceText: "b", sourceTextHash: "h2", embeddingModel: Embed.EMBEDDING_MODEL }
      ],
      {
        data: [
          { index: 1, embedding: fakeVector(2) },
          { index: 0, embedding: fakeVector(1) }
        ]
      }
    );
    assert.strictEqual(shuffled[0].book_id, 1);
    assert.strictEqual(shuffled[1].book_id, 2);
  });

  await test("429 and 5xx retry; other errors fail closed", async () => {
    const retryState = {
      books: [sample],
      embeddings: [],
      openaiFailTimes: 2,
      openaiStatus: 429
    };
    const sleeps = [];
    const retried = await Embed.runBackfill({
      argv: ["node", "script.js", "--apply"],
        env: applyEnv(),
      fetchImpl: makeFetchMock(retryState),
      sleep: async (ms) => { sleeps.push(ms); },
      log() {}
    });
    assert.strictEqual(retried.ok, true);
    assert.ok(sleeps.length >= 2);
    assert.strictEqual(retryState.embeddingWrites, 1);

    const failState = {
      books: [sample],
      embeddings: [],
      openaiFailTimes: 1,
      openaiStatus: 400
    };
    const closed = await Embed.runBackfill({
      argv: ["node", "script.js", "--apply"],
        env: applyEnv(),
      fetchImpl: makeFetchMock(failState),
      sleep: async () => {},
      log() {}
    }).then(() => "ok", (err) => err);
    assert.strictEqual(closed.status, 400);
    assert.strictEqual(closed.failClosed, true);
    assert.strictEqual(failState.embeddingWrites, 0);
    assert.strictEqual(Embed.isRetryableStatus(429), true);
    assert.strictEqual(Embed.isRetryableStatus(503), true);
    assert.strictEqual(Embed.isRetryableStatus(400), false);
  });

  await test("resume/idempotent: completed books are skipped on rerun", async () => {
    const books = [bookRow({ id: 1 }), bookRow({ id: 2, title: "ئىككىنچى" })];
    const firstState = { books, embeddings: [], failWriteAfter: 1 };
    const first = await Embed.runBackfill({
      argv: ["node", "script.js", "--apply"],
        env: applyEnv(),
      fetchImpl: makeFetchMock(firstState),
      batchSize: 1,
      maxRetries: 0,
      sleep: async () => {},
      log() {}
    }).then(() => "ok", (err) => err);
    assert.strictEqual(first.status, 500);
    assert.strictEqual(firstState.embeddingWrites, 2);
    assert.strictEqual(firstState.upserts.length, 1);

    const completed = firstState.upserts[0];
    const secondState = {
      books,
      embeddings: [{
        book_id: completed.book_id,
        embedding_model: completed.embedding_model,
        source_text_hash: completed.source_text_hash
      }]
    };
    const second = await Embed.runBackfill({
      argv: ["node", "script.js", "--apply"],
        env: applyEnv(),
      fetchImpl: makeFetchMock(secondState),
      batchSize: 1,
      log() {}
    });
    assert.strictEqual(second.unchanged, 1);
    assert.strictEqual(second.toEmbed, 1);
    assert.strictEqual(second.wrote, 1);
    assert.strictEqual(secondState.openaiPosts, 1);
  });

  await test("secrets are redacted and never printed by the logger", async () => {
    const lines = [];
    const env = {
      SUPABASE_SERVICE_ROLE_KEY: "super-secret-service-value",
      OPENAI_API_KEY: "super-secret-openai-value"
    };
    await Embed.runBackfill({
      argv: ["node", "script.js"],
      env,
      fetchImpl: makeFetchMock({ books: [sample], embeddings: [] }),
      log() { lines.push(Array.prototype.slice.call(arguments).join(" ")); }
    });
    const joined = lines.join("\n");
    assert.doesNotMatch(joined, /super-secret-service-value/);
    assert.doesNotMatch(joined, /super-secret-openai-value/);
    assert.strictEqual(
      Embed.redactSecrets("token super-secret-openai-value OPENAI_API_KEY=super-secret-openai-value", env),
      "token [redacted] OPENAI_API_KEY=[redacted]"
    );
  });

  await test("eligible book query pins publication rules; script is storefront-isolated", () => {
    assert.match(Embed.BOOK_SELECT, /^id,title,author,category,publisher,translator,description,is_active,submission_status$/);
    assert.doesNotMatch(Embed.BOOK_SELECT, /isbn|price|stock|image_url/);
    const src = fs.readFileSync(path.join(root, "scripts/ai-search-1d-generate-book-embeddings.js"), "utf8");
    assert.match(src, /is_active=eq\.true/);
    assert.match(src, /submission_status=eq\.approved/);
    assert.match(src, /Never writes: public\.books/);
    assert.doesNotMatch(src, /require\("openai"\)/);
    assert.doesNotMatch(src, /require\(["']dotenv["']\)/);
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const rank = fs.readFileSync(path.join(root, "kutadgu-search-rank.js"), "utf8");
    assert.doesNotMatch(shop, /ai-search-1d|book_embeddings|match_active_books_ai/);
    assert.doesNotMatch(rank, /book_embeddings|text-embedding-3-large/);
    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(sha256(rel), FROZEN[rel], rel);
    });
    assert.doesNotMatch(fs.readFileSync(path.join(root, "package.json"), "utf8"), /"openai"/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, ".env.example"), "utf8"), /OPENAI_API_KEY\s*=\s*\S+/);
  });

  await test("chunk helper uses batch size 25", () => {
    const ids = [];
    for (let i = 0; i < 26; i += 1) ids.push(i);
    const batches = Embed.chunk(ids, Embed.BATCH_SIZE);
    assert.strictEqual(Embed.BATCH_SIZE, 25);
    assert.strictEqual(batches.length, 2);
    assert.strictEqual(batches[0].length, 25);
    assert.strictEqual(batches[1].length, 1);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search 1D test(s) failed");
    process.exit(1);
  }
  console.log("stage-ai-search-1d-generate-book-embeddings-tests ok");
});
