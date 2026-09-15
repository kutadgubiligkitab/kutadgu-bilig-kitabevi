#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Ai = require("../kutadgu-ai-search.js");

const FROZEN = {
  "kutadgu-search-rank.js": "87f083b9bfd62ce6ea0ce0df6bd796ca21a201a580b5ffb6dc3258326321831b",
  "shop.js": "3976a603d3057cb7872252048f40b3772ab63cd28216938924ba16a6c9e8a519",
  "kutadgu-ai-search-ui.js": shaOf("kutadgu-ai-search-ui.js"),
  "index.html": shaOf("index.html"),
  "ai-search-ui.css": shaOf("ai-search-ui.css")
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

function shaOf(rel) {
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

function book(id, extra) {
  return Object.assign({
    id,
    title: "كىتاب " + id,
    author: "ئاپتور",
    category: "ئۇنىۋېرسال",
    price: 10,
    image_url: "https://example.invalid/" + id + ".webp",
    stock: 1,
    similarity: 0.2
  }, extra || {});
}

function makeFetch(rpcRows, extra) {
  extra = extra || {};
  const state = { calls: [], openai: 0, rpc: 0, categoryRpc: 0 };
  state.fetchImpl = async function fetchImpl(url, init) {
    const href = String(url);
    state.calls.push({ url: href, method: String((init && init.method) || "GET"), body: init && init.body, headers: init && init.headers });
    if (/api\.openai\.com/.test(href)) {
      state.openai += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return { model: Ai.EMBEDDING_MODEL, data: [{ index: 0, embedding: fakeVector(3) }] };
        }
      };
    }
    if (/\/rest\/v1\/rpc\/list_active_books_by_categories_ai$/.test(href)) {
      state.categoryRpc += 1;
      if (extra.categoryFail) {
        return { ok: false, status: 500, async json() { return { message: "category fail" }; } };
      }
      return { ok: true, status: 200, async json() { return extra.categoryRows || []; } };
    }
    if (/\/rest\/v1\/rpc\/match_active_books_ai$/.test(href)) {
      state.rpc += 1;
      return { ok: true, status: 200, async json() { return rpcRows; } };
    }
    if (/book_embeddings/.test(href) || /\/rest\/v1\/books/.test(href)) {
      state.forbidden = true;
      return { ok: false, status: 403, async json() { return { message: "forbidden" }; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  return state;
}

async function search(query, rpcRows, extra) {
  const state = makeFetch(rpcRows, extra);
  const res = mockRes();
  const stats = await Ai.handleAiSearch(
    { method: "POST", body: { query } },
    res,
    { env: { AI_SEARCH_ENABLED: "true", OPENAI_API_KEY: "test-openai-key" }, fetchImpl: state.fetchImpl }
  );
  return {
    status: res.statusCode,
    json: JSON.parse(res.chunks.join("") || "null"),
    body: res.chunks.join(""),
    stats,
    state
  };
}

async function run() {
  await test("candidate pool is 24 and final response is at most 12 with a count field", async () => {
    assert.strictEqual(Ai.CANDIDATE_COUNT, 24);
    assert.strictEqual(Ai.MATCH_COUNT, 12);
    const rows = [];
    for (let i = 1; i <= 20; i += 1) {
      rows.push(book(i, { similarity: 0.42 - i * 0.001, title: "ھېكايە " + i, category: "رومانلار" }));
    }
    const out = await search("ياخشى ھېكايە", rows);
    assert.strictEqual(out.status, 200);
    const rpc = out.state.calls.find((call) => /rpc\/match_active_books_ai$/.test(call.url));
    assert.strictEqual(JSON.parse(rpc.body).match_count, 24);
    assert.strictEqual(out.state.categoryRpc, 0);
    assert.ok(out.json.results.length <= 12);
    assert.strictEqual(out.json.count, out.json.results.length);
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.rpc, 1);
    assert.ok(!out.state.forbidden);
    out.json.results.forEach((row) => {
      assert.deepStrictEqual(Object.keys(row).sort(), Ai.RESULT_FIELDS.slice().sort());
      assert.ok(!("score" in row));
      assert.ok(!("rerankScore" in row));
    });
  });

  await test("A: clear same-family child/parenting intent recovers both categories", async () => {
    const rows = [
      book(106, { title: "يۈزمىڭلىغان نېمە ئۈچۈن", category: "بالىلار كىتابلىرى", similarity: 0.33 }),
      book(107, { title: "قىزىقارلىق فىزىكا", category: "بالىلار كىتابلىرى", similarity: 0.32 }),
      book(201, { title: "تارىخىي رومان A", category: "تارىخىي رومانلار", similarity: 0.45 }),
      book(90, { title: "رومان", category: "رومانلار", similarity: 0.43 })
    ];
    const categoryRows = [
      book(150, { title: "ئوغلۇم ئالدىڭغا قارا", category: "پەرزەنت تەربىيەسى" }),
      book(237, { title: "ئائىلە ۋە پەرزەنتلىرىمىز", category: "پەرزەنت تەربىيەسى" })
    ];
    const intent = Ai.resolveCategoryIntent("بالىلار تەربىيەسىگە مۇناسىۋەتلىك كىتاب");
    assert.strictEqual(intent.mode, "clear");
    assert.deepStrictEqual(intent.families, ["child_parenting"]);
    const out = await search("بالىلار تەربىيەسىگە مۇناسىۋەتلىك كىتاب", rows, { categoryRows });
    const cats = [...new Set(out.json.results.map((row) => row.category))].sort();
    assert.ok(out.json.results.length >= 2);
    assert.ok(out.json.results.every((row) => row.category === "پەرزەنت تەربىيەسى" || row.category === "بالىلار كىتابلىرى"));
    assert.deepStrictEqual(cats, ["بالىلار كىتابلىرى", "پەرزەنت تەربىيەسى"]);
    assert.ok(out.json.results.some((row) => row.id === 150));
    assert.ok(out.json.results.some((row) => row.id === 237));
    assert.ok(!out.json.results.some((row) => row.id === 201 || row.id === 90));
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.rpc, 1);
    assert.strictEqual(out.state.categoryRpc, 1);
    const catCall = out.state.calls.find((call) => /list_active_books_by_categories_ai/.test(call.url));
    const catBody = JSON.parse(catCall.body);
    assert.ok(catBody.categories.includes("بالىلار كىتابلىرى"));
    assert.ok(catBody.categories.includes("پەرزەنت تەربىيەسى"));
  });

  await test("B: clear historical intent keeps novels near 0.30-0.36", async () => {
    const rows = [
      book(11, { title: "تارىخىي رومان 1", category: "تارىخىي رومانلار", similarity: 0.36 }),
      book(12, { title: "تارىخىي رومان 2", category: "تارىخىي رومانلار", similarity: 0.33 }),
      book(13, { title: "تارىخىي رومان 3", category: "تارىخىي رومانلار", similarity: 0.30 }),
      book(90, { title: "رومان", category: "رومانلار", similarity: 0.45 })
    ];
    const intent = Ai.resolveCategoryIntent("تارىخىي رومان");
    assert.strictEqual(intent.mode, "clear");
    assert.deepStrictEqual(intent.families, ["historical_novel"]);
    const out = await search("تارىخىي رومان", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.deepStrictEqual(ids.sort(), [11, 12, 13]);
    assert.ok(out.json.results.every((row) => row.category === "تارىخىي رومانلار"));
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.categoryRpc, 1);
    out.json.results.forEach((row) => {
      assert.ok(row.similarity >= 0.30 && row.similarity <= 0.36);
      assert.ok(row.similarity < 0.5);
    });
  });

  await test("clear religious intent returns only دىنىي كىتابلار when those candidates exist", async () => {
    const rows = [
      book(40, { title: "يىراق رومان", category: "رومانلار", similarity: 0.45 })
    ];
    const categoryRows = [
      book(16, { title: "دىنىي كىتاب 1", category: "دىنىي كىتابلار" }),
      book(17, { title: "دىنىي كىتاب 2", category: "دىنىي كىتابلار" })
    ];
    const out = await search("دىنىي كىتاب", rows, { categoryRows });
    const ids = out.json.results.map((row) => row.id);
    assert.deepStrictEqual(ids.sort(), [16, 17]);
    assert.ok(out.json.results.every((row) => row.category === "دىنىي كىتابلار"));
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.categoryRpc, 1);
  });

  await test("author-shaped query boosts Aitmatov and does not pad to 12", async () => {
    const rows = [
      book(122, { title: "يەر ئانا", author: "چىڭغىز ئايتماتوۋ", category: "رومانلار", similarity: 0.33 }),
      book(125, { title: "تاغلار غۇلىغاندا", author: "چىڭغىز ئايتماتوۋ (قىرغىزىستان)", category: "رومانلار", similarity: 0.32 })
    ];
    for (let i = 0; i < 14; i += 1) {
      rows.push(book(400 + i, { title: "باشقا رومان " + i, author: "باشقا ئاپتور", category: "رومانلار", similarity: 0.41 - i * 0.001 }));
    }
    const out = await search("چىڭغىز ئايتماتوۋنىڭ كىتابلىرى", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.ok(ids.length <= 2);
    assert.ok(ids.includes(122));
    assert.ok(ids.includes(125));
    assert.ok(!ids.some((id) => id >= 400));
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.categoryRpc, 0);
  });

  await test("clear grammar intent returns only گرامماتىكا when matches exist", async () => {
    const rows = [
      book(151, { title: "ئوكسىگىن قوللىنىشچان ئىنگىلىز تىلى گىرامماتىكىسى", category: "گرامماتىكا", similarity: 0.31 }),
      book(169, { title: "ئىنگىلىزتىلى گىرامماتىكىسى", category: "گرامماتىكا", similarity: 0.30 }),
      book(80, { title: "ئۇنىۋېرسال كىتاب", category: "ئۇنىۋېرسال", similarity: 0.44 }),
      book(81, { title: "رومان", category: "رومانلار", similarity: 0.43 }),
      book(82, { title: "تارىخ", category: "تارىخىي رومانلار", similarity: 0.42 })
    ];
    const out = await search("گرامماتىكا كىتابى", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.deepStrictEqual(ids.sort(), [151, 169]);
    assert.ok(out.json.results.every((row) => row.category === "گرامماتىكا"));
  });

  await test("recognized intent with zero matching candidates falls back to hybrid + weak-tail", async () => {
    const rows = [
      book(1, { title: "يىراق رومان", category: "رومانلار", similarity: 0.44 }),
      book(2, { title: "باشقا رومان", category: "رومانلار", similarity: 0.41 }),
      book(3, { title: "ئاجىز", category: "ئۇنىۋېرسال", similarity: 0.20 })
    ];
    const out = await search("دىنىي كىتاب", rows);
    assert.ok(out.json.results.length >= 1);
    assert.ok(out.json.results.length < 3);
    assert.strictEqual(out.json.results[0].id, 1);
    assert.ok(!out.json.results.some((row) => row.id === 3));
  });

  await test("F: generic semantic query still ranks by cosine without category mappings", async () => {
    const q = "كەچلىك ئاسماندىكى يۇلتۇزلار";
    const rows = [
      book(1, { title: "يۇلتۇزلار", category: "شېئىرلار", similarity: 0.44 }),
      book(2, { title: "كەچلىك ئاسمان", category: "شېئىرلار", similarity: 0.41 }),
      book(3, { title: "ئۇنىۋېرسال A", category: "ئۇنىۋېرسال", similarity: 0.40 }),
      book(4, { title: "ئۇنىۋېرسال B", category: "ئۇنىۋېرسال", similarity: 0.22 })
    ];
    const out = await search(q, rows);
    assert.strictEqual(out.json.results[0].id, 1);
    assert.ok(out.json.results[0].similarity >= out.json.results[1].similarity);
    const ids = out.json.results.map((row) => row.id);
    assert.ok(!ids.includes(4));
    assert.ok(Ai.scoreAiCandidate(rows[3], Ai.normalizeQuery(q)) < Ai.scoreAiCandidate(rows[0], Ai.normalizeQuery(q)));
    assert.strictEqual(out.state.openai, 1);
    assert.strictEqual(out.state.categoryRpc, 0);
    assert.strictEqual(Ai.resolveCategoryIntent(q).mode, "none");
  });

  await test("C: mixed child + history does not hard-gate or call category RPC", async () => {
    const q = "بالىلار ئۈچۈن تارىخىي رومان";
    const intent = Ai.resolveCategoryIntent(q);
    assert.strictEqual(intent.mode, "mixed");
    assert.ok(intent.families.indexOf("child_parenting") !== -1);
    assert.ok(intent.families.indexOf("historical_novel") !== -1);
    const categoryRows = [
      book(150, { title: "ئوغلۇم ئالدىڭغا قارا", category: "پەرزەنت تەربىيەسى" }),
      book(888, { title: "تارىخىي رومان RPC", category: "تارىخىي رومانلار" })
    ];
    const rows = [
      book(501, { title: "بالىلار ئۈچۈن تارىخىي رومان", category: "ئۇنىۋېرسال", similarity: 0.55 }),
      book(11, { title: "تارىخىي رومان 1", category: "تارىخىي رومانلار", similarity: 0.40 }),
      book(106, { title: "يۈزمىڭلىغان نېمە ئۈچۈن", category: "بالىلار كىتابلىرى", similarity: 0.39 }),
      book(90, { title: "رومان", category: "رومانلار", similarity: 0.38 }),
      book(3, { title: "ئاجىز", category: "ئۇنىۋېرسال", similarity: 0.18 })
    ];
    const out = await search(q, rows, { categoryRows });
    const ids = out.json.results.map((row) => row.id);
    assert.strictEqual(out.state.categoryRpc, 0);
    assert.strictEqual(out.state.openai, 1);
    assert.ok(ids.includes(501), "no hard gate: best semantic non-family row stays");
    assert.ok(!ids.includes(150) && !ids.includes(888), "category catalog is not unioned in");
    assert.ok(!ids.includes(3));
    assert.ok(out.json.results[0].id === 501 || out.json.results[0].similarity >= 0.38);
  });

  await test("D: mixed religious + history does not force a category union", async () => {
    const q = "دىنىي تارىخىي رومان";
    const intent = Ai.resolveCategoryIntent(q);
    assert.strictEqual(intent.mode, "mixed");
    assert.ok(intent.families.indexOf("religious") !== -1);
    assert.ok(intent.families.indexOf("historical_novel") !== -1);
    const categoryRows = [
      book(16, { title: "دىنىي كىتاب 1", category: "دىنىي كىتابلار" }),
      book(11, { title: "تارىخىي رومان RPC", category: "تارىخىي رومانلار" })
    ];
    const rows = [
      book(502, { title: "دىنىي تارىخىي رومان", category: "رومانلار", similarity: 0.54 }),
      book(17, { title: "دىنىي كىتاب 2", category: "دىنىي كىتابلار", similarity: 0.36 }),
      book(12, { title: "تارىخىي رومان 2", category: "تارىخىي رومانلار", similarity: 0.35 }),
      book(4, { title: "ئاجىز", category: "ئۇنىۋېرسال", similarity: 0.17 })
    ];
    const out = await search(q, rows, { categoryRows });
    const ids = out.json.results.map((row) => row.id);
    const cats = [...new Set(out.json.results.map((row) => row.category))];
    assert.strictEqual(out.state.categoryRpc, 0);
    assert.strictEqual(out.state.openai, 1);
    assert.ok(ids.includes(502));
    assert.ok(!ids.includes(16));
    assert.ok(cats.indexOf("رومانلار") !== -1);
    assert.ok(!ids.includes(4));
  });

  await test("E: mixed child + religious keeps semantic ranking without category RPC", async () => {
    const q = "بالىلارغا ماس دىنىي كىتاب";
    const intent = Ai.resolveCategoryIntent(q);
    assert.strictEqual(intent.mode, "mixed");
    assert.ok(intent.families.indexOf("child_parenting") !== -1);
    assert.ok(intent.families.indexOf("religious") !== -1);
    const categoryRows = [
      book(16, { title: "دىنىي كىتاب RPC", category: "دىنىي كىتابلار" }),
      book(106, { title: "بالىلار RPC", category: "بالىلار كىتابلىرى" })
    ];
    const rows = [
      book(503, { title: "بالىلارغا ماس دىنىي كىتاب", category: "ئۇنىۋېرسال", similarity: 0.53 }),
      book(17, { title: "دىنىي كىتاب 2", category: "دىنىي كىتابلار", similarity: 0.37 }),
      book(107, { title: "قىزىقارلىق فىزىكا", category: "بالىلار كىتابلىرى", similarity: 0.36 }),
      book(5, { title: "ئاجىز", category: "ئۇنىۋېرسال", similarity: 0.16 })
    ];
    const out = await search(q, rows, { categoryRows });
    const ids = out.json.results.map((row) => row.id);
    assert.strictEqual(out.state.categoryRpc, 0);
    assert.strictEqual(out.state.openai, 1);
    assert.ok(ids.includes(503));
    assert.ok(!ids.includes(16) && !ids.includes(106));
    assert.ok(!ids.includes(5));
    assert.ok(out.json.results.length <= 12);
  });

  await test("category RPC failure falls back to vector-only gating without a second OpenAI call", async () => {
    const rows = [
      book(106, { title: "يۈزمىڭلىغان نېمە ئۈچۈن", category: "بالىلار كىتابلىرى", similarity: 0.33 }),
      book(90, { title: "رومان", category: "رومانلار", similarity: 0.45 })
    ];
    const out = await search("بالىلار تەربىيەسىگە مۇناسىۋەتلىك كىتاب", rows, { categoryFail: true });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.state.openai, 1);
    assert.ok(out.json.results.every((row) => row.category === "بالىلار كىتابلىرى"));
    assert.doesNotMatch(out.body, /category fail/);
  });

  await test("category lookup SQL is invoker, capped, public-field, and not auto-applied", () => {
    const sql = fs.readFileSync(path.join(root, "STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql"), "utf8");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.list_active_books_by_categories_ai/);
    assert.match(sql, /SECURITY INVOKER/);
    assert.match(sql, /b\.category = ANY \(categories\)/);
    assert.match(sql, /b\.is_active IS TRUE/);
    assert.match(sql, /b\.submission_status = 'approved'/);
    assert.match(sql, /LIMIT LEAST\(GREATEST\(COALESCE\(match_count, 24\), 1\), 24\)/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_active_books_by_categories_ai\(text\[\], integer\) FROM PUBLIC/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_active_books_by_categories_ai\(text\[\], integer\) TO anon/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_active_books_by_categories_ai\(text\[\], integer\) TO authenticated/);
    assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*list_active_books_by_categories_ai[\s\S]*TO PUBLIC/i);
    assert.doesNotMatch(sql, /SECURITY DEFINER/);
    assert.doesNotMatch(sql, /book_embeddings/);
    assert.doesNotMatch(sql, /INSERT |UPDATE |DELETE /);
    assert.doesNotMatch(sql, /SUPABASE_SERVICE_ROLE_KEY/);
    const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
    assert.doesNotMatch(pkg, /STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP\.sql/);
  });

  await test("empty category RPC keeps vector/hybrid fallback; merged intended set still caps at 12", async () => {
    const emptyCat = await search("بالىلار تەربىيەسىگە مۇناسىۋەتلىك كىتاب", [
      book(106, { title: "يۈزمىڭلىغان نېمە ئۈچۈن", category: "بالىلار كىتابلىرى", similarity: 0.33 }),
      book(90, { title: "رومان", category: "رومانلار", similarity: 0.45 })
    ], { categoryRows: [] });
    assert.ok(emptyCat.json.results.every((row) => row.category === "بالىلار كىتابلىرى"));
    assert.ok(!emptyCat.json.results.some((row) => row.id === 90));
    assert.strictEqual(emptyCat.state.openai, 1);
    assert.strictEqual(emptyCat.state.categoryRpc, 1);

    const rows = [];
    for (let i = 1; i <= 10; i += 1) {
      rows.push(book(100 + i, { title: "بالىلار " + i, category: "بالىلار كىتابلىرى", similarity: 0.34 - i * 0.001 }));
    }
    const categoryRows = [];
    for (let i = 1; i <= 10; i += 1) {
      categoryRows.push(book(200 + i, { title: "پەرزەنت " + i, category: "پەرزەنت تەربىيەسى" }));
    }
    const out = await search("بالىلار تەربىيەسىگە مۇناسىۋەتلىك كىتاب", rows, { categoryRows });
    assert.ok(out.json.results.length <= 12);
    assert.strictEqual(out.json.count, out.json.results.length);
    assert.ok(out.json.results.every((row) => row.category === "بالىلار كىتابلىرى" || row.category === "پەرزەنت تەربىيەسى"));
    assert.strictEqual(out.state.openai, 1);
  });

  await test("kill switch, one embedding, RPC-only, and protected files stay frozen", async () => {
    const disabledState = makeFetch([book(1, { similarity: 0.9 })]);
    const res = mockRes();
    await Ai.handleAiSearch(
      { method: "POST", body: { query: "بالىلار تەربىيەسى" } },
      res,
      { env: {}, fetchImpl: disabledState.fetchImpl }
    );
    assert.strictEqual(JSON.parse(res.chunks.join("")).error, "disabled");
    assert.strictEqual(disabledState.openai, 0);
    assert.strictEqual(disabledState.rpc, 0);

    const src = fs.readFileSync(path.join(root, "kutadgu-ai-search.js"), "utf8");
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(src, /book_embeddings/);
    assert.doesNotMatch(src, /kutadgu-search-rank/);
    assert.doesNotMatch(src, /require\("\.\/kutadgu-search-rank/);
    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(shaOf(rel), FROZEN[rel], rel);
    });
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const rank = fs.readFileSync(path.join(root, "kutadgu-search-rank.js"), "utf8");
    assert.doesNotMatch(shop, /selectRelevantResults|CANDIDATE_COUNT|ai-search-1g2/);
    assert.doesNotMatch(rank, /selectRelevantResults|CANDIDATE_COUNT/);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search 1G-2 test(s) failed");
    process.exit(1);
  }
  console.log("stage-ai-search-1g2-relevance-rerank-tests ok");
});
