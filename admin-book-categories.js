(function (root) {
  "use strict";

  const $ = (selector) => root.document.querySelector(selector);
  const state = { db: null, rows: [], preview: null, generation: 0, busy: false };

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
    if (/not_universal/.test(blob)) return "پەقەت ئۇنىۋېرسال تۈردىكى تاللانغان كىتابلار يۆتكىلىدۇ.";
    if (/category_retired|universal_required|invalid_redirect|redirect_target/.test(blob)) return "بۇ تۈرنى بۇ ئۇسۇلدا ئېلىۋېتكىلى بولمايدۇ.";
    if (/Admin AAL2 required|42501/.test(blob)) return "باشقۇرغۇچى جەزملەش تېخى تاماملانمىغان.";
    return "تۈر مەشغۇلاتى تاماملانمىدى.";
  }
  async function call(name, args) {
    const result = await state.db.rpc(name, args);
    if (result && result.error) throw result.error;
    return result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  }
  function activeRows() {
    return state.rows.filter((row) => !row.retired);
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
    const destination = $("#bookCategoryMoveDestination");
    const redirect = $("#bookCategoryRedirect");
    const options = activeRows().filter((row) => !row.is_hidden && row.slug !== "universal").map((row) => (
      `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`
    )).join("");
    if (destination) destination.innerHTML = options;
    if (redirect) {
      redirect.innerHTML = activeRows().filter((row) => !row.is_hidden).map((row) => (
        `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`
      )).join("");
    }
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
      if (root.KutadguBookCategories) await root.KutadguBookCategories.load(state.db);
    } catch (error) {
      if (token !== state.generation) return;
      status(errorText(error), "err");
    }
  }
  async function mutate(name, args) {
    if (state.busy) return;
    state.busy = true;
    try {
      await call(name, Object.assign({ p_request_id: requestId() }, args));
      await load();
    } catch (error) {
      status(errorText(error), "err");
    } finally {
      state.busy = false;
    }
  }
  function rowById(id) {
    return state.rows.find((row) => String(row.id) === String(id));
  }
  async function onClick(event) {
    const button = event.target.closest("button");
    if (!button || !$("#bookCategoryManager") || !$("#bookCategoryManager").contains(button)) return;
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
  async function loadUniversal() {
    const host = $("#bookCategoryUniversal");
    if (!host || !state.db) return;
    const result = await state.db.from("books").select("id,title,source,is_active,submission_status").eq("source", "universal.html");
    const rows = result && result.data ? result.data : [];
    host.innerHTML = rows.map((book) => (
      `<label class="book-category-book"><input type="checkbox" data-universal-book value="${escapeHtml(book.id)}"> ${escapeHtml(book.title)} <span>#${escapeHtml(book.id)}</span></label>`
    )).join("") || "<p>ئۇنىۋېرسال تۈردە كىتاب يوق.</p>";
  }
  async function previewMove() {
    const ids = selectedIds();
    const destination = Number($("#bookCategoryMoveDestination").value);
    try {
      state.preview = await call("admin_preview_book_category_move", {
        p_book_ids: ids,
        p_destination_id: destination
      });
      const box = $("#bookCategoryMovePreview");
      if (box) {
        box.hidden = false;
        box.innerHTML = `<p>مەنبە: ${escapeHtml(state.preview.source.label)}. نىشان: ${escapeHtml(state.preview.destination.label)}.</p>` +
          `<p>تاللانغان كىتاب: ${escapeHtml(state.preview.selected_book_count)}. جەمئىي كىتاب: ${escapeHtml(state.preview.book_count)}. يۈرۈشلۈك: ${escapeHtml(state.preview.group_count)}.</p>`;
      }
      status("");
    } catch (error) {
      state.preview = null;
      status(errorText(error), "err");
    }
  }
  async function confirmMove() {
    if (!state.preview) {
      status("ئالدى بىلەن ئالدىن كۆرۈشنى ئېچىڭ.", "err");
      return;
    }
    const ids = (state.preview.book_ids || []).map(Number);
    await mutate("admin_move_books_to_category", {
      p_book_ids: selectedIds(),
      p_destination_id: Number(state.preview.destination.id),
      p_expected_book_ids: ids
    });
    state.preview = null;
    const box = $("#bookCategoryMovePreview");
    if (box) box.hidden = true;
  }
  function bind() {
    const manager = $("#bookCategoryManager");
    if (!manager || manager.dataset.bound === "1") return;
    manager.dataset.bound = "1";
    manager.addEventListener("click", onClick);
    $("#bookCategoryCreate")?.addEventListener("submit", createCategory);
    $("#bookCategoryRename")?.addEventListener("submit", renameCategory);
    $("#bookCategoryLoadUniversal")?.addEventListener("click", loadUniversal);
    $("#bookCategoryPreviewMove")?.addEventListener("click", previewMove);
    $("#bookCategoryConfirmMove")?.addEventListener("click", confirmMove);
  }
  function init(db) {
    state.db = db || state.db;
    bind();
  }
  root.KutadguAdminBookCategories = { init, load, state };
})(window);
