"use strict";

/**
 * Local conversational-quality harness.
 * Uses OPENAI_EVAL_API_KEY only. It does not read Cloudflare or Supabase secrets.
 * Catalog reads use the public publishable key. Spending is a local allowance,
 * not the production ledger. GPT responses are never mocked.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
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
const Acceptance = require("./book-advisor-acceptance-cases.js");
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
  await runBudgetCases();
  console.log("book-advisor-eval-harness ok");
}

function billableUsage(payload) {
  const usage = payload && payload.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return false;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return false;
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return false;
  return input + output > 0;
}

function guardedLedger(inner, events) {
  return {
    reserve(input) {
      events.hold = Math.floor(Number(input && input.microUsd));
      return inner.reserve(input);
    },
    settle(id, actualMicroUsd) {
      const requested = Math.floor(Number(actualMicroUsd));
      const uncertain = events.uncertain || events.failed || events.missingUsage;
      const known = !uncertain && Number.isInteger(requested) && requested > 0;
      const charge = known ? requested : (events.contacted ? events.hold : 0);
      if (events.contacted && !known) events.conservative = true;
      return inner.settle(id, charge).then((settled) => {
        events.settled = settled.actualMicroUsd;
        return settled;
      });
    },
    release(id) {
      if (!events.contacted) return inner.release(id);
      events.conservative = true;
      events.uncertain = true;
      events.failed = true;
      return inner.settle(id, events.hold).then((settled) => {
        events.settled = settled.actualMicroUsd;
        return { releasedMicroUsd: 0 };
      });
    }
  };
}

async function runBoundedConversation(options) {
  const secret = options.secret || crypto.randomBytes(32).toString("hex");
  const ip = options.ip || "203.0.113.78";
  const clientHash = Budget.clientHash(secret, ip);
  const ledger = Budget.createLedger({
    dailyLimitMicroUsd: options.cap,
    monthlyLimitMicroUsd: options.cap,
    perMinute: options.perMinute || 10
  });
  const sessions = Budget.createSessionStore();
  const now = options.now || new Date();
  const plan = options.plan.slice(0, 5);
  let turns = [];
  let sessionId = "";
  let token = "";
  let spent = 0;
  let apiCalls = 0;
  const results = [];
  for (const item of plan) {
    const events = { contacted: false, failed: false, missingUsage: false, conservative: false, settled: 0, hold: options.hold };
    const calls = [];
    const started = Date.now();
    const sent = Ui.cleanTurns(turns.concat([{ role: "user", content: item.q }]));
    let body;
    try {
      body = await postAdvisor({
        secret,
        catalog: options.catalog,
        apiKey: options.apiKey,
        ledger: guardedLedger(ledger, events),
        sessions,
        ip,
        now,
        turns: sent,
        sessionId,
        token,
        fetchImpl: trackPaidFetch(events, calls, options.fetchImpl)
      });
    } catch (error) {
      apiCalls += calls.length;
      const actual = Math.floor(Number(events.settled) || (events.contacted ? events.hold : 0));
      spent += events.settled ? actual : 0;
      results.push({
        id: item.id,
        error: redact(error && error.name ? error.name + ": " + error.message : error && error.message || "failed"),
        ms: Date.now() - started,
        apiCalls: calls.length,
        actualMicroUsd: events.settled ? actual : 0,
        conservative: events.conservative === true || events.uncertain === true,
        failure: calls.map((call) => call.error).filter(Boolean).join(",")
      });
      if (options.outPath) fs.writeFileSync(options.outPath, JSON.stringify({ completedCustomerTurns: results.filter((row) => row.ok).length, openaiRequests: apiCalls, spentMicroUsd: spent, results }, null, 2));
      break;
    }
    if (body && (body.error === "advisor_budget" || body.error === "advisor_rate_limit") && !events.contacted) {
      results.push({ id: item.id, stopped: "local-cap", spentMicroUsd: spent, openaiRequests: apiCalls });
      break;
    }
    apiCalls += calls.length;
    const actual = Math.floor(Number(events.settled) || 0);
    spent += actual;
    sessionId = body && body.session_id || sessionId;
    token = body && body.constraint_token || token;
    const state = token ? Budget.readConstraintState(secret, token, { clientHash, sessionId, now }) : null;
    const usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
    const requested = [];
    for (const call of calls) {
      const callUsage = call.usage || {};
      usage.input_tokens += Number(callUsage.input_tokens) || 0;
      usage.cached_tokens += Number((callUsage.input_tokens_details || {}).cached_tokens || callUsage.cached_tokens) || 0;
      usage.output_tokens += Number(callUsage.output_tokens) || 0;
      let parsed = null;
      try { parsed = JSON.parse(call.output); } catch (_error) { parsed = null; }
      for (const id of (parsed && parsed.book_ids) || []) requested.push(id);
    }
    const cards = (body && body.books || []).map((book) => book.id);
    results.push({
      id: item.id,
      q: item.q,
      ms: Date.now() - started,
      ok: !!(body && body.ok),
      message: body && body.message || "",
      books: body && body.books || [],
      rejectedIds: requested.filter((id) => !cards.includes(id)),
      constraints: state,
      modelRequests: calls.map((call) => JSON.stringify(call.input)),
      apiCalls: calls.length,
      usage,
      actualMicroUsd: actual,
      conservative: events.conservative === true,
      failure: calls.map((call) => call.error).filter(Boolean).join(","),
      spentMicroUsd: spent
    });
    if (options.outPath) {
      fs.writeFileSync(options.outPath, JSON.stringify({
        completedCustomerTurns: results.filter((row) => row.ok).length,
        openaiRequests: apiCalls,
        spentMicroUsd: spent,
        results
      }, null, 2));
    }
    const stop = !body || body.ok !== true || events.conservative || spent > options.cap;
    if (stop) break;
    turns = Ui.cleanTurns(sent.concat([{ role: "assistant", content: body.message || "" }]));
  }
  const summary = {
    completed: results.filter((row) => row.ok).length,
    openaiRequests: apiCalls,
    spentMicroUsd: spent,
    results
  };
  if (options.outPath) fs.writeFileSync(options.outPath, JSON.stringify(summary, null, 2));
  return summary;
}

async function runBudgetCases() {
  const catalog = harnessCatalog();
  const hold = Advisor.worstCaseMicroUsd(catalog);
  const cap = REFINE_CAP_MICRO_USD;
  const liveHold = Advisor.worstCaseMicroUsd({ chars: 100875 });
  if (liveHold > cap) throw new Error("first-turn-does-not-fit");
  if (liveHold * 5 <= cap) throw new Error("five-turn-worst-case-unexpectedly-fits");
  const secret = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const cheapPath = path.join(os.tmpdir(), "kutadgu-eval-cheap.json");
  const cheap = await runBoundedConversation({
    secret,
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: REFINE,
    outPath: cheapPath,
    perMinute: 10,
    fetchImpl: async () => jsonResponse({
      output_text: JSON.stringify({ mode: "recommend", message: "يەتتە ياش ھېكايىلىرى ماس كېلىدۇ.", book_ids: [433, 501] }),
      usage: { input_tokens: 20, output_tokens: 10 }
    })
  });
  if (cheap.completed !== 5) throw new Error("cheap-turns-" + cheap.completed);
  if (cheap.spentMicroUsd <= 0 || cheap.spentMicroUsd > cap) throw new Error("cheap-spend-" + cheap.spentMicroUsd);
  const savedCheap = JSON.parse(fs.readFileSync(cheapPath, "utf8"));
  if (savedCheap.completed !== 5 || savedCheap.openaiRequests < 5) throw new Error("cheap-file");
  const last = cheap.results[4];
  if (!last.constraints || last.constraints.age !== 7 || last.constraints.story !== true || last.constraints.strictAge !== true) {
    throw new Error("budget-constraints");
  }
  if (last.books.some((book) => book.id === 433)) throw new Error("budget-rejected-card");
  let expensiveCalls = 0;
  const expensive = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: REFINE,
    outPath: path.join(os.tmpdir(), "kutadgu-eval-expensive.json"),
    fetchImpl: async () => {
      expensiveCalls += 1;
      return jsonResponse({
        output_text: JSON.stringify({ mode: "clarify", message: "بۇ سوئال ئۈچۈن قىسقا جاۋاب بېرىمەن.", book_ids: [] }),
        usage: { input_tokens: 490000, output_tokens: 1 }
      });
    }
  });
  if (expensive.completed !== 1) throw new Error("expensive-turns-" + expensive.completed);
  if (expensiveCalls !== 1) throw new Error("expensive-extra-" + expensiveCalls);
  if (!expensive.results.some((row) => row.stopped === "local-cap")) throw new Error("expensive-stop");
  const expensiveFile = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kutadgu-eval-expensive.json"), "utf8"));
  if (expensiveFile.completed !== 1 || expensiveFile.openaiRequests !== 1) throw new Error("expensive-file");
  let toolCalls = 0;
  const toolUsages = [
    { input_tokens: 1000, output_tokens: 20 },
    { input_tokens: 2000, output_tokens: 30 },
    { input_tokens: 100, output_tokens: 40 }
  ];
  const tool = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: [{ id: "tool", q: "بالام 7 ياش، ھېكايە ئوقۇشنى ياخشى كۆرىدۇ." }],
    fetchImpl: async () => {
      const usage = toolUsages[Math.min(toolCalls, toolUsages.length - 1)];
      toolCalls += 1;
      if (toolCalls === 1) {
        return jsonResponse({
          output: [{ type: "function_call", name: "lookup_catalog_books", call_id: "call-1", arguments: "{\"book_ids\":[501]}" }],
          usage
        });
      }
      return jsonResponse({
        output_text: JSON.stringify({ mode: "recommend", message: "يەتتە ياش ھېكايىلىرى ماس كېلىدۇ.", book_ids: [501] }),
        usage
      });
    }
  });
  const expectedTool = Advisor.usageMicroUsd({ input_tokens: 3100, output_tokens: 90 });
  if (tool.openaiRequests !== 3 || tool.spentMicroUsd !== expectedTool) {
    throw new Error("tool-charge-" + tool.openaiRequests + "-" + tool.spentMicroUsd + "-" + expectedTool);
  }
  let failedCalls = 0;
  const failed = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: [
      { id: "fail", q: "بالام 7 ياش، ھېكايە كىتابى." },
      { id: "after-fail", q: "داۋام قىلىڭ." }
    ],
    fetchImpl: async () => {
      failedCalls += 1;
      return new Response("no", { status: 500, headers: { "content-type": "text/plain" } });
    }
  });
  if (failedCalls !== 1 || failed.spentMicroUsd !== hold || failed.completed !== 0) {
    throw new Error("failed-cost-" + failedCalls + "-" + failed.spentMicroUsd);
  }
  let missingCalls = 0;
  const missing = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: [
      { id: "missing", q: "بالام 7 ياش، ھېكايە كىتابى." },
      { id: "after-missing", q: "داۋام قىلىڭ." }
    ],
    fetchImpl: async () => {
      missingCalls += 1;
      return jsonResponse({
        output_text: JSON.stringify({ mode: "clarify", message: "بۇ سوئال ئۈچۈن قىسقا جاۋاب بېرىمەن.", book_ids: [] })
      });
    }
  });
  if (missingCalls !== 1 || missing.spentMicroUsd !== hold || missing.results[0].conservative !== true) throw new Error("missing-usage-free");
  let recommendCalls = 0;
  const omitted = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: [
      { id: "omit-usage", q: "بالام 7 ياش، ھېكايە ئوقۇشنى ياخشى كۆرىدۇ." },
      { id: "after-omit", q: "داۋام قىلىڭ." }
    ],
    outPath: path.join(os.tmpdir(), "kutadgu-eval-omitted-usage.json"),
    fetchImpl: async () => {
      recommendCalls += 1;
      return jsonResponse({
        output_text: JSON.stringify({ mode: "recommend", message: "يەتتە ياش ھېكايىلىرى ماس كېلىدۇ.", book_ids: [501] })
      });
    }
  });
  const selectionReserve = Advisor.estimateRequestMicroUsd(Math.ceil(catalog.chars) + 800, 500);
  if (recommendCalls !== 1 || omitted.openaiRequests !== 1 || omitted.spentMicroUsd !== hold || omitted.results[0].conservative !== true) {
    throw new Error("omitted-usage-" + recommendCalls + "-" + omitted.openaiRequests + "-" + omitted.spentMicroUsd);
  }
  if (!(hold > selectionReserve) || omitted.spentMicroUsd === selectionReserve) throw new Error("omitted-usage-partial-charge");
  const omittedFile = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kutadgu-eval-omitted-usage.json"), "utf8"));
  if (omittedFile.openaiRequests !== 1 || omittedFile.results[0].conservative !== true) throw new Error("omitted-usage-file");
  let toolGapCalls = 0;
  const toolGap = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: [
      { id: "tool-gap", q: "بالام 7 ياش، ھېكايە ئوقۇشنى ياخشى كۆرىدۇ." },
      { id: "after-tool-gap", q: "داۋام قىلىڭ." }
    ],
    fetchImpl: async () => {
      toolGapCalls += 1;
      if (toolGapCalls === 1) {
        return jsonResponse({
          output: [{ type: "function_call", name: "lookup_catalog_books", call_id: "call-gap", arguments: "{\"book_ids\":[501]}" }],
          usage: { input_tokens: 30, output_tokens: 8 }
        });
      }
      return jsonResponse({
        output_text: JSON.stringify({ mode: "recommend", message: "يەتتە ياش ھېكايىلىرى ماس كېلىدۇ.", book_ids: [501] })
      });
    }
  });
  if (toolGapCalls !== 2 || toolGap.spentMicroUsd !== hold || toolGap.results[0].conservative !== true) {
    throw new Error("tool-gap-" + toolGapCalls + "-" + toolGap.spentMicroUsd);
  }
  let rejectedCalls = 0;
  const rejected = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: [
      { id: "reject", q: "بالام 7 ياش، ھېكايە كىتابى." },
      { id: "after-reject", q: "داۋام قىلىڭ." }
    ],
    fetchImpl: async () => {
      rejectedCalls += 1;
      throw new Error("network down");
    }
  });
  if (rejectedCalls !== 1 || rejected.openaiRequests !== 1 || rejected.spentMicroUsd !== hold || rejected.results[0].conservative !== true || rejected.results[0].failure !== "fetch-failed") {
    throw new Error("fetch-reject-" + rejectedCalls + "-" + rejected.spentMicroUsd + "-" + (rejected.results[0] && rejected.results[0].failure));
  }
  let abortedCalls = 0;
  const aborted = await runBoundedConversation({
    secret: crypto.randomBytes(32).toString("hex"),
    catalog,
    apiKey: "test-key",
    cap,
    hold,
    now,
    plan: [
      { id: "abort", q: "بالام 7 ياش، ھېكايە كىتابى." },
      { id: "after-abort", q: "داۋام قىلىڭ." }
    ],
    fetchImpl: async () => {
      abortedCalls += 1;
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }
  });
  if (abortedCalls !== 1 || aborted.openaiRequests !== 1 || aborted.spentMicroUsd !== hold || aborted.results[0].conservative !== true || aborted.results[0].failure !== "aborted") {
    throw new Error("abort-" + abortedCalls + "-" + aborted.spentMicroUsd);
  }
  if (failed.results[0].conservative !== true || failed.results[0].apiCalls !== 1 || failed.results[0].failure !== "http-500") {
    throw new Error("http-failure-record");
  }
}

async function runPaidConsistency(options) {
  console.log(JSON.stringify({
    worstCaseMicroUsd: options.hold,
    capMicroUsd: options.cap,
    firstTurnFits: options.hold <= options.cap,
    fiveTurnWorstCaseFits: options.hold * options.plan.length <= options.cap
  }));
  const summary = await runBoundedConversation({
    catalog: options.catalog,
    apiKey: options.apiKey,
    cap: options.cap,
    hold: options.hold,
    plan: options.plan,
    outPath: options.outPath,
    fetchImpl: async (url, init) => global.fetch(url, init)
  });
  for (const row of summary.results) {
    console.log(JSON.stringify({
      id: row.id,
      stopped: row.stopped || "",
      ms: row.ms,
      micro: row.actualMicroUsd,
      books: (row.books || []).length,
      apiCalls: row.apiCalls || 0
    }));
  }
  if (summary.spentMicroUsd > options.cap) process.exit(3);
}

function semanticKeyReady(value) {
  const key = String(value || "");
  return key.startsWith("sb_" + "secret_") && key.length >= 20;
}

function acceptanceLiveDecision(input) {
  const turns = Math.max(0, Math.floor(Number(input && input.turns) || 0));
  const suiteMicroUsd = Math.max(0, Math.floor(Number(input && input.hold) || 0)) * turns;
  const charged = Math.max(0, Math.floor(Number(input && input.charged) || 0));
  const reserved = Math.max(0, Math.floor(Number(input && input.reserved) || 0));
  const requiredAggregateMicroUsd = charged + reserved + suiteMicroUsd;
  const blockers = [];
  if (!input || input.ledgerPresent !== true) blockers.push("ledger-missing");
  if (input && input.halted === true) blockers.push("ledger-halted");
  if (input && input.locked === true) blockers.push("ledger-locked");
  if (!input || input.semanticReady !== true) blockers.push("semantic-unavailable");
  if (!input || !input.key || String(input.key).length < 20) blockers.push("evaluation-key-missing");
  if (input && input.ledgerPresent === true && requiredAggregateMicroUsd > Number(input.cap)) blockers.push("evaluation-unbounded");
  return {
    action: blockers.length ? "stop" : "run",
    blockers,
    code: blockers[0] || "",
    suiteMicroUsd,
    requiredAggregateMicroUsd,
    openaiRequests: 0,
    quality: "NOT RUN"
  };
}

function acquireLedgerLock(ledgerFile) {
  const lockFile = ledgerFile + ".lock";
  if (fs.existsSync(lockFile)) {
    let owner = 0;
    try { owner = Math.floor(Number(JSON.parse(fs.readFileSync(lockFile, "utf8")).pid)); } catch (_error) { owner = 0; }
    let alive = false;
    if (owner > 0) {
      try { process.kill(owner, 0); alive = true; } catch (error) { alive = error && error.code === "EPERM"; }
    }
    if (alive || owner <= 0) {
      const error = new Error("ledger-locked");
      error.code = "ledger-locked";
      throw error;
    }
    fs.unlinkSync(lockFile);
  }
  let fd;
  try { fd = fs.openSync(lockFile, "wx"); } catch (error) {
    const locked = new Error("ledger-locked");
    locked.code = "ledger-locked";
    throw locked;
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return function releaseLedgerLock() {
    try { fs.closeSync(fd); } catch (_error) { /* already closed */ }
    try { fs.unlinkSync(lockFile); } catch (_error) { /* already released */ }
  };
}

