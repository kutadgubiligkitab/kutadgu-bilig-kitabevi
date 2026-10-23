/*
  Authoritative book-category directory.
  A missing RPC means the directory is not installed yet, and the existing
  hardcoded list remains. A failed read after a successful directory, or a
  failed read when a previous directory is cached, does not put hidden or
  retired categories back from that hardcoded list.
*/
(function (root) {
  "use strict";

  const CACHE_KEY = "kutadgu-book-categories-v1";
  const state = {
    mode: "legacy",
    categories: [],
    redirects: [],
    adminRows: [],
    error: ""
  };

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function seedRows() {
    const config = root.KUTADGU_APP_CONFIG || {};
    return (config.catalogCategories || []).filter((item) => item && item.source).map((item) => ({
      source: text(item.source),
      slug: text(item.source).replace(/\.html$/, ""),
      label: text(item.label || item.source),
      summary: "",
      icon: "📚",
      is_hidden: false,
      retired: false
    }));
  }

  function readCache() {
    try {
      const raw = root.sessionStorage && root.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.categories)) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeCache(payload) {
    try {
      if (root.sessionStorage) root.sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (err) {}
  }

  function normalizePublic(payload) {
    const body = payload && payload.categories ? payload : { categories: payload || [], redirects: [] };
    return {
      categories: (body.categories || []).filter((row) => row && row.source && !row.is_hidden && !row.retired),
      redirects: body.redirects || []
    };
  }

  function applyPublic(payload) {
    const next = normalizePublic(payload);
    state.mode = "authoritative";
    state.categories = next.categories;
    state.redirects = next.redirects;
    state.error = "";
    writeCache({ categories: next.categories, redirects: next.redirects });
    publish();
  }

  function applyFailure(message) {
    const cached = readCache();
    if (state.mode === "authoritative") {
      state.error = message || "failed";
      publish();
      return;
    }
    if (cached) {
      applyPublic(cached);
      state.error = message || "failed";
      publish();
      return;
    }
    state.mode = "failed";
    state.categories = [];
    state.redirects = [];
    state.error = message || "failed";
    publish();
  }

  function publish() {
    const event = root.document && root.document.createEvent ? null : null;
    if (root.document && typeof root.CustomEvent === "function") {
      root.document.dispatchEvent(new root.CustomEvent("kutadgu-categories", { detail: { mode: state.mode } }));
    }
    if (typeof root.__kutadguRefreshCategoryOptions === "function") root.__kutadguRefreshCategoryOptions();
    if (typeof root.__kutadguRenderCategorySurfaces === "function") root.__kutadguRenderCategorySurfaces();
    void event;
  }

  function missingFunction(error) {
    const blob = String(error && (error.message || error.code || error.details || error) || "");
    return /PGRST202|404|could not find the function|list_public_book_categories|schema cache/i.test(blob);
  }

  async function load(db) {
    const cached = readCache();
    if (cached && state.mode !== "authoritative") applyPublic(cached);
    if (!db || typeof db.rpc !== "function") {
      if (state.mode !== "authoritative") applyFailure("unavailable");
      return snapshot();
    }
    try {
      const result = await db.rpc("list_public_book_categories");
      if (result && result.error) {
        if (missingFunction(result.error)) {
          if (state.mode !== "authoritative") state.mode = "legacy";
          publish();
          return snapshot();
        }
        applyFailure(result.error.message || "failed");
        return snapshot();
      }
      applyPublic(result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result);
    } catch (error) {
      if (missingFunction(error)) {
        if (state.mode !== "authoritative") state.mode = "legacy";
        publish();
        return snapshot();
      }
      applyFailure(error && error.message);
    }
    return snapshot();
  }

  function authoritative() {
    return state.mode === "authoritative";
  }

  function visible() {
    return state.mode === "authoritative" ? state.categories.slice() : seedRows();
  }

  function selectionPairs(options) {
    const include = text(options && options.includeSource);
    const rows = authoritative() ? state.categories.slice() : seedRows();
    const pairs = rows.filter((row) => !row.is_hidden || row.source === include).map((row) => [row.source, row.label]);
    if (include && !pairs.some((pair) => pair[0] === include)) {
      const admin = state.adminRows.find((row) => row.source === include);
      const seed = seedRows().find((row) => row.source === include);
      const label = (admin && admin.label) || text(options && options.includeLabel) || (seed && seed.label) || include;
      pairs.push([include, label]);
    }
    return pairs;
  }

  function currentLabel(seedLabel) {
    const wanted = text(seedLabel);
    if (!authoritative()) return wanted;
    const seed = seedRows().find((row) => row.label === wanted || row.source === wanted || row.slug === wanted);
    if (!seed) return wanted;
    const live = state.categories.find((row) => row.source === seed.source);
    return live ? live.label : "";
  }

  function redirectFor(slug) {
    return state.redirects.find((row) => row.slug === text(slug)) || null;
  }

  function snapshot() {
    return {
      mode: state.mode,
      categories: state.categories.slice(),
      redirects: state.redirects.slice(),
      error: state.error
    };
  }

  function setAdminRows(rows) {
    state.adminRows = Array.isArray(rows) ? rows : [];
  }

  async function loadFromConfig() {
    const cfg = root.KUTADGU_SUPABASE_CONFIG || {};
    const base = text(cfg.url).replace(/\/$/, "");
    const key = text(cfg.anonKey || cfg.publishableKey);
    if (!base || !key || typeof root.fetch !== "function") {
      if (state.mode !== "authoritative") applyFailure("unavailable");
      return snapshot();
    }
    try {
      const response = await root.fetch(base + "/rest/v1/rpc/list_public_book_categories", {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      if (response && response.status === 404) {
        if (state.mode !== "authoritative") state.mode = "legacy";
        publish();
        return snapshot();
      }
      if (!response || !response.ok) {
        applyFailure("http");
        return snapshot();
      }
      applyPublic(await response.json());
    } catch (error) {
      applyFailure(error && error.message);
    }
    return snapshot();
  }

  function boot() {
    if (root.document && root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => { void loadFromConfig(); }, { once: true });
      return Promise.resolve(snapshot());
    }
    return loadFromConfig();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function renderHomeCards() {
    if (!authoritative() || !root.document) return;
    const host = root.document.querySelector("#bookCategories .cards");
    if (!host) return;
    const literature = ["romanlar.html", "tarikhiy-romanlar.html", "sheirlar.html", "hekayiler.html", "dastanlar.html", "dunya-edebiyati.html", "adabiyat-roman.html", "uyghur-adabiyati.html"];
    const showHub = state.categories.some((row) => literature.indexOf(row.source) >= 0);
    const hub = showHub
      ? '<a href="/adabiyat" class="card"><div class="icon" aria-hidden="true">📖</div><h3>ئەدەبىيات</h3><p>ئەدەبى ئەسەرلەر، رومان ۋە ھېكايىلەر.</p></a>'
      : "";
    host.innerHTML = hub + state.categories.map((row) => (
      `<a href="/${escapeHtml(row.slug)}" class="card" data-category-source="${escapeHtml(row.source)}">` +
      `<div class="icon" aria-hidden="true">${escapeHtml(row.icon || "📚")}</div>` +
      `<h3>${escapeHtml(row.label)}</h3>` +
      `<p>${escapeHtml(row.summary || row.label)}</p></a>`
    )).join("");
  }

  function renderSearchOptions() {
    if (!authoritative() || !root.document) return;
    const select = root.document.querySelector("#searchCategory");
    if (!select) return;
    const current = select.value;
    const selected = state.categories.find((row) => row.label === current || row.source === current);
    select.innerHTML = '<option value="">بارلىق تۈرلەر</option>' + state.categories.map((row) => (
      `<option value="${escapeHtml(row.label)}" data-source="${escapeHtml(row.source)}">${escapeHtml(row.label)}</option>`
    )).join("");
    if (selected) select.value = selected.label;
  }

  function renderSurfaces() {
    renderHomeCards();
    renderSearchOptions();
  }

  root.__kutadguRenderCategorySurfaces = renderSurfaces;

  const api = {
    load: load,
    authoritative: authoritative,
    visible: visible,
    selectionPairs: selectionPairs,
    currentLabel: currentLabel,
    redirectFor: redirectFor,
    snapshot: snapshot,
    setAdminRows: setAdminRows,
    renderSurfaces: renderSurfaces,
    applyPublic: applyPublic,
    applyFailure: applyFailure,
    loadFromConfig: loadFromConfig,
    boot: boot,
    CACHE_KEY: CACHE_KEY
  };
  root.KutadguBookCategories = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.document) {
    root.document.addEventListener("kutadgu-categories", renderSurfaces);
  }
})(typeof window !== "undefined" ? window : globalThis);
