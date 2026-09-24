#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Views = require("../kutadgu-book-views.js");

const root = path.join(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

let failed = 0;
const pending = [];
function test(name, fn) {
  pending.push({ name, fn });
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(String(key), String(value)); }
  };
}

function makeNode(tag, className) {
  const node = {
    tagName: String(tag || "").toUpperCase(),
    className: className || "",
    textContent: "",
    attrs: {},
    children: [],
    parentNode: null,
    ownerDocument: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    querySelector(sel) {
      if (sel === "h1") return this.children.find((c) => c.tagName === "H1") || null;
      if (sel === ".book-author") return this.children.find((c) => c.className === "book-author") || null;
      if (sel === ".book-view-count") return this.children.find((c) => c.className === "book-view-count") || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === ".book-view-count") return this.children.filter((c) => c.className === "book-view-count");
      return [];
    },
    after(el) {
      const parent = this.parentNode;
      const i = parent.children.indexOf(this);
      parent.children.splice(i + 1, 0, el);
      el.parentNode = parent;
    },
    appendChild(el) {
      this.children.push(el);
      el.parentNode = this;
      return el;
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
  };
  return node;
}

function makeInfo(withAuthor) {
  const doc = { createElement(tag) { return makeNode(tag); } };
  const info = makeNode("div", "book-detail-info");
  info.ownerDocument = doc;
  const h1 = makeNode("h1");
  h1.textContent = "كىتاب";
  info.appendChild(h1);
  if (withAuthor !== false) {
    const author = makeNode("div", "book-author");
    author.textContent = "ئاپتور";
    info.appendChild(author);
  }
  return info;
}

const sql = read("STAGE86_BOOK_VIEW_STATS.sql");
const apply = sql.split("READ-ONLY POST-CHECK")[0];
const shop = read("shop.js");
const stockSql = read("STAGE85_STOCK_STATUS_OVERRIDE.sql");
const shell = read("book-shell.html");
const helper = read("kutadgu-book-views.js");

test("total view count below 20 stays hidden", () => {
  assert.strictEqual(Views.THRESHOLD, 20);
  assert.strictEqual(Views.shouldShowTotalViews(0), false);
  assert.strictEqual(Views.shouldShowTotalViews(19), false);
  assert.strictEqual(Views.viewCountText(19), "");
  assert.strictEqual(Views.compactViewCountText(19), "");
  const info = makeInfo();
  assert.strictEqual(Views.mountViewCount(info, 19), null);
  assert.strictEqual(info.querySelector(".book-view-count"), null);
});

test("total view count = 20 is shown on the detail page", () => {
  assert.strictEqual(Views.shouldShowTotalViews(20), true);
  assert.strictEqual(Views.viewCountText(20), "👁 20 قېتىم كۆرۈلدى");
  const info = makeInfo();
  const el = Views.mountViewCount(info, 20);
  assert.ok(el);
  assert.strictEqual(el.textContent, "👁 20 قېتىم كۆرۈلدى");
});

test("total view count above 20 is shown", () => {
  assert.strictEqual(Views.shouldShowTotalViews(21), true);
  assert.strictEqual(Views.viewCountText(21), "👁 21 قېتىم كۆرۈلدى");
  assert.strictEqual(Views.viewCountText(1286), "👁 1,286 قېتىم كۆرۈلدى");
  const info = makeInfo();
  const el = Views.mountViewCount(info, 1286);
  assert.strictEqual(el.textContent, "👁 1,286 قېتىم كۆرۈلدى");
});

test("correct Uyghur text is rendered", () => {
  assert.strictEqual(Views.LABEL, "قېتىم كۆرۈلدى");
  assert.ok(Views.viewCountText(20).includes("قېتىم كۆرۈلدى"));
  const info = makeInfo(false);
  const el = Views.mountViewCount(info, 20);
  assert.strictEqual(el.getAttribute("dir"), "rtl");
});

test("book_view analytics stay available while detail engagement cools down for 3 hours", () => {
  const storage = memoryStorage();
  const sent = [];
  const engagement = [];
  const previous = global.KutadguAnalytics;
  global.KutadguAnalytics = {
    track(name, data) { engagement.push({ name, data }); }
  };
  const track = Views.wrapTrack(function (name, data) { sent.push({ name, data }); }, storage, function () { return 1_000_000; });
  track("book_view", { bookId: "361" });
  track("book_view", { bookId: "361" });
  track("book_view", { bookId: "361" });
  track("add_to_cart", { bookId: "361" });
  assert.deepStrictEqual(sent.map((row) => row.name), ["book_view", "book_view", "book_view", "add_to_cart"]);
  assert.deepStrictEqual(engagement.map((row) => row.name), [Views.DETAIL_EVENT]);
  global.KutadguAnalytics = previous;
});

test("opening a different book can send its own book_view and detail engagement", () => {
  const storage = memoryStorage();
  const sent = [];
  const engagement = [];
  const previous = global.KutadguAnalytics;
  global.KutadguAnalytics = {
    track(name, data) { engagement.push({ name, data }); }
  };
  const track = Views.wrapTrack(function (name, data) { sent.push({ name, data }); }, storage, function () { return 5_000; });
  track("book_view", { bookId: "361" });
  track("book_view", { bookId: "108" });
  track("add_to_cart", { bookId: "361" });
  assert.deepStrictEqual(sent.map((row) => row.name + ":" + row.data.bookId), [
    "book_view:361",
    "book_view:108",
    "add_to_cart:361"
  ]);
  assert.deepStrictEqual(engagement.map((row) => row.data.bookId), ["361", "108"]);
  assert.ok(engagement.every((row) => row.name === Views.DETAIL_EVENT));
  global.KutadguAnalytics = previous;
});

