"use strict";

/**
 * Local conversational-quality harness.
 * Uses OPENAI_EVAL_API_KEY only. It does not read Cloudflare or Supabase secrets.
 * Catalog reads use the public publishable key. Spending is a local allowance,
 * not the production ledger. GPT responses are never mocked.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Advisor = require("../kutadgu-book-advisor.js");
const Budget = require("../kutadgu-book-advisor-budget.js");
const Gate = require("../cloudflare/book-advisor-private.js");
const Ui = require("../kutadgu-book-advisor-ui.js");

const CAP_MICRO_USD = 120000;
const MULTI_CAP_MICRO_USD = 80000;
const REFINE_CAP_MICRO_USD = 50000;
const REFINE = [
  { id: "child-age", thread: "child", q: "بالامغا ھېكايە كىتابى لازىم." },
  { id: "child-seven", thread: "child", q: "بالام 7 ياش، ھېكايە ئوقۇشنى ياخشى كۆرىدۇ." },
  { id: "child-suitable", thread: "child", q: "شۇنداق بولسا ماس كىتاب تەۋسىيە قىلىڭ." },
  { id: "child-easier", thread: "child", q: "بۇلارنىڭ قايسىسى ئاسانراق؟ نېمىشقا؟", difficulty: true },
  { id: "child-again", thread: "child", q: "يەنە بىر ماس كىتاب بارمۇ؟ يېشىغا ئېنىق ماس كەلمىگىنىنى قوشماڭ." }
];
const KEY_NAME = "OPENAI_EVAL_API_KEY";
const Compare = require("../kutadgu-book-advisor-compare.js");
const FIRST = [
  { id: "history", q: "ئىسلام تارىخى ھەققىدە قىسقىچە چۈشەنچە بەر." },
  { id: "saving", q: "پۇلۇمنى قانداق تېجىسەم بولىدۇ؟" },
  { id: "child", q: "بالامغا قانداق كىتاب ئوقۇتسام بولىدۇ؟" },
  { id: "beginner", q: "مەن تارىخنى ئۆگەنمەكچى، قەيەردىن باشلىسام بولىدۇ؟" },
  { id: "absent", q: "سىلەردە ھاررى پوتتېر ۋە پىلانتا تېشى بارمۇ؟", absentTitle: "ھاررى پوتتېر ۋە پىلانتا تېشى" }
];
const MULTI = [
  { id: "child-age", thread: "child", q: "بالامغا بالىلار كىتابى لازىم." },
  { id: "child-detail", thread: "child", q: "بالام 7 ياش، ھېكايە ئوقۇشنى ياخشى كۆرىدۇ." },
  { id: "child-books", thread: "child", q: "شۇنداق بولسا ماس كىتاب تەۋسىيە قىلىڭ." },
  { id: "child-easier", thread: "child", q: "بۇلارنىڭ قايسىسى ئاسانراق؟ نېمىشقا؟", difficulty: true },
  { id: "broad-history", thread: "history", q: "تارىخ ئۆگىنىشنىڭ ياخشى يولى قانداق؟" },
  { id: "missing-title", thread: "missing", q: "سىلەردە كىچىك شاھزادە بارمۇ؟", absentTitle: "كىچىك شاھزادە" },
  { id: "reading-habit", thread: "study", q: "ئوقۇش ئادىتىنى قانداق يېتىلدۈرىمەن؟" }
];

function redact(value) {
  return String(value || "").replace(/sk-[A-Za-z0-9_-]+/g, "[openai-key]").replace(/sb_[A-Za-z0-9_-]+/g, "[catalog-key]");
}

function usageOf(result) {
  const totals = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
  for (const call of (result && result.usage && result.usage.calls) || []) {
    totals.input_tokens += Number(call.input_tokens) || 0;
    totals.cached_tokens += Number(call.cached_tokens) || 0;
    totals.output_tokens += Number(call.output_tokens) || 0;
  }
  return totals;
}

function harnessCatalog() {
  return Advisor.buildCatalog([
    { id: 433, title: "بەش ياشقىچە پائالىيەت", author: "نەشر", category: "بالىلار كىتابلىرى", price: 30, description: "(5-6 ياشقىچە) بالىلار پائالىيىتى.", is_active: true, submission_status: "approved" },
    { id: 501, title: "يەتتە ياش ھېكايىلىرى", author: "نەشر", category: "بالىلار كىتابلىرى", price: 40, description: "6 ياشتىن 8 ياشقىچە بالىلار ئۈچۈن ھېكايە.", is_active: true, submission_status: "approved" }
  ]);
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function postAdvisor(options) {
  const response = await Gate.handleBookAdvisor(new Request("https://www.kutadgubilik.com/api/book-advisor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": options.ip
    },
    body: JSON.stringify({
      turns: options.turns,
      session_id: options.sessionId || "",
      constraint_token: options.token || "",
      constraints: { age: 99, strictAge: false, story: false, summary: "client summary" }
    })
  }), {
    BOOK_ADVISOR_ENABLED: "true",
    BOOK_ADVISOR_CLIENT_HASH_SECRET: options.secret,
    OPENAI_API_KEY: options.apiKey
  }, {
    ledger: options.ledger,
    sessions: options.sessions,
    loadCatalog: async () => options.catalog,
    fetchImpl: options.fetchImpl,
    now: () => options.now || new Date()
  });
  return response.json();
}

async function runMockHarness() {
  const secret = crypto.randomBytes(32).toString("hex");
  const catalog = harnessCatalog();
  const ip = "203.0.113.77";
  const clientHash = Budget.clientHash(secret, ip);
  const ledger = Budget.createLedger({ dailyLimitMicroUsd: 2000000, monthlyLimitMicroUsd: 20000000, perMinute: 30 });
  const sessions = Budget.createSessionStore();
  const now = new Date();
  const plan = REFINE.concat([
    { id: "child-sixth", q: "رەھمەت." },
    { id: "child-seventh", q: "داۋام قىلىڭ." },
    { id: "child-eighth", q: "يەنە بىر ھېكايە كۆرسىتىڭ. يېشىغا ئېنىق ماس كەلمىگىنىنى قوشماڭ." }
  ]);
  let turns = [];
  let sessionId = "";
  let token = "";
  const seen = [];
  for (const item of plan) {
    const sent = Ui.cleanTurns(turns.concat([{ role: "user", content: item.q }]));
    const calls = [];
    const body = await postAdvisor({
      secret,
      catalog,
      apiKey: "test-key",
      ledger,
      sessions,
      ip,
      now,
      turns: sent,
      sessionId,
      token,
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(init.body);
        calls.push(request);
        const packed = JSON.stringify(request.input);
        const output = packed.includes("VERIFIED_BOOKS")
          ? { mode: "recommend", message: "يەتتە ياش ھېكايىلىرى ھېكايە. بەش ياشقىچە پائالىيەت بۇ ياشقا ماس ئەمەس.", book_ids: [] }
          : { mode: "recommend", message: "", book_ids: [433, 501] };
        return jsonResponse({ output_text: JSON.stringify(output), usage: { input_tokens: 40, output_tokens: 20 } });
      }
    });
    if (body.ok !== true) throw new Error("harness-" + item.id + "-" + (body.error || "failed"));
    sessionId = body.session_id;
    token = body.constraint_token;
    const state = Budget.readConstraintState(secret, token, { clientHash, sessionId, now });
    const cards = (body.books || []).map((book) => book.id);
    seen.push({ id: item.id, calls, cards, state, sent });
    turns = Ui.cleanTurns(sent.concat([{ role: "assistant", content: body.message || "" }]));
    if (cards.includes(433)) throw new Error("rejected-card-" + item.id);
  }
  if (plan.length !== 8) throw new Error("harness-plan");
  const fifth = seen[4];
  const packedWindow = fifth.sent.map((turn) => turn.content).join("\n");
  if (packedWindow.includes("بالام 7 ياش")) throw new Error("fifth-window-still-has-age");
  if (!fifth.state || fifth.state.age !== 7 || fifth.state.story !== true || fifth.state.strictAge !== true) throw new Error("fifth-signed-state");
  if (fifth.calls.length < 2) throw new Error("fifth-model-stages-" + fifth.calls.length);
  for (const call of fifth.calls) {
    const packed = JSON.stringify(call.input);
    if (!packed.includes("reader_age: 7") || !packed.includes("interest: stories") || !packed.includes("age_match: strict")) {
      throw new Error("fifth-context-missing");
    }
  }
  const eighth = seen[7];
  if (eighth.sent.map((turn) => turn.content).join("\n").includes("بالام 7 ياش")) throw new Error("eighth-window-still-has-age");
  if (!eighth.state || eighth.state.age !== 7 || eighth.state.story !== true || eighth.state.strictAge !== true) throw new Error("eighth-signed-state");
  if (eighth.calls.length < 2) throw new Error("eighth-model-stages");
  for (const call of eighth.calls) {
    const packed = JSON.stringify(call.input);
    if (!packed.includes("reader_age: 7") || !packed.includes("interest: stories")) throw new Error("eighth-context-missing");
  }
  const other = await postAdvisor({
    secret,
    catalog,
    apiKey: "test-key",
    ledger,
    sessions,
    ip,
    now,
    turns: [{ role: "user", content: "يەنە بىر ھېكايە." }],
    sessionId: crypto.randomBytes(16).toString("hex"),
    token,
    fetchImpl: async () => jsonResponse({
      output_text: JSON.stringify({ mode: "clarify", message: "بالىڭىز نەچچە ياشتا؟ ياشنى يېزىڭ.", book_ids: [] }),
      usage: { input_tokens: 10, output_tokens: 8 }
    })
  });
  const stolen = Budget.readConstraintState(secret, other.constraint_token, {
    clientHash,
    sessionId: other.session_id,
    now
  });
  if (!stolen || stolen.age !== null) throw new Error("cross-session-inherited-age");
  console.log("book-advisor-eval-harness ok");
}

async function runPaidConsistency(options) {
  const secret = crypto.randomBytes(32).toString("hex");
  const ip = "203.0.113.78";
  const clientHash = Budget.clientHash(secret, ip);
  const ledger = Budget.createLedger({
    dailyLimitMicroUsd: options.cap,
    monthlyLimitMicroUsd: options.cap,
    perMinute: 10
  });
  const sessions = Budget.createSessionStore();
  const now = new Date();
  let turns = [];
  let sessionId = "";
  let token = "";
  let spent = 0;
  let apiCalls = 0;
  const results = [];
  for (const item of options.plan) {
    if (spent + options.hold > options.cap) {
      results.push({ id: item.id, stopped: "local-cap", spentMicroUsd: spent, openaiRequests: apiCalls });
      break;
    }
    const sent = Ui.cleanTurns(turns.concat([{ role: "user", content: item.q }]));
    const calls = [];
    const started = Date.now();
    let body;
    try {
      body = await postAdvisor({
        secret,
        catalog: options.catalog,
        apiKey: options.apiKey,
        ledger,
        sessions,
        ip,
        now,
        turns: sent,
        sessionId,
        token,
        fetchImpl: async (_url, init) => {
          const response = await global.fetch(_url, init);
          const payload = await response.clone().json().catch(() => null);
          calls.push({
            input: init && init.body ? JSON.parse(init.body).input : [],
            usage: payload && payload.usage || {},
            output: payload && payload.output_text || ""
          });
          return new Response(JSON.stringify(payload), { status: response.status, headers: { "content-type": "application/json" } });
        }
      });
    } catch (error) {
      results.push({ id: item.id, error: redact(error && error.message || "failed"), ms: Date.now() - started, openaiRequests: apiCalls });
      break;
    }
    apiCalls += calls.length;
    if (!body || body.ok !== true) {
      results.push({ id: item.id, error: redact(body && body.error || "failed"), ms: Date.now() - started, openaiRequests: apiCalls });
      break;
    }
    sessionId = body.session_id;
    token = body.constraint_token;
    const state = Budget.readConstraintState(secret, token, { clientHash, sessionId, now });
    const usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
    const requested = [];
    for (const call of calls) {
      usage.input_tokens += Number(call.usage.input_tokens) || 0;
      usage.cached_tokens += Number((call.usage.input_tokens_details || {}).cached_tokens || call.usage.cached_tokens) || 0;
      usage.output_tokens += Number(call.usage.output_tokens) || 0;
      let parsed = null;
      try { parsed = JSON.parse(call.output); } catch (_error) { parsed = null; }
      for (const id of (parsed && parsed.book_ids) || []) requested.push(id);
    }
    const cards = (body.books || []).map((book) => book.id);
    const actual = usage.input_tokens + usage.output_tokens > 0 ? Advisor.usageMicroUsd(usage) : 0;
    spent += actual;
    results.push({
      id: item.id,
      q: item.q,
      ms: Date.now() - started,
      message: body.message,
      books: body.books || [],
      rejectedIds: requested.filter((id) => !cards.includes(id)),
      constraints: state,
      modelRequests: calls.map((call) => JSON.stringify(call.input)),
      apiCalls: calls.length,
      usage,
      actualMicroUsd: actual,
      spentMicroUsd: spent
    });
    console.log(JSON.stringify({ id: item.id, ms: Date.now() - started, micro: actual, books: cards.length, apiCalls: calls.length }));
    turns = Ui.cleanTurns(sent.concat([{ role: "assistant", content: body.message || "" }]));
    fs.writeFileSync(options.outPath, JSON.stringify({ customerTurns: results.length, openaiRequests: apiCalls, spentMicroUsd: spent, results }, null, 2));
    if (spent > options.cap) break;
  }
  fs.writeFileSync(options.outPath, JSON.stringify({ customerTurns: results.length, openaiRequests: apiCalls, spentMicroUsd: spent, results }, null, 2));
  if (spent > options.cap) process.exit(3);
}

async function main() {
  const phase = process.argv[2] || "";
  if (phase === "harness") {
    await runMockHarness();
    return;
  }
  if (phase !== "first" && phase !== "multi" && phase !== "refine" && phase !== "consistency") {
    console.log("no-request");
    console.log("Use phase consistency for the corrected child conversation. Earlier results are not repeated.");
    process.exit(0);
  }
  const apiKey = String(process.env[KEY_NAME] || "");
  if (apiKey.length < 20) {
    console.log("evaluation-key-missing");
    console.log("Set OPENAI_EVAL_API_KEY for this process only. Do not store it in the repository or send it in chat.");
    process.exit(2);
  }
  const config = fs.readFileSync(path.join(__dirname, "..", "supabase-config.js"), "utf8");
  const publicKey = (config.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0] || "";
  const catalog = await Advisor.loadReadOnlyCatalog(global.fetch, "https://fxlojnqwyojqjskfggmh.supabase.co", publicKey);
  if (catalog.count !== 604) throw new Error("catalog-count-" + catalog.count);
  const plan = phase === "consistency" || phase === "refine" ? REFINE : phase === "multi" ? MULTI : FIRST;
  const cap = phase === "consistency" || phase === "refine" ? REFINE_CAP_MICRO_USD : phase === "multi" ? MULTI_CAP_MICRO_USD : CAP_MICRO_USD;
  for (const item of plan) {
    if (!item.absentTitle) continue;
    for (const book of catalog.byId.values()) {
      if (String(book.title || "").includes(item.absentTitle)) throw new Error("absent-title-now-present");
    }
  }
  const outDir = path.join(process.env.LOCALAPPDATA || ".", "kutadgu-book-advisor-eval");
  fs.mkdirSync(outDir, { recursive: true });
  let outPath = path.join(outDir, phase === "consistency" ? "quality-consistency.json" : phase === "refine" ? "quality-refine.json" : phase === "multi" ? "quality-multi.json" : "quality-results.json");
  if (phase === "consistency" && fs.existsSync(outPath)) {
    outPath = path.join(outDir, "quality-consistency-" + Date.now() + ".json");
  }
  if (phase === "consistency") {
    const hold = Advisor.worstCaseMicroUsd(catalog);
    const projected = hold * plan.length;
    if (projected > cap) {
      console.log("evaluation-unbounded");
      console.log(JSON.stringify({
        customerTurns: plan.length,
        worstCaseMicroUsd: hold,
        projectedMicroUsd: projected,
        capMicroUsd: cap,
        openaiRequests: 0
      }));
      process.exit(4);
    }
    await runPaidConsistency({ catalog, apiKey, cap, plan, outPath, hold });
    return;
  }
  const results = [];
  let spent = 0;
  const hold = Advisor.worstCaseMicroUsd(catalog);
  const threads = new Map();
  if (phase === "multi") {
    const sample = [];
    for (const book of catalog.byId.values()) {
      if (!Number.isFinite(book.price)) continue;
      if (!sample.length || book.price !== sample[0].price) sample.push(book);
      if (sample.length === 2) break;
    }
    const priced = sample.filter((book) => Number.isFinite(book.price));
    if (priced.length < 2) throw new Error("price-sample-missing");
    const compared = Compare.comparePrices("cheapest", priced.map((book) => book.id), catalog, (ids) => ids.map((id) => catalog.byId.get(id)).filter(Boolean));
    const cheapest = Math.min.apply(null, priced.map((book) => book.price));
    results.push({
      id: "price-check",
      paid: false,
      verified: compared.verified === true && compared.books.some((book) => book.price === cheapest),
      message: compared.message,
      books: compared.books.map((book) => ({ id: book.id, title: book.title, price: book.price }))
    });
  }
  for (const item of plan) {
    if (spent + hold > cap) {
      results.push({ id: item.id, stopped: "local-cap", spentMicroUsd: spent });
      break;
    }
    const started = Date.now();
    let result;
    try {
      const thread = threads.get(item.thread || item.id) || { turns: [], bookIds: [] };
      const turns = thread.turns.concat([{ role: "user", content: item.q }]);
      result = await Advisor.advise({
        catalog,
        apiKey,
        budget: Advisor.createBudget(hold),
        turns,
        trustedBookIds: item.difficulty ? thread.bookIds : [],
        fetchImpl: global.fetch
      });
      thread.turns = turns.concat([{ role: "assistant", content: result.message }]).slice(-6);
      if ((result.books || []).length) {
        thread.bookIds = result.books.map((book) => book.id);
      }
      threads.set(item.thread || item.id, thread);
    } catch (error) {
      results.push({ id: item.id, error: redact(error && error.code || error && error.message || "failed"), ms: Date.now() - started });
      break;
    }
    const usage = usageOf(result);
    const actual = usage.input_tokens + usage.output_tokens > 0 ? Advisor.usageMicroUsd(usage) : hold;
    spent += actual;
    results.push({
      id: item.id,
      q: item.q,
      ms: Date.now() - started,
      message: result.message,
      mode: result.mode || "",
      modelMessage: result.model_message || "",
      evidence: result.evidence || "",
      requestedIds: result.requested_ids || [],
      decisions: result.decisions || [],
      suitability: result.suitability || [],
      books: (result.books || []).map((book) => ({ id: book.id, title: book.title, author: book.author, price: book.price, href: book.href })),
      handoff: result.handoff || null,
      usage,
      actualMicroUsd: actual,
      spentMicroUsd: spent
    });
    console.log(JSON.stringify({ id: item.id, mode: result.mode || "", ms: Date.now() - started, micro: actual, books: (result.books || []).length, handoff: Boolean(result.handoff) }));
    fs.writeFileSync(outPath, JSON.stringify({ spentMicroUsd: spent, results }, null, 2));
  }
  fs.writeFileSync(outPath, JSON.stringify({ spentMicroUsd: spent, results }, null, 2));
  if (spent > cap) process.exit(3);
}

main().catch((error) => {
  console.error(redact(error && error.message || "eval-failed"));
  process.exit(1);
});
