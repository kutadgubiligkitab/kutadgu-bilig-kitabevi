/**
 * Storefront announcement bar (PR #36).
 * Fail-open: missing table / request failure → no bar.
 * Mounts inside the existing brown header. Does not wrap header.
 * Announcement text is always assigned with textContent (never innerHTML).
 */
(function (root) {
  "use strict";

  var BAR_ID = "kutadguAnnounceBar";
  var TEXT_ID = "kutadguAnnounceText";
  var VIEW_ID = "kutadguAnnounceViewport";
  var TRACK_ID = "kutadguAnnounceTrack";
  var STYLE_ID = "kutadgu-announce-style";
  var HEIGHT_VAR = "--kutadgu-sticky-header-height";
  var DEFAULT_INTERVAL = 5;
  var MIN_INTERVAL = 2;
  var MAX_INTERVAL = 60;
  var FADE_MS = 280;
  var TICKER_PX_PER_SEC = 42;
  var TICKER_MIN_MS = 8000;
  var TICKER_MAX_MS = 90000;

  var timer = null;
  var index = 0;
  var items = [];
  var intervalSec = DEFAULT_INTERVAL;
  var paused = false;
  var headerObserver = null;
  var booted = false;
  var tickerRaf = 0;
  var layoutKey = "";

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

  function isTickerOverflow(scrollWidth, clientWidth) {
    var sw = Number(scrollWidth);
    var cw = Number(clientWidth);
    if (!Number.isFinite(sw) || !Number.isFinite(cw)) return false;
    return sw > cw + 1;
  }

  function computeTickerDurationMs(distancePx) {
    var d = Number(distancePx);
    if (!Number.isFinite(d) || d <= 0) return TICKER_MIN_MS;
    var ms = Math.round((d / TICKER_PX_PER_SEC) * 1000);
    if (ms < TICKER_MIN_MS) return TICKER_MIN_MS;
    if (ms > TICKER_MAX_MS) return TICKER_MAX_MS;
    return ms;
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
      "display:none;align-items:center;justify-content:center;" +
      "min-height:0;padding:5px 14px;margin:0;" +
      "background:rgba(226,201,141,.16);color:#f6ead7;" +
      "border-top:1px solid rgba(226,201,141,.28);" +
      "font-size:13px;font-weight:700;line-height:1.45;" +
      "text-align:center;overflow:hidden;pointer-events:auto;}" +
      "#" + BAR_ID + ".is-visible{display:flex;}" +
      "#" + VIEW_ID + "{" +
      "flex:1 1 auto;min-width:0;width:100%;max-width:100%;overflow:hidden;" +
      "display:flex;align-items:center;justify-content:center;direction:ltr;}" +
      "#" + BAR_ID + ".is-ticker #" + VIEW_ID + "{justify-content:flex-start;}" +
      "#" + TRACK_ID + "{" +
      "display:inline-flex;flex-direction:row;align-items:center;gap:0;" +
      "width:max-content;max-width:none;white-space:nowrap;direction:ltr;" +
      "transform:none;will-change:auto;}" +
      "#" + TRACK_ID + ".is-prepared #" + TEXT_ID + "," +
      "#" + TRACK_ID + ".is-prepared [data-announce-clone]{padding-inline-end:3em;}" +
      "#" + BAR_ID + ".is-ticker #" + TRACK_ID + "{" +
      "animation-name:kutadgu-announce-ltr;" +
      "animation-timing-function:linear;" +
      "animation-iteration-count:infinite;" +
      "animation-delay:0s;" +
      "will-change:transform;}" +
      "#" + BAR_ID + ".is-paused #" + TRACK_ID + "," +
      "#" + BAR_ID + ":hover #" + TRACK_ID + "," +
      "#" + BAR_ID + ":focus-within #" + TRACK_ID + "{" +
      "animation-play-state:paused;}" +
      "#" + TEXT_ID + ",#" + TRACK_ID + " [data-announce-clone]{" +
      "display:inline-block;flex:0 0 auto;white-space:nowrap;" +
      "overflow:visible;text-overflow:clip;max-width:none;" +
      "line-clamp:none;-webkit-line-clamp:unset;" +
      "direction:rtl;unicode-bidi:isolate;" +
      "color:inherit;" +
      "transition:opacity " + FADE_MS + "ms ease;}" +
      "#" + BAR_ID + ".is-wrap #" + TEXT_ID + "{white-space:normal;overflow:visible;padding-inline-end:0;}" +
      "#" + BAR_ID + ".is-wrap #" + VIEW_ID + "{justify-content:center;}" +
      "@keyframes kutadgu-announce-ltr{" +
      "from{transform:translate3d(calc(-1 * var(--kutadgu-announce-travel, 0px)),0,0);}" +
      "to{transform:translate3d(0,0,0);}" +
      "}" +
      "@media (max-width:700px){" +
      "#" + BAR_ID + "{padding:4px 48px;font-size:12px;line-height:1.35;}" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      "#" + BAR_ID + " #" + TRACK_ID + "{animation:none!important;transform:none!important;}" +
      "#" + BAR_ID + ".is-wrap #" + TEXT_ID + "{white-space:normal;}" +
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

  function setText(message) {
    var el = document.getElementById(TEXT_ID);
    if (!el) return;
    el.textContent = String(message || "").trim();
    scheduleTicker();
  }

  function showIndex(next, animate) {
    if (!items.length) return;
    index = ((next % items.length) + items.length) % items.length;
    var el = document.getElementById(TEXT_ID);
    var msg = String(items[index].message || "").trim();
    if (!el) return;
    if (!animate) {
      if (el.textContent !== msg) layoutKey = "";
      el.style.opacity = "1";
      el.textContent = msg;
      scheduleTicker();
      return;
    }
    el.style.opacity = "0";
    setTimeout(function () {
      if (el.textContent !== msg) layoutKey = "";
      el.textContent = msg;
      el.style.opacity = "1";
      scheduleTicker();
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

  function removeTickerClone(track) {
    if (!track) return;
    var clones = track.querySelectorAll("[data-announce-clone]");
    for (var i = 0; i < clones.length; i++) clones[i].parentNode.removeChild(clones[i]);
  }

  function teardownTicker(bar) {
    if (!bar) bar = document.getElementById(BAR_ID);
    if (!bar) return;
    bar.classList.remove("is-ticker", "is-wrap");
    bar.removeAttribute("tabindex");
    var track = document.getElementById(TRACK_ID);
    if (track) {
      track.style.animationDuration = "";
      track.style.removeProperty("--kutadgu-announce-travel");
      track.classList.remove("is-prepared");
      removeTickerClone(track);
    }
  }

  function measureAndApplyTicker() {
    var bar = document.getElementById(BAR_ID);
    var viewport = document.getElementById(VIEW_ID);
    var track = document.getElementById(TRACK_ID);
    var text = document.getElementById(TEXT_ID);
    if (!bar || !viewport || !track || !text || !items.length) {
      teardownTicker(bar);
      return;
    }
    var message = String(text.textContent || "").trim();
    if (!message) {
      layoutKey = "";
      teardownTicker(bar);
      return;
    }
    var viewportW = Math.round(viewport.clientWidth);
    var prefix = message + "|" + viewportW + "|";
    if (layoutKey.indexOf(prefix) === 0) {
      if (bar.classList.contains("is-wrap")) text.style.whiteSpace = "normal";
      return;
    }
    var reduced = prefersReducedMotion();
    text.style.whiteSpace = "nowrap";
    var textW = text.scrollWidth;
    if (!(viewportW > 0) || !(textW > 0)) {
      layoutKey = "";
      teardownTicker(bar);
      return;
    }
    var overflowing = isTickerOverflow(textW, viewportW);
    var existing = track.querySelector("[data-announce-clone]");
    var mode = !overflowing ? "static" : (reduced ? "wrap" : "ticker");
    layoutKey = prefix + mode;
    if (mode === "static") {
      bar.classList.remove("is-ticker", "is-wrap");
      bar.removeAttribute("tabindex");
      track.classList.remove("is-prepared");
      track.style.removeProperty("--kutadgu-announce-travel");
      if (existing) existing.parentNode.removeChild(existing);
      track.style.animationDuration = "";
      text.style.whiteSpace = "nowrap";
      return;
    }
    if (mode === "wrap") {
      if (existing) existing.parentNode.removeChild(existing);
      bar.classList.remove("is-ticker");
      track.classList.remove("is-prepared");
      track.style.removeProperty("--kutadgu-announce-travel");
      bar.classList.add("is-wrap");
      text.style.whiteSpace = "normal";
      bar.removeAttribute("tabindex");
      track.style.animationDuration = "";
      return;
    }
    bar.classList.remove("is-wrap");
    if (!existing) {
      existing = text.cloneNode(true);
      existing.removeAttribute("id");
      existing.setAttribute("aria-hidden", "true");
      existing.setAttribute("data-announce-clone", "1");
    } else if (existing.textContent !== text.textContent) {
      existing.textContent = text.textContent;
    }
    if (existing.parentNode !== track || existing.nextSibling !== text) {
      track.insertBefore(existing, text);
    }
    track.classList.add("is-prepared");
    var copyW = Math.round(text.getBoundingClientRect().width);
    if (!(copyW > 0)) {
      layoutKey = "";
      teardownTicker(bar);
      return;
    }
    track.style.setProperty("--kutadgu-announce-travel", copyW + "px");
    track.style.animationDuration = computeTickerDurationMs(copyW) + "ms";
    bar.classList.add("is-ticker");
    bar.setAttribute("tabindex", "0");
  }

  function scheduleTicker() {
    if (typeof requestAnimationFrame !== "function") {
      measureAndApplyTicker();
      syncHeaderOffset();
      return;
    }
    if (tickerRaf) cancelAnimationFrame(tickerRaf);
    tickerRaf = requestAnimationFrame(function () {
      tickerRaf = requestAnimationFrame(function () {
        tickerRaf = 0;
        measureAndApplyTicker();
        syncHeaderOffset();
      });
    });
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
    layoutKey = "";
    var bar = document.getElementById(BAR_ID);
    teardownTicker(bar);
    if (bar) {
      bar.classList.remove("is-visible");
      bar.hidden = true;
      bar.style.display = "none";
    }
    setText("");
    syncHeaderOffset();
  }

  function bindBarPause(bar) {
    if (!bar || bar.dataset.pauseBound === "1") return;
    bar.dataset.pauseBound = "1";
    bar.addEventListener("mouseenter", function () { paused = true; });
    bar.addEventListener("mouseleave", function () { paused = false; });
    bar.addEventListener("focusin", function () { paused = true; });
    bar.addEventListener("focusout", function () { paused = false; });
    bar.addEventListener("pointerdown", function () {
      paused = true;
      bar.classList.add("is-paused");
    });
    bar.addEventListener("pointerup", function () {
      paused = false;
      bar.classList.remove("is-paused");
    });
    bar.addEventListener("pointercancel", function () {
      paused = false;
      bar.classList.remove("is-paused");
    });
  }

  function ensureTrack(bar) {
    var text = document.getElementById(TEXT_ID);
    if (!text) {
      text = document.createElement("span");
      text.id = TEXT_ID;
    }
    var viewport = document.getElementById(VIEW_ID);
    if (!viewport) {
      viewport = document.createElement("div");
      viewport.id = VIEW_ID;
    }
    var track = document.getElementById(TRACK_ID);
    if (!track) {
      track = document.createElement("div");
      track.id = TRACK_ID;
    }
    if (text.parentElement !== track) track.appendChild(text);
    if (track.parentElement !== viewport) viewport.appendChild(track);
    if (viewport.parentElement !== bar) bar.appendChild(viewport);
    return { viewport: viewport, track: track, text: text };
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
    ensureTrack(bar);
    bindBarPause(bar);
    return bar;
  }

  function observeLayout(header) {
    if (headerObserver) headerObserver.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    headerObserver = new ResizeObserver(function () {
      scheduleTicker();
    });
    headerObserver.observe(header);
    var viewport = document.getElementById(VIEW_ID);
    if (viewport) headerObserver.observe(viewport);
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
      root.addEventListener("resize", function () { scheduleTicker(); });
    }
  }

  var api = {
    BAR_ID: BAR_ID,
    clampInterval: clampInterval,
    shouldAutoplay: shouldAutoplay,
    isTickerOverflow: isTickerOverflow,
    computeTickerDurationMs: computeTickerDurationMs,
    isAnnouncementCurrent: isAnnouncementCurrent,
    filterActive: filterActive,
    sortAnnouncements: sortAnnouncements,
    prefersReducedMotion: prefersReducedMotion,
    syncHeaderOffset: syncHeaderOffset,
    ensureLogoHomeLink: ensureLogoHomeLink,
    apply: apply,
    boot: boot,
    _state: function () {
      return { items: items, index: index, intervalSec: intervalSec, paused: paused, timer: !!timer };
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
