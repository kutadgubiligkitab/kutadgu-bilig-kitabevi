/**
 * Admin import duplicate preload — Stage 9.1
 *
 * PostgREST typically caps a single response (~1000 rows). An unfiltered
 * `.range(0, 9999)` therefore silently truncates and misses duplicates above
 * the cap. Lookups are scoped to incoming import values and paged to exhaustion.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguAdminImportScale = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const POSTGREST_PAGE = 1000;
  const ISBN_IN_CHUNK = 80;
  const TITLE_IN_CHUNK = 40;
  const LEGACY_IN_CHUNK = 80;

  function uniqueNonEmpty(values) {
    const out = [];
    const seen = new Set();
    for (const raw of values) {
      const s = String(raw == null ? "" : raw).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function isbnLookupTokens(isbn, normalizeIsbn) {
    const raw = String(isbn || "").trim();
    if (!raw) return [];
    const tokens = [raw];
    const digits = typeof normalizeIsbn === "function" ? normalizeIsbn(raw) : raw.replace(/\D/g, "");
    if (digits && digits !== raw) tokens.push(digits);
    return uniqueNonEmpty(tokens);
  }

  /**
   * Page `.in(column, chunk)` until a short page. Never uses an unfiltered catalog range.
   */
  async function pageInColumn(client, column, values, selectCols, chunkSize) {
    const collected = [];
    const list = uniqueNonEmpty(values);
    if (!list.length) return collected;
    const size = Math.max(1, chunkSize || ISBN_IN_CHUNK);
    for (let i = 0; i < list.length; i += size) {
      const chunk = list.slice(i, i + size);
      let from = 0;
      for (;;) {
        const to = from + POSTGREST_PAGE - 1;
        const { data, error } = await client.from("books").select(selectCols).in(column, chunk).range(from, to);
        if (error) throw error;
        const rows = Array.isArray(data) ? data : [];
        collected.push.apply(collected, rows);
        if (rows.length < POSTGREST_PAGE) break;
        from += POSTGREST_PAGE;
      }
    }
    return collected;
  }

  function mergeById(target, rows) {
    for (const row of rows || []) {
      if (!row || row.id == null || row.id === "") continue;
      const key = String(row.id);
      if (!target.has(key)) target.set(key, row);
    }
  }

  /**
   * @param {object} client supabase-js client
   * @param {object[]} mapped import rows ({ title, author, isbn, id? })
   * @param {{ isbnColumn: boolean, hasLegacy: boolean, normalizeIsbn: Function, titleAuthorKey: Function }} opts
   */
  async function loadExistingForImport(client, mapped, opts) {
    const isbnColumn = !!(opts && opts.isbnColumn);
    const hasLegacy = !!(opts && opts.hasLegacy);
    const normalizeIsbn = opts && opts.normalizeIsbn;
    const titleAuthorKey = opts && opts.titleAuthorKey;
    const rows = Array.isArray(mapped) ? mapped : [];

    const selectCols = ["id", "title", "author"];
    if (isbnColumn) selectCols.push("isbn");
    if (hasLegacy) selectCols.push("legacy_id");
    const select = selectCols.join(",");

    const byId = new Map();

    if (isbnColumn) {
      const isbnVals = [];
      for (const r of rows) {
        isbnLookupTokens(r && r.isbn, normalizeIsbn).forEach((t) => isbnVals.push(t));
      }
      mergeById(byId, await pageInColumn(client, "isbn", isbnVals, select, ISBN_IN_CHUNK));
    }

    const titles = uniqueNonEmpty(rows.map((r) => (r && r.title) || ""));
    mergeById(byId, await pageInColumn(client, "title", titles, select, TITLE_IN_CHUNK));

    if (hasLegacy) {
      const legs = uniqueNonEmpty(rows.map((r) => (r && r.legacy_id) || ""));
      mergeById(byId, await pageInColumn(client, "legacy_id", legs, select, LEGACY_IN_CHUNK));
    }

    const existing = Array.from(byId.values());
    const existingTitle = new Map();
    const existingIsbn = new Map();
    const existingLegacy = new Map();
    existing.forEach((b) => {
      if (typeof titleAuthorKey === "function") {
        const k = titleAuthorKey(b.title, b.author);
        if (k && !existingTitle.has(k)) existingTitle.set(k, b);
      }
      if (isbnColumn) {
        const nk = typeof normalizeIsbn === "function" ? normalizeIsbn(b.isbn) : "";
        if (nk) {
          const list = existingIsbn.get(nk) || [];
          if (!list.some((x) => String(x.id) === String(b.id))) list.push(b);
          existingIsbn.set(nk, list);
        }
      }
      if (hasLegacy && b.legacy_id != null && String(b.legacy_id).trim()) {
        existingLegacy.set(String(b.legacy_id).trim(), b);
      }
    });
    return { existing, existingTitle, existingIsbn, existingLegacy };
  }

  /**
   * Admin stock total via RPC. Never downloads stock column rows.
   * Returns { ok:true, total } or { ok:false } if RPC missing / unauthorized.
   */
  async function fetchStockSumRpc(client) {
    if (!client || typeof client.rpc !== "function") return { ok: false, total: 0 };
    const { data, error } = await client.rpc("get_kutadgu_book_stock_sum");
    if (error) return { ok: false, total: 0 };
    const n = Number(data);
    if (!Number.isFinite(n)) return { ok: false, total: 0 };
    return { ok: true, total: n };
  }

  return {
    POSTGREST_PAGE,
    ISBN_IN_CHUNK,
    TITLE_IN_CHUNK,
    uniqueNonEmpty,
    isbnLookupTokens,
    pageInColumn,
    loadExistingForImport,
    fetchStockSumRpc
  };
});
