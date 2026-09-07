(function (root) {
  "use strict";

  var HERO_SETTINGS_ID = 1;
  var HERO_INTERVALS = [5, 7, 10, 15];
  var HERO_BUCKET_FALLBACK = "book-covers";
  var HERO_OBJECT_PREFIX = "hero/campaigns/";
  var HERO_MAX_BYTES = 5 * 1024 * 1024;
  var HERO_BOOK_SEARCH_LIMIT = 8;
  var HERO_BOOK_SEARCH_DEBOUNCE_MS = 250;
  var MIME_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  var STATUS_LABELS = {
    active: "ئاكتىپ",
    scheduled: "پىلانلانغان",
    expired: "ۋاقتى ئۆتكەن",
    disabled: "توختىتىلغان"
  };

  function trimText(value) {
    if (value == null) return "";
    return String(value).trim();
  }

  function optionalText(value, maxLen) {
    var t = trimText(value);
    if (!t) return null;
    if (maxLen && t.length > maxLen) t = t.slice(0, maxLen);
    return t;
  }

  function isInternalHref(raw) {
    var t = trimText(raw);
    if (!t) return false;
    if (t.indexOf("\\") !== -1) return false;
    if (/^(javascript|data|vbscript|file|blob)\s*:/i.test(t)) return false;
    if (/^https?:/i.test(t)) return false;
    if (t.indexOf("//") === 0) return false;
    if (/^#[A-Za-z0-9_-]+$/.test(t)) return true;
    if (/^\/[^/]/.test(t) && t.indexOf("./") === -1) return true;
    return false;
  }

  function optionalInternalHref(raw) {
    var t = trimText(raw);
    if (!t) return { ok: true, value: null };
    if (!isInternalHref(t) || t.length > 500) {
      return { ok: false, value: null, error: "href" };
    }
    return { ok: true, value: t };
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

  function bookIdKey(id) {
    if (id == null || id === "") return "";
    if (typeof id === "number") {
      if (!Number.isSafeInteger(id) || id <= 0) return "";
      return String(id);
    }
    var s = String(id).trim();
    if (!/^[1-9][0-9]*$/.test(s)) return "";
    return s;
  }

  function campaignStatus(row, nowMs) {
    if (!row || row.enabled === false || row.enabled === "false" || row.enabled === 0) {
      return { key: "disabled", label: STATUS_LABELS.disabled };
    }
    var now = nowMs == null ? Date.now() : Number(nowMs);
    if (row.starts_at) {
      var start = Date.parse(row.starts_at);
      if (!Number.isNaN(start) && start > now) {
        return { key: "scheduled", label: STATUS_LABELS.scheduled };
      }
    }
    if (row.ends_at) {
      var end = Date.parse(row.ends_at);
      if (!Number.isNaN(end) && end < now) {
        return { key: "expired", label: STATUS_LABELS.expired };
      }
    }
    return { key: "active", label: STATUS_LABELS.active };
  }

  function sortCampaigns(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort(function (a, b) {
      var sa = Number(a && a.sort_order);
      var sb = Number(b && b.sort_order);
      if (!Number.isFinite(sa)) sa = 0;
      if (!Number.isFinite(sb)) sb = 0;
      if (sa !== sb) return sa - sb;
      return String((a && a.created_at) || "").localeCompare(String((b && b.created_at) || ""));
    });
  }

  function extensionFromMime(mime) {
    return MIME_EXT[String(mime || "").toLowerCase()] || "";
  }

  function validateHeroUploadFile(file) {
    if (!file) return { ok: false, reason: "missing" };
    var type = String(file.type || "").toLowerCase();
    if (!MIME_EXT[type]) {
      return { ok: false, reason: "mime" };
    }
    if (/svg/i.test(type) || /svg/i.test(String(file.name || ""))) {
      return { ok: false, reason: "svg" };
    }
    var size = Number(file.size);
    if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: "size" };
    if (size > HERO_MAX_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, mime: type, ext: MIME_EXT[type] };
  }

  function generateHeroCampaignObjectPath(mime, uuidFn) {
    var ext = extensionFromMime(mime);
    if (!ext) return "";
    var makeId = uuidFn || (typeof crypto !== "undefined" && crypto.randomUUID ? function () { return crypto.randomUUID(); } : null);
    if (!makeId) return "";
    return HERO_OBJECT_PREFIX + makeId() + "." + ext;
  }

  function isSafeHeroCampaignObjectPath(raw) {
    var t = trimText(raw);
    if (!t) return false;
    if (t.charAt(0) === "/" || t.charAt(0) === "\\") return false;
    if (t.indexOf("..") !== -1) return false;
    if (t.indexOf("\\") !== -1) return false;
    if (t.indexOf(HERO_OBJECT_PREFIX) !== 0) return false;
    var rest = t.slice(HERO_OBJECT_PREFIX.length);
    if (!rest || rest.indexOf("/") !== -1) return false;
    return /^[A-Za-z0-9._-]+\.(jpg|png|webp)$/.test(rest);
  }

  function linkedBookWarning(book) {
    if (!book) return "";
    var inactive = book.is_active === false || book.is_active === "false" || book.is_active === 0;
    var stock = Number(book.stock);
    var outOfStock = !Number.isFinite(stock) || stock <= 0;
    if (!inactive && !outOfStock) return "";
    return "بۇ كىتاب ھازىر ئاممىۋى Hero دا كۆرۈنمەيدۇ (يوشۇرۇلغان ياكى ئامبار يوق). ساقلىسىڭىز بولىدۇ؛ تور بەت كىتاب ئاممىۋى بولغۇچە بۇ تەكلىپنى يوشۇرىدۇ.";
  }

  function defaultCampaignDraft() {
    return {
      id: "",
      enabled: true,
      sort_order: 0,
      book_id: "",
      linkedBook: null,
      image_url: "",
      object_path: "",
      eyebrow: "",
      title: "",
      body: "",
      primary_label: "",
      primary_href: "",
      secondary_label: "",
      secondary_href: "",
      starts_at: "",
      ends_at: "",
      pendingFile: null,
      removeCustomImage: false,
      previewObjectUrl: "",
      bookLookupWarning: ""
    };
  }

  function fromDatetimeLocal(value) {
    var raw = trimText(value);
    if (!raw) return null;
    var d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function toDatetimeLocal(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    function pad(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function validateSettingsFields(fields) {
    var errors = {};
    var primary = optionalInternalHref(fields.primary_href);
    var secondary = optionalInternalHref(fields.secondary_href);
    if (!primary.ok) errors.primary_href = true;
    if (!secondary.ok) errors.secondary_href = true;
    var n = Math.round(Number(fields.rotation_interval_seconds));
    if (HERO_INTERVALS.indexOf(n) === -1) errors.rotation_interval_seconds = true;
    return {
      ok: !errors.primary_href && !errors.secondary_href && !errors.rotation_interval_seconds,
      errors: errors,
      payload: {
        eyebrow: optionalText(fields.eyebrow, 80),
        trust_line: optionalText(fields.trust_line, 80),
        body: optionalText(fields.body, 500),
        primary_label: optionalText(fields.primary_label, 80),
        primary_href: primary.ok ? primary.value : undefined,
        secondary_label: optionalText(fields.secondary_label, 80),
        secondary_href: secondary.ok ? secondary.value : undefined,
        rotation_interval_seconds: HERO_INTERVALS.indexOf(n) === -1 ? 7 : n
      }
    };
  }

  function validateCampaignDraft(draft) {
    var errors = {};
    var bookId = bookIdKey(draft && draft.book_id);
    var enabled = !!(draft && draft.enabled);
    var title = optionalText(draft && draft.title, 120);
    var primary = optionalInternalHref(draft && draft.primary_href);
    var secondary = optionalInternalHref(draft && draft.secondary_href);
    if (!primary.ok) errors.primary_href = true;
    if (!secondary.ok) errors.secondary_href = true;
    var starts = fromDatetimeLocal(draft && draft.starts_at);
    var ends = fromDatetimeLocal(draft && draft.ends_at);
    if ((draft && trimText(draft.starts_at) && !starts) || (draft && trimText(draft.ends_at) && !ends)) {
      errors.schedule = true;
    }
    if (starts && ends && Date.parse(ends) <= Date.parse(starts)) {
      errors.schedule = true;
    }
    var hasPending = !!(draft && draft.pendingFile);
    var hasStoredImage = !!(draft && trimText(draft.image_url)) && !(draft && draft.removeCustomImage);
    var hasImage = hasPending || hasStoredImage;
    if (enabled && !bookId) {
      if (!title) errors.title = true;
      if (!hasImage) errors.image = true;
    }
    var sort = Math.round(Number(draft && draft.sort_order));
    if (!Number.isFinite(sort)) sort = 0;
    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      payload: {
        enabled: enabled,
        sort_order: sort,
        book_id: bookId || null,
        eyebrow: optionalText(draft && draft.eyebrow, 80),
        title: title,
        body: optionalText(draft && draft.body, 500),
        primary_label: optionalText(draft && draft.primary_label, 80),
        primary_href: primary.ok ? primary.value : undefined,
        secondary_label: optionalText(draft && draft.secondary_label, 80),
        secondary_href: secondary.ok ? secondary.value : undefined,
        starts_at: starts,
        ends_at: ends
      }
    };
  }

  function canRemoveCustomImage(draft) {
    if (bookIdKey(draft && draft.book_id)) return true;
    if (!(draft && draft.enabled)) return true;
    if (draft && draft.pendingFile) return true;
    return false;
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

  var HERO_NOT_APPLIED_MESSAGE = "يېزىش قوللىنىلمىدى. قۇر قايتۇرۇلمىدى — 2-باسقۇچلۇق دەلىللەش (AAL2)، كىرىش ياكى ئىجازەتنى تەكشۈرۈڭ.";

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

  function createHeroAdminController(opts) {
    opts = opts || {};
    var getDb = opts.getDb || function () { return opts.db || null; };
    var getUser = opts.getUser || function () { return opts.user || null; };
    var getCfg = opts.getCfg || function () { return opts.cfg || {}; };
    var searchSafe = opts.searchSafe || function (term) {
      return String(term || "").replace(/[%_*(),]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    };
    var postgrestIlike = opts.postgrestIlike || function (column, term) {
      var like = "%" + String(term).replace(/\\/g, " ").replace(/"/g, "") + "%";
      return column + '.ilike."' + like + '"';
    };
    var timers = opts.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
    var urlApi = opts.URL || (typeof URL !== "undefined" ? URL : null);
    var nowFn = opts.now || function () { return Date.now(); };
    var uuidFn = opts.uuid || null;
    var confirmFn = opts.confirm || function (msg) {
      return typeof window !== "undefined" && window.confirm ? window.confirm(msg) : false;
    };

    var state = {
      settings: null,
      campaigns: [],
      draft: defaultCampaignDraft(),
      searchTimer: 0,
      lastBookSearch: { term: "", limit: 0, count: 0, ids: [] },
      writes: { settings: 0, campaignInsert: 0, campaignUpdate: 0, upload: 0, remove: 0 },
      previewTouched: false
    };

    function bucketName() {
      var cfg = getCfg() || {};
      return cfg.bucket || HERO_BUCKET_FALLBACK;
    }

    function revokePreviewUrl() {
      var url = state.draft.previewObjectUrl;
      if (url && urlApi && typeof urlApi.revokeObjectURL === "function") {
        try { urlApi.revokeObjectURL(url); } catch (err) {}
      }
      state.draft.previewObjectUrl = "";
    }

    function setPendingFile(file) {
      revokePreviewUrl();
      state.draft.pendingFile = file || null;
      state.draft.removeCustomImage = false;
      if (file && urlApi && typeof urlApi.createObjectURL === "function") {
        state.draft.previewObjectUrl = urlApi.createObjectURL(file);
      }
    }

    async function safeRemoveObject(objectPath) {
      if (!isSafeHeroCampaignObjectPath(objectPath)) {
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

    async function uploadHeroImage(file) {
      var check = validateHeroUploadFile(file);
      if (!check.ok) return { ok: false, reason: check.reason };
      var path = generateHeroCampaignObjectPath(check.mime, uuidFn);
      if (!isSafeHeroCampaignObjectPath(path)) return { ok: false, reason: "path" };
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

    function settingsPayloadFromRow(row) {
      row = row || {};
      return {
        eyebrow: row.eyebrow == null ? "" : String(row.eyebrow),
        trust_line: row.trust_line == null ? "" : String(row.trust_line),
        body: row.body == null ? "" : String(row.body),
        primary_label: row.primary_label == null ? "" : String(row.primary_label),
        primary_href: row.primary_href == null ? "" : String(row.primary_href),
        secondary_label: row.secondary_label == null ? "" : String(row.secondary_label),
        secondary_href: row.secondary_href == null ? "" : String(row.secondary_href),
        rotation_interval_seconds: clampHeroInterval(row.rotation_interval_seconds)
      };
    }

    async function loadSettings() {
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      var res = await db.from("store_hero_settings").select("id,eyebrow,trust_line,body,primary_label,primary_href,secondary_label,secondary_href,rotation_interval_seconds,updated_at").eq("id", HERO_SETTINGS_ID).maybeSingle();
      if (res && res.error) return { ok: false, error: res.error };
      state.settings = res && res.data ? res.data : null;
      return { ok: true, row: state.settings, form: settingsPayloadFromRow(state.settings) };
    }

    async function saveSettings(fields) {
      var parsed = validateSettingsFields(fields || {});
      if (!parsed.ok) return { ok: false, reason: "validation", errors: parsed.errors };
      var user = getUser();
      var db = getDb();
      if (!db || !user || !user.id) return { ok: false, reason: "no_session" };
      var payload = Object.assign({}, parsed.payload, {
        updated_at: new Date(nowFn()).toISOString(),
        updated_by: user.id
      });
      state.writes.settings += 1;
      var res = await db.from("store_hero_settings").update(payload).eq("id", HERO_SETTINGS_ID).select("id").maybeSingle();
      if (res && res.error) return { ok: false, error: res.error, message: formatHeroError(res.error) };
      if (!heroMutationApplied(res, HERO_SETTINGS_ID)) {
        return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE };
      }
      var reload = await loadSettings();
      if (!reload.ok) return { ok: false, error: reload.error, saved: true };
      return { ok: true, row: reload.row, form: reload.form };
    }

    async function loadCampaigns() {
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      var res = await db.from("store_hero_campaigns").select("id,enabled,sort_order,book_id,image_url,object_path,eyebrow,title,body,primary_label,primary_href,secondary_label,secondary_href,starts_at,ends_at,created_at,updated_at").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
      if (res && res.error) return { ok: false, error: res.error };
      state.campaigns = sortCampaigns(res && res.data);
      return { ok: true, rows: state.campaigns };
    }

    async function searchBooks(term) {
      var q = searchSafe(term);
      state.lastBookSearch.term = q;
      if (!q) {
        state.lastBookSearch.limit = 0;
        state.lastBookSearch.count = 0;
        state.lastBookSearch.ids = [];
        return { ok: true, rows: [], skipped: true };
      }
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      var or = [postgrestIlike("title", q), postgrestIlike("author", q)].join(",");
      var res = await db.from("books").select("id,title,author,image_url,is_active,stock").or(or).limit(HERO_BOOK_SEARCH_LIMIT);
      if (res && res.error) return { ok: false, error: res.error };
      var rows = Array.isArray(res && res.data) ? res.data.slice(0, HERO_BOOK_SEARCH_LIMIT) : [];
      state.lastBookSearch.limit = HERO_BOOK_SEARCH_LIMIT;
      state.lastBookSearch.count = rows.length;
      state.lastBookSearch.ids = rows.map(function (row) { return bookIdKey(row && row.id); });
      return { ok: true, rows: rows };
    }

    async function loadLinkedBook(rawId) {
      var id = bookIdKey(rawId);
      if (!id) return { ok: false, reason: "invalid_id" };
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      var res = await db.from("books").select("id,title,author,image_url,is_active,stock").eq("id", id).maybeSingle();
      if (res && res.error) return { ok: false, error: res.error };
      var row = res && res.data;
      var loadedId = bookIdKey(row && row.id);
      if (!row || loadedId !== id) return { ok: false, reason: "missing" };
      return {
        ok: true,
        book: {
          id: loadedId,
          title: row.title == null ? "" : String(row.title),
          author: row.author == null ? "" : String(row.author),
          image_url: row.image_url == null ? "" : String(row.image_url),
          is_active: row.is_active,
          stock: row.stock
        }
      };
    }

    function scheduleBookSearch(term, cb) {
      if (state.searchTimer) timers.clearTimeout(state.searchTimer);
      state.searchTimer = timers.setTimeout(function () {
        state.searchTimer = 0;
        Promise.resolve(searchBooks(term)).then(cb);
      }, HERO_BOOK_SEARCH_DEBOUNCE_MS);
      return state.searchTimer;
    }

    function selectLinkedBook(book) {
      var id = bookIdKey(book && book.id);
      state.draft.book_id = id;
      state.draft.linkedBook = book && id ? {
        id: id,
        title: book.title == null ? "" : String(book.title),
        author: book.author == null ? "" : String(book.author),
        image_url: book.image_url == null ? "" : String(book.image_url),
        is_active: book.is_active,
        stock: book.stock
      } : null;
      return state.draft.linkedBook;
    }

    function clearLinkedBook() {
      state.draft.book_id = "";
      state.draft.linkedBook = null;
    }

    function resetDraft() {
      revokePreviewUrl();
      state.draft = defaultCampaignDraft();
      return state.draft;
    }

    function fillDraftFromRow(row, linkedBook) {
      revokePreviewUrl();
      var d = defaultCampaignDraft();
      if (!row) {
        state.draft = d;
        return d;
      }
      d.id = row.id == null ? "" : String(row.id);
      d.enabled = row.enabled !== false;
      d.sort_order = Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0;
      d.book_id = bookIdKey(row.book_id);
      d.linkedBook = linkedBook || null;
      if (d.linkedBook && !d.book_id) d.book_id = bookIdKey(d.linkedBook.id);
      d.image_url = row.image_url == null ? "" : String(row.image_url);
      d.object_path = row.object_path == null ? "" : String(row.object_path);
      d.eyebrow = row.eyebrow == null ? "" : String(row.eyebrow);
      d.title = row.title == null ? "" : String(row.title);
      d.body = row.body == null ? "" : String(row.body);
      d.primary_label = row.primary_label == null ? "" : String(row.primary_label);
      d.primary_href = row.primary_href == null ? "" : String(row.primary_href);
      d.secondary_label = row.secondary_label == null ? "" : String(row.secondary_label);
      d.secondary_href = row.secondary_href == null ? "" : String(row.secondary_href);
      d.starts_at = toDatetimeLocal(row.starts_at);
      d.ends_at = toDatetimeLocal(row.ends_at);
      d.pendingFile = null;
      d.removeCustomImage = false;
      d.bookLookupWarning = "";
      state.draft = d;
      return d;
    }

    async function beginEditCampaign(row) {
      fillDraftFromRow(row, null);
      var id = state.draft.book_id;
      if (!id) return { ok: true, draft: state.draft };
      var loaded = await loadLinkedBook(id);
      if (loaded.ok && loaded.book) {
        selectLinkedBook(loaded.book);
        state.draft.bookLookupWarning = "";
        return { ok: true, draft: state.draft };
      }
      state.draft.linkedBook = null;
      state.draft.book_id = id;
      state.draft.bookLookupWarning = "تاللانغان كىتاب ئوقۇلمىدى. كىتاب ID ساقلاندى.";
      return { ok: true, draft: state.draft, bookLookupFailed: true };
    }

    function requestRemoveCustomImage() {
      if (!canRemoveCustomImage(state.draft)) {
        return { ok: false, reason: "required_image" };
      }
      revokePreviewUrl();
      state.draft.pendingFile = null;
      state.draft.removeCustomImage = true;
      return { ok: true };
    }

    function buildPreviewModel() {
      var d = state.draft;
      var book = d.linkedBook;
      var img = "";
      if (d.previewObjectUrl) img = d.previewObjectUrl;
      else if (!d.removeCustomImage && isSafeImageUrl(d.image_url)) img = trimText(d.image_url);
      else if (book && isSafeImageUrl(book.image_url)) img = trimText(book.image_url);
      var title = trimText(d.title) || (book && trimText(book.title)) || "";
      var status = campaignStatus({
        enabled: d.enabled,
        starts_at: fromDatetimeLocal(d.starts_at),
        ends_at: fromDatetimeLocal(d.ends_at)
      }, nowFn());
      return {
        image: isAllowedPreviewSrc(img) ? img : "",
        eyebrow: trimText(d.eyebrow),
        title: title,
        body: trimText(d.body),
        primary_label: trimText(d.primary_label),
        primary_href: isInternalHref(d.primary_href) ? trimText(d.primary_href) : (bookIdKey(d.book_id) ? "/book/" + bookIdKey(d.book_id) : ""),
        secondary_label: trimText(d.secondary_label),
        secondary_href: isInternalHref(d.secondary_href) ? trimText(d.secondary_href) : "",
        status: status.label,
        enabled: !!d.enabled,
        warning: linkedBookWarning(book) || trimText(d.bookLookupWarning)
      };
    }

    async function saveCampaign() {
      var parsed = validateCampaignDraft(state.draft);
      if (!parsed.ok) return { ok: false, reason: "validation", errors: parsed.errors };
      if (state.draft.pendingFile) {
        var fileCheck = validateHeroUploadFile(state.draft.pendingFile);
        if (!fileCheck.ok) return { ok: false, reason: fileCheck.reason };
      }
      var user = getUser();
      var db = getDb();
      if (!db || !user || !user.id) return { ok: false, reason: "no_session" };

      var editingId = trimText(state.draft.id);
      var oldPath = trimText(state.draft.object_path);
      var uploaded = null;
      if (state.draft.pendingFile) {
        uploaded = await uploadHeroImage(state.draft.pendingFile);
        if (!uploaded.ok) return { ok: false, reason: "upload", error: uploaded.error };
      }

      var payload = Object.assign({}, parsed.payload, {
        updated_at: new Date(nowFn()).toISOString(),
        updated_by: user.id
      });
      if (uploaded) {
        payload.image_url = uploaded.url;
        payload.object_path = uploaded.path;
      } else if (state.draft.removeCustomImage) {
        payload.image_url = null;
        payload.object_path = null;
      }

      try {
        if (editingId) {
          state.writes.campaignUpdate += 1;
          var upd = await db.from("store_hero_campaigns").update(payload).eq("id", editingId).select("id").maybeSingle();
          if (upd && upd.error) {
            if (uploaded) await safeRemoveObject(uploaded.path);
            return { ok: false, error: upd.error, message: formatHeroError(upd.error), keptOld: true };
          }
          if (!heroMutationApplied(upd, editingId)) {
            if (uploaded) await safeRemoveObject(uploaded.path);
            return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE, keptOld: true };
          }
          if (uploaded && oldPath && oldPath !== uploaded.path) await safeRemoveObject(oldPath);
          if (!uploaded && state.draft.removeCustomImage && oldPath) await safeRemoveObject(oldPath);
        } else {
          state.writes.campaignInsert += 1;
          var ins = await db.from("store_hero_campaigns").insert(payload).select("id").maybeSingle();
          if (ins && ins.error) {
            if (uploaded) await safeRemoveObject(uploaded.path);
            return { ok: false, error: ins.error, message: formatHeroError(ins.error), cleanedUpload: !!uploaded };
          }
          if (!heroMutationRow(ins)) {
            if (uploaded) await safeRemoveObject(uploaded.path);
            return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE, cleanedUpload: !!uploaded };
          }
        }
      } catch (err) {
        if (uploaded) await safeRemoveObject(uploaded.path);
        return { ok: false, error: err, message: formatHeroError(err) };
      }

      resetDraft();
      var list = await loadCampaigns();
      return { ok: true, rows: list.rows };
    }

    async function deleteCampaign(row, confirmed) {
      if (!row || !row.id) return { ok: false, reason: "missing" };
      if (!confirmed && !confirmFn("بۇ Hero تەكلىپىنى ئۆچۈرەمسىز؟")) {
        return { ok: false, reason: "cancelled" };
      }
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db" };
      var path = trimText(row.object_path);
      var expectedId = String(row.id);
      var del = await db.from("store_hero_campaigns").delete().eq("id", expectedId).select("id").maybeSingle();
      if (del && del.error) return { ok: false, error: del.error, message: formatHeroError(del.error) };
      if (!heroMutationApplied(del, expectedId)) {
        return { ok: false, reason: "not_applied", message: HERO_NOT_APPLIED_MESSAGE, storageSkipped: true };
      }
      if (isSafeHeroCampaignObjectPath(path)) {
        await safeRemoveObject(path);
      }
      if (trimText(state.draft.id) === String(row.id)) resetDraft();
      await loadCampaigns();
      return { ok: true, storageSecond: true };
    }

    function previewWouldWrite() {
      return false;
    }

    return {
      state: state,
      HERO_SETTINGS_ID: HERO_SETTINGS_ID,
      HERO_INTERVALS: HERO_INTERVALS,
      HERO_BOOK_SEARCH_LIMIT: HERO_BOOK_SEARCH_LIMIT,
      HERO_BOOK_SEARCH_DEBOUNCE_MS: HERO_BOOK_SEARCH_DEBOUNCE_MS,
      HERO_MAX_BYTES: HERO_MAX_BYTES,
      loadSettings: loadSettings,
      saveSettings: saveSettings,
      loadCampaigns: loadCampaigns,
      searchBooks: searchBooks,
      scheduleBookSearch: scheduleBookSearch,
      selectLinkedBook: selectLinkedBook,
      clearLinkedBook: clearLinkedBook,
      resetDraft: resetDraft,
      fillDraftFromRow: fillDraftFromRow,
      beginEditCampaign: beginEditCampaign,
      loadLinkedBook: loadLinkedBook,
      setPendingFile: setPendingFile,
      requestRemoveCustomImage: requestRemoveCustomImage,
      buildPreviewModel: buildPreviewModel,
      saveCampaign: saveCampaign,
      deleteCampaign: deleteCampaign,
      previewWouldWrite: previewWouldWrite,
      safeRemoveObject: safeRemoveObject,
      uploadHeroImage: uploadHeroImage
    };
  }

  function el(id) {
    if (typeof document === "undefined") return null;
    return document.getElementById(id);
  }

  function setText(node, value) {
    if (!node) return;
    node.textContent = value == null ? "" : String(value);
  }

  function applyPreviewToDom(model) {
    applySafeImgSrc(el("heroPreviewImg"), model && model.image);
    var img = el("heroPreviewImg");
    if (img) img.alt = (model && model.title) || "Hero preview";
    setText(el("heroPreviewEyebrow"), model.eyebrow);
    setText(el("heroPreviewTitle"), model.title || "كىتابخانا Hero");
    setText(el("heroPreviewBody"), model.body);
    var p = el("heroPreviewPrimary");
    if (p) {
      setText(p, model.primary_label || "كىتابلارنى كۆرۈش");
      if (model.primary_href && isInternalHref(model.primary_href)) p.setAttribute("href", model.primary_href);
      else p.setAttribute("href", "#books");
    }
    var s = el("heroPreviewSecondary");
    if (s) {
      setText(s, model.secondary_label || "بىز ھەققىدە");
      if (model.secondary_href && isInternalHref(model.secondary_href)) s.setAttribute("href", model.secondary_href);
      else s.setAttribute("href", "#about");
    }
    setText(el("heroPreviewMeta"), model.status + (model.warning ? " · " + model.warning : ""));
    setText(el("heroBookWarning"), model.warning || "");
    var warn = el("heroBookWarning");
    if (warn) warn.hidden = !model.warning;
  }

  function readSettingsForm() {
    return {
      eyebrow: el("heroEyebrow") && el("heroEyebrow").value,
      trust_line: el("heroTrustLine") && el("heroTrustLine").value,
      body: el("heroBody") && el("heroBody").value,
      primary_label: el("heroPrimaryLabel") && el("heroPrimaryLabel").value,
      primary_href: el("heroPrimaryHref") && el("heroPrimaryHref").value,
      secondary_label: el("heroSecondaryLabel") && el("heroSecondaryLabel").value,
      secondary_href: el("heroSecondaryHref") && el("heroSecondaryHref").value,
      rotation_interval_seconds: el("heroRotation") && el("heroRotation").value
    };
  }

  function writeSettingsForm(form) {
    if (!form) return;
    if (el("heroEyebrow")) el("heroEyebrow").value = form.eyebrow || "";
    if (el("heroTrustLine")) el("heroTrustLine").value = form.trust_line || "";
    if (el("heroBody")) el("heroBody").value = form.body || "";
    if (el("heroPrimaryLabel")) el("heroPrimaryLabel").value = form.primary_label || "";
    if (el("heroPrimaryHref")) el("heroPrimaryHref").value = form.primary_href || "";
    if (el("heroSecondaryLabel")) el("heroSecondaryLabel").value = form.secondary_label || "";
    if (el("heroSecondaryHref")) el("heroSecondaryHref").value = form.secondary_href || "";
    if (el("heroRotation")) el("heroRotation").value = String(clampHeroInterval(form.rotation_interval_seconds));
  }

  function syncDraftFromForm(ctl) {
    var d = ctl.state.draft;
    d.enabled = !!(el("heroCampaignEnabled") && el("heroCampaignEnabled").checked);
    d.sort_order = el("heroCampaignSort") ? el("heroCampaignSort").value : 0;
    d.eyebrow = el("heroCampaignEyebrow") ? el("heroCampaignEyebrow").value : "";
    d.title = el("heroCampaignTitle") ? el("heroCampaignTitle").value : "";
    d.body = el("heroCampaignBody") ? el("heroCampaignBody").value : "";
    d.primary_label = el("heroCampaignPrimaryLabel") ? el("heroCampaignPrimaryLabel").value : "";
    d.primary_href = el("heroCampaignPrimaryHref") ? el("heroCampaignPrimaryHref").value : "";
    d.secondary_label = el("heroCampaignSecondaryLabel") ? el("heroCampaignSecondaryLabel").value : "";
    d.secondary_href = el("heroCampaignSecondaryHref") ? el("heroCampaignSecondaryHref").value : "";
    d.starts_at = el("heroCampaignStart") ? el("heroCampaignStart").value : "";
    d.ends_at = el("heroCampaignEnd") ? el("heroCampaignEnd").value : "";
  }

  function writeCampaignForm(draft) {
    if (el("heroCampaignEditId")) el("heroCampaignEditId").value = draft.id || "";
    if (el("heroCampaignEnabled")) el("heroCampaignEnabled").checked = draft.enabled !== false;
    if (el("heroCampaignSort")) el("heroCampaignSort").value = String(draft.sort_order || 0);
    if (el("heroCampaignEyebrow")) el("heroCampaignEyebrow").value = draft.eyebrow || "";
    if (el("heroCampaignTitle")) el("heroCampaignTitle").value = draft.title || "";
    if (el("heroCampaignBody")) el("heroCampaignBody").value = draft.body || "";
    if (el("heroCampaignPrimaryLabel")) el("heroCampaignPrimaryLabel").value = draft.primary_label || "";
    if (el("heroCampaignPrimaryHref")) el("heroCampaignPrimaryHref").value = draft.primary_href || "";
    if (el("heroCampaignSecondaryLabel")) el("heroCampaignSecondaryLabel").value = draft.secondary_label || "";
    if (el("heroCampaignSecondaryHref")) el("heroCampaignSecondaryHref").value = draft.secondary_href || "";
    if (el("heroCampaignStart")) el("heroCampaignStart").value = draft.starts_at || "";
    if (el("heroCampaignEnd")) el("heroCampaignEnd").value = draft.ends_at || "";
    if (el("heroCampaignImage")) el("heroCampaignImage").value = "";
    renderSelectedBook(draft.linkedBook);
    var src = draft.previewObjectUrl || (!draft.removeCustomImage && isSafeImageUrl(draft.image_url) ? draft.image_url : "");
    applySafeImgSrc(el("heroCampaignImagePreview"), src);
  }

  function renderSelectedBook(book) {
    var box = el("heroBookSelected");
    if (!box) return;
    box.innerHTML = "";
    if (!book) {
      var empty = document.createElement("p");
      empty.className = "admin-help";
      empty.textContent = "كىتاب تاللانمىغان. ئىختىيارىي.";
      box.appendChild(empty);
      return;
    }
    var row = document.createElement("div");
    row.className = "admin-hero-book-picked";
    var img = document.createElement("img");
    img.alt = "";
    applySafeImgSrc(img, book.image_url);
    var meta = document.createElement("div");
    var title = document.createElement("div");
    title.className = "admin-book-title";
    title.textContent = book.title || "";
    var author = document.createElement("div");
    author.className = "admin-book-meta";
    author.textContent = (book.author || "") + " · ID " + (book.id || "");
    meta.append(title, author);
    row.append(img, meta);
    box.appendChild(row);
  }

  function renderBookResults(rows, ctl, refreshPreview) {
    var list = el("heroBookResults");
    if (!list) return;
    list.innerHTML = "";
    (rows || []).forEach(function (book) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-hero-book-hit";
      var img = document.createElement("img");
      img.alt = "";
      applySafeImgSrc(img, book.image_url);
      var wrap = document.createElement("span");
      var t = document.createElement("strong");
      t.textContent = book.title || "";
      var a = document.createElement("span");
      a.textContent = book.author || "";
      wrap.append(t, a);
      btn.append(img, wrap);
      btn.addEventListener("click", function () {
        ctl.selectLinkedBook(book);
        renderSelectedBook(ctl.state.draft.linkedBook);
        list.innerHTML = "";
        if (el("heroBookSearch")) el("heroBookSearch").value = "";
        refreshPreview();
      });
      list.appendChild(btn);
    });
  }

  function renderCampaignList(ctl, statusFn, refreshPreview) {
    var list = el("heroCampaignList");
    if (!list) return;
    list.innerHTML = "";
    var rows = ctl.state.campaigns || [];
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "admin-help";
      empty.textContent = "ھازىرچە Hero تەكلىپى يوق.";
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var item = document.createElement("div");
      item.className = "admin-hero-campaign-row";
      var img = document.createElement("img");
      img.alt = "";
      applySafeImgSrc(img, row.image_url);
      var body = document.createElement("div");
      var title = document.createElement("div");
      title.className = "admin-book-title";
      title.textContent = row.title || (row.book_id ? "كىتاب #" + bookIdKey(row.book_id) : "تېمىسىز تەكلىپ");
      var meta = document.createElement("div");
      meta.className = "admin-book-meta";
      var st = campaignStatus(row);
      var bookBit = row.book_id ? "كىتاب " + bookIdKey(row.book_id) : "كىتابسىز";
      meta.textContent = st.label + " · " + (row.enabled === false ? "يېپىق" : "ئوچۇق") + " · تەرتىپ " + (row.sort_order ?? 0) + " · " + bookBit;
      body.append(title, meta);
      var actions = document.createElement("div");
      actions.className = "admin-book-actions";
      var edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "تەھرىرلەش";
      edit.addEventListener("click", function () {
        ctl.beginEditCampaign(row).then(function () {
          writeCampaignForm(ctl.state.draft);
          refreshPreview();
          statusFn(ctl.state.draft.bookLookupWarning || "تەكلىپ تەھرىرلەش ئۈچۈن ئېچىلدى.", ctl.state.draft.bookLookupWarning ? "warn" : "ok");
        });
      });
      var del = document.createElement("button");
      del.type = "button";
      del.className = "admin-danger";
      del.textContent = "ئۆچۈرۈش";
      del.addEventListener("click", function () {
        ctl.deleteCampaign(row).then(function (res) {
          if (!res.ok) {
            if (res.reason === "cancelled") return;
            statusFn(res.message || "ئۆچۈرۈلمىدى.", "error");
            return;
          }
          renderCampaignList(ctl, statusFn, refreshPreview);
          writeCampaignForm(ctl.state.draft);
          refreshPreview();
          statusFn("Hero تەكلىپى ئۆچۈرۈلدى.", "ok");
        });
      });
      actions.append(edit, del);
      item.append(img, body, actions);
      list.appendChild(item);
    });
  }

  function bindHeroAdmin(ctx) {
    ctx = ctx || {};
    var statusFn = ctx.status || function () {};
    var idle = ctx.Idle || {};
    var ctl = createHeroAdminController({
      getDb: ctx.getDb,
      getUser: ctx.getUser,
      getCfg: ctx.getCfg,
      searchSafe: ctx.searchSafe,
      postgrestIlike: ctx.postgrestIlike
    });

    function note() {
      if (idle.noteActivity && !(idle.readState && idle.readState().locked)) idle.noteActivity({ force: true });
    }

    function refreshPreview() {
      syncDraftFromForm(ctl);
      applyPreviewToDom(ctl.buildPreviewModel());
    }

    async function reloadAll() {
      var s = await ctl.loadSettings();
      if (!s.ok) {
        statusFn(el("heroAdminStatus"), formatHeroError(s.error), "error");
        return;
      }
      writeSettingsForm(s.form);
      var c = await ctl.loadCampaigns();
      if (!c.ok) {
        statusFn(el("heroAdminStatus"), formatHeroError(c.error), "error");
        return;
      }
      renderCampaignList(ctl, function (msg, type) { statusFn(el("heroAdminStatus"), msg, type); }, refreshPreview);
      statusFn(el("heroAdminStatus"), "Hero تەڭشىكى يۈكلەندى. تەكلىپ سانى: " + ctl.state.campaigns.length, "ok");
      refreshPreview();
    }

    if (el("heroSettingsForm")) {
      el("heroSettingsForm").addEventListener("submit", async function (e) {
        e.preventDefault();
        note();
        var res = await ctl.saveSettings(readSettingsForm());
        if (!res.ok) {
          if (res.reason === "validation") statusFn(el("heroAdminStatus"), "ئىچكى ئۇلانما ئادرېسى ئىناۋەتسىز. ساقلىمىدى.", "error");
          else statusFn(el("heroAdminStatus"), res.message || formatHeroError(res.error), "error");
          return;
        }
        writeSettingsForm(res.form);
        statusFn(el("heroAdminStatus"), "Hero تەڭشىكى ساقلاندى.", "ok");
      });
    }

    ["heroCampaignEnabled","heroCampaignSort","heroCampaignEyebrow","heroCampaignTitle","heroCampaignBody","heroCampaignPrimaryLabel","heroCampaignPrimaryHref","heroCampaignSecondaryLabel","heroCampaignSecondaryHref","heroCampaignStart","heroCampaignEnd"].forEach(function (id) {
      var node = el(id);
      if (!node) return;
      node.addEventListener("input", refreshPreview);
      node.addEventListener("change", refreshPreview);
    });

    if (el("heroCampaignImage")) {
      el("heroCampaignImage").addEventListener("change", function () {
        var file = el("heroCampaignImage").files && el("heroCampaignImage").files[0];
        if (!file) return;
        var check = validateHeroUploadFile(file);
        if (!check.ok) {
          el("heroCampaignImage").value = "";
          statusFn(el("heroAdminStatus"), check.reason === "too_large" ? "رەسىم 5MB دىن چوڭ بولماسلىقى كېرەك." : "پەقەت JPEG / PNG / WebP رەسىم قوبۇل قىلىنىدۇ. SVG يوق.", "error");
          return;
        }
        ctl.setPendingFile(file);
        writeCampaignForm(ctl.state.draft);
        refreshPreview();
      });
    }

    if (el("heroCampaignImageRemove")) {
      el("heroCampaignImageRemove").onclick = function () {
        syncDraftFromForm(ctl);
        var res = ctl.requestRemoveCustomImage();
        if (!res.ok) {
          statusFn(el("heroAdminStatus"), "كىتابسىز قوزغىتىلغان تەكلىپنىڭ رەسىمىنى ئۆچۈرۈش ئۈچۈن كىتاب تاللاڭ، يېڭى رەسىم يۈكلەڭ ياكى تەكلىپنى توختىتىڭ.", "error");
          return;
        }
        writeCampaignForm(ctl.state.draft);
        refreshPreview();
      };
    }

    if (el("heroBookSearch")) {
      el("heroBookSearch").addEventListener("input", function () {
        var q = el("heroBookSearch").value;
        ctl.scheduleBookSearch(q, function (res) {
          if (!res || !res.ok) return;
          renderBookResults(res.rows, ctl, refreshPreview);
        });
      });
    }

    if (el("heroBookClear")) {
      el("heroBookClear").onclick = function () {
        ctl.clearLinkedBook();
        renderSelectedBook(null);
        refreshPreview();
      };
    }

    if (el("heroCampaignForm")) {
      el("heroCampaignForm").addEventListener("submit", async function (e) {
        e.preventDefault();
        note();
        syncDraftFromForm(ctl);
        var res = await ctl.saveCampaign();
        if (!res.ok) {
          if (res.reason === "validation") {
            if (res.errors && res.errors.schedule) statusFn(el("heroAdminStatus"), "ئاخىرلىشىش ۋاقتى باشلىنىشتىن كېيىن بولۇشى كېرەك.", "error");
            else if (res.errors && (res.errors.primary_href || res.errors.secondary_href)) statusFn(el("heroAdminStatus"), "ئىچكى ئۇلانما ئادرېسى ئىناۋەتسىز. ساقلىمىدى.", "error");
            else if (res.errors && (res.errors.title || res.errors.image)) statusFn(el("heroAdminStatus"), "كىتابسىز قوزغىتىلغان تەكلىپكە ماۋزۇ ۋە رەسىم كېرەك.", "error");
            else statusFn(el("heroAdminStatus"), "تەكلىپ ئىناۋەتسىز.", "error");
          } else statusFn(el("heroAdminStatus"), res.message || formatHeroError(res.error), "error");
          return;
        }
        writeCampaignForm(ctl.state.draft);
        renderCampaignList(ctl, function (msg, type) { statusFn(el("heroAdminStatus"), msg, type); }, refreshPreview);
        refreshPreview();
        statusFn(el("heroAdminStatus"), "Hero تەكلىپى ساقلاندى.", "ok");
      });
    }

    function startNew() {
      ctl.resetDraft();
      writeCampaignForm(ctl.state.draft);
      renderBookResults([], ctl, refreshPreview);
      refreshPreview();
    }

    if (el("heroCampaignReset")) el("heroCampaignReset").onclick = startNew;
    if (el("heroCampaignNew")) el("heroCampaignNew").onclick = startNew;

    refreshPreview();

    return {
      controller: ctl,
      reloadAll: reloadAll,
      refreshPreview: refreshPreview
    };
  }

  var api = {
    HERO_SETTINGS_ID: HERO_SETTINGS_ID,
    HERO_INTERVALS: HERO_INTERVALS,
    HERO_OBJECT_PREFIX: HERO_OBJECT_PREFIX,
    HERO_MAX_BYTES: HERO_MAX_BYTES,
    HERO_BOOK_SEARCH_LIMIT: HERO_BOOK_SEARCH_LIMIT,
    HERO_BOOK_SEARCH_DEBOUNCE_MS: HERO_BOOK_SEARCH_DEBOUNCE_MS,
    isInternalHref: isInternalHref,
    isSafeImageUrl: isSafeImageUrl,
    isAllowedPreviewSrc: isAllowedPreviewSrc,
    optionalText: optionalText,
    clampHeroInterval: clampHeroInterval,
    bookIdKey: bookIdKey,
    campaignStatus: campaignStatus,
    sortCampaigns: sortCampaigns,
    validateHeroUploadFile: validateHeroUploadFile,
    generateHeroCampaignObjectPath: generateHeroCampaignObjectPath,
    isSafeHeroCampaignObjectPath: isSafeHeroCampaignObjectPath,
    linkedBookWarning: linkedBookWarning,
    defaultCampaignDraft: defaultCampaignDraft,
    validateSettingsFields: validateSettingsFields,
    validateCampaignDraft: validateCampaignDraft,
    canRemoveCustomImage: canRemoveCustomImage,
    formatHeroError: formatHeroError,
    HERO_NOT_APPLIED_MESSAGE: HERO_NOT_APPLIED_MESSAGE,
    heroMutationApplied: heroMutationApplied,
    applySafeImgSrc: applySafeImgSrc,
    createHeroAdminController: createHeroAdminController,
    bindHeroAdmin: bindHeroAdmin
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguAdminHero = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
