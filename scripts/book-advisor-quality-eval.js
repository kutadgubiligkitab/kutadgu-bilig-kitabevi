"use strict";

/**
 * Local conversational-quality harness.
 * Uses OPENAI_EVAL_API_KEY only. It does not read Cloudflare or Supabase secrets.
 * Catalog reads use the public publishable key. Spending is a local allowance,
 * not the production ledger. GPT responses are never mocked.
 */

const fs = require("node:fs");
const path = require("node:path");
const Advisor = require("../kutadgu-book-advisor.js");

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

async function main() {
  const phase = process.argv[2] || "";
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
  const outPath = path.join(outDir, phase === "consistency" ? "quality-consistency.json" : phase === "refine" ? "quality-refine.json" : phase === "multi" ? "quality-multi.json" : "quality-results.json");
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
