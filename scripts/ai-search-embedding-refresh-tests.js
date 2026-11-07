#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Embed = require("./ai-search-1d-generate-book-embeddings.js");

const root = path.join(__dirname, "..");
const workflowPath = path.join(root, ".github", "workflows", "ai-search-embedding-refresh.yml");

let failed = 0;

function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.stack || err);
  });
}

function book(id, overrides) {
  return Object.assign({
    id: id,
    title: "title " + id,
    author: "author " + id,
    category: "category " + id,
    publisher: "publisher " + id,
    translator: "translator " + id,
    description: "description " + id,
    price: 10,
    stock: 3,
    image_url: "https://example.invalid/cover-" + id + ".png",
    sales_count: 4,
    is_active: true,
    submission_status: "approved"
  }, overrides || {});
}

function fakeVector(seed) {
  const out = new Array(Embed.EMBEDDING_DIMENSIONS);
  for (let i = 0; i < out.length; i += 1) out[i] = Number(((seed + i) % 97) / 97);
  return out;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    async text() {
      return body == null ? "" : JSON.stringify(body);
    }
  };
}

function storedRow(row) {
  const sourceText = Embed.buildSourceText(row);
  return {
    book_id: row.id,
    embedding_model: Embed.EMBEDDING_MODEL,
    source_text_hash: Embed.hashSourceText(sourceText)
  };
}

function makeFetch(state) {
  state.calls = [];
  state.openaiPosts = 0;
  state.embeddingWrites = 0;
  return async function fetchMock(url, init) {
    const href = String(url);
    const method = String((init && init.method) || "GET").toUpperCase();
    state.calls.push({ url: href, method: method, headers: init && init.headers });
    if (method === "GET" && /\/rest\/v1\/books\?/.test(href)) {
      return jsonResponse(200, state.books || []);
    }
    if (method === "GET" && /\/rest\/v1\/book_embeddings\?/.test(href)) {
      return jsonResponse(200, state.embeddings || []);
    }
    if (method === "POST" && href === Embed.OPENAI_EMBEDDINGS_URL) {
      state.openaiPosts += 1;
      if (state.failOpenAi) return jsonResponse(state.failOpenAi, { error: { message: "mock" } });
      const input = JSON.parse(init.body).input;
      assert.ok(input.length <= Embed.BATCH_SIZE);
      return jsonResponse(200, {
        data: input.map((_, index) => ({ index: index, embedding: fakeVector(index + 1) }))
      });
    }
    if (method === "POST" && /\/rest\/v1\/book_embeddings\?/.test(href)) {
      state.embeddingWrites += 1;
      if (state.failWrite) return jsonResponse(500, { message: "mock write failed" });
      const rows = JSON.parse(init.body);
      state.wroteIds = rows.map((row) => row.book_id);
      const headers = init.headers || {};
      state.supabaseAuthorization = Object.prototype.hasOwnProperty.call(headers, "Authorization");
      return jsonResponse(201, null);
    }
    return jsonResponse(404, { message: "unexpected" });
  };
}

function applyEnv(serviceKey) {
  return {
    SUPABASE_SERVICE_ROLE_KEY: serviceKey || "sb_secret_mock_refresh_key",
    OPENAI_API_KEY: "sk-mock-refresh-not-real",
    AI_SEARCH_1D_CONFIRM_PROJECT: Embed.EXPECTED_PROJECT_REF,
    SUPABASE_URL: Embed.DEFAULT_SUPABASE_URL
  };
}

async function apply(state, argv) {
  return Embed.runBackfill({
    argv: argv || ["node", "script.js", "--apply"],
    env: applyEnv(),
    fetchImpl: makeFetch(state),
    log: function () {},
    maxRetries: 0
  });
}

