(function (root) {
  "use strict";

  var HOURS_ID = 1;
  var Hours = (root && root.KutadguShopHours) || {};
  var NOT_APPLIED = "يېزىش قوللىنىلمىدى. 2-باسقۇچلۇق دەلىللەش (AAL2)، كىرىش ياكى ئىجازەتنى تەكشۈرۈڭ.";
  var SAVED = "دۇكان ئىش ۋاقتى ساقلىنىپ بولدى.";
  var MISSING = "بۇ تەڭشەك تېخى قوشۇلمىغان.";

  function el(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function isMissingTable(error) {
    var msg = String((error && (error.message || error.details || error.code)) || error || "");
    return /store_shop_hours|does not exist|42P01|PGRST205/i.test(msg) || (error && (error.code === "42P01" || error.code === "PGRST205"));
  }

  function mutationApplied(res, id) {
    if (!res || res.error) return false;
    var data = res.data;
    if (Array.isArray(data)) return data.some(function (row) { return row && Number(row.id) === Number(id); });
    return !!(data && Number(data.id) === Number(id));
  }

  function setStatus(text, kind) {
    var box = el("shopHoursStatus");
    if (!box) return;
    box.textContent = text || "";
    box.hidden = !text;
    box.className = "admin-status" + (kind ? " " + kind : "");
  }

  function hoursApi() {
    return (root && root.KutadguShopHours) || Hours;
  }

  function fallbackHours() {
    var api = hoursApi();
    return api.withFallback ? api.withFallback(null) : {
      weekdayOpen: "08:30",
      weekdayClose: "20:00",
      sundayOpen: "10:30",
      sundayClose: "18:00"
    };
  }

  function publicConfig() {
    var c = (root && root.KUTADGU_SUPABASE_CONFIG) || {};
    return {
      url: String(c.url || "").replace(/\/+$/, ""),
      key: String(c.anonKey || c.publishableKey || "")
    };
  }

  function isPreviewAuth() {
    return !!(root && root.__kutadguSkipAdminAuth);
  }

  function writerId(user) {
    var id = user && user.id ? String(user.id) : "";
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) return id;
    return null;
  }

  function restHeaders(extra) {
    var c = publicConfig();
    var headers = {
      apikey: c.key,
      Authorization: "Bearer " + c.key,
      Accept: "application/json"
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        headers[key] = extra[key];
      });
    }
    return headers;
  }

  async function restLoad() {
    var c = publicConfig();
    if (!c.url || !c.key) return { ok: false, reason: "no_db", hours: fallbackHours() };
    try {
      var res = await fetch(c.url + "/rest/v1/store_shop_hours?select=id,content&id=eq.1", {
        method: "GET",
        headers: restHeaders(),
        cache: "no-store",
        credentials: "omit"
      });
      if (!res.ok) {
        var err = { message: "http_" + res.status, code: res.status === 404 ? "PGRST205" : String(res.status) };
        return { ok: false, error: err, missing: isMissingTable(err) || res.status === 404, hours: fallbackHours() };
      }
      var data = await res.json();
      var row = Array.isArray(data) ? data[0] : data;
      var hours = hoursApi().withFallback(row && row.content);
      return { ok: true, hours: hours, row: row };
    } catch (err) {
      return { ok: false, error: err, hours: fallbackHours() };
    }
  }

  async function restSave(hours, user) {
    var c = publicConfig();
    if (!c.url || !c.key) return { ok: false, reason: "no_session" };
    var payload = {
      content: hours,
      updated_at: new Date().toISOString()
    };
    var by = writerId(user);
    if (by) payload.updated_by = by;
    async function send(method) {
      var url = c.url + "/rest/v1/store_shop_hours" + (method === "PATCH" ? "?id=eq." + HOURS_ID : "");
      var body = method === "POST" ? Object.assign({ id: HOURS_ID }, payload) : payload;
      var res = await fetch(url, {
        method: method,
        headers: restHeaders({
          "Content-Type": "application/json",
          Prefer: "return=representation"
        }),
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "omit"
      });
      var json = null;
      try { json = await res.json(); } catch (err) { json = null; }
      if (!res.ok) {
        return { error: { message: "http_" + res.status, code: String(res.status) }, data: json };
      }
      return { data: json };
    }
    var updated = await send("PATCH");
    if (updated.error) {
      if (isMissingTable(updated.error)) return { ok: false, error: updated.error, missing: true };
      return { ok: false, error: updated.error };
    }
    if (!mutationApplied(updated, HOURS_ID)) {
      var inserted = await send("POST");
      if (inserted.error) return { ok: false, error: inserted.error, missing: isMissingTable(inserted.error) };
      if (!mutationApplied(inserted, HOURS_ID)) return { ok: false, reason: "not_applied", message: NOT_APPLIED };
    }
    var reload = await restLoad();
    if (!reload.ok) return { ok: false, error: reload.error, saved: true, hours: hours };
    return { ok: true, hours: reload.hours };
  }

  function createShopHoursAdminController(opts) {
    opts = opts || {};
    var getDb = opts.getDb || function () { return null; };
    var getUser = opts.getUser || function () { return null; };
    var state = { hours: fallbackHours() };

    async function load() {
      var db = getDb();
      if (!db) {
        if (!isPreviewAuth()) return { ok: false, reason: "no_db", hours: fallbackHours() };
        var preview = await restLoad();
        if (preview.ok) state.hours = preview.hours;
        return preview;
      }
      var res = await db.from("store_shop_hours").select("id,content").eq("id", HOURS_ID).maybeSingle();
      if (res && res.error) {
        return { ok: false, error: res.error, missing: isMissingTable(res.error), hours: fallbackHours() };
      }
      var hours = hoursApi().withFallback(res && res.data && res.data.content);
      state.hours = hours;
      return { ok: true, hours: hours, row: res && res.data };
    }

    async function save(fields) {
      var api = hoursApi();
      var checked = api.validateHours(fields);
      if (!checked.ok) return { ok: false, reason: "validation", error: checked.error };
      var user = getUser() || (isPreviewAuth() ? { id: "preview-admin" } : null);
      var db = getDb();
      if (!db) {
        if (!isPreviewAuth()) return { ok: false, reason: "no_session" };
        var previewSave = await restSave(checked.hours, user);
        if (previewSave.ok) state.hours = previewSave.hours;
        return previewSave;
      }
      if (!user || !user.id) return { ok: false, reason: "no_session" };
      var payload = {
        content: checked.hours,
        updated_at: new Date().toISOString()
      };
      var by = writerId(user);
      if (by) payload.updated_by = by;
      var res = await db.from("store_shop_hours").update(payload).eq("id", HOURS_ID).select("id").maybeSingle();
      if (res && res.error) {
        if (isMissingTable(res.error)) return { ok: false, error: res.error, missing: true };
        return { ok: false, error: res.error };
      }
      if (!mutationApplied(res, HOURS_ID)) {
        var insertRow = { id: HOURS_ID, content: checked.hours };
        if (by) insertRow.updated_by = by;
        var ins = await db.from("store_shop_hours").insert(insertRow).select("id").maybeSingle();
        if (ins && ins.error) return { ok: false, error: ins.error, missing: isMissingTable(ins.error) };
        if (!mutationApplied(ins, HOURS_ID)) return { ok: false, reason: "not_applied", message: NOT_APPLIED };
      }
      var reload = await load();
      if (!reload.ok) return { ok: false, error: reload.error, saved: true, hours: checked.hours };
      return { ok: true, hours: reload.hours };
    }

    return { load: load, save: save, state: state };
  }

  function readForm() {
    return {
      weekdayOpen: el("shopHoursWeekdayOpen") ? el("shopHoursWeekdayOpen").value : "",
      weekdayClose: el("shopHoursWeekdayClose") ? el("shopHoursWeekdayClose").value : "",
      sundayOpen: el("shopHoursSundayOpen") ? el("shopHoursSundayOpen").value : "",
      sundayClose: el("shopHoursSundayClose") ? el("shopHoursSundayClose").value : ""
    };
  }

  function writeForm(hours) {
    var data = hoursApi().withFallback(hours);
    if (el("shopHoursWeekdayOpen")) el("shopHoursWeekdayOpen").value = data.weekdayOpen;
    if (el("shopHoursWeekdayClose")) el("shopHoursWeekdayClose").value = data.weekdayClose;
    if (el("shopHoursSundayOpen")) el("shopHoursSundayOpen").value = data.sundayOpen;
    if (el("shopHoursSundayClose")) el("shopHoursSundayClose").value = data.sundayClose;
  }

  function bindShopHoursAdmin(ctx) {
    ctx = ctx || {};
    var form = el("shopHoursForm");
    if (!form || form.dataset.kutadguBound === "1") return;
    form.dataset.kutadguBound = "1";
    var ctl = createShopHoursAdminController(ctx);

    async function reload() {
      var res = await ctl.load();
      writeForm(res.hours);
      if (res.missing) {
        setStatus(MISSING, "warn");
        return res;
      }
      if (!res.ok) {
        setStatus("ئىش ۋاقتى ئوقۇلمىدى.", "warn");
        return res;
      }
      setStatus("", "");
      return res;
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var checked = hoursApi().validateHours(readForm());
      if (!checked.ok) {
        setStatus(checked.error, "error");
        return;
      }
      var res = await ctl.save(checked.hours);
      if (res.missing) {
        setStatus(MISSING, "warn");
        return;
      }
      if (res.reason === "validation") {
        setStatus(res.error, "error");
        return;
      }
      if (!res.ok) {
        setStatus(res.message || "ساقلاش مەغلۇپ بولدى.", "error");
        return;
      }
      writeForm(res.hours);
      setStatus(SAVED, "ok");
    });

    reload();
    api.reload = reload;
    return { controller: ctl, reload: reload };
  }

  var api = {
    HOURS_ID: HOURS_ID,
    SAVED: SAVED,
    createShopHoursAdminController: createShopHoursAdminController,
    bindShopHoursAdmin: bindShopHoursAdmin,
    isMissingTable: isMissingTable
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguAdminShopHours = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
