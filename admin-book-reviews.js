(function () {
  const AAL2_MESSAGE = "بۇ مەشغۇلات ئۈچۈن 2-باسقۇچلۇق دەلىللەش (AAL2) كېرەك. قايتا كىرىپ قايتا سىناڭ.";
  const DENIED_MESSAGE = "بۇ مەشغۇلاتقا ئىجازەت يوق.";
  const EMPTY_MESSAGE = "بۇ ھالەتتە ئىنكاس يوق.";
  const DELETED_MESSAGE = "ئىنكاس ئۆچۈرۈلدى.";
  const UNCERTAIN_MESSAGE = "ئۆچۈرۈش نەتىجىسى ئېنىق ئەمەس. قايتا سىناڭ.";
  const READ_FAILED = "ئىنكاسلار يۈكلەنمىدى.";
  const PAGE_SIZE = 100;
  const REPLY_DELETED_MESSAGE = "جاۋاب ئۆچۈرۈلدى.";
  const REPLY_EMPTY_MESSAGE = "بۇ ھالەتتە جاۋاب يوق.";
  const REPLY_READ_FAILED = "جاۋابلار يۈكلەنمىدى.";
  let decisionLock = false;
  let loadGeneration = 0;
  const STATUSES = ["pending", "approved", "rejected"];
  const cursors = { reviews: {}, replies: {} };
  const pages = { reviews: {}, replies: {} };
  STATUSES.forEach((status) => {
    cursors.reviews[status] = [null];
    cursors.replies[status] = [null];
    pages.reviews[status] = { index: 0, rows: null };
    pages.replies[status] = { index: 0, rows: null };
  });

  function reviewDeleteConfirm(row) {
    const title = row && row.book_title ? String(row.book_title) : ("كىتاب " + String(row && row.book_id || ""));
    const excerpt = String(row && row.body || "").slice(0, 80);
    return "بۇ ئىنكاسنى ئۆچۈرەمسىز؟\n" + title + "\n" + excerpt + "\nبۇ ئىنكاس ۋە ئۇنىڭ جاۋابلىرى، يۈرەكلىرى ۋە ئۇقتۇرۇشلىرى ئۆچۈرۈلىدۇ. كىتاب ۋە ئەزا ھېسابى ئۆچمەيدۇ.";
  }

  function replyDeleteConfirm(row) {
    const title = row && row.book_title ? String(row.book_title) : ("كىتاب " + String(row && row.book_id || ""));
    const excerpt = String(row && row.body || "").slice(0, 80);
    return "بۇ جاۋابنى ئۆچۈرەمسىز؟\n" + title + "\n" + excerpt + "\nبۇ جاۋاب ۋە ئۇنىڭ ئۇقتۇرۇشلىرى ئۆچۈرۈلىدۇ. ئىنكاس، كىتاب ۋە ئەزا ھېسابى ئۆچمەيدۇ.";
  }

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
    if (window.__kutadguBookReviewAdminClient) return window.__kutadguBookReviewAdminClient;
    return window.__kutadguAdminDb || null;
  }

  function statusNode() {
    return document.querySelector("#bookReviewModerationStatus");
  }

  function setStatus(text) {
    const node = statusNode();
    if (node) node.textContent = text || "";
  }

  function bookLink(row) {
    const link = document.createElement("a");
    const bookId = String(row.book_id || "");
    link.href = "/book/" + encodeURIComponent(bookId);
    link.textContent = row.book_title ? String(row.book_title) : ("كىتاب " + bookId);
    return link;
  }

  function renderRows(rows, status, failed) {
    const list = document.querySelector("#bookReviewModerationList");
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      if (!failed) {
        const empty = document.createElement("p");
        empty.className = "admin-help";
        empty.textContent = EMPTY_MESSAGE;
        list.appendChild(empty);
      }
      const bar = pager("reviews", status, 0);
      if (bar) list.appendChild(bar);
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement("article");
      item.className = "admin-review-item";
      item.dataset.reviewId = String(row.id || "");
      const title = document.createElement("p");
      title.className = "admin-help";
      const name = document.createElement("span");
      name.textContent = (row.display_name ? String(row.display_name) : "ئەزا") + " · ";
      title.append(name, bookLink(row));
      const body = document.createElement("p");
      body.className = "admin-review-body";
      body.textContent = row.body != null ? String(row.body) : "";
      const actions = document.createElement("div");
      actions.className = "admin-review-actions";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "admin-primary";
      approve.textContent = "تەستىقلاش";
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "admin-secondary";
      reject.textContent = "رەت قىلىش";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "admin-review-delete";
      remove.textContent = "ئۆچۈرۈش";
      if (row.status === "pending" || status === "pending") {
        approve.addEventListener("click", () => decide(row.id, "approved", approve, reject));
        reject.addEventListener("click", () => decide(row.id, "rejected", approve, reject));
        actions.append(approve, reject);
      }
      remove.addEventListener("click", () => removeReview(row, remove));
      actions.append(remove);
      item.append(title, body, actions);
      list.appendChild(item);
    });
    const bar = pager("reviews", status, rows.length);
    if (bar) list.appendChild(bar);
  }

  function replyStatusNode() {
    return document.querySelector("#bookReviewReplyStatus");
  }

  function renderReplies(rows, failed, status) {
    const list = document.querySelector("#bookReviewReplyList");
    const statusNode = replyStatusNode();
    if (statusNode) statusNode.textContent = failed ? REPLY_READ_FAILED : (rows.length ? "" : REPLY_EMPTY_MESSAGE);
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      const bar = pager("replies", status, 0);
      if (bar) list.appendChild(bar);
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement("article");
      item.className = "admin-reply-item";
      item.dataset.replyId = String(row.id || "");
      const title = document.createElement("p");
      title.className = "admin-help";
      const name = document.createElement("span");
      name.textContent = (row.display_name ? String(row.display_name) : "ئەزا") + " · ";
      title.append(name, bookLink(row));
      const body = document.createElement("p");
      body.className = "admin-review-body";
      body.textContent = row.body != null ? String(row.body) : "";
      const actions = document.createElement("div");
      actions.className = "admin-reply-actions";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "admin-primary";
      approve.textContent = "تەستىقلاش";
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "admin-secondary";
      reject.textContent = "رەت قىلىش";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "admin-review-delete";
      remove.textContent = "ئۆچۈرۈش";
      if (row.status === "pending" || status === "pending") {
        approve.addEventListener("click", () => decideReply(row.id, "approved", approve, reject));
        reject.addEventListener("click", () => decideReply(row.id, "rejected", approve, reject));
        actions.append(approve, reject);
      }
      remove.addEventListener("click", () => removeReply(row, remove));
      actions.append(remove);
      item.append(title, body, actions);
      list.appendChild(item);
    });
    const bar = pager("replies", status, rows.length);
    if (bar) list.appendChild(bar);
  }

  function pager(kind, status, count) {
    const index = pages[kind][status].index || 0;
    if (!index && count < PAGE_SIZE) return null;
    const bar = document.createElement("div");
    bar.className = "admin-review-pager";
    if (index > 0) {
      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "admin-secondary";
      prev.textContent = "ئالدىنقى بەت";
      prev.addEventListener("click", () => {
        const target = {};
        target[kind] = index - 1;
        load(target);
      });
      bar.appendChild(prev);
    }
    if (count === PAGE_SIZE) {
      const next = document.createElement("button");
      next.type = "button";
      next.className = "admin-secondary";
      next.textContent = "كېيىنكى بەت";
      next.addEventListener("click", () => {
        const target = {};
        target[kind] = index + 1;
        load(target);
      });
      bar.appendChild(next);
    }
    if (!bar.childNodes.length) return null;
    return bar;
  }

  function listArgs(status, cursor) {
    return {
      p_status: status,
      p_after: cursor && cursor.created_at ? cursor.created_at : null,
      p_after_id: cursor && cursor.id ? cursor.id : null
    };
  }

  function cursorAt(kind, status, index) {
    const pageIndex = index > 0 ? index : 0;
    if (!pageIndex) return { ok: true, index: 0, cursor: null };
    const cursor = cursors[kind][status][pageIndex];
    if (!cursor || !cursor.id || !cursor.created_at) return { ok: false, index: pageIndex, cursor: null };
    return { ok: true, index: pageIndex, cursor: cursor };
  }

  function rememberNextCursor(kind, status, index, rows) {
    if (!rows || rows.length < PAGE_SIZE) {
      cursors[kind][status].length = index + 1;
      return;
    }
    const last = rows[rows.length - 1];
    if (!last || !last.id || !last.created_at) return;
    cursors[kind][status][index + 1] = { created_at: last.created_at, id: last.id };
    cursors[kind][status].length = index + 2;
  }

  function stillCurrent(generation, requested) {
    return generation === loadGeneration && selectedStatus() === requested;
  }

  function clearPrivateLists() {
    loadGeneration += 1;
    STATUSES.forEach((status) => {
      pages.reviews[status] = { index: 0, rows: null };
      pages.replies[status] = { index: 0, rows: null };
      cursors.reviews[status] = [null];
      cursors.replies[status] = [null];
    });
    const list = document.querySelector("#bookReviewModerationList");
    if (list) list.replaceChildren();
    const replies = document.querySelector("#bookReviewReplyList");
    if (replies) replies.replaceChildren();
    setStatus("");
    const replyStatus = replyStatusNode();
    if (replyStatus) replyStatus.textContent = "";
  }

  async function sessionAal(db) {
    if (!db || !db.auth || typeof db.auth.getSession !== "function") return "";
    const result = await db.auth.getSession();
    const session = result && result.data && result.data.session;
    return jwtAal(session && session.access_token);
  }

  function selectedStatus() {
    const pressed = document.querySelector(".admin-review-filters button[aria-pressed='true']");
    const value = pressed && pressed.getAttribute("data-review-status");
    if (value === "approved" || value === "rejected" || value === "pending") return value;
    return "pending";
  }

  async function load(target) {
    const db = client();
    const requested = selectedStatus();
    const generation = ++loadGeneration;
    const reviewAsk = cursorAt("reviews", requested, target && Number.isInteger(target.reviews) ? target.reviews : pages.reviews[requested].index);
    const replyAsk = cursorAt("replies", requested, target && Number.isInteger(target.replies) ? target.replies : pages.replies[requested].index);
    if (!db) {
      setStatus("باشقۇرغۇچى كىرىشى كېرەك.");
      return;
    }
    const aal = await sessionAal(db);
    if (!stillCurrent(generation, requested)) return;
    if (aal !== "aal2") {
      renderRows([], requested, true);
      renderReplies([], false, requested);
      setStatus(AAL2_MESSAGE);
      return;
    }
    let reviewRows = [];
    let reviewsFailed = !reviewAsk.ok;
    if (reviewAsk.ok) {
      try {
        const result = await db.rpc("admin_list_book_reviews", listArgs(requested, reviewAsk.cursor));
        if (!stillCurrent(generation, requested)) return;
        if (!result || result.error || !Array.isArray(result.data)) reviewsFailed = true;
        else reviewRows = result.data;
      } catch (error) {
        if (!stillCurrent(generation, requested)) return;
        reviewsFailed = true;
      }
    }
    let replyRows = [];
    let repliesFailed = !replyAsk.ok;
    if (replyAsk.ok) {
      try {
        const replyResult = await db.rpc("admin_list_book_review_replies", listArgs(requested, replyAsk.cursor));
        if (!stillCurrent(generation, requested)) return;
        if (!replyResult || replyResult.error || !Array.isArray(replyResult.data)) repliesFailed = true;
        else replyRows = replyResult.data;
      } catch (error) {
        if (!stillCurrent(generation, requested)) return;
        repliesFailed = true;
      }
    }
    if (!stillCurrent(generation, requested)) return;
    if (!reviewsFailed) {
      pages.reviews[requested] = { index: reviewAsk.index, rows: reviewRows.slice() };
      rememberNextCursor("reviews", requested, reviewAsk.index, reviewRows);
    }
    if (!repliesFailed) {
      pages.replies[requested] = { index: replyAsk.index, rows: replyRows.slice() };
      rememberNextCursor("replies", requested, replyAsk.index, replyRows);
    }
    const shownReviews = reviewsFailed ? (pages.reviews[requested].rows || []) : reviewRows;
    const shownReplies = repliesFailed ? (pages.replies[requested].rows || []) : replyRows;
    renderRows(shownReviews, requested, reviewsFailed && !shownReviews.length);
    renderReplies(shownReplies, repliesFailed, requested);
    if (reviewsFailed) setStatus(READ_FAILED);
    else setStatus(shownReviews.length ? "" : EMPTY_MESSAGE);
  }

  function releaseDecision(approve, reject) {
    decisionLock = false;
    if (approve && approve.isConnected) approve.disabled = false;
    if (reject && reject.isConnected) reject.disabled = false;
  }

  function refreshApprovals() {
    const bell = window.KutadguAdminApprovals;
    if (bell && typeof bell.refresh === "function") bell.refresh();
  }

  async function decide(reviewId, decision, approve, reject) {
    if (decisionLock) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    decisionLock = true;
    if (approve) approve.disabled = true;
    if (reject) reject.disabled = true;
    try {
      const aal = await sessionAal(db);
      if (aal !== "aal2") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const result = await db.rpc("moderate_book_review", { review_id: reviewId, decision: decision });
      const error = result && result.error;
      if (error) {
        const blob = String(error.code || "") + " " + String(error.message || "");
        setStatus(/42501|aal2|permission/i.test(blob) ? AAL2_MESSAGE : DENIED_MESSAGE);
        return;
      }
      await load();
      refreshApprovals();
    } catch (error) {
      setStatus(DENIED_MESSAGE);
    } finally {
      releaseDecision(approve, reject);
    }
  }

  async function reviewExists(db, reviewId) {
    const result = await db.rpc("admin_book_review_exists", { p_review_id: reviewId });
    if (!result || result.error) return null;
    return result.data === true;
  }

  async function removeReview(row, button) {
    if (decisionLock) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    decisionLock = true;
    if (button) button.disabled = true;
    let confirmed = false;
    try {
      confirmed = window.confirm(reviewDeleteConfirm(row));
    } catch (error) {
      confirmed = false;
    }
    if (!confirmed) {
      decisionLock = false;
      if (button && button.isConnected) button.disabled = false;
      return;
    }
    let announced = false;
    try {
      const aal = await sessionAal(db);
      if (aal !== "aal2") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      let result = null;
      let thrown = null;
      try {
        result = await db.rpc("delete_book_review", { p_review_id: row.id });
      } catch (error) {
        thrown = error;
      }
      const error = thrown || (result && result.error);
      if (!error) {
        announced = true;
        await load();
        setStatus(DELETED_MESSAGE);
        refreshApprovals();
        return;
      }
      const code = String(error.code || "");
      if (code === "42501") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const exists = await reviewExists(db, row.id);
      if (exists === false) {
        announced = true;
        await load();
        setStatus(DELETED_MESSAGE);
        refreshApprovals();
        return;
      }
      if (exists === true) {
        setStatus(DENIED_MESSAGE);
        return;
      }
      setStatus(UNCERTAIN_MESSAGE);
    } catch (error) {
      if (!announced) setStatus(UNCERTAIN_MESSAGE);
    } finally {
      decisionLock = false;
      if (button && button.isConnected) button.disabled = false;
    }
  }

  async function decideReply(replyId, decision, approve, reject) {
    if (decisionLock) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    decisionLock = true;
    if (approve) approve.disabled = true;
    if (reject) reject.disabled = true;
    try {
      const aal = await sessionAal(db);
      if (aal !== "aal2") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const result = await db.rpc("moderate_book_review_reply", { p_reply_id: replyId, decision: decision });
      const error = result && result.error;
      if (error) {
        const blob = String(error.code || "") + " " + String(error.message || "");
        setStatus(/42501|aal2|permission/i.test(blob) ? AAL2_MESSAGE : DENIED_MESSAGE);
        return;
      }
      await load();
      refreshApprovals();
    } catch (error) {
      setStatus(DENIED_MESSAGE);
    } finally {
      releaseDecision(approve, reject);
    }
  }

  async function replyExists(db, replyId) {
    const result = await db.rpc("admin_book_review_reply_exists", { p_reply_id: replyId });
    if (!result || result.error) return null;
    return result.data === true;
  }

  async function removeReply(row, button) {
    if (decisionLock) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    decisionLock = true;
    if (button) button.disabled = true;
    let confirmed = false;
    try {
      confirmed = window.confirm(replyDeleteConfirm(row));
    } catch (error) {
      confirmed = false;
    }
    if (!confirmed) {
      decisionLock = false;
      if (button && button.isConnected) button.disabled = false;
      return;
    }
    let announced = false;
    try {
      const aal = await sessionAal(db);
      if (aal !== "aal2") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      let result = null;
      let thrown = null;
      try {
        result = await db.rpc("delete_book_review_reply", { p_reply_id: row.id });
      } catch (error) {
        thrown = error;
      }
      const error = thrown || (result && result.error);
      if (!error) {
        announced = true;
        await load();
        setStatus(REPLY_DELETED_MESSAGE);
        refreshApprovals();
        return;
      }
      const code = String(error.code || "");
      if (code === "42501") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const exists = await replyExists(db, row.id);
      if (exists === false) {
        announced = true;
        await load();
        setStatus(REPLY_DELETED_MESSAGE);
        refreshApprovals();
        return;
      }
      if (exists === true) {
        setStatus(DENIED_MESSAGE);
        return;
      }
      setStatus(UNCERTAIN_MESSAGE);
    } catch (error) {
      if (!announced) setStatus(UNCERTAIN_MESSAGE);
    } finally {
      decisionLock = false;
      if (button && button.isConnected) button.disabled = false;
    }
  }

  function bindFilters() {
    const group = document.querySelector(".admin-review-filters");
    if (!group || group.dataset.bound === "1") return;
    group.dataset.bound = "1";
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-review-status]");
      if (!button || decisionLock) return;
      group.querySelectorAll("button[data-review-status]").forEach((item) => {
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      load();
    });
  }

  bindFilters();
  window.KutadguAdminReviews = { load: load, jwtAal: jwtAal };

  const approvalState = { generation: 0, last: null, failed: false, open: false, inflight: null };
  let approvalQueued = false;

  function approvalVisible() {
    const dash = document.querySelector("#dashboardPanel");
    const lock = document.querySelector("#idleLockPanel");
    if (!dash || dash.hidden) return false;
    if (lock && !lock.hidden) return false;
    if (document.visibilityState === "hidden") return false;
    return true;
  }

  function renderBell() {
    const actions = document.querySelector(".admin-top-actions");
    const dash = document.querySelector("#dashboardPanel");
    let wrap = document.querySelector(".admin-approval-bell");
    if (!actions || !approvalVisible()) {
      if (wrap) wrap.remove();
      return;
    }
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "admin-approval-bell";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-approval-bell-button";
      button.setAttribute("aria-haspopup", "true");
      button.setAttribute("aria-label", "تەستىق كۈتۈۋاتقان ئىشلار");
      button.addEventListener("click", () => {
        approvalState.open = !approvalState.open;
        renderBell();
      });
      const panel = document.createElement("div");
      panel.className = "admin-approval-panel";
      panel.hidden = true;
      wrap.append(button, panel);
      actions.insertBefore(wrap, actions.firstChild);
    }
    const button = wrap.querySelector(".admin-approval-bell-button");
    const panel = wrap.querySelector(".admin-approval-panel");
    const last = approvalState.last;
    const total = last ? Number(last.submissions || 0) + Number(last.reviews || 0) + Number(last.replies || 0) : null;
    button.textContent = total == null ? "🔔" : ("🔔 " + String(total));
    button.setAttribute("aria-expanded", approvalState.open ? "true" : "false");
    panel.hidden = !approvalState.open;
    panel.replaceChildren();
    if (approvalState.failed) {
      const err = document.createElement("p");
      err.textContent = "سان يۈكلەنمىدى.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "قايتا سىناش";
      retry.addEventListener("click", (event) => {
        event.stopPropagation();
        refreshApprovalCounts();
      });
      panel.append(err, retry);
    }
    if (last) {
      [["submissions", "كىتاب تەستىقى", last.submissions], ["reviews", "ئىنكاسلار", last.reviews], ["reviews", "جاۋابلار", last.replies]].forEach((item) => {
        const link = document.createElement("button");
        link.type = "button";
        link.textContent = item[1] + " " + String(Number(item[2] || 0));
        link.addEventListener("click", () => {
          const nav = document.querySelector('[data-admin-section="' + item[0] + '"]');
          if (nav) nav.click();
          approvalState.open = false;
          renderBell();
        });
        panel.appendChild(link);
      });
    }
  }

  function clearApprovals() {
    approvalState.generation += 1;
    approvalState.last = null;
    approvalState.failed = false;
    approvalState.open = false;
    renderBell();
  }

  function refreshApprovalCounts() {
    if (approvalState.inflight) {
      approvalQueued = true;
      return approvalState.inflight;
    }
    if (!approvalVisible()) {
      clearApprovals();
      return Promise.resolve();
    }
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      approvalState.failed = true;
      renderBell();
      return Promise.resolve();
    }
    const gen = approvalState.generation;
    approvalState.inflight = (async () => {
      const aal = await sessionAal(db);
      if (gen !== approvalState.generation) return;
      if (aal !== "aal2") {
        clearApprovals();
        return;
      }
      let result = null;
      try {
        result = await db.rpc("admin_approval_counts");
      } catch (error) {
        result = { error: error };
      }
      if (gen !== approvalState.generation) return;
      if (!result || result.error || !result.data || typeof result.data !== "object") {
        approvalState.failed = true;
        renderBell();
        return;
      }
      approvalState.failed = false;
      approvalState.last = result.data;
      renderBell();
    })().finally(() => {
      approvalState.inflight = null;
      if (approvalQueued) {
        approvalQueued = false;
        refreshApprovalCounts();
      }
    });
    return approvalState.inflight;
  }

  function watchApprovals() {
    const dash = document.querySelector("#dashboardPanel");
    const lock = document.querySelector("#idleLockPanel");
    const logout = document.querySelector("#adminLogout");
    if (logout && logout.dataset.approvalBound !== "1") {
      logout.dataset.approvalBound = "1";
      logout.addEventListener("click", () => {
        clearApprovals();
        clearPrivateLists();
      });
    }
    if (typeof MutationObserver === "function" && dash && dash.dataset.approvalWatch !== "1") {
      dash.dataset.approvalWatch = "1";
      const observer = new MutationObserver(() => {
        if (!approvalVisible()) clearApprovals();
        else refreshApprovalCounts();
        if (lock && !lock.hidden) clearPrivateLists();
      });
      observer.observe(dash, { attributes: true, attributeFilter: ["hidden"] });
      if (lock) observer.observe(lock, { attributes: true, attributeFilter: ["hidden"] });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        approvalState.generation += 1;
        loadGeneration += 1;
        return;
      }
      if (approvalVisible()) refreshApprovalCounts();
      const card = document.querySelector("#bookReviewsCard");
      if (card && !card.hidden) load();
    });
    window.setInterval(() => {
      if (!approvalVisible()) return;
      if (approvalState.inflight) {
        approvalQueued = true;
        return;
      }
      refreshApprovalCounts();
    }, 50000);
    if (approvalVisible()) refreshApprovalCounts();
  }

  window.KutadguAdminApprovals = { refresh: refreshApprovalCounts, clear: clearApprovals };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchApprovals, { once: true });
  else watchApprovals();
})();