function publicEvidence(value) {
  const hidden = /^(authorization|apikey|api_key|secretkey|hashsecret|password)$/i;
  return JSON.parse(redact(JSON.stringify(value, (key, item) => hidden.test(key) ? "[redacted]" : item)));
}

function trackPaidFetch(events, calls, fetchImpl) {
  return async function tracked(url, init) {
    const attempt = {
      at: new Date().toISOString(),
      url: redact(String(url || "")),
      kind: String(url).includes("/embeddings") ? "embedding" : (String(url).includes("/responses") ? "responses" : "other"),
      input: null,
      usage: null,
      output: "",
      error: "",
      status: 0
    };
    try {
      const body = JSON.parse(init && init.body || "{}");
      attempt.input = Object.prototype.hasOwnProperty.call(body, "input") ? body.input : null;
      if (Array.isArray(body.tools)) attempt.tools = body.tools.map((tool) => tool && tool.name).filter(Boolean);
    } catch (_error) {
      attempt.error = "request-unreadable";
    }
    calls.push(attempt);
    if (typeof events.onAttempt === "function") events.onAttempt();
    events.contacted = true;
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      events.failed = true;
      events.uncertain = true;
      attempt.error = error && error.name === "AbortError" ? "aborted" : "fetch-failed";
      throw error;
    }
    attempt.status = Number(response && response.status) || 0;
    let payload = null;
    try { payload = await response.clone().json(); } catch (_error) { payload = null; }
    const embedding = String(url).includes("/embeddings");
    const reported = payload && payload.usage ? Number(payload.usage.prompt_tokens != null ? payload.usage.prompt_tokens : payload.usage.total_tokens) : NaN;
    if (embedding) {
      attempt.usage = payload && payload.usage ? { prompt_tokens: payload.usage.prompt_tokens, total_tokens: payload.usage.total_tokens } : null;
      if (!response.ok || !Number.isInteger(Math.floor(reported)) || reported < 1) {
        events.failed = true;
        events.uncertain = true;
        events.missingUsage = response.ok || !payload;
        attempt.error = response.ok ? "usage-unavailable" : "http-" + attempt.status;
        const failure = new Error(attempt.error);
        failure.code = "advisor_model_unavailable";
        throw failure;
      }
      if (reported > Advisor.MEANING_TOKEN_CAP) {
        events.failed = true;
        events.uncertain = true;
        attempt.error = "embedding-unbounded";
        attempt.tokens = Math.floor(reported);
        const failure = new Error("advisor_embedding_unbounded");
        failure.code = "advisor_embedding_unbounded";
        failure.tokens = Math.floor(reported);
        throw failure;
      }
      return response;
    }
    if (!response.ok || !billableUsage(payload)) {
      events.failed = true;
      events.uncertain = true;
      events.missingUsage = response.ok || !payload;
      attempt.error = response.ok ? "usage-unavailable" : "http-" + attempt.status;
      attempt.output = payload && payload.output_text || "";
      const failure = new Error(attempt.error);
      failure.code = "advisor_model_unavailable";
      throw failure;
    }
    attempt.usage = payload.usage;
    attempt.output = payload.output_text || "";
    const outputCalls = ((payload && payload.output) || []).filter((item) => item && item.type === "function_call");
    if (outputCalls.length) {
      attempt.toolCalls = outputCalls.map((item) => ({ name: item.name, arguments: item.arguments, call_id: item.call_id }));
    }
    return response;
  };
}

