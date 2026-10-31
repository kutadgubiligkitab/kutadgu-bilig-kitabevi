(function (global) {
  "use strict";

  var POSTER_SRC = "/kutadgu-book-poster.js?v=3";
  var UMD_SRC = "/vendor/supabase-js-2.45.4.umd.js";
  var BRIDGE_SRC = "/admin-supabase-global.js?v=1";
  var started = false;

  function adminStorageKey() {
    if (typeof global.kutadguAdminAuthStorageKey === "function") return global.kutadguAdminAuthStorageKey();
    return String(global.KUTADGU_ADMIN_AUTH_STORAGE_KEY || "kutadgu-admin-auth-v1");
  }

  function isSingleBookDocument() {
    var path = "";
    try { path = String(global.location && global.location.pathname || ""); } catch (error) { return false; }
    if (!/^\/book\/\d+\/?$/.test(path)) return false;
    var body = global.document && global.document.body;
    if (!body || body.getAttribute("data-dynamic-book") == null) return false;
    if (body.getAttribute("data-volume-group-slug")) return false;
    return true;
  }

  function posterAccessDecision(input) {
    var source = input || {};
    var raw = source.storageRaw;
    var hasStorage = raw != null && String(raw).trim() !== "";
    var session = source.session || null;
    var user = session && session.user;
    var aal = String(source.aal || "").trim().toLowerCase();
    var isAdmin = source.isAdmin === true;
    return {
      loadClient: hasStorage,
      loadPoster: !!(hasStorage && user && aal === "aal2" && isAdmin)
    };
  }

  global.kutadguPosterAccessDecision = posterAccessDecision;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var selector = 'script[data-kutadgu-poster-src="' + src + '"]';
      var existing = global.document.querySelector(selector);
      if (existing && existing.getAttribute("data-loaded") === "1") {
        resolve();
        return;
      }
      var script = existing || global.document.createElement("script");
      function finish() {
        script.setAttribute("data-loaded", "1");
        resolve();
      }
      script.onerror = function () { reject(new Error("script-load-failed")); };
      if (existing && existing.getAttribute("src")) {
        if (existing.getAttribute("data-loaded") === "1") finish();
        else existing.addEventListener("load", finish, { once: true });
        return;
      }
      script.src = src;
      script.async = false;
      script.setAttribute("data-kutadgu-poster-src", src);
      script.addEventListener("load", finish, { once: true });
      global.document.head.appendChild(script);
    });
  }

  function clientReady() {
    return !!(global.supabase && typeof global.supabase.createClient === "function");
  }

  async function ensureClientLibrary() {
    if (clientReady()) return;
    await loadScript(UMD_SRC);
    if (!clientReady()) await loadScript(BRIDGE_SRC);
  }

  function readStorage() {
    try { return global.localStorage.getItem(adminStorageKey()); }
    catch (error) { return null; }
  }

  async function readAdminProof(client) {
    var session = null;
    var aal = "";
    var isAdmin = false;
    try {
      var got = await client.auth.getSession();
      session = got && got.data && got.data.session || null;
    } catch (error) { session = null; }
    try {
      var mfa = client.auth && client.auth.mfa;
      if (mfa && typeof mfa.getAuthenticatorAssuranceLevel === "function") {
        var level = await mfa.getAuthenticatorAssuranceLevel();
        aal = level && level.data && level.data.currentLevel || "";
      }
    } catch (error) { aal = ""; }
    try {
      var rpc = await client.rpc("is_kutadgu_admin");
      isAdmin = !!(rpc && rpc.data === true && !rpc.error);
    } catch (error) { isAdmin = false; }
    return { session: session, aal: aal, isAdmin: isAdmin };
  }

  async function boot() {
    if (!isSingleBookDocument()) return;
    var raw = readStorage();
    if (!posterAccessDecision({ storageRaw: raw, session: null, aal: "", isAdmin: false }).loadClient) return;
    var config = global.KUTADGU_SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) return;
    try {
      await ensureClientLibrary();
      if (!clientReady()) return;
      var options = typeof global.kutadguAdminAuthOptions === "function"
        ? global.kutadguAdminAuthOptions()
        : { persistSession: true, detectSessionInUrl: false, flowType: "pkce", storageKey: adminStorageKey() };
      var client = global.supabase.createClient(config.url, config.anonKey, { auth: options });
      var proof = await readAdminProof(client);
      var decision = posterAccessDecision({
        storageRaw: raw,
        session: proof.session,
        aal: proof.aal,
        isAdmin: proof.isAdmin
      });
      if (!decision.loadPoster) return;
      await loadScript(POSTER_SRC);
      if (global.KutadguBookPoster && typeof global.KutadguBookPoster.attach === "function") {
        global.KutadguBookPoster.attach();
      }
    } catch (error) {}
  }

  function start() {
    if (started || !global.document) return;
    started = true;
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", function () { boot(); }, { once: true });
    } else {
      boot();
    }
  }

  start();
})(window);
