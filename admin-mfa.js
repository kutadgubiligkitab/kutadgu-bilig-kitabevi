/**
 * Stage 2C — optional Admin TOTP enrollment plus UI AAL2 gate.
 * Does not persist TOTP secrets or QR URIs. Does not change RLS.
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

  function normalizeLevel(level) {
    return String(level == null ? "" : level).toLowerCase();
  }

  const SESSION_REFRESH_SKEW_SECONDS = 120;
  const MFA_GATE_MESSAGES = {
    invalid_otp: "كود توغرا ئەمەس ياكى ۋاقتى ئۆتۈپ كەتتى. يېڭى كود بىلەن قايتا سىناڭ.",
    session: "كىرىش ۋاقتى توشتى. قايتا كىرىڭ.",
    network: "تور ياكى مۇلازىمېتېر ۋاقتىنچە ئىشلىمىدى. سەل تۇرۇپ قايتا سىناڭ.",
    aal: "دەلىللەش تامام بولمىدى. قايتا سىناڭ."
  };

  let primarySessionReadyInflight = null;

  function skipLiveSessionReady(opts) {
    if (opts && opts.force) return false;
    if (typeof globalThis === "undefined") return false;
    return !!globalThis.__kutadguSkipAdminAuth;
  }

  function authUserId(session) {
    return String((session && session.user && session.user.id) || "");
  }

  function sessionExpiresAt(session) {
    const n = Number(session && session.expires_at);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? n / 1000 : n;
  }

  function sessionNeedsRefresh(session, nowSec, skewSec) {
    if (!session || !session.access_token) return true;
    const exp = sessionExpiresAt(session);
    if (!exp) return false;
    const now = Number.isFinite(nowSec) ? nowSec : Date.now() / 1000;
    const skew = Number.isFinite(skewSec) ? skewSec : SESSION_REFRESH_SKEW_SECONDS;
    return exp <= now + skew;
  }

  function errorText(err) {
    return String((err && (err.message || err.error_description || err.code || err.name)) || "").toLowerCase();
  }

  function isRetryableAuthError(err) {
    const name = String((err && err.name) || "");
    const msg = errorText(err);
    if (name === "AuthRetryableFetchError") return true;
    return /failed to fetch|network|timeout|temporar|econnreset|load failed/.test(msg);
  }

  function isInvalidOtpError(err) {
    const msg = errorText(err);
    const code = String((err && err.code) || "").toLowerCase();
    if (code === "mfa_verification_failed") return true;
    return /invalid (totp )?code|invalid.?otp|expired.?code|expired.?challenge|challenge (has )?expired|mfa_verification_failed/.test(msg);
  }

  function isSessionAuthError(err) {
    if (isInvalidOtpError(err)) return false;
    const name = String((err && err.name) || "");
    const code = String((err && err.code) || "").toLowerCase();
    const msg = errorText(err);
    const status = Number((err && (err.status || err.statusCode)) || 0);
    if (name === "AuthSessionMissingError") return true;
    if (code === "session_not_found" || code === "session_expired") return true;
    if (/auth session missing|invalid jwt|jwt expired|expired.?token|refresh.?token|not authenticated|session expired/.test(msg)) return true;
    return status === 401 || status === 403;
  }

  function classifyMfaFailure(err) {
    if (isInvalidOtpError(err)) return { category: "invalid_otp" };
    if (isRetryableAuthError(err)) return { category: "network" };
    if (isSessionAuthError(err)) return { category: "session" };
    return { category: "unknown" };
  }

  function mfaGateMessage(category) {
    return MFA_GATE_MESSAGES[category] || MFA_GATE_MESSAGES.aal;
  }

  function warnMfaFailure(category, err) {
    const code = String((err && (err.code || err.name)) || category || "unknown");
    console.warn("Admin MFA failed", String(category || "unknown"), code);
  }

  async function ensurePrimarySessionReady(getDb, opts) {
    const options = opts || {};
    if (skipLiveSessionReady(options)) return { ok: true, skipped: true, session: null, user: null };
    if (primarySessionReadyInflight) return primarySessionReadyInflight;
    const expectedUserId = options.expectedUserId ? String(options.expectedUserId) : "";
    primarySessionReadyInflight = (async function () {
      try {
        const db = typeof getDb === "function" ? getDb() : getDb;
        if (!db || !db.auth) return { ok: false, reason: "no_auth" };
        if (typeof db.auth.initialize === "function") {
          try {
            await db.auth.initialize();
          } catch (err) {
            return {
              ok: false,
              reason: isRetryableAuthError(err) ? "network" : "session_error",
              error: err
            };
          }
        }
        const got = await db.auth.getSession();
        if (got && got.error) {
          return {
            ok: false,
            reason: isRetryableAuthError(got.error) ? "network" : "session_error",
            error: got.error
          };
        }
        let session = got && got.data && got.data.session;
        if (!session || !session.user) return { ok: false, reason: "no_session" };
        const originalId = authUserId(session);
        if (expectedUserId && originalId !== expectedUserId) return { ok: false, reason: "user_mismatch" };

        let refreshed = false;
        async function refreshOnce() {
          if (typeof db.auth.refreshSession !== "function") {
            return { ok: false, reason: "refresh_unsupported" };
          }
          const result = await db.auth.refreshSession();
          if (result && result.error) {
            return {
              ok: false,
              reason: isRetryableAuthError(result.error) ? "network" : "refresh_failed",
              error: result.error
            };
          }
          session = result && result.data && result.data.session;
          if (!session || !session.user) return { ok: false, reason: "no_session" };
          if (authUserId(session) !== originalId) return { ok: false, reason: "user_mismatch" };
          if (expectedUserId && authUserId(session) !== expectedUserId) return { ok: false, reason: "user_mismatch" };
          refreshed = true;
          return { ok: true };
        }

        const wantRefresh = !!options.forceRefresh || sessionNeedsRefresh(session);
        if (wantRefresh) {
          const refreshResult = await refreshOnce();
          if (!refreshResult.ok) {
            if (refreshResult.reason === "refresh_unsupported") {
              const exp = sessionExpiresAt(session);
              if (!session.access_token || (exp && exp <= Date.now() / 1000)) {
                return { ok: false, reason: "session_error" };
              }
            } else {
              return refreshResult;
            }
          }
        }

        if (typeof db.auth.getUser === "function") {
          let userRes = await db.auth.getUser();
          if (userRes && userRes.error) {
            if (isRetryableAuthError(userRes.error)) {
              return { ok: false, reason: "network", error: userRes.error };
            }
            if (!refreshed) {
              const retry = await refreshOnce();
              if (!retry.ok) {
                if (retry.reason === "refresh_unsupported") {
                  return { ok: false, reason: "session_error", error: userRes.error };
                }
                return retry;
              }
              userRes = await db.auth.getUser();
              if (userRes && userRes.error) {
                return {
                  ok: false,
                  reason: isRetryableAuthError(userRes.error) ? "network" : "session_error",
                  error: userRes.error
                };
              }
            } else {
              return { ok: false, reason: "session_error", error: userRes.error };
            }
          }
          const uid = userRes && userRes.data && userRes.data.user && String(userRes.data.user.id);
          if (uid && uid !== originalId) return { ok: false, reason: "user_mismatch" };
          if (expectedUserId && uid && uid !== expectedUserId) return { ok: false, reason: "user_mismatch" };
        }
        return { ok: true, session: session, user: session.user, refreshed: refreshed };
      } finally {
        primarySessionReadyInflight = null;
      }
    })();
    return primarySessionReadyInflight;
  }

  function evaluateAccess(assurance, classified) {
    const current = normalizeLevel(assurance && assurance.currentLevel);
    const verified = !!(classified && classified.configured);
    if (current === "aal2") {
      return { surface: "dashboard", gate: false, warnMissingMfa: !verified };
    }
    if (verified) {
      return { surface: "gate", gate: true, warnMissingMfa: false };
    }
    return { surface: "dashboard", gate: false, warnMissingMfa: true };
  }

  function chooseVerifiedTotp(verified) {
    const list = asList(verified).filter(function (f) { return !!factorId(f); });
    list.sort(function (a, b) { return factorId(a).localeCompare(factorId(b)); });
    return list[0] || null;
  }

  async function inspectAccess(getDb) {
    const stub = typeof globalThis !== "undefined" ? globalThis.__kutadguAdminAalTest : null;
    if (stub) {
      const classified = classifyFactors({ all: stub.factors || stub.all || [] });
      const assurance = {
        currentLevel: stub.currentLevel || null,
        nextLevel: stub.nextLevel || null
      };
      return { assurance: assurance, classified: classified, decision: evaluateAccess(assurance, classified) };
    }
    const api = resolveMfaApi(getDb);
    let classified = classifyFactors({ all: [] });
    let assurance = { currentLevel: null, nextLevel: null };
    if (api && typeof api.getAuthenticatorAssuranceLevel === "function") {
      try {
        const res = await api.getAuthenticatorAssuranceLevel();
        if (res && !res.error && res.data) {
          assurance = {
            currentLevel: res.data.currentLevel,
            nextLevel: res.data.nextLevel
          };
        }
      } catch (err) {}
    }
    if (api && typeof api.listFactors === "function") {
      try {
        const res = await api.listFactors();
        if (res && !res.error) classified = classifyFactors(res.data);
      } catch (err) {}
    }
    return { assurance: assurance, classified: classified, decision: evaluateAccess(assurance, classified) };
  }

  function attachGate(opts) {
    const options = opts || {};
    const $ = options.$ || function (sel) {
      return document.querySelector(sel);
    };
    let busy = false;
    let bound = false;

    function setGateStatus(text, type) {
      const el = $("#mfaGateStatus");
      if (!el) return;
      el.textContent = text;
      el.className = "admin-status" + (type ? " " + type : "");
    }

    async function submit(e) {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (busy) return;
      const otp = $("#mfaGateOtp");
      const code = digitsOnly(otp && otp.value);
      if (code.length !== 6) {
        setGateStatus("6 خانىلىق كودنى كىرگۈزۈڭ.", "warn");
        return;
      }
      const api = resolveMfaApi(options.getDb);
      if (!api || typeof api.challengeAndVerify !== "function") {
        setGateStatus("MFA API يوق", "error");
        return;
      }
      busy = true;
      const submitBtn = $("#mfaGateSubmit");
      if (submitBtn) submitBtn.disabled = true;
      try {
        const ready = await ensurePrimarySessionReady(options.getDb);
        if (!ready.ok) {
          const category = ready.reason === "network" ? "network" : "session";
          warnMfaFailure(category, ready.error);
          setGateStatus(mfaGateMessage(category), "error");
          if (category === "session" && typeof options.onSessionInvalid === "function") {
            await options.onSessionInvalid();
          }
          return;
        }
        let classified = classifyFactors({ all: [] });
        if (typeof api.listFactors === "function") {
          const listed = await api.listFactors();
          if (listed && listed.error) throw listed.error;
          classified = classifyFactors(listed && listed.data);
        }
        const factor = chooseVerifiedTotp(classified.verified);
        if (!factor) {
          setGateStatus("تەڭشەلگەن Authenticator تېپىلمىدى. Admin قۇلۇپلانمايدۇ.", "warn");
          if (typeof options.onNoFactor === "function") await options.onNoFactor();
          return;
        }
        const res = await api.challengeAndVerify({ factorId: factorId(factor), code: code });
        if (res && res.error) throw res.error;
        if (otp) otp.value = "";
        if (typeof api.getAuthenticatorAssuranceLevel !== "function") {
          setGateStatus("دەلىللەش تامام بولمىدى. قايتا سىناڭ.", "error");
          return;
        }
        const aal = await api.getAuthenticatorAssuranceLevel();
        if (aal && aal.error) throw aal.error;
        const level = normalizeLevel(aal && aal.data && aal.data.currentLevel);
        if (level !== "aal2") {
          setGateStatus("دەلىللەش تامام بولمىدى. قايتا سىناڭ.", "error");
          return;
        }
        if (typeof globalThis !== "undefined" && globalThis.__kutadguAdminAalTest) {
          globalThis.__kutadguAdminAalTest.currentLevel = "aal2";
        }
        if (typeof options.onAal2 === "function") await options.onAal2();
      } catch (err) {
        if (otp) otp.value = "";
        const classifiedErr = classifyMfaFailure(err);
        warnMfaFailure(classifiedErr.category, err);
        if (classifiedErr.category === "invalid_otp") {
          setGateStatus(mfaGateMessage("invalid_otp"), "error");
        } else if (classifiedErr.category === "session") {
          setGateStatus(mfaGateMessage("session"), "error");
          if (typeof options.onSessionInvalid === "function") await options.onSessionInvalid();
        } else if (classifiedErr.category === "network") {
          setGateStatus(mfaGateMessage("network"), "error");
        } else {
          setGateStatus(mfaGateMessage("aal"), "error");
        }
      } finally {
        busy = false;
        if (submitBtn) submitBtn.disabled = false;
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      const form = $("#mfaGateForm");
      if (form) form.addEventListener("submit", submit);
      const logoutBtn = $("#mfaGateLogout");
      if (logoutBtn) logoutBtn.onclick = function () {
        if (typeof options.onLogout === "function") options.onLogout();
      };
      const otp = $("#mfaGateOtp");
      if (otp) otp.addEventListener("input", function () {
        otp.value = digitsOnly(otp.value);
      });
    }

    bind();
    return { submit: submit, bind: bind };
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
        const category = classifyMfaFailure(err).category;
        warnMfaFailure(category, err);
        setStatus(mfaGateMessage(category === "invalid_otp" ? "invalid_otp" : category === "network" ? "network" : "aal"), "error");
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
    normalizeLevel: normalizeLevel,
    evaluateAccess: evaluateAccess,
    chooseVerifiedTotp: chooseVerifiedTotp,
    inspectAccess: inspectAccess,
    sessionExpiresAt: sessionExpiresAt,
    sessionNeedsRefresh: sessionNeedsRefresh,
    classifyMfaFailure: classifyMfaFailure,
    mfaGateMessage: mfaGateMessage,
    ensurePrimarySessionReady: ensurePrimarySessionReady,
    SESSION_REFRESH_SKEW_SECONDS: SESSION_REFRESH_SKEW_SECONDS,
    MFA_GATE_MESSAGES: MFA_GATE_MESSAGES,
    attach: attach,
    attachGate: attachGate
  };
});
