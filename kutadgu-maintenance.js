/**
 * Global Maintenance Mode guard (PR #32).
 *
 * Loaded from supabase-config.js on customer-facing pages (not Admin).
 * Uses the same public PostgREST + admin_users authorization as Admin.
 * Does not use query-string, localStorage flags, or a hardcoded secret.
 *
 * Fail-open: lookup errors / missing table → storefront stays visible.
 */
(function () {
  "use strict";

  var SETTING_KEY = "maintenance_mode";
  var PENDING_CLASS = "kutadgu-maint-pending";
  var ACTIVE_CLASS = "kutadgu-maint-active";
  var OVERLAY_ID = "kutadgu-maintenance-overlay";

  function pageName() {
    var p = (location.pathname || "").replace(/\/+$/, "");
    var last = p.split("/").pop() || "";
    return last.toLowerCase();
  }

  function isAdminSurface() {
    var n = pageName();
    return n === "admin.html" || n === "admin-quality-preview.html";
  }

  function isAuthRecoverySurface() {
    return pageName() === "reset-password.html";
  }

  function publicConfig() {
    var c = window.KUTADGU_SUPABASE_CONFIG || {};
    return {
      url: String(c.url || "").replace(/\/+$/, ""),
      key: String(c.anonKey || c.publishableKey || "")
    };
  }

  function hidePending() {
    try {
      document.documentElement.classList.remove(PENDING_CLASS);
      if (document.body) document.body.classList.remove(PENDING_CLASS);
    } catch (e) {}
  }

  function showStorefront() {
    try {
      document.documentElement.classList.remove(ACTIVE_CLASS);
      if (document.body) document.body.classList.remove(ACTIVE_CLASS);
    } catch (e) {}
    hidePending();
    hideAdminBypassNotice();
    var el = document.getElementById(OVERLAY_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function injectOverlayStyles() {
    if (document.getElementById("kutadgu-maintenance-style")) return;
    var css = document.createElement("style");
    css.id = "kutadgu-maintenance-style";
    css.textContent =
      "html.kutadgu-maint-pending body," +
      "body.kutadgu-maint-pending{" +
      "visibility:hidden!important}" +
      "html.kutadgu-maint-active body > *:not(#" +
      OVERLAY_ID +
      "){display:none!important}" +
      "#" +
      OVERLAY_ID +
      "{display:flex!important;position:fixed;inset:0;z-index:2147483000;" +
      "align-items:center;justify-content:center;padding:24px;" +
      "background:#f6efe4;color:#3d2914;font-family:'UKIJ Ekran'," +
      "'UKIJ Tuz Tom','Noto Naskh Arabic','Noto Sans Arabic',Tahoma,sans-serif;" +
      "direction:rtl;text-align:center;box-sizing:border-box}" +
      "#" +
      OVERLAY_ID +
      " .kutadgu-maint-card{max-width:28rem;width:100%}" +
      "#" +
      OVERLAY_ID +
      " .kutadgu-maint-brand{font-size:1.35rem;font-weight:700;margin:0 0 12px;" +
      "color:#6b3a1f}" +
      "#" +
      OVERLAY_ID +
      " .kutadgu-maint-msg{margin:0;font-size:1.05rem;line-height:1.85;" +
      "color:#4a3420}" +
      "#kutadgu-maint-admin-note{position:sticky;top:0;z-index:2147482999;" +
      "background:#6b3a1f;color:#fff;text-align:center;padding:8px 12px;" +
      "font-size:14px;line-height:1.6;direction:rtl}";
    (document.head || document.documentElement).appendChild(css);
  }

  function showAdminBypassNotice() {
    if (document.getElementById("kutadgu-maint-admin-note")) return;
    injectOverlayStyles();
    var note = document.createElement("div");
    note.id = "kutadgu-maint-admin-note";
    note.setAttribute("dir", "rtl");
    note.setAttribute("lang", "ug");
    note.textContent = "ئاسراش ھالىتى ئوچۇق. سىز Admin بولغاچقا تور بەتنى نورمال كۆرەلەيسىز. ئادەتتىكى زىيارەتچى بۇ يازمىنى كۆرمەيدۇ.";
    var mount = document.body || document.documentElement;
    mount.appendChild(note);
  }

  function hideAdminBypassNotice() {
    var el = document.getElementById("kutadgu-maint-admin-note");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showMaintenance() {
    injectOverlayStyles();
    try {
      document.documentElement.classList.add(ACTIVE_CLASS);
      if (document.body) document.body.classList.add(ACTIVE_CLASS);
    } catch (e) {}
    hidePending();
    if (document.getElementById(OVERLAY_ID)) return;
    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "main");
    overlay.setAttribute("lang", "ug");
    overlay.setAttribute("dir", "rtl");
    overlay.innerHTML =
      '<div class="kutadgu-maint-card">' +
      '<p class="kutadgu-maint-brand">قۇتادغۇبىلىك كىتابخانىسى</p>' +
      '<p class="kutadgu-maint-msg">تور بېتىمىزدە ۋاقىتلىق ئاسراش ئېلىپ بېرىلىۋاتىدۇ.<br>قىسقا ۋاقىتتىن كېيىن قايتا سىناپ بېقىڭ.</p>' +
      "</div>";
    var mount = document.body || document.documentElement;
    mount.appendChild(overlay);
    try {
      var robots = document.querySelector('meta[name="robots"]');
      if (!robots) {
        robots = document.createElement("meta");
        robots.setAttribute("name", "robots");
        if (document.head) document.head.appendChild(robots);
      }
      robots.setAttribute("content", "noindex, nofollow");
    } catch (e2) {}
  }

  function parseMaintenanceRow(row) {
    if (!row || typeof row !== "object") return false;
    var v = row.value;
    if (v === true || v === "true" || v === "t" || v === 1 || v === "1") return true;
    return false;
  }

  function restHeaders(token) {
    var c = publicConfig();
    var auth = token || c.key;
    return {
      apikey: c.key,
      Authorization: "Bearer " + auth,
      Accept: "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache"
    };
  }

  async function restGet(path, token) {
    var c = publicConfig();
    if (!c.url || !c.key) return { error: true };
    try {
      var res = await fetch(c.url + path, {
        method: "GET",
        headers: restHeaders(token),
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

  async function fetchMaintenanceOn() {
    var path = "/rest/v1/store_settings?select=key,value&key=eq." + encodeURIComponent(SETTING_KEY);
    var res = await restGet(path);
    if (res.error) {
      res = await restGet(path);
      if (res.error) return false;
    }
    var rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    if (!rows.length) return false;
    return parseMaintenanceRow(rows[0]);
  }

  function readStoredAuthSession() {
    var c = publicConfig();
    var ref = "";
    try {
      ref = new URL(c.url).hostname.split(".")[0] || "";
    } catch (e) {}
    var keys = [];
    if (ref) keys.push("sb-" + ref + "-auth-token");
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^sb-.+-auth-token$/.test(k) && keys.indexOf(k) === -1) keys.push(k);
      }
    } catch (e2) {}
    for (var j = 0; j < keys.length; j++) {
      try {
        var raw = localStorage.getItem(keys[j]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        var session = parsed && (parsed.currentSession || parsed);
        var token = session && session.access_token;
        var user = session && session.user;
        if (token && user && user.id) return { access_token: token, user: user };
      } catch (e3) {}
    }
    return null;
  }

  async function sessionFromSdk() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
    try {
      var c = publicConfig();
      if (!c.url || !c.key) return null;
      if (!window.__kutadguMaintSb) {
        window.__kutadguMaintSb = window.supabase.createClient(c.url, c.key);
      }
      var sessionRes = await window.__kutadguMaintSb.auth.getSession();
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      var user = session && session.user;
      if (!session || !session.access_token || !user || !user.id) return null;
      return { access_token: session.access_token, user: user };
    } catch (e) {
      return null;
    }
  }

  async function isAuthorizedAdmin() {
    var session = (await sessionFromSdk()) || readStoredAuthSession();
    if (!session || !session.access_token || !session.user || !session.user.id) return false;
    var uid = String(session.user.id);
    var path =
      "/rest/v1/admin_users?select=user_id&user_id=eq." + encodeURIComponent(uid);
    var res = await restGet(path, session.access_token);
    if (res.error) return false;
    var rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    var row = rows[0];
    if (!row || !row.user_id) return false;
    return String(row.user_id) === uid;
  }

  async function applyGuard() {
    if (isAdminSurface() || isAuthRecoverySurface()) {
      showStorefront();
      return;
    }
    var on = await fetchMaintenanceOn();
    if (!on) {
      showStorefront();
      return;
    }
    var admin = await isAuthorizedAdmin();
    if (admin) {
      showStorefront();
      showAdminBypassNotice();
      return;
    }
    showMaintenance();
  }

  function markPending() {
    try {
      document.documentElement.classList.add(PENDING_CLASS);
    } catch (e) {}
  }

  if (isAdminSurface() || isAuthRecoverySurface()) {
    hidePending();
    return;
  }

  markPending();
  injectOverlayStyles();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyGuard();
    });
  } else {
    applyGuard();
  }

  window.kutadguMaintenance = {
    fetchMaintenanceOn: fetchMaintenanceOn,
    parseMaintenanceRow: parseMaintenanceRow,
    isAuthorizedAdmin: isAuthorizedAdmin,
    applyGuard: applyGuard,
    showMaintenance: showMaintenance,
    showStorefront: showStorefront
  };
})();
