"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Advisor = require("../kutadgu-book-advisor.js");
const Cases = require("./book-advisor-cases.js");

const root = path.join(__dirname, "..");
const books = [
  {
    id: 701,
    title: "باي دادام نامرات دادام",
    author: "روبرت كىيوسكى",
    category: "ئىقتىساد",
    price: 30,
    stock: 4,
    image_url: "https://covers.example/701.jpg",
    description: "پۇل ۋە بايلىقنى باشقۇرۇش ھەققىدە.",
    is_active: true,
    submission_status: "approved"
  },
  {
    id: 700,
    title: "باي دادام مالىيە ئەركىنلىك يولى",
    author: "روبرت كىيوسكى",
    category: "ئىقتىساد",
    price: 28,
    stock: 2,
    description: "مالىيە ئەركىنلىكى ھەققىدە.",
    is_active: true,
    submission_status: "approved"
  },
  {
    id: 709,
    title: "ئۇيغۇر تائاملىرى",
    author: "ئاشپەز",
    category: "تائاملار",
    price: 22,
    description: "لەغمەن ۋە پولۇ.",
    is_active: true,
    submission_status: "approved"
  },
  {
    id: 156,
    title: "ئويغانغان زېمىن 1",
    author: "ئابدۇرېھىم ئۆتكۈر",
    category: "رومان",
    price: 18,
    series_title: "ئويغانغان زېمىن",
    series_slug: "oyghanghan-zemin",
    is_active: true,
    submission_status: "approved"
  },
  {
    id: 157,
    title: "ئويغانغان زېمىن 2",
    author: "ئابدۇرېھىم ئۆتكۈر",
    category: "رومان",
    price: 15,
    series_title: "ئويغانغان زېمىن",
    series_slug: "oyghanghan-zemin",
    is_active: true,
    submission_status: "approved"
  },
  {
    id: 50,
    title: "يوشۇرۇن كىتاب",
    author: "يوق",
    category: "رومان",
    price: 10,
    is_active: false,
    submission_status: "approved"
  },
  {
    id: 51,
    title: "تەستىقسىز كىتاب",
    author: "يوق",
    category: "رومان",
    price: 10,
    is_active: true,
    submission_status: "pending"
  }
];

function jsonResponse(body) {
  return {
    ok: true,
    json: async () => body
  };
}

function selectionResponse(ids, usage) {
  return jsonResponse({
    output_text: JSON.stringify({ book_ids: ids }),
    usage: usage || { input_tokens: 1000, output_tokens: 40 }
  });
}