function readLedgerSummary(file) {
  if (!file || !fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const reserved = (state.openReservations || []).reduce((sum, row) => sum + (Math.floor(row && row.microUsd) || 0), 0);
  return {
    chargedMicroUsd: state.chargedMicroUsd,
    capMicroUsd: state.capMicroUsd,
    reservedMicroUsd: reserved,
    remainingMicroUsd: state.capMicroUsd - state.chargedMicroUsd - reserved,
    halted: state.halted === true
  };
}

function openPersistentEvalLedger(file) {
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const started = state.chargedMicroUsd;
  if (!Number.isInteger(started) || !Number.isInteger(state.capMicroUsd) || started > state.capMicroUsd) {
    throw new Error("ledger-unreadable");
  }
  function persist() {
    if (!Number.isInteger(state.chargedMicroUsd) || state.chargedMicroUsd < started) throw new Error("ledger-decreased");
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  }
  const inner = Budget.createLedger({
    dailyLimitMicroUsd: state.capMicroUsd,
    monthlyLimitMicroUsd: state.capMicroUsd,
    perMinute: Math.max(Budget.DEFAULT_PER_MINUTE, Acceptance.CASES.length)
  });
  const seedHash = crypto.createHash("sha256").update("kutadgu-preview-seed|" + state.revision).digest("hex");
  const seedNow = new Date();
  let ready = Promise.resolve();
  if (started > 0) {
    ready = inner.reserve({ clientHash: seedHash, microUsd: started, now: seedNow }).then((row) => inner.settle(row.id, started));
  }
  ready = (state.openReservations || []).reduce((chain, row) => chain.then(() => inner.reserve({
    clientHash: seedHash,
    microUsd: row.microUsd,
    now: seedNow
  })), ready);
  return {
    ready,
    reserve(input) {
      return ready.then(() => inner.reserve(input).then((row) => {
        state.openReservations.push({ id: row.id, microUsd: Math.floor(input.microUsd) });
        persist();
        return row;
      }));
    },
    settle(id, actualMicroUsd) {
      return ready.then(() => inner.settle(id, actualMicroUsd).then((settled) => {
        const index = state.openReservations.findIndex((row) => row.id === id);
        if (index < 0) throw new Error("ledger-reservation-missing");
        state.openReservations.splice(index, 1);
        state.chargedMicroUsd += settled.actualMicroUsd;
        persist();
        return settled;
      }));
    },
    release(id) {
      return ready.then(() => inner.release(id).then((released) => {
        const index = state.openReservations.findIndex((row) => row.id === id);
        if (index < 0) throw new Error("ledger-reservation-missing");
        state.openReservations.splice(index, 1);
        persist();
        return released;
      }));
    },
    halt(reason) {
      return ready.then(() => {
        state.halted = true;
        state.haltReason = String(reason || "uncertain-charge");
        persist();
        return { halted: true };
      });
    }
  };
}

async function runAcceptance() {
  const hold = Advisor.worstCaseMicroUsd({ chars: 100875 });
  const turns = Acceptance.CASES.length;
  const suiteMicroUsd = hold * turns;
  let ledger = null;
  const ledgerPath = path.join(process.env.LOCALAPPDATA || "", "kutadgu-book-advisor-preview", "state.json");
  if (ledgerPath && fs.existsSync(ledgerPath)) {
    const state = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    const reserved = (state.openReservations || []).reduce((sum, row) => sum + (row.microUsd || 0), 0);
    ledger = {
      chargedMicroUsd: state.chargedMicroUsd,
      capMicroUsd: state.capMicroUsd,
      reservedMicroUsd: reserved,
      remainingMicroUsd: state.capMicroUsd - state.chargedMicroUsd - reserved,
      halted: state.halted === true
    };
  }
  const catalog = Advisor.buildCatalog([
    { id: 1, title: "قىسقا ھېكايە", author: "نەشر", category: "بالىلار كىتابلىرى", price: 20, description: "قىسقا", is_active: true, submission_status: "approved" }
  ]);
  const rows = [];
  let system = "";
  const history = new Map();
  for (const item of Acceptance.CASES) {
    const transcript = [];
    const prior = history.get(item.thread) || [];
    const threadTurns = Acceptance.conversationTurns(prior, item.customer);
    const result = await Advisor.advise({
      catalog,
      apiKey: "test-key",
      budget: Advisor.createBudget(hold),
      turns: threadTurns,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        transcript.push(body.input);
        if (!system) system = body.input[0].content;
        return jsonResponse({
          output_text: JSON.stringify({ mode: "explain", message: "بۇ سوئالغا قىسقا جاۋاب بېرىمەن.", book_ids: [] }),
          usage: { input_tokens: 20, output_tokens: 8 }
        });
      }
    });
    const packed = JSON.stringify(transcript);
    const reply = String(result.message || "");
    rows.push({
      id: item.id,
      group: item.group,
      heldOut: item.heldOut === true,
      customer: item.customer,
      deterministic: {
        customer_reached_model: packed.includes(item.customer) ? "PASS" : "FAIL",
        no_secret_in_reply: reply.includes("sk-") || reply.includes("05368999888") ? "FAIL" : "PASS"
      },
      quality: "NOT RUN",
      rubric: Acceptance.RUBRIC.map((item) => ({ id: item.id, result: "NOT RUN" })),
      reply,
      evidence: result.evidence || "",
      context: threadTurns.map((turn) => ({ role: turn.role, content: turn.content })),
      toolCalls: transcript.length
    });
    history.set(item.thread, threadTurns.concat([{ role: "assistant", content: result.message }]));
  }
  const held = Acceptance.CASES.filter((item) => item.heldOut);
  const heldOutPrompt = held.every((item) => !system.includes(item.customer)) ? "PASS" : "FAIL";
  const deterministicFailed = rows.filter((row) => Object.values(row.deterministic).includes("FAIL"));
  const report = {
    kind: "advisor-acceptance-wiring",
    paid: false,
    cases: rows.length,
    heldOut: held.length,
    heldOutAbsentFromPrompt: heldOutPrompt,
    retrieval: "server-match-active-books-ai",
    semantic: "Meaning search calls match_active_books_ai from the advisor worker with the worker's existing server key. A topic without that key is unavailable and is not a substring match. This wiring run does not score live replies.",
    worstCaseMicroUsd: hold,
    suiteMicroUsd,
    suiteFitsRemaining: ledger ? suiteMicroUsd <= ledger.remainingMicroUsd : null,
    ledger,
    quality: "NOT RUN",
    deterministicFailed: deterministicFailed.map((row) => row.id),
    rows
  };
  const outPath = path.join(os.tmpdir(), "kutadgu-advisor-acceptance.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    cases: report.cases,
    heldOut: report.heldOut,
    heldOutAbsentFromPrompt: heldOutPrompt,
    deterministicFailed: report.deterministicFailed,
    worstCaseMicroUsd: hold,
    suiteMicroUsd,
    remainingMicroUsd: ledger ? ledger.remainingMicroUsd : null,
    quality: "NOT RUN",
    report: outPath
  }));
  const age = rows.find((row) => row.id === "age-change");
  const child = Acceptance.CASES.find((item) => item.id === "child");
  const continued = age && age.context.some((turn) => turn.content === child.customer) && age.context.some((turn) => turn.role === "assistant");
  const blocked = acceptanceLiveDecision({
    ledgerPresent: true,
    halted: false,
    locked: false,
    semanticReady: true,
    key: "x".repeat(24),
    charged: 400,
    reserved: 10,
    cap: 1000,
    hold,
    turns
  });
  const missingMeaning = acceptanceLiveDecision({
    ledgerPresent: true,
    semanticReady: false,
    key: "x".repeat(24),
    charged: 1,
    reserved: 0,
    cap: 999999999,
    hold: 1,
    turns: 1
  });
  const ledgerFile = path.join(os.tmpdir(), "kutadgu-advisor-ledger-check.json");
  fs.writeFileSync(ledgerFile, JSON.stringify({
    revision: "ledger-check",
    capMicroUsd: 1000,
    priorMicroUsd: 100,
    chargedMicroUsd: 400,
    openReservations: [],
    halted: false,
    haltReason: "",
    hashSecret: "ab".repeat(32),
    sessions: {}
  }));
  const persistent = openPersistentEvalLedger(ledgerFile);
  await persistent.ready;
  const reserved = await persistent.reserve({ clientHash: "cd".repeat(32), microUsd: 10, now: new Date() });
  await persistent.settle(reserved.id, 10);
  const persisted = readLedgerSummary(ledgerFile);
  if (heldOutPrompt !== "PASS" || deterministicFailed.length || rows.length !== 30 || held.length < 10 || !continued) {
    throw new Error("acceptance-deterministic");
  }
  if (blocked.action !== "stop" || blocked.openaiRequests !== 0 || blocked.code !== "evaluation-unbounded") {
    throw new Error("acceptance-live-preflight");
  }
  if (blocked.requiredAggregateMicroUsd !== 400 + 10 + hold * turns) throw new Error("required-aggregate");
  if (missingMeaning.code !== "semantic-unavailable" || missingMeaning.openaiRequests !== 0) throw new Error("semantic-preflight");
  if (!persisted || persisted.chargedMicroUsd !== 410 || persisted.chargedMicroUsd < 400) throw new Error("ledger-decreased");
  await verifyAcceptanceParity(hold);
  console.log("book-advisor-acceptance ok");
}

