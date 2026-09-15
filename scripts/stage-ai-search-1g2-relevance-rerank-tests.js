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

function makeFetch(rpcRows) {
  const state = { calls: [], openai: 0, rpc: 0 };
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

async function search(query, rpcRows) {
  const state = makeFetch(rpcRows);
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

  await test("A: parenting/children query keeps strong set and drops History/World Lit filler", async () => {
    const rows = [
      book(150, { title: "ئوغلۇم ئالدىڭغا قارا", category: "پەرزەنت تەربىيەسى", similarity: 0.36 }),
      book(237, { title: "ئائىلە ۋە پەرزەنتلىرىمىز", category: "پەرزەنت تەربىيەسى", similarity: 0.34 }),
      book(106, { title: "يۈزمىڭلىغان نېمە ئۈچۈن", category: "بالىلار كىتابلىرى", similarity: 0.33 }),
      book(107, { title: "قىزىقارلىق فىزىكا", category: "بالىلار كىتابلىرى", similarity: 0.32 }),
      book(201, { title: "تارىخىي رومان A", category: "تارىخىي رومانلار", similarity: 0.31 }),
      book(202, { title: "تارىخىي رومان B", category: "تارىخىي رومانلار", similarity: 0.30 }),
      book(301, { title: "دۇنيا ئەدەبىياتى A", category: "دۇنيا ئەدەبىياتى", similarity: 0.29 }),
      book(302, { title: "دۇنيا ئەدەبىياتى B", category: "دۇنيا ئەدەبىياتى", similarity: 0.28 }),
      book(303, { title: "دۇنيا ئەدەبىياتى C", category: "دۇنيا ئەدەبىياتى", similarity: 0.27 }),
      book(203, { title: "تارىخىي رومان C", category: "تارىخىي رومانلار", similarity: 0.26 }),
      book(204, { title: "تارىخىي رومان D", category: "تارىخىي رومانلار", similarity: 0.25 }),
      book(205, { title: "تارىخىي رومان E", category: "تارىخىي رومانلار", similarity: 0.24 })
    ];
    const out = await search("بالىلار تەربىيەسىگە مۇناسىۋەتلىك كىتاب", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.ok(ids.length < 12);
    assert.ok(ids.length >= 2);
    assert.ok(ids.includes(150) && ids.includes(237));
    assert.ok(ids.includes(106) || ids.includes(107));
    assert.ok(ids.indexOf(150) < ids.indexOf(201) || !ids.includes(201));
    assert.ok(!ids.includes(201));
    assert.ok(!ids.includes(301));
    assert.strictEqual(out.json.count, ids.length);
    assert.strictEqual(out.state.openai, 1);
  });

  await test("B: historical novels near 0.30-0.36 are not dropped by an absolute 0.5 floor", async () => {
    const rows = [
      book(11, { title: "تارىخىي رومان 1", category: "تارىخىي رومانلار", similarity: 0.36 }),
      book(12, { title: "تارىخىي رومان 2", category: "تارىخىي رومانلار", similarity: 0.33 }),
      book(13, { title: "تارىخىي رومان 3", category: "تارىخىي رومانلار", similarity: 0.30 })
    ];
    const out = await search("تارىخىي رومان", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.deepStrictEqual(ids.sort(), [11, 12, 13]);
    out.json.results.forEach((row) => {
      assert.ok(row.similarity >= 0.30 && row.similarity <= 0.36);
      assert.ok(row.similarity < 0.5);
    });
  });

  await test("C: religious category matches outrank semantically nearer unrelated books", async () => {
    const rows = [
      book(40, { title: "يىراق رومان", category: "رومانلار", similarity: 0.40 }),
      book(16, { title: "دىنىي كىتاب 1", category: "دىنىي كىتابلار", similarity: 0.31 }),
      book(17, { title: "دىنىي كىتاب 2", category: "دىنىي كىتابلار", similarity: 0.30 })
    ];
    const out = await search("دىنىي كىتاب", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.ok(ids.indexOf(16) < ids.indexOf(40) || !ids.includes(40));
    assert.strictEqual(ids[0], 16);
    assert.ok(ids.includes(17));
  });

  await test("D: author-shaped query boosts Aitmatov and does not pad to 12", async () => {
    const rows = [
      book(122, { title: "يەر ئانا", author: "چىڭغىز ئايتماتوۋ", category: "رومانلار", similarity: 0.33 }),
      book(125, { title: "تاغلار غۇلىغاندا", author: "چىڭغىز ئايتماتوۋ (قىرغىزىستان)", category: "رومانلار", similarity: 0.32 })
    ];
    for (let i = 0; i < 14; i += 1) {
      rows.push(book(400 + i, { title: "باشقا رومان " + i, author: "باشقا ئاپتور", category: "رومانلار", similarity: 0.28 - i * 0.002 }));
    }
    const out = await search("چىڭغىز ئايتماتوۋنىڭ كىتابلىرى", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.ok(ids.length < 12);
    assert.ok(ids.includes(122));
    assert.strictEqual(ids[0], 122);
    assert.ok(!ids.some((id) => id >= 400));
    assert.strictEqual(out.state.openai, 1);
  });

  await test("E: grammar spelling/category variants rank above unrelated tail", async () => {
    const rows = [
      book(151, { title: "ئوكسىگىن قوللىنىشچان ئىنگىلىز تىلى گىرامماتىكىسى", category: "گرامماتىكا", similarity: 0.31 }),
      book(169, { title: "ئىنگىلىزتىلى گىرامماتىكىسى", category: "گرامماتىكا", similarity: 0.30 }),
      book(80, { title: "ئۇنىۋېرسال كىتاب", category: "ئۇنىۋېرسال", similarity: 0.29 }),
      book(81, { title: "رومان", category: "رومانلار", similarity: 0.28 }),
      book(82, { title: "تارىخ", category: "تارىخىي رومانلار", similarity: 0.27 })
    ];
    const out = await search("گرامماتىكا كىتابى", rows);
    const ids = out.json.results.map((row) => row.id);
    assert.ok(ids[0] === 151 || ids[0] === 169);
    assert.ok(ids.includes(151) && ids.includes(169));
    assert.ok(!ids.includes(80));
    assert.ok(ids.length < 5);
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
