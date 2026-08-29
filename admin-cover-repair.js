/**
 * Stage 13 — cover-only re-attach + import verification helpers.
 * Never guesses by title. Only image_url is in the write payload.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguAdminCoverRepair = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const METADATA_KEYS = ["id", "title", "author", "isbn", "price", "category", "source", "description", "sales_count", "is_active", "is_new", "is_recommended", "publisher", "stock", "stock_status", "pages", "translator", "legacy_id"];

  function defaultNormalizeIsbn(value) {
    return String(value == null ? "" : value).trim().replace(/[\s-]+/g, "").replace(/[^0-9Xx]/g, "").toUpperCase();
  }

  function isCanonicalNumericId(value) {
    return /^\d+$/.test(String(value || "").trim());
  }

  /**
   * 10/13-digit values are treated as ISBN (not book id).
   * Other all-digit values are canonical book ids.
   */
  function parseLookup(raw, normalizeIsbn) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return { ok: false, error: "empty", kind: "" };
    const norm = typeof normalizeIsbn === "function" ? normalizeIsbn : defaultNormalizeIsbn;
    const isbn = norm(s);
    if (/^\d+$/.test(s) && s.length !== 10 && s.length !== 13) {
      return { ok: true, kind: "id", value: s };
    }
    if (isbn && (isbn.length === 10 || isbn.length === 13)) {
      return { ok: true, kind: "isbn", value: isbn };
    }
    if (isCanonicalNumericId(s)) return { ok: true, kind: "id", value: s };
    return { ok: false, error: "unrecognized", kind: "" };
  }

  function uniqueBooksById(rows) {
    const map = new Map();
    (rows || []).forEach(function (row) {
      if (!row || row.id == null || row.id === "") return;
      map.set(String(row.id), row);
    });
    return Array.from(map.values());
  }

  function resolveMatches(rows, lookup, normalizeIsbn) {
    const norm = typeof normalizeIsbn === "function" ? normalizeIsbn : defaultNormalizeIsbn;
    const list = uniqueBooksById(rows);
    let filtered = list;
    if (lookup && lookup.kind === "id") {
      const want = String(lookup.value);
      filtered = list.filter(function (b) { return String(b.id) === want; });
    } else if (lookup && lookup.kind === "isbn") {
      const key = lookup.value;
      filtered = list.filter(function (b) { return norm(b.isbn) === key; });
    } else {
      return { ok: false, reason: "invalid", matches: [] };
    }
    if (!filtered.length) return { ok: false, reason: "none", matches: [] };
    if (filtered.length > 1) return { ok: false, reason: "ambiguous", matches: filtered };
    return { ok: true, reason: "one", book: filtered[0], matches: filtered };
  }

  function coverOnlyPayload(imageUrl) {
    return { image_url: imageUrl };
  }

  function payloadKeys(payload) {
    return Object.keys(payload || {});
  }

  function metadataUnchanged(before, after) {
    const a = before || {};
    const b = after || {};
    for (let i = 0; i < METADATA_KEYS.length; i++) {
      const key = METADATA_KEYS[i];
      if (String(a[key] == null ? "" : a[key]) !== String(b[key] == null ? "" : b[key])) return false;
    }
    return true;
  }

  function applyCoverOnlyLocal(book, imageUrl) {
    const next = {};
    Object.keys(book || {}).forEach(function (k) { next[k] = book[k]; });
    next.image_url = imageUrl;
    return next;
  }

  function hasImageUrl(row) {
    return !!(row && String(row.image_url || "").trim());
  }

  /**
   * Preview / confirm plan from already-mapped import rows. No catalog fetch.
   */
  function summarizeImportPlan(rows, dupMode, classifyFn) {
    const list = Array.isArray(rows) ? rows : [];
    const classify = typeof classifyFn === "function" ? classifyFn : function () { return "exclude"; };
    const out = {
      total: list.length,
      errors: 0,
      insert: 0,
      update: 0,
      skip: 0,
      skipIsbn: 0,
      skipTitleAuthor: 0,
      exclude: 0,
      coversMatched: 0,
      coversMissing: 0,
      coversDuplicate: 0,
      coversNone: 0,
      valid: 0
    };
    list.forEach(function (row) {
      if (!row) return;
      if (row.coverStatus === "matched") out.coversMatched++;
      else if (row.coverStatus === "missing") out.coversMissing++;
      else if (row.coverStatus === "duplicate") out.coversDuplicate++;
      else out.coversNone++;
      const action = classify(row, dupMode);
      if (action === "exclude") {
        out.exclude++;
        out.errors++;
        return;
      }
      out.valid++;
      if (action === "insert") out.insert++;
      else if (action === "update") out.update++;
      else {
        out.skip++;
        if (row.duplicate === "isbn") out.skipIsbn++;
        else if (row.duplicate === "title_author") out.skipTitleAuthor++;
      }
    });
    return out;
  }

  function formatPlanText(plan) {
    const p = plan || {};
    return "جەمئىي " + (p.total || 0) +
      " قۇر · كىرگۈزۈلىدۇ " + (p.insert || 0) +
      " · ISBN تەكرار ئۆتكۈزۈلىدۇ " + (p.skipIsbn || 0) +
      " · ئىسىم+ئاپتور ئۆتكۈزۈلىدۇ " + (p.skipTitleAuthor || 0) +
      " · ISBN يېڭىلاش " + (p.update || 0) +
      " · ماس مۇقاۋا " + (p.coversMatched || 0) +
      " · رەسىم تېپىلمىدى " + (p.coversMissing || 0) +
      " · تەكرار ھۆججەت نامى " + (p.coversDuplicate || 0) +
      " · خاتا/توسۇلغان " + (p.exclude || 0);
  }

  function formatResultText(result) {
    const r = result || {};
    return "تاماملاندى: كىرگۈزۈلدى " + (r.imported || 0) +
      "، يېڭىلاندى " + (r.updated || 0) +
      "، ئۆتكۈزۈلدى " + (r.skipped || 0) +
      "، مەغلۇپ " + (r.failed || 0) +
      "، مۇقاۋا " + (r.coverOk || 0) +
      "، مۇقاۋا مەغلۇپ " + (r.coverFailed || 0) +
      "، بۇ كىرگۈزۈشتە image_url يوق " + (r.withoutImageUrl || 0);
  }

  /**
   * Count rows from this import that still lack image_url after covers.
   * coverOkByIndex: boolean[] aligned with coverJobs.
   */
  function countWithoutImageUrl(rows, coverJobKeys, coverOkByKey) {
    let n = 0;
    (rows || []).forEach(function (row) {
      if (!row) return;
      const key = row.insertedId != null && row.insertedId !== ""
        ? String(row.insertedId)
        : (row.dbMatch && row.dbMatch.id != null ? String(row.dbMatch.id) : "");
      const coverOk = key && coverOkByKey && coverOkByKey[key];
      if (coverOk) return;
      if (hasImageUrl(row)) return;
      n++;
    });
    return n;
  }

  function emptyRepairState(file) {
    return { book: null, file: file || null, canWrite: false };
  }

  function invalidateRepairTarget(prev) {
    return emptyRepairState(prev && prev.file);
  }

  function applyLookupOutcome(prev, resolved) {
    const file = prev && prev.file || null;
    if (!resolved || !resolved.ok || !resolved.book || resolved.book.id == null || resolved.book.id === "") {
      return emptyRepairState(file);
    }
    return { book: resolved.book, file: file, canWrite: !!file };
  }

  function canWriteCoverRepair(state) {
    return !!(state && state.book && state.book.id != null && state.book.id !== "" && state.file);
  }

  return {
    METADATA_KEYS: METADATA_KEYS,
    parseLookup: parseLookup,
    isCanonicalNumericId: isCanonicalNumericId,
    uniqueBooksById: uniqueBooksById,
    resolveMatches: resolveMatches,
    coverOnlyPayload: coverOnlyPayload,
    payloadKeys: payloadKeys,
    metadataUnchanged: metadataUnchanged,
    applyCoverOnlyLocal: applyCoverOnlyLocal,
    hasImageUrl: hasImageUrl,
    summarizeImportPlan: summarizeImportPlan,
    formatPlanText: formatPlanText,
    formatResultText: formatResultText,
    countWithoutImageUrl: countWithoutImageUrl,
    emptyRepairState: emptyRepairState,
    invalidateRepairTarget: invalidateRepairTarget,
    applyLookupOutcome: applyLookupOutcome,
    canWriteCoverRepair: canWriteCoverRepair
  };
});