async function verifyAcceptanceParity(hold) {
  const secret = crypto.randomBytes(32).toString("hex");
  const ip = "203.0.113.40";
  const clientHash = Budget.clientHash(secret, ip);
  const ledger = Budget.createLedger({ dailyLimitMicroUsd: hold * 20, monthlyLimitMicroUsd: hold * 20, perMinute: 30 });
  const sessions = Budget.createSessionStore();
  const now = new Date("2026-11-09T00:00:00.000Z");
  const catalog = harnessCatalog();
  const thread = Acceptance.threadsOf(Acceptance.CASES).find((item) => item.id === "child");
  let history = [];
  let sessionId = "";
  let token = "";
  let signedAge = null;
  const requests = [];
  const modelInputs = [];
  for (const item of thread.cases) {
    const turns = Acceptance.conversationTurns(history, item.customer);
    const payload = { turns, session_id: sessionId, constraint_token: token };
    requests.push(payload);
    const events = { contacted: false, failed: false, uncertain: false, hold: 0 };
    const calls = [];
    const response = await Gate.handleBookAdvisor(new Request("https://www.kutadgubilik.com/api/book-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify(payload)
    }), {
      BOOK_ADVISOR_ENABLED: "true",
      BOOK_ADVISOR_CLIENT_HASH_SECRET: secret,
      OPENAI_API_KEY: "test-key",
      SUPABASE_SECRET_KEY: "sb_secret_fixture_value"
    }, {
      ledger: guardedLedger(ledger, events),
      sessions,
      now: () => now,
      loadCatalog: async () => catalog,
      fetchImpl: trackPaidFetch(events, calls, async () => jsonResponse({
        output_text: JSON.stringify({ mode: "explain", message: "بۇ سوئالغا قىسقا جاۋاب بېرىمەن.", book_ids: [] }),
        usage: { input_tokens: 20, output_tokens: 8 }
      }))
    });
    const body = await response.json();
    if (body.ok !== true) throw new Error("parity-" + item.id + "-" + (body.error || "failed"));
    if (!calls.length || calls[0].input == null) throw new Error("attempt-missing-" + item.id);
    modelInputs.push(JSON.stringify(calls[0].input));
    sessionId = body.session_id;
    token = body.constraint_token;
    const state = Budget.readConstraintState(secret, token, { clientHash, sessionId, now });
    if (item.id === "age-change") signedAge = state && state.age;
    history = turns.concat([{ role: "assistant", content: body.message || "" }]);
  }
  const last = requests[requests.length - 1];
  const lastInput = modelInputs[modelInputs.length - 1];
  if (!last.constraint_token || !last.session_id) throw new Error("token-not-carried");
  if (!signedAge || !lastInput.includes("reader_age: " + signedAge)) throw new Error("signed-age-dropped");
  if (lastInput.includes("تۆت ياشلىق")) throw new Error("window-still-has-first-age");
  const named = Acceptance.CASES.find((item) => item.id === "author-all");
  const series = Acceptance.CASES.find((item) => item.id === "series");
  const title = Acceptance.CASES.find((item) => item.id === "title");
  if (!named.customer.includes("ئابدۇرېھىم ئۆتكۈر") || !series.customer.includes("ئويغانغان زېمىن") || !title.customer.includes("ئويغانغان زېمىن 1")) {
    throw new Error("listing-entity-missing");
  }
  const lockDir = path.join(os.tmpdir(), "kutadgu-lock-" + Date.now());
  fs.mkdirSync(lockDir);
  const lockLedger = path.join(lockDir, "state.json");
  fs.writeFileSync(lockLedger, JSON.stringify({ chargedMicroUsd: 5, capMicroUsd: 10, openReservations: [], halted: false }));
  const release = acquireLedgerLock(lockLedger);
  let locked = false;
  try { acquireLedgerLock(lockLedger); } catch (error) { locked = error && error.code === "ledger-locked"; }
  release();
  if (!locked) throw new Error("ledger-lock");
  const evidenceFile = path.join(lockDir, "evidence.json");
  fs.writeFileSync(evidenceFile, JSON.stringify(publicEvidence({
    authorization: "Bearer secret-value",
    reply: "بۇ جاۋاب",
    embedding: { prompt_tokens: 4, micro_usd: 1 },
    books: [{ id: 156 }]
  })));
  const saved = fs.readFileSync(evidenceFile, "utf8");
  if (saved.includes("Bearer") || saved.includes("secret-value")) throw new Error("evidence-leaked");
  if (!saved.includes("بۇ جاۋاب") || !saved.includes("156")) throw new Error("evidence-dropped");
  const failedEvents = { contacted: false, failed: false, uncertain: false, missingUsage: false, hold: 0, settled: 0 };
  const failedCalls = [];
  let continued = false;
  try {
    await trackPaidFetch(failedEvents, failedCalls, async () => {
      throw new Error("socket-reset");
    })("https://api.openai.com/v1/embeddings", { method: "POST", headers: { Authorization: "Bearer test-key" }, body: JSON.stringify({ input: "ھايۋان" }) });
    continued = true;
  } catch (_error) { continued = false; }
  if (continued || !failedEvents.uncertain || !failedCalls.length || failedCalls[0].input !== "ھايۋان") throw new Error("failure-accounting");
  if (JSON.stringify(failedCalls).includes("Bearer") || JSON.stringify(failedCalls).includes("test-key")) throw new Error("attempt-leaked");
}

