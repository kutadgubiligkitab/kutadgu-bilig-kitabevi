/**
 * Public Contact + JSON-LD shop hours overlay.
 * Fail-open: missing table / request failure / invalid payload leave index.html
 * Contact copy and BookStore openingHours unchanged.
 */
(function (root) {
  "use strict";

  var Hours = (root && root.KutadguShopHours) || {};

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
    return fetch(c.url + "/rest/v1/store_shop_hours?select=id,content&id=eq.1", {
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

  function applyContact(hours) {
    if (!Hours.formatContactHours) return;
    var display = Hours.formatContactHours(hours);
    if (root.KUTADGU_CONTACT_CONFIG) {
      root.KUTADGU_CONTACT_CONFIG.hours = display.hoursText;
    }
    if (typeof document === "undefined") return;
    var small = document.querySelector("#contactHoursText, #contact .contact-hours small, #contactDetails .contact-hours small");
    if (small) small.innerHTML = display.hoursHtml;
  }

  function applyJsonLd(hours) {
    if (!Hours.formatOpeningHours || typeof document === "undefined") return;
    var opening = Hours.formatOpeningHours(hours);
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var parsed;
      try { parsed = JSON.parse(node.textContent || ""); } catch (err) { continue; }
      var graph = parsed && parsed["@graph"];
      var list = Array.isArray(graph) ? graph : parsed ? [parsed] : [];
      var changed = false;
      list.forEach(function (item) {
        var types = item && item["@type"];
        var isStore = types === "BookStore" || (Array.isArray(types) && types.indexOf("BookStore") !== -1);
        if (!isStore) return;
        item.openingHours = opening.slice();
        changed = true;
      });
      if (changed) node.textContent = JSON.stringify(parsed);
    }
  }

  var lastHours = null;

  function applyHours(hours) {
    lastHours = hours;
    applyContact(hours);
    applyJsonLd(hours);
  }

  function loadHours() {
    return restGet().then(function (res) {
      if (res.error) return { ok: false };
      var content = rowContent(res.data);
      var checked = Hours.validateHours ? Hours.validateHours(content) : { ok: false };
      if (!checked.ok) return { ok: false };
      applyHours(checked.hours);
      return { ok: true, hours: checked.hours };
    }).catch(function () {
      return { ok: false };
    });
  }

  var booted = false;
  function boot() {
    if (booted) return;
    if (typeof document === "undefined") return;
    if (!document.querySelector("#contact, #contactDetails")) return;
    booted = true;
    loadHours();
    document.addEventListener("kutadgu:catalog-ready", function () {
      if (lastHours) applyHours(lastHours);
    });
  }

  var api = {
    applyHours: applyHours,
    applyContact: applyContact,
    applyJsonLd: applyJsonLd,
    loadHours: loadHours,
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
  if (root) root.KutadguStoreHoursContent = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
