#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
require("../kutadgu-safe-url.js");
const Ui = require("../kutadgu-ai-search-ui.js");
const Safe = global.KutadguSafeUrl || globalThis.KutadguSafeUrl;

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

function findFirst(node, pred) {
  if (!node) return null;
  if (pred(node)) return node;
  const kids = node.children || [];
  for (let i = 0; i < kids.length; i += 1) {
    const found = findFirst(kids[i], pred);
    if (found) return found;
  }
  return null;
}

function collectSrcs(node, out) {
  const acc = out || [];
  if (!node) return acc;
  const src = node.getAttribute && node.getAttribute("src");
  if (src) acc.push(src);
  (node.children || []).forEach((child) => collectSrcs(child, acc));
  return acc;
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

function sampleRow(overrides) {
  return Object.assign({
    id: 164,
    title: "ھەقىقىي كىتاب",
    author: "ئاپتور",
    category: "رومانلار",
    price: 88,
    stock: 2,
    image_url: "https://cdn.example/covers/164.webp"
  }, overrides || {});
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

async function run() {
  await test("AI Search source never requests the demo sample cover", () => {
    const ui = fs.readFileSync(path.join(root, "kutadgu-ai-search-ui.js"), "utf8");
    assert.doesNotMatch(ui, /COVER_FALLBACK\s*=\s*["'][^"']*sample-book-cover\.png["']/);
    assert.doesNotMatch(ui, /setAttribute\(\s*["']src["'][\s\S]{0,80}sample-book-cover/);
    assert.strictEqual(Ui.COVER_FALLBACK, "");
    assert.strictEqual(Ui.COVER_MISSING_LABEL, "مۇقاۋا يوق");
    assert.ok(Safe, "KutadguSafeUrl should be loaded for AI-local fallback tests");
    assert.strictEqual(Safe.COVER_FALLBACK, "/sample-book-cover.png");
    assert.strictEqual(Safe.safeCoverUrl("", { fallback: "" }), "");
  });

  await test("A valid cover uses the real URL and not the sample demo cover", () => {
    const dom = createDom();
    const url = "https://cdn.example/covers/207.webp";
    Ui.renderResults(dom.aiSearchResults, [sampleRow({
      id: 207,
      image_url: url
    })], dom.document);
    const img = findFirst(dom.aiSearchResults, (n) => n.tagName === "IMG");
    assert.ok(img);
    assert.strictEqual(img.getAttribute("src"), url);
    assert.strictEqual(img.getAttribute("data-cover-src"), url);
    assert.ok(!img.hidden);
    const srcs = collectSrcs(dom.aiSearchResults);
    assert.deepStrictEqual(srcs, [url]);
    assert.ok(srcs.every((src) => !/sample-book-cover\.png/i.test(src)));
    const ph = findFirst(dom.aiSearchResults, (n) => n.className === "ai-search-cover-placeholder");
    assert.ok(ph);
    assert.strictEqual(ph.hidden, true);
    assert.ok(collectHrefs(dom.aiSearchResults).every((href) => href === "/book/207"));
    const blob = collectText(dom.aiSearchResults);
    assert.match(blob, /ھەقىقىي كىتاب/);
    assert.match(blob, /ئاپتور/);
    assert.match(blob, /رومانلار/);
    assert.match(blob, /88 ₺/);
    assert.match(blob, /بار/);
  });

  await test("B empty cover shows the neutral placeholder and not the sample cover", () => {
    const dom = createDom();
    Ui.renderResults(dom.aiSearchResults, [sampleRow({ image_url: "" })], dom.document);
    assert.strictEqual(findFirst(dom.aiSearchResults, (n) => n.tagName === "IMG"), null);
    const ph = findFirst(dom.aiSearchResults, (n) => n.className === "ai-search-cover-placeholder");
    assert.ok(ph);
    assert.strictEqual(ph.hidden, false);
    assert.strictEqual(ph.textContent, "مۇقاۋا يوق");
    assert.strictEqual(ph.getAttribute("aria-label"), "مۇقاۋا يوق");
    assert.deepStrictEqual(collectSrcs(dom.aiSearchResults), []);
    const blob = collectText(dom.aiSearchResults);
    assert.match(blob, /مۇقاۋا يوق/);
    assert.doesNotMatch(blob, /sample-book-cover/);
    assert.ok(collectHrefs(dom.aiSearchResults).includes("/book/164"));
  });

  await test("C unsafe or invalid cover uses the placeholder and no unsafe src", () => {
    const cases = [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example/cover.png",
      "   "
    ];
    cases.forEach((image_url) => {
      const dom = createDom();
      Ui.renderResults(dom.aiSearchResults, [sampleRow({ image_url })], dom.document);
      const img = findFirst(dom.aiSearchResults, (n) => n.tagName === "IMG");
      assert.strictEqual(img, null, image_url);
      const srcs = collectSrcs(dom.aiSearchResults);
      assert.deepStrictEqual(srcs, [], image_url);
      assert.ok(srcs.every((src) => src !== image_url.trim()));
      const ph = findFirst(dom.aiSearchResults, (n) => n.className === "ai-search-cover-placeholder");
      assert.ok(ph, image_url);
      assert.strictEqual(ph.hidden, false, image_url);
      assert.match(collectText(dom.aiSearchResults), /مۇقاۋا يوق/);
    });
    assert.strictEqual(Ui.safeCoverSrc("/sample-book-cover.png"), "");
    assert.strictEqual(Ui.safeCoverSrc("javascript:alert(1)"), "");
  });

  await test("D runtime image failure reveals the placeholder and does not request the sample cover", () => {
    const dom = createDom();
    const url = "https://cdn.example/covers/164.webp";
    Ui.renderResults(dom.aiSearchResults, [sampleRow({ image_url: url })], dom.document);
    const img = findFirst(dom.aiSearchResults, (n) => n.tagName === "IMG");
    assert.ok(img);
    const cover = findFirst(dom.aiSearchResults, (n) => n.className === "ai-search-cover");
    img.emit("error");
    assert.strictEqual(findFirst(dom.aiSearchResults, (n) => n.tagName === "IMG"), null);
    const ph = findFirst(dom.aiSearchResults, (n) => n.className === "ai-search-cover-placeholder");
    assert.ok(ph);
    assert.strictEqual(ph.hidden, false);
    assert.strictEqual(ph.textContent, "مۇقاۋا يوق");
    assert.deepStrictEqual(collectSrcs(dom.aiSearchResults), []);
    const srcsAfter = collectSrcs(cover);
    assert.ok(srcsAfter.every((src) => !/sample-book-cover\.png/i.test(src)));
    assert.strictEqual(img.getAttribute("src"), url);
    assert.ok(collectHrefs(dom.aiSearchResults).includes("/book/164"));
    const blob = collectText(dom.aiSearchResults);
    assert.match(blob, /ھەقىقىي كىتاب/);
    assert.match(blob, /88 ₺/);
    img.emit("error");
  });

  await test("E result metadata and BUG-01 empty-state hide remain intact", async () => {
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => jsonRes(200, {
        ok: true,
        results: [sampleRow({
          id: 12,
          title: "بالىلار تەربىيەسى",
          author: "A",
          category: "پەرزەنت",
          price: 80,
          stock: 4,
          image_url: "https://cdn.example/covers/12.webp"
        })]
      })
    });
    dom.searchResults.hidden = false;
    dom.searchResults.textContent = "0 دانە كىتاب تېپىلدى نەتىجە تېپىلمىدى";
    dom.searchInput.value = "بالىلار";
    dom.aiSearchButton.emit("click");
    await state.pending;
    const blob = collectText(dom.aiSearchResults);
    assert.match(blob, /بالىلار تەربىيەسى/);
    assert.match(blob, /A/);
    assert.match(blob, /پەرزەنت/);
    assert.match(blob, /80 ₺/);
    assert.match(blob, /بار/);
    assert.ok(collectHrefs(dom.aiSearchResults).every((href) => href === "/book/12"));
    const img = findFirst(dom.aiSearchResults, (n) => n.tagName === "IMG");
    assert.strictEqual(img.getAttribute("src"), "https://cdn.example/covers/12.webp");
    assert.strictEqual(dom.searchResults.hidden, true);
    assert.strictEqual(dom.searchResults.textContent, "0 دانە كىتاب تېپىلدى نەتىجە تېپىلمىدى");
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search cover fallback test(s) failed");
    process.exit(1);
  }
  console.log("stage-ai-search-cover-fallback-tests ok");
});
