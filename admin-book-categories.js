(function (root) {
  "use strict";

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
    attempts: {}
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
  }
  function errorText(error) {
    const blob = String(error && (error.message || error.details || error) || "");
    if (/category_not_empty/.test(blob)) return "بۇ تۈردە يەنىلا كىتاب ياكى يۈرۈشلۈك بار. ئالدى بىلەن يۆتكەڭ.";
    if (/slug_in_use/.test(blob)) return "بۇ ئادرېس ئىشلىتىلىپ بولغان. ئىستېمال قىلىنغان ئادرېس قايتا ئىشلىتىلمەيدۇ.";
    if (/category_revision_conflict|category_move_changed/.test(blob)) return "تۈر ئۆزگەرتىلدى. تىزىمنى يېڭىلاپ قايتا جەزملەڭ.";
    if (/books_missing/.test(blob)) return "تاللانغان كىتاب تېپىلمىدى. تىزىمنى يېڭىلاپ قايتا تاللاڭ.";
    if (/not_universal/.test(blob)) return "پەقەت ئۇنىۋېرسال تۈردىكى تاللانغان كىتابلار يۆتكىلىدۇ.";
    if (/category_retired|universal_required|invalid_redirect|redirect_target|destination_unavailable/.test(blob)) return "بۇ تۈرنى بۇ ئۇسۇلدا ئېلىۋېتكىلى ياكى نىشان قىلغىلى بولمايدۇ.";
    if (/Admin AAL2 required|42501/.test(blob)) return "باشقۇرغۇچى جەزملەش تېخى تاماملانمىغان.";
    return "تۈر مەشغۇلاتى تاماملانمىدى.";
  }
  function unresolved(error) {
    return !!(error && error.unresolved);
  }
  async function call(name, args) {
    let result;
    try {
      result = await state.db.rpc(name, args);
    } catch (error) {
      error.unresolved = true;
      throw error;
    }
    if (result && result.error) throw result.error;
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
  function fillSelect(select, rows, previous) {
    if (!select) return;
    const current = previous == null ? select.value : previous;
    select.innerHTML = rows.map((row) => (
      `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}${row.is_hidden ? " (يوشۇرۇن)" : ""}</option>`
    )).join("");
    if (current && rows.some((row) => String(row.id) === String(current))) select.value = String(current);
  }
  function render() {
    const host = $("#bookCategoryList");
    if (!host) return;
    const directory = root.KutadguBookCategories;
    if (directory) directory.setAdminRows(state.rows);
    host.innerHTML = state.rows.map((row) => {
      const retired = !!row.retired;
      const hidden = !!row.is_hidden;
      const badge = retired ? "ئادرېسى ساقلىنىدۇ" : (hidden ? "يوشۇرۇن" : "ئوچۇق");
      return `<article class="book-category-row" data-category-id="${escapeHtml(row.id)}" data-category-source="${escapeHtml(row.source)}">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <p>/${escapeHtml(row.slug)} · كىتاب ${escapeHtml(row.book_count)} · يۈرۈشلۈك ${escapeHtml(row.group_count)} · ${badge}</p>
        </div>
        <div class="book-category-actions">
          <button type="button" data-category-up="${escapeHtml(row.id)}" ${retired ? "disabled" : ""} aria-label="ئالدىغا ${escapeHtml(row.label)}">ئالدىغا</button>
          <button type="button" data-category-down="${escapeHtml(row.id)}" ${retired ? "disabled" : ""} aria-label="كەينىگە ${escapeHtml(row.label)}">كەينىگە</button>
          <button type="button" data-category-hide="${escapeHtml(row.id)}" ${retired ? "disabled" : ""}>${hidden ? "ئەسلىگە قايتۇرۇش" : "يوشۇرۇش"}</button>
          <button type="button" data-category-rename="${escapeHtml(row.id)}" ${retired ? "disabled" : ""}>نامىنى ئۆزگەرتىش</button>
          <button type="button" data-category-retire="${escapeHtml(row.id)}" ${retired || row.slug === "universal" ? "disabled" : ""}>ئېلىۋېتىش</button>
        </div>
      </article>`;
    }).join("");
    const sourceSelect = $("#bookCategoryMoveSource");
    const destination = $("#bookCategoryMoveDestination");
    const redirect = $("#bookCategoryRedirect");
    const previousSource = sourceSelect ? sourceSelect.value : "";
    fillSelect(sourceSelect, activeRows(), previousSource);
    if (sourceSelect && !sourceSelect.value) {
      const universal = activeRows().find((row) => row.slug === "universal");
      if (universal) sourceSelect.value = String(universal.id);
    }
    fillSelect(destination, activeRows().filter((row) => !row.is_hidden));
    fillSelect(redirect, activeRows().filter((row) => !row.is_hidden));
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
    if (state.busy) return false;
    state.busy = true;
    syncConfirm();
    const attempt = attemptFor(name, args);
    try {
      await call(name, Object.assign({ p_request_id: attempt.id }, args));
      delete state.attempts[attempt.key];
      await load();
      return true;
    } catch (error) {
      if (!unresolved(error)) delete state.attempts[attempt.key];
      status(errorText(error), "err");
      return false;
    } finally {
      state.busy = false;
      syncConfirm();
    }
  }
  function rowById(id) {
    return state.rows.find((row) => String(row.id) === String(id));
  }
  async function onClick(event) {
    const button = event.target.closest("button");
    if (!button || !$("#bookCategoryManager") || !$("#bookCategoryManager").contains(button)) return;
    if (button.disabled || state.busy) return;
    const up = button.getAttribute("data-category-up");
    const down = button.getAttribute("data-category-down");
    const hide = button.getAttribute("data-category-hide");
    const rename = button.getAttribute("data-category-rename");
    const retire = button.getAttribute("data-category-retire");
    if (up || down) {
      const row = rowById(up || down);
      await mutate("admin_move_book_category_order", {
        p_id: Number(row.id),
        p_expected_revision: Number(row.revision),
        p_direction: up ? "up" : "down"
      });
    }
    if (hide) {
      const row = rowById(hide);
      await mutate("admin_set_book_category_hidden", {
        p_id: Number(row.id),
        p_expected_revision: Number(row.revision),
        p_hidden: !row.is_hidden
      });
    }
    if (rename) {
      const row = rowById(rename);
      const input = $("#bookCategoryRenameInput");
      if (input) {
        input.value = row.label;
        input.dataset.categoryId = String(row.id);
        input.dataset.revision = String(row.revision);
        input.focus();
      }
    }
    if (retire) {
      const row = rowById(retire);
      const redirect = $("#bookCategoryRedirect");
      if (!redirect || !redirect.value) {
        status("ئېلىۋېتىشتىن بۇرۇن يېڭى ئادرېسنى تاللاڭ.", "err");
        return;
      }
      await mutate("admin_retire_book_category", {
        p_id: Number(row.id),
        p_expected_revision: Number(row.revision),
        p_redirect_id: Number(redirect.value)
      });
    }
  }
  async function createCategory(event) {
    event.preventDefault();
    await mutate("admin_create_book_category", {
      p_label: text($("#bookCategoryLabel").value),
      p_slug: text($("#bookCategorySlug").value).toLowerCase(),
      p_summary: text($("#bookCategorySummary").value),
      p_icon: "📚"
    });
  }
  async function renameCategory(event) {
    event.preventDefault();
    const input = $("#bookCategoryRenameInput");
    await mutate("admin_rename_book_category", {
      p_id: Number(input.dataset.categoryId),
      p_expected_revision: Number(input.dataset.revision),
      p_label: text(input.value)
    });
  }
  function selectedIds() {
    return Array.from(root.document.querySelectorAll("[data-universal-book]:checked")).map((box) => Number(box.value));
  }
  function sourceById(id) {
    return activeRows().find((row) => String(row.id) === String(id));
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
      `<label class="book-category-book"><input type="checkbox" data-universal-book value="${escapeHtml(book.id)}"> ${escapeHtml(book.title)} <span>#${escapeHtml(book.id)} · ${escapeHtml(book.category || book.source)}${book.is_active === false ? " · يوشۇرۇن" : ""}${book.submission_status && book.submission_status !== "approved" ? " · " + escapeHtml(book.submission_status) : ""}</span></label>`
    )).join("") : "<p>بۇ تۈردە كىتاب يوق.</p>";
    status("");
  }
  function loadSelectedSource() {
    const row = sourceById($("#bookCategoryMoveSource") && $("#bookCategoryMoveSource").value);
    if (!row) {
      status("مەنبە تۈرنى تاللاڭ.", "err");
      return;
    }
    return loadSourceBooks(row.source);
  }
  function loadUniversal() {
    const universal = activeRows().find((row) => row.slug === "universal");
    const select = $("#bookCategoryMoveSource");
    if (universal && select) select.value = String(universal.id);
    return loadSourceBooks("universal.html");
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
    const destination = Number($("#bookCategoryMoveDestination").value);
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
      status("ئالدى بىلەن ئالدىن كۆرۈشنى ئېچىڭ.", "err");
      return;
    }
    const destination = Number($("#bookCategoryMoveDestination").value);
    if (destination !== Number(state.preview.requestDestination) || selectedIds().join(",") !== state.preview.requestSelection.join(",")) {
      invalidatePreview();
      status("تاللاش ئۆزگەردى. ئالدىن كۆرۈشنى قايتا ئېچىڭ.", "err");
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
  function bind() {
    const manager = $("#bookCategoryManager");
    if (!manager || manager.dataset.bound === "1") return;
    manager.dataset.bound = "1";
    manager.addEventListener("click", onClick);
    manager.addEventListener("change", (event) => {
      const target = event.target;
      if (!target) return;
      if (target.id === "bookCategoryMoveDestination" || target.id === "bookCategoryMoveSource" || target.hasAttribute("data-universal-book")) {
        invalidatePreview();
      }
    });
    $("#bookCategoryCreate")?.addEventListener("submit", createCategory);
    $("#bookCategoryRename")?.addEventListener("submit", renameCategory);
    $("#bookCategoryLoadSource")?.addEventListener("click", loadSelectedSource);
    $("#bookCategoryLoadUniversal")?.addEventListener("click", loadUniversal);
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
  root.KutadguAdminBookCategories = { init, load, state };
})(window);
