#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Ui = require("../kutadgu-ai-search-ui.js");

const FROZEN = {
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "shop.js": "38569909c9aec9c2d0bd79875edc035ebb54c505a6b86409006e43f52c3ad301"
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

function collectTags(node, out) {
  const acc = out || [];
  if (!node) return acc;
  if (node.tagName) acc.push(String(node.tagName).toLowerCase());
  (node.children || []).forEach((child) => collectTags(child, acc));
  return acc;
}

function collectHrefs(node, out) {
  const acc = out || [];
  if (!node) return acc;
  const href = node.getAttribute && node.getAttribute("href");
  if (href) acc.push(href);
  (node.children || []).forEach((child) => collectHrefs(child, acc));
  return acc;
}

function createDom() {
  const byId = Object.create(null);
  const document = {
    readyState: "complete"
  };
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
        if (k === "aria-busy") delete this._attrs["aria-busy"];
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
        if (typeof this.onclick === "function") this.onclick(ev);
        (this._listeners[type] || []).forEach((fn) => fn(ev));
        (document._listeners[type] || []).forEach((fn) => fn(ev));
      }
    };
    return node;
  }
  document.createElement = el;
  document.getElementById = (id) => byId[id] || null;
  document._listeners = Object.create(null);
  document.addEventListener = function (type, fn) {
    document._listeners[type] = document._listeners[type] || [];
    document._listeners[type].push(fn);
  };

  const searchInput = el("input");
  searchInput.setAttribute("id", "searchInput");
  const searchButton = el("button");
  searchButton.setAttribute("id", "searchButton");
  searchButton.textContent = "ئىزدەش";
  let searchDisabled = false;
  searchButton.disabledWrites = 0;
  Object.defineProperty(searchButton, "disabled", {
    configurable: true,
    get() { return searchDisabled; },
    set(value) {
      searchButton.disabledWrites += 1;
      searchDisabled = !!value;
    }
  });
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

