/**
 * Public homepage About overlay.
 * Fail-open: missing table / request failure / malformed data leave index.html text.
 * Saved copy is applied with textContent only.
 */
(function (root) {
  "use strict";

  var FIELDS = ["year", "title", "intro", "paragraph1", "paragraph2", "closing", "chip1", "chip2", "chip3"];
  var MAX = {
    year: 20,
    title: 80,
    intro: 500,
    paragraph1: 800,
    paragraph2: 800,
    closing: 500,
    chip1: 80,
    chip2: 80,
    chip3: 80
  };

  function aboutSection() {
    if (typeof document === "undefined") return null;
    return document.querySelector("#about.about, section.about");
  }

  function fieldEl(name) {
    var section = aboutSection();
    if (!section) return null;
    return section.querySelector('[data-about-field="' + name + '"]');
  }

  function captureFallback() {
    var snap = {};
    FIELDS.forEach(function (name) {
      var el = fieldEl(name);
      snap[name] = el ? String(el.textContent || "") : "";
    });
    return snap;
  }

  function sanitizePlainText(value, max) {
    var text = String(value == null ? "" : value);
    text = text.replace(/\u0000/g, "").replace(/[<>]/g, "");
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (text.length > max) text = text.slice(0, max);
    return text;
  }

  function normalizeContent(raw) {
    var src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var out = {};
    FIELDS.forEach(function (name) {
      out[name] = sanitizePlainText(src[name], MAX[name]);
    });
    return out;
  }

  function applyContent(content, fallback) {
    var data = normalizeContent(content);
    var fb = fallback || {};
    FIELDS.forEach(function (name) {
      var el = fieldEl(name);
      if (!el) return;
      var next = data[name] || fb[name] || "";
      el.textContent = next;
    });
  }

  function publicConfig() {
    var c = (root && root.KUTADGU_SUPABASE_CONFIG) || {};
    return {
      url: String(c.url || "").replace(/\/+$/, ""),
      key: String(c.anonKey || c.publishableKey || "")
    };
  }

  function restGet() {
    var c = publicConfig();
    if (!c.url || !c.key) return Promise.resolve({ error: true });
    return fetch(c.url + "/rest/v1/store_homepage_about?select=id,content&id=eq.1", {
      method: "GET",
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        Accept: "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache"
      },
      cache: "no-store",
      credentials: "omit"
    }).then(function (res) {
      if (!res.ok) return { error: true, status: res.status };
      return res.json().then(function (data) {
        return { data: data };
      });
    }).catch(function () {
      return { error: true };
    });
  }

  function rowContent(payload) {
    var rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    var row = rows[0];
    if (!row || row.content == null) return null;
    if (typeof row.content === "string") {
      try { return JSON.parse(row.content); } catch (err) { return null; }
    }
    if (typeof row.content === "object") return row.content;
    return null;
  }

  var fallback = null;
  var booted = false;

  function loadAbout() {
    if (!fallback) fallback = captureFallback();
    return restGet().then(function (res) {
      if (res.error) {
        applyContent({}, fallback);
        return { ok: false };
      }
      var content = rowContent(res.data);
      if (!content) {
        applyContent({}, fallback);
        return { ok: false };
      }
      applyContent(content, fallback);
      return { ok: true, content: normalizeContent(content) };
    }).catch(function () {
      applyContent({}, fallback);
      return { ok: false };
    });
  }

  function boot() {
    if (booted) return;
    if (typeof document === "undefined") return;
    if (!aboutSection()) return;
    booted = true;
    fallback = captureFallback();
    loadAbout();
  }

  var api = {
    FIELDS: FIELDS,
    MAX: MAX,
    sanitizePlainText: sanitizePlainText,
    normalizeContent: normalizeContent,
    applyContent: applyContent,
    loadAbout: loadAbout,
    boot: boot
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguHomeAbout = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