async function run() {
  const catalog = Advisor.buildCatalog(books);
  assert.equal(catalog.count, 5);
  assert.equal(catalog.byId.has(50), false);
  assert.equal(catalog.byId.has(51), false);
  assert.ok(catalog.text.includes("701"));
  assert.equal(catalog.version, Advisor.CATALOG_TEXT_VERSION);

  const collapsed = Advisor.presentSelection([156, 157, 701], catalog);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].kind, "series");
  assert.equal(collapsed[0].href, "/series/oyghanghan-zemin");
  assert.equal(collapsed[0].price, 15);
  assert.deepEqual(collapsed[0].member_ids, [156, 157]);
  assert.equal(collapsed[1].href, "/book/701");
  assert.equal(collapsed[1].price, 30);
  const unpriced = Advisor.buildCatalog([{ id: 106, title: "يۈزمىڭلىغان نېمە ئۈچۈن - تۇرمۇش ساۋاتلىرى", author: "لىن چىڭ", category: "بالىلار كىتابلىرى" }]);
  assert.equal(Advisor.presentSelection([106], unpriced)[0].price, null);
  assert.equal(Advisor.presentSelection([106], unpriced)[0].stock, null);
  assert.equal(Advisor.presentSelection([999, 50, 51], catalog).length, 0);

  const budget = Advisor.createBudget(1000000);
  let calls = 0;
  const result = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget,
    turns: [{ role: "user", content: "پۇل تېجەش ھەققىدە كىتاب" }],
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(JSON.parse(init.body).model, "gpt-6-luna");
      assert.equal(JSON.parse(init.body).store, false);
      assert.equal(init.headers.Authorization, "Bearer test-key");
      if (calls === 1) return selectionResponse([701, 700, 404]);
      return jsonResponse({
        output_text: JSON.stringify({ message: "باي دادام نامرات دادام ۋە باي دادام مالىيە ئەركىنلىك يولى پۇل باشقۇرۇشقا ماس." }),
        usage: { input_tokens: 200, output_tokens: 30 }
      });
    }
  });
  assert.deepEqual(result.books.map((row) => row.id), [701, 700]);
  assert.equal(result.books[0].title, "باي دادام نامرات دادام");
  assert.equal(Object.prototype.hasOwnProperty.call(result.books[0], "description"), false);
  assert.match(result.message, /باي دادام نامرات دادام/);

  let leakedCalls = 0;
  const leaked = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1000000),
    turns: [{ role: "user", content: "پۇل تېجەش ھەققىدە كىتاب" }],
    fetchImpl: async () => {
      leakedCalls += 1;
      if (leakedCalls === 1) return selectionResponse([701]);
      return jsonResponse({
        output_text: JSON.stringify({ message: "ئۇيغۇر تائاملىرىنى ئېلىڭ." }),
        usage: { input_tokens: 10, output_tokens: 10 }
      });
    }
  });
  assert.equal(leaked.books.length, 1);
  assert.equal(leaked.message, Advisor.SAFE_MESSAGE);

  const empty = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1000000),
    turns: [{ role: "user", content: "ئايروپىلان موتورىنى رېمونت قىلىش" }],
    fetchImpl: async () => selectionResponse([123456, 50])
  });
  assert.equal(empty.books.length, 0);
  assert.equal(empty.message, Advisor.NO_MATCH_MESSAGE);

  let fetched = 0;
  await assert.rejects(() => Advisor.advise({
    catalog,
    apiKey: "",
    budget: Advisor.createBudget(1000000),
    turns: [{ role: "user", content: "پۇل" }],
    fetchImpl: async () => {
      fetched += 1;
      return selectionResponse([701]);
    }
  }), (error) => error.code === "advisor_unavailable");
  assert.equal(fetched, 0);

  const poor = Advisor.createBudget(1);
  await assert.rejects(() => Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: poor,
    turns: [{ role: "user", content: "پۇل تېجەش ھەققىدە كىتاب" }],
    fetchImpl: async () => {
      fetched += 1;
      return selectionResponse([701]);
    }
  }), (error) => error.code === "advisor_budget");
  assert.equal(fetched, 0);

  let toolCalls = 0;
  const lookedUp = await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1000000),
    turns: [{ role: "user", content: "لەغمەن ئېتىشنى ئۆگەنمەكچى" }],
    fetchImpl: async (_url, init) => {
      toolCalls += 1;
      const request = JSON.parse(init.body);
      if (toolCalls === 1) {
        return jsonResponse({
          output: [{
            type: "function_call",
            name: "lookup_catalog_books",
            call_id: "call-1",
            arguments: JSON.stringify({ book_ids: [709, 999] })
          }],
          usage: { input_tokens: 100, output_tokens: 20 }
        });
      }
      if (request.input.some((item) => item.type === "function_call_output")) {
        const output = request.input.find((item) => item.type === "function_call_output");
        assert.deepEqual(JSON.parse(output.output).map((row) => row.id), [709]);
        return selectionResponse([709]);
      }
      return jsonResponse({
        output_text: JSON.stringify({ message: "ئۇيغۇر تائاملىرى لەغمەن ئېتىشكە ماس." }),
        usage: { input_tokens: 20, output_tokens: 12 }
      });
    }
  });
  assert.deepEqual(lookedUp.books.map((row) => row.id), [709]);

  const longTurns = [];
  for (let i = 0; i < 9; i += 1) longTurns.push({ role: "user", content: "سوئال " + i });
  assert.equal(Advisor.boundConversation(longTurns).length, 6);

  assert.equal(Cases.CASES.length, 50);
  assert.equal(Cases.FOLLOW_UPS.length, 4);
  assert.equal(Cases.scoreList([{ category: "ئىقتىساد" }, { category: "رومان" }], Cases.CASES[0], 3).hit, true);
  assert.equal(Cases.scoreList([{ category: "رومان" }], Cases.CASES[0], 3).hit, false);
  assert.equal(Cases.scoreList([{ category: "تائاملار" }], Cases.CASES.find((item) => item.id === "none-3"), 5).hit, false);

  const dispatch = fs.readFileSync(path.join(root, "cloudflare", "preview-dispatch.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "kutadgu-ai-search.js"), "utf8");
  const wrangler = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  assert.equal(dispatch.includes("book-advisor-private"), true);
  assert.equal(dispatch.includes("kutadgu-ai-search"), false);
  assert.equal(worker.includes("gpt-6-luna"), false);
  assert.equal(worker.includes("book_advisor"), false);
  assert.match(worker, /SEMANTIC_ACCEPT_FLOOR = 0\.55/);
  assert.equal(wrangler.includes("\"BOOK_ADVISOR_ENABLED\": \"false\""), true);
  assert.equal(wrangler.includes("\"BOOK_ADVISOR_PRIVATE_TEST_ENABLED\": \"false\""), true);
  assert.equal(wrangler.includes("\"AI_SEARCH_ENABLED\": \"true\""), false);
  const ignored = fs.readFileSync(path.join(root, ".assetsignore"), "utf8");
  assert.equal(ignored.includes("book-advisor.html"), false);
  assert.equal(ignored.includes("kutadgu-book-advisor.js"), true);
  const prompts = [];
  await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1000000),
    turns: [{ role: "user", content: "پۇل تېجەش" }],
    fetchImpl: async (_url, init) => {
      prompts.push(JSON.parse(init.body).input);
      return selectionResponse([]);
    }
  });
  await Advisor.advise({
    catalog,
    apiKey: "test-key",
    budget: Advisor.createBudget(1000000),
    turns: [{ role: "user", content: "شېئىر" }],
    fetchImpl: async (_url, init) => {
      prompts.push(JSON.parse(init.body).input);
      return selectionResponse([]);
    }
  });
  assert.equal(prompts[0][1].content.includes("CUSTOMER"), false);
  assert.equal(prompts[0][1].content, prompts[1][1].content);
  assert.equal(prompts[0][2].content.includes("پۇل تېجەش"), true);
  assert.equal(prompts[1][2].content.includes("شېئىر"), true);
  const Ui = require("../kutadgu-book-advisor-ui.js");
  assert.equal(Ui.customerState(503, "disabled"), "مەسلىھەتچى ھازىر ئىشلىمەيدۇ.");
  assert.equal(Ui.customerState(400, "advisor_budget"), "بۈگۈنكى مەسلىھەت چېكى توشتى.");
  assert.equal(Ui.customerState(400, "advisor_rate_limit"), "بىر ئازدىن كېيىن قايتا سىناڭ.");
  assert.equal(Ui.safeHref({ href: "https://evil.example", id: 12 }), "/book/12");
  assert.equal(Ui.safeHref({ href: "/series/oyghanghan-zemin", id: 12 }), "/series/oyghanghan-zemin");
  assert.equal(Ui.safeImage("javascript:alert(1)"), "");
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) || "", setItem: (key, value) => store.set(key, value) };
  Ui.writeMemory(storage, {
    turns: [{ role: "user", content: "شېئىر" }, { role: "assistant", content: "بۇ كىتاب ماس كېلىدۇ." }],
    sessionId: "ab".repeat(16),
    open: true,
    entries: [{ role: "assistant", text: "بۇ كىتاب ماس كېلىدۇ.", cards: [{ title: "دىۋان", author: "ئاپتور", price: 12, href: "https://evil.example", image_url: "javascript:alert(1)" }] }]
  });
  const saved = Ui.readMemory(storage);
  assert.equal(saved.sessionId, "ab".repeat(16));
  assert.equal(saved.turns.length, 2);
  assert.equal(saved.entries[0].cards[0].href, "/books");
  assert.equal(saved.entries[0].cards[0].image_url, "");
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal(index.includes("book-advisor.html"), false);
  assert.equal(index.includes("id=\"aiSearchButton\""), false);
  assert.equal(index.includes("id=\"searchInput\""), true);
  const header = fs.readFileSync(path.join(root, "public-header.js"), "utf8");
  assert.equal(header.includes("kutadgu-book-advisor-ui.js"), true);
  const page = fs.readFileSync(path.join(root, "book-advisor.html"), "utf8");
  assert.equal(page.includes("advisorForm"), false);
  assert.equal(page.includes("/api/book-advisor"), false);
  console.log("book-advisor-tests ok");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
