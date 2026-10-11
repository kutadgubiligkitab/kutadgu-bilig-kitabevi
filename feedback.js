/*
  Members-only website feedback.
  The draft stays in memory. It is not written to storage, the address bar, or analytics.
*/
(function (root) {
  "use strict";

  var LIMIT = 2000;
  var EMPTY_MESSAGE = "پىكىرنى يېزىڭ.";
  var LONG_MESSAGE = "پىكىر 2,000 ھەرپتىن ئېشىپ كەتمىسۇن.";
  var SENDING_MESSAGE = "يوللىنىۋاتىدۇ…";
  var SUCCESS_MESSAGE = "پىكىرىڭىز يوللاندى. رەھمەت.";
  var KEPT_DRAFT_MESSAGE = "ئالدىنقى پىكىر يوللاندى. يېڭى مەزمۇن تېخى يوللانمىدى.";
  var ERROR_MESSAGE = "پىكىر يوللانمىدى. قايتا سىناڭ.";
  var DENIED_MESSAGE = "پىكىر يوللاشقا ئىجازەت يوق.";
  var SUSPENDED_MESSAGE = "بۇ ھېسابات توختىتىلغان. پىكىر يوللاشقا بولمايدۇ.";
  var CHECKING_MESSAGE = "ھېساب تەكشۈرۈلۈۋاتىدۇ.";
  var INVITE_MESSAGE = "پىكىر يوللاش ئۈچۈن ھېسابىڭىزغا كىرىڭ ياكى يېڭى ئەزا بولۇڭ.";

  var receipt = null;
  var epoch = 0;
  var userId = "";
  var sending = false;

  function normalizeBody(value) {
    var text = String(value == null ? "" : value).replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, "");
    if (!text) return { ok: false, body: "", reason: "empty" };
    if (text.length > LIMIT) return { ok: false, body: text, reason: "long" };
    return { ok: true, body: text, reason: "" };
  }

  function validationMessage(reason) {
    if (reason === "long") return LONG_MESSAGE;
    return EMPTY_MESSAGE;
  }

  function nextReceipt(current, body) {
    if (current && current.body === body && current.id) return current;
    return { id: newId(), body: body };
  }

  function newId() {
    var cryptoObj = root.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var n = Math.floor(Math.random() * 16);
      var v = ch === "x" ? n : (n & 3) | 8;
      return v.toString(16);
    });
  }

  function sameIdentity(expectedEpoch, expectedUser, actualEpoch, actualUser) {
    return expectedEpoch === actualEpoch && expectedUser && expectedUser === actualUser;
  }

  function memberApi() {
    if (root.__kutadguFeedbackMember) return root.__kutadguFeedbackMember;
    return root.KutadguMember || null;
  }

  function node(id) {
    return root.document ? root.document.getElementById(id) : null;
  }

  function setStatus(text) {
    var el = node("feedbackStatus");
    if (el) el.textContent = text || "";
  }

  function setHidden(el, hidden) {
    if (el) el.hidden = !!hidden;
  }

  function currentBody() {
    var field = node("feedbackBody");
    return field ? String(field.value || "") : "";
  }

  function setBody(value) {
    var field = node("feedbackBody");
    if (field) field.value = value;
    updateCount();
  }

  function groupedCount(length) {
    return String(length).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function updateCount() {
    var count = node("feedbackCount");
    var normalized = normalizeBody(currentBody());
    var length = normalized.body.length;
    if (count) count.textContent = groupedCount(length) + " / 2,000";
  }

  function clearDraft() {
    receipt = null;
    sending = false;
    setBody("");
    var retry = node("feedbackRetry");
    setHidden(retry, true);
    var field = node("feedbackBody");
    if (field) field.removeAttribute("aria-invalid");
  }

  function forgetPrivate() {
    epoch += 1;
    userId = "";
    clearDraft();
    setStatus("");
  }

  function showGuest() {
    setHidden(node("feedbackInvite"), false);
    setHidden(node("feedbackForm"), true);
    setHidden(node("feedbackRetry"), true);
    setStatus(INVITE_MESSAGE);
  }

  function showSuspended() {
    forgetPrivate();
    setHidden(node("feedbackInvite"), true);
    setHidden(node("feedbackForm"), true);
    setHidden(node("feedbackRetry"), true);
    setStatus(SUSPENDED_MESSAGE);
  }

  function beginSignOut() {
    epoch += 1;
    clearDraft();
    setStatus("");
  }

  function showForm() {
    setHidden(node("feedbackInvite"), true);
    setHidden(node("feedbackForm"), false);
    var button = node("feedbackSubmit");
    if (button) button.disabled = sending;
  }

  function applyMember(detail) {
    var api = memberApi();
    var explicit = detail && typeof detail === "object";
    var user = explicit ? detail.user : (api && api.getUser ? api.getUser() : null);
    var blocked = explicit && detail.blocked != null ? detail.blocked : (api && api.isBlocked ? api.isBlocked() : false);
    var profile = explicit ? detail.profile : (api && api.getProfile ? api.getProfile() : null);
    var nextId = user && user.id ? String(user.id) : "";
    if (!nextId) {
      forgetPrivate();
      showGuest();
      return;
    }
    var previousId = userId;
    if (previousId && previousId !== nextId) forgetPrivate();
    var sameMember = previousId === nextId && previousId !== "";
    userId = nextId;
    if (blocked || (profile && profile.status === "suspended")) {
      showSuspended();
      return;
    }
    showForm();
    if (!sameMember && !sending) setStatus("");
  }

  function errorText(error) {
    var code = String(error && (error.code || error.errcode) || "");
    var message = String(error && (error.message || error.details) || "");
    if (code === "23505") return ERROR_MESSAGE;
    if (code === "22023" || /too long/i.test(message)) return LONG_MESSAGE;
    if (code === "42501" || /permission|authentication|member permission/i.test(message)) return deniedOrSuspended();
    return ERROR_MESSAGE;
  }

  function deniedOrSuspended() {
    var api = memberApi();
    var profile = api && api.getProfile ? api.getProfile() : null;
    if ((api && api.isBlocked && api.isBlocked()) || (profile && profile.status === "suspended")) return SUSPENDED_MESSAGE;
    return DENIED_MESSAGE;
  }

  function finishSend(snapshot) {
    if (!sameIdentity(snapshot.epoch, snapshot.userId, epoch, userId)) return;
    sending = false;
    var button = node("feedbackSubmit");
    if (button) button.disabled = false;
  }

  async function submitFeedback(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (sending) return;
    var api = memberApi();
    var user = api && api.getUser ? api.getUser() : null;
    if (!user || !user.id || String(user.id) !== userId) {
      showGuest();
      return;
    }
    if (api && api.isBlocked && api.isBlocked()) {
      showSuspended();
      return;
    }
    var normalized = normalizeBody(currentBody());
    var field = node("feedbackBody");
    if (!normalized.ok) {
      if (field) field.setAttribute("aria-invalid", "true");
      setHidden(node("feedbackRetry"), true);
      setStatus(validationMessage(normalized.reason));
      return;
    }
    if (field) field.removeAttribute("aria-invalid");
    receipt = nextReceipt(receipt, normalized.body);
    var snapshot = { epoch: epoch, userId: userId, id: receipt.id, body: normalized.body };
    var client = api.getClient ? api.getClient() : null;
    if (!client || typeof client.rpc !== "function") {
      setHidden(node("feedbackRetry"), false);
      setStatus(ERROR_MESSAGE);
      return;
    }
    sending = true;
    var button = node("feedbackSubmit");
    if (button) button.disabled = true;
    setHidden(node("feedbackRetry"), true);
    setStatus(SENDING_MESSAGE);
    var result;
    try {
      result = await client.rpc("submit_website_feedback", { p_id: snapshot.id, p_body: snapshot.body });
    } catch (error) {
      finishSend(snapshot);
      if (!sameIdentity(snapshot.epoch, snapshot.userId, epoch, userId)) return;
      if (errorText(error) === SUSPENDED_MESSAGE) {
        showSuspended();
        return;
      }
      setHidden(node("feedbackRetry"), false);
      setStatus(errorText(error));
      return;
    }
    finishSend(snapshot);
    if (!sameIdentity(snapshot.epoch, snapshot.userId, epoch, userId)) return;
    if (!result || result.error) {
      var code = String(result && result.error && result.error.code || "");
      if (code === "23505" && receipt && receipt.id === snapshot.id) receipt = null;
      if (errorText(result && result.error) === SUSPENDED_MESSAGE) {
        showSuspended();
        return;
      }
      setHidden(node("feedbackRetry"), false);
      setStatus(errorText(result && result.error));
      return;
    }
    var now = normalizeBody(currentBody());
    if (now.ok && now.body === snapshot.body) {
      clearDraft();
      setStatus(SUCCESS_MESSAGE);
      return;
    }
    if (receipt && receipt.body === snapshot.body) receipt = null;
    setStatus(KEPT_DRAFT_MESSAGE);
  }

  function boot() {
    var doc = root.document;
    if (!doc) return;
    var form = node("feedbackForm");
    if (form) form.addEventListener("submit", submitFeedback);
    var field = node("feedbackBody");
    if (field) field.addEventListener("input", updateCount);
    var retry = node("feedbackRetry");
    if (retry) retry.addEventListener("click", submitFeedback);
    updateCount();
    setStatus(CHECKING_MESSAGE);
    doc.addEventListener("kutadgu-member-change", function (event) {
      if (root.__kutadguFeedbackMember) {
        applyMember();
        return;
      }
      applyMember(event && event.detail);
    });
    var api = memberApi();
    var ready = api && api.ready;
    if (ready && typeof ready.then === "function") {
      ready.then(function () { applyMember(); }).catch(function () { applyMember(); });
    } else {
      applyMember();
    }
  }

  var api = {
    LIMIT: LIMIT,
    EMPTY_MESSAGE: EMPTY_MESSAGE,
    LONG_MESSAGE: LONG_MESSAGE,
    SUCCESS_MESSAGE: SUCCESS_MESSAGE,
    ERROR_MESSAGE: ERROR_MESSAGE,
    DENIED_MESSAGE: DENIED_MESSAGE,
    SUSPENDED_MESSAGE: SUSPENDED_MESSAGE,
    INVITE_MESSAGE: INVITE_MESSAGE,
    KEPT_DRAFT_MESSAGE: KEPT_DRAFT_MESSAGE,
    normalizeBody: normalizeBody,
    validationMessage: validationMessage,
    nextReceipt: nextReceipt,
    sameIdentity: sameIdentity,
    submitFeedback: submitFeedback,
    forgetPrivate: forgetPrivate,
    beginSignOut: beginSignOut,
    applyMember: applyMember
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguWebsiteFeedback = api;
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
