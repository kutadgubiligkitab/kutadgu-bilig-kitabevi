/*
  Public book engagement totals.
  Normal analytics (book_view, add_to_cart) stay unchanged.
  Displayed total_views increases only through dedicated engagement events:
    book_engagement_detail — book detail opened
    book_engagement_cart — storefront add-to-cart succeeded
  Same browser, same book, same action: 3-hour local cooldown.
  Counting never blocks opening a book or adding to cart.
*/
(function (root) {
  "use strict";

  var THRESHOLD = 20;
  var LABEL = "قېتىم كۆرۈلدى";
  var BOOK_ENGAGEMENT_COOLDOWN_MS = 3 * 60 * 60 * 1000;
  var STORAGE_KEY = "kutadgu-book-engagement-cooldown";
  var EL_CLASS = "book-view-count";
  var COMPACT_CLASS = "book-view-count-compact";
  var STYLE_ID = "kutadgu-book-view-count-style";
  var STATS_TABLE = "book_view_stats";
  var BATCH_SIZE = 80;
  var CACHE_MS = 30000;
  var DETAIL_EVENT = "book_engagement_detail";
  var CART_EVENT = "book_engagement_cart";
  var CARD_SELECTOR = "[data-live-book-id], .book-card, .advanced-search-result, .home-feature-card, .shop-mini-card, .favorite-card, .premium-book-card, .ai-search-item, .home-carousel-card";
  var PRICE_SELECTOR = ".book-price, .advanced-search-price, .home-feature-bottom, .home-carousel-bottom, .favorite-card-row, .shop-mini-price, .premium-card-price, .ai-search-meta";
  var INFO_SELECTOR = ".book-info, .advanced-search-info, .home-feature-info, .home-carousel-info, .favorite-card-info, .ai-search-info, .premium-card-link";

  var statsCache = Object.create(null);
  var refreshTokens = Object.create(null);
  var bookTokens = Object.create(null);
  var inflight = Object.create(null);

  function isCanonicalBookId(value) {
    return /^[1-9][0-9]*$/.test(String(value == null ? "" : value).trim());
  }

  function canonicalFromTrackData(data) {
    var row = data && typeof data === "object" ? data : {};
    var raw = String(row.bookId || row.book_id || "").trim();
    if (isCanonicalBookId(raw)) return raw;
    return "";
  }

  function isEngagementAction(action) {
    return action === "detail" || action === "cart";
  }

  function engagementStorageKey(action, bookId) {
    return String(action) + ":" + String(bookId);
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

  function compactViewCountText(total) {
    if (!shouldShowTotalViews(total)) return "";
    return "👁 " + formatTotalViews(total);
  }

  function viewCountAriaLabel(total) {
    if (!shouldShowTotalViews(total)) return "";
    return formatTotalViews(total) + " " + LABEL;
  }

  function localStore() {
    try {
      return root.localStorage;
    } catch (err) {
      return null;
    }
  }

  function readCooldownMap(storage) {
    if (!storage || typeof storage.getItem !== "function") return {};
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw == null || raw === "") return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed;
    } catch (err) {
      return {};
    }
  }

  function writeCooldownMap(storage, map) {
    if (!storage || typeof storage.setItem !== "function") return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (err) {}
  }

  function lastEngagementAt(storage, action, bookId) {
    try {
      var map = readCooldownMap(storage);
      var value = Number(map[engagementStorageKey(action, bookId)]);
      if (!Number.isFinite(value) || value < 0) return null;
      return value;
    } catch (err) {
      return null;
    }
  }

  function engagementAllowed(storage, action, bookId, now) {
    var id = String(bookId || "").trim();
    var at = Number(now);
    if (!isEngagementAction(action) || !isCanonicalBookId(id) || !Number.isFinite(at)) return false;
    var last = lastEngagementAt(storage, action, id);
    if (last == null) return true;
    return at - last >= BOOK_ENGAGEMENT_COOLDOWN_MS;
  }

  function rememberEngagement(storage, action, bookId, now) {
    var id = String(bookId || "").trim();
    var at = Number(now);
    if (!isEngagementAction(action) || !isCanonicalBookId(id) || !Number.isFinite(at)) return false;
    try {
      var map = readCooldownMap(storage);
      map[engagementStorageKey(action, id)] = at;
      writeCooldownMap(storage, map);
      return true;
    } catch (err) {
      return false;
    }
  }

  function claimEngagement(storage, action, bookId, now) {
    try {
      if (!engagementAllowed(storage, action, bookId, now)) return false;
      rememberEngagement(storage, action, bookId, now);
      return true;
    } catch (err) {
      return true;
    }
  }

  function eventNameForAction(action) {
    if (action === "detail") return DETAIL_EVENT;
    if (action === "cart") return CART_EVENT;
    return "";
  }

  function recordEngagement(action, bookId, options) {
    try {
      var opts = options || {};
      var id = String(bookId || "").trim();
      var now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
      var storage = Object.prototype.hasOwnProperty.call(opts, "storage") ? opts.storage : localStore();
      if (!isEngagementAction(action) || !isCanonicalBookId(id)) return { sent: false, reason: "invalid" };
      if (!engagementAllowed(storage, action, id, now)) return { sent: false, reason: "cooldown" };
      var track = opts.track;
      if (typeof track !== "function") {
        var analytics = root.KutadguAnalytics;
        track = analytics && analytics.track;
      }
      if (typeof track !== "function") return { sent: false, reason: "no-track" };
      var eventName = eventNameForAction(action);
      var result;
      try {
        result = track(eventName, { bookId: id });
      } catch (err) {
        return { sent: false, reason: "track" };
      }
      rememberEngagement(storage, action, id, now);
      var accepted = { sent: true, eventName: eventName, bookId: id };
      var refresh = function () {
        if (opts.refresh === false) return;
        refreshDisplayed(id, opts);
      };
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).then(function (value) {
          if (value === false || (value && value.ok === false)) {
            forgetEngagement(storage, action, id);
            return { sent: false, reason: "rejected", bookId: id };
          }
          refresh();
          return accepted;
        }, function () {
          forgetEngagement(storage, action, id);
          return { sent: false, reason: "rejected", bookId: id };
        });
      }
      refresh();
      return accepted;
    } catch (err) {
      return { sent: false, reason: "error" };
    }
  }

  function forgetEngagement(storage, action, bookId) {
    try {
      var map = readCooldownMap(storage);
      delete map[engagementStorageKey(action, bookId)];
      writeCooldownMap(storage, map);
    } catch (err) {}
  }

  function wrapTrack(originalTrack, storage, nowFn) {
    return function wrappedTrack(name, data) {
      var result = originalTrack.apply(this, arguments);
      try {
        if (String(name || "") === "book_view") {
          var id = canonicalFromTrackData(data);
          var now = typeof nowFn === "function" ? nowFn() : Date.now();
          recordEngagement("detail", id, {
            storage: storage,
            now: now,
            refresh: true
          });
        }
      } catch (err) {}
      return result;
    };
  }

  function supabaseConfig(override) {
    var config = override || root.KUTADGU_SUPABASE_CONFIG || {};
    return {
      url: String(config.url || "").replace(/\/+$/, ""),
      key: String(config.anonKey || config.publishableKey || "")
    };
  }

  function buildBatchStatsRequest(ids, cfg) {
    var config = supabaseConfig(cfg);
    var clean = [];
    (ids || []).forEach(function (id) {
      var value = String(id || "").trim();
      if (isCanonicalBookId(value) && clean.indexOf(value) === -1) clean.push(value);
    });
    if (!clean.length || !config.url || !config.key) return [];
    var requests = [];
    var index;
    for (index = 0; index < clean.length; index += BATCH_SIZE) {
      var part = clean.slice(index, index + BATCH_SIZE);
      requests.push({
        url: config.url + "/rest/v1/" + STATS_TABLE + "?select=book_id,total_views&book_id=in.(" + part.join(",") + ")",
        headers: {
          apikey: config.key,
          Authorization: "Bearer " + config.key,
          Accept: "application/json"
        },
        ids: part
      });
    }
    return requests;
  }

  function buildStatsRequest(bookId, cfg) {
    var requests = buildBatchStatsRequest([bookId], cfg);
    return requests.length ? requests[0] : null;
  }

  function parseTotalViews(payload) {
    var rows = parseStatsRows(payload);
    if (!rows.length) return null;
    return rows[0].total;
  }

  function parseStatsRows(payload) {
    var list = Array.isArray(payload) ? payload : [];
    var out = [];
    list.forEach(function (row) {
      if (!row || typeof row !== "object") return;
      if (!Object.prototype.hasOwnProperty.call(row, "total_views")) return;
      var id = String(row.book_id == null ? "" : row.book_id).trim();
      var total = Number(row.total_views);
      if (!isCanonicalBookId(id) || !Number.isFinite(total)) return;
      out.push({ bookId: id, total: total });
    });
    return out;
  }

  function resetStatsCache() {
    statsCache = Object.create(null);
    refreshTokens = Object.create(null);
    bookTokens = Object.create(null);
    inflight = Object.create(null);
  }

  function cacheGet(id, now) {
    var row = statsCache[String(id)];
    if (!row) return null;
    if (Number(now) - row.at > CACHE_MS) return null;
    return row.total;
  }

  function cacheSet(id, total, now) {
    var at = Number(now);
    statsCache[String(id)] = { total: total, at: Number.isFinite(at) ? at : Date.now() };
  }

  function cacheDrop(id) {
    delete statsCache[String(id)];
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
      if (node.className && String(node.className).indexOf(COMPACT_CLASS) !== -1) return;
      node.remove();
    });
  }

  function detailCountNodes(info) {
    if (!info || typeof info.querySelectorAll !== "function") return [];
    return Array.prototype.filter.call(info.querySelectorAll("." + EL_CLASS), function (node) {
      return String(node.className || "").indexOf(COMPACT_CLASS) === -1;
    });
  }

  function mountViewCount(info, total) {
    if (!info) return null;
    var nodes = detailCountNodes(info);
    if (!shouldShowTotalViews(total)) {
      nodes.forEach(function (node) { node.remove(); });
      return null;
    }
    var text = viewCountText(total);
    if (nodes.length === 1 && nodes[0].textContent === text) return nodes[0];
    nodes.forEach(function (node) { node.remove(); });
    var el = createCountElement(info.ownerDocument || (typeof document !== "undefined" ? document : null), total);
    if (!el) return null;
    var author = info.querySelector && info.querySelector(".book-author");
    var title = info.querySelector && info.querySelector("h1");
    if (author && author.parentNode) author.after(el);
    else if (title && title.parentNode) title.after(el);
    else info.appendChild(el);
    return el;
  }

  function createCompactElement(doc, total, bookId) {
    var text = compactViewCountText(total);
    if (!text || !doc || typeof doc.createElement !== "function") return null;
    var el = doc.createElement("p");
    el.className = EL_CLASS + " " + COMPACT_CLASS;
    el.setAttribute("dir", "rtl");
    el.setAttribute("data-view-for", String(bookId));
    el.setAttribute("aria-label", viewCountAriaLabel(total));
    el.textContent = text;
    return el;
  }

  function compactNodes(card) {
    if (!card || typeof card.querySelectorAll !== "function") return [];
    return Array.prototype.slice.call(card.querySelectorAll("." + COMPACT_CLASS));
  }

  function mountCompactCount(card, total) {
    if (!card || typeof card.getAttribute !== "function") return null;
    var id = String(card.getAttribute("data-live-book-id") || "").trim();
    var nodes = compactNodes(card);
    if (!isCanonicalBookId(id) || !shouldShowTotalViews(total)) {
      nodes.forEach(function (node) { node.remove(); });
      return null;
    }
    var text = compactViewCountText(total);
    var aria = viewCountAriaLabel(total);
    var match = null;
    nodes.forEach(function (node) {
      var same = String(node.getAttribute("data-view-for") || "") === id &&
        node.textContent === text &&
        String(node.getAttribute("aria-label") || "") === aria;
      if (same && !match) match = node;
    });
    if (match && nodes.length === 1) return match;
    if (match) {
      nodes.forEach(function (node) { if (node !== match) node.remove(); });
      return match;
    }
    var reusable = nodes[0] || null;
    nodes.slice(1).forEach(function (node) { node.remove(); });
    if (reusable) {
      if (reusable.getAttribute("data-view-for") !== id) reusable.setAttribute("data-view-for", id);
      if (reusable.getAttribute("aria-label") !== aria) reusable.setAttribute("aria-label", aria);
      if (reusable.getAttribute("dir") !== "rtl") reusable.setAttribute("dir", "rtl");
      if (reusable.textContent !== text) reusable.textContent = text;
      return reusable;
    }
    var doc = card.ownerDocument || (typeof document !== "undefined" ? document : null);
    var el = createCompactElement(doc, total, id);
    if (!el) return null;
    var anchor = card.querySelector && card.querySelector(PRICE_SELECTOR);
    if (anchor && anchor.parentNode && typeof anchor.parentNode.insertBefore === "function") anchor.parentNode.insertBefore(el, anchor);
    else {
      var info = card.querySelector && card.querySelector(INFO_SELECTOR);
      if (info && typeof info.appendChild === "function") info.appendChild(el);
      else if (typeof card.appendChild === "function") card.appendChild(el);
    }
    return el;
  }

  function applyStatsToCard(card, bookId, total) {
    if (!card || typeof card.getAttribute !== "function") return false;
    if (String(card.getAttribute("data-live-book-id") || "") !== String(bookId)) return false;
    if (total == null || !shouldShowTotalViews(total)) {
      mountCompactCount(card, 0);
      return true;
    }
    return !!mountCompactCount(card, total);
  }

  function readBoundId(node) {
    if (!node || typeof node.getAttribute !== "function") return "";
    var names = ["data-live-book-id", "data-premium-book-id", "data-cart-id", "data-fav-id", "data-premium-cart", "data-premium-favorite", "data-ai-cover-book", "data-cover-book", "data-remove-favorite"];
    var i;
    for (i = 0; i < names.length; i += 1) {
      var value = String(node.getAttribute(names[i]) || "").trim();
      if (isCanonicalBookId(value)) return value;
    }
    return "";
  }

  function stampCard(card) {
    if (!looksLikeCard(card) || typeof card.getAttribute !== "function") return "";
    var id = readBoundId(card);
    if (!id && typeof card.querySelector === "function") {
      var node = card.querySelector("[data-cart-id], [data-fav-id], [data-premium-book-id], [data-premium-cart], [data-ai-cover-book], [data-cover-book]");
      id = readBoundId(node);
    }
    if (!id && typeof card.querySelector === "function") {
      var link = card.querySelector("a[href]");
      var href = link && typeof link.getAttribute === "function" ? String(link.getAttribute("href") || "") : "";
      var match = href.match(/\/book\/([1-9][0-9]*)(?:[/?#]|$)/);
      if (match) id = match[1];
    }
    if (!isCanonicalBookId(id)) return "";
    if (card.getAttribute("data-live-book-id") !== id) card.setAttribute("data-live-book-id", id);
    return id;
  }

  function isCartSurface(card) {
    var node = card;
    while (node) {
      if (node.id === "cartItems") return true;
      var cls = String(node.className || "");
      if (/(?:^|\s)(?:cart-item|cart-row|cart-line)(?:\s|$)/.test(cls)) return true;
      node = node.parentNode;
    }
    return false;
  }

  function looksLikeCard(node) {
    if (!node || (node.nodeType != null && node.nodeType !== 1)) return false;
    var cls = String(node.className || "");
    return /(?:^|\s)(?:book-card|advanced-search-result|home-feature-card|shop-mini-card|favorite-card|premium-book-card|ai-search-item|home-carousel-card)(?:\s|$)/.test(cls);
  }

  function collectCards(scope) {
    if (!scope || typeof scope.querySelectorAll !== "function") return [];
    var nodes = scope.querySelectorAll(CARD_SELECTOR);
    var list = [];
    Array.prototype.forEach.call(nodes, function (card) {
      if (looksLikeCard(card) && !isCartSurface(card)) list.push(card);
    });
    if (!list.length && looksLikeCard(scope) && !isCartSurface(scope)) list.push(scope);
    return list;
  }

  function paintId(scope, bookId, total) {
    if (!scope || typeof scope.querySelectorAll !== "function") return;
    var selector = '[data-live-book-id="' + String(bookId) + '"]';
    var nodes = scope.querySelectorAll(selector);
    Array.prototype.forEach.call(nodes, function (card) {
      if (!looksLikeCard(card) || isCartSurface(card)) return;
      applyStatsToCard(card, bookId, total);
    });
  }

  function injectStyle(doc) {
    var documentRef = doc || (typeof document !== "undefined" ? document : null);
    if (!documentRef || !documentRef.getElementById || documentRef.getElementById(STYLE_ID)) return;
    if (typeof documentRef.createElement !== "function") return;
    var style = documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".book-view-count{margin:0.2rem 0 0.55rem;padding:0;border:0;background:transparent;position:static;" +
      "color:var(--site-brown,#70503d);font-size:0.82rem;line-height:1.5;font-weight:500;opacity:0.88;font-family:inherit}" +
      ".book-view-count-compact{margin:0.12rem 0 0.28rem;font-size:0.75rem;line-height:1.35;font-weight:500;opacity:0.82;" +
      "max-width:100%;display:block;position:static}" +
      "@media (max-width:640px){.book-view-count{font-size:0.78rem;margin-bottom:0.45rem}.book-view-count-compact{font-size:0.72rem}}";
    (documentRef.head || documentRef.documentElement).appendChild(style);
  }

  function isSkippedSurface() {
    if (typeof location === "undefined" || !location.pathname) return false;
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
    if (typeof document !== "undefined" && document.body && isCanonicalBookId(document.body.dataset.bookId)) {
      return String(document.body.dataset.bookId).trim();
    }
    return "";
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

  function refreshDisplayed(bookId, options) {
    var opts = options || {};
    var id = String(bookId || "").trim();
    if (!isCanonicalBookId(id)) return Promise.resolve();
    cacheDrop(id);
    var reqs = buildBatchStatsRequest([id], opts.config);
    var fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!reqs.length || typeof fetchImpl !== "function") return Promise.resolve();
    var token = (refreshTokens[id] = (refreshTokens[id] || 0) + 1);
    return Promise.resolve(fetchImpl(reqs[0].url, { headers: reqs[0].headers })).then(function (res) {
      if (refreshTokens[id] !== token || !res || !res.ok || typeof res.json !== "function") return null;
      return res.json();
    }, function () {
      return null;
    }).then(function (payload) {
      if (refreshTokens[id] !== token || payload == null) return;
      var rows = parseStatsRows(payload);
      var total = null;
      rows.forEach(function (row) {
        if (row.bookId === id) total = row.total;
      });
      if (total != null) cacheSet(id, total, Date.now());
      if (typeof document !== "undefined") paintId(document, id, total);
      if (detailBookId() === id) {
        if (total == null) {
          var info = document.querySelector(".book-detail-info");
          if (info) hideViewCount(info);
        } else paintFromStats(total);
      }
    }).catch(function () {});
  }

  function releaseFlight(ids, promise) {
    ids.forEach(function (id) {
      if (inflight[id] === promise) delete inflight[id];
    });
  }

  function hydrate(scope, options) {
    try {
      var opts = options || {};
      if (!opts.force && isSkippedSurface()) return Promise.resolve({ requests: 0 });
      var rootEl = scope;
      if (!rootEl || typeof rootEl.querySelectorAll !== "function") return Promise.resolve({ requests: 0 });
      var now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
      var cards = collectCards(rootEl);
      var missing = [];
      var joined = [];
      cards.forEach(function (card) {
        var id = stampCard(card);
        if (!id) return;
        var cached = cacheGet(id, now);
        if (cached != null) {
          applyStatsToCard(card, id, cached);
          return;
        }
        if (inflight[id]) {
          if (joined.indexOf(inflight[id]) === -1) joined.push(inflight[id]);
          return;
        }
        if (missing.indexOf(id) === -1) missing.push(id);
      });
      var requests = buildBatchStatsRequest(missing, opts.config);
      var fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
      var own = null;
      if (requests.length && typeof fetchImpl === "function") {
        var tokens = Object.create(null);
        var flightIds = [];
        requests.forEach(function (req) {
          req.ids.forEach(function (id) {
            bookTokens[id] = (bookTokens[id] || 0) + 1;
            tokens[id] = bookTokens[id];
            if (flightIds.indexOf(id) === -1) flightIds.push(id);
          });
        });
        var resolveFlight;
        own = new Promise(function (resolve) { resolveFlight = resolve; });
        flightIds.forEach(function (id) { inflight[id] = own; });
        Promise.all(requests.map(function (req) {
          return Promise.resolve(fetchImpl(req.url, { headers: req.headers })).then(function (res) {
            if (!res || !res.ok || typeof res.json !== "function") return [];
            return Promise.resolve(res.json()).then(function (payload) {
              return parseStatsRows(payload);
            }, function () {
              return [];
            });
          }, function () {
            return [];
          });
        })).then(function (groups) {
          var byId = Object.create(null);
          groups.forEach(function (rows) {
            rows.forEach(function (row) {
              byId[row.bookId] = row.total;
            });
          });
          var painted = Object.create(null);
          requests.forEach(function (req) {
            req.ids.forEach(function (id) {
              if (tokens[id] !== bookTokens[id]) return;
              var has = Object.prototype.hasOwnProperty.call(byId, id);
              var total = has ? byId[id] : null;
              if (total != null) cacheSet(id, total, now);
              painted[id] = total;
              paintId(rootEl, id, total);
            });
          });
          releaseFlight(flightIds, own);
          resolveFlight({ requests: requests.length, cards: cards.length, failed: false, byId: painted });
        }).catch(function () {
          releaseFlight(flightIds, own);
          resolveFlight({ requests: requests.length, cards: cards.length, failed: true, byId: {} });
        });
      }
      var waiters = joined.map(function (promise) {
        return promise.then(function (result) {
          if (!result || result.failed) return;
          var byId = result.byId || {};
          Object.keys(byId).forEach(function (id) {
            paintId(rootEl, id, byId[id]);
          });
        });
      });
      if (!own && !waiters.length) return Promise.resolve({ requests: 0, cards: cards.length });
      return Promise.all([own].concat(waiters)).then(function (parts) {
        var first = parts[0] || { requests: 0, cards: cards.length };
        return { requests: first.requests || 0, cards: cards.length, failed: !!first.failed, joined: waiters.length };
      });
    } catch (err) {
      return Promise.resolve({ requests: 0, failed: true });
    }
  }

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
    var cached = cacheGet(id, Date.now());
    if (cached != null) {
      paintFromStats(cached);
      return;
    }
    var req = buildStatsRequest(id, root.KUTADGU_SUPABASE_CONFIG || {});
    if (!req || typeof fetch !== "function") return Promise.resolve();
    var requestedId = id;
    var token = (refreshTokens[requestedId] = (refreshTokens[requestedId] || 0) + 1);
    return fetch(req.url, { headers: req.headers }).then(function (res) {
      if (refreshTokens[requestedId] !== token || detailBookId() !== requestedId) return null;
      if (!res || !res.ok) return null;
      return res.json();
    }).then(function (payload) {
      if (refreshTokens[requestedId] !== token || detailBookId() !== requestedId || payload == null) return;
      var rows = parseStatsRows(payload);
      var total = null;
      rows.forEach(function (row) {
        if (row.bookId === requestedId) total = row.total;
      });
      var currentInfo = document.querySelector(".book-detail-info");
      if (total == null) {
        if (currentInfo) hideViewCount(currentInfo);
        return;
      }
      cacheSet(requestedId, total, Date.now());
      paintFromStats(total);
    }).catch(function () {
      if (refreshTokens[requestedId] !== token || detailBookId() !== requestedId) return;
      var failedInfo = typeof document !== "undefined" ? document.querySelector(".book-detail-info") : null;
      if (failedInfo) hideViewCount(failedInfo);
    });
  }

  function flushQueue() {
    var queue = root.__kutadguEngagementQueue || [];
    if (!queue.length) return;
    var analytics = root.KutadguAnalytics;
    if (!analytics || typeof analytics.track !== "function") return;
    root.__kutadguEngagementQueue = [];
    queue.forEach(function (item) {
      if (!item) return;
      recordEngagement(item.action, item.bookId, { now: item.at });
    });
  }

  function tryWrapAnalytics() {
    var analytics = root.KutadguAnalytics;
    if (!analytics || typeof analytics.track !== "function" || analytics.__kutadguEngagementGuard) {
      return !!(analytics && analytics.__kutadguEngagementGuard);
    }
    analytics.track = wrapTrack(analytics.track.bind(analytics), localStore());
    analytics.__kutadguEngagementGuard = true;
    flushQueue();
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
          flushQueue();
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

  function isCounterElement(node) {
    if (!node || typeof node !== "object") return false;
    if (node.nodeType != null && node.nodeType !== 1) return false;
    try {
      if (node.classList && typeof node.classList.contains === "function" &&
        (node.classList.contains(EL_CLASS) || node.classList.contains(COMPACT_CLASS))) return true;
    } catch (err) {}
    var cls = typeof node.className === "string" ? node.className : "";
    return cls.indexOf(EL_CLASS) !== -1;
  }

  function isCounterMutationNode(node, record) {
    if (!node) return true;
    var type = node.nodeType;
    if (type === 3 || type === 8) {
      return isCounterElement(node.parentNode) || isCounterElement(record && record.target);
    }
    return isCounterElement(node);
  }

  function isCounterOnlyMutation(record) {
    if (!record || typeof record !== "object") return false;
    if (record.type === "characterData") {
      var textParent = record.target && record.target.parentNode;
      return isCounterElement(record.target) || isCounterElement(textParent);
    }
    if (record.type === "attributes") return isCounterElement(record.target);
    if (isCounterElement(record.target)) return true;
    var added = record.addedNodes ? Array.prototype.slice.call(record.addedNodes) : [];
    var removed = record.removedNodes ? Array.prototype.slice.call(record.removedNodes) : [];
    if (!added.length && !removed.length) return true;
    var i;
    for (i = 0; i < added.length; i += 1) {
      if (!isCounterMutationNode(added[i], record)) return false;
    }
    for (i = 0; i < removed.length; i += 1) {
      if (!isCounterMutationNode(removed[i], record)) return false;
    }
    return true;
  }

  function scopeHasCards(node) {
    if (!node || typeof node.querySelectorAll !== "function") return false;
    if (looksLikeCard(node)) return true;
    var found = node.querySelectorAll(CARD_SELECTOR);
    var i;
    for (i = 0; i < found.length; i += 1) {
      if (looksLikeCard(found[i])) return true;
    }
    return false;
  }

  function mutationScopes(records) {
    var scopes = [];
    Array.prototype.forEach.call(records || [], function (record) {
      if (!record || isCounterOnlyMutation(record)) return;
      var target = record.target;
      if (!scopeHasCards(target) || scopes.indexOf(target) !== -1) return;
      scopes.push(target);
    });
    return scopes;
  }

  function watchCards() {
    if (typeof MutationObserver !== "function" || typeof document === "undefined" || !document.body) return;
    var pending = false;
    var queued = [];
    var observer = new MutationObserver(function (records) {
      var scopes = mutationScopes(records);
      if (!scopes.length) return;
      scopes.forEach(function (scope) {
        if (queued.indexOf(scope) === -1) queued.push(scope);
      });
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        var batch = queued.splice(0, queued.length);
        batch.forEach(function (scope) {
          try { hydrate(scope); } catch (err) {}
        });
      }, 40);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    if (typeof document === "undefined") return;
    if (root.__kutadguBookViewsBooted) return;
    if (isSkippedSurface()) return;
    root.__kutadguBookViewsBooted = true;
    installAnalyticsGuard();
    injectStyle(document);
    flushQueue();
    var scheduleCards = function () {
      try { hydrate(document); } catch (err) {}
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleCards, { once: true });
    else scheduleCards();
    watchCards();
    if (!isBookDetailDocument()) return;
    var queued = false;
    var schedule = function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        fetchAndPaint();
      }, 0);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
    else schedule();
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
    BOOK_ENGAGEMENT_COOLDOWN_MS: BOOK_ENGAGEMENT_COOLDOWN_MS,
    STORAGE_KEY: STORAGE_KEY,
    STATS_TABLE: STATS_TABLE,
    BATCH_SIZE: BATCH_SIZE,
    DETAIL_EVENT: DETAIL_EVENT,
    CART_EVENT: CART_EVENT,
    isCanonicalBookId: isCanonicalBookId,
    canonicalFromTrackData: canonicalFromTrackData,
    shouldShowTotalViews: shouldShowTotalViews,
    formatTotalViews: formatTotalViews,
    viewCountText: viewCountText,
    compactViewCountText: compactViewCountText,
    viewCountAriaLabel: viewCountAriaLabel,
    engagementAllowed: engagementAllowed,
    rememberEngagement: rememberEngagement,
    claimEngagement: claimEngagement,
    recordEngagement: recordEngagement,
    wrapTrack: wrapTrack,
    buildStatsRequest: buildStatsRequest,
    buildBatchStatsRequest: buildBatchStatsRequest,
    parseTotalViews: parseTotalViews,
    parseStatsRows: parseStatsRows,
    resetStatsCache: resetStatsCache,
    createCountElement: createCountElement,
    hideViewCount: hideViewCount,
    mountViewCount: mountViewCount,
    mountCompactCount: mountCompactCount,
    applyStatsToCard: applyStatsToCard,
    isCounterOnlyMutation: isCounterOnlyMutation,
    mutationScopes: mutationScopes,
    CACHE_MS: CACHE_MS,
    stampCard: stampCard,
    hydrate: hydrate,
    refreshDisplayed: refreshDisplayed,
    fetchAndPaint: fetchAndPaint
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguBookViews = api;
  boot();
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
