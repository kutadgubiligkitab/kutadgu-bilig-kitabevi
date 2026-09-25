#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Ui = require("../kutadgu-ai-search-ui.js");

const ZERO = "0 دانە كىتاب تېپىلدى";
const EMPTY = "نەتىجە تېپىلمىدى";
const FROZEN = {
  "shop.js": "f2dda1d313ac710f9ed855b7e568756d06015fa8d95f1e1dde6c837746ebd975",
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "api/ai-search.js": "fc348f57a3b85bd2699164fbf300b28a4292b7c5c2240f3065446e486f532147"
};

let failed = 0;
function test(name, fn) {
  const run = fn.constructor.name === "AsyncFunction" ? fn() : Promise.resolve(fn());
  return Promise.resolve(run).then(() => {
    console.log("PASS", name);
  }).catch((err) => {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  });
}

function sha256(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex");
}

function collectText(node) {
  if (!node) return "";
  let out = node.textContent || "";
  (node.children || []).forEach((child) => {
    out += collectText(child);
  });
  return out;
}

function createDom() {
  const byId = Object.create(null);
  const document = { readyState: "complete" };
  function el(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      ownerDocument: document,
      children: [],
      className: "",
      hidden: false,
      disabled: false,
      id: "",
      value: "",
      textContent: "",
      firstChild: null,
      _attrs: Object.create(null),
      _listeners: Object.create(null),
      setAttribute(key, value) {
        const k = String(key);
        const v = String(value);
        this._attrs[k] = v;
        if (k === "id") {
          this.id = v;
          byId[v] = this;
        }
        if (k === "hidden") this.hidden = true;
      },
      removeAttribute(key) {
        const k = String(key);
        delete this._attrs[k];
        if (k === "hidden") this.hidden = false;
      },
      getAttribute(key) {
        const k = String(key);
        if (k === "hidden") return this.hidden ? "" : null;
        if (Object.prototype.hasOwnProperty.call(this._attrs, k)) return this._attrs[k];
        return null;
      },
      appendChild(child) {
        this.children.push(child);
        this.firstChild = this.children[0];
        child.parentNode = this;
        child.ownerDocument = document;
        if (child.id) byId[child.id] = child;
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((item) => item !== child);
        this.firstChild = this.children[0] || null;
        return child;
      },
      replaceChildren() {
        this.children = [];
        this.firstChild = null;
        this.textContent = "";
      },
      addEventListener(type, fn) {
        this._listeners[type] = this._listeners[type] || [];
        this._listeners[type].push(fn);
      },
      emit(type, extra) {
        const ev = Object.assign({
          type,
          target: this,
          preventDefault() {},
          stopPropagation() {}
        }, extra || {});
        (this._listeners[type] || []).forEach((fn) => fn(ev));
      }
    };
    return node;
  }
  document.createElement = el;
  document.getElementById = (id) => byId[id] || null;
  document.addEventListener = function () {};

  const searchInput = el("input");
  searchInput.setAttribute("id", "searchInput");
  const searchButton = el("button");
  searchButton.setAttribute("id", "searchButton");
  const searchResults = el("div");
  searchResults.setAttribute("id", "searchResults");
  searchResults.textContent = ZERO + EMPTY;
  const aiSearchButton = el("button");
  aiSearchButton.setAttribute("id", "aiSearchButton");
  aiSearchButton.hidden = true;
  const aiSearchResults = el("div");
  aiSearchResults.setAttribute("id", "aiSearchResults");
  aiSearchResults.hidden = true;
  return { document, searchInput, searchButton, searchResults, aiSearchButton, aiSearchResults };
}

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function conflictingVisible(dom) {
  if (dom.searchResults.hidden) return false;
  const blob = collectText(dom.searchResults);
  return blob.includes(ZERO) || blob.includes(EMPTY);
}

async function mountAndSearch(dom, fetchImpl, query) {
  const state = Ui.mountAiSearchUi({
    document: dom.document,
    location: { hostname: "www.kutadgubilik.com" },
    fetchImpl
  });
  dom.searchInput.value = query;
  dom.aiSearchButton.emit("click");
  if (state.pending) await state.pending;
  return state;
}

