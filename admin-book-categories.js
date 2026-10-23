(function (root) {
  "use strict";

  const RESERVED = new Set([
    "adabiyat", "books", "book", "cart", "admin", "author", "translator",
    "publisher", "api", "sitemap", "order-info", "privacy", "returns",
    "delete-account", "feedback", "account", "favorites", "my-books", "search"
  ]);
  const FOLD = {
    "ا": "a", "آ": "a", "ب": "b", "پ": "p", "ت": "t", "ث": "s", "ج": "j", "چ": "ch",
    "ح": "h", "خ": "x", "د": "d", "ذ": "z", "ر": "r", "ز": "z", "ژ": "zh", "س": "s",
    "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z", "ع": "", "غ": "gh", "ف": "f",
    "ق": "q", "ك": "k", "ک": "k", "گ": "g", "ڭ": "ng", "ل": "l", "م": "m", "ن": "n",
    "ھ": "h", "ه": "h", "و": "o", "ۇ": "u", "ۆ": "o", "ۈ": "u", "ۋ": "w", "ې": "e",
    "ى": "i", "ي": "y", "ئ": "", "ە": "e", "ة": "e"
  };

  const $ = (selector) => root.document.querySelector(selector);
  const state = {
    db: null,
    rows: [],
    preview: null,
    generation: 0,
    bookLoad: 0,
    previewToken: 0,
    previewPending: false,
    busy: false,
    attempts: {},
    managingId: null,
    renameDirty: false,
    retireOpen: false,
    createDraft: null,
    pendingCreate: null,
    lastCode: ""
  };

  function text(value) { return String(value == null ? "" : value).trim(); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }
  function requestId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const n = Math.floor(Math.random() * 16);
      return (ch === "x" ? n : (n & 0x3 | 0x8)).toString(16);
    });
  }
  function status(message, kind) {
    const el = $("#bookCategoryStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "admin-status" + (kind ? " " + kind : "");
    el.hidden = !message;
  }
  function errorText(error) {
    const blob = String(error && (error.message || error.details || error) || "");
    if (/category_not_empty/.test(blob)) return "بۇ تۈردە يەنىلا كىتاب ياكى يۈرۈشلۈك بار. ئالدى بىلەن يۆتكەڭ.";
    if (/slug_in_use/.test(blob)) return "بۇ تۈرنى قوشقىلى بولمىدى. كىرگۈزگەن نام ساقلىنىدۇ، يەنە بىر قېتىم ساقلاڭ.";
    if (/category_revision_conflict|category_move_changed/.test(blob)) return "تۈر ئۆزگەرتىلدى. تىزىمنى يېڭىلاپ قايتا جەزملەڭ.";
    if (/books_missing/.test(blob)) return "تاللانغان كىتاب تېپىلمىدى. تىزىمنى يېڭىلاپ قايتا تاللاڭ.";
    if (/not_universal/.test(blob)) return "پەقەت ئۇنىۋېرسال تۈردىكى تاللانغان كىتابلار يۆتكىلىدۇ.";
    if (/category_retired|universal_required|invalid_redirect|redirect_target|destination_unavailable/.test(blob)) return "بۇ تۈرنى بۇ ئۇسۇلدا ئېلىۋېتكىلى ياكى نىشان قىلغىلى بولمايدۇ.";
    if (/Admin AAL2 required|42501/.test(blob)) return "باشقۇرغۇچى جەزملەش تېخى تاماملانمىغان.";
    return "تۈر مەشغۇلاتى تاماملانمىدى.";
  }
  function rejectionCode(error) {
    const blob = String(error && (error.message || error.details || error.code || error) || "");
    if (/slug_in_use/.test(blob)) return "slug_in_use";
    return "";
  }
  function unresolved(error) {
    return !!(error && error.unresolved);
  }
  function databaseRejection(result) {
    const error = result && result.error;
    const statusCode = Number(result && result.status);
    const code = String(error && error.code || "");
    if (!error || !Number.isFinite(statusCode) || statusCode < 400 || statusCode >= 500 || statusCode === 408 || statusCode === 429) return false;
    return /^[0-9A-Z]{5}$/.test(code) || /^PGRST/.test(code);
  }
  function markUnresolved(error, statusCode) {
    const failure = error instanceof Error ? error : new Error(String(error && (error.message || error.details) || "unresolved"));
    try {
      failure.unresolved = true;
      if (error && error !== failure) {
        if (error.code) failure.code = error.code;
        if (error.details) failure.details = error.details;
        if (error.hint) failure.hint = error.hint;
      }
      if (statusCode != null) failure.status = statusCode;
    } catch (ignored) {
      const wrapped = new Error(failure.message || "unresolved");
      wrapped.unresolved = true;
      wrapped.status = statusCode;
      return wrapped;
    }
    return failure;
  }
  function slugBase(name) {
    let folded = "";
    for (const ch of String(name || "").toLowerCase()) {
      if (/[a-z0-9]/.test(ch)) folded += ch;
      else if (ch === " " || ch === "-" || ch === "_" || ch === "/") folded += "-";
      else folded += Object.prototype.hasOwnProperty.call(FOLD, ch) ? FOLD[ch] : "";
    }
    folded = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
    if (folded.length > 48) folded = folded.slice(0, 48).replace(/-+$/g, "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folded)) folded = "tur";
    return folded;
  }
  function slugFor(name, rows) {
    const used = new Set((rows || []).map((row) => text(row && row.slug)));
    const base = slugBase(name);
    let candidate = base;
    let number = 2;
    while (RESERVED.has(candidate) || used.has(candidate) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) {
      const suffix = "-" + number;
      candidate = base.slice(0, Math.max(1, 48 - suffix.length)).replace(/-+$/g, "") + suffix;
      number += 1;
      if (number > 100) return "tur-" + requestId().replace(/-/g, "").slice(0, 8);
    }
    return candidate;
  }
  function rememberDraft(label, summary) {
    if (state.pendingCreate) {
      const args = state.pendingCreate.args;
      return { label: args.p_label, summary: args.p_summary, slug: args.p_slug };
    }
    const current = state.createDraft;
    if (current && current.label === label && current.slug) {
      current.summary = summary;
      return current;
    }
    state.createDraft = { label, summary, slug: slugFor(label, state.rows) };
    return state.createDraft;
  }
  function createFields() {
    return { label: $("#bookCategoryLabel"), summary: $("#bookCategorySummary") };
  }
  function lockCreateFields(locked) {
    const fields = createFields();
    if (fields.label) fields.label.disabled = !!locked;
    if (fields.summary) fields.summary.disabled = !!locked;
  }
  function createSubmit() {
    const form = $("#bookCategoryCreate");
    return form ? form.querySelector("button[type=submit]") : null;
  }
  function lockCreateSubmission(locked) {
    const button = createSubmit();
    if (button) button.disabled = !!locked;
  }
  function showPendingCreate() {
    const pending = state.pendingCreate;
    const fields = createFields();
    if (!pending || !fields.label || !fields.summary) return;
    fields.label.value = pending.args.p_label;
    fields.summary.value = pending.args.p_summary;
    lockCreateFields(true);
    lockCreateSubmission(state.busy);
  }
  async function call(name, args) {
    let result;
    try {
      result = await state.db.rpc(name, args);
    } catch (error) {
      throw markUnresolved(error, 0);
    }
    if (result && result.error) {
      if (!databaseRejection(result)) throw markUnresolved(result.error, result.status);
      throw result.error;
    }
    const statusCode = Number(result && result.status);
    if (!result || (Number.isFinite(statusCode) && statusCode >= 400)) throw markUnresolved(new Error("unresolved"), statusCode || 0);
    return result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  }
  function activeRows() {
    return state.rows.filter((row) => !row.retired);
  }
  function syncConfirm() {
    const button = $("#bookCategoryConfirmMove");
    if (!button) return;
    button.disabled = !state.preview || state.busy || state.previewPending;
  }
  function invalidatePreview() {
    state.previewToken += 1;
    state.preview = null;
    state.previewPending = false;
    const box = $("#bookCategoryMovePreview");
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    syncConfirm();
  }
  function fillSelect(select, rows, previous, placeholder) {
    if (!select) return;
    const current = previous == null ? select.value : previous;
    const blank = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
    select.innerHTML = blank + rows.map((row) => (
      `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`
    )).join("");
    if (current && rows.some((row) => String(row.id) === String(current))) select.value = String(current);
    else if (placeholder) select.value = "";
  }
  function rowById(id) {
    return state.rows.find((row) => String(row.id) === String(id));
  }
  function manageMarkup(row, renameValue, redirectValue) {
    const hidden = !!row.is_hidden;
    const universal = row.slug === "universal";
    const replacements = activeRows().filter((item) => !item.is_hidden && String(item.id) !== String(row.id));
    const options = [`<option value="">ئورنىغا قالىدىغان تۈرنى تاللاڭ</option>`].concat(replacements.map((item) => (
      `<option value="${escapeHtml(item.id)}"${String(item.id) === String(redirectValue) ? " selected" : ""}>${escapeHtml(item.label)}</option>`
    ))).join("");
    return `<div class="book-category-manage">
      <form id="bookCategoryRename" class="book-category-form">
        <label>يېڭى نامى<input id="bookCategoryRenameInput" maxlength="80" value="${escapeHtml(renameValue)}" autocomplete="off"></label>
        <button class="admin-primary" type="submit">نامىنى ساقلاش</button>
      </form>
      <div class="book-category-actions">
        <button type="button" class="admin-secondary" data-category-up="${escapeHtml(row.id)}" aria-label="ئالدىغا ${escapeHtml(row.label)}">ئالدىغا</button>
        <button type="button" class="admin-secondary" data-category-down="${escapeHtml(row.id)}" aria-label="كەينىگە ${escapeHtml(row.label)}">كەينىگە</button>
        <button type="button" class="admin-secondary" data-category-hide="${escapeHtml(row.id)}">${hidden ? "ئەسلىگە قايتۇرۇش" : "يوشۇرۇش"}</button>
        <button type="button" class="admin-secondary" data-category-transfer="${escapeHtml(row.id)}">كىتابلارنى يۆتكەش</button>
        ${universal ? "" : `<button type="button" class="admin-danger" data-category-retire="${escapeHtml(row.id)}">ئېلىۋېتىش</button>`}
      </div>
      ${universal ? `<p class="admin-help">ئۇنىۋېرسال تۈر ساقلىنىدۇ.</p>` : ""}
      <div id="bookCategoryRetire" ${state.retireOpen && !universal ? "" : "hidden"}>
        <p><strong>${escapeHtml(row.label)}</strong></p>
        <p>كىتاب ${escapeHtml(row.book_count)} · يۈرۈشلۈك ${escapeHtml(row.group_count)}</p>
        <p class="admin-help">كونا ئۇلىنىش تاللانغان تۈرگە يۆتكىلىدۇ. كىتابلار ئۆچمەيدۇ. بۇ تۈردە كىتاب ياكى يۈرۈشلۈك قالسا ئېلىۋېتىش رەت قىلىنىدۇ.</p>
        <label>ئورنىغا قالىدىغان تۈر<select id="bookCategoryRedirect">${options}</select></label>
        <div class="book-category-actions">
          <button type="button" class="admin-danger" data-category-retire-confirm="${escapeHtml(row.id)}">ئېلىۋېتىشنى جەزملەش</button>
          <button type="button" class="admin-secondary" data-category-retire-cancel>بىكار قىلىش</button>
        </div>
      </div>
    </div>`;
  }
  function render() {
    const host = $("#bookCategoryList");
    if (!host) return;
    const directory = root.KutadguBookCategories;
    if (directory && directory.setAdminRows) directory.setAdminRows(state.rows);
    const renameInput = $("#bookCategoryRenameInput");
    const renameValue = state.renameDirty && renameInput ? renameInput.value : "";
    const redirectValue = $("#bookCategoryRedirect") ? $("#bookCategoryRedirect").value : "";
    host.innerHTML = state.rows.map((row) => {
      const retired = !!row.retired;
      const hidden = !!row.is_hidden;
      const open = !retired && String(state.managingId) === String(row.id);
      const badge = retired ? "ئېلىۋېتىلگەن" : (hidden ? "يوشۇرۇن" : "ئوچۇق");
      const kind = retired ? "retired" : (hidden ? "hidden" : "open");
      const filled = open && state.renameDirty ? renameValue : row.label;
      return `<article class="book-category-row" data-category-id="${escapeHtml(row.id)}" data-category-source="${escapeHtml(row.source)}">
        <div class="book-category-summary">
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <p class="book-category-meta">كىتاب ${escapeHtml(row.book_count)} <span class="book-category-badge book-category-badge-${kind}">${badge}</span></p>
            ${retired ? `<p class="admin-help">كونا ئۇلىنىش ساقلىنىدۇ.</p>` : ""}
          </div>
          ${retired ? "" : `<button type="button" class="admin-secondary" data-category-manage="${escapeHtml(row.id)}" aria-expanded="${open ? "true" : "false"}" aria-label="باشقۇرۇش: ${escapeHtml(row.label)}">باشقۇرۇش</button>`}
        </div>
        ${open ? manageMarkup(row, filled, redirectValue) : ""}
      </article>`;
    }).join("");
    const sourceSelect = $("#bookCategoryMoveSource");
    const destination = $("#bookCategoryMoveDestination");
    const previousSource = sourceSelect ? sourceSelect.value : "";
    const previousDestination = destination ? destination.value : "";
    fillSelect(sourceSelect, activeRows(), previousSource, "مەنبە تۈرنى تاللاڭ");
    const sourceId = sourceSelect ? sourceSelect.value : "";
    fillSelect(
      destination,
      activeRows().filter((row) => !row.is_hidden && String(row.id) !== String(sourceId)),
      previousDestination,
      "نىشان تۈرنى تاللاڭ"
    );
    invalidatePreview();
  }
  async function load() {
    if (!state.db) return;
    const token = ++state.generation;
    status("تۈرلەر يۈكلىنىۋاتىدۇ…");
    try {
      const rows = await call("admin_list_book_categories");
      if (token !== state.generation) return;
      state.rows = Array.isArray(rows) ? rows : [];
      render();
      status(state.rows.length ? "" : "تۈر تېخى يوق.");
      if (root.KutadguBookCategories && typeof root.KutadguBookCategories.load === "function") {
        await root.KutadguBookCategories.load(state.db);
      }
    } catch (error) {
      if (token !== state.generation) return;
      status(errorText(error), "err");
    }
  }
  function attemptFor(name, args) {
    const key = name + ":" + JSON.stringify(args);
    if (!state.attempts[key]) state.attempts[key] = requestId();
    return { key, id: state.attempts[key] };
  }
  async function mutate(name, args) {
    if (state.busy) return null;
    state.busy = true;
    state.lastCode = "";
    syncConfirm();
    const attempt = attemptFor(name, args);
    try {
      await call(name, Object.assign({ p_request_id: attempt.id }, args));
      delete state.attempts[attempt.key];
      await load();
      return true;
    } catch (error) {
      if (!unresolved(error)) delete state.attempts[attempt.key];
      state.lastCode = unresolved(error) ? "" : rejectionCode(error);
      status(errorText(error), "err");
      return false;
    } finally {
      state.busy = false;
      syncConfirm();
    }
  }
  function openCreate() {
    const form = $("#bookCategoryCreate");
    if (!form) return;
    form.hidden = false;
    if (state.pendingCreate) {
      showPendingCreate();
      return;
    }
    lockCreateFields(false);
    lockCreateSubmission(false);
    const input = $("#bookCategoryLabel");
    if (input) input.focus();
  }
  function finishCreate() {
    state.pendingCreate = null;
    state.createDraft = null;
    lockCreateFields(false);
    lockCreateSubmission(false);
    const form = $("#bookCategoryCreate");
    if (!form) return;
    form.reset();
    form.hidden = true;
  }
  function createArgs() {
    const label = text($("#bookCategoryLabel") && $("#bookCategoryLabel").value);
    const summary = text($("#bookCategorySummary") && $("#bookCategorySummary").value);
    if (!label) return { message: "تۈر نامىنى كىرگۈزۈڭ." };
    if (label.length > 80) return { message: "تۈر نامى 80 ھەرپتىن ئېشىپ كەتمىسۇن." };
    if (summary.length > 240) return { message: "قىسقىچە 240 ھەرپتىن ئېشىپ كەتمىسۇن." };
    const draft = rememberDraft(label, summary);
    return {
      args: {
        p_label: draft.label,
        p_slug: draft.slug,
        p_summary: draft.summary,
        p_icon: "📚"
      }
    };
  }
  async function createCategory(event) {
    event.preventDefault();
    if (state.busy) return;
    if (!state.pendingCreate) {
      const prepared = createArgs();
      if (prepared.message) {
        status(prepared.message, "err");
        return;
      }
      const attempt = attemptFor("admin_create_book_category", prepared.args);
      state.pendingCreate = { args: prepared.args, id: attempt.id };
    }
    showPendingCreate();
    lockCreateSubmission(true);
    const ok = await mutate("admin_create_book_category", state.pendingCreate.args);
    if (ok == null) return;
    if (ok) {
      finishCreate();
      return;
    }
    if (!state.lastCode) {
      showPendingCreate();
      status("تۈر مەشغۇلاتى تاماملانمىدى. ئوخشاش ئۇچۇر قايتا ئەۋەتىلىدۇ.", "err");
      return;
    }
    state.pendingCreate = null;
    lockCreateFields(false);
    lockCreateSubmission(false);
    if (state.lastCode === "slug_in_use" && state.createDraft) {
      const used = state.rows.concat([{ slug: state.createDraft.slug }]);
      state.createDraft.slug = slugFor(state.createDraft.label, used);
    }
  }
  async function renameCategory(event) {
    event.preventDefault();
    const input = $("#bookCategoryRenameInput");
    const row = rowById(state.managingId);
    const label = text(input && input.value);
    if (!row || !label) {
      status("تۈر نامىنى كىرگۈزۈڭ.", "err");
      return;
    }
    if (label.length > 80) {
      status("تۈر نامى 80 ھەرپتىن ئېشىپ كەتمىسۇن.", "err");
      return;
    }
    const ok = await mutate("admin_rename_book_category", {
      p_id: Number(row.id),
      p_expected_revision: Number(row.revision),
      p_label: label
    });
    if (ok) state.renameDirty = false;
  }
  function selectedIds() {
    return Array.from(root.document.querySelectorAll("[data-universal-book]:checked")).map((box) => Number(box.value));
  }
  function sourceById(id) {
    return activeRows().find((row) => String(row.id) === String(id));
  }
  function abandonSourceBooks() {
    state.bookLoad += 1;
    const host = $("#bookCategoryUniversal");
    if (host) host.innerHTML = "";
  }
  async function loadSourceBooks(source) {
    const host = $("#bookCategoryUniversal");
    if (!host || !state.db) return;
    const token = ++state.bookLoad;
    invalidatePreview();
    host.innerHTML = "<p>كىتابلار يۈكلىنىۋاتىدۇ…</p>";
    const pageSize = 200;
    const rows = [];
    try {
      for (let from = 0; ; from += pageSize) {
        let query = state.db.from("books").select("id,title,source,category,is_active,submission_status").eq("source", source).order("id");
        if (query.range) query = query.range(from, from + pageSize - 1);
        const result = await query;
        if (token !== state.bookLoad) return;
        if (!result || result.error) {
          host.innerHTML = `<p>كىتاب تىزىمى يۈكلەنمىدى.</p><button type="button" class="admin-secondary" data-category-retry-source="${escapeHtml(source)}">قايتا سىناش</button>`;
          status("كىتاب تىزىمى يۈكلەنمىدى. قايتا سىناڭ.", "err");
          return;
        }
        const batch = Array.isArray(result.data) ? result.data : [];
        rows.push.apply(rows, batch);
        if (!query.range || batch.length < pageSize) break;
      }
    } catch (error) {
      if (token !== state.bookLoad) return;
      host.innerHTML = `<p>كىتاب تىزىمى يۈكلەنمىدى.</p><button type="button" class="admin-secondary" data-category-retry-source="${escapeHtml(source)}">قايتا سىناش</button>`;
      status("كىتاب تىزىمى يۈكلەنمىدى. قايتا سىناڭ.", "err");
      return;
    }
    if (token !== state.bookLoad) return;
    host.innerHTML = rows.length ? rows.map((book) => (
      `<label class="book-category-book"><input type="checkbox" data-universal-book value="${escapeHtml(book.id)}"><span class="book-category-book-title">${escapeHtml(book.title)}</span><span class="book-category-book-meta">#${escapeHtml(book.id)}${book.is_active === false ? " · يوشۇرۇن" : ""}${book.submission_status && book.submission_status !== "approved" ? " · " + escapeHtml(book.submission_status) : ""}</span></label>`
    )).join("") : "<p>بۇ تۈردە كىتاب يوق.</p>";
    status("");
  }
  function refreshDestinations() {
    const sourceSelect = $("#bookCategoryMoveSource");
    const destination = $("#bookCategoryMoveDestination");
    const previous = destination ? destination.value : "";
    const sourceId = sourceSelect ? sourceSelect.value : "";
    fillSelect(
      destination,
      activeRows().filter((row) => !row.is_hidden && String(row.id) !== String(sourceId)),
      previous,
      "نىشان تۈرنى تاللاڭ"
    );
  }
  function openTransfer(row) {
    const panel = $("#bookCategoryMovePanel");
    const select = $("#bookCategoryMoveSource");
    if (!panel || !select || !row) return;
    panel.hidden = false;
    select.value = String(row.id);
    refreshDestinations();
    if ($("#bookCategoryMoveDestination")) $("#bookCategoryMoveDestination").value = "";
    invalidatePreview();
    return loadSourceBooks(row.source);
  }
  function previewMarkup(preview) {
    const origins = Array.isArray(preview.origins) ? preview.origins : [];
    const originText = origins.map((row) => `${row.label} (${row.book_count})`).join("، ");
    const added = Array.isArray(preview.added_books) ? preview.added_books : [];
    const groups = Array.isArray(preview.groups) ? preview.groups : [];
    const addedText = added.map((book) => `${book.title} — ${book.category}`).join("، ");
    const groupText = groups.map((group) => `${group.title} — ${group.category}`).join("، ");
    return `<p>مەنبە: ${escapeHtml(originText || (preview.source && preview.source.label) || "")}. نىشان: ${escapeHtml(preview.destination.label)}.</p>` +
      `<p>تاللانغان كىتاب: ${escapeHtml(preview.selected_book_count)}. قوشۇلغان كىتاب: ${escapeHtml(preview.added_book_count || 0)}. جەمئىي كىتاب: ${escapeHtml(preview.book_count)}. يۈرۈشلۈك: ${escapeHtml(preview.group_count)}.</p>` +
      (addedText ? `<p>قوشۇمچە كىتاب: ${escapeHtml(addedText)}.</p>` : "") +
      (groupText ? `<p>يۈرۈشلۈك ئەسلى تۈرى: ${escapeHtml(groupText)}.</p>` : "");
  }
  async function previewMove() {
    if (state.busy || state.previewPending) return;
    const ids = selectedIds();
    const destination = Number($("#bookCategoryMoveDestination") && $("#bookCategoryMoveDestination").value);
    if (!ids.length) {
      status("كىتاب تاللاڭ.", "err");
      return;
    }
    if (!destination) {
      status("نىشان تۈرنى تاللاڭ.", "err");
      return;
    }
    const token = ++state.previewToken;
    state.preview = null;
    state.previewPending = true;
    syncConfirm();
    try {
      const preview = await call("admin_preview_book_category_move", {
        p_book_ids: ids,
        p_destination_id: destination
      });
      if (token !== state.previewToken) return;
      if (Number($("#bookCategoryMoveDestination").value) !== destination || selectedIds().join(",") !== ids.join(",")) return;
      state.preview = Object.assign({}, preview, {
        requestSelection: ids.slice(),
        requestDestination: destination
      });
      const box = $("#bookCategoryMovePreview");
      if (box) {
        box.hidden = false;
        box.innerHTML = previewMarkup(state.preview);
      }
      status("");
    } catch (error) {
      if (token !== state.previewToken) return;
      state.preview = null;
      status(errorText(error), "err");
    } finally {
      if (token === state.previewToken) state.previewPending = false;
      syncConfirm();
    }
  }
  async function confirmMove() {
    if (state.busy || state.previewPending || !state.preview) {
      status("ئالدى تەسىرگە ئۇچرايدىغانلىرىنى كۆرۈڭ.", "err");
      return;
    }
    const destination = Number($("#bookCategoryMoveDestination").value);
    if (destination !== Number(state.preview.requestDestination) || selectedIds().join(",") !== state.preview.requestSelection.join(",")) {
      invalidatePreview();
      status("تاللاش ئۆزگەردى. تەسىرگە ئۇچرايدىغانلىرىنى قايتا كۆرۈڭ.", "err");
      return;
    }
    const frozen = state.preview;
    const ok = await mutate("admin_move_books_to_category", {
      p_book_ids: frozen.requestSelection.slice(),
      p_destination_id: frozen.requestDestination,
      p_expected_book_ids: (frozen.book_ids || []).map(Number)
    });
    if (ok) {
      state.preview = null;
      const box = $("#bookCategoryMovePreview");
      if (box) box.hidden = true;
      const source = sourceById($("#bookCategoryMoveSource") && $("#bookCategoryMoveSource").value);
      if (source) await loadSourceBooks(source.source);
    }
  }
  async function confirmRetire(id) {
    const row = rowById(id);
    const redirect = $("#bookCategoryRedirect");
    if (!row || !redirect || !redirect.value) {
      status("ئورنىغا قالىدىغان تۈرنى تاللاڭ.", "err");
      return;
    }
    await mutate("admin_retire_book_category", {
      p_id: Number(row.id),
      p_expected_revision: Number(row.revision),
      p_redirect_id: Number(redirect.value)
    });
  }
  async function onClick(event) {
    const button = event.target.closest("button");
    if (!button || !$("#bookCategoryManager") || !$("#bookCategoryManager").contains(button)) return;
    if (button.id === "bookCategoryAdd") {
      openCreate();
      return;
    }
    if (button.id === "bookCategoryCreateCancel") {
      const form = $("#bookCategoryCreate");
      if (form) form.hidden = true;
      return;
    }
    if (button.id === "bookCategoryMoveClose") {
      const panel = $("#bookCategoryMovePanel");
      if (panel) panel.hidden = true;
      abandonSourceBooks();
      invalidatePreview();
      return;
    }
    if (button.disabled || state.busy) return;
    const manage = button.getAttribute("data-category-manage");
    const up = button.getAttribute("data-category-up");
    const down = button.getAttribute("data-category-down");
    const hide = button.getAttribute("data-category-hide");
    const transfer = button.getAttribute("data-category-transfer");
    const retire = button.getAttribute("data-category-retire");
    const retireConfirm = button.getAttribute("data-category-retire-confirm");
    if (button.hasAttribute("data-category-retire-cancel")) {
      state.retireOpen = false;
      render();
      return;
    }
    if (manage) {
      const same = String(state.managingId) === String(manage);
      state.managingId = same ? null : manage;
      state.renameDirty = false;
      state.retireOpen = false;
      render();
      if (!same) {
        const input = $("#bookCategoryRenameInput");
        if (input) input.focus();
      }
      return;
    }
    if (up || down) {
      const row = rowById(up || down);
      await mutate("admin_move_book_category_order", {
        p_id: Number(row.id),
        p_expected_revision: Number(row.revision),
        p_direction: up ? "up" : "down"
      });
      return;
    }
    if (hide) {
      const row = rowById(hide);
      await mutate("admin_set_book_category_hidden", {
        p_id: Number(row.id),
        p_expected_revision: Number(row.revision),
        p_hidden: !row.is_hidden
      });
      return;
    }
    if (transfer) {
      await openTransfer(rowById(transfer));
      return;
    }
    if (retire) {
      state.managingId = retire;
      state.retireOpen = true;
      render();
      const select = $("#bookCategoryRedirect");
      if (select) select.focus();
      return;
    }
    if (retireConfirm) await confirmRetire(retireConfirm);
  }
  function bind() {
    const manager = $("#bookCategoryManager");
    if (!manager || manager.dataset.bound === "1") return;
    manager.dataset.bound = "1";
    manager.addEventListener("click", onClick);
    manager.addEventListener("submit", (event) => {
      if (event.target && event.target.id === "bookCategoryCreate") createCategory(event);
      if (event.target && event.target.id === "bookCategoryRename") renameCategory(event);
    });
    manager.addEventListener("input", (event) => {
      if (event.target && event.target.id === "bookCategoryRenameInput") state.renameDirty = true;
    });
    manager.addEventListener("change", (event) => {
      const target = event.target;
      if (!target) return;
      if (target.id === "bookCategoryMoveDestination" || target.hasAttribute("data-universal-book")) {
        invalidatePreview();
      }
      if (target.id === "bookCategoryMoveSource") {
        refreshDestinations();
        if ($("#bookCategoryMoveDestination")) $("#bookCategoryMoveDestination").value = "";
        invalidatePreview();
        const row = sourceById(target.value);
        if (row) loadSourceBooks(row.source);
        else abandonSourceBooks();
      }
    });
    $("#bookCategoryPreviewMove")?.addEventListener("click", previewMove);
    $("#bookCategoryConfirmMove")?.addEventListener("click", confirmMove);
    $("#bookCategoryUniversal")?.addEventListener("click", (event) => {
      const retry = event.target.closest("[data-category-retry-source]");
      if (!retry) return;
      loadSourceBooks(retry.getAttribute("data-category-retry-source"));
    });
  }
  function init(db) {
    state.db = db || state.db;
    bind();
    syncConfirm();
  }
  root.KutadguAdminBookCategories = { init, load, mutate, state, slugFor, rememberDraft };
})(window);