async function run() {
  await test("workflow syntax, schedule, and safety gates", () => {
    const text = fs.readFileSync(workflowPath, "utf8");
    assert.strictEqual(text.includes("\r"), false);
    assert.match(text, /^name: AI Search embedding refresh\n/);
    assert.match(text, /schedule:\n {4}- cron: "30 1 \* \* \*"/);
    assert.doesNotMatch(text, /pull_request/);
    assert.doesNotMatch(text, /workflow_call/);
    assert.doesNotMatch(text, /continue-on-error/);
    assert.match(text, /permissions:\n {2}contents: read\n/);
    assert.match(text, /concurrency:\n {2}group: ai-search-embedding-refresh\n {2}cancel-in-progress: false\n/);
    assert.match(text, /vars\.AI_SEARCH_EMBEDDING_REFRESH_ENABLED == 'true'/);
    assert.match(text, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
    assert.match(text, /github\.event_name == 'schedule'/);
    assert.match(text, /github\.event_name == 'workflow_dispatch'/);
    assert.match(text, /environment: ai-search-embedding-refresh\n/);
    assert.match(text, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(text, /persist-credentials: false/);
    assert.match(text, /node scripts\/ai-search-1d-generate-book-embeddings\.js --apply\n/);
    assert.match(text, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
    assert.match(text, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
    assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9]/);
    assert.doesNotMatch(text, /sk-[A-Za-z0-9]/);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9]/);
    assert.strictEqual((text.match(/--apply/g) || []).length, 1);

    const lines = text.split("\n");
    let indent = 0;
    lines.forEach((line, index) => {
      if (!line.trim() || line.trim().startsWith("#")) return;
      const spaces = line.match(/^ */)[0].length;
      assert.strictEqual(spaces % 2, 0, "odd indent at line " + (index + 1));
      assert.ok(spaces <= indent + 2, "indent jump at line " + (index + 1));
      indent = spaces;
    });
  });

  await test("source fields detect content changes and ignore commerce fields", () => {
    assert.deepStrictEqual(Embed.SOURCE_FIELDS.slice(), [
      "title", "author", "category", "publisher", "translator", "description"
    ]);
    ["price", "stock", "image_url", "sales_count", "cover", "image"].forEach((field) => {
      assert.ok(Embed.EXCLUDED_FIELDS.indexOf(field) !== -1);
    });
    const original = book(7);
    const hash = Embed.hashSourceText(Embed.buildSourceText(original));
    ["title", "author", "category", "publisher", "translator", "description"].forEach((field) => {
      const changed = book(7);
      changed[field] = "changed " + field;
      const classified = Embed.classifyPlans([changed], [storedRow(original)]);
      assert.strictEqual(classified.stale.length, 1, field);
      assert.strictEqual(classified.stale[0].staleReason, "hash");
      assert.notStrictEqual(Embed.hashSourceText(Embed.buildSourceText(changed)), hash);
    });
    const commerce = book(7, {
      price: 99,
      stock: 0,
      image_url: "https://example.invalid/other.png",
      sales_count: 500,
      cover: "new-cover",
      image: "new-image"
    });
    const same = Embed.classifyPlans([commerce], [storedRow(original)]);
    assert.strictEqual(same.unchanged.length, 1);
    assert.strictEqual(same.stale.length, 0);
    assert.strictEqual(same.missing.length, 0);
  });

  await test("a new book is embedded and an unchanged book is skipped", async () => {
    const fresh = { books: [book(11)], embeddings: [] };
    const created = await apply(fresh);
    assert.strictEqual(created.missing, 1);
    assert.strictEqual(created.wrote, 1);
    assert.strictEqual(created.openaiCalls, 1);
    assert.deepStrictEqual(fresh.wroteIds, [11]);
    assert.strictEqual(fresh.supabaseAuthorization, false);

    const current = book(12);
    const same = { books: [current], embeddings: [storedRow(current)] };
    const skipped = await apply(same);
    assert.strictEqual(skipped.unchanged, 1);
    assert.strictEqual(skipped.toEmbed, 0);
    assert.strictEqual(skipped.wrote, 0);
    assert.strictEqual(skipped.openaiCalls, 0);
    assert.strictEqual(same.openaiPosts, 0);
    assert.strictEqual(same.embeddingWrites, 0);
  });

  await test("a changed description is refreshed and commerce edits are not", async () => {
    const original = book(21);
    const changed = book(21, { description: "updated description" });
    const state = { books: [changed], embeddings: [storedRow(original)] };
    const result = await apply(state);
    assert.strictEqual(result.stale, 1);
    assert.strictEqual(result.wrote, 1);
    assert.deepStrictEqual(state.wroteIds, [21]);

    const priced = book(22, { price: 80, stock: 1, sales_count: 9 });
    const quiet = { books: [priced], embeddings: [storedRow(book(22))] };
    const skipped = await apply(quiet);
    assert.strictEqual(skipped.unchanged, 1);
    assert.strictEqual(skipped.wrote, 0);
    assert.strictEqual(quiet.openaiPosts, 0);
  });

  await test("one apply writes at most 25 books", async () => {
    assert.strictEqual(Embed.MAX_APPLY_BATCHES, 1);
    assert.strictEqual(Embed.BATCH_SIZE, 25);
    const books = [];
    for (let id = 1; id <= 26; id += 1) books.push(book(id));
    const state = { books: books, embeddings: [] };
    const result = await apply(state);
    assert.strictEqual(result.missing, 26);
    assert.strictEqual(result.wrote, 25);
    assert.strictEqual(result.remaining, 1);
    assert.strictEqual(result.openaiCalls, 1);
    assert.strictEqual(state.openaiPosts, 1);
    assert.strictEqual(state.embeddingWrites, 1);
    assert.strictEqual(state.wroteIds.length, 25);
  });

  await test("a failed OpenAI request or database write stops the run", async () => {
    const openai = { books: [book(31)], embeddings: [], failOpenAi: 503 };
    await assert.rejects(() => apply(openai));
    assert.strictEqual(openai.embeddingWrites, 0);
    assert.strictEqual(openai.openaiPosts, 1);

    const write = { books: [book(32)], embeddings: [], failWrite: true };
    await assert.rejects(() => apply(write));
    assert.strictEqual(write.openaiPosts, 1);
    assert.strictEqual(write.embeddingWrites, 1);
    assert.strictEqual(write.wroteIds, undefined);
  });

  await test("dry-run remains the default and makes no paid call", async () => {
    const state = { books: [book(41)], embeddings: [] };
    const result = await Embed.runBackfill({
      argv: ["node", "script.js"],
      env: {
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_mock_refresh_key",
        SUPABASE_URL: Embed.DEFAULT_SUPABASE_URL
      },
      fetchImpl: makeFetch(state),
      log: function () {}
    });
    assert.strictEqual(result.mode, "dry-run");
    assert.strictEqual(result.openaiCalls, 0);
    assert.strictEqual(result.wrote, 0);
    assert.strictEqual(state.openaiPosts, 0);
    assert.strictEqual(state.embeddingWrites, 0);
  });

  if (failed) {
    console.error(failed + " failed");
    process.exitCode = 1;
  }
}

run();
