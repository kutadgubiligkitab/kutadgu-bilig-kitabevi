"use strict";

const Advisor = require("../kutadgu-book-advisor.js");
const Compare = require("../kutadgu-book-advisor-compare.js");
const Budget = require("../kutadgu-book-advisor-budget.js");

const HEADER = "x-kutadgu-book-advisor-test";
const MAX_BODY_BYTES = 8000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function disabled() {
  return json({ ok: false, error: "disabled" }, 503);
}

function advisorAccess(env, request) {
  if (String(env && env.BOOK_ADVISOR_ENABLED || "") === "true") return "public";
  const privateTest = String(env && env.BOOK_ADVISOR_PRIVATE_TEST_ENABLED || "") === "true";
  if (privateTest && tokenMatches(env && env.BOOK_ADVISOR_PRIVATE_TEST_TOKEN, request.headers.get(HEADER))) {
    return "private";
  }
  return "";
}

function tokenMatches(expected, provided) {
  const left = String(expected || "");
  const right = String(provided || "");
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function rememberedIds(books) {
  const ids = [];
  for (const card of Array.isArray(books) ? books : []) {
    const members = Array.isArray(card.member_ids) && card.member_ids.length ? card.member_ids : [card.id];
    for (const raw of members) {
      const id = Number(raw);
      if (Number.isInteger(id) && id > 0) ids.push(id);
    }
  }
  return ids;
}

function actualMicroUsd(result) {
  const usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
  for (const call of (result && result.usage && result.usage.calls) || []) {
    usage.input_tokens += Number(call.input_tokens) || 0;
    usage.cached_tokens += Number(call.cached_tokens) || 0;
    usage.output_tokens += Number(call.output_tokens) || 0;
  }
  if (usage.input_tokens + usage.output_tokens <= 0) return 0;
  return Advisor.usageMicroUsd(usage);
}

async function handleBookAdvisor(request, env, deps) {
  if (!advisorAccess(env, request)) return disabled();
  const source = deps || {};
  let ledger = source.ledger;
  let sessions = source.sessions;
  if (!ledger || !sessions) {
    try {
      const opened = Budget.createRpcStores({
        fetchImpl: source.fetchImpl || globalThis.fetch.bind(globalThis),
        supabaseUrl: "https://fxlojnqwyojqjskfggmh.supabase.co",
        apiKey: env && env.SUPABASE_SECRET_KEY
      });
      ledger = ledger || opened.ledger;
      sessions = sessions || opened.sessions;
    } catch (_error) {
      return json({ ok: false, error: "advisor_unconfigured" }, 503);
    }
  }
  if (!env || !env.OPENAI_API_KEY) return json({ ok: false, error: "advisor_unconfigured" }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }
  let body = null;
  try { body = JSON.parse(raw); } catch (_error) { body = null; }
  const turns = Advisor.boundConversation(body && body.turns);
  const question = turns[turns.length - 1];
  if (!question || question.role !== "user" || question.content.length < 2) {
    return json({ ok: false, error: "advisor_query" }, 400);
  }
  let hash = "";
  try {
    hash = Budget.clientHash(env.BOOK_ADVISOR_CLIENT_HASH_SECRET, request.headers.get("cf-connecting-ip"));
  } catch (_error) {
    return json({ ok: false, error: "advisor_unconfigured" }, 503);
  }
  const started = Date.now();
  let reservation = null;
  try {
    const catalog = source.loadCatalog
      ? await source.loadCatalog(env)
      : await Advisor.loadReadOnlyCatalog(
        source.fetchImpl || globalThis.fetch.bind(globalThis),
        "https://fxlojnqwyojqjskfggmh.supabase.co",
        env.SUPABASE_PUBLISHABLE_KEY
      );
    const now = source.now ? source.now() : new Date();
    const intent = Compare.followUpIntent(question.content);
    const priceOnly = intent === "cheapest" || intent === "dearest";
    const hold = priceOnly ? 1 : Advisor.worstCaseMicroUsd(catalog);
    reservation = await ledger.reserve({ clientHash: hash, microUsd: hold, now });
    const sessionKey = body && /^(?:[a-f0-9]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(String(body.session_id || ""))
      ? String(body.session_id)
      : "";
    const trustedBookIds = sessionKey ? await sessions.read(sessionKey, hash) : [];
    const result = await Advisor.advise({
      catalog,
      apiKey: env.OPENAI_API_KEY,
      budget: Advisor.createBudget(hold),
      turns,
      trustedBookIds,
      fetchImpl: source.fetchImpl || globalThis.fetch.bind(globalThis)
    });
    await ledger.settle(reservation.id, priceOnly ? 0 : actualMicroUsd(result));
    reservation = null;
    const ids = rememberedIds(result.books);
    let sessionId = sessionKey;
    if (!sessionId) sessionId = await sessions.create(hash, ids);
    else if (ids.length) await sessions.save(sessionId, hash, ids);
    return json({
      ok: true,
      message: result.message,
      books: result.books,
      handoff: result.handoff || null,
      evidence: result.evidence,
      verified: result.verified,
      comparison_status: result.comparison_status,
      session_id: sessionId,
      latency_ms: Date.now() - started
    }, 200);
  } catch (error) {
    if (reservation) {
      try { await ledger.release(reservation.id); } catch (_releaseError) { /* fail closed */ }
    }
    const code = error && error.code ? error.code : "advisor_unavailable";
    const status = code === "advisor_budget" || code === "advisor_rate_limit" || code === "advisor_query" ? 400 : 503;
    return json({ ok: false, error: code, latency_ms: Date.now() - started }, status);
  }
}

module.exports = { handleBookAdvisor };
