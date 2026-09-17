#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
require("../kutadgu-safe-url.js");
const Ui = require("../kutadgu-ai-search-ui.js");

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

function collectText(node) {
  if (!node) return "";
  let out = node.textContent || "";
  (node.children || []).forEach((child) => {
    out += collectText(child);
  });
  return out;
}

function collectHrefs(node, out) {
  const acc = out || [];
  if (!node) return acc;
  const href = node.getAttribute && node.getAttribute("href");
  if (href) acc.push(href);
  (node.children || []).forEach((child) => collectHrefs(child, acc));
  return acc;
}

function findAll(node, pred, acc) {
  const out = acc || [];
  if (!node) return out;
  if (pred(node)) out.push(node);
  (node.children || []).forEach((child) => findAll(child, pred, out));
  return out;
}

function findFirst(node, pred) {
  return findAll(node, pred)[0] || null;
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
      removeEventListener(type, fn) {
        this._listeners[type] = (this._listeners[type] || []).filter((item) => item !== fn);
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
  searchResults.textContent = "NORMAL_KEEP";
  const aiSearchButton = el("button");
  aiSearchButton.setAttribute("id", "aiSearchButton");
  aiSearchButton.hidden = true;
  const aiSearchResults = el("div");
  aiSearchResults.setAttribute("id", "aiSearchResults");
  aiSearchResults.hidden = true;

  return {
    document,
    searchInput,
    searchButton,
    searchResults,
    aiSearchButton,
    aiSearchResults
  };
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function bookRow(id, overrides) {
  return Object.assign({
    id,
    title: "كىتاب " + id,
    author: "ئاپتور " + id,
    category: "رومانلار",
    price: 10 + id,
    stock: 3,
    image_url: "https://cdn.example/covers/" + id + ".webp"
  }, overrides || {});
}

function cards(box) {
  return findAll(box, (n) => n.className === "ai-search-item");
}

function showMore(box) {
  return findFirst(box, (n) => n.className === "ai-search-show-more");
}

async function run() {
  await test("CSS uses a 2-column desktop grid and uncropped covers", () => {
    const css = fs.readFileSync(path.join(root, "ai-search-ui.css"), "utf8");
    assert.match(css, /grid-template-columns\s*:\s*repeat\(\s*2/);
    assert.match(css, /@media\(max-width:700px\)[\s\S]*grid-template-columns\s*:\s*minmax\(\s*0\s*,\s*1fr\s*\)/);
    assert.match(css, /object-fit\s*:\s*contain/);
    assert.doesNotMatch(css, /\.ai-search-cover img\{[^}]*object-fit\s*:\s*cover/);
    assert.match(css, /ai-search-show-more/);
    assert.strictEqual(Ui.INITIAL_VISIBLE_COUNT, 6);
    assert.strictEqual(Ui.REVEAL_BATCH_SIZE, 6);
    assert.strictEqual(Ui.SHOW_MORE_LABEL, "تېخىمۇ كۆپ كۆرسەت");
  });

  await test("A twelve results start at six cards with a show-more button", () => {
    const dom = createDom();
    const rows = Array.from({ length: 12 }, (_, i) => bookRow(i + 1));
    Ui.renderResults(dom.aiSearchResults, rows, dom.document);
    assert.strictEqual(cards(dom.aiSearchResults).length, 6);
    const hrefs = collectHrefs(dom.aiSearchResults).filter((h) => /^\/book\//.test(h));
    assert.deepStrictEqual([...new Set(hrefs)], [
      "/book/1", "/book/2", "/book/3", "/book/4", "/book/5", "/book/6"
    ]);
    const more = showMore(dom.aiSearchResults);
    assert.ok(more);
    assert.strictEqual(more.getAttribute("type"), "button");
    assert.strictEqual(more.textContent, "تېخىمۇ كۆپ كۆرسەت");
  });

  await test("B show more reveals the next six without reordering or fetching", async () => {
    const calls = [];
    const rows = Array.from({ length: 12 }, (_, i) => bookRow(i + 1));
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonRes(200, { ok: true, results: rows });
      }
    });
    dom.searchInput.value = "بالىلار";
    dom.aiSearchButton.emit("click");
    await state.pending;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(cards(dom.aiSearchResults).length, 6);
    showMore(dom.aiSearchResults).emit("click");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(cards(dom.aiSearchResults).length, 12);
    const titles = cards(dom.aiSearchResults).map((card) => {
      return findFirst(card, (n) => n.className === "ai-search-title").textContent;
    });
    assert.deepStrictEqual(titles, rows.map((row) => row.title));
    assert.strictEqual(showMore(dom.aiSearchResults), null);
  });

  await test("C four results render fully without a show-more button", () => {
    const dom = createDom();
    Ui.renderResults(dom.aiSearchResults, [
      bookRow(1), bookRow(2), bookRow(3), bookRow(4)
    ], dom.document);
    assert.strictEqual(cards(dom.aiSearchResults).length, 4);
    assert.strictEqual(showMore(dom.aiSearchResults), null);
  });

  await test("D a new AI search resets the visible count to six", async () => {
    const first = Array.from({ length: 12 }, (_, i) => bookRow(i + 1));
    const second = Array.from({ length: 12 }, (_, i) => bookRow(100 + i + 1));
    let n = 0;
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => {
        n += 1;
        return jsonRes(200, { ok: true, results: n === 1 ? first : second });
      }
    });
    dom.searchInput.value = "بالىلار";
    dom.aiSearchButton.emit("click");
    await state.pending;
    showMore(dom.aiSearchResults).emit("click");
    assert.strictEqual(cards(dom.aiSearchResults).length, 12);
    dom.aiSearchButton.emit("click");
    await state.pending;
    assert.strictEqual(n, 2);
    assert.strictEqual(cards(dom.aiSearchResults).length, 6);
    const titles = cards(dom.aiSearchResults).map((card) => {
      return findFirst(card, (n) => n.className === "ai-search-title").textContent;
    });
    assert.deepStrictEqual(titles, second.slice(0, 6).map((row) => row.title));
    assert.ok(showMore(dom.aiSearchResults));
  });

  await test("E BUG-01 Normal Search empty UI stays hidden while AI results are shown", async () => {
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => jsonRes(200, { ok: true, results: Array.from({ length: 8 }, (_, i) => bookRow(i + 1)) })
    });
    dom.searchResults.hidden = false;
    dom.searchResults.textContent = "0 دانە كىتاب تېپىلدى نەتىجە تېپىلمىدى";
    dom.searchInput.value = "بالىلار";
    dom.aiSearchButton.emit("click");
    await state.pending;
    assert.strictEqual(dom.searchResults.hidden, true);
    assert.strictEqual(cards(dom.aiSearchResults).length, 6);
    showMore(dom.aiSearchResults).emit("click");
    assert.strictEqual(dom.searchResults.hidden, true);
    dom.searchInput.value = "باشقا";
    dom.searchInput.emit("input");
    assert.strictEqual(dom.aiSearchResults.hidden, true);
    assert.strictEqual(dom.searchResults.hidden, false);
  });

  await test("F PR 186 cover fallback remains local and never uses the sample cover", () => {
    const ui = fs.readFileSync(path.join(root, "kutadgu-ai-search-ui.js"), "utf8");
    assert.doesNotMatch(ui, /COVER_FALLBACK\s*=\s*["'][^"']*sample-book-cover\.png["']/);
    assert.strictEqual(Ui.COVER_FALLBACK, "");
    const dom = createDom();
    Ui.renderResults(dom.aiSearchResults, [
      bookRow(207, { image_url: "https://cdn.example/covers/207.webp" }),
      bookRow(164, { image_url: "" }),
      bookRow(12, { image_url: "javascript:alert(1)" })
    ], dom.document);
    const imgs = findAll(dom.aiSearchResults, (n) => n.tagName === "IMG");
    assert.strictEqual(imgs.length, 1);
    assert.strictEqual(imgs[0].getAttribute("src"), "https://cdn.example/covers/207.webp");
    imgs[0].emit("error");
    assert.strictEqual(findAll(dom.aiSearchResults, (n) => n.tagName === "IMG").length, 0);
    const placeholders = findAll(dom.aiSearchResults, (n) => n.className === "ai-search-cover-placeholder");
    assert.ok(placeholders.length >= 3);
    placeholders.forEach((ph) => {
      if (!ph.hidden) assert.strictEqual(ph.textContent, "مۇقاۋا يوق");
    });
    const blob = collectText(dom.aiSearchResults);
    assert.match(blob, /مۇقاۋا يوق/);
    assert.doesNotMatch(blob, /sample-book-cover/);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search results grid test(s) failed");
    process.exit(1);
  }
  console.log("stage-ai-search-results-grid-tests ok");
});
