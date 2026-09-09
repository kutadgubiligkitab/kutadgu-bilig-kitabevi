(function (root) {
  "use strict";

  var ABOUT_ID = 1;
  var HomeAbout = (root && root.KutadguHomeAbout) || {};
  var FIELDS = HomeAbout.FIELDS || ["year", "title", "intro", "paragraph1", "paragraph2", "closing", "chip1", "chip2", "chip3"];
  var MAX = HomeAbout.MAX || {
    year: 20, title: 80, intro: 500, paragraph1: 800, paragraph2: 800,
    closing: 500, chip1: 80, chip2: 80, chip3: 80
  };
  var LABELS = {
    year: "يىل",
    title: "بۆلۈم ماۋزۇسى",
    intro: "كىرىش تېكىستى",
    paragraph1: "1-ئابزاس",
    paragraph2: "2-ئابزاس",
    closing: "ئاخىرقى تېكىست",
    chip1: "مۇلازىمەت بەلگىسى 1",
    chip2: "مۇلازىمەت بەلگىسى 2",
    chip3: "مۇلازىمەت بەلگىسى 3"
  };
  var FALLBACK = {
    year: "2013",
    title: "بىز ھەققىدە",
    intro: "«بەخت ئېلىپ كېلىدىغان بىلىم» مەنىسىدىكى «قۇتادغۇبىلىك» نامىنى قوللانغان كىتابخانىمىز 2013-يىلى قۇرۇلغان.",
    paragraph1: "خەلقىمىزنىڭ بىلىمگە بولغان تەشنالىقى ۋە مەنىۋى ئېھتىياجىنى قاندۇرۇش، مىللىتىمىزنىڭ مەنىۋى ساپاسىنى بېيىتىش غايىسى بىلەن قۇرۇلغان.",
    paragraph2: "قۇتادغۇبىلىك كىتابخانىسى كىتاب ۋە ئوقۇش قوراللىرى سېتىش، كىتاب ئارىيەت بېرىش ۋە كۈتۈپخانا قاتارلىق ئۈچ ئاساسلىق بۆلۈمدىن تەركىب تاپقان بولۇپ، تۈركىيە ئىچى ۋە سىرتىدىكى ئوقۇرمەنلىرىمىزنى ھەر خىل كىتابلار بىلەن تەمىنلەپ كەلمەكتە.",
    closing: "بىلىم — ئۆزىمىزنى كۈچلەندۈرۈشنىڭ ئەڭ مۇھىم يولى. قۇتادغۇبىلىك كىتابخانىسى بىلىمگە يەتكۈزىدىغان كىتابلىرى بىلەن سىزنى ھەر ۋاقىت قارشى ئالىدۇ.",
    chip1: "كىتاب ۋە ئوقۇش قوراللىرى سېتىش",
    chip2: "كىتاب ئارىيەت بېرىش",
    chip3: "كۈتۈپخانا"
  };
  var NOT_APPLIED = "يېزىش قوللىنىلمىدى. قۇر قايتۇرۇلمىدى — 2-باسقۇچلۇق دەلىللەش (AAL2)، كىرىش ياكى ئىجازەتنى تەكشۈرۈڭ.";

  function el(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function sanitizePlainText(value, max) {
    if (HomeAbout.sanitizePlainText) return HomeAbout.sanitizePlainText(value, max);
    var text = String(value == null ? "" : value).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max) : text;
  }

  function normalizeContent(raw) {
    if (HomeAbout.normalizeContent) return HomeAbout.normalizeContent(raw);
    var src = raw && typeof raw === "object" ? raw : {};
    var out = {};
    FIELDS.forEach(function (name) {
      out[name] = sanitizePlainText(src[name], MAX[name]);
    });
    return out;
  }

  function withFallback(content) {
    var data = normalizeContent(content);
    var out = {};
    FIELDS.forEach(function (name) {
      out[name] = data[name] || FALLBACK[name];
    });
    return out;
  }

  function isMissingTable(error) {
    var msg = String((error && (error.message || error.details || error.code)) || error || "");
    return /store_homepage_about|does not exist|42P01|PGRST205/i.test(msg) || (error && (error.code === "42P01" || error.code === "PGRST205"));
  }

  function mutationApplied(res, id) {
    if (!res || res.error) return false;
    var data = res.data;
    if (Array.isArray(data)) return data.some(function (row) { return row && Number(row.id) === Number(id); });
    return !!(data && Number(data.id) === Number(id));
  }

  function createAboutAdminController(opts) {
    opts = opts || {};
    var getDb = opts.getDb || function () { return null; };
    var getUser = opts.getUser || function () { return null; };
    var state = { content: withFallback(null) };

    async function load() {
      var db = getDb();
      if (!db) return { ok: false, reason: "no_db", content: withFallback(null) };
      var res = await db.from("store_homepage_about").select("id,content").eq("id", ABOUT_ID).maybeSingle();
      if (res && res.error) {
        return { ok: false, error: res.error, missing: isMissingTable(res.error), content: withFallback(null) };
      }
      var content = withFallback(res && res.data && res.data.content);
      state.content = content;
      return { ok: true, content: content, row: res && res.data };
    }

    async function save(fields) {
      var content = withFallback(fields);
      var user = getUser();
      var db = getDb();
      if (!db || !user || !user.id) return { ok: false, reason: "no_session" };
      var payload = { content: content, updated_at: new Date().toISOString(), updated_by: user.id };
      var res = await db.from("store_homepage_about").update(payload).eq("id", ABOUT_ID).select("id").maybeSingle();
      if (res && res.error) {
        if (isMissingTable(res.error)) return { ok: false, error: res.error, missing: true };
        return { ok: false, error: res.error };
      }
      if (!mutationApplied(res, ABOUT_ID)) {
        var ins = await db.from("store_homepage_about").insert({ id: ABOUT_ID, content: content, updated_by: user.id }).select("id").maybeSingle();
        if (ins && ins.error) return { ok: false, error: ins.error, missing: isMissingTable(ins.error) };
        if (!mutationApplied(ins, ABOUT_ID)) return { ok: false, reason: "not_applied", message: NOT_APPLIED };
      }
      var reload = await load();
      if (!reload.ok) return { ok: false, error: reload.error, saved: true, content: content };
      return { ok: true, content: reload.content };
    }

    return { load: load, save: save, state: state, withFallback: withFallback };
  }

  function fieldInputId(name) {
    return "aboutField_" + name;
  }

  function ensureUi() {
    if (typeof document === "undefined") return;
    if (!el("aboutAdminCard")) {
      var hero = el("heroAdminCard");
      var card = document.createElement("section");
      card.className = "admin-card";
      card.id = "aboutAdminCard";
      var h2 = document.createElement("h2");
      h2.textContent = "بىز ھەققىدە";
      var help = document.createElement("p");
      help.className = "admin-help";
      help.textContent = "باش بەتتىكى بىز ھەققىدە خەتلىرىنى ئۆزگەرتىش. لايىھە ئۆزگەرمەيدۇ.";
      var status = document.createElement("div");
      status.id = "aboutAdminStatus";
      status.className = "admin-status";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-primary";
      btn.id = "aboutEditBtn";
      btn.textContent = "بىز ھەققىدە خەتلىرىنى ئۆزگەرتىش";
      card.appendChild(h2);
      card.appendChild(help);
      card.appendChild(status);
      card.appendChild(btn);
      if (hero && hero.parentNode) hero.parentNode.insertBefore(card, hero.nextSibling);
      else {
        var panel = document.querySelector('[data-admin-section-panel="storefront"]');
        if (panel) panel.appendChild(card);
      }
    }
    if (!el("aboutEditModal")) {
      var modal = document.createElement("div");
      modal.id = "aboutEditModal";
      modal.className = "admin-modal";
      modal.hidden = true;
      var card = document.createElement("div");
      card.className = "admin-modal-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-labelledby", "aboutEditTitle");
      var head = document.createElement("div");
      head.className = "admin-modal-head";
      var title = document.createElement("h2");
      title.id = "aboutEditTitle";
      title.textContent = "بىز ھەققىدە خەتلىرىنى ئۆزگەرتىش";
      var close = document.createElement("button");
      close.type = "button";
      close.id = "aboutEditClose";
      close.setAttribute("aria-label", "ياپماق");
      close.textContent = "×";
      head.appendChild(title);
      head.appendChild(close);
      var form = document.createElement("form");
      form.id = "aboutEditForm";
      form.className = "admin-form";
      FIELDS.forEach(function (name) {
        var label = document.createElement("label");
        label.className = "admin-wide";
        var span = document.createElement("span");
        span.textContent = LABELS[name] || name;
        var input = (name === "year" || name === "title" || name.indexOf("chip") === 0)
          ? document.createElement("input")
          : document.createElement("textarea");
        input.id = fieldInputId(name);
        input.maxLength = MAX[name];
        if (input.tagName === "TEXTAREA") input.rows = 3;
        label.appendChild(span);
        label.appendChild(input);
        form.appendChild(label);
      });
      var save = document.createElement("button");
      save.type = "submit";
      save.className = "admin-primary";
      save.id = "aboutSaveBtn";
      save.textContent = "ساقلاش";
      form.appendChild(save);
      card.appendChild(head);
      card.appendChild(form);
      modal.appendChild(card);
      document.body.appendChild(modal);
    }
  }

  function writeForm(content) {
    var data = withFallback(content);
    FIELDS.forEach(function (name) {
      var input = el(fieldInputId(name));
      if (input) input.value = data[name];
    });
  }

  function readForm() {
    var out = {};
    FIELDS.forEach(function (name) {
      var input = el(fieldInputId(name));
      out[name] = input ? input.value : "";
    });
    return normalizeContent(out);
  }

  var bound = null;

  function setStatus(text, kind) {
    var node = el("aboutAdminStatus");
    if (!node) return;
    node.textContent = text || "";
    node.className = "admin-status" + (kind ? " " + kind : "");
  }

  function openModal() {
    var modal = el("aboutEditModal");
    if (modal) modal.hidden = false;
  }

  function closeModal() {
    var modal = el("aboutEditModal");
    if (modal) modal.hidden = true;
  }

  function bindAboutAdmin(ctx) {
    ctx = ctx || {};
    ensureUi();
    var ctl = createAboutAdminController({
      getDb: ctx.getDb,
      getUser: ctx.getUser
    });
    var idle = ctx.Idle || {};
    function note() {
      if (idle.noteActivity && !(idle.readState && idle.readState().locked)) idle.noteActivity({ force: true });
    }

    async function reload() {
      var res = await ctl.load();
      writeForm(res.content);
      if (res.missing) {
        setStatus("About جەدۋىلى تېخى قوشۇلمىغان. SQL نى قولدا ئىجرا قىلىڭ.", "error");
        return res;
      }
      if (!res.ok) {
        setStatus("About خەتلىرى يۈكلەنمىدى. ھازىرچە باش بەت ئەسلى تېكىستنى كۆرسىتىدۇ.", "error");
        return res;
      }
      setStatus("About خەتلىرى يۈكلەندى.", "ok");
      return res;
    }

    var openBtn = el("aboutEditBtn");
    if (openBtn && !openBtn.dataset.bound) {
      openBtn.dataset.bound = "1";
      openBtn.addEventListener("click", async function () {
        note();
        await reload();
        openModal();
      });
    }
    var closeBtn = el("aboutEditClose");
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = "1";
      closeBtn.addEventListener("click", function () {
        closeModal();
      });
    }
    var form = el("aboutEditForm");
    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        note();
        var res = await ctl.save(readForm());
        if (res.missing) {
          setStatus("About جەدۋىلى تېخى قوشۇلمىغان. SQL نى قولدا ئىجرا قىلىڭ.", "error");
          return;
        }
        if (!res.ok) {
          setStatus(res.message || "ساقلاش مەغلۇپ بولدى.", "error");
          return;
        }
        writeForm(res.content);
        setStatus("About خەتلىرى ساقلاندى.", "ok");
        closeModal();
      });
    }

    bound = { controller: ctl, reload: reload, openModal: openModal, closeModal: closeModal };
    return bound;
  }

  async function reload() {
    if (bound && typeof bound.reload === "function") return bound.reload();
    return { ok: false };
  }

  var api = {
    ABOUT_ID: ABOUT_ID,
    FIELDS: FIELDS,
    FALLBACK: FALLBACK,
    sanitizePlainText: sanitizePlainText,
    normalizeContent: normalizeContent,
    withFallback: withFallback,
    createAboutAdminController: createAboutAdminController,
    bindAboutAdmin: bindAboutAdmin,
    reload: reload
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguAdminAbout = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
