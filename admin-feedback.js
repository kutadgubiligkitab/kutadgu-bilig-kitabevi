/*
  Admin inbox for private member feedback. Ten rows, newest first.
  A failed read keeps the previous page only for the same AAL2 admin.
*/
(function (root) {
  "use strict";

  var PAGE_SIZE = 10;
  var LOADING_MESSAGE = "پىكىرلەر يۈكلىنىۋاتىدۇ.";
  var EMPTY_MESSAGE = "پىكىر يوق.";
  var ERROR_MESSAGE = "پىكىرلەر يۈكلەنمىدى.";
  var RETAINED_NOTE = " كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.";
  var AAL2_MESSAGE = "بۇ مەشغۇلات ئۈچۈن 2-باسقۇچلۇق دەلىللەش (AAL2) كېرەك. قايتا كىرىپ قايتا سىناڭ.";
  var DENIED_MESSAGE = "بۇ مەشغۇلاتقا ئىجازەت يوق.";

  var epoch = 0;
  var requestGen = 0;
  var pageIndex = 0;
  var committed = null;
  var failed = null;
  var loading = false;

  function dateText(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    var two = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-يىلى " + (d.getMonth() + 1) + "-ئاينىڭ " + d.getDate() + "-كۈنى، " + two(d.getHours()) + ":" + two(d.getMinutes());
  }

  function pageCount(total) {
    var n = Number(total) || 0;
    if (n <= 0) return 1;
    return Math.floor((n - 1) / PAGE_SIZE) + 1;
  }

  function clampPage(total, page) {
    var n = Number(total) || 0;
    var index = Number(page);
    if (!Number.isInteger(index) || index < 0) index = 0;
    if (n <= 0) return 0;
    var last = Math.floor((n - 1) / PAGE_SIZE);
    return index > last ? last : index;
  }

  function jwtClaim(token, key) {
    try {
      var part = String(token || "").split(".")[1] || "";
      if (!part) return "";
      var base = part.replace(/-/g, "+").replace(/_/g, "/");
      var padded = base + "=".repeat((4 - (base.length % 4)) % 4);
      var json = JSON.parse(atob(padded));
      return String(json && json[key] || "");
    } catch (error) {
      return "";
    }
  }

  function client() {
    if (root.__kutadguAdminFeedbackClient) return root.__kutadguAdminFeedbackClient;
    return root.__kutadguAdminDb || null;
  }

  function panel() {
    return root.document ? root.document.querySelector("#websiteFeedbackCard") : null;
  }

  function statusNode() {
    return root.document ? root.document.querySelector("#websiteFeedbackStatus") : null;
  }

  function listNode() {
    return root.document ? root.document.querySelector("#websiteFeedbackList") : null;
  }

  function setStatus(text) {
    var el = statusNode();
    if (el) el.textContent = text || "";
  }

  function sameAdmin(before, after) {
    return !!(before && after && before.id && before.id === after.id && before.aal === "aal2" && after.aal === "aal2");
  }

  async function sessionContext() {
    var db = client();
    if (!db || !db.auth || typeof db.auth.getSession !== "function") return null;
    var result;
    try {
      result = await db.auth.getSession();
    } catch (error) {
      return null;
    }
    if (!result || result.error || !result.data || !result.data.session) return null;
    var session = result.data.session;
    var id = session.user && session.user.id ? String(session.user.id) : "";
    return { id: id, aal: jwtClaim(session.access_token, "aal") };
  }

  function clear() {
    epoch += 1;
    requestGen += 1;
    pageIndex = 0;
    committed = null;
    failed = null;
    loading = false;
    var list = listNode();
    if (list) list.replaceChildren();
    var pager = root.document && root.document.querySelector("#websiteFeedbackPager");
    if (pager) {
      pager.hidden = true;
      pager.replaceChildren();
    }
    var retry = root.document && root.document.querySelector("#websiteFeedbackRetry");
    if (retry) retry.hidden = true;
    setStatus("");
  }

  function paint(view, problem) {
    var list = listNode();
    if (!list || !root.document) return;
    list.replaceChildren();
    var rows = view && Array.isArray(view.rows) ? view.rows : [];
    rows.forEach(function (row) {
      var item = root.document.createElement("article");
      item.className = "admin-review-item";
      var meta = root.document.createElement("p");
      meta.className = "admin-help";
      var who = root.document.createElement("span");
      who.textContent = row && row.member_label ? String(row.member_label) : "ئەزا";
      var when = root.document.createElement("time");
      when.dateTime = row && row.created_at ? String(row.created_at) : "";
      when.textContent = " · " + dateText(row && row.created_at);
      meta.append(who, when);
      var body = root.document.createElement("p");
      body.className = "admin-review-body";
      body.textContent = row && row.body != null ? String(row.body) : "";
      item.append(meta, body);
      list.appendChild(item);
    });
    var status = statusNode();
    var empty = !problem && (!view || !view.total);
    if (status) {
      if (problem) status.textContent = problem;
      else if (empty) status.textContent = EMPTY_MESSAGE;
      else status.textContent = "";
    }
    paintPager(view, problem);
    var retry = root.document.querySelector("#websiteFeedbackRetry");
    if (retry) retry.hidden = !problem;
  }

  function paintPager(view, problem) {
    var doc = root.document;
    var pager = doc && doc.querySelector("#websiteFeedbackPager");
    if (!pager) return;
    pager.replaceChildren();
    var total = view && view.total ? Number(view.total) : 0;
    var page = view && Number.isInteger(view.page) ? view.page : 0;
    var pages = pageCount(total);
    if (!total) {
      pager.hidden = true;
      return;
    }
    pager.hidden = false;
    var totalText = doc.createElement("p");
    totalText.className = "admin-help";
    totalText.textContent = "جەمئىي " + String(total) + " پىكىر · بەت " + String(page + 1) + " / " + String(pages);
    var prev = doc.createElement("button");
    prev.type = "button";
    prev.className = "admin-secondary";
    prev.textContent = "ئالدىنقى بەت";
    prev.disabled = !!problem || page <= 0;
    prev.addEventListener("click", function () { load(page - 1); });
    var next = doc.createElement("button");
    next.type = "button";
    next.className = "admin-secondary";
    next.textContent = "كېيىنكى بەت";
    next.disabled = !!problem || page >= pages - 1;
    next.addEventListener("click", function () { load(page + 1); });
    pager.append(totalText, prev, next);
  }

  function retain(before, message) {
    if (committed && committed.adminId === before.id && committed.aal === "aal2") {
      failed = { page: pageIndex, adminId: before.id, aal: "aal2" };
      paint(committed, message + RETAINED_NOTE);
      return;
    }
    failed = { page: pageIndex, adminId: before.id, aal: before.aal };
    paint({ total: 0, page: 0, rows: [] }, message);
  }

  async function load(page) {
    var started = epoch;
    var gen = ++requestGen;
    var requested = Number.isInteger(page) && page >= 0 ? page : 0;
    var before = await sessionContext();
    if (started !== epoch || gen !== requestGen) return;
    pageIndex = requested;
    if (!before || !before.id || before.aal !== "aal2") {
      if (started === epoch) clear();
      setStatus(before && before.id ? AAL2_MESSAGE : DENIED_MESSAGE);
      return;
    }
    loading = true;
    var retryButton = root.document && root.document.querySelector("#websiteFeedbackRetry");
    if (retryButton) retryButton.hidden = true;
    setStatus(LOADING_MESSAGE);
    var db = client();
    var result;
    try {
      result = await db.rpc("admin_website_feedback_page", { p_page: pageIndex });
    } catch (error) {
      result = { data: null, error: error };
    }
    if (gen !== requestGen || started !== epoch) return;
    var after = await sessionContext();
    if (gen !== requestGen || started !== epoch) return;
    loading = false;
    if (!sameAdmin(before, after)) {
      clear();
      if (after && after.id && after.aal !== "aal2") setStatus(AAL2_MESSAGE);
      else setStatus(DENIED_MESSAGE);
      return;
    }
    if (!result || result.error || !result.data || typeof result.data !== "object") {
      var code = String(result && result.error && result.error.code || "");
      if (code === "42501") {
        clear();
        setStatus(DENIED_MESSAGE);
        return;
      }
      retain(before, ERROR_MESSAGE);
      return;
    }
    var payload = result.data;
    var view = {
      total: Number(payload.total) || 0,
      page: clampPage(payload.total, payload.page),
      rows: Array.isArray(payload.rows) ? payload.rows : []
    };
    pageIndex = view.page;
    committed = { total: view.total, page: view.page, rows: view.rows, adminId: after.id, aal: "aal2" };
    failed = null;
    paint(view, "");
  }

  function retry() {
    var target = failed ? failed.page : pageIndex;
    load(target);
  }

  function boot() {
    var doc = root.document;
    if (!doc) return;
    var card = panel();
    var retryButton = doc.querySelector("#websiteFeedbackRetry");
    if (retryButton) retryButton.addEventListener("click", retry);
    if (card && !card.hidden) load(0);
  }

  var api = {
    PAGE_SIZE: PAGE_SIZE,
    EMPTY_MESSAGE: EMPTY_MESSAGE,
    ERROR_MESSAGE: ERROR_MESSAGE,
    LOADING_MESSAGE: LOADING_MESSAGE,
    dateText: dateText,
    pageCount: pageCount,
    clampPage: clampPage,
    clear: clear,
    load: load,
    retry: retry
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguAdminFeedback = api;
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
