/**
 * Admin bulk import cover matching — Stage 12
 *
 * cover_file is an import-only spreadsheet column (filename). It is not a
 * database column. Matching is exact on a normalized basename; no fuzzy guesses.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguAdminImportCovers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COVER_UPLOAD_CONCURRENCY = 5;

  function fileBasename(value) {
    const s = String(value == null ? "" : value).trim().replace(/\\/g, "/");
    if (!s) return "";
    const parts = s.split("/");
    return parts[parts.length - 1] || "";
  }

  /**
   * Deterministic key: trim, basename only, case-insensitive.
   * Original File.name is not rewritten.
   */
  function normalizeCoverFilename(value) {
    return fileBasename(value).toLowerCase();
  }

  function indexSelectedCoverFiles(files) {
    const byName = new Map();
    const duplicateKeys = new Set();
    const list = files ? Array.from(files) : [];
    list.forEach(function (file) {
      if (!file) return;
      const key = normalizeCoverFilename(file.name || file.filename || "");
      if (!key) return;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(file);
    });
    byName.forEach(function (group, key) {
      if (group.length > 1) duplicateKeys.add(key);
    });
    return { byName: byName, duplicateKeys: duplicateKeys };
  }

  /**
   * @returns {{status: "none"|"matched"|"missing"|"duplicate", file?: object, key: string}}
   */
  function matchCoverFile(coverFile, index) {
    const raw = String(coverFile == null ? "" : coverFile).trim();
    const key = normalizeCoverFilename(raw);
    if (!key) return { status: "none", key: "" };
    const idx = index || { byName: new Map(), duplicateKeys: new Set() };
    if (idx.duplicateKeys && idx.duplicateKeys.has(key)) {
      return { status: "duplicate", key: key };
    }
    const group = idx.byName && idx.byName.get(key);
    if (!group || !group.length) return { status: "missing", key: key };
    if (group.length !== 1) return { status: "duplicate", key: key };
    return { status: "matched", key: key, file: group[0] };
  }

  function coverStatusLabel(status) {
    if (status === "matched") return "ماس كەلدى";
    if (status === "missing") return "رەسىم تېپىلمىدى";
    if (status === "duplicate") return "تاللانغان ھۆججەت نامى تەكرار";
    return "مۇقاۋا تەلەپ قىلىنمىدى";
  }

  function applyCoverMatches(rows, files) {
    const index = indexSelectedCoverFiles(files);
    (rows || []).forEach(function (row) {
      if (!row) return;
      const result = matchCoverFile(row.cover_file, index);
      row.coverStatus = result.status;
      row.coverMatchFile = result.file || null;
      if (result.status === "missing") {
        row.errors = row.errors || [];
        row.errors.push("cover_file رەسىم تېپىلمىدى: " + String(row.cover_file || "").trim() + " — باشقا كىتابنىڭ مۇقاۋاسى قوشۇلمايدۇ");
      } else if (result.status === "duplicate") {
        row.errors = row.errors || [];
        row.errors.push("cover_file تاللانغان ھۆججەتلەردە تەكرار نام: " + String(row.cover_file || "").trim() + " — قايسى رەسىم ئىكەنلىكى ئېنىق ئەمەس");
      }
    });
    return index;
  }

  function normText(value) {
    return String(value == null ? "" : value).trim();
  }

  function defaultNormalizeIsbn(value) {
    return String(value == null ? "" : value).trim().replace(/[\s-]+/g, "").replace(/[^0-9Xx]/g, "").toUpperCase();
  }

  function fieldsMatch(payload, inserted, normalizeIsbn) {
    const norm = typeof normalizeIsbn === "function" ? normalizeIsbn : defaultNormalizeIsbn;
    return normText(payload && payload.title) === normText(inserted && inserted.title) &&
      normText(payload && payload.author) === normText(inserted && inserted.author) &&
      norm(payload && payload.isbn) === norm(inserted && inserted.isbn);
  }

  /**
   * Map spreadsheet payloads to returned insert rows by field equality, not
   * by array order alone. Ambiguous matches are left unpaired (no guessed cover).
   */
  function pairInsertedRows(payloads, returned, opts) {
    const list = Array.isArray(payloads) ? payloads : [];
    const ret = Array.isArray(returned) ? returned : [];
    const normalizeIsbn = opts && opts.normalizeIsbn;
    const used = new Set();
    const pairs = list.map(function () { return null; });
    list.forEach(function (payload, i) {
      const hits = [];
      ret.forEach(function (row, j) {
        if (used.has(j)) return;
        if (fieldsMatch(payload, row, normalizeIsbn)) hits.push(j);
      });
      if (hits.length === 1) {
        used.add(hits[0]);
        const row = ret[hits[0]];
        pairs[i] = { id: row && row.id, inserted: row, payloadIndex: i };
      }
    });
    return {
      pairs: pairs,
      pairedCount: pairs.filter(Boolean).length,
      unpairedCount: pairs.filter(function (p) { return !p; }).length
    };
  }

  /**
   * skip | update | insert | exclude
   * Title+author existing matches skip (never silent insert / overwrite).
   * ISBN update remains an explicit dupMode choice.
   */
  function classifyImportRowAction(row, dupMode) {
    if (!row || row.status === "error") return "exclude";
    if (row.duplicate === "title_author") return "skip";
    if (row.duplicate === "isbn") {
      const mode = dupMode || "skip";
      if (mode === "skip") return "skip";
      if (mode === "update") {
        if (row.isbnMatchCount === 1 && row.dbMatch && row.dbMatch.id != null && row.dbMatch.id !== "") {
          return "update";
        }
        return "skip";
      }
      return "insert";
    }
    return "insert";
  }

  async function mapPool(items, limit, fn) {
    const list = Array.isArray(items) ? items : [];
    const cap = Math.max(1, Math.min(Number(limit) || COVER_UPLOAD_CONCURRENCY, 6));
    const results = new Array(list.length);
    let cursor = 0;
    async function worker() {
      for (;;) {
        const idx = cursor++;
        if (idx >= list.length) return;
        try {
          results[idx] = { ok: true, value: await fn(list[idx], idx) };
        } catch (err) {
          results[idx] = { ok: false, error: err };
        }
      }
    }
    const n = Math.min(cap, list.length) || 0;
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  return {
    COVER_UPLOAD_CONCURRENCY: COVER_UPLOAD_CONCURRENCY,
    fileBasename: fileBasename,
    normalizeCoverFilename: normalizeCoverFilename,
    indexSelectedCoverFiles: indexSelectedCoverFiles,
    matchCoverFile: matchCoverFile,
    coverStatusLabel: coverStatusLabel,
    applyCoverMatches: applyCoverMatches,
    pairInsertedRows: pairInsertedRows,
    classifyImportRowAction: classifyImportRowAction,
    mapPool: mapPool
  };
});
