"use strict";

/**
 * Local-only advisor page. It does not deploy and it is not mounted on the Worker.
 * Without OPENAI_API_KEY it fails closed.
 * ADVISOR_MOCK=1 returns one verified fixture book and does not call OpenAI.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Advisor = require("../kutadgu-book-advisor.js");
const Budget = require("../kutadgu-book-advisor-budget.js");
const Compare = require("../kutadgu-book-advisor-compare.js");

const root = path.join(__dirname, "..");
const port = Number(process.env.ADVISOR_PORT || 4179);
const files = {
  "/book-advisor.html": "book-advisor.html",
  "/book-advisor.css": "book-advisor.css",
  "/kutadgu-book-advisor-ui.js": "kutadgu-book-advisor-ui.js"
};
const mockBooks = [
  {
    id: 106,
    title: "يۈزمىڭلىغان نېمە ئۈچۈن - تۇرمۇش ساۋاتلىرى",
    author: "لىن چىڭ",
    category: "بالىلار كىتابلىرى",
    price: 20,
    image_url: "https://www.kutadgubilik.com/kutadgu-logo.webp",
    is_active: true,
    submission_status: "approved"
  }
];
const hashSecret = crypto.randomBytes(32).toString("hex");
let catalogPromise = null;
let stores = null;

function advisorStores() {
  if (!stores) {
    stores = Budget.createRpcStores({
      fetchImpl: global.fetch,
      supabaseUrl: "https://fxlojnqwyojqjskfggmh.supabase.co",
      apiKey: process.env.SUPABASE_SECRET_KEY || ""
    });
  }
  return stores;
}

function catalogForRequest() {
  if (process.env.ADVISOR_MOCK === "1") return Promise.resolve(Advisor.buildCatalog(mockBooks));
  if (!catalogPromise) {
    catalogPromise = Advisor.loadReadOnlyCatalog(
      global.fetch,
      "https://fxlojnqwyojqjskfggmh.supabase.co",
      process.env.SUPABASE_PUBLISHABLE_KEY || ""
    ).catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function mockResult(catalog) {
  const book = catalog.byId.get(106) || catalog.byId.values().next().value;
  return {
    ok: true,
    model: "mock",
    catalog_version: catalog.version,
    message: book.title + " دۇكىنىمىزدا بار.",
    books: Advisor.presentSelection([book.id], catalog),
    session_id: "ab".repeat(16)
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/book-advisor.html")) {
    send(res, 200, fs.readFileSync(path.join(root, files["/book-advisor.html"])), "text/html; charset=utf-8");
    return;
  }
  if (req.method === "GET" && files[url.pathname]) {
    const file = files[url.pathname];
    const type = file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    send(res, 200, fs.readFileSync(path.join(root, file)), type);
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/api/book-advisor") {
    send(res, 404, JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }
  const raw = await new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  if (Buffer.byteLength(raw) > 8000) {
    send(res, 413, JSON.stringify({ ok: false, error: "payload_too_large" }));
    return;
  }
  let body = null;
  try { body = JSON.parse(raw); } catch (_error) { body = null; }
  let reservation = null;
  let ledger = null;
  try {
    const catalog = await catalogForRequest();
    const turns = Advisor.boundConversation(body && body.turns);
    if (!turns.length) {
      send(res, 400, JSON.stringify({ ok: false, error: "advisor_query" }));
      return;
    }
    if (process.env.ADVISOR_MOCK === "1") {
      send(res, 200, JSON.stringify(mockResult(catalog)));
      return;
    }
    if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_SECRET_KEY) {
      send(res, 503, JSON.stringify({ ok: false, error: "advisor_unconfigured" }));
      return;
    }
    const storesForRequest = advisorStores();
    ledger = storesForRequest.ledger;
    const sessions = storesForRequest.sessions;
    const client = Budget.clientHash(hashSecret, req.socket.remoteAddress || "");
    const intent = Compare.followUpIntent(turns[turns.length - 1].content);
    const priceOnly = intent === "cheapest" || intent === "dearest";
    const hold = priceOnly ? 1 : Advisor.worstCaseMicroUsd(catalog);
    reservation = await ledger.reserve({ clientHash: client, microUsd: hold, now: new Date() });
    const sessionKey = body && /^(?:[a-f0-9]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(String(body.session_id || "")) ? String(body.session_id) : "";
    const trustedBookIds = sessionKey ? await sessions.read(sessionKey, client) : [];
    const result = await Advisor.advise({
      catalog,
      apiKey: process.env.OPENAI_API_KEY,
      budget: Advisor.createBudget(hold),
      turns,
      trustedBookIds,
      fetchImpl: global.fetch
    });
    const usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
    for (const call of (result.usage && result.usage.calls) || []) {
      usage.input_tokens += Number(call.input_tokens) || 0;
      usage.cached_tokens += Number(call.cached_tokens) || 0;
      usage.output_tokens += Number(call.output_tokens) || 0;
    }
    await ledger.settle(reservation.id, priceOnly ? 0 : Advisor.usageMicroUsd(usage));
    const ids = (result.books || []).map((book) => book.id);
    const sessionId = sessionKey || await sessions.create(client, ids);
    if (sessionKey && ids.length) await sessions.save(sessionId, client, ids);
    send(res, 200, JSON.stringify({
      ok: true,
      message: result.message,
      books: result.books,
      evidence: result.evidence,
      verified: result.verified,
      comparison_status: result.comparison_status,
      session_id: sessionId
    }));
  } catch (error) {
    if (reservation) {
      try { await ledger.release(reservation.id); } catch (_releaseError) { /* fail closed */ }
    }
    const code = error && error.code || "advisor_unavailable";
    const status = code === "advisor_budget" || code === "advisor_rate_limit" || code === "advisor_query" ? 400 : 503;
    send(res, status, JSON.stringify({ ok: false, error: code }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("book advisor local http://127.0.0.1:" + port + "/book-advisor.html");
});