async function run() {
  await test("A-G: approved hosts show AI UI; unrelated hosts hide it", () => {
    const previewHost = "kutadgu-bilig-kitab-git-ai-search-1f-preview-ui-kutadgu-bilig-kitabhanisi.vercel.app";
    const previewHashHost = "kutadgu-bilig-kitab-abc123xyz-kutadgu-bilig-kitabhanisi.vercel.app";
    const visible = [
      "www.kutadgubilik.com",
      "kutadgubilik.com",
      "kutadgu-bilig-kitab.vercel.app",
      previewHost,
      previewHashHost,
      "localhost",
      "127.0.0.1"
    ];
    const hidden = [
      "example.vercel.app",
      "unrelated-project.vercel.app",
      "shop.example.com"
    ];
    visible.forEach((hostname) => {
      assert.strictEqual(Ui.isAllowedAiSearchHost({ hostname }), true, hostname);
    });
    hidden.forEach((hostname) => {
      assert.strictEqual(Ui.isAllowedAiSearchHost({ hostname }), false, hostname);
      assert.strictEqual(Ui.isPreviewAiSearchHost({ hostname }), false, hostname);
    });
    assert.strictEqual(Ui.isProductionAiSearchHost({ hostname: "www.kutadgubilik.com" }), true);
    assert.strictEqual(Ui.isProductionAiSearchHost({ hostname: "kutadgubilik.com" }), true);
    assert.strictEqual(Ui.isProductionAiSearchHost({ hostname: "kutadgu-bilig-kitab.vercel.app" }), true);
    assert.strictEqual(Ui.isProductionAiSearchHost({ hostname: "localhost" }), false);
    assert.strictEqual(Ui.isKutadguVercelPreviewHost(previewHost), true);
    assert.strictEqual(Ui.isKutadguVercelPreviewHost("kutadgu-bilig-kitab.vercel.app"), false);
    assert.strictEqual(Ui.isKutadguVercelPreviewHost("example.vercel.app"), false);
    assert.strictEqual(Ui.isPreviewAiSearchHost({ hostname: "www.kutadgubilik.com" }), false);
    assert.strictEqual(Ui.isPreviewAiSearchHost({ hostname: "localhost" }), true);

    function mountOn(hostname) {
      const dom = createDom();
      const state = Ui.mountAiSearchUi({
        document: dom.document,
        location: { hostname },
        fetchImpl: async () => jsonRes(200, { ok: true, results: [] })
      });
      return { dom, state };
    }

    [
      "www.kutadgubilik.com",
      "kutadgubilik.com",
      "kutadgu-bilig-kitab.vercel.app",
      previewHost,
      "localhost",
      "127.0.0.1"
    ].forEach((hostname) => {
      const out = mountOn(hostname);
      assert.strictEqual(out.state.visible, true, hostname);
      assert.strictEqual(out.dom.aiSearchButton.hidden, false, hostname);
    });

    const unrelatedVercel = mountOn("example.vercel.app");
    assert.strictEqual(unrelatedVercel.state.visible, false);
    assert.strictEqual(unrelatedVercel.dom.aiSearchButton.hidden, true);
    assert.strictEqual(unrelatedVercel.dom.aiSearchResults.hidden, true);

    const unrelatedDomain = mountOn("shop.example.com");
    assert.strictEqual(unrelatedDomain.state.visible, false);
    assert.strictEqual(unrelatedDomain.dom.aiSearchButton.hidden, true);
  });

  await test("no API request on page load or when AI UI is hidden", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonRes(200, { ok: true, results: [] });
    };
    const preview = createDom();
    preview.searchInput.value = "بالىلار";
    Ui.mountAiSearchUi({
      document: preview.document,
      location: { hostname: "127.0.0.1" },
      fetchImpl
    });
    assert.strictEqual(calls, 0);

    const hidden = createDom();
    hidden.searchInput.value = "بالىلار";
    const hiddenState = Ui.mountAiSearchUi({
      document: hidden.document,
      location: { hostname: "example.vercel.app" },
      fetchImpl
    });
    hidden.aiSearchButton.emit("click");
    if (hiddenState.pending) await hiddenState.pending;
    assert.strictEqual(calls, 0);
    assert.strictEqual(hiddenState.fetchCalls, 0);

    const prod = createDom();
    prod.searchInput.value = "بالىلار";
    const prodState = Ui.mountAiSearchUi({
      document: prod.document,
      location: { hostname: "www.kutadgubilik.com" },
      fetchImpl
    });
    assert.strictEqual(prodState.visible, true);
    prod.aiSearchButton.emit("click");
    if (prodState.pending) await prodState.pending;
    assert.strictEqual(calls, 1);
    assert.strictEqual(prodState.fetchCalls, 1);
  });

  await test("empty or invalid query makes zero API calls", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonRes(200, { ok: true, results: [] });
    };
    const dom = createDom();
    Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl
    });
    dom.searchInput.value = "  ";
    dom.aiSearchButton.emit("click");
    assert.strictEqual(calls, 0);
    assert.match(collectText(dom.aiSearchResults), /ئىزدەش سۆزىنى كىرگۈزۈڭ/);
    dom.searchInput.value = "ك";
    dom.aiSearchButton.emit("click");
    assert.strictEqual(calls, 0);
    dom.searchInput.value = "ك".repeat(301);
    dom.aiSearchButton.emit("click");
    assert.strictEqual(calls, 0);
    assert.strictEqual(dom.searchButton.disabled, false);
    assert.strictEqual(dom.searchButton.disabledWrites, 0);
  });

  await test("AI UI never enables, disables, or restores #searchButton", async () => {
    const uiSrc = fs.readFileSync(path.join(root, "kutadgu-ai-search-ui.js"), "utf8");
    assert.doesNotMatch(uiSrc, /normalBtn/);
    assert.doesNotMatch(uiSrc, /searchButton\.disabled/);
    assert.doesNotMatch(uiSrc, /searchActionBtn\.disabled/);
    assert.doesNotMatch(uiSrc, /searchResults\.(innerHTML|textContent)\s*=/);

    async function runWithInitialDisabled(startDisabled) {
      const dom = createDom();
      dom.searchButton.disabled = startDisabled;
      const writesAfterSetup = dom.searchButton.disabledWrites;
      const state = Ui.mountAiSearchUi({
        document: dom.document,
        location: { hostname: "localhost" },
        fetchImpl: async () => jsonRes(200, {
          ok: true,
          results: [{ id: 12, title: "بالىلار", author: "A", category: "تۈر", price: 10, stock: 1, similarity: 0.2 }]
        })
      });
      assert.strictEqual(dom.searchButton.disabled, startDisabled);
      dom.searchInput.value = "با";
      dom.searchInput.emit("input");
      assert.strictEqual(dom.searchButton.disabled, startDisabled);
      dom.searchInput.value = "بالىلار";
      dom.searchInput.emit("input");
      dom.aiSearchButton.emit("click");
      await state.pending;
      assert.strictEqual(dom.searchButton.disabled, startDisabled);
      assert.strictEqual(dom.searchButton.disabledWrites, writesAfterSetup);
      assert.strictEqual(dom.aiSearchButton.disabled, false);
      return dom;
    }
    const stayedDisabled = await runWithInitialDisabled(true);
    assert.strictEqual(stayedDisabled.searchButton.disabled, true);
    const stayedEnabled = await runWithInitialDisabled(false);
    assert.strictEqual(stayedEnabled.searchButton.disabled, false);
  });

  await test("AI request happens only on explicit AI-button click to /api/ai-search", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonRes(200, {
        ok: true,
        results: [{
          id: 12,
          title: "بالىلار تەربىيەسى",
          author: "A",
          category: "پەرزەنت",
          price: 80,
          image_url: "https://example.invalid/a.webp",
          stock: 4,
          similarity: 0.99,
          embedding: [1, 2, 3],
          source_text_hash: "abc"
        }]
      });
    };
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "kutadgu-bilig-kitab-abc123xyz-kutadgu-bilig-kitabhanisi.vercel.app" },
      fetchImpl
    });
    dom.searchInput.value = "  بالىلار  ";
    assert.strictEqual(calls.length, 0);
    dom.aiSearchButton.emit("click");
    await state.pending;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "/api/ai-search");
    assert.strictEqual(calls[0].init.method, "POST");
    assert.strictEqual(calls[0].init.headers["Content-Type"], "application/json");
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { query: "بالىلار" });
    assert.strictEqual(dom.aiSearchButton.disabled, false);
    assert.strictEqual(dom.searchButton.disabled, false);
    assert.strictEqual(dom.searchButton.disabledWrites, 0);
    const aiText = collectText(dom.aiSearchResults);
    assert.match(aiText, /بالىلار تەربىيەسى/);
    assert.match(aiText, /AI ئىزدەش نەتىجىسى/);
    assert.doesNotMatch(aiText, /0\.99|similarity|embedding|source_text_hash|abc/);
    assert.ok(collectHrefs(dom.aiSearchResults).every((href) => href === "/book/12"));
    assert.strictEqual(dom.searchResults.textContent, "NORMAL_KEEP");
    assert.strictEqual(dom.aiSearchResults.hidden, false);
    assert.strictEqual(dom.searchResults.hidden, true);
  });

  await test("Enter key is not hijacked by AI Search", async () => {
    let calls = 0;
    const dom = createDom();
    Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => {
        calls += 1;
        return jsonRes(200, { ok: true, results: [] });
      }
    });
    dom.searchInput.value = "بالىلار";
    assert.ok(dom.searchInput._listeners.input);
    assert.ok(dom.searchInput._listeners.keydown);
    const prevent = { called: false };
    dom.searchInput.emit("keydown", { key: "Enter", preventDefault() { prevent.called = true; } });
    assert.strictEqual(prevent.called, false);
    assert.strictEqual(calls, 0);
  });

  await test("Normal Search IDs remain unchanged in index.html and shop files stay frozen", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.match(html, /id="searchInput"/);
    assert.match(html, /id="searchButton"/);
    assert.match(html, /id="searchResults"/);
    assert.match(html, /id="aiSearchButton"/);
    assert.match(html, /id="aiSearchResults"/);
    assert.match(html, /kutadgu-ai-search-ui\.js/);
    assert.match(html, /ai-search-ui\.css/);
    const aiPos = html.indexOf('id="aiSearchResults"');
    const normalPos = html.indexOf('id="searchResults"');
    assert.ok(aiPos > -1 && normalPos > -1);
    assert.ok(aiPos < normalPos, "#aiSearchResults must appear before #searchResults");
    Object.keys(FROZEN).forEach((rel) => {
      assert.strictEqual(sha256(rel), FROZEN[rel], rel);
    });
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    const rank = fs.readFileSync(path.join(root, "kutadgu-search-rank.js"), "utf8");
    assert.doesNotMatch(shop, /aiSearchButton|aiSearchResults|kutadgu-ai-search-ui|\/api\/ai-search/);
    assert.doesNotMatch(rank, /aiSearchButton|\/api\/ai-search/);
  });

  await test("unsafe values are not injected as HTML and similarity is omitted", () => {
    const dom = createDom();
    Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => jsonRes(200, { ok: true, results: [] })
    });
    Ui.renderResults(dom.aiSearchResults, [{
      id: 9,
      title: "<img src=x onerror=alert(1)>",
      author: "<script>alert(1)</script>",
      category: "ok",
      price: 10,
      image_url: "javascript:alert(1)",
      similarity: 0.42
    }], dom.document);
    const tags = collectTags(dom.aiSearchResults);
    assert.ok(!tags.includes("script"));
    assert.ok(!tags.includes("img"));
    const blob = collectText(dom.aiSearchResults);
    assert.match(blob, /مۇقاۋا يوق/);
    assert.doesNotMatch(blob, /sample-book-cover/);
    assert.doesNotMatch(blob, /javascript:alert/);
    assert.match(blob, /<img src=x onerror=alert\(1\)>/);
    assert.doesNotMatch(blob, /0\.42/);
  });

  await test("invalid, disabled, and malformed API responses fail safely without touching Normal Search", async () => {
    async function runCase(fetchImpl) {
      const dom = createDom();
      const state = Ui.mountAiSearchUi({
        document: dom.document,
        location: { hostname: "localhost" },
        fetchImpl
      });
      dom.searchInput.value = "بالىلار";
      dom.aiSearchButton.emit("click");
      await state.pending;
      return { dom, state };
    }
    const disabled = await runCase(async () => jsonRes(503, { ok: false, error: "disabled" }));
    assert.match(collectText(disabled.dom.aiSearchResults), /AI ئىزدەش ھازىرچە ئىشلىمەيدۇ/);
    assert.doesNotMatch(collectText(disabled.dom.aiSearchResults), /disabled|503|OpenAI|Supabase/);
    assert.strictEqual(disabled.dom.searchResults.textContent, "NORMAL_KEEP");
    assert.strictEqual(disabled.dom.searchResults.hidden, true);
    assert.strictEqual(disabled.dom.searchButton.disabled, false);

    const malformed = await runCase(async () => ({
      ok: true,
      status: 200,
      async json() { throw new Error("nope"); }
    }));
    assert.match(collectText(malformed.dom.aiSearchResults), /AI ئىزدەش ھازىرچە ئىشلىمەيدۇ/);

    const badShape = await runCase(async () => jsonRes(200, { ok: true, results: { id: 1 } }));
    assert.match(collectText(badShape.dom.aiSearchResults), /AI ئىزدەش ھازىرچە ئىشلىمەيدۇ/);

    const rate = await runCase(async () => jsonRes(429, { error: "insufficient_quota sk-secret" }));
    assert.doesNotMatch(collectText(rate.dom.aiSearchResults), /insufficient_quota|sk-secret|429/);
  });

  await test("timeout aborts safely and does not disable Normal Search", async () => {
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      timeoutMs: 30,
      fetchImpl: (url, init) => new Promise((_, reject) => {
        const signal = init && init.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      })
    });
    dom.searchInput.value = "بالىلار";
    const started = Date.now();
    dom.aiSearchButton.emit("click");
    await state.pending;
    assert.ok(Date.now() - started < 1000);
    assert.match(collectText(dom.aiSearchResults), /AI ئىزدەش ھازىرچە ئىشلىمەيدۇ/);
    assert.strictEqual(dom.searchButton.disabled, false);
    assert.strictEqual(dom.aiSearchButton.disabled, false);
    assert.strictEqual(dom.searchResults.textContent, "NORMAL_KEEP");
    assert.strictEqual(dom.searchResults.hidden, true);
  });

  await test("frontend AI UI contains no secrets and does not change production config", () => {
    const ui = fs.readFileSync(path.join(root, "kutadgu-ai-search-ui.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "ai-search-ui.css"), "utf8");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    [ui, css, html].forEach((text) => {
      assert.doesNotMatch(text, /OPENAI_API_KEY/);
      assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY/);
      assert.doesNotMatch(text, /sk-(?:proj-|svcacct-)?[A-Za-z0-9]{10,}/);
      assert.doesNotMatch(text, /service_role/);
      assert.doesNotMatch(text, /api\.openai\.com/);
    });
    assert.match(ui, /\/api\/ai-search/);
    assert.doesNotMatch(ui, /book_embeddings/);
    const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    assert.doesNotMatch(envExample, /AI_SEARCH_ENABLED\s*=\s*true/);
    const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    assert.ok(!(vercel.env && vercel.env.AI_SEARCH_ENABLED === "true"));
  });

  function countClass(node, className) {
    if (!node) return 0;
    const own = String(node.className || "").split(/\s+/).includes(className) ? 1 : 0;
    return own + (node.children || []).reduce((sum, child) => sum + countClass(child, className), 0);
  }

  function findClass(node, className) {
    if (!node) return null;
    if (String(node.className || "").split(/\s+/).includes(className)) return node;
    for (const child of node.children || []) {
      const found = findClass(child, className);
      if (found) return found;
    }
    return null;
  }

  function pressReset(dom) {
    const reset = dom.document.createElement("button");
    reset.setAttribute("id", "searchReset");
    reset.textContent = "↺ تازىلاش";
    reset.onclick = function () { dom.searchInput.value = ""; };
    reset.emit("click");
    return reset;
  }

  await test("تازىلاش clears AI results immediately and keeps Normal Search visible", async () => {
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => jsonRes(200, {
        ok: true,
        results: [{ id: 4, title: "AI كىتاب", author: "ئاپتور", price: 12, stock: 2 }]
      })
    });
    dom.searchInput.value = "رومان";
    dom.aiSearchButton.emit("click");
    await state.pending;
    assert.ok(countClass(dom.aiSearchResults, "ai-search-item") > 0);
    assert.strictEqual(dom.searchResults.hidden, true);
    pressReset(dom);
    assert.strictEqual(dom.searchInput.value, "");
    assert.strictEqual(countClass(dom.aiSearchResults, "ai-search-item"), 0);
    assert.strictEqual(countClass(dom.aiSearchResults, "ai-search-heading"), 0);
    assert.strictEqual(dom.aiSearchResults.hidden, true);
    assert.strictEqual(collectText(dom.aiSearchResults), "");
    assert.deepStrictEqual(dom.aiSearchResults._aiAllRows, []);
    assert.strictEqual(dom.searchResults.hidden, false);
    assert.strictEqual(dom.searchResults.textContent, "NORMAL_KEEP");
    assert.strictEqual(dom.searchButton.disabled, false);
    const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
    assert.match(shop, /if\(reset\)reset\.onclick=\(\)=>\{input\.value="";/);
    assert.match(shop, /run\(false\)/);
  });

  await test("a stale AI response after تازىلاش cannot restore old results", async () => {
    let releaseFirst;
    let releaseSecond;
    const dom = createDom();
    const state = Ui.mountAiSearchUi({
      document: dom.document,
      location: { hostname: "localhost" },
      fetchImpl: (url, init) => new Promise((resolve) => {
        const query = JSON.parse(init.body).query;
        const finish = () => resolve(jsonRes(200, {
          ok: true,
          results: [{
            id: query.indexOf("يېڭى") >= 0 ? 8 : 7,
            title: query.indexOf("يېڭى") >= 0 ? "يېڭى كىتاب" : "كونا كىتاب",
            author: "ئاپتور",
            price: 9,
            stock: 1
          }]
        }));
        if (query.indexOf("يېڭى") >= 0) releaseSecond = finish;
        else releaseFirst = finish;
      })
    });
    dom.searchInput.value = "كونا";
    dom.aiSearchButton.emit("click");
    const first = state.pending;
    assert.match(collectText(dom.aiSearchResults), /AI ئىزدەۋاتىدۇ/);
    pressReset(dom);
    assert.strictEqual(dom.searchInput.value, "");
    assert.strictEqual(dom.aiSearchResults.hidden, true);
    assert.strictEqual(collectText(dom.aiSearchResults), "");
    releaseFirst();
    await first;
    assert.doesNotMatch(collectText(dom.aiSearchResults), /كونا كىتاب/);
    assert.strictEqual(dom.aiSearchResults.hidden, true);
    assert.strictEqual(dom.searchResults.hidden, false);
    dom.searchInput.value = "يېڭى سوئال";
    dom.aiSearchButton.emit("click");
    const second = state.pending;
    releaseSecond();
    await second;
    assert.match(collectText(dom.aiSearchResults), /يېڭى كىتاب/);
    assert.strictEqual(dom.searchResults.hidden, true);
    assert.strictEqual(dom.aiSearchButton.disabled, false);
  });

  await test("تازىلاش clears an AI error, a loading state, and show-more results", async () => {
    const errorDom = createDom();
    const errorState = Ui.mountAiSearchUi({
      document: errorDom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => jsonRes(500, { ok: false, error: "secret-debug" })
    });
    errorDom.searchInput.value = "خاتالىق";
    errorDom.aiSearchButton.emit("click");
    await errorState.pending;
    assert.match(collectText(errorDom.aiSearchResults), /AI ئىزدەش ھازىرچە ئىشلىمەيدۇ/);
    pressReset(errorDom);
    assert.strictEqual(errorDom.searchInput.value, "");
    assert.strictEqual(errorDom.aiSearchResults.hidden, true);
    assert.strictEqual(collectText(errorDom.aiSearchResults), "");
    assert.strictEqual(errorDom.searchResults.hidden, false);
    assert.doesNotMatch(collectText(errorDom.aiSearchResults), /secret-debug/);

    let releaseLoading;
    const loadingDom = createDom();
    const loadingState = Ui.mountAiSearchUi({
      document: loadingDom.document,
      location: { hostname: "localhost" },
      fetchImpl: () => new Promise((resolve) => { releaseLoading = resolve; })
    });
    loadingDom.searchInput.value = "يۈك";
    loadingDom.aiSearchButton.emit("click");
    assert.match(collectText(loadingDom.aiSearchResults), /AI ئىزدەۋاتىدۇ/);
    pressReset(loadingDom);
    assert.strictEqual(loadingDom.aiSearchResults.hidden, true);
    assert.doesNotMatch(collectText(loadingDom.aiSearchResults), /AI ئىزدەۋاتىدۇ/);
    releaseLoading(jsonRes(200, { ok: true, results: [{ id: 3, title: "كېچىككەن", author: "A", price: 1, stock: 1 }] }));
    await loadingState.pending;
    assert.doesNotMatch(collectText(loadingDom.aiSearchResults), /كېچىككەن/);
    assert.strictEqual(loadingDom.searchResults.hidden, false);

    const moreDom = createDom();
    const moreState = Ui.mountAiSearchUi({
      document: moreDom.document,
      location: { hostname: "localhost" },
      fetchImpl: async () => jsonRes(200, {
        ok: true,
        results: Array.from({ length: 8 }, (_, index) => ({
          id: index + 1,
          title: "نەتىجە " + String(index + 1),
          author: "ئاپتور",
          price: 5,
          stock: 1
        }))
      })
    });
    moreDom.searchInput.value = "كۆپ";
    moreDom.aiSearchButton.emit("click");
    await moreState.pending;
    assert.strictEqual(countClass(moreDom.aiSearchResults, "ai-search-item"), 6);
    const more = findClass(moreDom.aiSearchResults, "ai-search-show-more");
    assert.ok(more);
    more.emit("click");
    assert.strictEqual(countClass(moreDom.aiSearchResults, "ai-search-item"), 8);
    pressReset(moreDom);
    assert.strictEqual(moreDom.searchInput.value, "");
    assert.strictEqual(countClass(moreDom.aiSearchResults, "ai-search-item"), 0);
    assert.strictEqual(findClass(moreDom.aiSearchResults, "ai-search-show-more"), null);
    assert.strictEqual(moreDom.aiSearchResults.hidden, true);
    assert.strictEqual(moreDom.searchResults.hidden, false);
    assert.strictEqual(moreDom.aiSearchButton.disabled, false);
  });

  await test("I: AI UI host allowlist stays isolated from Normal Search controls", () => {
    const ui = fs.readFileSync(path.join(root, "kutadgu-ai-search-ui.js"), "utf8");
    assert.match(ui, /isAllowedAiSearchHost/);
    assert.match(ui, /isProductionAiSearchHost/);
    assert.doesNotMatch(ui, /getElementById\(\s*["']searchButton["']\s*\)[\s\S]{0,80}disabled/);
    assert.match(ui, /onNormalSearchEnter/);
    assert.doesNotMatch(ui, /onNormalSearchEnter[\s\S]{0,200}preventDefault/);
    assert.match(ui, /getElementById\(\s*["']searchResults["']\s*\)/);
    assert.doesNotMatch(ui, /searchResults\.(innerHTML|textContent)\s*=/);
    assert.doesNotMatch(ui, /book_embeddings/);
    assert.doesNotMatch(ui, /service_role/);
  });
}

run().then(() => {
  if (failed) {
    console.error("\n" + failed + " AI Search 1F test(s) failed");
    process.exit(1);
  }
  console.log("stage-ai-search-1f-preview-ui-tests ok");
});
