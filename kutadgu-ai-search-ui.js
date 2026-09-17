(function (root) {
  "use strict";

  /**
   * AI Search 1I-2 — approved-host homepage UI (Production + Preview + localhost).
   * Isolated from Normal Search ranking/Enter handling.
   * When AI output is shown, hide stale #searchResults so zero-result
   * Normal Search copy cannot contradict AI results. Never preventDefault Enter.
   */

  var API_PATH = "/api/ai-search";
  var TIMEOUT_MS = 20000;
  var MIN_QUERY_CHARS = 2;
  var MAX_QUERY_CHARS = 300;
  var COVER_FALLBACK = "";
  var COVER_MISSING_LABEL = "مۇقاۋا يوق";
  var FAIL_MESSAGE = "AI ئىزدەش ھازىرچە ئىشلىمەيدۇ. ئادەتتىكى ئىزدەشنى ئىشلىتىپ كۆرۈڭ.";
  var EMPTY_QUERY_MESSAGE = "ئىزدەش سۆزىنى كىرگۈزۈڭ.";
  var NO_RESULTS_MESSAGE = "AI ئىزدەش نەتىجىسى تېپىلمىدى.";
  var LOADING_MESSAGE = "AI ئىزدەۋاتىدۇ…";
  var RESULTS_HEADING = "AI ئىزدەش نەتىجىسى";
  var SHOW_MORE_LABEL = "تېخىمۇ كۆپ كۆرسەت";
  var INITIAL_VISIBLE_COUNT = 6;
  var REVEAL_BATCH_SIZE = 6;
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

  function isProductionAiSearchHost(locationLike) {
    var host = hostnameOf(locationLike);
    return !!(host && PRODUCTION_HOSTS[host]);
  }

  function isLocalAiSearchHost(host) {
    return host === "localhost" || host === "127.0.0.1";
  }

  function isAllowedAiSearchHost(locationLike) {
    var host = hostnameOf(locationLike);
    if (!host) return false;
    if (isProductionAiSearchHost({ hostname: host })) return true;
    if (isLocalAiSearchHost(host)) return true;
    return isKutadguVercelPreviewHost(host);
  }

  function isPreviewAiSearchHost(locationLike) {
    var host = hostnameOf(locationLike);
    if (!host) return false;
    if (isProductionAiSearchHost({ hostname: host })) return false;
    if (isLocalAiSearchHost(host)) return true;
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

  function isSampleDemoCover(src) {
    return /(?:^|\/)sample-book-cover\.png(?:$|\?)/i.test(String(src == null ? "" : src).trim());
  }

  function safeCoverSrc(raw) {
    var api = root && root.KutadguSafeUrl;
    var src = "";
    if (api && typeof api.safeCoverUrl === "function") {
      src = api.safeCoverUrl(raw, { fallback: "" });
    } else {
      var t = String(raw == null ? "" : raw).trim();
      if (!t) src = "";
      else if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(t)) src = "";
      else if (/[<>"'\s]/.test(t) || t.indexOf("//") === 0) src = "";
      else if (/^https?:\/\//i.test(t) || (t.charAt(0) === "/" && t.charAt(1) !== "/")) src = t;
      else if (/^[a-z][a-z0-9+.-]*:/i.test(t)) src = "";
      else src = t;
    }
    if (!src || isSampleDemoCover(src)) return "";
    return src;
  }

  function createCoverPlaceholder(doc, hidden) {
    var ph = doc.createElement("span");
    ph.className = "ai-search-cover-placeholder";
    ph.setAttribute("role", "img");
    ph.setAttribute("aria-label", COVER_MISSING_LABEL);
    ph.textContent = COVER_MISSING_LABEL;
    if (hidden) ph.setAttribute("hidden", "");
    return ph;
  }

  function findCoverPlaceholder(coverWrap) {
    var kids = (coverWrap && coverWrap.children) || [];
    for (var i = 0; i < kids.length; i += 1) {
      if (kids[i] && kids[i].className === "ai-search-cover-placeholder") return kids[i];
    }
    return null;
  }

  function revealCoverPlaceholder(coverWrap, img) {
    if (img) {
      img.hidden = true;
      img.setAttribute("hidden", "");
      img.setAttribute("aria-hidden", "true");
      if (img.parentNode && typeof img.parentNode.removeChild === "function") {
        img.parentNode.removeChild(img);
      }
    }
    var ph = findCoverPlaceholder(coverWrap);
    if (ph) {
      ph.hidden = false;
      if (typeof ph.removeAttribute === "function") ph.removeAttribute("hidden");
    }
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

  function usableRows(rows) {
    var out = [];
    (rows || []).forEach(function (row) {
      if (publicBookHref(row && row.id)) out.push(row);
    });
    return out;
  }

  function findShowMoreButton(box) {
    var kids = (box && box.children) || [];
    for (var i = 0; i < kids.length; i += 1) {
      if (kids[i] && kids[i].className === "ai-search-show-more") return kids[i];
    }
    return null;
  }

  function appendResultCard(doc, list, row) {
    var href = publicBookHref(row && row.id);
    if (!href || !doc || !list) return;
    var item = doc.createElement("article");
    item.className = "ai-search-item";

    var coverWrap = doc.createElement("a");
    coverWrap.className = "ai-search-cover";
    coverWrap.setAttribute("href", href);
    var src = safeCoverSrc(row.image_url);
    var placeholder = createCoverPlaceholder(doc, !!src);
    if (src) {
      var img = doc.createElement("img");
      img.setAttribute("src", src);
      img.setAttribute("data-cover-src", src);
      img.setAttribute("alt", String(row.title == null ? "كىتاب" : row.title) + " مۇقاۋىسى");
      img.setAttribute("width", "72");
      img.setAttribute("height", "104");
      img.setAttribute("loading", "lazy");
      img.addEventListener("error", function onCoverError() {
        img.removeEventListener("error", onCoverError);
        revealCoverPlaceholder(coverWrap, img);
      });
      coverWrap.appendChild(img);
    }
    coverWrap.appendChild(placeholder);
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
  }

  function syncShowMore(box, doc) {
    if (!box || !doc) return;
    var all = box._aiAllRows || [];
    var visible = Number(box._aiVisibleCount) || 0;
    var btn = findShowMoreButton(box);
    if (visible >= all.length) {
      if (btn && btn.parentNode && typeof btn.parentNode.removeChild === "function") {
        btn.parentNode.removeChild(btn);
      }
      return;
    }
    if (!btn) {
      btn = doc.createElement("button");
      btn.className = "ai-search-show-more";
      btn.setAttribute("type", "button");
      btn.textContent = SHOW_MORE_LABEL;
      btn.addEventListener("click", function onShowMore(event) {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        revealMore(box, doc, REVEAL_BATCH_SIZE);
      });
      box.appendChild(btn);
    }
  }

  function revealMore(box, doc, batch) {
    if (!box) return;
    var all = box._aiAllRows || [];
    var list = box._aiList;
    if (!list) return;
    var start = Number(box._aiVisibleCount) || 0;
    var size = Number(batch) > 0 ? Number(batch) : REVEAL_BATCH_SIZE;
    var end = Math.min(start + size, all.length);
    var i;
    for (i = start; i < end; i += 1) {
      appendResultCard(doc, list, all[i]);
    }
    box._aiVisibleCount = end;
    syncShowMore(box, doc);
  }

  function renderResults(box, rows, documentRef) {
    var doc = documentRef || (box && box.ownerDocument) || root.document;
    clearNode(box);
    box.hidden = false;
    box._aiAllRows = [];
    box._aiVisibleCount = 0;
    box._aiList = null;
    var heading = text(doc, "p", RESULTS_HEADING, "ai-search-heading");
    heading.setAttribute("role", "status");
    box.appendChild(heading);
    var all = usableRows(rows);
    box._aiAllRows = all;
    if (!all.length) {
      box.appendChild(text(doc, "p", NO_RESULTS_MESSAGE, "ai-search-message"));
      return;
    }
    var list = doc.createElement("div");
    list.className = "ai-search-list";
    box._aiList = list;
    box.appendChild(list);
    revealMore(box, doc, INITIAL_VISIBLE_COUNT);
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
    var normalBox = doc.getElementById("searchResults");
    var searchActionBtn = doc.getElementById("searchButton");
    var state = { mounted: true, visible: false, fetchCalls: 0, aborted: false };

    if (!aiBtn || !aiBox || !input) return state;

    var allowed = isAllowedAiSearchHost(loc);
    state.visible = allowed;
    if (!allowed) {
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

    function concealNormalSearch() {
      if (normalBox) normalBox.hidden = true;
    }

    function revealNormalSearch() {
      if (normalBox) normalBox.hidden = false;
    }

    function presentAiMessage(message, kind) {
      showMessage(doc, aiBox, message, kind);
      concealNormalSearch();
    }

    function presentAiResults(rows) {
      renderResults(aiBox, rows, doc);
      concealNormalSearch();
    }

    function hideAiBox() {
      generation += 1;
      if (controller) {
        try { controller.abort(); } catch (err) {}
        controller = null;
      }
      clearNode(aiBox);
      aiBox.hidden = true;
      revealNormalSearch();
      restoreButton();
    }

    input.addEventListener("input", hideAiBox);
    input.addEventListener("keydown", function onNormalSearchEnter(event) {
      if (!event || event.key !== "Enter") return;
      hideAiBox();
    });
    if (searchActionBtn && typeof searchActionBtn.addEventListener === "function") {
      searchActionBtn.addEventListener("click", hideAiBox);
    }

    aiBtn.addEventListener("click", function onAiClick(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (!isAllowedAiSearchHost(loc)) return;
      if (running) return;
      var trimmed = trimQuery(input.value);
      if (queryTooShort(trimmed) || queryTooLong(trimmed)) {
        presentAiMessage(EMPTY_QUERY_MESSAGE, "hint");
        return;
      }
      if (typeof fetchImpl !== "function") {
        presentAiMessage(FAIL_MESSAGE, "error");
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
      presentAiMessage(LOADING_MESSAGE, "loading");
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
          presentAiMessage(FAIL_MESSAGE, "error");
          return;
        }
        presentAiResults(parsed.results);
      }).then(function () {
        clearTimeout(timer);
        if (gen === generation) restoreButton();
      }, function () {
        clearTimeout(timer);
        if (gen === generation) {
          presentAiMessage(FAIL_MESSAGE, "error");
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
    COVER_MISSING_LABEL: COVER_MISSING_LABEL,
    SHOW_MORE_LABEL: SHOW_MORE_LABEL,
    INITIAL_VISIBLE_COUNT: INITIAL_VISIBLE_COUNT,
    REVEAL_BATCH_SIZE: REVEAL_BATCH_SIZE,
    FAIL_MESSAGE: FAIL_MESSAGE,
    PRODUCTION_HOSTS: PRODUCTION_HOSTS,
    isProductionAiSearchHost: isProductionAiSearchHost,
    isKutadguVercelPreviewHost: isKutadguVercelPreviewHost,
    isAllowedAiSearchHost: isAllowedAiSearchHost,
    isPreviewAiSearchHost: isPreviewAiSearchHost,
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
