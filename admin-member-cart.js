(function () {
  const PAGE_SIZE = 100;
  const RPC = "admin_member_cart_page";
  const EMPTY_MESSAGE = "سېۋەتتە كىتاب يوق.";
  const FAIL_MESSAGE = "سېۋەتنى ئوقۇش مەغلۇپ بولدى.";
  const REFRESH_FAIL_MESSAGE = "يېڭىلاش مەغلۇپ بولدى.";
  const RETAINED_MESSAGE = "ئالدىنقى كۆرۈنۈش ساقلىنىۋاتىدۇ.";
  const LOADING_MESSAGE = "سېۋەت يۈكلىنىۋاتىدۇ...";
  const MISSING_TITLE = "كىتاب ئۇچۇرى يوق";
  const AAL2_MESSAGE = "بۇ مەشغۇلات ئۈچۈن 2-باسقۇچلۇق دەلىللەش (AAL2) كېرەك. قايتا كىرىپ قايتا سىناڭ.";
  const state = { generation: 0, member: null, snapshot: null };

  function jwtAal(token) {
    try {
      const part = String(token || "").split(".")[1] || "";
      if (!part) return "";
      const padded = part.replace(/-/g, "+").replace(/_/g, "/");
      const json = JSON.parse(atob(padded));
      return String(json && json.aal || "");
    } catch (error) {
      return "";
    }
  }

  function client() {
    if (window.__kutadguMemberCartAdminClient) return window.__kutadguMemberCartAdminClient;
    return window.__kutadguAdminDb || null;
  }

  function modal() {
    return document.querySelector("#memberCartPanel");
  }

  function body() {
    return document.querySelector("#memberCartBody");
  }

  function identityNode() {
    return document.querySelector("#memberCartIdentity");
  }

  function surfaceOpen(memberId) {
    const dialog = modal();
    const dash = document.querySelector("#dashboardPanel");
    const lock = document.querySelector("#idleLockPanel");
    if (!dialog || dialog.hidden) return false;
    if (!state.member || state.member.id !== memberId) return false;
    if (!dash || dash.hidden) return false;
    if (lock && !lock.hidden) return false;
    return true;
  }

  function clearPrivate() {
    state.generation += 1;
    state.member = null;
    state.snapshot = null;
    const dialog = modal();
    if (dialog) dialog.hidden = true;
    const who = identityNode();
    if (who) who.textContent = "";
    const host = body();
    if (host) {
      host.dataset.memberCartState = "";
      host.replaceChildren();
    }
  }

  function showLoading() {
    const host = body();
    if (!host) return;
    host.dataset.memberCartState = "loading";
    host.replaceChildren();
    const line = document.createElement("p");
    line.className = "admin-help";
    line.textContent = LOADING_MESSAGE;
    host.appendChild(line);
  }

  function rowView(row) {
    const item = document.createElement("div");
    item.className = "admin-analytics-row";
    const title = document.createElement("span");
    const raw = row && row.title != null ? String(row.title).trim() : "";
    title.textContent = raw || MISSING_TITLE;
    const qty = document.createElement("strong");
    qty.textContent = "سانى: " + String(row && row.quantity != null ? row.quantity : "");
    item.append(title, qty);
    return item;
  }

  function showFailure(message, retained) {
    const host = body();
    if (!host) return;
    host.dataset.memberCartState = "error";
    host.replaceChildren();
    const line = document.createElement("p");
    line.className = "admin-help";
    line.textContent = message;
    host.appendChild(line);
    if (retained && retained.length) {
      const kept = document.createElement("p");
      kept.className = "admin-help";
      kept.textContent = RETAINED_MESSAGE;
      host.appendChild(kept);
      retained.forEach((row) => host.appendChild(rowView(row)));
    }
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "admin-secondary";
    retry.dataset.memberCartRetry = "1";
    retry.textContent = "قايتا سىناش";
    retry.addEventListener("click", () => { load(); });
    host.appendChild(retry);
  }

  function showRows(rows) {
    const host = body();
    if (!host) return;
    host.replaceChildren();
    if (!rows.length) {
      host.dataset.memberCartState = "empty";
      const empty = document.createElement("p");
      empty.className = "admin-help";
      empty.textContent = EMPTY_MESSAGE;
      host.appendChild(empty);
      return;
    }
    host.dataset.memberCartState = "ready";
    rows.forEach((row) => host.appendChild(rowView(row)));
  }

  async function readAuth(db) {
    if (!db || !db.auth || typeof db.auth.getSession !== "function") return null;
    let result;
    try {
      result = await db.auth.getSession();
    } catch (error) {
      return null;
    }
    if (!result || result.error || !result.data || !result.data.session) return null;
    const session = result.data.session;
    const adminId = session.user && session.user.id ? String(session.user.id) : "";
    const aal = jwtAal(session.access_token);
    if (!adminId || aal !== "aal2") return { denied: true, adminId: adminId, aal: aal };
    return { ok: true, adminId: adminId, aal: aal };
  }

  async function readPages(db, captured) {
    const rows = [];
    let after = null;
    for (;;) {
      if (captured.generation !== state.generation || !surfaceOpen(captured.memberId)) return { stale: true };
      let result;
      try {
        result = await db.rpc(RPC, { p_user_id: captured.memberId, p_after_book_id: after });
      } catch (error) {
        return { error: error || { message: "read failed" } };
      }
      if (captured.generation !== state.generation || !surfaceOpen(captured.memberId)) return { stale: true };
      if (!result || result.error || !Array.isArray(result.data)) {
        return { error: (result && result.error) || { message: "read failed" } };
      }
      rows.push.apply(rows, result.data);
      if (result.data.length < PAGE_SIZE) return { rows: rows };
      const last = result.data[result.data.length - 1];
      const next = last && last.book_id != null ? String(last.book_id) : "";
      if (!next || next === after) return { error: { message: "cart page did not advance" } };
      after = next;
    }
  }

  async function load() {
    const memberId = state.member && state.member.id;
    const generation = ++state.generation;
    if (!memberId || !surfaceOpen(memberId)) return;
    showLoading();
    const db = client();
    const before = await readAuth(db);
    if (generation !== state.generation || !surfaceOpen(memberId)) return;
    if (!before) {
      clearPrivate();
      return;
    }
    if (before.denied) {
      state.snapshot = null;
      showFailure(AAL2_MESSAGE, null);
      return;
    }
    if (!db || typeof db.rpc !== "function") {
      showFailure(FAIL_MESSAGE, null);
      return;
    }
    const captured = { generation: generation, memberId: memberId, adminId: before.adminId, aal: before.aal };
    const result = await readPages(db, captured);
    if (captured.generation !== state.generation || !surfaceOpen(memberId)) return;
    const after = await readAuth(db);
    if (captured.generation !== state.generation || !surfaceOpen(memberId)) return;
    if (!after) {
      clearPrivate();
      return;
    }
    if (after.denied || after.adminId !== captured.adminId || after.aal !== "aal2") {
      state.snapshot = null;
      showFailure(AAL2_MESSAGE, null);
      return;
    }
    if (result.stale) return;
    if (result.error) {
      const retained = state.snapshot && state.snapshot.userId === memberId ? state.snapshot.rows : null;
      showFailure(retained && retained.length ? REFRESH_FAIL_MESSAGE : FAIL_MESSAGE, retained);
      return;
    }
    state.snapshot = { userId: memberId, rows: result.rows };
    if (generation !== state.generation || !surfaceOpen(memberId)) return;
    showRows(result.rows);
  }

  function openFrom(button) {
    const row = button.closest(".admin-member-row");
    const id = button.getAttribute("data-member-cart") || "";
    if (!id || !row) return;
    const name = row.querySelector(".admin-member-name");
    const email = row.querySelector(".admin-member-email");
    const contact = row.querySelector(".admin-member-contact");
    if (!state.snapshot || state.snapshot.userId !== id) state.snapshot = null;
    state.member = {
      id: id,
      name: name ? name.textContent : "",
      email: email ? email.textContent : "",
      contact: contact ? contact.textContent : ""
    };
    const dialog = modal();
    if (dialog) dialog.hidden = false;
    const who = identityNode();
    if (who) who.textContent = [state.member.name, state.member.email, state.member.contact].filter(Boolean).join(" · ");
    const host = body();
    if (host) host.replaceChildren();
    load();
  }

  function bind() {
    if (document.body && document.body.dataset.memberCartBound === "1") return;
    if (document.body) document.body.dataset.memberCartBound = "1";
    document.addEventListener("click", (event) => {
      const raw = event.target;
      const target = raw && raw.nodeType === 1 ? raw : (raw && raw.parentElement);
      if (!target || !target.closest) return;
      const opener = target.closest("[data-member-cart]");
      if (opener) {
        event.preventDefault();
        openFrom(opener);
        return;
      }
      if (target.closest("#closeMemberCart")) clearPrivate();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const dialog = modal();
      if (!dialog || dialog.hidden) return;
      event.preventDefault();
      clearPrivate();
    });
    const logout = document.querySelector("#adminLogout");
    if (logout) logout.addEventListener("click", clearPrivate);
    const dash = document.querySelector("#dashboardPanel");
    const lock = document.querySelector("#idleLockPanel");
    if (typeof MutationObserver === "function") {
      const observer = new MutationObserver(() => {
        if ((dash && dash.hidden) || (lock && !lock.hidden)) clearPrivate();
      });
      if (dash) observer.observe(dash, { attributes: true, attributeFilter: ["hidden"] });
      if (lock) observer.observe(lock, { attributes: true, attributeFilter: ["hidden"] });
    }
  }

  window.KutadguAdminMemberCart = { load: load, clear: clearPrivate, pageSize: PAGE_SIZE };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
