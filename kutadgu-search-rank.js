/**
 * Storefront search relevance ranking (Stage Search 1A).
 * Scores the full matching hit list in JavaScript. Does not change RLS.
 */
(function (root) {
  "use strict";

  var SCORE = {
    isbnExact: 1000,
    titleExact: 900,
    titlePrefix: 800,
    titleContains: 700,
    authorExact: 600,
    authorPrefix: 500,
    authorContains: 400,
    translator: 300,
    publisher: 200,
    category: 100
  };

  function normalizeText(value) {
    return String(value == null ? "" : value).toLocaleLowerCase("ug").replace(/\s+/g, " ").trim();
  }

  function isbnDigits(value) {
    var lib = root && root.KutadguBibliography;
    if (lib && typeof lib.normalizeIsbnDigits === "function") return lib.normalizeIsbnDigits(value);
    return String(value == null ? "" : value).trim().replace(/[\s-]+/g, "").replace(/[^0-9Xx]/g, "").toUpperCase();
  }

  function fieldLevel(value, query) {
    var text = normalizeText(value);
    if (!text || !query) return 0;
    if (text === query) return 3;
    if (text.indexOf(query) === 0) return 2;
    if (text.indexOf(query) >= 0) return 1;
    return 0;
  }

  function scoreHit(book, rawQuery) {
    var query = normalizeText(rawQuery);
    if (!query) return 0;
    var isbnQ = isbnDigits(rawQuery);
    var isbnB = isbnDigits(book && book.isbn);
    if (isbnQ && isbnB && isbnQ === isbnB) return SCORE.isbnExact;
    var title = fieldLevel(book && book.title, query);
    if (title === 3) return SCORE.titleExact;
    if (title === 2) return SCORE.titlePrefix;
    if (title === 1) return SCORE.titleContains;
    var author = fieldLevel(book && book.author, query);
    if (author === 3) return SCORE.authorExact;
    if (author === 2) return SCORE.authorPrefix;
    if (author === 1) return SCORE.authorContains;
    if (fieldLevel(book && book.translator, query)) return SCORE.translator;
    if (fieldLevel(book && book.publisher, query)) return SCORE.publisher;
    if (fieldLevel(book && book.category, query)) return SCORE.category;
    return 0;
  }

  function rankHits(hits, rawQuery) {
    return (hits || []).slice().sort(function (a, b) {
      var diff = scoreHit(b, rawQuery) - scoreHit(a, rawQuery);
      if (diff) return diff;
      var titles = String((a && a.title) || "").localeCompare(String((b && b.title) || ""), "ug");
      if (titles) return titles;
      return String((a && a.id) || "").localeCompare(String((b && b.id) || ""), "en");
    });
  }

  function usesSearchRelevance(state) {
    state = state || {};
    if (!normalizeText(state.search)) return false;
    var sort = String(state.sort == null ? "" : state.sort);
    return sort === "relevance";
  }

  var api = {
    SCORE: SCORE,
    normalizeText: normalizeText,
    isbnDigits: isbnDigits,
    scoreHit: scoreHit,
    rankHits: rankHits,
    usesSearchRelevance: usesSearchRelevance
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguSearchRank = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