async function runAcceptanceLive() {
  const hold = Advisor.worstCaseMicroUsd({ chars: 100875 });
  const turns = Acceptance.CASES.length;
  const ledgerPath = path.join(process.env.LOCALAPPDATA || "", "kutadgu-book-advisor-preview", "state.json");
  const ledger = readLedgerSummary(ledgerPath);
  let locked = false;
  if (ledgerPath && fs.existsSync(ledgerPath + ".lock")) {
    try { acquireLedgerLock(ledgerPath)(); } catch (error) { locked = error && error.code === "ledger-locked"; }
  }
  const serverKey = process.env.SUPABASE_SECRET_KEY;
  const decision = acceptanceLiveDecision({
    ledgerPresent: !!ledger,
    halted: ledger ? ledger.halted : false,
    locked,
    semanticReady: semanticKeyReady(serverKey),
    key: process.env[KEY_NAME],
    charged: ledger ? ledger.chargedMicroUsd : 0,
    reserved: ledger ? ledger.reservedMicroUsd : 0,
    cap: ledger ? ledger.capMicroUsd : 0,
    hold,
    turns
  });
  const outDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "kutadgu-book-advisor-eval");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "acceptance-live-" + Date.now() + ".json");
  const summary = {
    kind: "advisor-acceptance-live",
    action: decision.action,
    code: decision.code || "",
    blockers: decision.blockers,
    openaiRequests: 0,
    quality: "NOT RUN",
    rubric: Acceptance.RUBRIC,
    worstCaseMicroUsd: hold,
    suiteReserveMicroUsd: decision.suiteMicroUsd,
    requiredAggregateMicroUsd: decision.requiredAggregateMicroUsd,
    chargedMicroUsd: ledger ? ledger.chargedMicroUsd : null,
    reservedMicroUsd: ledger ? ledger.reservedMicroUsd : null,
    capMicroUsd: ledger ? ledger.capMicroUsd : null,
    halted: ledger ? ledger.halted : null,
    rows: []
  };
  function flush() {
    fs.writeFileSync(outPath, JSON.stringify(publicEvidence(summary), null, 2));
  }
  flush();
  console.log(JSON.stringify(publicEvidence({
    action: summary.action,
    code: summary.code,
    blockers: summary.blockers,
    openaiRequests: 0,
    quality: summary.quality,
    suiteReserveMicroUsd: summary.suiteReserveMicroUsd,
    requiredAggregateMicroUsd: summary.requiredAggregateMicroUsd,
    chargedMicroUsd: summary.chargedMicroUsd,
    reservedMicroUsd: summary.reservedMicroUsd,
    capMicroUsd: summary.capMicroUsd,
    report: outPath
  })));
  if (decision.action !== "run") {
    console.log("book-advisor-acceptance-live not-run");
    process.exit(decision.code === "evaluation-key-missing" ? 2 : 4);
  }
  const release = acquireLedgerLock(ledgerPath);
  try {
    const apiKey = String(process.env[KEY_NAME] || "");
    const config = fs.readFileSync(path.join(__dirname, "..", "supabase-config.js"), "utf8");
    const publicKey = (config.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0] || "";
    const catalog = await Advisor.loadReadOnlyCatalog(global.fetch, "https://fxlojnqwyojqjskfggmh.supabase.co", publicKey);
    const persistent = openPersistentEvalLedger(ledgerPath);
    await persistent.ready;
    const sessions = Budget.createSessionStore();
    const state = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    let stopped = false;
    for (const thread of Acceptance.threadsOf(Acceptance.CASES)) {
      if (stopped) break;
      let history = [];
      let sessionId = "";
      let token = "";
      for (const item of thread.cases) {
        const room = readLedgerSummary(ledgerPath);
        if (!room || room.halted || room.remainingMicroUsd < hold) {
          summary.rows.push({ id: item.id, quality: "NOT RUN", stopped: room && room.halted ? "ledger-halted" : "ledger-room" });
          flush();
          stopped = true;
          break;
        }
        const threadTurns = Acceptance.conversationTurns(history, item.customer);
        const events = { contacted: false, failed: false, uncertain: false, missingUsage: false, hold: 0, settled: 0 };
        const calls = [];
        events.onAttempt = flush;
        const started = Date.now();
        let body = null;
        try {
          const response = await Gate.handleBookAdvisor(new Request("https://www.kutadgubilik.com/api/book-advisor", {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": "127.0.0.1" },
            body: JSON.stringify({ turns: threadTurns, session_id: sessionId, constraint_token: token })
          }), {
            BOOK_ADVISOR_ENABLED: "true",
            BOOK_ADVISOR_CLIENT_HASH_SECRET: state.hashSecret,
            OPENAI_API_KEY: apiKey,
            SUPABASE_PUBLISHABLE_KEY: publicKey,
            SUPABASE_SECRET_KEY: serverKey
          }, {
            ledger: guardedLedger(persistent, events),
            sessions,
            loadCatalog: async () => catalog,
            fetchImpl: trackPaidFetch(events, calls, global.fetch)
          });
          body = await response.json();
        } catch (error) {
          body = { ok: false, error: error && error.code || "advisor_model_unavailable" };
        }
        summary.openaiRequests += calls.filter((call) => call.kind === "responses" || call.kind === "embedding").length;
        const row = {
          id: item.id,
          thread: thread.id,
          customer: item.customer,
          context: threadTurns.map((turn) => ({ role: turn.role, content: turn.content })),
          constraintCarried: token.length > 0,
          attempts: calls.map((call) => ({
            kind: call.kind,
            url: call.url,
            input: call.input,
            toolCalls: call.toolCalls || [],
            usage: call.usage,
            output: call.output,
            error: call.error,
            status: call.status
          })),
          reply: body && body.message || "",
          bookIds: ((body && body.books) || []).map((book) => book.id),
          handoff: body && body.handoff || null,
          evidence: body && body.evidence || "",
          error: body && body.ok === false ? body.error || "failed" : "",
          accounting: {
            hold: events.hold,
            settled: events.settled || 0,
            uncertain: events.uncertain === true,
            failed: events.failed === true,
            missingUsage: events.missingUsage === true
          },
          quality: "UNSCORED",
          rubric: Acceptance.RUBRIC.map((criterion) => ({ id: criterion.id, prompt: criterion.prompt, result: "UNSCORED" })),
          ms: Date.now() - started
        };
        summary.rows.push(row);
        summary.quality = "UNSCORED";
        flush();
        if (events.uncertain || events.failed || !body || body.ok !== true) {
          await persistent.halt(events.missingUsage ? "missing-usage" : (events.uncertain ? "uncertain-charge" : "turn-failed"));
          summary.halted = true;
          flush();
          stopped = true;
          break;
        }
        history = threadTurns.concat([{ role: "assistant", content: body.message || "" }]);
        if (body.session_id) sessionId = body.session_id;
        if (body.constraint_token) token = body.constraint_token;
      }
    }
    const after = readLedgerSummary(ledgerPath);
    summary.chargedMicroUsd = after ? after.chargedMicroUsd : summary.chargedMicroUsd;
    summary.reservedMicroUsd = after ? after.reservedMicroUsd : summary.reservedMicroUsd;
    summary.halted = after ? after.halted : summary.halted;
    flush();
    console.log(JSON.stringify({ report: outPath, quality: "UNSCORED", openaiRequests: summary.openaiRequests, chargedMicroUsd: summary.chargedMicroUsd }));
  } finally {
    release();
  }
}

async function main() {
  const phase = process.argv[2] || "";
  if (phase === "harness") {
    await runMockHarness();
    return;
  }
  if (phase === "acceptance") {
    await runAcceptance();
    return;
  }
  if (phase === "acceptance-live") {
    await runAcceptanceLive();
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
    if (hold > cap) {
      console.log("evaluation-unbounded");
      console.log(JSON.stringify({ worstCaseMicroUsd: hold, capMicroUsd: cap, openaiRequests: 0 }));
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

if (require.main === module) {
  main().catch((error) => {
    console.error(redact(error && error.message || "eval-failed"));
    process.exit(1);
  });
}

module.exports = { acceptanceLiveDecision, readLedgerSummary, openPersistentEvalLedger, acquireLedgerLock, semanticKeyReady };
