/*
  Visit discovery order for the unfiltered /books listing.

  A visit is one tab session. The seed and the frozen id snapshot live in
  sessionStorage under kutadgu-books-visit-v1. A new tab or a new browser
  session starts empty, so it receives a new seed. The seed is not written to
  localStorage. If sessionStorage throws, the same objects stay in module
  memory until this document is discarded.

  The snapshot is one deterministic permutation of the canonical ids that were
  eligible when the visit first built it. Books added later join the next
  visit. Pagination walks that frozen list. A missing or hidden id is skipped
  and still consumes a snapshot position, so later ids are not dropped and
  Load more ends when the cursor reaches the end.
*/
(function (root) {
  "use strict";

  var STORAGE_KEY = "kutadgu-books-visit-v1";
  var DISCOVER_SORT = "discover";
  var DISCOVER_LABEL = "بۇ قېتىملىق بايقاش تەرتىپى";
  var INDEX_PAGE = 1000;
  var memoryVisit = null;

  function isDiscoveryListing(state) {
    state = state || {};
    if (String(state.sort || "") !== DISCOVER_SORT) return false;
    if (String(state.search || "").trim()) return false;
    if (String(state.category || "").trim()) return false;
    if (String(state.source || "").trim()) return false;
    if (state.sources && state.sources.length) return false;
    if (state.ids && state.ids.length) return false;
    if (state.newOnly || state.featured || state.recommended || state.bestseller) return false;
    if (state.includeInactive) return false;
    if (hasBound(state.minPrice) || hasBound(state.maxPrice)) return false;
    return true;
  }

  function hasBound(value) {
    if (value === null || value === undefined || value === "") return false;
    return Number.isFinite(Number(value));
  }

  function hashSeed(seed) {
    var text = String(seed || "");
    var hash = 2166136261;
    var i;
    for (i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      var t;
      a = (a + 0x6D2B79F5) | 0;
      t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function canonicalIds(rows, options) {
    var allowNonCanonical = !!(options && options.allowNonCanonical);
    var seen = new Set();
    var out = [];
    (rows || []).forEach(function (row) {
      if (!row) return;
      if (row.is_active === false || row.isActive === false) return;
      var raw = row.id != null ? row.id : row;
      var id = String(raw == null ? "" : raw).trim();
      if (!id || seen.has(id)) return;
      if (!/^\d+$/.test(id) && !allowNonCanonical) return;
      seen.add(id);
      out.push(id);
    });
    return out;
  }

  function permuteIds(ids, seed) {
    var seen = new Set();
    var order = [];
    (ids || []).forEach(function (id) {
      var key = String(id == null ? "" : id).trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      order.push(key);
    });
    var rand = mulberry32(hashSeed(seed));
    var i;
    for (i = order.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return order;
  }

  function nextIndexCursor(from, chunkLength, contentRange, status, requested) {
    var header = String(contentRange || "").trim();
    var ranged = /^(\d+)-(\d+)\/(\d+|\*)$/.exec(header);
    var star = /^\*\/(\d+)$/.exec(header);
    var total = null;
    var end = null;
    var next;
    var code = Number(status) || 0;
    var size = Math.max(0, Number(chunkLength) || 0);
    var start = Math.max(0, Number(from) || 0);
    var ask = Math.max(1, Number(requested) || INDEX_PAGE);
    if (ranged) {
      end = Number(ranged[2]);
      if (ranged[3] !== "*") total = Number(ranged[3]);
    } else if (star) {
      total = Number(star[1]);
    }
    if (!size) {
      if (Number.isFinite(total) && start < total) return { done: false, truncated: true, next: start, total: total };
      return { done: true, truncated: false, next: start, total: total };
    }
    next = Number.isFinite(end) ? end + 1 : start + size;
    if (Number.isFinite(total)) {
      if (next >= total) return { done: true, truncated: false, next: next, total: total };
      if (next <= start) return { done: false, truncated: true, next: start, total: total };
      return { done: false, truncated: false, next: next, total: total };
    }
    if (code === 206 && size < ask) return { done: false, truncated: true, next: next, total: null };
    if (size < ask) return { done: true, truncated: false, next: next, total: null };
    return { done: false, truncated: false, next: next, total: null };
  }

  function indexError(message, code) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  async function collectIdIndex(fetchRange) {
    var from = 0;
    var rows = [];
    var guard = 0;
    var seen = new Set();
    while (guard < 10000) {
      guard += 1;
      var result = await fetchRange(from, INDEX_PAGE);
      var chunk = result && Array.isArray(result.rows) ? result.rows : [];
      var fresh = 0;
      chunk.forEach(function (row) {
        var id = String(row && row.id != null ? row.id : "").trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        fresh += 1;
        rows.push(row);
      });
      var step = nextIndexCursor(from, chunk.length, result && result.contentRange, result && result.status, INDEX_PAGE);
      if (step.truncated) throw indexError("Catalog id index was truncated", "truncated-index");
      if (!step.done && fresh === 0 && chunk.length) throw indexError("Catalog id index repeated a page", "repeated-index");
      if (step.done) {
        if (Number.isFinite(step.total) && rows.length < step.total) throw indexError("Catalog id index was truncated", "truncated-index");
        return { rows: rows, total: Number.isFinite(step.total) ? step.total : rows.length };
      }
      if (!(step.next > from)) throw indexError("Catalog id index did not advance", "truncated-index");
      from = step.next;
    }
    throw indexError("Catalog id index did not finish", "truncated-index");
  }

  function listingTotal(snapshotTotal, nextOffset, renderedCount, hasMore) {
    var shown = Math.max(0, Number(renderedCount) || 0);
    if (!hasMore) return shown;
    var snap = Number(snapshotTotal);
    var cursor = Number(nextOffset);
    if (!Number.isFinite(snap) || !Number.isFinite(cursor)) return shown;
    var skipped = Math.max(0, cursor - shown);
    return Math.max(shown, snap - skipped);
  }

  function walkSnapshot(ids, offset, pageSize, resolveOne, maxCursor) {
    var list = Array.isArray(ids) ? ids : [];
    var start = Math.max(0, Number(offset) || 0);
    var size = Math.max(1, Number(pageSize) || 1);
    var limit = Number.isFinite(Number(maxCursor)) ? Number(maxCursor) : list.length;
    var items = [];
    var seen = new Set();
    var cursor = start;
    var lookup = typeof resolveOne === "function" ? resolveOne : function () { return null; };
    while (cursor < list.length && cursor < limit && items.length < size) {
      var id = list[cursor];
      cursor += 1;
      var book = lookup(id);
      if (!book || book.isActive === false || book.is_active === false) continue;
      var key = String(book.id != null ? book.id : id).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(book);
    }
    return {
      items: items,
      offset: start,
      nextOffset: cursor,
      examined: cursor - start,
      snapshotTotal: list.length,
      hasMore: cursor < list.length,
      pageSize: size
    };
  }

  async function collectVisiblePage(ids, offset, pageSize, fetchWindow, maxCursor) {
    var list = Array.isArray(ids) ? ids : [];
    var start = Math.max(0, Number(offset) || 0);
    var size = Math.max(1, Number(pageSize) || 1);
    var limit = Number.isFinite(Number(maxCursor)) ? Number(maxCursor) : list.length;
    var items = [];
    var seen = new Set();
    var cursor = start;
    var fetchSlice = typeof fetchWindow === "function" ? fetchWindow : async function () { return []; };
    while (cursor < list.length && cursor < limit && items.length < size) {
      var room = Math.min(100, limit - cursor, list.length - cursor);
      var windowIds = list.slice(cursor, cursor + room);
      var books = await fetchSlice(windowIds);
      var byId = new Map();
      (books || []).forEach(function (book) {
        if (!book) return;
        var id = String(book.id != null ? book.id : "").trim();
        if (id) byId.set(id, book);
      });
      var n;
      for (n = 0; n < windowIds.length; n += 1) {
        if (cursor >= limit || items.length >= size) break;
        var id = windowIds[n];
        cursor += 1;
        var book = byId.get(String(id));
        if (!book || book.isActive === false || book.is_active === false) continue;
        var key = String(book.id != null ? book.id : id).trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push(book);
      }
    }
    return {
      items: items,
      offset: start,
      nextOffset: cursor,
      examined: cursor - start,
      snapshotTotal: list.length,
      hasMore: cursor < list.length,
      pageSize: size
    };
  }

  function copyVisit(visit) {
    if (!visit) return null;
    return { seed: visit.seed, ids: visit.ids.slice(), cursor: visit.cursor };
  }

  function normalizeVisit(visit) {
    if (!visit || !visit.seed || !Array.isArray(visit.ids)) return null;
    var ids = [];
    var seen = new Set();
    visit.ids.forEach(function (id) {
      var key = String(id == null ? "" : id).trim();
      if (!key || seen.has(key) || ids.length >= 20000) return;
      seen.add(key);
      ids.push(key);
    });
    var cursor = Number(visit.cursor);
    return {
      seed: String(visit.seed).slice(0, 80),
      ids: ids,
      cursor: Number.isFinite(cursor) && cursor > 0 ? Math.min(cursor, ids.length) : 0
    };
  }

  function readVisit(storage) {
    try {
      if (!storage || typeof storage.getItem !== "function") return null;
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalizeVisit(JSON.parse(raw));
    } catch (err) {
      return null;
    }
  }

  function writeVisit(storage, visit) {
    try {
      if (!storage || typeof storage.setItem !== "function") return false;
      storage.setItem(STORAGE_KEY, JSON.stringify(visit));
      return true;
    } catch (err) {
      return false;
    }
  }

  function visitStore(storage) {
    return {
      load: function () {
        var stored = readVisit(storage);
        if (stored) {
          memoryVisit = stored;
          return copyVisit(stored);
        }
        return copyVisit(memoryVisit);
      },
      save: function (visit) {
        var next = normalizeVisit(visit);
        if (!next) return copyVisit(memoryVisit);
        memoryVisit = next;
        writeVisit(storage, next);
        return copyVisit(next);
      }
    };
  }

  function resetMemory() {
    memoryVisit = null;
  }

  function newSeed() {
    var cryptoObj = typeof crypto !== "undefined" ? crypto : null;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      var uuid = String(cryptoObj.randomUUID() || "");
      if (uuid) return uuid;
    }
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      var bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
    return "visit-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    DISCOVER_SORT: DISCOVER_SORT,
    DISCOVER_LABEL: DISCOVER_LABEL,
    INDEX_PAGE: INDEX_PAGE,
    isDiscoveryListing: isDiscoveryListing,
    hashSeed: hashSeed,
    canonicalIds: canonicalIds,
    permuteIds: permuteIds,
    nextIndexCursor: nextIndexCursor,
    collectIdIndex: collectIdIndex,
    listingTotal: listingTotal,
    walkSnapshot: walkSnapshot,
    collectVisiblePage: collectVisiblePage,
    visitStore: visitStore,
    resetMemory: resetMemory,
    newSeed: newSeed
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguVisitOrder = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
