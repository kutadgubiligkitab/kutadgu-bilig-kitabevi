"use strict";

const assert = require("node:assert/strict");
const Advisor = require("../kutadgu-book-advisor.js");
const Budget = require("../kutadgu-book-advisor-budget.js");
const Cases = require("./book-advisor-cases.js");
const Gate = require("../cloudflare/book-advisor-private.js");

const SECRET = "ab".repeat(32);
const TOKEN = "cd".repeat(32);
const NOW = new Date("2026-11-08T00:00:00.000Z");

const priorBooks = [
  { id: 701, title: "باي دادام نامرات دادام", author: "روبرت كىيوسكى", category: "ئىقتىساد", price: 294, is_active: true, submission_status: "approved" },
  { id: 700, title: "باي دادام مالىيە ئەركىنلىك يولى", author: "روبرت كىيوسكى", category: "ئىقتىساد", price: 289.75, is_active: true, submission_status: "approved" },
  { id: 702, title: "باي ئاكامنىڭ خۇرجۇنىدىكى 68 گۆھەر", author: "روبرت كىيوسكى", category: "ئىقتىساد", price: 337.8, is_active: true, submission_status: "approved" },
  { id: 703, title: "پۇل تېپىشنىڭ ئېپى", author: "روبرت كىيوسكى", category: "ئىقتىساد", price: 253.3, is_active: true, submission_status: "approved" },
  { id: 718, title: "مېليونېرلارچە تەپەككۇر قىلىڭ", author: "ت. ھارۋ ئېكەر", category: "ئۇنىۋېرسال", price: 208.7, is_active: true, submission_status: "approved" },
  { id: 156, title: "ئويغانغان زېمىن 1", author: "ئابدۇرېھىم ئۆتكۈر", category: "رومان", price: 40, is_active: true, submission_status: "approved" },
  { id: 157, title: "ئويغانغان زېمىن 2", author: "ئابدۇرېھىم ئۆتكۈر", category: "رومان", price: 35, is_active: true, submission_status: "approved" },
  { id: 158, title: "باھاسىز كىتاب", author: "يوق", category: "رومان", price: null, is_active: true, submission_status: "approved" },
  { id: 159, title: "يەنە باھاسىز كىتاب", author: "يوق", category: "رومان", price: null, is_active: true, submission_status: "approved" }
];

function request(body, ip) {
  return new Request("https://www.kutadgubilik.com/api/book-advisor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kutadgu-Book-Advisor-Test": TOKEN,
      "cf-connecting-ip": ip || "203.0.113.8",
      "user-agent": "advisor-test"
    },
    body: JSON.stringify(body)
  });
}

function env() {
  return {
    BOOK_ADVISOR_ENABLED: "true",
    BOOK_ADVISOR_PRIVATE_TEST_TOKEN: TOKEN,
    BOOK_ADVISOR_CLIENT_HASH_SECRET: SECRET,
    OPENAI_API_KEY: "test-key"
  };
}

