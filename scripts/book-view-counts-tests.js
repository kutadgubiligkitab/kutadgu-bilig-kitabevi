#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Views = require("../kutadgu-book-views.js");

const root = path.join(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); }
  catch (err) { failed += 1; console.error("FAIL", name, err && err.message); }
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

test("total view count below 50 stays hidden", () => {
  assert.strictEqual(Views.shouldShowTotalViews(0), false);
  assert.strictEqual(Views.shouldShowTotalViews(49), false);
  assert.strictEqual(Views.viewCountText(49), "");
  const info = makeInfo();
  assert.strictEqual(Views.mountViewCount(info, 49), null);
  assert.strictEqual(info.querySelector(".book-view-count"), null);
});

test("total view count = 50 is shown", () => {
  assert.strictEqual(Views.shouldShowTotalViews(50), true);
  assert.strictEqual(Views.viewCountText(50), "👁 50 قېتىم كۆرۈلدى");
  const info = makeInfo();
  const el = Views.mountViewCount(info, 50);
  assert.ok(el);
  assert.strictEqual(el.textContent, "👁 50 قېتىم كۆرۈلدى");
});

test("total view count > 50 is shown", () => {
  assert.strictEqual(Views.viewCountText(1286), "👁 1,286 قېتىم كۆرۈلدى");
  const info = makeInfo();
  const el = Views.mountViewCount(info, 1286);
  assert.strictEqual(el.textContent, "👁 1,286 قېتىم كۆرۈلدى");
});

test("correct Uyghur text is rendered", () => {
  assert.strictEqual(Views.LABEL, "قېتىم كۆرۈلدى");
  assert.ok(Views.viewCountText(50).includes("قېتىم كۆرۈلدى"));
  const info = makeInfo(false);
  const el = Views.mountViewCount(info, 50);
  assert.strictEqual(el.getAttribute("dir"), "rtl");
});

test("refresh in the same session does not send another book_view event", () => {
  const storage = memoryStorage();
  const sent = [];
  const track = Views.wrapTrack(function (name, data) { sent.push({ name, data }); }, storage);
  track("book_view", { bookId: "361" });
  track("book_view", { bookId: "361" });
  track("book_view", { bookId: "361" });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].data.bookId, "361");
  assert.strictEqual(Views.shouldRecordBookView(storage, "361"), false);
});

test("opening a different book can send its own book_view event", () => {
  const storage = memoryStorage();
  const sent = [];
  const track = Views.wrapTrack(function (name, data) { sent.push({ name, data }); }, storage);
  track("book_view", { bookId: "361" });
  track("book_view", { bookId: "108" });
  track("add_to_cart", { bookId: "361" });
  assert.deepStrictEqual(sent.map((row) => row.name + ":" + row.data.bookId), [
    "book_view:361",
    "book_view:108",
    "add_to_cart:361"
  ]);
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
  assert.match(req.url, /\/rest\/v1\/book_view_stats\?select=total_views&book_id=eq\.361/);
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

test("stats fetch waits for validated detail hydration and does not touch listings", () => {
  assert.match(helper, /isBookDetailDocument\(\)/);
  assert.match(helper, /document\.body\.dataset\.bookId/);
  assert.doesNotMatch(helper, /numericCleanBookIdFromLocation/);
  assert.doesNotMatch(helper, /parseBookIdFromLocation/);
  assert.doesNotMatch(helper, /homeFeatureCard|bookCardMarkup|miniCard/);
  assert.doesNotMatch(apply, /most viewed|sales_count/i);
});

if (failed) process.exit(1);
console.log("book-view-counts-tests ok");
