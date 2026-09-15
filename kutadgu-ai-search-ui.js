(function (root) {
  "use strict";

  /**
   * AI Search 1F — preview-only homepage UI.
   * Isolated from Normal Search. Never intercepts Enter or #searchResults.
   */

  var API_PATH = "/api/ai-search";
  var TIMEOUT_MS = 20000;
  var MIN_QUERY_CHARS = 2;
  var MAX_QUERY_CHARS = 300;
  var COVER_FALLBACK = "/sample-book-cover.png";
  var FAIL_MESSAGE = "AI ئىزدەش ھازىرچە ئىشلىمەيدۇ. ئادەتتىكى ئىزدەشنى ئىشلىتىپ كۆرۈڭ.";
  var EMPTY_QUERY_MESSAGE = "ئىزدەش سۆزىنى كىرگۈزۈڭ.";
  var NO_RESULTS_MESSAGE = "AI ئىزدەش نەتىجىسى تېپىلمىدى.";
  var LOADING_MESSAGE = "AI ئىزدەۋاتىدۇ…";
  var RESULTS_HEADING = "AI ئىزدەش نەتىجىسى";
  var PRODUCTION_HOSTS = {
    "www.kutadgubilik.com": true,
    "kutadgubilik.com": true,
    "kutadgu-bilig-kitab.vercel.app": true
  };

  function hostnameOf(locationLike) {
    return String((locationLike && locationLike.hostname) || "")
      .toLowerCase()
      .replace(/:\d+$/, "")
      .replace(/\.$/, "");
  }

  var KUTADGU_VERCEL_PREVIEW_RE = /^kutadgu-bilig-kitab-[a-z0-9-]+-kutadgu-bilig-kitabhanisi\.vercel\.app$/;

  function isKutadguVercelPreviewHost(host) {
    if (!host || host === "kutadgu-bilig-kitab.vercel.app") return false;
    return KUTADGU_VERCEL_PREVIEW_RE.test(host);
  }

  function isPreviewAiSearchHost(locationLike) {
    var host = hostnameOf(locationLike);
    if (!host) return false;
    if (PRODUCTION_HOSTS[host]) return false;
    if (host === "localhost" || host === "127.0.0.1") return true;
    return isKutadguVercelPreviewHost(host);
  }

  function trimQuery(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function queryTooShort(trimmed) {
    return !trimmed || trimmed.length < MIN_QUERY_CHARS;
  }

  function queryTooLong(trimmed) {
    return trimmed.length > MAX_QUERY_CHARS;
  }

  function publicBookHref(id) {
    var num = Number(id);
    if (!Number.isInteger(num) || num <= 0) return "";
    return "/book/" + String(num);
  }

  function safeCoverSrc(raw) {
    var api = root && root.KutadguSafeUrl;
    if (api && typeof api.safeCoverUrl === "function") {
      return api.safeCoverUrl(raw, { fallback: COVER_FALLBACK });
    }
    var t = String(raw == null ? "" : raw).trim();
    if (!t) return COVER_FALLBACK;
    if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(t)) return COVER_FALLBACK;
    if (/[<>"'\s]/.test(t) || t.indexOf("//") === 0) return COVER_FALLBACK;
    if (/^https?:\/\//i.test(t) || (t.charAt(0) === "/" && t.charAt(1) !== "/")) return t;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return COVER_FALLBACK;
    return t;
  }

  function stockStatus(stock) {
    if (stock == null || stock === "") return "";
    var n = Number(stock);
    if (!Number.isFinite(n)) return "";
    return n > 0 ? "بار" : "تۈگىدى";
  }

  function priceLabel(price) {
    if (price == null || price === "") return "";
    var n = Number(price);
    if (!Number.isFinite(n)) return "";
    return String(n) + " ₺";
  }

  function text(doc, tag, value, className) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? "" : String(value);
    return node;
  }

  function clearNode(node) {
    if (!node) return;
    if (typeof node.replaceChildren === "function") {
      node.replaceChildren();
      return;
    }
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function showMessage(doc, box, message, kind) {
    if (!box || !doc) return;
    clearNode(box);
    box.hidden = false;
    box.appendChild(text(doc, "p", message, "ai-search-message" + (kind ? " is-" + kind : "")));
  }

  function renderResults(box, rows, documentRef) {
    var doc = documentRef || (box && box.ownerDocument) || root.document;
    clearNode(box);
    box.hidden = false;
    var heading = text(doc, "p", RESULTS_HEADING, "ai-search-heading");
    heading.setAttribute("role", "status");
    box.appendChild(heading);
    if (!rows.length) {
      box.appendChild(text(doc, "p", NO_RESULTS_MESSAGE, "ai-search-message"));
      return;
    }
    var list = doc.createElement("div");
    list.className = "ai-search-list";
    rows.forEach(function (row) {
      var href = publicBookHref(row && row.id);
      if (!href) return;
      var item = doc.createElement("article");
      item.className = "ai-search-item";

      var coverWrap = doc.createElement("a");
      coverWrap.className = "ai-search-cover";
      coverWrap.setAttribute("href", href);
      var img = doc.createElement("img");
      var src = safeCoverSrc(row.image_url);
      img.setAttribute("src", src);
      img.setAttribute("data-cover-src", src);
      img.setAttribute("alt", String(row.title == null ? "كىتاب" : row.title) + " مۇقاۋىسى");
      img.setAttribute("width", "56");
      img.setAttribute("height", "80");
      img.setAttribute("loading", "lazy");
      img.addEventListener("error", function onCoverError() {
        img.removeEventListener("error", onCoverError);
        if (img.getAttribute("src") !== COVER_FALLBACK) {
          img.setAttribute("src", COVER_FALLBACK);
          img.setAttribute("data-cover-src", COVER_FALLBACK);
        }
      });
      coverWrap.appendChild(img);
      item.appendChild(coverWrap);

      var info = doc.createElement("div");
      info.className = "ai-search-info";
      var titleLink = doc.createElement("a");
      titleLink.className = "ai-search-title";
      titleLink.setAttribute("href", href);
      titleLink.textContent = String(row.title == null ? "" : row.title);
      info.appendChild(titleLink);
      if (row.author) info.appendChild(text(doc, "p", String(row.author), "ai-search-author"));
      if (row.category) info.appendChild(text(doc, "p", String(row.category), "ai-search-category"));
      var meta = doc.createElement("p");
      meta.className = "ai-search-meta";
      var bits = [];
      var price = priceLabel(row.price);
      var stock = stockStatus(row.stock);
      if (price) bits.push(price);
      if (stock) bits.push(stock);
      meta.textContent = bits.join(" · ");
      if (bits.length) info.appendChild(meta);
      item.appendChild(info);
      list.appendChild(item);
    });
    box.appendChild(list);
    if (!(list.children && list.children.length)) {
      box.appendChild(text(doc, "p", NO_RESULTS_MESSAGE, "ai-search-message"));
    }
  }

  function parsePayload(payload) {
    if (!payload || typeof payload !== "object" || payload.ok !== true) return { fail: true };
    if (!Array.isArray(payload.results)) return { fail: true };
    return { fail: false, results: payload.results };
  }

  function mountAiSearchUi(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var loc = opts.location || (typeof location !== "undefined" ? location : { hostname: "" });
    var fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    var timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS;
    if (!doc || typeof doc.getElementById !== "function") {
      return { mounted: false, visible: false, fetchCalls: 0 };
    }

    var input = doc.getElementById("searchInput");
    var aiBtn = doc.getElementById("aiSearchButton");
    var aiBox = doc.getElementById("aiSearchResults");
    var state = { mounted: true, visible: false, fetchCalls: 0, aborted: false };

    if (!aiBtn || !aiBox || !input) return state;

    var preview = isPreviewAiSearchHost(loc);
    state.visible = preview;
    if (!preview) {
      aiBtn.hidden = true;
      aiBox.hidden = true;
      return state;
    }

    aiBtn.hidden = false;
    aiBtn.disabled = false;

    var controller = null;
    var generation = 0;
    var running = false;

    function restoreButton() {
      running = false;
      aiBtn.disabled = false;
      aiBtn.removeAttribute("aria-busy");
    }

    function hideAiBox() {
      generation += 1;
      if (controller) {
        try { controller.abort(); } catch (err) {}
        controller = null;
      }
      clearNode(aiBox);
      aiBox.hidden = true;
      restoreButton();
    }

    input.addEventListener("input", hideAiBox);

    aiBtn.addEventListener("click", function onAiClick(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (!isPreviewAiSearchHost(loc)) return;
      if (running) return;
      var trimmed = trimQuery(input.value);
      if (queryTooShort(trimmed) || queryTooLong(trimmed)) {
        showMessage(doc, aiBox, EMPTY_QUERY_MESSAGE, "hint");
        return;
      }
      if (typeof fetchImpl !== "function") {
        showMessage(doc, aiBox, FAIL_MESSAGE, "error");
        return;
      }

      running = true;
      aiBtn.disabled = true;
      aiBtn.setAttribute("aria-busy", "true");
      var gen = (generation += 1);
      controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
      }, timeoutMs);
      showMessage(doc, aiBox, LOADING_MESSAGE, "loading");
      state.fetchCalls += 1;
      state.pending = Promise.resolve(fetchImpl(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
        cache: "no-store",
        signal: controller && controller.signal
      })).then(function (response) {
        if (gen !== generation) return null;
        if (!response || typeof response.json !== "function") return { fail: true };
        return Promise.resolve(response.json()).then(function (payload) {
          if (gen !== generation) return null;
          if (!response.ok) return { fail: true };
          return parsePayload(payload);
        }, function () {
          return { fail: true };
        });
      }, function () {
        if (gen !== generation) return null;
        return { fail: true, aborted: true };
      }).then(function (parsed) {
        if (gen !== generation || parsed == null) return;
        if (parsed.fail) {
          showMessage(doc, aiBox, FAIL_MESSAGE, "error");
          return;
        }
        renderResults(aiBox, parsed.results, doc);
      }).then(function () {
        clearTimeout(timer);
        if (gen === generation) restoreButton();
      }, function () {
        clearTimeout(timer);
        if (gen === generation) {
          showMessage(doc, aiBox, FAIL_MESSAGE, "error");
          restoreButton();
        }
      });
    });

    return state;
  }

  function boot() {
    if (typeof document === "undefined") return;
    mountAiSearchUi();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  var api = {
    API_PATH: API_PATH,
    TIMEOUT_MS: TIMEOUT_MS,
    MIN_QUERY_CHARS: MIN_QUERY_CHARS,
    MAX_QUERY_CHARS: MAX_QUERY_CHARS,
    COVER_FALLBACK: COVER_FALLBACK,
    FAIL_MESSAGE: FAIL_MESSAGE,
    PRODUCTION_HOSTS: PRODUCTION_HOSTS,
    isPreviewAiSearchHost: isPreviewAiSearchHost,
    isKutadguVercelPreviewHost: isKutadguVercelPreviewHost,
    trimQuery: trimQuery,
    publicBookHref: publicBookHref,
    safeCoverSrc: safeCoverSrc,
    parsePayload: parsePayload,
    renderResults: renderResults,
    mountAiSearchUi: mountAiSearchUi
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KutadguAiSearchUi = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : {});
