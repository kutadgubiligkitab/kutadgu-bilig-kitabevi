"use strict";

const assert = require("node:assert/strict");
const Advisor = require("../kutadgu-book-advisor.js");
const Budget = require("../kutadgu-book-advisor-budget.js");
const Gate = require("../cloudflare/book-advisor-private.js");
const Cases = require("./book-advisor-acceptance-cases.js");

function book(id, fields) {
  return Object.assign({
    id,
    title: "كىتاب " + id,
    author: "ئاپتور",
    category: "رومان",
    price: id,
    description: "قىسقا تېكىست",
    is_active: true,
    submission_status: "approved"
  }, fields);
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

async function main() {
  const rows = [];
  for (let id = 1; id <= 8; id += 1) {
    rows.push(book(id, {
      title: "ياشار كەمال " + id,
      author: "ياشار كەمال",
      category: "رومان",
      series_title: "سەپەر",
      series_slug: "seper",
      description: "بۇ ياشار كەمال يازغان قىسىم " + id
    }));
  }
  rows.push(book(20, {
    title: "ياشار كەمال ھەققىدە",
    author: "باشقا ئاپتور",
    description: "ياشار كەمالنىڭ ھاياتى ھەققىدە ماقالە."
  }));
  rows.push(book(21, { title: "يوشۇرۇن", is_active: false, description: "يوشۇرۇن تېكىست" }));
  rows.push(book(22, { title: "تەستىقسىز", submission_status: "pending", description: "تەستىقسىز تېكىست" }));
  const catalog = Advisor.buildCatalog(rows);
  assert.equal(catalog.byId.has(21), false);
  assert.equal(catalog.byId.has(22), false);

  const written = Advisor.searchStoreBooks(catalog, {
    author: "ياشار كەمال",
    title: "",
    category: "",
    topic: "",
    relation: "written_by",
    purpose: "list",
    offset: 0
  });
  assert.equal(written.total, 8);
  assert.equal(written.matches.length, 6);
  assert.equal(written.has_more, true);
  assert.equal(written.next_offset, 6);
  assert.equal(written.matches.every((row) => row.match === "written_by" && row.author === "ياشار كەمال"), true);
  const rest = Advisor.searchStoreBooks(catalog, {
    author: "ياشار كەمال",
    title: "",
    category: "",
    topic: "",
    relation: "written_by",
    purpose: "list",
    offset: written.next_offset
  });
  assert.equal(rest.matches.length, 2);
  assert.equal(rest.has_more, false);
  const seen = new Set(written.matches.concat(rest.matches).map((row) => row.id));
  assert.equal(seen.size, 8);
  assert.equal(seen.has(20), false);

  const about = Advisor.searchStoreBooks(catalog, {
    author: "ياشار كەمال",
    title: "",
    category: "",
    topic: "",
    relation: "about",
    purpose: "list",
    offset: 0
  });
  assert.deepEqual(about.matches.map((row) => row.id), [20]);
  assert.equal(about.matches[0].match, "about");

  const empty = Advisor.searchStoreBooks(catalog, {
    author: "",
    title: "",
    category: "",
    topic: "",
    relation: "any",
    purpose: "list",
    offset: 0
  });
  assert.equal(empty.total, 0);
  assert.equal(empty.note, "empty_query");

  let generation = 0;
  const cache = Advisor.createCatalogCache(async () => {
    generation += 1;
    return Advisor.buildCatalog([book(generation, { title: "يېڭى " + generation, description: "يېڭى تېكىست " + generation })]);
  }, Advisor.CATALOG_FRESH_MS);
  const start = new Date("2026-11-09T00:00:00Z");
  const first = await cache.current(start);
  const same = await cache.current(new Date(start.getTime() + Advisor.CATALOG_FRESH_MS - 1));
  assert.equal(same.byId.get(1).description, first.byId.get(1).description);
  const next = await cache.current(new Date(start.getTime() + Advisor.CATALOG_FRESH_MS));
  assert.equal(next.byId.has(1), false);
  assert.equal(next.byId.get(2).description, "يېڭى تېكىست 2");
  assert.equal(generation, 2);

  let calls = 0;
  const listed = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1000000),
    turns: [{ role: "user", content: "ياشار كەمالنىڭ بارلىق كىتابلىرىنى كۆرسىتىڭ" }],
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      if (calls === 1) {
        const system = body.input[0].content;
        let outside = 0;
        for (const item of Cases.CASES) {
          if (!system.includes(item.customer)) outside += 1;
        }
        assert.ok(outside >= 10);
        assert.equal(JSON.stringify(body.input).includes("ياشار كەمال 1"), false);
        return jsonResponse({
          output: [{
            type: "function_call",
            name: "search_store_books",
            call_id: "call-list",
            arguments: JSON.stringify({
              author: "ياشار كەمال",
              title: "",
              category: "",
              topic: "",
              relation: "written_by",
              purpose: "list",
              offset: 0
            })
          }],
          usage: { input_tokens: 40, output_tokens: 20 }
        });
      }
      const packed = JSON.stringify(body.input);
      assert.equal(packed.includes("total"), true);
      assert.equal(packed.includes("has_more"), true);
      assert.equal(packed.includes("ياشار كەمال 1"), true);
      assert.equal(packed.includes("ياشار كەمال ھەققىدە"), false);
      return jsonResponse({
        output_text: JSON.stringify({ mode: "list", message: "ياشار كەمالنىڭ سەككىز كىتابى بار. بۇ بىرىنچى بەت.", book_ids: [20, 999] }),
        usage: { input_tokens: 50, output_tokens: 20 }
      });
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(listed.books.map((row) => row.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(listed.books[0].price, 1);
  assert.equal(listed.books[0].href, "/book/1");
  assert.equal(listed.list_total, 8);
  assert.equal(listed.list_has_more, true);
  assert.match(listed.message, /سەككىز/);

  assert.equal(Cases.CASES.length, 30);
  const heldOut = Cases.CASES.filter((item) => item.heldOut);
  assert.ok(heldOut.length >= 10);

  const pageSize = Advisor.CATALOG_PAGE_SIZE;
  const ranges = [];
  const paged = await Advisor.loadReadOnlyCatalog(async (url, init) => {
    if (String(url).includes("list_public_book_categories")) {
      return { ok: true, json: async () => ({ direct: [{ label: "رومان", is_hidden: false }, { label: "يوشۇرۇن", is_hidden: true }] }) };
    }
    if (String(url).includes("list_public_book_series_routes")) {
      return { ok: true, json: async () => [] };
    }
    if (String(url).includes("list_public_book_volume_catalog")) {
      return { ok: true, json: async () => ({ has_more: false, items: [] }) };
    }
    const range = init.headers.Range;
    ranges.push(range);
    const from = Number(String(range).split("-")[0]);
    const rows = [];
    if (from === 0) {
      for (let id = 1; id <= pageSize; id += 1) {
        rows.push({ id, title: "بەت " + id, author: "نەشر", category: "رومان", price: 10, description: "ئەسلى", is_active: true, submission_status: "approved" });
      }
    } else {
      rows.push({ id: pageSize + 1, title: "يېڭى كىتاب", author: "نەشر", category: "رومان", price: 12, description: "تەھرىرلەنگەن چۈشەندۈرۈش", is_active: true, submission_status: "approved" });
      rows.push({ id: pageSize + 2, title: "يوشۇرۇن كىتاب", author: "نەشر", category: "يوشۇرۇن", price: 9, description: "يوشۇرۇن", is_active: true, submission_status: "approved" });
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => (from === 0 ? "0-" + (pageSize - 1) + "/" + (pageSize + 2) : "") },
      json: async () => rows
    };
  }, "https://fxlojnqwyojqjskfggmh.supabase.co", "sb_publishable_catalog");
  assert.deepEqual(ranges, ["0-" + (pageSize - 1), pageSize + "-" + (pageSize * 2 - 1)]);
  assert.equal(paged.count, pageSize + 1);
  assert.equal(paged.byId.get(pageSize + 1).description, "تەھرىرلەنگەن چۈشەندۈرۈش");
  assert.equal(paged.byId.has(pageSize + 2), false);
  assert.equal(paged.byId.has(1), true);

  const narrowRanges = [];
  const narrow = await Advisor.loadReadOnlyCatalog(async (url, init) => {
    if (String(url).includes("list_public_book_categories")) {
      return { ok: true, json: async () => ({ direct: [{ label: "رومان", is_hidden: false }] }) };
    }
    if (String(url).includes("list_public_book_series_routes")) return { ok: true, json: async () => [] };
    if (String(url).includes("list_public_book_volume_catalog")) return { ok: true, json: async () => ({ has_more: false, items: [] }) };
    const range = init.headers.Range;
    narrowRanges.push(range);
    const from = Number(String(range).split("-")[0]);
    const rows = [];
    const last = Math.min(from + 1, 4);
    for (let id = from + 1; id <= last + 1; id += 1) {
      rows.push({ id, title: "قىسقا بەت " + id, author: "نەشر", category: "رومان", price: 3, description: id === 5 ? "تەھرىرلەنگەن" : "ئەسلى", is_active: true, submission_status: "approved" });
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => from + "-" + (from + rows.length - 1) + "/5" },
      json: async () => rows
    };
  }, "https://fxlojnqwyojqjskfggmh.supabase.co", "sb_publishable_catalog");
  assert.deepEqual(narrowRanges.map((range) => Number(String(range).split("-")[0])), [0, 2, 4]);
  assert.equal(narrow.count, 5);
  assert.equal(narrow.byId.get(5).description, "تەھرىرلەنگەن");

  await assert.rejects(() => Advisor.loadReadOnlyCatalog(async (url, init) => {
    if (!String(url).includes("/rest/v1/books")) return { ok: true, json: async () => [] };
    const from = Number(String(init.headers.Range).split("-")[0]);
    return {
      ok: true,
      status: 200,
      headers: { get: () => from + "-" + from + "/100000" },
      json: async () => [{ id: from + 1, title: "ئېشىپ قالغان", author: "نەشر", category: "رومان", price: 1, is_active: true, submission_status: "approved" }]
    };
  }, "https://fxlojnqwyojqjskfggmh.supabase.co", "sb_publishable_catalog"), (error) => error.code === "advisor_catalog_incomplete");

  const meaningCatalog = Advisor.buildCatalog([
    { id: 5, title: "يۇلتۇز", author: "نەشر", category: "رومان", price: 10, description: "يىراق", is_active: true, submission_status: "approved" },
    { id: 7, title: "ھايۋانلار", author: "نەشر", category: "رومان", price: 11, description: "ھايۋان", is_active: true, submission_status: "approved" }
  ]);
  const secret = "sb_secret_fixture_value";
  let meaningFetches = 0;
  const meaning = await Advisor.matchMeaning({
    secretKey: secret,
    topic: "بالىلارغا ھايۋان ھېكايىسى",
    supabaseUrl: "https://fxlojnqwyojqjskfggmh.supabase.co",
    budget: Advisor.createBudget(1000),
    embed: async () => ({ vector: Array(1536).fill(0.01), tokens: 4 }),
    fetchImpl: async (url, init) => {
      meaningFetches += 1;
      assert.equal(String(url).endsWith("/rest/v1/rpc/match_active_books_ai"), true);
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.headers.apikey, secret);
      assert.equal(JSON.parse(init.body).query_embedding.length, 1536);
      return { ok: true, json: async () => [{ id: 5, similarity: 0.91 }, { id: 6, similarity: 0.2 }, { id: 99, similarity: 0.99 }] };
    }
  });
  const semantic = Advisor.searchStoreBooks(meaningCatalog, {
    author: "", title: "", category: "", topic: "ھايۋان", relation: "any", purpose: "recommend", offset: 0
  }, meaning);
  assert.equal(meaningFetches, 1);
  assert.equal(semantic.retrieval, "semantic");
  assert.deepEqual(semantic.matches.map((row) => row.id), [5]);
  assert.equal(JSON.stringify(semantic).includes(secret), false);
  const unavailable = Advisor.searchStoreBooks(meaningCatalog, {
    author: "", title: "", category: "", topic: "ھايۋان", relation: "any", purpose: "recommend", offset: 0
  }, null);
  assert.equal(unavailable.retrieval, "unavailable");
  assert.equal(unavailable.matches.length, 0);
  let blockedFetches = 0;
  const blocked = await Advisor.matchMeaning({
    secretKey: "sb_publishable_catalog",
    topic: "ھايۋان",
    embed: async () => { blockedFetches += 1; return { vector: [], tokens: 1 }; },
    fetchImpl: async () => { blockedFetches += 1; return { ok: true, json: async () => [] }; }
  });
  assert.equal(blockedFetches, 0);
  assert.equal(blocked.retrieval, "unavailable");

  const child = Cases.CASES.find((item) => item.id === "child");
  const age = Cases.CASES.find((item) => item.id === "age-change");
  const page = Cases.CASES.find((item) => item.id === "author-page");
  const authorAll = Cases.CASES.find((item) => item.id === "author-all");
  assert.equal(child.thread, age.thread);
  assert.equal(authorAll.thread, page.thread);
  assert.notEqual(child.thread, page.thread);
  const continued = Cases.conversationTurns(Cases.conversationTurns([], child.customer).concat([
    { role: "assistant", content: "تۆت ياشلىق بالىغا ھايۋان ھېكايىسىنى كۆرۈپ باقايلى." }
  ]), age.customer);
  assert.equal(continued[0].content, child.customer);
  assert.equal(continued[1].role, "assistant");
  assert.equal(continued[2].content, age.customer);

  const gateLedger = Budget.createLedger({ dailyLimitMicroUsd: 300000, monthlyLimitMicroUsd: 300000, perMinute: 6 });
  const gateSecret = "sb_secret_gate_fixture";
  const gateResponse = await Gate.handleBookAdvisor(new Request("https://www.kutadgubilik.com/api/book-advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.40" },
    body: JSON.stringify({ turns: [{ role: "user", content: "ھايۋان ھېكايىسى" }] })
  }), {
    BOOK_ADVISOR_ENABLED: "true",
    BOOK_ADVISOR_CLIENT_HASH_SECRET: "ab".repeat(32),
    OPENAI_API_KEY: "test-key",
    SUPABASE_SECRET_KEY: gateSecret
  }, {
    ledger: gateLedger,
    sessions: Budget.createSessionStore(),
    loadCatalog: async () => meaningCatalog,
    fetchImpl: async (url, init) => {
      if (String(url).includes("/embeddings")) {
        return { ok: true, json: async () => ({ data: [{ embedding: Array(1536).fill(0.2) }], usage: { prompt_tokens: 3 } }) };
      }
      if (String(url).includes("match_active_books_ai")) {
        assert.equal(init.headers.apikey, gateSecret);
        assert.equal(init.headers.Authorization, undefined);
        return { ok: true, json: async () => [{ id: 5, similarity: 0.8 }] };
      }
      const body = JSON.parse(init.body);
      const called = JSON.stringify(body.input || []).includes("function_call");
      if (!called) {
        return jsonResponse({
          output: [{
            type: "function_call",
            name: "search_store_books",
            call_id: "call-meaning",
            arguments: JSON.stringify({ author: "", title: "", category: "", topic: "ھايۋان", relation: "any", purpose: "recommend", offset: 0 })
          }],
          usage: { input_tokens: 30, output_tokens: 12 }
        });
      }
      assert.equal(JSON.stringify(body.input).includes(gateSecret), false);
      assert.equal(JSON.stringify(body.input).includes("يۇلتۇز"), true);
      return jsonResponse({
        output_text: JSON.stringify({ mode: "explain", message: "بۇ كىتابنى كۆرۈپ باقساق بولىدۇ.", book_ids: [] }),
        usage: { input_tokens: 40, output_tokens: 10 }
      });
    }
  });
  const gateBody = await gateResponse.json();
  assert.equal(gateBody.ok, true);
  assert.equal(JSON.stringify(gateBody).includes(gateSecret), false);
  console.log("book-advisor-catalog-tools ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