async function run() {
  const cheaper = Cases.FOLLOW_UPS.find((item) => item.id === "follow-cheaper");
  assert.equal(cheaper.q, "شۇلارنىڭ ئىچىدە ئەرزىنىراقى قايسى؟");
  assert.equal(Cases.CASES.length, 50);
  const catalog = Advisor.buildCatalog(Advisor.attachPublicSeries(priorBooks, [
    {
      kind: "group",
      group_id: 1,
      title: "ئويغانغان زېمىن",
      member_book_ids: [156, 157]
    }
  ], [
    { group_id: 1, legacy_slug: "series-156", public_slug: "oyghanghan-zemin" }
  ]));
  const collapsed = Advisor.presentSelection([156, 157], catalog);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].kind, "series");
  assert.equal(collapsed[0].href, "/series/oyghanghan-zemin");
  assert.equal(collapsed[0].price, 35);
  const single = Advisor.presentSelection([156], catalog);
  assert.equal(single[0].kind, "book");
  assert.equal(single[0].href, "/book/156");
  const legacy = Advisor.buildCatalog(Advisor.attachPublicSeries(priorBooks, [
    { kind: "group", group_id: 9, title: "كونا", member_book_ids: [156, 157] }
  ], [
    { group_id: 9, legacy_slug: "series-156", public_slug: "series-156" }
  ]));
  assert.equal(legacy.byId.get(156).series_slug, "");

  let paid = 0;
  const price = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1),
    trustedBookIds: [701, 700, 702, 703, 718],
    turns: [
      { role: "user", content: cheaper.prior },
      { role: "assistant", content: "701 ئەرزان." },
      { role: "user", content: cheaper.q }
    ],
    fetchImpl: async () => {
      paid += 1;
      throw new Error("paid");
    }
  });
  assert.equal(paid, 0);
  assert.equal(price.verified, true);
  assert.equal(price.evidence, "catalog_price");
  assert.equal(price.books.length, 1);
  assert.equal(price.books[0].id, 718);
  assert.equal(price.books[0].price, 208.7);
  assert.equal(price.books[0].href, "/book/718");
  assert.match(price.message, /مېليونېرلارچە تەپەككۇر قىلىڭ/);
  assert.match(price.message, /208\.7/);

  const tieCatalog = Advisor.buildCatalog([
    { id: 1, title: "تەڭ بىر", price: 10, is_active: true, submission_status: "approved" },
    { id: 2, title: "تەڭ ئىككى", price: 10, is_active: true, submission_status: "approved" },
    { id: 3, title: "قىممەت", price: 12, is_active: true, submission_status: "approved" }
  ]);
  const tie = await Advisor.advise({
    catalog: tieCatalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1),
    trustedBookIds: [1, 2, 3],
    turns: [{ role: "user", content: "بۇلارنىڭ ئەرزىنى قايسى؟" }],
    fetchImpl: async () => { throw new Error("paid"); }
  });
  assert.equal(tie.comparison_status, "tie");
  assert.deepEqual(tie.books.map((book) => book.id), [1, 2]);

  const missing = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1),
    trustedBookIds: [158, 159],
    turns: [{ role: "user", content: "شۇلارنىڭ ئەرزىنى قايسى؟" }],
    fetchImpl: async () => { throw new Error("paid"); }
  });
  assert.equal(missing.comparison_status, "unavailable");
  assert.match(missing.message, /تەخمىن قىلىنمىدى/);
  assert.equal(missing.books.length, 2);

  let difficultyCalls = 0;
  const difficulty = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1000000),
    trustedBookIds: [701, 700],
    turns: [{ role: "user", content: "قايسىسى ئاسانراق ئوقۇلىدۇ؟" }],
    fetchImpl: async (_url, init) => {
      difficultyCalls += 1;
      const body = JSON.parse(init.body);
      assert.match(body.input[0].content, /impression/);
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({ message: "بۇ پەقەت تەسىرات. باي دادام نامرات دادام قىسقىراق كۆرۈنىدۇ." }),
          usage: { input_tokens: 20, output_tokens: 12 }
        })
      };
    }
  });
  assert.equal(difficultyCalls, 1);
  assert.equal(difficulty.verified, false);
  assert.equal(difficulty.evidence, "inference");
  assert.deepEqual(difficulty.requested_ids, [701, 700]);

  const ledger = Budget.createLedger({
    dailyLimitMicroUsd: 500,
    monthlyLimitMicroUsd: 800,
    perMinute: 20
  });
  const hash = Budget.clientHash(SECRET, "203.0.113.8", "advisor-test");
  const parallel = await Promise.all(Array.from({ length: 8 }, () => ledger.reserve({
    clientHash: hash,
    microUsd: 100,
    now: NOW
  }).then((row) => row.id).catch((error) => error.code)));
  const reservedIds = parallel.filter((item) => item !== "advisor_budget");
  assert.equal(reservedIds.length, 5);
  assert.equal(parallel.filter((item) => item === "advisor_budget").length, 3);
  await ledger.settle(reservedIds[0], 40);
  await assert.rejects(() => ledger.settle(reservedIds[0], 40), (error) => error.code === "advisor_budget_unavailable");
  const afterReplay = await ledger.snapshot();
  assert.equal(afterReplay.spentDay[0][1], 40);
  await ledger.release(reservedIds[1]);
  const reused = await ledger.reserve({ clientHash: hash, microUsd: 100, now: NOW });
  assert.equal(typeof reused.id, "string");

  const monthLedger = Budget.createLedger({
    dailyLimitMicroUsd: 10000,
    monthlyLimitMicroUsd: 250,
    perMinute: 20
  });
  const monthResult = await Promise.all(Array.from({ length: 4 }, () => monthLedger.reserve({
    clientHash: hash,
    microUsd: 100,
    now: NOW
  }).then(() => "ok").catch((error) => error.code)));
  assert.equal(monthResult.filter((item) => item === "ok").length, 2);
  assert.equal(monthResult.filter((item) => item === "advisor_budget").length, 2);

  const directory = await Advisor.readPublicSeriesDirectory(async (url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers.apikey, "sb_publishable_test");
    if (url.endsWith("/list_public_book_series_routes")) {
      return { ok: true, json: async () => [{ group_id: 1, legacy_slug: "series-156", public_slug: "oyghanghan-zemin" }] };
    }
    const body = JSON.parse(init.body);
    if (body.p_offset === 0) {
      return {
        ok: true,
        json: async () => ({
          has_more: true,
          items: [{ kind: "group", group_id: 1, title: "ئويغانغان زېمىن", member_book_ids: [156, 157] }]
        })
      };
    }
    return { ok: true, json: async () => ({ has_more: false, items: [] }) };
  }, "https://fxlojnqwyojqjskfggmh.supabase.co", "sb_publishable_test");
  const fromDirectory = Advisor.buildCatalog(Advisor.attachPublicSeries(priorBooks, directory.items, directory.routes));
  assert.equal(Advisor.presentSelection([156, 157], fromDirectory)[0].href, "/series/oyghanghan-zemin");

  const limited = Budget.createLedger({
    dailyLimitMicroUsd: 100000,
    monthlyLimitMicroUsd: 100000,
    perMinute: 6
  });
  for (let i = 0; i < 6; i += 1) {
    await limited.reserve({ clientHash: hash, microUsd: 1, now: NOW });
  }
  await assert.rejects(
    () => limited.reserve({ clientHash: hash, microUsd: 1, now: NOW }),
    (error) => error.code === "advisor_rate_limit"
  );
  assert.throws(
    () => Budget.createLedger({ dailyLimitMicroUsd: 0, monthlyLimitMicroUsd: 1, perMinute: 1 }),
    (error) => error.code === "advisor_budget_unavailable"
  );
  const broken = Budget.createLedger({
    dailyLimitMicroUsd: 100,
    monthlyLimitMicroUsd: 100,
    perMinute: 5,
    failStore: true
  });
  await assert.rejects(
    () => broken.reserve({ clientHash: hash, microUsd: 10, now: NOW }),
    (error) => error.code === "advisor_budget_unavailable"
  );

  const gateLedger = Budget.createLedger({
    dailyLimitMicroUsd: Advisor.worstCaseMicroUsd(catalog),
    monthlyLimitMicroUsd: Advisor.worstCaseMicroUsd(catalog),
    perMinute: 4
  });
  const sessions = Budget.createSessionStore();
  let gateCalls = 0;
  const first = await Gate.handleBookAdvisor(request({
    remaining_micro_usd: 999999999,
    books: [{ id: 701, price: 1 }],
    trustedBookIds: [701],
    turns: [{ role: "user", content: "پۇل تېجەش ھەققىدە كىتاب" }]
  }), env(), {
    ledger: gateLedger,
    sessions,
    now: () => NOW,
    loadCatalog: async () => catalog,
    fetchImpl: async () => {
      gateCalls += 1;
      if (gateCalls === 1) {
        return {
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({ book_ids: [701, 700, 999999] }),
            usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({ message: "باي دادام نامرات دادام ۋە باي دادام مالىيە ئەركىنلىك يولى ماس كېلىدۇ." }),
          usage: { input_tokens: 20, output_tokens: 10 }
        })
      };
    }
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.verified, false);
  assert.deepEqual(firstBody.books.map((book) => book.id), [701, 700]);
  assert.equal(Object.prototype.hasOwnProperty.call(firstBody, "usage"), false);
  assert.equal(JSON.stringify(firstBody).includes(SECRET), false);
  assert.equal(JSON.stringify(firstBody).includes("dailyLimit"), false);
  const seeded = await sessions.create(hash, [701, 700, 702, 703, 718]);
  const follow = await Gate.handleBookAdvisor(request({
    session_id: seeded,
    remaining_micro_usd: 999999999,
    trustedBookIds: [701],
    turns: [{ role: "user", content: cheaper.q }]
  }), env(), {
    ledger: gateLedger,
    sessions,
    now: () => NOW,
    loadCatalog: async () => catalog,
    fetchImpl: async () => {
      gateCalls += 1;
      throw new Error("paid");
    }
  });
  const followBody = await follow.json();
  assert.equal(follow.status, 200);
  assert.equal(gateCalls, 2);
  assert.equal(followBody.books.length, 1);
  assert.equal(followBody.books[0].id, 718);
  assert.equal(followBody.verified, true);
  const other = await Gate.handleBookAdvisor(request({
    session_id: seeded,
    turns: [{ role: "user", content: cheaper.q }]
  }, "198.51.100.4"), env(), {
    ledger: gateLedger,
    sessions,
    now: () => new Date("2026-11-08T00:02:00.000Z"),
    loadCatalog: async () => catalog,
    fetchImpl: async () => { throw new Error("paid"); }
  });
  const otherBody = await other.json();
  assert.equal(otherBody.comparison_status, "no_prior");
  assert.equal(otherBody.books.length, 0);
  const closed = await Gate.handleBookAdvisor(request({
    turns: [{ role: "user", content: "پۇل" }]
  }), { BOOK_ADVISOR_ENABLED: "false" }, {
    ledger: gateLedger,
    sessions,
    loadCatalog: async () => catalog
  });
  assert.equal(closed.status, 503);

  let blockedFetch = 0;
  const missingKey = await Gate.handleBookAdvisor(request({
    turns: [{ role: "user", content: "پۇل تېجەش ھەققىدە كىتاب" }]
  }), {
    BOOK_ADVISOR_ENABLED: "true",
    BOOK_ADVISOR_PRIVATE_TEST_TOKEN: TOKEN,
    BOOK_ADVISOR_CLIENT_HASH_SECRET: SECRET
  }, {
    ledger: gateLedger,
    sessions,
    loadCatalog: async () => catalog,
    fetchImpl: async () => { blockedFetch += 1; }
  });
  assert.equal(missingKey.status, 503);
  assert.equal(blockedFetch, 0);

  const failingLedger = {
    async reserve() {
      const error = new Error("advisor_budget_unavailable");
      error.code = "advisor_budget_unavailable";
      throw error;
    },
    async settle() { throw new Error("settle"); },
    async release() { throw new Error("release"); }
  };
  const databaseDown = await Gate.handleBookAdvisor(request({
    remaining_micro_usd: 50,
    turns: [{ role: "user", content: "پۇل تېجەش ھەققىدە كىتاب" }]
  }), env(), {
    ledger: failingLedger,
    sessions,
    loadCatalog: async () => catalog,
    fetchImpl: async () => { blockedFetch += 1; }
  });
  const databaseBody = await databaseDown.json();
  assert.equal(databaseBody.error, "advisor_budget_unavailable");
  assert.equal(blockedFetch, 0);

  const loaded = await Advisor.loadReadOnlyCatalog(async (url, init) => {
    assert.equal(init && init.headers && init.headers.Authorization, undefined);
    assert.equal(init.headers.apikey, "sb_publishable_catalog");
    if (String(url).includes("/rest/v1/books")) {
      return { ok: true, json: async () => priorBooks.concat([{ id: 50, title: "يوشۇرۇن", category: "يوشۇرۇن", price: 1, is_active: true, submission_status: "approved" }]) };
    }
    if (String(url).includes("list_public_book_categories")) {
      return { ok: true, json: async () => ({ direct: [{ label: "ئىقتىساد", is_hidden: false }, { label: "رومان", is_hidden: false }] }) };
    }
    if (String(url).includes("list_public_book_series_routes")) {
      return { ok: true, json: async () => [{ group_id: 1, public_slug: "oyghanghan-zemin" }] };
    }
    return { ok: true, json: async () => ({ has_more: false, items: [{ kind: "group", group_id: 1, title: "ئويغانغان زېمىن", member_book_ids: [156, 157] }] }) };
  }, "https://fxlojnqwyojqjskfggmh.supabase.co", "sb_publishable_catalog");
  assert.equal(loaded.byId.has(50), false);
  assert.equal(loaded.byId.get(156).series_slug, "oyghanghan-zemin");
  assert.equal(Advisor.presentSelection([156, 157], loaded)[0].kind, "series");

  const calls = [];
  const rpc = Budget.createRpcStores({
    supabaseUrl: "https://fxlojnqwyojqjskfggmh.supabase.co",
    apiKey: "sb_secret_server_only",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), authorization: init.headers.Authorization });
      if (String(url).endsWith("/reserve_book_advisor_spend")) {
        assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(init.body), "remaining_micro_usd"), false);
        return { ok: false, status: 400, json: async () => ({ message: "advisor_budget", code: "P0001" }) };
      }
      return { ok: false, status: 503, json: async () => ({ message: "database unavailable" }) };
    }
  });
  await assert.rejects(() => rpc.ledger.reserve({ clientHash: hash, microUsd: 10 }), (error) => error.code === "advisor_budget");
  assert.equal(calls[0].authorization, undefined);
  await assert.rejects(() => rpc.ledger.settle("00000000-0000-0000-0000-000000000000", 1), (error) => error.code === "advisor_budget_unavailable");

  const Dispatch = require("../cloudflare/preview-dispatch.js");
  let dispatchFetch = 0;
  const disabledRoute = await Dispatch.dispatch(new Request("https://www.kutadgubilik.com/api/book-advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kutadgu-Book-Advisor-Test": TOKEN },
    body: JSON.stringify({ remaining_micro_usd: 999, turns: [{ role: "user", content: "پۇل" }] })
  }), {
    KUTADGU_HOST_MODE: "production",
    BOOK_ADVISOR_ENABLED: "false",
    AI_SEARCH_ENABLED: "false"
  }, {
    fetchImpl: async () => { dispatchFetch += 1; }
  });
  assert.equal(disabledRoute.status, 503);
  assert.equal(dispatchFetch, 0);
  const method = await Dispatch.dispatch(new Request("https://www.kutadgubilik.com/api/book-advisor"), {
    KUTADGU_HOST_MODE: "production",
    BOOK_ADVISOR_ENABLED: "false"
  });
  assert.equal(method.status, 405);
  console.log("book-advisor-security-tests ok");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