test("aggregate table contains total_views + unique_views", () => {
  assert.match(apply, /CREATE TABLE IF NOT EXISTS public\.book_view_stats/);
  assert.match(apply, /total_views bigint NOT NULL DEFAULT 0/);
  assert.match(apply, /unique_views bigint NOT NULL DEFAULT 0/);
  assert.match(apply, /CREATE TABLE IF NOT EXISTS private\.book_view_sessions/);
});

test("raw session IDs are not exposed publicly", () => {
  assert.match(apply, /GRANT SELECT \(book_id, total_views\) ON TABLE public\.book_view_stats TO anon, authenticated/);
  assert.doesNotMatch(apply, /GRANT SELECT ON TABLE public\.book_view_stats TO anon, authenticated/);
  assert.doesNotMatch(apply, /GRANT SELECT \([^\n]*unique_views/);
  assert.match(apply, /REVOKE ALL ON TABLE private\.book_view_sessions FROM anon/);
  assert.match(apply, /REVOKE ALL ON TABLE private\.book_view_sessions FROM authenticated/);
  assert.doesNotMatch(apply, /GRANT SELECT ON TABLE private\.book_view_sessions/);
  assert.doesNotMatch(apply, /GRANT SELECT[^\n]*analytics_events/);
  assert.match(apply, /session_hash text NOT NULL/);
  assert.match(apply, /v_hash := md5\(v_session\)/);
  const req = Views.buildStatsRequest("361", { url: "https://example.supabase.co", anonKey: "anon" });
  assert.match(req.url, /\/rest\/v1\/book_view_stats\?select=book_id,total_views&book_id=in\.\(361\)/);
  assert.doesNotMatch(req.url, /unique_views/);
  assert.doesNotMatch(req.url, /session/i);
  assert.doesNotMatch(req.url, /analytics_events/);
  assert.doesNotMatch(helper, /from\("analytics_events"\)/);
});

test("historical book_view data is backfilled without deleting analytics rows", () => {
  assert.match(apply, /INSERT INTO public\.book_view_stats/);
  assert.match(apply, /private\.kutadgu_resolve_analytics_book_id\(e\.book_id, e\.legacy_id\)/);
  assert.match(apply, /WHERE e\.event_name = 'book_view'/);
  assert.doesNotMatch(apply, /DELETE FROM public\.analytics_events/i);
  assert.doesNotMatch(apply, /UPDATE public\.analytics_events/i);
  assert.match(apply, /ON CONFLICT \(book_id\) DO UPDATE/);
  assert.match(apply, /GREATEST\(public\.book_view_stats\.total_views, EXCLUDED\.total_views\)/);
});

test("unrelated stock behavior remains untouched", () => {
  assert.doesNotMatch(apply, /stock_status/);
  assert.doesNotMatch(apply, /ALTER TABLE public\.books/);
  assert.doesNotMatch(apply, /public\.orders/);
  assert.match(stockSql, /CREATE OR REPLACE FUNCTION private\.kutadgu_orders_reject_manual_sold_out/);
  assert.match(shop, /if\(helper&&typeof helper\.storefrontStockInfo==="function"\)return helper\.storefrontStockInfo\(book\)/);
  assert.doesNotMatch(helper, /stock_status/);
});

test("SECURITY DEFINER helpers stay in private schema with empty search_path", () => {
  assert.match(apply, /CREATE SCHEMA IF NOT EXISTS private/);
  assert.match(apply, /CREATE OR REPLACE FUNCTION private\.kutadgu_apply_book_view\(\)/);
  assert.match(apply, /CREATE OR REPLACE FUNCTION private\.kutadgu_resolve_analytics_book_id\(p_book_id text, p_legacy_id text\)/);
  assert.match(apply, /SET search_path = ''/);
  assert.match(apply, /REVOKE ALL ON FUNCTION private\.kutadgu_apply_book_view\(\) FROM PUBLIC/);
  assert.match(apply, /REVOKE ALL ON FUNCTION private\.kutadgu_apply_book_view\(\) FROM anon/);
  assert.doesNotMatch(apply, /REVOKE ALL ON SCHEMA private/);
  assert.match(apply, /EXECUTE FUNCTION private\.kutadgu_apply_book_view\(\)/);
  assert.doesNotMatch(apply, /CREATE OR REPLACE FUNCTION public\.kutadgu_apply_book_view/);
});

test("failed or missing stats hide the counter and book page still renders", () => {
  assert.strictEqual(Views.parseTotalViews(null), null);
  assert.strictEqual(Views.parseTotalViews([]), null);
  assert.strictEqual(Views.parseTotalViews({}), null);
  const info = makeInfo();
  Views.mountViewCount(info, 80);
  assert.ok(info.querySelector(".book-view-count"));
  Views.hideViewCount(info);
  assert.strictEqual(info.querySelector(".book-view-count"), null);
  assert.strictEqual(info.querySelector("h1").textContent, "كىتاب");
});

test("book detail loads helper before analytics without changing frozen shop.js tracking", () => {
  const helperPin = 'src="/kutadgu-book-views.js?v=1"';
  const analyticsPin = 'src="/analytics.js?v=2"';
  assert.ok(shell.includes(helperPin));
  assert.ok(shell.includes(analyticsPin));
  assert.ok(shell.indexOf(helperPin) < shell.indexOf(analyticsPin));
  assert.match(shop, /function trackBookViewOnce\(book\)\{/);
  assert.match(shop, /if\(trackedBookViews\.has\(canonical\)\)return/);
});

test("stats fetch waits for validated detail hydration and decorates cards by id", () => {
  assert.match(helper, /isBookDetailDocument\(\)/);
  assert.match(helper, /document\.body\.dataset\.bookId/);
  assert.doesNotMatch(helper, /numericCleanBookIdFromLocation/);
  assert.doesNotMatch(helper, /parseBookIdFromLocation/);
  assert.doesNotMatch(helper, /function homeFeatureCard|function bookCardMarkup|function miniCard/);
  assert.match(helper, /data-live-book-id/);
  assert.doesNotMatch(apply, /most viewed|sales_count/i);
  const markup = shop.slice(shop.indexOf("function bookCardMarkup"), shop.indexOf("function searchResultCard"));
  assert.doesNotMatch(markup, /book-view-count/);
});

function matchesSelector(node, selector) {
  return String(selector || "").split(",").some((part) => {
    const sel = part.trim();
    if (!sel) return false;
    if (sel.charAt(0) === ".") return String(node.className || "").split(/\s+/).includes(sel.slice(1));
    const attr = sel.match(/^\[([^\]=]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]$/);
    if (!attr || typeof node.getAttribute !== "function") return false;
    const value = node.getAttribute(attr[1]);
    if (value == null) return false;
    const expected = attr[2] != null ? attr[2] : attr[3];
    return expected == null ? true : value === expected;
  });
}

function domNode(tag, className, attrs) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: className || "",
    id: "",
    textContent: "",
    children: [],
    parentNode: null,
    attrs: Object.assign({}, attrs || {})
  };
  node.ownerDocument = {
    createElement(next) {
      const created = domNode(next);
      created.ownerDocument = node.ownerDocument;
      return created;
    }
  };
  node.setAttribute = function (key, value) {
    this.attrs[key] = String(value);
    if (key === "id") this.id = String(value);
  };
  node.getAttribute = function (key) {
    return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
  };
  node.appendChild = function (child) {
    this.children.push(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    return child;
  };
  node.insertBefore = function (child, before) {
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    return child;
  };
  node.remove = function () {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  };
  node.querySelectorAll = function (selector) {
    const out = [];
    const visit = (current) => {
      (current.children || []).forEach((child) => {
        if (matchesSelector(child, selector)) out.push(child);
        visit(child);
      });
    };
    visit(this);
    return out;
  };
  node.querySelector = function (selector) {
    return this.querySelectorAll(selector)[0] || null;
  };
  return node;
}

function listingCard(id, title) {
  const card = domNode("article", "book-card", { "data-live-book-id": String(id) });
  const info = domNode("div", "book-info");
  const heading = domNode("h2", "book-title");
  heading.textContent = title;
  const price = domNode("div", "book-price");
  price.textContent = "10 ₺";
  const button = domNode("button", "add-to-cart", { "data-cart-id": String(id) });
  button.textContent = "سېۋەتكە";
  info.appendChild(heading);
  info.appendChild(price);
  info.appendChild(button);
  card.appendChild(info);
  return card;
}

function cardGrid(cards) {
  const root = domNode("div", "books-grid");
  cards.forEach((card) => root.appendChild(card));
  return root;
}

function statsResponse(rows, ok) {
  return { ok: ok !== false, json: async () => rows };
}

const statsConfig = { url: "https://example.supabase.co", anonKey: "anon" };
const COOLDOWN = Views.BOOK_ENGAGEMENT_COOLDOWN_MS;

test("detail and cart cooldowns are action specific and last 3 hours", () => {
  assert.strictEqual(COOLDOWN, 3 * 60 * 60 * 1000);
  const storage = memoryStorage();
  const sent = [];
  const track = (name, data) => { sent.push({ name, data }); };
  const t0 = 10_000_000;
  assert.strictEqual(Views.recordEngagement("detail", "25", { storage, now: t0, track, refresh: false }).sent, true);
  assert.strictEqual(Views.recordEngagement("detail", "25", { storage, now: t0 + 60 * 1000, track, refresh: false }).sent, false);
  assert.strictEqual(Views.recordEngagement("detail", "25", { storage, now: t0 + (2 * 60 + 59) * 60 * 1000, track, refresh: false }).sent, false);
  assert.strictEqual(Views.recordEngagement("detail", "25", { storage, now: t0 + COOLDOWN + 1, track, refresh: false }).sent, true);
  assert.strictEqual(Views.recordEngagement("cart", "25", { storage, now: t0 + 60 * 1000, track, refresh: false }).sent, true);
  assert.strictEqual(Views.recordEngagement("cart", "25", { storage, now: t0 + 2 * 60 * 1000, track, refresh: false }).sent, false);
  assert.strictEqual(Views.recordEngagement("cart", "25", { storage, now: t0 + 60 * 1000 + COOLDOWN + 1, track, refresh: false }).sent, true);
  assert.strictEqual(Views.recordEngagement("detail", "26", { storage, now: t0 + 1000, track, refresh: false }).sent, true);
  assert.deepStrictEqual(sent.map((row) => row.name + ":" + row.data.bookId), [
    "book_engagement_detail:25",
    "book_engagement_detail:25",
    "book_engagement_cart:25",
    "book_engagement_cart:25",
    "book_engagement_detail:26"
  ]);
});

test("malformed storage and unavailable storage do not break counting or the storefront", () => {
  const malformed = memoryStorage();
  malformed.setItem(Views.STORAGE_KEY, "{");
  assert.doesNotThrow(() => {
    const result = Views.recordEngagement("detail", "15", { storage: malformed, now: 50, track() {}, refresh: false });
    assert.strictEqual(result.sent, true);
  });
  const healed = JSON.parse(malformed.getItem(Views.STORAGE_KEY));
  assert.strictEqual(healed["detail:15"], 50);
  const blocked = {
    getItem() { throw new Error("storage unavailable"); },
    setItem() { throw new Error("storage unavailable"); }
  };
  let opened = false;
  assert.doesNotThrow(() => {
    opened = true;
    const result = Views.recordEngagement("cart", "16", { storage: blocked, now: 80, track() {}, refresh: false });
    assert.strictEqual(result.sent, true);
  });
  assert.strictEqual(opened, true);
});

test("cart quantity changes and rejected adds do not emit engagement", () => {
  const add = shop.slice(shop.indexOf("function add(id,qty=1){"), shop.indexOf("function remove(id){"));
  const qty = shop.slice(shop.indexOf("function changeQty(id,d){"), shop.indexOf("function customerData(){"));
  const remove = shop.slice(shop.indexOf("function remove(id){"), shop.indexOf("function favs(){"));
  assert.strictEqual((add.match(/noteStorefrontEngagement\(/g) || []).length, 1);
  assert.ok(add.indexOf('trackEvent("add_to_cart"') < add.indexOf('noteStorefrontEngagement("cart",storeId)'));
  assert.ok(add.indexOf("بۇ كىتاب ھازىر تۈگەپ كەتكەن") < add.indexOf("noteStorefrontEngagement"));
  assert.ok(add.indexOf("if(set(CART_KEY,a))") < add.indexOf("noteStorefrontEngagement"));
  assert.doesNotMatch(qty, /noteStorefrontEngagement|book_engagement/);
  assert.doesNotMatch(remove, /noteStorefrontEngagement|book_engagement/);
  assert.match(add, /trackEvent\("add_to_cart"/);
});

test("listing cards show compact counts from 20 and survive failed stats", async () => {
  Views.resetStatsCache();
  const hidden = listingCard("19", "يوشۇرۇن");
  const shown = listingCard("20", "يىگىرمە");
  const larger = listingCard("125", "چوڭ");
  const root = cardGrid([hidden, shown, larger]);
  assert.strictEqual(hidden.querySelector(".book-title").textContent, "يوشۇرۇن");
  const calls = [];
  const result = await Views.hydrate(root, {
    force: true,
    config: statsConfig,
    fetchImpl(url) {
      calls.push(url);
      return statsResponse([
        { book_id: "19", total_views: 19 },
        { book_id: "20", total_views: 20 },
        { book_id: "125", total_views: 125 }
      ]);
    }
  });
  assert.strictEqual(result.requests, 1);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], /book_id=in\.\(19,20,125\)/);
  assert.match(calls[0], /select=book_id,total_views/);
  assert.doesNotMatch(calls[0], /unique_views|session/);
  assert.strictEqual(hidden.querySelector(".book-view-count-compact"), null);
  assert.strictEqual(shown.querySelector(".book-view-count-compact").textContent, "👁 20");
  assert.strictEqual(shown.querySelector(".book-view-count-compact").getAttribute("aria-label"), "20 قېتىم كۆرۈلدى");
  assert.strictEqual(larger.querySelector(".book-view-count-compact").textContent, "👁 125");
  assert.strictEqual(shown.querySelector(".add-to-cart").textContent, "سېۋەتكە");
  assert.strictEqual(shown.querySelector(".book-price").textContent, "10 ₺");

  Views.resetStatsCache();
  const failedCard = listingCard("30", "مەغلۇب");
  const failedRoot = cardGrid([failedCard]);
  await Views.hydrate(failedRoot, {
    force: true,
    config: statsConfig,
    fetchImpl() { return statsResponse([], false); }
  });
  assert.strictEqual(failedCard.querySelector(".book-title").textContent, "مەغلۇب");
  assert.strictEqual(failedCard.querySelector(".book-view-count-compact"), null);

  Views.resetStatsCache();
  const missing = listingCard("31", "يوق");
  await Views.hydrate(cardGrid([missing]), {
    force: true,
    config: statsConfig,
    fetchImpl() { return statsResponse([{ book_id: "999", total_views: 80 }]); }
  });
  assert.strictEqual(missing.querySelector(".book-title").textContent, "يوق");
  assert.strictEqual(missing.querySelector(".book-view-count-compact"), null);
});

test("stale stats cannot paint the wrong book and rerendered cards stay bound", async () => {
  Views.resetStatsCache();
  const card = listingCard("10", "كىتاب A");
  const root = cardGrid([card]);
  let release;
  const pending = Views.hydrate(root, {
    force: true,
    config: statsConfig,
    fetchImpl() { return new Promise((resolve) => { release = resolve; }); }
  });
  card.setAttribute("data-live-book-id", "11");
  release(statsResponse([{ book_id: "10", total_views: 125 }]));
  await pending;
  assert.strictEqual(card.querySelector(".book-view-count-compact"), null);
  assert.strictEqual(card.querySelector(".book-title").textContent, "كىتاب A");

  Views.resetStatsCache();
  const searchCard = domNode("article", "advanced-search-result");
  const fav = domNode("button", "favorite-button", { "data-fav-id": "44" });
  const info = domNode("div", "advanced-search-info");
  const price = domNode("div", "advanced-search-price");
  info.appendChild(price);
  searchCard.appendChild(fav);
  searchCard.appendChild(info);
  const searchRoot = cardGrid([searchCard]);
  await Views.hydrate(searchRoot, {
    force: true,
    config: statsConfig,
    fetchImpl(url) {
      assert.match(url, /in\.\(44\)/);
      return statsResponse([{ book_id: "44", total_views: 20 }]);
    }
  });
  assert.strictEqual(searchCard.getAttribute("data-live-book-id"), "44");
  assert.strictEqual(fav.getAttribute("data-live-book-id"), null);
  assert.strictEqual(searchCard.querySelector(".book-view-count-compact").textContent, "👁 20");

  const aiCard = domNode("article", "ai-search-item", { "data-live-book-id": "45" });
  const aiInfo = domNode("div", "ai-search-info");
  const aiMeta = domNode("p", "ai-search-meta");
  aiMeta.textContent = "10 ₺ · بار";
  aiInfo.appendChild(aiMeta);
  aiCard.appendChild(aiInfo);
  Views.resetStatsCache();
  await Views.hydrate(cardGrid([aiCard]), {
    force: true,
    config: statsConfig,
    fetchImpl() { return statsResponse([{ book_id: "45", total_views: 125 }]); }
  });
  assert.strictEqual(aiCard.querySelector(".book-view-count-compact").textContent, "👁 125");
  assert.strictEqual(aiCard.querySelector(".ai-search-meta").textContent, "10 ₺ · بار");
});

test("server engagement cooldown preserves totals and separates actions", () => {
  const stage99 = read("STAGE99_BOOK_ENGAGEMENT_VIEW_COUNTS.sql");
  assert.match(stage99, /CREATE TABLE IF NOT EXISTS private\.book_view_engagement_cooldowns/);
  assert.match(stage99, /PRIMARY KEY \(book_id, session_hash, action\)/);
  assert.match(stage99, /CHECK \(action IN \('detail', 'cart'\)\)/);
  assert.match(stage99, /ON CONFLICT \(book_id, session_hash, action\) DO UPDATE/);
  assert.match(stage99, /WHERE c\.last_counted_at <= \(now\(\) - interval '3 hours'\)/);
  assert.match(stage99, /SET search_path = ''/);
  assert.match(stage99, /SECURITY DEFINER/);
  assert.match(stage99, /IF v_session = '' THEN/);
  assert.match(stage99, /IF v_book_id IS NULL THEN/);
  assert.match(stage99, /total_views = t\.total_views \+ 1/);
  assert.match(stage99, /DROP TRIGGER IF EXISTS analytics_events_apply_book_view/);
  assert.match(stage99, /book_engagement_detail/);
  assert.match(stage99, /book_engagement_cart/);
  assert.match(stage99, /GRANT SELECT \(book_id, total_views\) ON TABLE public\.book_view_stats TO anon, authenticated/);
  assert.match(stage99, /REVOKE ALL ON TABLE private\.book_view_engagement_cooldowns FROM anon/);
  assert.match(stage99, /REVOKE ALL ON TABLE private\.book_view_engagement_cooldowns FROM authenticated/);
  assert.doesNotMatch(stage99, /GRANT SELECT ON TABLE private\.book_view_engagement_cooldowns/);
  assert.doesNotMatch(stage99, /DELETE FROM public\.book_view_stats/i);
  assert.doesNotMatch(stage99, /event_name = 'add_to_cart'/);
  assert.doesNotMatch(stage99, /GREATEST\(/);
  assert.doesNotMatch(stage99, /stock_status|public\.orders|ALTER TABLE public\.books/i);
  assert.doesNotMatch(stage99, /unique_views to anon/);

  function createState(existing) {
    return {
      totals: new Map(existing || []),
      unique: new Map(),
      cool: new Map(),
      sessions: new Set()
    };
  }
  function apply(state, event) {
    if (event.action !== "detail" && event.action !== "cart") return false;
    if (!event.bookExists || !event.session) return false;
    const key = event.bookId + "|" + event.session + "|" + event.action;
    const prev = state.cool.get(key);
    if (prev != null && event.now - prev < COOLDOWN) return false;
    state.cool.set(key, event.now);
    let uniqueInc = 0;
    if (event.action === "detail") {
      const sessionKey = event.bookId + "|" + event.session;
      if (!state.sessions.has(sessionKey)) {
        state.sessions.add(sessionKey);
        uniqueInc = 1;
      }
    }
    state.totals.set(event.bookId, (state.totals.get(event.bookId) || 0) + 1);
    state.unique.set(event.bookId, (state.unique.get(event.bookId) || 0) + uniqueInc);
    return true;
  }
  const state = createState([[7, 40]]);
  const base = { bookExists: true, session: "sess-a", now: 0 };
  const ev = (extra) => Object.assign({}, base, extra);
  assert.strictEqual(apply(state, ev({ bookId: 7, action: "detail" })), true);
  assert.strictEqual(state.totals.get(7), 41);
  assert.strictEqual(state.unique.get(7), 1);
  assert.strictEqual(apply(state, ev({ bookId: 7, action: "detail", now: 60 * 1000 })), false);
  assert.strictEqual(state.totals.get(7), 41);
  assert.strictEqual(apply(state, ev({ bookId: 7, action: "cart", now: 60 * 1000 })), true);
  assert.strictEqual(state.totals.get(7), 42);
  assert.strictEqual(state.unique.get(7), 1);
  assert.strictEqual(apply(state, ev({ bookId: 7, action: "cart", now: 2 * 60 * 1000 })), false);
  assert.strictEqual(apply(state, ev({ bookId: 7, action: "detail", now: COOLDOWN + 5 })), true);
  assert.strictEqual(state.unique.get(7), 1);
  assert.strictEqual(state.totals.get(7), 43);
  assert.strictEqual(apply(state, ev({ bookId: 7, action: "cart", now: 60 * 1000 + COOLDOWN + 5 })), true);
  const raced = createState();
  assert.strictEqual(apply(raced, { bookId: 3, action: "detail", bookExists: true, session: "same", now: 5 }), true);
  assert.strictEqual(apply(raced, { bookId: 3, action: "detail", bookExists: true, session: "same", now: 5 }), false);
  assert.strictEqual(raced.totals.get(3), 1);
  assert.strictEqual(apply(state, { bookId: 9, action: "detail", bookExists: false, session: "sess-a", now: 0 }), false);
  assert.strictEqual(apply(state, { bookId: 9, action: "detail", bookExists: true, session: "", now: 0 }), false);
  assert.strictEqual(state.totals.get(9), undefined);
});

test("detail stats cannot paint after the book id changes", async () => {
  Views.resetStatsCache();
  const info = makeInfo();
  const prevDocument = global.document;
  const prevLocation = global.location;
  const prevFetch = global.fetch;
  const prevConfig = global.KUTADGU_SUPABASE_CONFIG;
  const body = { dataset: { bookId: "10" } };
  global.document = {
    body: body,
    querySelector(sel) {
      if (sel === ".book-detail-info" || sel === ".book-detail-page,.book-detail-info") return info;
      return null;
    }
  };
  global.location = { pathname: "/book/10" };
  global.KUTADGU_SUPABASE_CONFIG = { url: "https://stats.example.test", anonKey: "anon" };
  let release;
  global.fetch = function () {
    return new Promise((resolve) => { release = resolve; });
  };
  try {
    const pending = Views.fetchAndPaint();
    body.dataset.bookId = "11";
    release({
      ok: true,
      json() { return Promise.resolve([{ book_id: "10", total_views: 125 }]); }
    });
    await pending;
    assert.strictEqual(info.querySelector(".book-view-count"), null);
    assert.strictEqual(info.querySelector("h1").textContent, "كىتاب");
  } finally {
    global.document = prevDocument;
    global.location = prevLocation;
    global.fetch = prevFetch;
    global.KUTADGU_SUPABASE_CONFIG = prevConfig;
    Views.resetStatsCache();
  }
});

test("compact mount reuses the same counter for the same total", async () => {
  Views.resetStatsCache();
  const card = listingCard("20", "يىگىرمە");
  const root = cardGrid([card]);
  let calls = 0;
  await Views.hydrate(root, {
    force: true,
    now: 1000,
    config: statsConfig,
    fetchImpl() {
      calls += 1;
      return statsResponse([{ book_id: "20", total_views: 25 }]);
    }
  });
  const el = card.querySelector(".book-view-count-compact");
  const parent = el.parentNode;
  const index = parent.children.indexOf(el);
  let removed = 0;
  const originalRemove = el.remove.bind(el);
  el.remove = function () {
    removed += 1;
    return originalRemove();
  };
  await Views.hydrate(root, {
    force: true,
    now: 2000,
    config: statsConfig,
    fetchImpl() {
      calls += 1;
      throw new Error("cached total must not be requested again");
    }
  });
  assert.strictEqual(calls, 1);
  assert.strictEqual(removed, 0);
  assert.strictEqual(card.querySelectorAll(".book-view-count-compact").length, 1);
  assert.strictEqual(card.querySelector(".book-view-count-compact"), el);
  assert.strictEqual(parent.children[index], el);
  assert.strictEqual(el.textContent, "👁 25");
  assert.strictEqual(el.getAttribute("data-view-for"), "20");
  assert.strictEqual(el.getAttribute("aria-label"), "25 قېتىم كۆرۈلدى");
});

test("compact mount updates a changed total and rebinds a changed book id", () => {
  const card = listingCard("20", "يىگىرمە");
  const el = Views.mountCompactCount(card, 25);
  const next = Views.mountCompactCount(card, 26);
  assert.strictEqual(next, el);
  assert.strictEqual(card.querySelectorAll(".book-view-count-compact").length, 1);
  assert.strictEqual(el.textContent, "👁 26");
  assert.strictEqual(el.getAttribute("data-view-for"), "20");
  assert.strictEqual(el.getAttribute("aria-label"), "26 قېتىم كۆرۈلدى");
  card.setAttribute("data-live-book-id", "26");
  const rebound = Views.mountCompactCount(card, 30);
  assert.strictEqual(rebound, el);
  assert.strictEqual(card.querySelectorAll(".book-view-count-compact").length, 1);
  assert.strictEqual(el.getAttribute("data-view-for"), "26");
  assert.strictEqual(el.textContent, "👁 30");
});

test("compact mount follows the threshold without redundant replacement", () => {
  const card = listingCard("20", "بوساغ");
  assert.strictEqual(Views.mountCompactCount(card, 19), null);
  assert.strictEqual(card.querySelector(".book-view-count-compact"), null);
  const el = Views.mountCompactCount(card, 20);
  assert.strictEqual(el.textContent, "👁 20");
  assert.strictEqual(Views.mountCompactCount(card, 20), el);
  assert.strictEqual(card.querySelectorAll(".book-view-count-compact").length, 1);
  assert.strictEqual(Views.mountCompactCount(card, 19), null);
  assert.strictEqual(card.querySelector(".book-view-count-compact"), null);
  assert.strictEqual(card.querySelector(".book-title").textContent, "بوساغ");
});

test("counter-only mutations are ignored and real card changes are not", () => {
  const card = listingCard("21", "يېڭى");
  const counter = Views.mountCompactCount(card, 25);
  assert.strictEqual(Views.isCounterOnlyMutation({
    target: counter.parentNode,
    addedNodes: [counter],
    removedNodes: []
  }), true);
  assert.strictEqual(Views.isCounterOnlyMutation({
    target: counter,
    addedNodes: [{ nodeType: 3, parentNode: counter }],
    removedNodes: [{ nodeType: 3, parentNode: null }]
  }), true);
  const grid = cardGrid([card]);
  const replacement = listingCard("22", "باشقا");
  assert.strictEqual(Views.isCounterOnlyMutation({
    target: grid,
    addedNodes: [replacement],
    removedNodes: [card]
  }), false);
  assert.deepStrictEqual(Views.mutationScopes([{
    target: counter.parentNode,
    addedNodes: [counter],
    removedNodes: []
  }, {
    target: grid,
    addedNodes: [replacement],
    removedNodes: [card]
  }]).map((scope) => scope.className), ["books-grid"]);
});

test("an in-flight stats batch is not requested again and a failure can retry", async () => {
  Views.resetStatsCache();
  const card = listingCard("40", "كۈتۈش");
  const root = cardGrid([card]);
  let calls = 0;
  let release;
  const first = Views.hydrate(root, {
    force: true,
    now: 0,
    config: statsConfig,
    fetchImpl() {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    }
  });
  const second = Views.hydrate(root, {
    force: true,
    now: 10,
    config: statsConfig,
    fetchImpl() {
      calls += 1;
      return statsResponse([{ book_id: "40", total_views: 25 }]);
    }
  });
  assert.strictEqual(calls, 1);
  release(statsResponse([{ book_id: "40", total_views: 25 }]));
  await first;
  await second;
  assert.strictEqual(calls, 1);
  assert.strictEqual(card.querySelector(".book-view-count-compact").textContent, "👁 25");

  Views.resetStatsCache();
  const expired = listingCard("41", "مۇددىتى");
  const expiredRoot = cardGrid([expired]);
  await Views.hydrate(expiredRoot, {
    force: true,
    now: 0,
    config: statsConfig,
    fetchImpl() { return statsResponse([{ book_id: "41", total_views: 22 }]); }
  });
  let later = 0;
  let hold;
  const again = Views.hydrate(expiredRoot, {
    force: true,
    now: Views.CACHE_MS + 1,
    config: statsConfig,
    fetchImpl() {
      later += 1;
      return new Promise((resolve) => { hold = resolve; });
    }
  });
  const duplicate = Views.hydrate(expiredRoot, {
    force: true,
    now: Views.CACHE_MS + 2,
    config: statsConfig,
    fetchImpl() {
      later += 1;
      return statsResponse([{ book_id: "41", total_views: 23 }]);
    }
  });
  assert.strictEqual(later, 1);
  hold(statsResponse([{ book_id: "41", total_views: 23 }]));
  await again;
  await duplicate;
  assert.strictEqual(later, 1);
  assert.strictEqual(expired.querySelector(".book-view-count-compact").textContent, "👁 23");

  Views.resetStatsCache();
  const flaky = listingCard("42", "قايتا");
  let attempts = 0;
  await Views.hydrate(cardGrid([flaky]), {
    force: true,
    now: 0,
    config: statsConfig,
    fetchImpl() {
      attempts += 1;
      return statsResponse([], false);
    }
  });
  assert.strictEqual(flaky.querySelector(".book-view-count-compact"), null);
  await Views.hydrate(cardGrid([flaky]), {
    force: true,
    now: 50,
    config: statsConfig,
    fetchImpl() {
      attempts += 1;
      return statsResponse([{ book_id: "42", total_views: 20 }]);
    }
  });
  assert.strictEqual(attempts, 2);
  assert.strictEqual(flaky.querySelector(".book-view-count-compact").textContent, "👁 20");
});

test("replacing book A with book B hydrates B only", async () => {
  Views.resetStatsCache();
  const cardA = listingCard("50", "A");
  const root = cardGrid([cardA]);
  await Views.hydrate(root, {
    force: true,
    now: 0,
    config: statsConfig,
    fetchImpl(url) {
      assert.match(url, /in\.\(50\)/);
      return statsResponse([{ book_id: "50", total_views: 25 }]);
    }
  });
  const old = cardA.querySelector(".book-view-count-compact");
  assert.strictEqual(old.getAttribute("data-view-for"), "50");
  root.children = [];
  cardA.parentNode = null;
  const cardB = listingCard("51", "B");
  root.appendChild(cardB);
  await Views.hydrate(root, {
    force: true,
    now: 10,
    config: statsConfig,
    fetchImpl(url) {
      assert.match(url, /in\.\(51\)/);
      assert.doesNotMatch(url, /50/);
      return statsResponse([{ book_id: "51", total_views: 30 }, { book_id: "50", total_views: 99 }]);
    }
  });
  assert.strictEqual(cardB.querySelector(".book-view-count-compact").textContent, "👁 30");
  assert.strictEqual(cardB.querySelector(".book-view-count-compact").getAttribute("data-view-for"), "51");
  assert.strictEqual(cardB.textContent.includes("99"), false);
  assert.strictEqual(old.getAttribute("data-view-for"), "50");
  assert.strictEqual(cardB.contains ? cardB.contains(old) : cardB.children.includes(old), false);
});

test("a rejected engagement insert does not keep the 3-hour client lock", async () => {
  const storage = memoryStorage();
  const denied = await Views.recordEngagement("detail", "25", {
    storage: storage,
    now: 5000,
    refresh: false,
    track() { return Promise.reject(new Error("insert failed")); }
  });
  assert.strictEqual(denied.sent, false);
  assert.strictEqual(denied.reason, "rejected");
  assert.strictEqual(Views.engagementAllowed(storage, "detail", "25", 5001), true);
  const explicit = await Views.recordEngagement("cart", "25", {
    storage: storage,
    now: 6000,
    refresh: false,
    track() { return Promise.resolve(false); }
  });
  assert.strictEqual(explicit.sent, false);
  assert.strictEqual(Views.engagementAllowed(storage, "cart", "25", 6001), true);
  const accepted = await Views.recordEngagement("detail", "33", {
    storage: storage,
    now: 7000,
    refresh: false,
    track() { return Promise.resolve(); }
  });
  assert.strictEqual(accepted.sent, true);
  assert.strictEqual(Views.engagementAllowed(storage, "detail", "33", 7001), false);
  assert.match(helper, /function remoteTrack|analytics must never block the shop|forgetEngagement/);
  assert.match(read("analytics.js"), /analytics must never block the shop/);
});

test("the view counter observer settles and does not restorm stats", async () => {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const page = await browser.newPage();
      const calls = [];
      await page.route("**/book_view_stats**", async (route) => {
        const url = route.request().url();
        calls.push(url);
        const ids = (url.match(/book_id=in\.\(([^)]*)\)/) || [, ""])[1].split(",").filter(Boolean);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(ids.map((id) => ({ book_id: Number(id), total_views: id === "21" ? 30 : 25 })))
        });
      });
      await page.setContent(`<!doctype html><body><div id="grid"><article class="book-card" data-live-book-id="20"><div class="book-info"><div class="book-price">10</div></div></article></div></body>`);
      await page.evaluate(() => {
        window.KUTADGU_SUPABASE_CONFIG = { url: "https://example.supabase.co", anonKey: "anon" };
      });
      await page.addScriptTag({ path: path.join(root, "kutadgu-book-views.js") });
      await page.waitForSelector(".book-view-count-compact");
      await page.evaluate(() => {
        window.__counterMutations = 0;
        new MutationObserver((records) => {
          records.forEach((record) => {
            const nodes = [...record.addedNodes, ...record.removedNodes];
            if (nodes.some((node) => node.nodeType === 1 && String(node.className || "").includes("book-view-count"))) {
              window.__counterMutations += 1;
            }
          });
        }).observe(document.body, { childList: true, subtree: true });
      });
      await page.waitForTimeout(450);
      const settled = await page.evaluate(() => ({
        mutations: window.__counterMutations,
        count: document.querySelectorAll(".book-view-count-compact").length,
        text: document.querySelector(".book-view-count-compact").textContent,
        book: document.querySelector(".book-view-count-compact").getAttribute("data-view-for")
      }));
      assert.strictEqual(settled.mutations, 0, "pass " + pass);
      assert.strictEqual(settled.count, 1, "pass " + pass);
      assert.strictEqual(settled.text, "👁 25", "pass " + pass);
      assert.strictEqual(settled.book, "20", "pass " + pass);
      const beforeReplace = calls.length;
      assert.ok(beforeReplace >= 1 && beforeReplace <= 2, "pass " + pass + " calls " + beforeReplace);
      await page.evaluate(() => {
        const grid = document.querySelector("#grid");
        grid.textContent = "";
        const card = document.createElement("article");
        card.className = "book-card";
        card.setAttribute("data-live-book-id", "21");
        const info = document.createElement("div");
        info.className = "book-info";
        const price = document.createElement("div");
        price.className = "book-price";
        price.textContent = "8";
        info.appendChild(price);
        card.appendChild(info);
        grid.appendChild(card);
      });
      await page.waitForFunction(() => {
        const el = document.querySelector(".book-view-count-compact");
        return el && el.getAttribute("data-view-for") === "21" && el.textContent === "👁 30";
      });
      const replaced = await page.evaluate(() => ({
        count: document.querySelectorAll(".book-view-count-compact").length,
        text: document.querySelector(".book-view-count-compact").textContent,
        book: document.querySelector(".book-view-count-compact").getAttribute("data-view-for"),
        title: document.querySelector(".book-card").getAttribute("data-live-book-id")
      }));
      assert.strictEqual(replaced.count, 1);
      assert.strictEqual(replaced.book, "21");
      assert.strictEqual(replaced.text, "👁 30");
      assert.strictEqual(replaced.title, "21");
      await page.waitForTimeout(450);
      assert.ok(calls.length <= beforeReplace + 2);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("AI result cards bind canonical ids for the shared counter", () => {
  const ui = read("kutadgu-ai-search-ui.js");
  assert.match(ui, /data-live-book-id/);
  assert.match(ui, /isSearchResetTarget/);
  assert.match(ui, /generation \+= 1/);
  assert.match(ui, /controller\.abort\(\)/);
});

(async function runBookViewTests() {
  for (const item of pending) {
    try {
      await item.fn();
      console.log("PASS", item.name);
    } catch (err) {
      failed += 1;
      console.error("FAIL", item.name, err && err.message);
    }
  }
  if (failed) process.exit(1);
  console.log("book-view-counts-tests ok");
})();
