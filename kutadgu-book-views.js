/*
  Public book-detail view counts.
  Reuses existing analytics book_view events. Does not rank search or listings.
  SessionStorage only — not a unique-person count.
*/
(function (root) {
  "use strict";

  var THRESHOLD = 50;
  var LABEL = "قېتىم كۆرۈلدى";
  var STORAGE_KEY = "kutadgu-book-views-counted";
  var EL_CLASS = "book-view-count";
  var STYLE_ID = "kutadgu-book-view-count-style";
  var STATS_TABLE = "book_view_stats";

  function isCanonicalBookId(value) {
    return /^[1-9][0-9]*$/.test(String(value == null ? "" : value).trim());
  }

  function canonicalFromTrackData(data) {
    var row = data && typeof data === "object" ? data : {};
    var raw = String(row.bookId || row.book_id || "").trim();
    if (isCanonicalBookId(raw)) return raw;
    return "";
  }

  function shouldShowTotalViews(total) {
    var n = Number(total);
    return Number.isFinite(n) && n >= THRESHOLD;
  }

  function formatTotalViews(total) {
    var n = Math.floor(Number(total));
    if (!Number.isFinite(n) || n < 0) return "";
    try {
      return n.toLocaleString("en-US");
    } catch (err) {
      return String(n);
    }
  }

  function viewCountText(total) {
    if (!shouldShowTotalViews(total)) return "";
    return "👁 " + formatTotalViews(total) + " " + LABEL;
  }

  function readCountedIds(storage) {
    if (!storage || typeof storage.getItem !== "function") return [];
    try {
      var parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(function (id) { return String(id); }).filter(isCanonicalBookId);
    } catch (err) {
      return [];
    }
  }

  function writeCountedIds(storage, ids) {
    if (!storage || typeof storage.setItem !== "function") return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch (err) {}
  }

  function hasCountedBookView(storage, bookId) {
    var id = String(bookId || "").trim();
    if (!isCanonicalBookId(id)) return false;
    return readCountedIds(storage).indexOf(id) !== -1;
  }

  function rememberBookView(storage, bookId) {
    var id = String(bookId || "").trim();
    if (!isCanonicalBookId(id)) return false;
    var ids = readCountedIds(storage);
    if (ids.indexOf(id) !== -1) return false;
    ids.push(id);
    writeCountedIds(storage, ids);
    return true;
  }

  function shouldRecordBookView(storage, bookId) {
    var id = String(bookId || "").trim();
    if (!isCanonicalBookId(id)) return false;
    if (hasCountedBookView(storage, id)) return false;
    rememberBookView(storage, id);
    return true;
  }

  function wrapTrack(originalTrack, storage) {
    var store = storage;
    return function wrappedTrack(name, data) {
      if (String(name || "") === "book_view") {
        var id = canonicalFromTrackData(data);
        if (!id || !shouldRecordBookView(store, id)) return;
      }
      return originalTrack.apply(this, arguments);
    };
  }

  function buildStatsRequest(bookId, cfg) {
    var id = String(bookId || "").trim();
    var config = cfg || {};
    var url = String(config.url || "").replace(/\/+$/, "");
    var key = String(config.anonKey || config.publishableKey || "");
    if (!isCanonicalBookId(id) || !url || !key) return null;
    return {
      url: url + "/rest/v1/" + STATS_TABLE + "?select=total_views&book_id=eq." + encodeURIComponent(id),
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        Accept: "application/json"
      }
    };
  }

  function parseTotalViews(payload) {
    var row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || typeof row !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(row, "total_views")) return null;
    var n = Number(row.total_views);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function createCountElement(doc, total) {
    var text = viewCountText(total);
    if (!text || !doc || typeof doc.createElement !== "function") return null;
    var el = doc.createElement("p");
    el.className = EL_CLASS;
    el.setAttribute("dir", "rtl");
    el.textContent = text;
    return el;
  }

  function hideViewCount(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== "function") return;
    rootEl.querySelectorAll("." + EL_CLASS).forEach(function (node) {
      node.remove();
    });
  }

  function mountViewCount(info, total) {
    if (!info) return null;
    hideViewCount(info);
    if (!shouldShowTotalViews(total)) return null;
    var el = createCountElement(info.ownerDocument || (typeof document !== "undefined" ? document : null), total);
    if (!el) return null;
    var author = info.querySelector && info.querySelector(".book-author");
    var title = info.querySelector && info.querySelector("h1");
    if (author && author.parentNode) author.after(el);
    else if (title && title.parentNode) title.after(el);
    else info.appendChild(el);
    return el;
  }

  function injectStyle(doc) {
    var documentRef = doc || (typeof document !== "undefined" ? document : null);
    if (!documentRef || documentRef.getElementById(STYLE_ID)) return;
    var style = documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".book-view-count{margin:0.2rem 0 0.55rem;padding:0;border:0;background:transparent;" +
      "color:var(--site-brown,#70503d);font-size:0.82rem;line-height:1.5;font-weight:500;opacity:0.88}" +
      "@media (max-width:640px){.book-view-count{font-size:0.78rem;margin-bottom:0.45rem}}";
    (documentRef.head || documentRef.documentElement).appendChild(style);
  }

  function isSkippedSurface() {
    if (typeof location === "undefined") return true;
    var file = (location.pathname.split("/").pop() || "").toLowerCase();
    return file === "admin.html" || file === "admin-quality-preview.html" || file === "reset-password.html" || file === "book-staff.html";
  }

  function isBookDetailDocument() {
    if (typeof document === "undefined" || typeof location === "undefined") return false;
    var Seo = root.KutadguBookSeo || {};
    if (Seo.isBookDetailPath && Seo.isBookDetailPath(location.pathname)) return true;
    if ((location.pathname.split("/").pop() || "").toLowerCase() === "book.html") return true;
    return !!document.querySelector(".book-detail-page,.book-detail-info");
  }

  function detailBookId() {
    // Wait for shop.js to authorize/hydrate the actual public book. This avoids
    // fetching/displaying stats from a URL id before the detail is validated.
    if (typeof document !== "undefined" && document.body && isCanonicalBookId(document.body.dataset.bookId)) {
      return String(document.body.dataset.bookId).trim();
    }
    return "";
  }

  function sessionStore() {
    try {
      return root.sessionStorage;
    } catch (err) {
      return null;
    }
  }

  function tryWrapAnalytics() {
    var A = root.KutadguAnalytics;
    if (!A || typeof A.track !== "function" || A.__kutadguViewDedupe) return !!A && A.__kutadguViewDedupe;
    var store = sessionStore();
    if (!store) return false;
    A.track = wrapTrack(A.track.bind(A), store);
    A.__kutadguViewDedupe = true;
    return true;
  }

  function installAnalyticsGuard() {
    tryWrapAnalytics();
    var current = root.KutadguAnalytics;
    try {
      Object.defineProperty(root, "KutadguAnalytics", {
        configurable: true,
        enumerable: true,
        get: function () { return current; },
        set: function (value) {
          current = value;
          tryWrapAnalytics();
        }
      });
    } catch (err) {
      var n = 0;
      var timer = setInterval(function () {
        n += 1;
        if (tryWrapAnalytics() || n > 40) clearInterval(timer);
      }, 25);
    }
    if (current) tryWrapAnalytics();
  }

  function paintFromStats(total) {
    if (typeof document === "undefined") return;
    var info = document.querySelector(".book-detail-info");
    if (!info) return;
    if (info.querySelector(".detail-unavailable-panel")) {
      hideViewCount(info);
      return;
    }
    mountViewCount(info, total);
  }

  var lastFetchedId = "";
  var fetchedOnce = Object.create(null);
  function fetchAndPaint() {
    if (!isBookDetailDocument()) return;
    var id = detailBookId();
    var info = typeof document !== "undefined" ? document.querySelector(".book-detail-info") : null;
    if (!id || !info) {
      if (info) hideViewCount(info);
      return;
    }
    if (info.querySelector(".detail-unavailable-panel")) {
      hideViewCount(info);
      return;
    }
    var cfg = root.KUTADGU_SUPABASE_CONFIG || {};
    var req = buildStatsRequest(id, cfg);
    if (!req || typeof fetch !== "function") return;
    if (fetchedOnce[id]) return;
    fetchedOnce[id] = true;
    lastFetchedId = id;
    fetch(req.url, { headers: req.headers, keepalive: true }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (payload) {
      if (detailBookId() !== lastFetchedId) return;
      var total = parseTotalViews(payload);
      if (total == null) {
        hideViewCount(info);
        return;
      }
      paintFromStats(total);
    }).catch(function () {
      hideViewCount(info);
    });
  }

  function boot() {
    if (typeof document === "undefined") return;
    if (isSkippedSurface()) return;
    installAnalyticsGuard();
    if (!isBookDetailDocument()) return;
    injectStyle(document);
    var queued = false;
    var schedule = function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        fetchAndPaint();
      }, 0);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
    try {
      if (document.body && typeof MutationObserver === "function") {
        new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["data-book-id"] });
      }
    } catch (err) {}
    var tries = 0;
    var poll = setInterval(function () {
      tries += 1;
      schedule();
      if (detailBookId() || tries > 40) clearInterval(poll);
    }, 120);
  }

  var api = {
    THRESHOLD: THRESHOLD,
    LABEL: LABEL,
    STORAGE_KEY: STORAGE_KEY,
    STATS_TABLE: STATS_TABLE,
    isCanonicalBookId: isCanonicalBookId,
    canonicalFromTrackData: canonicalFromTrackData,
    shouldShowTotalViews: shouldShowTotalViews,
    formatTotalViews: formatTotalViews,
    viewCountText: viewCountText,
    hasCountedBookView: hasCountedBookView,
    rememberBookView: rememberBookView,
    shouldRecordBookView: shouldRecordBookView,
    wrapTrack: wrapTrack,
    buildStatsRequest: buildStatsRequest,
    parseTotalViews: parseTotalViews,
    createCountElement: createCountElement,
    hideViewCount: hideViewCount,
    mountViewCount: mountViewCount
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguBookViews = api;
  boot();
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
