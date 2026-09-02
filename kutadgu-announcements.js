/**
 * Storefront announcement bar (PR #36).
 * Fail-open: missing table / request failure → no bar.
 * Mounts inside the existing brown header. Does not wrap header.
 * Announcement text is always assigned with textContent (never innerHTML).
 * Short copy stays static; long copy clamps to two lines with in-place expand.
 */
(function (root) {
  "use strict";

  var BAR_ID = "kutadguAnnounceBar";
  var INNER_ID = "kutadguAnnounceInner";
  var TEXT_ID = "kutadguAnnounceText";
  var TOGGLE_ID = "kutadguAnnounceToggle";
  var STYLE_ID = "kutadgu-announce-style";
  var HEIGHT_VAR = "--kutadgu-sticky-header-height";
  var DEFAULT_INTERVAL = 5;
  var MIN_INTERVAL = 2;
  var MAX_INTERVAL = 60;
  var FADE_MS = 280;
  var EXPAND_LABEL = "تەپسىلات ↓";
  var COLLAPSE_LABEL = "يىغىش ↑";

  var timer = null;
  var index = 0;
  var items = [];
  var intervalSec = DEFAULT_INTERVAL;
  var paused = false;
  var headerObserver = null;
  var booted = false;
  var measureRaf = 0;
  var expanded = false;
  var lastMessage = "";

  function pageName() {
    if (typeof location === "undefined") return "";
    var p = (location.pathname || "").replace(/\/+$/, "");
    var last = p.split("/").pop() || "";
    return last.toLowerCase();
  }

  function isSkippedSurface() {
    var n = pageName();
    return n === "admin.html" || n === "admin-quality-preview.html" || n === "reset-password.html";
  }

  function clampInterval(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_INTERVAL;
    n = Math.round(n);
    if (n < MIN_INTERVAL) return MIN_INTERVAL;
    if (n > MAX_INTERVAL) return MAX_INTERVAL;
    return n;
  }

  function prefersReducedMotion() {
    try {
      return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  function shouldAutoplay(count, opts) {
    opts = opts || {};
    var n = Number(count) || 0;
    if (n <= 1) return false;
    if (opts.reducedMotion) return false;
    return true;
  }

  function isLineOverflowing(scrollHeight, clientHeight) {
    var sh = Number(scrollHeight);
    var ch = Number(clientHeight);
    if (!Number.isFinite(sh) || !Number.isFinite(ch)) return false;
    return sh > ch + 1;
  }

  function isAnnouncementCurrent(row, nowMs) {
    if (!row || typeof row !== "object") return false;
    if (row.enabled === false || row.enabled === "false" || row.enabled === 0) return false;
    var message = String(row.message || "").trim();
    if (!message) return false;
    var now = nowMs == null ? Date.now() : Number(nowMs);
    if (row.starts_at) {
      var start = Date.parse(row.starts_at);
      if (!Number.isNaN(start) && start > now) return false;
    }
    if (row.ends_at) {
      var end = Date.parse(row.ends_at);
      if (!Number.isNaN(end) && end < now) return false;
    }
    return true;
  }

  function sortAnnouncements(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort(function (a, b) {
      var sa = Number(a && a.sort_order);
      var sb = Number(b && b.sort_order);
      if (!Number.isFinite(sa)) sa = 0;
      if (!Number.isFinite(sb)) sb = 0;
      if (sa !== sb) return sa - sb;
      return String((a && a.created_at) || "").localeCompare(String((b && b.created_at) || ""));
    });
  }

  function filterActive(rows, nowMs) {
    return sortAnnouncements(rows).filter(function (row) {
      return isAnnouncementCurrent(row, nowMs);
    });
  }

  function publicConfig() {
    var c = (root.KUTADGU_SUPABASE_CONFIG) || {};
    return {
      url: String(c.url || "").replace(/\/+$/, ""),
      key: String(c.anonKey || c.publishableKey || "")
    };
  }

  function restHeaders() {
    var c = publicConfig();
    return {
      apikey: c.key,
      Authorization: "Bearer " + c.key,
      Accept: "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache"
    };
  }

  async function restGet(path) {
    var c = publicConfig();
    if (!c.url || !c.key) return { error: true };
    try {
      var res = await fetch(c.url + path, {
        method: "GET",
        headers: restHeaders(),
        cache: "no-store",
        credentials: "omit"
      });
      if (!res.ok) return { error: true, status: res.status };
      var data = await res.json();
      return { data: data };
    } catch (e) {
      return { error: true };
    }
  }

  function findStorefrontHeader() {
    if (typeof document === "undefined") return null;
    if (document.querySelector(".admin-shell, .admin-topbar")) return null;
    return document.querySelector("body > header:not(.account-topbar)") ||
      document.querySelector(".mobile-site-header");
  }

  function ensureLogoHomeLink(header) {
    if (!header) return;
    var logos = header.querySelectorAll(".logo, .mobile-site-brand");
    logos.forEach(function (logo) {
      if (!logo || logo.closest(".admin-brand, .admin-topbar, .admin-shell")) return;
      if (logo.tagName === "A") return;
      var a = document.createElement("a");
      a.className = logo.className;
      a.href = "/";
      a.setAttribute("aria-label", "باش بەت");
      while (logo.firstChild) a.appendChild(logo.firstChild);
      logo.replaceWith(a);
    });
  }

  function injectStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    var css = document.createElement("style");
    css.id = STYLE_ID;
    css.textContent =
      "body > header:not(.account-topbar):not(.admin-topbar){" +
      "flex-wrap:wrap;}" +
      "#" + BAR_ID + "{" +
      "flex:1 0 100%;width:100%;max-width:100%;box-sizing:border-box;" +
      "display:none;flex-direction:column;align-items:center;justify-content:center;" +
      "min-height:0;padding:2px 16px;margin:0;" +
      "background:rgba(226,201,141,.16);color:#f6ead7;" +
      "border-top:1px solid rgba(226,201,141,.28);" +
      "font-size:13px;font-weight:700;line-height:1.5;" +
      "text-align:center;overflow-x:hidden;overflow-y:visible;pointer-events:auto;}" +
      "#" + BAR_ID + ".is-visible{display:flex;}" +
      "#" + INNER_ID + "{" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "gap:3px;width:90%;max-width:42rem;min-width:0;margin:0 auto;box-sizing:border-box;}" +
      "#" + TEXT_ID + "{" +
      "display:block;width:100%;max-width:100%;margin:0;padding:0;box-sizing:border-box;" +
      "color:inherit;font:inherit;font-weight:700;line-height:inherit;" +
      "text-align:center;direction:rtl;unicode-bidi:isolate;" +
      "white-space:normal;overflow-wrap:anywhere;word-break:normal;" +
      "overflow:visible;text-overflow:clip;" +
      "transition:opacity " + FADE_MS + "ms ease;}" +
      "#" + TEXT_ID + ".is-clamped{" +
      "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;" +
      "overflow:hidden;text-overflow:clip;}" +
      "#" + TOGGLE_ID + "{" +
      "appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;" +
      "gap:0;margin:0 auto;padding:3px 10px;min-height:28px;min-width:44px;box-sizing:border-box;" +
      "background:rgba(246,234,215,.12);border:1px solid rgba(226,201,141,.42);" +
      "border-radius:999px;color:inherit;font:inherit;font-size:11px;font-weight:700;" +
      "line-height:1.2;letter-spacing:0;text-decoration:none;cursor:pointer;opacity:.95;}" +
      "#" + TOGGLE_ID + ":hover,#" + TOGGLE_ID + ":focus-visible{opacity:1;background:rgba(246,234,215,.18);}" +
      "#" + TOGGLE_ID + "[hidden]{display:none!important;}" +
      "@media (max-width:700px){" +
      "#" + BAR_ID + "{flex:1 0 auto;align-self:stretch;width:calc(100% + 124px);max-width:none;" +
      "margin-inline:-62px;padding:1px max(48px, 5%) 2px;font-size:12px;line-height:1.5;}" +
      "#" + BAR_ID + " #" + INNER_ID + "{width:90%;max-width:none;gap:2px;}" +
      "#" + TOGGLE_ID + "{min-height:32px;padding:2px 10px;}" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      "#" + TEXT_ID + "{transition:none;}" +
      "}" +
      ".home-search-card-section,.home-search-card-section#books,#books{" +
      "scroll-margin-top:calc(var(" + HEIGHT_VAR + ", 80px) + 16px);}";
    (document.head || document.documentElement).appendChild(css);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function setToggleUi(isExpanded, overflowing) {
    var bar = document.getElementById(BAR_ID);
    var text = document.getElementById(TEXT_ID);
    var toggle = document.getElementById(TOGGLE_ID);
    expanded = !!(isExpanded && overflowing);
    if (toggle) {
      toggle.hidden = !overflowing;
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.textContent = expanded ? COLLAPSE_LABEL : EXPAND_LABEL;
    }
    if (bar) bar.classList.toggle("is-expanded", expanded);
    if (text) text.classList.toggle("is-clamped", overflowing && !expanded);
  }

  function measureAndApplyClamp() {
    var bar = document.getElementById(BAR_ID);
    var text = document.getElementById(TEXT_ID);
    if (!bar || !text || !bar.classList.contains("is-visible")) {
      setToggleUi(false, false);
      return;
    }
    var keepExpanded = expanded;
    bar.classList.remove("is-expanded");
    text.classList.add("is-clamped");
    var overflowing = isLineOverflowing(text.scrollHeight, text.clientHeight);
    setToggleUi(keepExpanded, overflowing);
  }

  function scheduleMeasure() {
    if (typeof requestAnimationFrame !== "function") {
      measureAndApplyClamp();
      syncHeaderOffset();
      return;
    }
    if (measureRaf) cancelAnimationFrame(measureRaf);
    measureRaf = requestAnimationFrame(function () {
      measureRaf = requestAnimationFrame(function () {
        measureRaf = 0;
        measureAndApplyClamp();
        syncHeaderOffset();
      });
    });
  }

  function resetExpandedForNewCopy(message) {
    var next = String(message || "").trim();
    if (next !== lastMessage) {
      expanded = false;
      lastMessage = next;
    }
  }

  function setText(message) {
    var el = document.getElementById(TEXT_ID);
    if (!el) return;
    resetExpandedForNewCopy(message);
    el.textContent = String(message || "").trim();
    scheduleMeasure();
  }

  function showIndex(next, animate) {
    if (!items.length) return;
    index = ((next % items.length) + items.length) % items.length;
    var el = document.getElementById(TEXT_ID);
    var msg = String(items[index].message || "").trim();
    if (!el) return;
    resetExpandedForNewCopy(msg);
    if (!animate) {
      el.style.opacity = "1";
      el.textContent = msg;
      scheduleMeasure();
      return;
    }
    el.style.opacity = "0";
    setTimeout(function () {
      el.textContent = msg;
      el.style.opacity = "1";
      scheduleMeasure();
    }, FADE_MS);
  }

  function startTimer() {
    stopTimer();
    if (!shouldAutoplay(items.length, { reducedMotion: prefersReducedMotion() })) return;
    var ms = clampInterval(intervalSec) * 1000;
    timer = setInterval(function () {
      if (paused) return;
      showIndex(index + 1, true);
    }, ms);
  }

  function syncHeaderOffset() {
    if (typeof document === "undefined") return 0;
    var header = findStorefrontHeader();
    var height = 0;
    if (header) height = Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty(HEIGHT_VAR, height + "px");
    document.documentElement.classList.toggle("has-announce-bar", items.length > 0);
    return height;
  }

  function hideBar() {
    stopTimer();
    items = [];
    index = 0;
    expanded = false;
    lastMessage = "";
    var bar = document.getElementById(BAR_ID);
    if (bar) {
      bar.classList.remove("is-visible", "is-expanded");
      bar.hidden = true;
      bar.style.display = "none";
    }
    setToggleUi(false, false);
    setText("");
    syncHeaderOffset();
  }

  function onToggleClick(event) {
    if (event) event.preventDefault();
    var toggle = document.getElementById(TOGGLE_ID);
    if (!toggle || toggle.hidden) return;
    setToggleUi(!expanded, true);
    syncHeaderOffset();
  }

  function bindBarPause(bar) {
    if (!bar || bar.dataset.pauseBound === "1") return;
    bar.dataset.pauseBound = "1";
    bar.addEventListener("mouseenter", function () { paused = true; });
    bar.addEventListener("mouseleave", function () { paused = false; });
    bar.addEventListener("focusin", function () { paused = true; });
    bar.addEventListener("focusout", function () { paused = false; });
  }

  function bindToggle(toggle) {
    if (!toggle || toggle.dataset.toggleBound === "1") return;
    toggle.dataset.toggleBound = "1";
    toggle.addEventListener("click", onToggleClick);
  }

  function ensureStructure(bar) {
    var inner = document.getElementById(INNER_ID);
    if (!inner) {
      inner = document.createElement("div");
      inner.id = INNER_ID;
    }
    var text = document.getElementById(TEXT_ID);
    if (!text) {
      text = document.createElement("p");
      text.id = TEXT_ID;
    }
    var toggle = document.getElementById(TOGGLE_ID);
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.id = TOGGLE_ID;
      toggle.type = "button";
    }
    toggle.setAttribute("aria-controls", TEXT_ID);
    toggle.setAttribute("aria-expanded", "false");
    if (!toggle.textContent) toggle.textContent = EXPAND_LABEL;
    toggle.hidden = true;
    if (text.parentElement !== inner) inner.appendChild(text);
    if (toggle.parentElement !== inner) inner.appendChild(toggle);
    if (inner.parentElement !== bar) bar.appendChild(inner);
    bindToggle(toggle);
    return { inner: inner, text: text, toggle: toggle };
  }

  function ensureBar(header) {
    var bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BAR_ID;
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      bar.hidden = true;
      header.appendChild(bar);
    } else if (bar.parentElement !== header) {
      header.appendChild(bar);
    }
    ensureStructure(bar);
    bindBarPause(bar);
    return bar;
  }

  function observeLayout(header) {
    if (headerObserver) headerObserver.disconnect();
    if (typeof ResizeObserver === "undefined") {
      scheduleMeasure();
      return;
    }
    headerObserver = new ResizeObserver(function () {
      scheduleMeasure();
    });
    headerObserver.observe(header);
    var bar = document.getElementById(BAR_ID);
    var text = document.getElementById(TEXT_ID);
    if (bar) headerObserver.observe(bar);
    if (text) headerObserver.observe(text);
  }

  function renderBar(header) {
    injectStyles();
    ensureLogoHomeLink(header);
    var bar = ensureBar(header);
    observeLayout(header);
    if (!items.length) {
      hideBar();
      return;
    }
    bar.hidden = false;
    bar.style.display = "flex";
    bar.classList.add("is-visible");
    paused = false;
    expanded = false;
    showIndex(0, false);
    startTimer();
    requestAnimationFrame(function () {
      syncHeaderOffset();
      requestAnimationFrame(syncHeaderOffset);
    });
  }

  async function loadPayload() {
    var listRes = await restGet(
      "/rest/v1/store_announcements?select=id,message,enabled,sort_order,starts_at,ends_at,created_at&order=sort_order.asc,created_at.asc"
    );
    if (listRes.error) return { error: true, items: [], interval: DEFAULT_INTERVAL };
    var settingsRes = await restGet(
      "/rest/v1/store_announcement_settings?select=id,rotation_interval_seconds&id=eq.1"
    );
    var interval = DEFAULT_INTERVAL;
    if (!settingsRes.error) {
      var settingsRows = Array.isArray(settingsRes.data) ? settingsRes.data : settingsRes.data ? [settingsRes.data] : [];
      if (settingsRows[0]) interval = clampInterval(settingsRows[0].rotation_interval_seconds);
    }
    return {
      error: false,
      items: filterActive(Array.isArray(listRes.data) ? listRes.data : []),
      interval: interval
    };
  }

  async function apply() {
    if (typeof document === "undefined" || isSkippedSurface()) return;
    injectStyles();
    var header = findStorefrontHeader();
    if (!header) return;
    ensureLogoHomeLink(header);
    var payload = await loadPayload();
    if (payload.error) {
      hideBar();
      ensureLogoHomeLink(header);
      return;
    }
    items = payload.items;
    intervalSec = payload.interval;
    renderBar(header);
  }

  function boot() {
    if (booted) return;
    if (typeof document === "undefined") return;
    if (isSkippedSurface()) return;
    booted = true;
    injectStyles();
    var run = function () { apply(); };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
    if (root.addEventListener) {
      root.addEventListener("resize", scheduleMeasure);
      root.addEventListener("orientationchange", scheduleMeasure);
    }
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        scheduleMeasure();
      }).catch(function () {});
    }
  }

  var api = {
    BAR_ID: BAR_ID,
    clampInterval: clampInterval,
    shouldAutoplay: shouldAutoplay,
    isLineOverflowing: isLineOverflowing,
    isAnnouncementCurrent: isAnnouncementCurrent,
    filterActive: filterActive,
    sortAnnouncements: sortAnnouncements,
    prefersReducedMotion: prefersReducedMotion,
    syncHeaderOffset: syncHeaderOffset,
    ensureLogoHomeLink: ensureLogoHomeLink,
    apply: apply,
    boot: boot,
    _state: function () {
      return { items: items, index: index, intervalSec: intervalSec, paused: paused, timer: !!timer, expanded: expanded };
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.kutadguAnnouncements = api;
    if (typeof document !== "undefined") boot();
  }
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