async function run() {
  await test("A: AI success hides conflicting Normal Search empty/zero UI", async () => {
    const dom = createDom();
    await mountAndSearch(dom, async () => jsonRes(200, {
      ok: true,
      results: [{ id: 7, title: "بالىلار بىلىم كىتابى", author: "A", category: "بالىلار", price: 40, stock: 2 }]
    }), "بالام ئۈچۈن بىلىم ئاشۇرىدىغان بالىلار كىتابى ئىزدەۋاتىمەن");
    assert.match(collectText(dom.aiSearchResults), /بالىلار بىلىم كىتابى/);
    assert.strictEqual(dom.aiSearchResults.hidden, false);
    assert.strictEqual(dom.searchResults.hidden, true);
    assert.strictEqual(conflictingVisible(dom), false);
    assert.match(dom.searchResults.textContent, /0 دانە/);
  });

  await test("B: AI empty uses AI-only no-results copy", async () => {
    const dom = createDom();
    await mountAndSearch(dom, async () => jsonRes(200, { ok: true, results: [] }), "ئۇيغۇر تارىخى ھەققىدە بىر رومان");
    assert.match(collectText(dom.aiSearchResults), /AI ئىزدەش نەتىجىسى تېپىلمىدى/);
    assert.strictEqual(dom.searchResults.hidden, true);
    assert.strictEqual(conflictingVisible(dom), false);
  });

  await test("C: AI loading and error conceal Normal Search empty state", async () => {
    const loading = createDom();
    let release;
    const hang = new Promise((resolve) => { release = resolve; });
    const state = Ui.mountAiSearchUi({
      document: loading.document,
      location: { hostname: "localhost" },
      fetchImpl: () => hang.then(() => jsonRes(200, { ok: true, results: [] }))
    });
    loading.searchInput.value = "بالىلار كىتابى";
    loading.aiSearchButton.emit("click");
    assert.match(collectText(loading.aiSearchResults), /AI ئىزدەۋاتىدۇ/);
    assert.strictEqual(loading.searchResults.hidden, true);
    assert.strictEqual(conflictingVisible(loading), false);
    release();
    await state.pending;

    const failing = createDom();
    await mountAndSearch(failing, async () => jsonRes(503, { ok: false, error: "disabled" }), "بالىلار كىتابى");
    assert.match(collectText(failing.aiSearchResults), /AI ئىزدەش ھازىرچە ئىشلىمەيدۇ/);
    assert.strictEqual(failing.searchResults.hidden, true);
    assert.strictEqual(conflictingVisible(failing), false);
  });

  await test("D: editing input / Normal Search restores #searchResults", async () => {
    const dom = createDom();
    await mountAndSearch(dom, async () => jsonRes(200, {
      ok: true,
      results: [{ id: 12, title: "كىتاب", author: "A", category: "تۈر", price: 10, stock: 1 }]
    }), "بالىلار");
    assert.strictEqual(dom.searchResults.hidden, true);
    dom.searchInput.value = "ئانا";
    dom.searchInput.emit("input");
    assert.strictEqual(dom.aiSearchResults.hidden, true);
    assert.strictEqual(dom.searchResults.hidden, false);
    assert.match(dom.searchResults.textContent, /0 دانە|نەتىجە/);
  });

  await test("E: Enter and Normal Search button dismiss AI without preventDefault / ranking changes", async () => {
    const dom = createDom();
    await mountAndSearch(dom, async () => jsonRes(200, {
      ok: true,
      results: [{ id: 12, title: "كىتاب", author: "A", category: "تۈر", price: 10, stock: 1 }]
    }), "بالىلار");
    const prevent = { called: false };
    dom.searchInput.emit("keydown", { key: "Enter", preventDefault() { prevent.called = true; } });
    assert.strictEqual(prevent.called, false);
    assert.strictEqual(dom.aiSearchResults.hidden, true);
    assert.strictEqual(dom.searchResults.hidden, false);

    await mountAndSearch(dom, async () => jsonRes(200, {
      ok: true,
      results: [{ id: 9, title: "كىتاب 2", author: "B", category: "تۈر", price: 10, stock: 1 }]
    }), "بالىلار");
    assert.strictEqual(dom.searchResults.hidden, true);
    dom.searchButton.emit("click");
    assert.strictEqual(dom.aiSearchResults.hidden, true);
    assert.strictEqual(dom.searchResults.hidden, false);

    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(sha256(rel), FROZEN[rel], rel);
    });
    const ui = fs.readFileSync(path.join(root, "kutadgu-ai-search-ui.js"), "utf8");
    assert.doesNotMatch(ui, /kutadgu-search-rank/);
    assert.doesNotMatch(ui, /\/api\/ai-search\/rerank|book_embeddings/);
    const css = fs.readFileSync(path.join(root, "ai-search-ui.css"), "utf8");
    assert.match(css, /#searchResults\[hidden\]/);
    const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
      cwd: root,
      encoding: "utf8"
    });
    const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
    [

      "kutadgu-search-rank.js",
      "api/ai-search.js",
      "kutadgu-ai-search.js",
      "favorites.js",
      "member.js"
    ].forEach((rel) => assert.ok(!files.includes(rel), rel));
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search conflicting empty-state test(s) failed");
    process.exit(1);
  }
  console.log("stage-ai-search-conflicting-empty-state-tests ok");
});
