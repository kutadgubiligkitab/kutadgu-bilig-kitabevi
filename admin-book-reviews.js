(function () {
  const AAL2_MESSAGE = "بۇ مەشغۇلات ئۈچۈن 2-باسقۇچلۇق دەلىللەش (AAL2) كېرەك. قايتا كىرىپ قايتا سىناڭ.";
  const DENIED_MESSAGE = "بۇ مەشغۇلاتقا ئىجازەت يوق.";
  const EMPTY_MESSAGE = "بۇ ھالەتتە ئىنكاس يوق.";
  const DELETED_MESSAGE = "ئىنكاس ئۆچۈرۈلدى.";
  const UNCERTAIN_MESSAGE = "ئۆچۈرۈش نەتىجىسى ئېنىق ئەمەس. قايتا سىناڭ.";
  const READ_FAILED = "ئىنكاسلار يۈكلەنمىدى.";
  const PAGE_SIZE = 10;
  const SEARCH_WAIT = 250;
  const SEARCH_MISS = "بۇ ئىزدەشكە ماس ئىنكاس تېپىلمىدى.";
  const REVIEW_REFRESH_APPROVED = "ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.";
  const REVIEW_REFRESH_REJECTED = "ئىنكاس رەت قىلىندى، لېكىن تىزىملىك يېڭىلانمىدى.";
  const REVIEW_DELETE_REFRESH = "ئىنكاس ئۆچۈرۈلدى. تىزىملىك يېڭىلانمىدى.";
  const REPLY_DELETED_MESSAGE = "جاۋاب ئۆچۈرۈلدى.";
  const REPLY_EMPTY_MESSAGE = "بۇ ھالەتتە جاۋاب يوق.";
  const REPLY_READ_FAILED = "جاۋابلار يۈكلەنمىدى.";
  const REPLY_SEARCH_MISS = "بۇ ئىزدەشكە ماس جاۋاب تېپىلمىدى.";
  const REPLY_REFRESH_APPROVED = "جاۋاب تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.";
  const REPLY_REFRESH_REJECTED = "جاۋاب رەت قىلىندى، لېكىن تىزىملىك يېڭىلانمىدى.";
  const REPLY_DELETE_REFRESH = "جاۋاب ئۆچۈرۈلدى. تىزىملىك يېڭىلانمىدى.";
  const HIDDEN_FIELD = "em" + "ail";
  let decisionLock = false;
  let decisionEpoch = 0;
  let actionsFrozen = false;
  let loadGeneration = 0;
  let readEpoch = 0;
  let searchTimer = 0;
  let lockedQuery = "";
  const view = { reviews: 0, replies: 0 };
  const committed = { reviews: null, replies: null };
  const failed = { reviews: null, replies: null };

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

  function jwtClaim(token, key) {
    try {
      const part = String(token || "").split(".")[1] || "";
      if (!part) return "";
      const base = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base + "=".repeat((4 - (base.length % 4)) % 4);
      const json = JSON.parse(atob(padded));
      return String(json && json[key] || "");
    } catch (error) {
      return "";
    }
  }

  function jwtAal(token) {
    return jwtClaim(token, "aal");
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

  function replyStatusNode() {
    return document.querySelector("#bookReviewReplyStatus");
  }

  function searchNode() {
    return document.querySelector("#bookReviewSearch");
  }

  function searchValue() {
    const node = searchNode();
    return node ? String(node.value || "") : "";
  }

  function selectedStatus() {
    const pressed = document.querySelector(".admin-review-filters button[aria-pressed='true']");
    const value = pressed && pressed.getAttribute("data-review-status");
    if (value === "approved" || value === "rejected" || value === "pending") return value;
    return "pending";
  }

  function setLoading(on) {
    const card = document.querySelector("#bookReviewsCard");
    if (card) card.dataset.reviewLoading = on ? "1" : "0";
  }

  function surfaceOpen() {
    const card = document.querySelector("#bookReviewsCard");
    const dash = document.querySelector("#dashboardPanel");
    const lock = document.querySelector("#idleLockPanel");
    if (!card || card.hidden) return false;
    if (!dash || dash.hidden) return false;
    if (lock && !lock.hidden) return false;
    return true;
  }

  function stillCurrent(generation, requested) {
    if (generation !== loadGeneration) return false;
    if (!requested) return false;
    if (selectedStatus() !== requested.status) return false;
    if (searchValue() !== requested.query) return false;
    if (!surfaceOpen()) return false;
    return true;
  }

  function exactCount(value) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return Number(value);
    return null;
  }

  function pageCount(total) {
    if (!total) return 0;
    return Math.floor((total - 1) / PAGE_SIZE) + 1;
  }

  function expectedLength(total, page) {
    if (!total) return 0;
    const from = page * PAGE_SIZE;
    if (from >= total) return 0;
    return Math.min(PAGE_SIZE, total - from);
  }

  function hasPrivateField(row) {
    if (!row || typeof row !== "object") return true;
    if (Object.prototype.hasOwnProperty.call(row, "user_id")) return true;
    if (Object.prototype.hasOwnProperty.call(row, HIDDEN_FIELD)) return true;
    return false;
  }

  function parsePage(data) {
    let payload = data;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch (error) { return null; }
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const total = exactCount(payload.total);
    const page = exactCount(payload.page);
    if (total == null || page == null || !Array.isArray(payload.rows)) return null;
    const last = total === 0 ? 0 : Math.floor((total - 1) / PAGE_SIZE);
    if (page > last || page < 0) return null;
    if (payload.rows.length !== expectedLength(total, page)) return null;
    for (let index = 0; index < payload.rows.length; index += 1) {
      if (hasPrivateField(payload.rows[index])) return null;
    }
    return { total: total, page: page, rows: payload.rows };
  }

  function deniedError(error) {
    const blob = String(error && error.code || "") + " " + String(error && error.message || "");
    return /42501|aal2|permission/i.test(blob);
  }

  function bookLink(row) {
    const link = document.createElement("a");
    const bookId = String(row.book_id || "");
    link.href = "/book/" + encodeURIComponent(bookId);
    link.textContent = row.book_title ? String(row.book_title) : ("كىتاب " + bookId);
    return link;
  }

  function totalText(kind, total, page) {
    const noun = kind === "reviews" ? "ئىنكاس" : "جاۋاب";
    if (!total) return "جەمئىي 0 " + noun;
    return "جەمئىي " + String(total) + " " + noun + " · بەت " + String(page + 1) + " / " + String(pageCount(total));
  }

  function emptyCopy(kind, query) {
    const trimmed = String(query || "").trim();
    if (kind === "reviews") return trimmed ? SEARCH_MISS : EMPTY_MESSAGE;
    return trimmed ? REPLY_SEARCH_MISS : REPLY_EMPTY_MESSAGE;
  }

  function rememberFailure(kind, requested, page) {
    failed[kind] = { status: requested.status, query: requested.query, page: page };
  }

  function rememberPage(kind, requested, parsed) {
    view[kind] = parsed.page;
    committed[kind] = {
      status: requested.status,
      query: requested.query,
      page: parsed.page,
      total: parsed.total,
      rows: parsed.rows.map((row) => Object.assign({}, row))
    };
    failed[kind] = null;
  }

  function pagerButton(label, disabled, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-secondary";
    button.textContent = label;
    button.disabled = !!disabled;
    button.addEventListener("click", () => {
      if (button.disabled || searchTimer || decisionLock) return;
      onClick();
    });
    return button;
  }

  function renderKind(kind, requested) {
    const list = document.querySelector(kind === "reviews" ? "#bookReviewModerationList" : "#bookReviewReplyList");
    const statusEl = kind === "reviews" ? statusNode() : replyStatusNode();
    const saved = committed[kind];
    const problem = failed[kind];
    const showing = saved;
    if (statusEl) {
      if (problem) statusEl.textContent = kind === "reviews" ? READ_FAILED : REPLY_READ_FAILED;
      else if (!saved || !saved.total) statusEl.textContent = emptyCopy(kind, requested.query);
      else statusEl.textContent = "";
    }
    if (!list) return;
    list.replaceChildren();
    const rows = showing && Array.isArray(showing.rows) ? showing.rows : [];
    if (!rows.length && !problem) {
      const empty = document.createElement("p");
      empty.className = "admin-help";
      empty.textContent = emptyCopy(kind, requested.query);
      list.appendChild(empty);
    }
    rows.forEach((row) => {
      const item = document.createElement("article");
      item.className = kind === "reviews" ? "admin-review-item" : "admin-reply-item";
      if (kind === "reviews") item.dataset.reviewId = String(row.id || "");
      else item.dataset.replyId = String(row.id || "");
      const title = document.createElement("p");
      title.className = "admin-help";
      const name = document.createElement("span");
      name.textContent = (row.display_name ? String(row.display_name) : "ئەزا") + " · ";
      title.append(name, bookLink(row));
      const body = document.createElement("p");
      body.className = "admin-review-body";
      body.textContent = row.body != null ? String(row.body) : "";
      const actions = document.createElement("div");
      actions.className = kind === "reviews" ? "admin-review-actions" : "admin-reply-actions";
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
      if (row.status === "pending" || requested.status === "pending") {
        if (kind === "reviews") {
          approve.addEventListener("click", () => decide(row.id, "approved", approve, reject));
          reject.addEventListener("click", () => decide(row.id, "rejected", approve, reject));
        } else {
          approve.addEventListener("click", () => decideReply(row.id, "approved", approve, reject));
          reject.addEventListener("click", () => decideReply(row.id, "rejected", approve, reject));
        }
        actions.append(approve, reject);
      }
      if (kind === "reviews") remove.addEventListener("click", () => removeReview(row, remove));
      else remove.addEventListener("click", () => removeReply(row, remove));
      actions.append(remove);
      if (actionsFrozen) {
        approve.disabled = true;
        reject.disabled = true;
        remove.disabled = true;
      }
      item.append(title, body, actions);
      list.appendChild(item);
    });
    if (problem) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.id = kind === "reviews" ? "bookReviewRetry" : "bookReviewReplyRetry";
      retry.className = "admin-secondary";
      retry.textContent = "قايتا سىناش";
      retry.addEventListener("click", () => retryRead(kind));
      list.appendChild(retry);
    }
    if (showing) {
      const bar = document.createElement("div");
      bar.className = "admin-review-pager";
      const total = document.createElement("p");
      total.className = "admin-review-total";
      total.textContent = totalText(kind, showing.total, showing.page);
      const pages = pageCount(showing.total);
      const prev = pagerButton("ئالدىنقى بەت", !showing.total || showing.page <= 0, () => {
        const target = {};
        target[kind] = showing.page - 1;
        load(target);
      });
      const next = pagerButton("كېيىنكى بەت", !showing.total || showing.page >= pages - 1, () => {
        const target = {};
        target[kind] = showing.page + 1;
        load(target);
      });
      bar.append(prev, total, next);
      list.appendChild(bar);
    }
  }

  function retryRead(kind) {
    const snap = failed[kind];
    if (!snap || decisionLock) return;
    if (selectedStatus() !== snap.status || searchValue() !== snap.query) return;
    const same = (entry) => !!(entry && entry.status === snap.status && entry.query === snap.query);
    load({
      reviews: same(failed.reviews) ? failed.reviews.page : view.reviews,
      replies: same(failed.replies) ? failed.replies.page : view.replies
    });
  }

  function clearPrivateLists() {
    loadGeneration += 1;
    decisionEpoch += 1;
    readEpoch += 1;
    decisionLock = false;
    actionsFrozen = false;
    clearTimeout(searchTimer);
    searchTimer = 0;
    lockedQuery = "";
    view.reviews = 0;
    view.replies = 0;
    committed.reviews = null;
    committed.replies = null;
    failed.reviews = null;
    failed.replies = null;
    const search = searchNode();
    if (search) search.value = "";
    const list = document.querySelector("#bookReviewModerationList");
    if (list) list.replaceChildren();
    const replies = document.querySelector("#bookReviewReplyList");
    if (replies) replies.replaceChildren();
    setStatus("");
    const replyStatus = replyStatusNode();
    if (replyStatus) replyStatus.textContent = "";
    setLoading(false);
  }

  async function sessionIdentity(db) {
    if (!db || !db.auth || typeof db.auth.getSession !== "function") return { aal: "", sub: "" };
    const result = await db.auth.getSession();
    const session = result && result.data && result.data.session;
    const token = session && session.access_token;
    return { aal: jwtAal(token), sub: jwtClaim(token, "sub") };
  }

  async function sessionAal(db) {
    const identity = await sessionIdentity(db);
    return identity.aal;
  }

  function sameIdentity(before, after) {
    return !!before && !!after && before.aal === "aal2" && after.aal === "aal2" && before.sub === after.sub;
  }

  function dropForAuth() {
    clearPrivateLists();
    setStatus(AAL2_MESSAGE);
  }

  async function readKind(db, kind, requested, page, generation, before) {
    const name = kind === "reviews" ? "admin_book_review_page" : "admin_book_review_reply_page";
    let result = null;
    let thrown = null;
    try {
      result = await db.rpc(name, { p_status: requested.status, p_query: requested.query, p_page: page });
    } catch (error) {
      thrown = error;
    }
    if (!stillCurrent(generation, requested)) return { stale: true };
    let after = before;
    try {
      after = await sessionIdentity(db);
    } catch (error) {
      if (!stillCurrent(generation, requested)) return { stale: true };
      return { failed: true };
    }
    if (!stillCurrent(generation, requested)) return { stale: true };
    if (!sameIdentity(before, after)) return { auth: true };
    const error = thrown || (result && result.error);
    if (error) {
      if (deniedError(error)) return { auth: true };
      return { failed: true };
    }
    const parsed = parsePage(result && result.data);
    if (!parsed) return { failed: true };
    return { parsed: parsed };
  }

  async function load(target) {
    const db = client();
    const generation = ++loadGeneration;
    const op = ++readEpoch;
    const requested = {
      status: selectedStatus(),
      query: searchValue(),
      reviews: target && Number.isInteger(target.reviews) ? target.reviews : view.reviews,
      replies: target && Number.isInteger(target.replies) ? target.replies : view.replies
    };
    const only = target && (target.only === "reviews" || target.only === "replies") ? target.only : "";
    const outcome = { stale: false, reviewsOk: only === "replies", repliesOk: only === "reviews" };
    setLoading(true);
    try {
      if (!db || typeof db.rpc !== "function") {
        if (stillCurrent(generation, requested)) setStatus("باشقۇرغۇچى كىرىشى كېرەك.");
        outcome.stale = true;
        return outcome;
      }
      let before = { aal: "", sub: "" };
      try {
        before = await sessionIdentity(db);
      } catch (error) {
        if (!stillCurrent(generation, requested)) {
          outcome.stale = true;
          return outcome;
        }
        if (only !== "replies") {
          rememberFailure("reviews", requested, requested.reviews);
          renderKind("reviews", requested);
          outcome.reviewsOk = false;
        }
        if (only !== "reviews") {
          rememberFailure("replies", requested, requested.replies);
          renderKind("replies", requested);
          outcome.repliesOk = false;
        }
        return outcome;
      }
      if (!stillCurrent(generation, requested)) {
        outcome.stale = true;
        return outcome;
      }
      if (before.aal !== "aal2") {
        dropForAuth();
        outcome.stale = true;
        return outcome;
      }
      const jobs = [];
      if (only !== "replies") jobs.push(readKind(db, "reviews", requested, requested.reviews, generation, before).then((row) => ({ kind: "reviews", row: row })));
      if (only !== "reviews") jobs.push(readKind(db, "replies", requested, requested.replies, generation, before).then((row) => ({ kind: "replies", row: row })));
      const settled = await Promise.all(jobs);
      if (!stillCurrent(generation, requested)) {
        outcome.stale = true;
        return outcome;
      }
      let authLost = false;
      settled.forEach((item) => {
        if (item.row && item.row.auth) authLost = true;
      });
      if (authLost) {
        dropForAuth();
        outcome.stale = true;
        return outcome;
      }
      if (!stillCurrent(generation, requested)) {
        outcome.stale = true;
        return outcome;
      }
      settled.forEach((item) => {
        const row = item.row || {};
        if (row.stale) {
          outcome.stale = true;
          return;
        }
        if (row.parsed) {
          rememberPage(item.kind, requested, row.parsed);
          outcome[item.kind === "reviews" ? "reviewsOk" : "repliesOk"] = true;
        } else {
          rememberFailure(item.kind, requested, requested[item.kind]);
          outcome[item.kind === "reviews" ? "reviewsOk" : "repliesOk"] = false;
        }
      });
      if (!stillCurrent(generation, requested)) {
        outcome.stale = true;
        return outcome;
      }
      if (!only && outcome.reviewsOk && outcome.repliesOk) actionsFrozen = false;
      settled.forEach((item) => {
        const row = item.row || {};
        if (row.stale || !stillCurrent(generation, requested)) return;
        renderKind(item.kind, requested);
      });
      return outcome;
    } finally {
      if (op === readEpoch) setLoading(false);
    }
  }

  function releaseDecision(epoch, buttons) {
    if (epoch !== decisionEpoch) return;
    decisionLock = false;
    if (actionsFrozen) return;
    buttons.forEach((button) => {
      if (button && button.isConnected) button.disabled = false;
    });
  }

  function freezeMutationButtons() {
    actionsFrozen = true;
    document.querySelectorAll(".admin-review-actions button, .admin-reply-actions button").forEach((button) => {
      button.disabled = true;
    });
  }

  function refreshApprovals() {
    const bell = window.KutadguAdminApprovals;
    if (bell && typeof bell.refresh === "function") bell.refresh();
  }

  async function refreshAfterWrite(epoch, affected) {
    const refreshed = await load();
    if (epoch !== decisionEpoch) return { stale: true };
    if (!refreshed || refreshed.stale) return { stale: true };
    const reviewsOk = affected === "replies" ? true : !!refreshed.reviewsOk;
    const repliesOk = affected === "reviews" ? true : !!refreshed.repliesOk;
    if (!reviewsOk || !repliesOk) return { ok: false };
    return { ok: true };
  }

  async function decide(reviewId, decision, approve, reject) {
    if (decisionLock || actionsFrozen) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    const epoch = decisionEpoch;
    decisionLock = true;
    lockedQuery = searchValue();
    if (approve) approve.disabled = true;
    if (reject) reject.disabled = true;
    try {
      const before = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (before.aal !== "aal2") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const result = await db.rpc("moderate_book_review", { review_id: reviewId, decision: decision });
      if (epoch !== decisionEpoch) return;
      const after = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (!sameIdentity(before, after)) {
        dropForAuth();
        return;
      }
      const error = result && result.error;
      if (error) {
        setStatus(deniedError(error) ? AAL2_MESSAGE : DENIED_MESSAGE);
        return;
      }
      const refreshed = await refreshAfterWrite(epoch, "reviews");
      if (refreshed.stale || epoch !== decisionEpoch) return;
      if (!refreshed.ok) {
        setStatus(decision === "rejected" ? REVIEW_REFRESH_REJECTED : REVIEW_REFRESH_APPROVED);
        freezeMutationButtons();
        return;
      }
      refreshApprovals();
    } catch (error) {
      if (epoch !== decisionEpoch) return;
      setStatus(DENIED_MESSAGE);
    } finally {
      releaseDecision(epoch, [approve, reject]);
    }
  }

  async function reviewExists(db, reviewId) {
    const result = await db.rpc("admin_book_review_exists", { p_review_id: reviewId });
    if (!result || result.error) return null;
    return result.data === true;
  }

  async function removeReview(row, button) {
    if (decisionLock || actionsFrozen) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    const epoch = decisionEpoch;
    decisionLock = true;
    lockedQuery = searchValue();
    if (button) button.disabled = true;
    let confirmed = false;
    try {
      confirmed = window.confirm(reviewDeleteConfirm(row));
    } catch (error) {
      confirmed = false;
    }
    if (!confirmed) {
      releaseDecision(epoch, [button]);
      return;
    }
    let announced = false;
    try {
      const before = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (before.aal !== "aal2") {
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
      if (epoch !== decisionEpoch) return;
      const after = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (!sameIdentity(before, after)) {
        dropForAuth();
        return;
      }
      const error = thrown || (result && result.error);
      if (!error) {
        announced = true;
        const refreshed = await refreshAfterWrite(epoch, "both");
        if (refreshed.stale || epoch !== decisionEpoch) return;
        if (!refreshed.ok) {
          setStatus(REVIEW_DELETE_REFRESH);
          freezeMutationButtons();
          return;
        }
        setStatus(DELETED_MESSAGE);
        refreshApprovals();
        return;
      }
      if (String(error.code || "") === "42501" || deniedError(error)) {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const exists = await reviewExists(db, row.id);
      if (epoch !== decisionEpoch) return;
      if (exists === false) {
        announced = true;
        const refreshed = await refreshAfterWrite(epoch, "both");
        if (refreshed.stale || epoch !== decisionEpoch) return;
        if (!refreshed.ok) {
          setStatus(REVIEW_DELETE_REFRESH);
          freezeMutationButtons();
          return;
        }
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
      if (epoch !== decisionEpoch) return;
      if (!announced) setStatus(UNCERTAIN_MESSAGE);
    } finally {
      releaseDecision(epoch, [button]);
    }
  }

  async function decideReply(replyId, decision, approve, reject) {
    if (decisionLock || actionsFrozen) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    const epoch = decisionEpoch;
    decisionLock = true;
    lockedQuery = searchValue();
    if (approve) approve.disabled = true;
    if (reject) reject.disabled = true;
    try {
      const before = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (before.aal !== "aal2") {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const result = await db.rpc("moderate_book_review_reply", { p_reply_id: replyId, decision: decision });
      if (epoch !== decisionEpoch) return;
      const after = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (!sameIdentity(before, after)) {
        dropForAuth();
        return;
      }
      const error = result && result.error;
      if (error) {
        setStatus(deniedError(error) ? AAL2_MESSAGE : DENIED_MESSAGE);
        return;
      }
      const refreshed = await refreshAfterWrite(epoch, "replies");
      if (refreshed.stale || epoch !== decisionEpoch) return;
      if (!refreshed.ok) {
        const replyStatus = replyStatusNode();
        if (replyStatus) replyStatus.textContent = decision === "rejected" ? REPLY_REFRESH_REJECTED : REPLY_REFRESH_APPROVED;
        freezeMutationButtons();
        return;
      }
      refreshApprovals();
    } catch (error) {
      if (epoch !== decisionEpoch) return;
      setStatus(DENIED_MESSAGE);
    } finally {
      releaseDecision(epoch, [approve, reject]);
    }
  }

  async function replyExists(db, replyId) {
    const result = await db.rpc("admin_book_review_reply_exists", { p_reply_id: replyId });
    if (!result || result.error) return null;
    return result.data === true;
  }

  async function removeReply(row, button) {
    if (decisionLock || actionsFrozen) return;
    const db = client();
    if (!db || typeof db.rpc !== "function") {
      setStatus(DENIED_MESSAGE);
      return;
    }
    const epoch = decisionEpoch;
    decisionLock = true;
    lockedQuery = searchValue();
    if (button) button.disabled = true;
    let confirmed = false;
    try {
      confirmed = window.confirm(replyDeleteConfirm(row));
    } catch (error) {
      confirmed = false;
    }
    if (!confirmed) {
      releaseDecision(epoch, [button]);
      return;
    }
    let announced = false;
    try {
      const before = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (before.aal !== "aal2") {
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
      if (epoch !== decisionEpoch) return;
      const after = await sessionIdentity(db);
      if (epoch !== decisionEpoch) return;
      if (!sameIdentity(before, after)) {
        dropForAuth();
        return;
      }
      const error = thrown || (result && result.error);
      if (!error) {
        announced = true;
        const refreshed = await refreshAfterWrite(epoch, "replies");
        if (refreshed.stale || epoch !== decisionEpoch) return;
        if (!refreshed.ok) {
          const replyStatus = replyStatusNode();
          if (replyStatus) replyStatus.textContent = REPLY_DELETE_REFRESH;
          freezeMutationButtons();
          return;
        }
        const replyStatus = replyStatusNode();
        if (replyStatus) replyStatus.textContent = REPLY_DELETED_MESSAGE;
        refreshApprovals();
        return;
      }
      if (String(error.code || "") === "42501" || deniedError(error)) {
        setStatus(AAL2_MESSAGE);
        return;
      }
      const exists = await replyExists(db, row.id);
      if (epoch !== decisionEpoch) return;
      if (exists === false) {
        announced = true;
        const refreshed = await refreshAfterWrite(epoch, "replies");
        if (refreshed.stale || epoch !== decisionEpoch) return;
        if (!refreshed.ok) {
          const replyStatus = replyStatusNode();
          if (replyStatus) replyStatus.textContent = REPLY_DELETE_REFRESH;
          freezeMutationButtons();
          return;
        }
        const replyStatus = replyStatusNode();
        if (replyStatus) replyStatus.textContent = REPLY_DELETED_MESSAGE;
        refreshApprovals();
        return;
      }
      if (exists === true) {
        setStatus(DENIED_MESSAGE);
        return;
      }
      setStatus(UNCERTAIN_MESSAGE);
    } catch (error) {
      if (epoch !== decisionEpoch) return;
      if (!announced) setStatus(UNCERTAIN_MESSAGE);
    } finally {
      releaseDecision(epoch, [button]);
    }
  }

  function armSearch() {
    loadGeneration += 1;
    clearTimeout(searchTimer);
    view.reviews = 0;
    view.replies = 0;
    document.querySelectorAll(".admin-review-pager button").forEach((button) => {
      button.disabled = true;
    });
    searchTimer = setTimeout(() => {
      searchTimer = 0;
      load();
    }, SEARCH_WAIT);
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
      loadGeneration += 1;
      clearTimeout(searchTimer);
      searchTimer = 0;
      view.reviews = 0;
      view.replies = 0;
      load();
    });
  }

  function bindSearch() {
    const input = searchNode();
    if (!input || input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("input", () => {
      if (decisionLock) {
        input.value = lockedQuery;
        return;
      }
      armSearch();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (decisionLock) {
        input.value = lockedQuery;
        return;
      }
      loadGeneration += 1;
      clearTimeout(searchTimer);
      searchTimer = 0;
      view.reviews = 0;
      view.replies = 0;
      load();
    });
  }

  bindFilters();
  bindSearch();
  window.KutadguAdminReviews = { load: load, clear: clearPrivateLists, jwtAal: jwtAal };
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
    const card = document.querySelector("#bookReviewsCard");
    if (typeof MutationObserver === "function" && card && card.dataset.reviewWatch !== "1") {
      card.dataset.reviewWatch = "1";
      const cardObserver = new MutationObserver(() => {
        if (card.hidden) loadGeneration += 1;
      });
      cardObserver.observe(card, { attributes: true, attributeFilter: ["hidden"] });
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
