/**
 * Stage 2C Phase 1 — optional Admin TOTP enrollment/management.
 * Does not enforce AAL2. Does not persist TOTP secrets or QR URIs.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguAdminMfa = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FRIENDLY_NAME = "Admin Authenticator";
  const ISSUER = "Kutadgubilik";

  function asList(value) {
    return Array.isArray(value) ? value : [];
  }

  function factorType(factor) {
    return String((factor && (factor.factor_type || factor.factorType)) || "").toLowerCase();
  }

  function factorStatus(factor) {
    return String((factor && factor.status) || "").toLowerCase();
  }

  function factorId(factor) {
    return String((factor && (factor.id || factor.factorId)) || "");
  }

  function classifyFactors(listData) {
    const all = asList(listData && (listData.all || listData.factors));
    const totp = all.filter(function (f) { return factorType(f) === "totp"; });
    const verified = totp.filter(function (f) { return factorStatus(f) === "verified"; });
    const unverified = totp.filter(function (f) { return factorStatus(f) !== "verified"; });
    return {
      all: totp,
      verified: verified,
      unverified: unverified,
      configured: verified.length > 0
    };
  }

  function digitsOnly(value) {
    return String(value == null ? "" : value).replace(/\D/g, "").slice(0, 6);
  }

  function qrImageSrc(totp) {
    const raw = totp && (totp.qr_code || totp.qrCode);
    if (raw == null || raw === "") return "";
    const s = String(raw);
    if (/^data:image\/svg\+xml/i.test(s)) return s;
    if (/^\s*<svg[\s>]/i.test(s)) return "data:image/svg+xml;utf-8," + encodeURIComponent(s);
    return "";
  }

  function enrollOptions() {
    return { factorType: "totp", friendlyName: FRIENDLY_NAME, issuer: ISSUER };
  }

  function resolveMfaApi(getDb) {
    if (typeof globalThis !== "undefined" && globalThis.__kutadguMfaApi) {
      return globalThis.__kutadguMfaApi;
    }
    const db = typeof getDb === "function" ? getDb() : null;
    return db && db.auth && db.auth.mfa ? db.auth.mfa : null;
  }

  function statusKind(configured, hasUnverified) {
    if (configured) return "configured";
    if (hasUnverified) return "unverified";
    return "not_configured";
  }

  function attach(opts) {
    const options = opts || {};
    const $ = options.$ || function (sel) {
      return document.querySelector(sel);
    };
    let draft = null;
    let removeArmed = false;
    let busy = false;

    function setBusy(on) {
      busy = !!on;
      ["#mfaSetupBtn", "#mfaCleanupBtn", "#mfaRemoveBtn", "#mfaVerifyBtn", "#mfaEnrollCancelBtn", "#mfaRemoveConfirmBtn"].forEach(function (sel) {
        const el = $(sel);
        if (el) el.disabled = on && sel !== "#mfaEnrollCancelBtn";
      });
    }

    function clearDraftUi() {
      draft = null;
      const img = $("#mfaQr");
      if (img) {
        img.removeAttribute("src");
        img.hidden = true;
      }
      const secretEl = $("#mfaSecret");
      if (secretEl) secretEl.textContent = "";
      const otp = $("#mfaOtp");
      if (otp) otp.value = "";
      const panel = $("#mfaEnrollPanel");
      if (panel) panel.hidden = true;
    }

    function setStatus(text, type) {
      const el = $("#mfaStatus");
      if (!el) return;
      el.textContent = text;
      el.className = "admin-status" + (type ? " " + type : "");
    }

    function renderState(classified) {
      const configured = !!(classified && classified.configured);
      const unverified = asList(classified && classified.unverified);
      const setup = $("#mfaSetupBtn");
      const cleanup = $("#mfaCleanupBtn");
      const remove = $("#mfaRemoveBtn");
      const confirmWrap = $("#mfaRemoveConfirm");
      if (setup) setup.hidden = configured;
      if (cleanup) cleanup.hidden = unverified.length === 0;
      if (remove) remove.hidden = !configured;
      if (confirmWrap) confirmWrap.hidden = true;
      removeArmed = false;
      if (configured) {
        setStatus("تەڭشەلگەن — Authenticator ئۇلانغان. ھازىرچە كىرىشتە MFA مەجبۇرىي ئەمەس.", "ok");
      } else if (unverified.length) {
        setStatus("تەڭشەلمىگەن — تاماملىنىپ بولمىغان تەڭشەك قالدى. تازىلاپ قايتا باشلىسىڭىز بولىدۇ.", "warn");
      } else {
        setStatus("تەڭشەلمىگەن — Authenticator تېخى ئۇلانمىغان. Admin نورمال ئىشلەيدۇ.", "");
      }
      return statusKind(configured, unverified.length > 0);
    }

    async function listClassified() {
      const api = resolveMfaApi(options.getDb);
      if (!api || typeof api.listFactors !== "function") {
        return classifyFactors({ all: [] });
      }
      const res = await api.listFactors();
      if (res && res.error) throw res.error;
      return classifyFactors(res && res.data);
    }

    async function refresh() {
      if (!options.isAdminSession || !options.isAdminSession()) return;
      try {
        const classified = await listClassified();
        renderState(classified);
        return classified;
      } catch (err) {
        setStatus("MFA ھالىتى ئوقۇلمىدى. Admin كىرىش ئۆزگەرمىدى.", "warn");
        return null;
      }
    }

    async function unenrollIds(ids) {
      const api = resolveMfaApi(options.getDb);
      if (!api || typeof api.unenroll !== "function") throw new Error("MFA API يوق");
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!id) continue;
        const res = await api.unenroll({ factorId: id });
        if (res && res.error) throw res.error;
      }
    }

    async function cleanupUnverified() {
      const classified = await listClassified();
      const ids = classified.unverified.map(factorId).filter(Boolean);
      if (!ids.length) return classified;
      await unenrollIds(ids);
      return listClassified();
    }

    async function startSetup() {
      if (busy) return;
      setBusy(true);
      try {
        const before = await listClassified();
        if (before.configured) {
          renderState(before);
          return;
        }
        if (before.unverified.length) {
          await unenrollIds(before.unverified.map(factorId).filter(Boolean));
        }
        const api = resolveMfaApi(options.getDb);
        if (!api || typeof api.enroll !== "function") throw new Error("MFA API يوق");
        const res = await api.enroll(enrollOptions());
        if (res && res.error) throw res.error;
        const data = (res && res.data) || {};
        const totp = data.totp || {};
        const id = factorId(data);
        const src = qrImageSrc(totp);
        draft = { factorId: id, hasQr: !!src };
        const img = $("#mfaQr");
        if (img) {
          if (src) {
            img.src = src;
            img.hidden = false;
          } else {
            img.removeAttribute("src");
            img.hidden = true;
          }
        }
        const secretEl = $("#mfaSecret");
        if (secretEl) secretEl.textContent = String(totp.secret || totp.secret_code || "");
        const otp = $("#mfaOtp");
        if (otp) otp.value = "";
        const panel = $("#mfaEnrollPanel");
        if (panel) panel.hidden = false;
        setStatus("Authenticator ئەپىدە QR نى سىكاننېرلاڭ ياكى كودنى كىرگۈزۈپ، 6 خانىلىق نومۇرنى يېزىڭ.", "ok");
      } catch (err) {
        clearDraftUi();
        setStatus("تەڭشەش باشلانمىدى: " + (err && err.message ? err.message : err), "error");
      } finally {
        setBusy(false);
      }
    }

    async function cancelEnroll() {
      const pendingId = draft && draft.factorId;
      clearDraftUi();
      if (pendingId) {
        try {
          await unenrollIds([pendingId]);
        } catch (err) {}
      }
      await refresh();
    }

    async function verifyOtp() {
      if (busy) return;
      const api = resolveMfaApi(options.getDb);
      const code = digitsOnly($("#mfaOtp") && $("#mfaOtp").value);
      if (!draft || !draft.factorId) {
        setStatus("ئاۋۋال Authenticator تەڭشەشنى بېسىڭ.", "warn");
        return;
      }
      if (code.length !== 6) {
        setStatus("6 خانىلىق كودنى كىرگۈزۈڭ.", "warn");
        return;
      }
      if (!api || typeof api.challengeAndVerify !== "function") {
        setStatus("MFA API يوق", "error");
        return;
      }
      setBusy(true);
      try {
        const res = await api.challengeAndVerify({ factorId: draft.factorId, code: code });
        if (res && res.error) throw res.error;
        clearDraftUi();
        const classified = await listClassified();
        renderState(classified);
      } catch (err) {
        setStatus("كود توغرا ئەمەس. قايتا سىناڭ — سىز چىقىرىلمايسىز.", "error");
        const otp = $("#mfaOtp");
        if (otp) otp.value = "";
      } finally {
        setBusy(false);
      }
    }

    async function confirmRemove() {
      if (busy) return;
      setBusy(true);
      try {
        const classified = await listClassified();
        const ids = classified.verified.map(factorId).filter(Boolean);
        if (!ids.length) {
          renderState(classified);
          return;
        }
        await unenrollIds(ids);
        clearDraftUi();
        renderState(await listClassified());
      } catch (err) {
        setStatus("ئۆچۈرۈش مەغلۇپ بولدى: " + (err && err.message ? err.message : err), "error");
      } finally {
        setBusy(false);
        removeArmed = false;
        const confirmWrap = $("#mfaRemoveConfirm");
        if (confirmWrap) confirmWrap.hidden = true;
      }
    }

    function bind() {
      const setup = $("#mfaSetupBtn");
      const cleanup = $("#mfaCleanupBtn");
      const verify = $("#mfaVerifyBtn");
      const cancel = $("#mfaEnrollCancelBtn");
      const remove = $("#mfaRemoveBtn");
      const confirm = $("#mfaRemoveConfirmBtn");
      const cancelRemove = $("#mfaRemoveCancelBtn");
      const otp = $("#mfaOtp");
      if (setup) setup.onclick = function () { startSetup(); };
      if (cleanup) cleanup.onclick = async function () {
        if (busy) return;
        setBusy(true);
        try {
          renderState(await cleanupUnverified());
        } catch (err) {
          setStatus("تازىلاش مەغلۇپ بولدى: " + (err && err.message ? err.message : err), "error");
        } finally {
          setBusy(false);
        }
      };
      if (verify) verify.onclick = function () { verifyOtp(); };
      if (cancel) cancel.onclick = function () { cancelEnroll(); };
      if (remove) remove.onclick = function () {
        removeArmed = true;
        const wrap = $("#mfaRemoveConfirm");
        if (wrap) wrap.hidden = false;
      };
      if (confirm) confirm.onclick = function () {
        if (!removeArmed) return;
        confirmRemove();
      };
      if (cancelRemove) cancelRemove.onclick = function () {
        removeArmed = false;
        const wrap = $("#mfaRemoveConfirm");
        if (wrap) wrap.hidden = true;
      };
      if (otp) otp.addEventListener("input", function () {
        otp.value = digitsOnly(otp.value);
      });
    }

    bind();
    return {
      refresh: refresh,
      startSetup: startSetup,
      verifyOtp: verifyOtp,
      cancelEnroll: cancelEnroll,
      confirmRemove: confirmRemove,
      clearDraftUi: clearDraftUi,
      getDraft: function () { return draft ? { factorId: draft.factorId, hasQr: !!draft.hasQr } : null; }
    };
  }

  return {
    FRIENDLY_NAME: FRIENDLY_NAME,
    classifyFactors: classifyFactors,
    digitsOnly: digitsOnly,
    qrImageSrc: qrImageSrc,
    enrollOptions: enrollOptions,
    statusKind: statusKind,
    resolveMfaApi: resolveMfaApi,
    attach: attach
  };
});
