/**
 * Stage 2C — Admin-only idle lock.
 * Admin-local idle lock. Timeout never invokes auth sign-out. Does not touch GoTrue auth storage keys. Does not change MFA enrollment.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguAdminIdle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const IDLE_MS = 30 * 60 * 1000;
  const STORAGE_KEY = "kutadgu-admin-idle-v1";
  const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"];
  const AUTH_KEY_RE = /^sb-.+-auth-token(?:-code-verifier)?$/;
  const NAMED_AUTH_KEYS = {
    "kutadgu-member-auth-v1": true,
    "kutadgu-admin-auth-v1": true,
    "kutadgu-member-auth-v1-code-verifier": true,
    "kutadgu-admin-auth-v1-code-verifier": true
  };
  const WRITE_THROTTLE_MS = 1000;

  function now() {
    if (typeof globalThis !== "undefined" && typeof globalThis.__kutadguAdminIdleNow === "function") {
      return Number(globalThis.__kutadguAdminIdleNow()) || 0;
    }
    return Date.now();
  }

  function idleMs() {
    if (typeof globalThis !== "undefined" && globalThis.__kutadguAdminIdleMs != null) {
      const n = Number(globalThis.__kutadguAdminIdleMs);
      if (n > 0) return n;
    }
    return IDLE_MS;
  }

  let restoreDepth = 0;

  function unavailableState() {
    return { lastActivity: 0, locked: false, status: "unavailable" };
  }

  function missingState() {
    return { lastActivity: 0, locked: false, status: "missing" };
  }

  function corruptState(locked) {
    return { lastActivity: 0, locked: !!locked, status: "corrupt" };
  }

  function stateUnusable(snap) {
    return !snap || snap.status === "missing" || snap.status === "corrupt" || snap.status === "unavailable";
  }

  function recordOverdue(snap, at) {
    if (!snap || snap.status !== "ok") return false;
    const last = Number(snap.lastActivity) || 0;
    if (!last) return false;
    return at - last >= idleMs();
  }

  function getStorage() {
    if (typeof globalThis !== "undefined" && globalThis.__kutadguAdminIdleStorage) {
      return globalThis.__kutadguAdminIdleStorage;
    }
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (err) {
      return null;
    }
  }

  function readState() {
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== "function") return unavailableState();
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (err) {
      return unavailableState();
    }
    if (raw == null || raw === "") return missingState();
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return corruptState(false);
      const last = Number(parsed.lastActivity);
      const locked = !!parsed.locked;
      if (!Number.isFinite(last) || last <= 0) return corruptState(locked);
      return { lastActivity: last, locked: locked, status: "ok" };
    } catch (err) {
      return corruptState(false);
    }
  }

  function writeState(state) {
    const storage = getStorage();
    if (!storage || typeof storage.setItem !== "function") return;
    const payload = JSON.stringify({
      lastActivity: Number(state.lastActivity) || 0,
      locked: !!state.locked
    });
    storage.setItem(STORAGE_KEY, payload);
  }

  function clearState() {
    const storage = getStorage();
    if (!storage || typeof storage.removeItem !== "function") return;
    storage.removeItem(STORAGE_KEY);
  }

  function isAuthStorageKey(key) {
    const k = String(key || "");
    if (NAMED_AUTH_KEYS[k]) return true;
    return AUTH_KEY_RE.test(k);
  }

  function isPersistedLock(state) {
    const snap = state || readState();
    return !!snap.locked;
  }

  function shouldLock(state, at, busy, opts) {
    const snap = state || readState();
    const moment = at == null ? now() : at;
    if (snap.locked) return true;
    const restoring = !!(opts && opts.restoringSession);
    if (stateUnusable(snap)) return restoring;
    if (busy) return false;
    return recordOverdue(snap, moment);
  }

  function activityWriteBlocked(snap, at, options) {
    if (options.forceUnlock) return false;
    if (snap.locked) return true;
    if (recordOverdue(snap, at)) return true;
    if (snap.status === "corrupt" || snap.status === "unavailable") return true;
    if (snap.status === "missing" && restoreDepth > 0) return true;
    return false;
  }

  function noteActivity(opts) {
    const options = opts || {};
    if (options.locked) return readState();
    const snap = readState();
    const at = now();
    if (activityWriteBlocked(snap, at, options)) return snap;
    const throttle = (typeof globalThis !== "undefined" && globalThis.__kutadguAdminIdleMs != null) ? 0 : WRITE_THROTTLE_MS;
    if (!options.force && snap.status === "ok" && snap.lastActivity && throttle && at - snap.lastActivity < throttle && !snap.locked) {
      return snap;
    }
    writeState({ lastActivity: at, locked: false });
    return readState();
  }

  function beginAuthenticatedActivity() {
    const snap = readState();
    if (snap.locked) return snap;
    const at = now();
    writeState({ lastActivity: at, locked: false });
    return readState();
  }

  function setRestoreGuard(on) {
    restoreDepth += on ? 1 : -1;
    if (restoreDepth < 0) restoreDepth = 0;
  }

  function restoreGuardOn() {
    return restoreDepth > 0;
  }

  function markLocked() {
    const snap = readState();
    writeState({ lastActivity: snap.lastActivity || now(), locked: true });
    return readState();
  }

  function unlock() {
    return noteActivity({ force: true, forceUnlock: true });
  }

  function activityFromEvent(event) {
    const type = String((event && event.type) || "");
    if (ACTIVITY_EVENTS.indexOf(type) === -1) return false;
    if (event && event.isTrusted === false) return false;
    return true;
  }

  function lockPanelContains(target) {
    if (!target || typeof target.closest !== "function") return false;
    return !!target.closest("#idleLockPanel");
  }

  function attachLock(opts) {
    const options = opts || {};
    const $ = options.$ || function (sel) {
      return document.querySelector(sel);
    };
    const Mfa = options.Mfa || (typeof globalThis !== "undefined" ? globalThis.KutadguAdminMfa : null) || {};
    let busy = false;
    let bound = false;

    function setStatus(text, type) {
      const el = $("#idleLockStatus");
      if (!el) return;
      el.textContent = text;
      el.className = "admin-status" + (type ? " " + type : "");
    }

    async function submit(e) {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (busy) return;
      const otp = $("#idleLockOtp");
      const digitsOnly = Mfa.digitsOnly || function (v) {
        return String(v == null ? "" : v).replace(/\D/g, "").slice(0, 6);
      };
      const code = digitsOnly(otp && otp.value);
      if (code.length !== 6) {
        setStatus("6 خانىلىق كودنى كىرگۈزۈڭ.", "warn");
        return;
      }
      const resolveMfaApi = Mfa.resolveMfaApi;
      const api = typeof resolveMfaApi === "function"
        ? resolveMfaApi(options.getDb)
        : (options.getDb && options.getDb() && options.getDb().auth && options.getDb().auth.mfa) ||
          (typeof globalThis !== "undefined" ? globalThis.__kutadguMfaApi : null);
      if (!api || typeof api.challengeAndVerify !== "function") {
        setStatus("MFA API يوق", "error");
        return;
      }
      busy = true;
      const submitBtn = $("#idleLockSubmit");
      if (submitBtn) submitBtn.disabled = true;
      try {
        if (typeof Mfa.ensurePrimarySessionReady === "function") {
          const ready = await Mfa.ensurePrimarySessionReady(options.getDb);
          if (!ready.ok) {
            const category = ready.reason === "network" ? "network" : "session";
            const msg = typeof Mfa.mfaGateMessage === "function"
              ? Mfa.mfaGateMessage(category)
              : (category === "network"
                ? "تور ياكى مۇلازىمېتېر ۋاقتىنچە ئىشلىمىدى. سەل تۇرۇپ قايتا سىناڭ."
                : "كىرىش ۋاقتى توشتى. قايتا كىرىڭ.");
            setStatus(msg, "error");
            return;
          }
        }
        let classified = { verified: [] };
        if (typeof Mfa.classifyFactors === "function" && typeof api.listFactors === "function") {
          const listed = await api.listFactors();
          if (listed && listed.error) throw listed.error;
          classified = Mfa.classifyFactors(listed && listed.data);
        }
        const choose = Mfa.chooseVerifiedTotp;
        const factor = typeof choose === "function" ? choose(classified.verified) : (classified.verified && classified.verified[0]) || null;
        const factorId = Mfa.factorId || function (f) { return String((f && (f.id || f.factorId)) || ""); };
        if (!factor || !factorId(factor)) {
          setStatus("تەڭشەلگەن Authenticator تېپىلمىدى. چىقىش ياكى قايتا كىرىڭ.", "warn");
          return;
        }
        const res = await api.challengeAndVerify({ factorId: factorId(factor), code: code });
        if (res && res.error) throw res.error;
        if (typeof api.getAuthenticatorAssuranceLevel !== "function") {
          setStatus("دەلىللەش تامام بولمىدى. قايتا سىناڭ.", "error");
          return;
        }
        const aal = await api.getAuthenticatorAssuranceLevel();
        if (aal && aal.error) throw aal.error;
        const normalize = Mfa.normalizeLevel || function (level) {
          return String(level || "").toLowerCase();
        };
        if (normalize(aal && aal.data && aal.data.currentLevel) !== "aal2") {
          setStatus("دەلىللەش تامام بولمىدى. قايتا سىناڭ.", "error");
          return;
        }
        if (otp) otp.value = "";
        unlock();
        if (typeof options.onUnlock === "function") await options.onUnlock();
      } catch (err) {
        if (otp) otp.value = "";
        const classifiedErr = typeof Mfa.classifyMfaFailure === "function"
          ? Mfa.classifyMfaFailure(err)
          : { category: "invalid_otp" };
        if (classifiedErr.category === "invalid_otp") {
          setStatus("كود توغرا ئەمەس. قايتا سىناڭ — سىز چىقىرىلمايسىز.", "error");
        } else if (classifiedErr.category === "session") {
          setStatus(typeof Mfa.mfaGateMessage === "function" ? Mfa.mfaGateMessage("session") : "كىرىش ۋاقتى توشتى. قايتا كىرىڭ.", "error");
        } else if (classifiedErr.category === "network") {
          setStatus(typeof Mfa.mfaGateMessage === "function" ? Mfa.mfaGateMessage("network") : "تور ياكى مۇلازىمېتېر ۋاقتىنچە ئىشلىمىدى. سەل تۇرۇپ قايتا سىناڭ.", "error");
        } else {
          setStatus(typeof Mfa.mfaGateMessage === "function" ? Mfa.mfaGateMessage("aal") : "دەلىللەش تامام بولمىدى. قايتا سىناڭ.", "error");
        }
      } finally {
        busy = false;
        if (submitBtn) submitBtn.disabled = false;
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      const form = $("#idleLockForm");
      if (form) form.addEventListener("submit", submit);
      const logoutBtn = $("#idleLockLogout");
      if (logoutBtn) logoutBtn.onclick = function () {
        if (typeof options.onLogout === "function") options.onLogout();
      };
      const otp = $("#idleLockOtp");
      if (otp) otp.addEventListener("input", function () {
        const digitsOnly = Mfa.digitsOnly || function (v) {
          return String(v == null ? "" : v).replace(/\D/g, "").slice(0, 6);
        };
        otp.value = digitsOnly(otp.value);
      });
    }

    bind();
    return { submit: submit, bind: bind };
  }

  return {
    IDLE_MS: IDLE_MS,
    STORAGE_KEY: STORAGE_KEY,
    ACTIVITY_EVENTS: ACTIVITY_EVENTS,
    AUTH_KEY_RE: AUTH_KEY_RE,
    now: now,
    idleMs: idleMs,
    readState: readState,
    writeState: writeState,
    clearState: clearState,
    isAuthStorageKey: isAuthStorageKey,
    isPersistedLock: isPersistedLock,
    shouldLock: shouldLock,
    noteActivity: noteActivity,
    beginAuthenticatedActivity: beginAuthenticatedActivity,
    setRestoreGuard: setRestoreGuard,
    restoreGuardOn: restoreGuardOn,
    markLocked: markLocked,
    unlock: unlock,
    activityFromEvent: activityFromEvent,
    lockPanelContains: lockPanelContains,
    attachLock: attachLock
  };
});
