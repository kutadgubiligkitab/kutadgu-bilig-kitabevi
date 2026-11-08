"use strict";

const assert = require("node:assert/strict");
const Advisor = require("../kutadgu-book-advisor.js");
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
  console.log("book-advisor-catalog-tools ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
