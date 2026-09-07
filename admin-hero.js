(function (root) {
  "use strict";

  var HERO_SETTINGS_ID = 1;
  var HERO_INTERVALS = [5, 7, 10, 15];
  var HERO_BUCKET_FALLBACK = "book-covers";
  var HERO_OBJECT_PREFIX = "hero/store-slides/";
  var HERO_MAX_BYTES = 5 * 1024 * 1024;
  var HERO_MAX_TRUST = 80;
  var HERO_MAX_BODY = 500;
  var DEFAULT_TRUST_LINE = "2013-يىلدىن بۇيان";
  var DEFAULT_BODY = "قۇتادغۇبىلىك كىتابخانىسى — قەدىمكى تۈرك ئەدەبىياتىدىن زامانىۋى ئىلىم-پەنگىچە بولغان تۈرلۈك كىتابلارنى بىر يەرگە جەم قىلىپ، خەلقىمىزنىڭ بىلىم ۋە مەنىۋى ئېھتىياجىغا خىزمەت قىلىدىغان كىتابخانا.";
  var MIME_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  var HERO_SLOTS = [
    { slot: 1, repoKey: "main", sortOrder: 0, defaultSrc: "/assets/store/shop-interior-main.webp" },
    { slot: 2, repoKey: "library", sortOrder: 1, defaultSrc: "/assets/store/shop-interior-library.webp" },
    { slot: 3, repoKey: "exterior", sortOrder: 2, defaultSrc: "/assets/store/shop-exterior.webp" }
  ];
  var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  var MANAGED_NAME_RE = /^slot-([123])-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.(jpg|png|webp)$/;
  var HERO_NOT_APPLIED_MESSAGE = "يېزىش قوللىنىلمىدى. قۇر قايتۇرۇلمىدى — 2-باسقۇچلۇق دەلىللەش (AAL2)، كىرىش ياكى ئىجازەتنى تەكشۈرۈڭ.";

  function trimText(value) {
    if (value == null) return "";
    return String(value).trim();
  }

  function isSafeImageUrl(raw) {
    var t = trimText(raw);
    if (!t) return false;
    if (/^(javascript|data|vbscript|file|blob)\s*:/i.test(t)) return false;
    if (/^http:\/\//i.test(t)) return false;
    if (t.indexOf("//") === 0) return false;
    if (/^https:\/\/[^/ \t\n\r].+/i.test(t)) return true;
    if (t.charAt(0) === "/" && t.charAt(1) !== "/") return true;
    return false;
  }

  function isAllowedPreviewSrc(raw) {
    var t = trimText(raw);
    if (!t) return false;
    if (/^blob:/i.test(t)) return true;
    return isSafeImageUrl(t);
  }

  function clampHeroInterval(value) {
    var n = Math.round(Number(value));
    if (HERO_INTERVALS.indexOf(n) !== -1) return n;
    return 7;
  }

  function extensionFromMime(mime) {
    return MIME_EXT[String(mime || "").toLowerCase()] || "";
  }

  function validateHeroUploadFile(file) {
    if (!file) return { ok: false, reason: "missing" };
    var type = String(file.type || "").toLowerCase();
    if (!MIME_EXT[type]) return { ok: false, reason: "mime" };
    if (/svg/i.test(type) || /svg/i.test(String(file.name || ""))) {
      return { ok: false, reason: "svg" };
    }
    var size = Number(file.size);
    if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: "size" };
    if (size > HERO_MAX_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, mime: type, ext: MIME_EXT[type] };
  }

  function generateHeroStoreSlideObjectPath(slot, mime, uuidFn) {
    var n = Number(slot);
    if (n !== 1 && n !== 2 && n !== 3) return "";
    var ext = extensionFromMime(mime);
    if (!ext) return "";
    var makeId = uuidFn || (typeof crypto !== "undefined" && crypto.randomUUID ? function () { return crypto.randomUUID(); } : null);
    if (!makeId) return "";
    var id = String(makeId());
    if (!UUID_RE.test(id)) return "";
    return HERO_OBJECT_PREFIX + "slot-" + n + "-" + id + "." + ext;
  }

  function managedSlotFromObjectPath(raw) {
    var t = trimText(raw);
    if (!t) return 0;
    if (t.charAt(0) === "/" || t.charAt(0) === "\\") return 0;
    if (t.indexOf("..") !== -1) return 0;
    if (t.indexOf("\\") !== -1) return 0;
    if (t.indexOf(HERO_OBJECT_PREFIX) !== 0) return 0;
    var rest = t.slice(HERO_OBJECT_PREFIX.length);
    if (!rest || rest.indexOf("/") !== -1) return 0;
    var m = rest.match(MANAGED_NAME_RE);
    return m ? Number(m[1]) : 0;
  }

  function isSafeHeroStoreSlideObjectPath(raw) {
    return managedSlotFromObjectPath(raw) > 0;
  }

  function settingsTextForStore(value, fallback, maxLen) {
    var t = trimText(value);
    if (!t) return null;
    if (t === fallback) return null;
    if (maxLen && t.length > maxLen) t = t.slice(0, maxLen);
    if (!t || t === fallback) return null;
    return t;
  }

  function effectiveSettingsText(raw, fallback) {
    if (raw == null) return fallback;
    var t = String(raw).trim();
    if (!t) return fallback;
    return String(raw);
  }

  function validateSettingsFields(fields) {
    var errors = {};
    var trust = trimText(fields && fields.trust_line);
    var body = trimText(fields && fields.body);
    if (trust.length > HERO_MAX_TRUST) errors.trust_line = true;
    if (body.length > HERO_MAX_BODY) errors.body = true;
    var n = Math.round(Number(fields && fields.rotation_interval_seconds));
    if (HERO_INTERVALS.indexOf(n) === -1) errors.rotation_interval_seconds = true;
    return {
      ok: !errors.trust_line && !errors.body && !errors.rotation_interval_seconds,
      errors: errors,
      payload: {
        trust_line: settingsTextForStore(fields && fields.trust_line, DEFAULT_TRUST_LINE, HERO_MAX_TRUST),
        body: settingsTextForStore(fields && fields.body, DEFAULT_BODY, HERO_MAX_BODY),
        rotation_interval_seconds: HERO_INTERVALS.indexOf(n) === -1 ? 7 : n
      }
    };
  }

  function isAal2Error(error) {
    var msg = String((error && (error.message || error.details || error.hint || error.code)) || "").toLowerCase();
    return String((error && error.code) || "") === "42501" || msg.indexOf("aal2") !== -1 || msg.indexOf("row-level security") !== -1 || msg.indexOf("permission denied") !== -1 || msg.indexOf("42501") !== -1;
  }

  function formatHeroError(error) {
    if (isAal2Error(error)) {
      return "بۇ مەشغۇلات ئۈچۈن 2-باسقۇچلۇق دەلىللەش (AAL2) كېرەك. قايتا كىرىپ قايتا سىناڭ.";
    }
    return "Hero يېزىلمىدى: " + String((error && (error.message || error)) || "نامەلۇم خاتالىق");
  }

  function heroMutationRow(res) {
    if (!res || res.error) return null;
    var row = res.data;
    if (Array.isArray(row)) row = row[0];
    if (!row || row.id == null || row.id === "") return null;
    return row;
  }

  function heroMutationApplied(res, expectedId) {
    var row = heroMutationRow(res);
    if (!row) return false;
    if (expectedId == null || expectedId === "") return false;
    return String(row.id).trim() === String(expectedId).trim();
  }

  function applySafeImgSrc(img, raw) {
    if (!img) return false;
    var src = trimText(raw);
    if (src && isAllowedPreviewSrc(src)) {
      img.setAttribute("src", src);
      img.hidden = false;
      return true;
    }
    img.removeAttribute("src");
    img.hidden = true;
    return false;
  }

  function slotMeta(slotNumber) {
    var n = Number(slotNumber);
    for (var i = 0; i < HERO_SLOTS.length; i++) {
      if (HERO_SLOTS[i].slot === n) return HERO_SLOTS[i];
    }
    return null;
  }

  function emptySlotState(meta) {
    return {
      slot: meta.slot,
      repoKey: meta.repoKey,
      sortOrder: meta.sortOrder,
      defaultSrc: meta.defaultSrc,
      repoRow: null,
      managedRow: null,
      pendingFile: null,
      pendingRestore: false,
      previewObjectUrl: ""
    };
  }

  function pickManagedForSlot(rows, slotNumber) {
    var matches = (rows || []).filter(function (row) {
      return row && row.origin === "upload" && managedSlotFromObjectPath(row.object_path) === slotNumber;
    });
    var enabled = matches.filter(function (row) {
      return row.enabled !== false && row.enabled !== "false" && row.enabled !== 0;
    });
    var pool = enabled.length ? enabled : matches;
    pool.sort(function (a, b) {
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    return pool[0] || null;
  }

  function resolveSlotStates(rows) {
    var list = Array.isArray(rows) ? rows : [];
    return HERO_SLOTS.map(function (meta) {
      var slot = emptySlotState(meta);
      slot.repoRow = list.filter(function (row) {
        return row && row.origin === "repo" && row.repo_key === meta.repoKey;
      })[0] || null;
      slot.managedRow = pickManagedForSlot(list, meta.slot);
      return slot;
    });
  }

  function managedIsEnabled(row) {
    if (!row) return false;
    return row.enabled !== false && row.enabled !== "false" && row.enabled !== 0;
  }

  function effectiveSlotSrc(slot) {
    if (!slot) return "";
    if (slot.previewObjectUrl) return slot.previewObjectUrl;
    if (slot.pendingRestore) return slot.defaultSrc;
    if (managedIsEnabled(slot.managedRow) && isSafeImageUrl(slot.managedRow.image_url)) {
      return trimText(slot.managedRow.image_url);
    }
    return slot.defaultSrc;
  }

  function slotHasPendingChange(slot) {
    return !!(slot && (slot.pendingFile || slot.pendingRestore));
  }

  function settingsFormFromRow(row) {
    row = row || {};
    return {
      trust_line: effectiveSettingsText(row.trust_line, DEFAULT_TRUST_LINE),
      body: effectiveSettingsText(row.body, DEFAULT_BODY),
      rotation_interval_seconds: clampHeroInterval(row.rotation_interval_seconds)
    };
  }

  function createHeroAdminController(opts) {
    opts = opts || {};
    var getDb = opts.getDb || function () { return opts.db || null; };
    var getUser = opts.getUser || function () { return opts.user || null; };
    var getCfg = opts.getCfg || function () { return opts.cfg || {}; };
    var urlApi = opts.URL || (typeof URL !== "undefined" ? URL : null);
    var nowFn = opts.now || function () { return Date.now(); };
    var uuidFn = opts.uuid || null;

    var state = {
      settings: null,
      slides: [],
      slots: HERO_SLOTS.map(emptySlotState),
      writes: { settings: 0, insert: 0, update: 0, remove: 0, upload: 0, deleteRow: 0 }
    };

    function bucketName() {
      var cfg = getCfg() || {};
      return cfg.bucket || HERO_BUCKET_FALLBACK;
    }

    function stamp() {
      var user = getUser();
      return {
        updated_at: new Date(nowFn()).toISOString(),
        updated_by: user && user.id ? user.id : null
      };
    }

    function revokeSlotPreview(slot) {
      if (slot.previewObjectUrl && urlApi && typeof urlApi.revokeObjectURL === "function") {
        try { urlApi.revokeObjectURL(slot.previewObjectUrl); } catch (err) {}
      }
      slot.previewObjectUrl = "";
    }

    function setPendingFile(slotNumber, file) {
      var slot = state.slots.filter(function (s) { return s.slot === Number(slotNumber); })[0];
      if (!slot) return { ok: false, reason: "slot" };
      revokeSlotPreview(slot);
      slot.pendingFile = file || null;
      slot.pendingRestore = false;
      if (file && urlApi && typeof urlApi.createObjectURL === "function") {
        slot.previewObjectUrl = urlApi.createObjectURL(file);
      }
      return { ok: true, slot: slot };
    }

    function stageRestore(slotNumber) {
      var slot = state.slots.filter(function (s) { return s.slot === Number(slotNumber); })[0];
      if (!slot) return { ok: false, reason: "slot" };
      revokeSlotPreview(slot);
      slot.pendingFile = null;
      slot.pendingRestore = true;
      return { ok: true, slot: slot };
    }

    function clearSlotPending(slot) {
      revokeSlotPreview(slot);
      slot.pendingFile = null;
      slot.pendingRestore = false;
    }

    async function safeRemoveObject(objectPath) {
      if (!isSafeHeroStoreSlideObjectPath(objectPath)) {
        return { ok: false, reason: "unsafe_path" };
      }
      var db = getDb();
      if (!db || !db.storage) return { ok: false, reason: "no_storage" };
      state.writes.remove += 1;
      try {
        var res = await db.storage.from(bucketName()).remove([objectPath]);
        if (res && res.error) return { ok: false, error: res.error };
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err };
      }
    }

    async function uploadHeroImage(slotNumber, file) {
      var check = validateHeroUploadFile(file);
      if (!check.ok) return { ok: false, reason: check.reason };
      var path = generateHeroStoreSlideObjectPath(slotNumber, check.mime, uuidFn);
      if (!isSafeHeroStoreSlideObjectPath(path)) return { ok: false, reason: "path" };
      var db = getDb();
      if (!db || !db.storage) return { ok: false, reason: "no_storage" };
      try {
        state.writes.upload += 1;
        var up = await db.storage.from(bucketName()).upload(path, file, { upsert: false, contentType: check.mime });
        if (up && up.error) return { ok: false, error: up.error };
        var pub = db.storage.from(bucketName()).getPublicUrl(path);
        var url = pub && pub.data && pub.data.publicUrl;
        if (!isSafeImageUrl(url)) {
          await safeRemoveObject(path);
          return { ok: false, reason: "unsafe_url" };
        }
        return { ok: true, path: path, url: url };
      } catch (err) {
        await safeRemoveObject(path);
        return { ok: false, reason: "upload_throw", error: err };
      }
    }

    async function loadSettings() {
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db", form: settingsFormFromRow(null) };
      var res = await db.from("store_hero_settings").select("id,trust_line,body,rotation_interval_seconds,updated_at").eq("id", HERO_SETTINGS_ID).maybeSingle();
      if (res && res.error) return { ok: false, error: res.error, form: settingsFormFromRow(null) };
      state.settings = res && res.data ? res.data : null;
      return { ok: true, row: state.settings, form: settingsFormFromRow(state.settings) };
    }

    async function saveSettings(fields) {
      var parsed = validateSettingsFields(fields || {});
      if (!parsed.ok) return { ok: false, reason: "validation", errors: parsed.errors };
      var user = getUser();
      var db = getDb();
      if (!db || !user || !user.id) return { ok: false, reason: "no_session" };
      var payload = Object.assign({}, parsed.payload, stamp());
      if (!payload.updated_by) return { ok: false, reason: "no_session" };
      state.writes.settings += 1;
      var res = await db.from("store_hero_settings").update(payload).eq("id", HERO_SETTINGS_ID).select("id").maybeSingle();
      if (res && res.error) return { ok: false, error: res.error, message: formatHeroError(res.error) };
      if (!heroMutationApplied(res, HERO_SETTINGS_ID)) {
        return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE };
      }
      var reload = await loadSettings();
      if (!reload.ok) return { ok: false, error: reload.error, saved: true };
      return { ok: true, row: reload.row, form: reload.form, payload: payload };
    }

    async function loadSlides() {
      var db = getDb();
      if (!db) {
        state.slots = HERO_SLOTS.map(emptySlotState);
        return { ok: false, reason: "no_db", slots: state.slots };
      }
      var res = await db.from("store_hero_store_slides").select("id,enabled,sort_order,origin,repo_key,image_url,object_path,created_at,updated_at").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
      if (res && res.error) {
        state.slots = HERO_SLOTS.map(emptySlotState);
        return { ok: false, error: res.error, slots: state.slots };
      }
      state.slides = Array.isArray(res && res.data) ? res.data : [];
      state.slots = resolveSlotStates(state.slides);
      return { ok: true, rows: state.slides, slots: state.slots };
    }

    async function updateSlide(id, payload) {
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      state.writes.update += 1;
      var res = await db.from("store_hero_store_slides").update(Object.assign({}, payload, stamp())).eq("id", id).select("id").maybeSingle();
      if (res && res.error) return { ok: false, error: res.error, message: formatHeroError(res.error) };
      if (!heroMutationApplied(res, id)) {
        return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE };
      }
      return { ok: true, id: id };
    }

    async function insertUploadRow(payload) {
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      state.writes.insert += 1;
      var res = await db.from("store_hero_store_slides").insert(payload).select("id").maybeSingle();
      if (res && res.error) return { ok: false, error: res.error, message: formatHeroError(res.error) };
      var row = heroMutationRow(res);
      if (!row) return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE };
      return { ok: true, id: row.id };
    }

    async function deleteUploadRow(row) {
      if (!row || !row.id) return { ok: false, reason: "missing" };
      if (row.origin === "repo") return { ok: false, reason: "repo_protected" };
      if (!isSafeHeroStoreSlideObjectPath(row.object_path)) return { ok: false, reason: "unsafe_path" };
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      state.writes.deleteRow += 1;
      var res = await db.from("store_hero_store_slides").delete().eq("id", row.id).select("id").maybeSingle();
      if (res && res.error) return { ok: false, error: res.error, message: formatHeroError(res.error), storageSkipped: true };
      if (!heroMutationApplied(res, row.id)) {
        return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE, storageSkipped: true };
      }
      return { ok: true, id: row.id };
    }

    async function enableRepo(slot) {
      if (!slot.repoRow || !slot.repoRow.id) return { ok: false, reason: "missing_repo" };
      return updateSlide(slot.repoRow.id, { enabled: true });
    }

    async function disableRepo(slot) {
      if (!slot.repoRow || !slot.repoRow.id) return { ok: false, reason: "missing_repo" };
      return updateSlide(slot.repoRow.id, { enabled: false });
    }

    async function enableUpload(id) {
      return updateSlide(id, { enabled: true });
    }

    async function disableUpload(id) {
      return updateSlide(id, { enabled: false });
    }

    async function objectPathInUse(objectPath) {
      var t = trimText(objectPath);
      if (!t) return false;
      var db = getDb();
      if (!db) return true;
      var res = await db.from("store_hero_store_slides").select("id,object_path");
      if (res && res.error) return true;
      var rows = Array.isArray(res && res.data) ? res.data : [];
      return rows.some(function (row) {
        return trimText(row && row.object_path) === t;
      });
    }

    async function removeObjectIfUnreferenced(objectPath) {
      if (!isSafeHeroStoreSlideObjectPath(objectPath)) {
        return { ok: false, reason: "unsafe_path" };
      }
      if (await objectPathInUse(objectPath)) {
        return { ok: false, reason: "still_referenced" };
      }
      return safeRemoveObject(objectPath);
    }

    async function deleteUploadRowThenObject(row) {
      var path = trimText(row && row.object_path);
      var del = await deleteUploadRow(row);
      if (!del.ok) return { ok: false, storageSkipped: true, result: del };
      if (path) await removeObjectIfUnreferenced(path);
      return { ok: true };
    }

    async function activateCustomThenHideRepo(slot, uploadId) {
      var enabled = await enableUpload(uploadId);
      if (!enabled.ok) {
        return {
          ok: false,
          reason: "upload_enable",
          uploadEnabled: false,
          repoDisabled: false,
          rollbackDisabledUpload: false,
          message: enabled.message,
          error: enabled.error
        };
      }
      var hidden = await disableRepo(slot);
      if (hidden.ok) {
        return { ok: true, uploadEnabled: true, repoDisabled: true };
      }
      var rolled = await disableUpload(uploadId);
      return {
        ok: false,
        reason: "repo_disable",
        uploadEnabled: !rolled.ok,
        repoDisabled: false,
        rollbackDisabledUpload: !!rolled.ok,
        message: hidden.message,
        error: hidden.error
      };
    }

    async function applyFirstCustom(slot, uploaded) {
      var user = getUser();
      var ins = await insertUploadRow({
        enabled: false,
        sort_order: slot.sortOrder,
        origin: "upload",
        repo_key: null,
        image_url: uploaded.url,
        object_path: uploaded.path,
        updated_at: new Date(nowFn()).toISOString(),
        updated_by: user && user.id
      });
      if (!ins.ok) {
        await removeObjectIfUnreferenced(uploaded.path);
        return { ok: false, reason: ins.reason || "insert", error: ins.error, message: ins.message, cleanedUpload: true };
      }
      var switched = await activateCustomThenHideRepo(slot, ins.id);
      if (switched.ok) return { ok: true, id: ins.id, firstCustom: true };
      if (!switched.uploadEnabled) {
        await deleteUploadRowThenObject({ id: ins.id, origin: "upload", object_path: uploaded.path });
        return {
          ok: false,
          reason: switched.reason,
          repoNeverDisabled: true,
          cleanedUpload: true,
          message: switched.message,
          error: switched.error
        };
      }
      return {
        ok: false,
        reason: switched.reason,
        bothEnabled: true,
        keptObject: true,
        repoNeverDisabled: true,
        message: switched.message,
        error: switched.error
      };
    }

    async function revertManagedPath(id, oldUrl, oldPath) {
      return updateSlide(id, {
        image_url: oldUrl,
        object_path: oldPath
      });
    }

    async function applyReplacement(slot, uploaded) {
      var oldPath = trimText(slot.managedRow.object_path);
      var oldUrl = trimText(slot.managedRow.image_url);
      var wasEnabled = managedIsEnabled(slot.managedRow);
      var upd = await updateSlide(slot.managedRow.id, {
        image_url: uploaded.url,
        object_path: uploaded.path,
        sort_order: slot.sortOrder
      });
      if (!upd.ok) {
        await removeObjectIfUnreferenced(uploaded.path);
        return { ok: false, reason: upd.reason || "update", error: upd.error, message: upd.message, keptOld: true, cleanedNew: true };
      }
      if (wasEnabled) {
        if (oldPath && oldPath !== uploaded.path) await removeObjectIfUnreferenced(oldPath);
        return { ok: true, replaced: true, keptOld: false };
      }
      var switched = await activateCustomThenHideRepo(slot, slot.managedRow.id);
      if (switched.ok) {
        if (oldPath && oldPath !== uploaded.path) await removeObjectIfUnreferenced(oldPath);
        return { ok: true, replacedDisabled: true };
      }
      if (!switched.uploadEnabled) {
        var reverted = await revertManagedPath(slot.managedRow.id, oldUrl, oldPath);
        if (reverted.ok) await removeObjectIfUnreferenced(uploaded.path);
        return {
          ok: false,
          reason: switched.reason,
          keptOld: true,
          repoNeverDisabled: true,
          cleanedNew: !!reverted.ok,
          message: switched.message,
          error: switched.error
        };
      }
      return {
        ok: false,
        reason: switched.reason,
        bothEnabled: true,
        keptObject: true,
        repoNeverDisabled: true,
        message: switched.message,
        error: switched.error
      };
    }

    async function applySlotFile(slot) {
      if (!slot.repoRow || !slot.repoRow.id) {
        return { ok: false, reason: "missing_repo", message: "ئەسلى رەسىم قۇرى تېپىلمىدى." };
      }
      var uploaded = await uploadHeroImage(slot.slot, slot.pendingFile);
      if (!uploaded.ok) return { ok: false, reason: uploaded.reason || "upload", error: uploaded.error, message: formatHeroError(uploaded.error) };
      if (slot.managedRow && slot.managedRow.id) {
        return applyReplacement(slot, uploaded);
      }
      return applyFirstCustom(slot, uploaded);
    }

    async function restoreSlot(slot) {
      if (!slot.managedRow || !slot.managedRow.id) {
        return { ok: true, noop: true };
      }
      if (!slot.repoRow || !slot.repoRow.id) {
        return { ok: false, reason: "missing_repo", message: "ئەسلى رەسىم قۇرى تېپىلمىدى." };
      }
      var enabled = await enableRepo(slot);
      if (!enabled.ok) {
        return {
          ok: false,
          reason: "repo_enable",
          customUntouched: true,
          error: enabled.error,
          message: enabled.message
        };
      }
      var disabled = await disableUpload(slot.managedRow.id);
      if (!disabled.ok) {
        return {
          ok: false,
          reason: "upload_disable",
          bothEnabled: true,
          error: disabled.error,
          message: disabled.message
        };
      }
      var oldPath = trimText(slot.managedRow.object_path);
      var del = await deleteUploadRow(slot.managedRow);
      if (!del.ok) {
        return {
          ok: false,
          reason: "row_delete",
          restoredVisible: true,
          rowDeleted: false,
          storageSkipped: true,
          cleanupFailed: true,
          message: del.message
        };
      }
      if (oldPath) await removeObjectIfUnreferenced(oldPath);
      return { ok: true, restored: true, rowDeleted: true };
    }

    async function saveAll(fields) {
      var parsed = validateSettingsFields(fields || {});
      if (!parsed.ok) return { ok: false, reason: "validation", errors: parsed.errors };
      var i;
      for (i = 0; i < state.slots.length; i++) {
        if (state.slots[i].pendingFile) {
          var check = validateHeroUploadFile(state.slots[i].pendingFile);
          if (!check.ok) {
            return { ok: false, reason: check.reason, slot: state.slots[i].slot };
          }
        }
      }
      var user = getUser();
      var db = getDb();
      if (!db || !user || !user.id) return { ok: false, reason: "no_session" };

      var failures = [];
      var slotResults = [];
      for (i = 0; i < state.slots.length; i++) {
        var slot = state.slots[i];
        if (slot.pendingRestore) {
          var restored = await restoreSlot(slot);
          slotResults.push({ slot: slot.slot, op: "restore", result: restored });
          if (!restored.ok || restored.cleanupFailed) failures.push({ slot: slot.slot, op: "restore", result: restored });
        } else if (slot.pendingFile) {
          var applied = await applySlotFile(slot);
          slotResults.push({ slot: slot.slot, op: "image", result: applied });
          if (!applied.ok) failures.push({ slot: slot.slot, op: "image", result: applied });
        }
      }

      var settingsRes = await saveSettings(fields);
      if (!settingsRes.ok) failures.push({ op: "settings", result: settingsRes });

      var slides = await loadSlides();
      state.slots.forEach(clearSlotPending);
      if (slides.ok) state.slots = slides.slots;

      if (failures.length) {
        return {
          ok: false,
          reason: "partial",
          failures: failures,
          slotResults: slotResults,
          settings: settingsRes,
          slots: state.slots
        };
      }
      return { ok: true, slotResults: slotResults, settings: settingsRes, slots: state.slots, form: settingsRes.form };
    }

    return {
      state: state,
      HERO_SETTINGS_ID: HERO_SETTINGS_ID,
      HERO_INTERVALS: HERO_INTERVALS,
      HERO_MAX_BYTES: HERO_MAX_BYTES,
      loadSettings: loadSettings,
      saveSettings: saveSettings,
      loadSlides: loadSlides,
      saveAll: saveAll,
      setPendingFile: setPendingFile,
      stageRestore: stageRestore,
      effectiveSlotSrc: effectiveSlotSrc,
      slotHasPendingChange: slotHasPendingChange,
      safeRemoveObject: safeRemoveObject,
      uploadHeroImage: uploadHeroImage,
      applySlotFile: applySlotFile,
      restoreSlot: restoreSlot
    };
  }

  function el(id) {
    if (typeof document === "undefined") return null;
    return document.getElementById(id);
  }

  function readSettingsForm() {
    return {
      trust_line: el("heroTrustLine") && el("heroTrustLine").value,
      body: el("heroBody") && el("heroBody").value,
      rotation_interval_seconds: el("heroRotation") && el("heroRotation").value
    };
  }

  function writeSettingsForm(form) {
    if (!form) return;
    if (el("heroTrustLine")) el("heroTrustLine").value = form.trust_line || DEFAULT_TRUST_LINE;
    if (el("heroBody")) el("heroBody").value = form.body || DEFAULT_BODY;
    if (el("heroRotation")) el("heroRotation").value = String(clampHeroInterval(form.rotation_interval_seconds));
  }

  function paintSlots(ctl) {
    (ctl.state.slots || []).forEach(function (slot) {
      applySafeImgSrc(el("heroSlot" + slot.slot + "Img"), ctl.effectiveSlotSrc(slot));
      var pending = el("heroSlot" + slot.slot + "Pending");
      if (pending) pending.hidden = !ctl.slotHasPendingChange(slot);
    });
  }

  function fileMessage(reason) {
    if (reason === "too_large") return "رەسىم 5MB دىن چوڭ بولماسلىقى كېرەك.";
    return "پەقەت JPEG / PNG / WebP رەسىم قوبۇل قىلىنىدۇ. SVG يوق.";
  }

  function describeFailures(failures) {
    return (failures || []).map(function (item) {
      if (item.op === "settings") return "تېكىست / ئارىلىق";
      return "رەسىم " + item.slot;
    }).join("، ");
  }

  function bindHeroAdmin(ctx) {
    ctx = ctx || {};
    var statusFn = ctx.status || function () {};
    var idle = ctx.Idle || {};
    var ctl = createHeroAdminController({
      getDb: ctx.getDb,
      getUser: ctx.getUser,
      getCfg: ctx.getCfg
    });

    function note() {
      if (idle.noteActivity && !(idle.readState && idle.readState().locked)) idle.noteActivity({ force: true });
    }

    function paint() {
      paintSlots(ctl);
    }

    async function reloadAll() {
      var s = await ctl.loadSettings();
      writeSettingsForm(s.form || settingsFormFromRow(null));
      var slides = await ctl.loadSlides();
      paint();
      if (!s.ok) {
        statusFn(el("heroAdminStatus"), formatHeroError(s.error), "error");
        return;
      }
      if (!slides.ok) {
        statusFn(el("heroAdminStatus"), formatHeroError(slides.error), "error");
        return;
      }
      statusFn(el("heroAdminStatus"), "Hero يۈكلەندى.", "ok");
    }

    HERO_SLOTS.forEach(function (meta) {
      var file = el("heroSlot" + meta.slot + "File");
      if (file) {
        file.addEventListener("change", function () {
          var chosen = file.files && file.files[0];
          if (!chosen) return;
          var check = validateHeroUploadFile(chosen);
          if (!check.ok) {
            file.value = "";
            statusFn(el("heroAdminStatus"), fileMessage(check.reason), "error");
            return;
          }
          ctl.setPendingFile(meta.slot, chosen);
          paint();
        });
      }
      var restore = el("heroSlot" + meta.slot + "Restore");
      if (restore) {
        restore.onclick = function () {
          ctl.stageRestore(meta.slot);
          var input = el("heroSlot" + meta.slot + "File");
          if (input) input.value = "";
          paint();
        };
      }
    });

    if (el("heroForm")) {
      el("heroForm").addEventListener("submit", async function (e) {
        e.preventDefault();
        note();
        var res = await ctl.saveAll(readSettingsForm());
        writeSettingsForm((res.settings && res.settings.form) || readSettingsForm());
        paint();
        if (!res.ok) {
          if (res.reason === "validation") statusFn(el("heroAdminStatus"), "تېكىست ياكى ئارىلىق ئىناۋەتسىز. ساقلىمىدى.", "error");
          else if (res.reason === "too_large" || res.reason === "mime" || res.reason === "svg") statusFn(el("heroAdminStatus"), fileMessage(res.reason), "error");
          else if (res.reason === "partial") statusFn(el("heroAdminStatus"), "تولۇق ساقلانمىدى: " + describeFailures(res.failures), "error");
          else statusFn(el("heroAdminStatus"), (res.settings && res.settings.message) || formatHeroError(res.error), "error");
          return;
        }
        statusFn(el("heroAdminStatus"), "Hero ساقلاندى.", "ok");
      });
    }

    writeSettingsForm(settingsFormFromRow(null));
    paint();

    return {
      controller: ctl,
      reloadAll: reloadAll,
      paint: paint
    };
  }

  var api = {
    HERO_SETTINGS_ID: HERO_SETTINGS_ID,
    HERO_INTERVALS: HERO_INTERVALS,
    HERO_OBJECT_PREFIX: HERO_OBJECT_PREFIX,
    HERO_MAX_BYTES: HERO_MAX_BYTES,
    HERO_SLOTS: HERO_SLOTS,
    DEFAULT_TRUST_LINE: DEFAULT_TRUST_LINE,
    DEFAULT_BODY: DEFAULT_BODY,
    isSafeImageUrl: isSafeImageUrl,
    isAllowedPreviewSrc: isAllowedPreviewSrc,
    clampHeroInterval: clampHeroInterval,
    validateHeroUploadFile: validateHeroUploadFile,
    generateHeroStoreSlideObjectPath: generateHeroStoreSlideObjectPath,
    isSafeHeroStoreSlideObjectPath: isSafeHeroStoreSlideObjectPath,
    managedSlotFromObjectPath: managedSlotFromObjectPath,
    validateSettingsFields: validateSettingsFields,
    settingsFormFromRow: settingsFormFromRow,
    formatHeroError: formatHeroError,
    HERO_NOT_APPLIED_MESSAGE: HERO_NOT_APPLIED_MESSAGE,
    heroMutationApplied: heroMutationApplied,
    applySafeImgSrc: applySafeImgSrc,
    resolveSlotStates: resolveSlotStates,
    effectiveSlotSrc: effectiveSlotSrc,
    createHeroAdminController: createHeroAdminController,
    bindHeroAdmin: bindHeroAdmin
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguAdminHero = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
