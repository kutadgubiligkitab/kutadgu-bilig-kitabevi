(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) root.KutadguBookReviews = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const MAX = 1000;
  const REPLY_MAX = 500;
  const PENDING_MESSAGE = "ئىنكاسىڭىز تەستىقنى ساقلاۋاتىدۇ. تەستىقلانغاندىن كېيىن بۇ كىتاب بېتىدە كۆرۈنىدۇ.";
  const INVITE_LABEL = "كىتاب ھەققىدە ئىنكاس يېزىڭ";
  const SIGN_IN_LABEL = "ئەزا بولغاندىن كېيىن كىتاب ھەققىدە ئىنكاس يېزىڭ";
  const WRITE_LABEL = INVITE_LABEL;
  const WRITE_SIGN_IN_LABEL = SIGN_IN_LABEL;
  const VISIBILITY_NOTE = "ئىنكاسىڭىز باشقۇرغۇچى تەستىقلىغاندىن كېيىن، بۇ كىتاب بېتىدە ھەممەيلەنگە كۆرۈنىدۇ.";
  const REJECTED_NOTE = "ئالدىنقى ئىنكاس رەت قىلىندى. يېڭى ئىنكاس يازالايسىز.";
  const EMPTY_MESSAGE = "ئىنكاس يېزىڭ.";
  const LONG_MESSAGE = "ئىنكاس 1000 ھەرپتىن ئېشىپ كەتمىسۇن.";
  const SEND_FAILED = "ئىنكاس يوللانمىدى. قايتا سىناڭ.";
  const READ_FAILED = "ئىنكاسلار يۈكلەنمىدى.";
  const RETRY_LABEL = "قايتا سىناش";
  const SAVED_REFRESH_FAILED = "ئىنكاس ساقلاندى. كۆرۈنۈش يېڭىلانمىدى.";
  const REPLY_EMPTY = "جاۋاب يېزىڭ.";
  const REPLY_LONG = "جاۋاب 500 ھەرپتىن ئېشىپ كەتمىسۇن.";
  const REPLY_FAILED = "جاۋاب يوللانمىدى. قايتا سىناڭ.";
  const REPLY_PENDING = "جاۋابىڭىز تەستىقنى ساقلاۋاتىدۇ.";
  const REPLY_REJECTED = "بۇ جاۋاب رەت قىلىندى.";
  const REPLY_SAVED = "جاۋاب ساقلاندى. كۆرۈنۈش يېڭىلانمىدى.";
  const INTERVAL_MESSAGE = "سەل ساقلاپ قايتا يوللاڭ.";
  const REPLY_LABEL = "جاۋاب يېزىش";
  const REPLY_SIGN_IN = "جاۋاب يېزىش ئۈچۈن كىرىڭ";
  const NOTICE_MESSAGE = "ئىنكاسىڭىزغا يېڭى جاۋاب كەلدى";
  const NOTICE_FAILED = "ئۇقتۇرۇش يۈكلەنمىدى.";

  function normalizedText(value) {
    return String(value == null ? "" : value).replace(/\u0000/g, "").trim();
  }

  function textLength(value) {
    return Array.from(normalizedText(value)).length;
  }

  function validateReviewBody(value) {
    const text = normalizedText(value);
    if (!text) return { ok: false, reason: "empty", message: EMPTY_MESSAGE, value: "" };
    if (textLength(text) > MAX) return { ok: false, reason: "long", message: LONG_MESSAGE, value: text };
    return { ok: true, reason: "", message: "", value: text };
  }

  function remainingLabel(max, value) {
    return "قالغان: " + String(max - textLength(value));
  }

  function validateReplyBody(value) {
    const text = normalizedText(value);
    if (!text) return { ok: false, reason: "empty", message: REPLY_EMPTY, value: "" };
    if (textLength(text) > REPLY_MAX) return { ok: false, reason: "long", message: REPLY_LONG, value: text };
    return { ok: true, reason: "", message: "", value: text };
  }

  function intervalMessage(error) {
    const code = String(error && error.code || "");
    const message = String(error && error.message || "");
    return code === "P0501" || /submission interval/i.test(message);
  }

  function bookIdFromLocation(loc) {
    const seo = root.KutadguBookSeo;
    if (seo && typeof seo.numericCleanBookIdFromLocation === "function") {
      return String(seo.numericCleanBookIdFromLocation(loc) || "");
    }
    return "";
  }

  function detailIsPublic(doc) {
    const page = doc.querySelector(".book-detail-page");
    if (!page) return false;
    if (page.querySelector(".detail-unavailable-panel")) return false;
    const title = page.querySelector(".book-detail-info h1");
    const text = title ? String(title.textContent || "").trim() : "";
    if (!text || text === "كىتاب" || text.indexOf("تەمىنلەنمەيدۇ") !== -1) return false;
    return !!page.querySelector(".detail-purchase-panel");
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mountHost(page) {
    let host = page.querySelector("[data-book-reviews]");
    if (!host) {
      host = el("section", "book-reviews");
      host.setAttribute("data-book-reviews", "1");
      host.setAttribute("aria-label", "كىتاب ئىنكاسلىرى");
      const top = page.querySelector(".book-detail-top");
      if (top) top.insertAdjacentElement("afterend", host);
      else page.appendChild(host);
    }
    return host;
  }

  function paint(host, state) {
    const reviews = Array.isArray(state.reviews) ? state.reviews : [];
    const signedIn = !!state.signedIn;
    host.replaceChildren();
    if (reviews.length) {
      const list = el("div", "book-reviews-list");
      reviews.forEach((row) => {
        list.appendChild(paintReview(row, state));
      });
      host.appendChild(list);
    }
    if (state.pending) {
      host.appendChild(el("p", "book-reviews-pending", PENDING_MESSAGE));
      if (state.refreshFailed) host.appendChild(el("p", "book-reviews-note", SAVED_REFRESH_FAILED));
      else if (state.readError) host.appendChild(el("p", "book-reviews-note", READ_FAILED));
      if (state.readError || state.refreshFailed) appendRetry(host, state);
      return host;
    }
    if (state.rejected) host.appendChild(el("p", "book-reviews-note", REJECTED_NOTE));
    if (state.readError) {
      host.appendChild(el("p", "book-reviews-note", READ_FAILED));
      appendRetry(host, state);
    }
    if (state.ownUnknown || state.unknownReviews || (state.readError && !reviews.length)) {
      if (signedIn && !state.ownUnknown) host.appendChild(buildForm(state));
      return host;
    }
    if (!reviews.length) {
      const invite = el("p", "book-reviews-invite");
      if (signedIn) {
        const button = el("button", "", INVITE_LABEL);
        button.type = "button";
        button.addEventListener("click", () => openForm(host));
        invite.appendChild(button);
      } else {
        const link = el("a", "", SIGN_IN_LABEL);
        link.href = "/account.html";
        invite.appendChild(link);
      }
      host.appendChild(invite);
    } else if (signedIn) {
      const opener = el("button", "book-reviews-write", WRITE_LABEL);
      opener.type = "button";
      opener.addEventListener("click", () => openForm(host));
      host.appendChild(opener);
    } else {
      const invite = el("p", "book-reviews-invite");
      const link = el("a", "", WRITE_SIGN_IN_LABEL);
      link.href = "/account.html";
      invite.appendChild(link);
      host.appendChild(invite);
    }
    if (signedIn) host.appendChild(buildForm(state));
    if (host.querySelector(".book-reviews-invite, .book-reviews-form, .book-reviews-write")) {
      host.appendChild(el("p", "book-reviews-visibility", VISIBILITY_NOTE));
    }
    return host;
  }

  function paintReview(row, state) {
    const item = el("article", "book-reviews-item");
    const reviewId = row && row.id ? String(row.id) : "";
    if (reviewId) item.id = "review-" + reviewId;
    item.appendChild(el("p", "book-reviews-name", row && row.display_name ? String(row.display_name) : "ئەزا"));
    item.appendChild(el("p", "book-reviews-body", row && row.body != null ? String(row.body) : ""));
    if (row && row.heartsKnown) item.appendChild(heartControl(row, state));
    const replies = Array.isArray(row && row.replies) ? row.replies : [];
    if (replies.length) {
      const replyList = el("div", "book-reviews-replies");
      replies.forEach((reply) => {
        const node = el("article", "book-reviews-reply");
        if (reply && reply.id) node.id = "reply-" + String(reply.id);
        node.appendChild(el("p", "book-reviews-name", reply && reply.display_name ? String(reply.display_name) : "ئەزا"));
        node.appendChild(el("p", "book-reviews-body", reply && reply.body != null ? String(reply.body) : ""));
        replyList.appendChild(node);
      });
      item.appendChild(replyList);
    }
    const own = Array.isArray(row && row.ownReplies) ? row.ownReplies : [];
    own.forEach((reply) => {
      if (!reply || reply.status === "approved") return;
      const note = el("p", "book-reviews-note", reply.status === "rejected" ? REPLY_REJECTED : REPLY_PENDING);
      if (reply.body) note.appendChild(document.createTextNode(" " + String(reply.body)));
      item.appendChild(note);
    });
    if (state.signedIn) item.appendChild(buildReplyForm(row, state));
    else {
      const link = el("a", "book-reviews-reply-signin", REPLY_SIGN_IN);
      link.href = "/account.html";
      item.appendChild(link);
    }
    return item;
  }

  function heartControl(row, state) {
    const count = Number(row.heartCount) || 0;
    const mine = !!row.heartMine;
    if (!state.signedIn) {
      const link = el("a", "book-reviews-heart", "♡ " + String(count));
      link.href = "/account.html";
      link.setAttribute("aria-label", "ياقتۇرۇش ئۈچۈن كىرىڭ");
      return link;
    }
    const button = el("button", "book-reviews-heart", (mine ? "♥ " : "♡ ") + String(count));
    button.type = "button";
    button.setAttribute("aria-pressed", mine ? "true" : "false");
    button.setAttribute("aria-label", mine ? "ياقتۇرۇشنى ئېلىش" : "ياقتۇرۇش");
    button.addEventListener("click", () => {
      if (typeof state.onHeart !== "function" || button.disabled) return;
      button.disabled = true;
      Promise.resolve(state.onHeart(row.id, !mine)).then((result) => {
        if (result && result.stale) return;
        if (!(result && result.ok) && button.isConnected) button.disabled = false;
      }, () => {
        if (button.isConnected) button.disabled = false;
      });
    });
    return button;
  }

  function buildReplyForm(row, state) {
    const form = el("form", "book-reviews-reply-form");
    form.hidden = true;
    const opener = el("button", "book-reviews-reply-open", REPLY_LABEL);
    opener.type = "button";
    opener.addEventListener("click", () => {
      form.hidden = false;
      opener.hidden = true;
      const area = form.querySelector("textarea");
      if (area) area.focus();
    });
    const area = document.createElement("textarea");
    area.maxLength = REPLY_MAX;
    area.dir = "rtl";
    area.setAttribute("aria-label", "جاۋاب");
    const counter = el("p", "book-reviews-count", remainingLabel(REPLY_MAX, ""));
    counter.setAttribute("aria-live", "polite");
    area.addEventListener("input", () => {
      counter.textContent = remainingLabel(REPLY_MAX, area.value);
    });
    const button = el("button", "", "يوللاش");
    button.type = "submit";
    const note = el("p", "book-reviews-note", "");
    note.hidden = true;
    form.append(area, counter, button, note);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (button.disabled) return;
      const check = validateReplyBody(area.value);
      if (!check.ok) {
        note.hidden = false;
        note.textContent = check.message;
        return;
      }
      button.disabled = true;
      note.hidden = true;
      Promise.resolve(state.onReply(row.id, check.value)).then((result) => {
        if (result && result.stale) return;
        if (result && result.ok) {
          if (result.refreshFailed && form.isConnected) {
            form.hidden = true;
            opener.hidden = true;
            wrap.append(el("p", "book-reviews-note", REPLY_PENDING), el("p", "book-reviews-note", REPLY_SAVED));
          }
          return;
        }
        button.disabled = false;
        note.hidden = false;
        note.textContent = result && result.message ? result.message : REPLY_FAILED;
      }, () => {
        button.disabled = false;
        note.hidden = false;
        note.textContent = REPLY_FAILED;
      });
    });
    const wrap = el("div", "book-reviews-reply-box");
    wrap.append(opener, form);
    return wrap;
  }

  function appendRetry(host, state) {
    const retry = el("p", "book-reviews-retry");
    const button = el("button", "", RETRY_LABEL);
    button.type = "button";
    button.addEventListener("click", () => {
      if (typeof state.onRetry === "function") state.onRetry();
    });
    retry.appendChild(button);
    host.appendChild(retry);
  }

  function openForm(host) {
    const form = host.querySelector(".book-reviews-form");
    if (!form) return;
    form.hidden = false;
    const invite = host.querySelector(".book-reviews-invite");
    if (invite) invite.hidden = true;
    const opener = host.querySelector(".book-reviews-write");
    if (opener) opener.hidden = true;
    const area = form.querySelector("textarea");
    if (area) area.focus();
  }

  function buildForm(state) {
    const form = el("form", "book-reviews-form");
    form.hidden = true;
    const area = document.createElement("textarea");
    area.name = "body";
    area.maxLength = MAX;
    area.required = true;
    area.dir = "rtl";
    area.setAttribute("aria-label", "ئىنكاس");
    const counter = el("p", "book-reviews-count", remainingLabel(MAX, ""));
    counter.setAttribute("aria-live", "polite");
    area.addEventListener("input", () => {
      counter.textContent = remainingLabel(MAX, area.value);
    });
    const button = el("button", "", "يوللاش");
    button.type = "submit";
    const note = el("p", "book-reviews-note", "");
    note.hidden = true;
    form.append(area, counter, button, note);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.submitLock || button.disabled) return;
      const check = validateReviewBody(area.value);
      if (!check.ok) {
        note.hidden = false;
        note.textContent = check.message;
        return;
      }
      state.submitLock = true;
      button.disabled = true;
      note.hidden = true;
      Promise.resolve(state.onSubmit(check.value)).then((result) => {
        if (result && (result.ok || result.stale)) return;
        state.submitLock = false;
        button.disabled = false;
        note.hidden = false;
        note.textContent = result && result.message ? result.message : SEND_FAILED;
      }, () => {
        state.submitLock = false;
        button.disabled = false;
        note.hidden = false;
        note.textContent = SEND_FAILED;
      });
    });
    return form;
  }

  let paintedKey = "";
  let running = null;
  let submitLock = false;
  let replyLock = false;
  const heartLocks = Object.create(null);
  let forceQueued = false;
  let lastGood = null;
  let operationGeneration = 0;
  let activeMemberId = "";

  function memberApi() {
    return root.KutadguMember || null;
  }

  function viewKey() {
    const doc = root.document;
    const bookId = bookIdFromLocation(root.location);
    const visible = doc ? detailIsPublic(doc) : false;
    const user = memberApi() && typeof memberApi().getUser === "function" ? memberApi().getUser() : null;
    return bookId + "|" + (visible ? "1" : "0") + "|" + (user && user.id ? String(user.id) : "");
  }

  async function waitForMember() {
    const start = Date.now();
    while (!root.KutadguMember && Date.now() - start < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const api = memberApi();
    if (api && api.ready && typeof api.ready.then === "function") {
      try { await api.ready; } catch (error) {}
    }
    return memberApi();
  }

  function currentMemberId() {
    const api = memberApi();
    const user = api && typeof api.getUser === "function" ? api.getUser() : null;
    return user && user.id ? String(user.id) : "";
  }

  function storageKey(bookId, memberId) {
    return String(bookId) + "|" + String(memberId || "");
  }

  function beginOperation(bookId) {
    return {
      bookId: String(bookId || ""),
      memberId: currentMemberId(),
      generation: operationGeneration
    };
  }

  function sameContext(op) {
    if (!op) return false;
    return op.generation === operationGeneration
      && op.memberId === currentMemberId()
      && op.bookId === String(bookIdFromLocation(root.location) || "");
  }

  function previousFor(bookId, memberId) {
    const key = storageKey(bookId, memberId);
    return lastGood && lastGood.key === key ? lastGood : null;
  }

  function remember(op, patch) {
    if (!sameContext(op)) {
      return { reviews: [], reviewsKnown: false, pending: false, rejected: false, ownKnown: false, stale: true };
    }
    const key = storageKey(op.bookId, op.memberId);
    const previous = previousFor(op.bookId, op.memberId);
    const reviewsKnown = !!patch.reviewsKnown || !!(previous && previous.reviewsKnown);
    const ownKnown = !!patch.ownKnown || !!(previous && previous.ownKnown);
    const next = {
      key: key,
      reviews: patch.reviewsKnown ? patch.reviews.slice() : (previous && previous.reviewsKnown ? previous.reviews.slice() : []),
      reviewsKnown: reviewsKnown,
      pending: patch.ownKnown ? !!patch.pending : !!(previous && previous.ownKnown && previous.pending),
      rejected: patch.ownKnown ? !!patch.rejected : !!(previous && previous.ownKnown && previous.rejected),
      ownKnown: ownKnown,
      heartsKnown: !!patch.heartsKnown || !!(previous && previous.heartsKnown),
      hearts: patch.heartsKnown ? patch.hearts : (previous && previous.hearts ? previous.hearts : {}),
      repliesKnown: !!patch.repliesKnown || !!(previous && previous.repliesKnown),
      replies: patch.repliesKnown ? patch.replies.slice() : (previous && previous.replies ? previous.replies.slice() : []),
      ownRepliesKnown: !!patch.ownRepliesKnown || !!(previous && previous.ownRepliesKnown),
      ownReplies: patch.ownRepliesKnown ? patch.ownReplies.slice() : (previous && previous.ownReplies ? previous.ownReplies.slice() : [])
    };
    if (patch.reviewsKnown || patch.ownKnown || previous) lastGood = next;
    return next;
  }

  function stateFromMemory(op, readError) {
    const signedIn = !!op.memberId;
    const stored = remember(op, { reviews: [], reviewsKnown: false, pending: false, rejected: false, ownKnown: false });
    if (stored.stale) return { stale: true };
    return {
      reviews: stored.reviewsKnown ? decorateReviews(stored) : [],
      signedIn: signedIn,
      pending: stored.ownKnown ? stored.pending : false,
      rejected: stored.ownKnown ? stored.rejected : false,
      submitLock: submitLock,
      readError: !!readError,
      unknownReviews: !stored.reviewsKnown,
      ownUnknown: signedIn && !stored.ownKnown
    };
  }

  async function loadState(bookId, op) {
    const context = op || beginOperation(bookId);
    const api = await waitForMember();
    if (!sameContext(context)) return { stale: true };
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    const signedIn = !!context.memberId;
    if (!db || typeof db.from !== "function") return stateFromMemory(context, true);
    const numericId = Number(bookId);
    let approvedFailed = false;
    let approvedRows = [];
    try {
      const approved = await db.from("book_reviews").select("id,display_name,body,created_at").eq("book_id", numericId).eq("status", "approved").order("created_at", { ascending: false }).limit(50);
      if (!sameContext(context)) return { stale: true };
      if (!approved || approved.error || !Array.isArray(approved.data)) approvedFailed = true;
      else approvedRows = approved.data;
    } catch (error) {
      if (!sameContext(context)) return { stale: true };
      approvedFailed = true;
    }
    let pending = false;
    let rejected = false;
    let ownFailed = false;
    if (signedIn) {
      try {
        if (typeof db.rpc !== "function") ownFailed = true;
        else {
          const own = await db.rpc("my_book_review_status", { p_book_id: numericId });
          if (!sameContext(context)) return { stale: true };
          if (!own || own.error) ownFailed = true;
          else if (own.data == null || own.data === "") {
            pending = false;
            rejected = false;
          } else if (own.data === "pending") pending = true;
          else if (own.data === "rejected") rejected = true;
          else ownFailed = true;
        }
      } catch (error) {
        if (!sameContext(context)) return { stale: true };
        ownFailed = true;
      }
    }
    if (!sameContext(context)) return { stale: true };
    let extras = { hearts: {}, heartsKnown: !approvedRows.length, replies: [], repliesKnown: !approvedRows.length, ownReplies: [], ownRepliesKnown: !signedIn || !approvedRows.length };
    if (!approvedFailed && approvedRows.length) {
      extras = await loadExtras(db, context, bookId, approvedRows);
      if (!extras || extras.stale || !sameContext(context)) return { stale: true };
    }
    const stored = remember(context, {
      reviews: approvedRows,
      reviewsKnown: !approvedFailed,
      pending: pending,
      rejected: rejected,
      ownKnown: !signedIn || !ownFailed,
      hearts: extras.hearts,
      heartsKnown: !!extras.heartsKnown,
      replies: extras.replies,
      repliesKnown: !!extras.repliesKnown,
      ownReplies: extras.ownReplies,
      ownRepliesKnown: !!extras.ownRepliesKnown
    });
    if (stored.stale) return { stale: true };
    return {
      reviews: stored.reviewsKnown ? decorateReviews(stored) : [],
      signedIn: signedIn,
      pending: stored.ownKnown ? stored.pending : false,
      rejected: stored.ownKnown ? stored.rejected : false,
      submitLock: submitLock,
      readError: approvedFailed || ownFailed || (approvedRows.length && (!extras.heartsKnown || !extras.repliesKnown || (signedIn && !extras.ownRepliesKnown))),
      unknownReviews: !stored.reviewsKnown,
      ownUnknown: signedIn && !stored.ownKnown
    };
  }

  async function submitReview(bookId, body) {
    const api = memberApi();
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    if (!db || typeof db.from !== "function") return { ok: false, message: SEND_FAILED };
    const inserted = await db.from("book_reviews").insert({ book_id: Number(bookId), body: body });
    const error = inserted && inserted.error;
    if (!error) return { ok: true };
    const code = String(error.code || "");
    const message = String(error.message || "");
    if (code === "23505" || /duplicate|unique/i.test(message)) return { ok: true, duplicate: true };
    if (intervalMessage(error)) return { ok: false, message: INTERVAL_MESSAGE };
    return { ok: false, message: SEND_FAILED };
  }

  function decorateReviews(stored) {
    const replies = Array.isArray(stored.replies) ? stored.replies : [];
    const ownReplies = Array.isArray(stored.ownReplies) ? stored.ownReplies : [];
    const hearts = stored.hearts || {};
    return (stored.reviews || []).map((row) => {
      const id = row && row.id ? String(row.id) : "";
      const heart = hearts[id] || {};
      return Object.assign({}, row, {
        heartsKnown: !!stored.heartsKnown,
        heartCount: heart.count || 0,
        heartMine: !!heart.mine,
        replies: replies.filter((reply) => reply && String(reply.review_id) === id),
        ownReplies: ownReplies.filter((reply) => reply && String(reply.review_id) === id)
      });
    });
  }

  async function loadExtras(db, context, bookId, rows) {
    const ids = rows.map((row) => row && row.id).filter(Boolean);
    const empty = { hearts: {}, heartsKnown: true, replies: [], repliesKnown: true, ownReplies: [], ownRepliesKnown: !context.memberId };
    if (!ids.length) return empty;
    const extras = { hearts: {}, heartsKnown: false, replies: [], repliesKnown: false, ownReplies: [], ownRepliesKnown: !context.memberId };
    try {
      const summary = await db.rpc("book_review_heart_summary", { p_review_ids: ids });
      if (!sameContext(context)) return { stale: true };
      if (summary && !summary.error) {
        extras.heartsKnown = true;
        const list = Array.isArray(summary.data) ? summary.data : [];
        list.forEach((row) => {
          if (!row || !row.review_id) return;
          extras.hearts[String(row.review_id)] = { count: Number(row.heart_count) || 0, mine: !!row.mine };
        });
      }
    } catch (error) {
      if (!sameContext(context)) return { stale: true };
    }
    try {
      let query = db.from("book_review_replies").select("id,review_id,display_name,body,created_at").eq("status", "approved");
      if (typeof query.in === "function") query = query.in("review_id", ids);
      if (typeof query.order === "function") query = query.order("created_at", { ascending: true });
      if (typeof query.limit === "function") query = query.limit(200);
      const result = await query;
      if (!sameContext(context)) return { stale: true };
      if (result && !result.error && Array.isArray(result.data)) {
        extras.repliesKnown = true;
        extras.replies = result.data.filter((row) => row && ids.indexOf(row.review_id) !== -1);
      }
    } catch (error) {
      if (!sameContext(context)) return { stale: true };
    }
    if (context.memberId && typeof db.rpc === "function") {
      try {
        const own = await db.rpc("my_book_review_replies", { p_book_id: Number(bookId) });
        if (!sameContext(context)) return { stale: true };
        if (own && !own.error) {
          extras.ownRepliesKnown = true;
          extras.ownReplies = Array.isArray(own.data) ? own.data : [];
        }
      } catch (error) {
        if (!sameContext(context)) return { stale: true };
      }
    }
    return extras;
  }

  function refresh(options) {
    const force = !!(options && options.force);
    if (running) {
      if (force) forceQueued = true;
      return running;
    }
    running = refreshNow({ force: force }).finally(() => {
      running = null;
      if (forceQueued) {
        forceQueued = false;
        refresh({ force: true });
      }
    });
    return running;
  }

  function retryReviewRead() {
    paintedKey = "";
    return refresh({ force: true });
  }

  async function refreshNow(options) {
    const force = !!(options && options.force);
    const doc = root.document;
    if (!doc) return;
    const page = doc.querySelector(".book-detail-page");
    if (!page) return;
    const bookId = bookIdFromLocation(root.location);
    const op = beginOperation(bookId);
    try {
      const key = viewKey();
      if (!bookId || !detailIsPublic(doc)) {
        if (!force && paintedKey === key) return;
        page.querySelector("[data-book-reviews]")?.remove();
        paintedKey = key;
        return;
      }
      if (!force && key === paintedKey && page.querySelector("[data-book-reviews]")) return;
      if (submitLock || replyLock) return;
      const host = mountHost(page);
      const area = host.querySelector(".book-reviews-form textarea");
      const draft = area && op.memberId && area.value ? area.value : "";
      const formOpen = !!(draft && area && area.form && !area.form.hidden);
      const replyDrafts = [];
      if (op.memberId) {
        host.querySelectorAll(".book-reviews-reply-form textarea").forEach((node) => {
          const review = node.closest(".book-reviews-item");
          if (node.value && review) replyDrafts.push({ id: review.id, value: node.value, open: !!(node.form && !node.form.hidden) });
        });
      }
      if (!force && doc.activeElement && host.contains(doc.activeElement) && doc.activeElement.tagName === "TEXTAREA") return;
      let state;
      try {
        state = await loadState(bookId, op);
      } catch (error) {
        if (!sameContext(op)) return;
        state = stateFromMemory(op, true);
      }
      if (!sameContext(op) || !state || state.stale) return;
      if (submitLock || replyLock) return;
      state.onRetry = retryReviewRead;
      state.onHeart = async (reviewId, want) => {
        const heartOp = beginOperation(bookId);
        if (heartLocks[reviewId]) return { ok: true, duplicate: true };
        heartLocks[reviewId] = true;
        let outcome = { ok: false, message: SEND_FAILED };
        try {
          const api = memberApi();
          const db = api && typeof api.getClient === "function" ? api.getClient() : null;
          if (db && typeof db.rpc === "function") {
            const name = want ? "add_book_review_heart" : "remove_book_review_heart";
            const result = await db.rpc(name, { p_review_id: reviewId });
            if (!sameContext(heartOp)) outcome = { stale: true };
            else if (!(result && result.error)) outcome = { ok: true };
          }
        } catch (error) {
          if (!sameContext(heartOp)) outcome = { stale: true };
        } finally {
          heartLocks[reviewId] = false;
        }
        if (!sameContext(heartOp)) {
          refresh({ force: true });
          return { stale: true };
        }
        if (outcome.ok) {
          paintedKey = "";
          refresh({ force: true });
        }
        return outcome;
      };
      state.onReply = async (reviewId, body) => {
        const replyOp = beginOperation(bookId);
        if (replyLock) return { ok: false, message: REPLY_FAILED };
        replyLock = true;
        try {
          const api = memberApi();
          const db = api && typeof api.getClient === "function" ? api.getClient() : null;
          if (!db || typeof db.from !== "function") return { ok: false, message: REPLY_FAILED };
          const inserted = await db.from("book_review_replies").insert({ review_id: reviewId, body: body });
          if (!sameContext(replyOp)) return { stale: true, ok: !(inserted && inserted.error) };
          const error = inserted && inserted.error;
          if (error) {
            if (intervalMessage(error)) return { ok: false, message: INTERVAL_MESSAGE };
            return { ok: false, message: REPLY_FAILED };
          }
        } catch (error) {
          if (!sameContext(replyOp)) return { stale: true };
          return { ok: false, message: REPLY_FAILED };
        } finally {
          replyLock = false;
        }
        if (!sameContext(replyOp)) {
          paintedKey = "";
          refresh({ force: true });
          return { stale: true, ok: true };
        }
        let refreshFailed = false;
        try {
          const next = await loadState(bookId, replyOp);
          if (!next || next.stale || !sameContext(replyOp)) return { ok: true, saved: true, stale: true };
          const found = (next.reviews || []).some((row) => {
            return String(row.id) === String(reviewId) && (row.ownReplies || []).some((reply) => reply && reply.status === "pending" && reply.body === body);
          });
          refreshFailed = !!next.readError || !found;
        } catch (error) {
          if (!sameContext(replyOp)) return { ok: true, saved: true, stale: true };
          refreshFailed = true;
        }
        if (!sameContext(replyOp)) return { ok: true, saved: true, stale: true };
        paintedKey = "";
        if (!refreshFailed) {
          const currentHost = root.document && root.document.querySelector("[data-book-reviews]");
          const reviewNode = currentHost && currentHost.querySelector("#review-" + reviewId);
          const sent = reviewNode && reviewNode.querySelector(".book-reviews-reply-form textarea");
          if (sent) sent.value = "";
          refresh({ force: true });
        }
        return { ok: true, saved: true, refreshFailed: refreshFailed };
      };
      state.onSubmit = async (body) => {
        const submitOp = beginOperation(bookId);
        if (submitLock) return { ok: false, message: SEND_FAILED };
        submitLock = true;
        try {
          const result = await submitReview(bookId, body);
          if (!sameContext(submitOp)) return { stale: true, ok: !!(result && result.ok) };
          if (!(result && result.ok)) return result || { ok: false, message: SEND_FAILED };
          let next = null;
          let refreshFailed = false;
          try {
            next = await loadState(bookId, submitOp);
            if (!next || next.stale || !sameContext(submitOp)) return { ok: true, saved: true, stale: true };
            refreshFailed = !!next.readError;
          } catch (error) {
            if (!sameContext(submitOp)) return { ok: true, saved: true, stale: true };
            refreshFailed = true;
          }
          if (!sameContext(submitOp)) return { ok: true, saved: true, stale: true };
          const kept = previousFor(submitOp.bookId, submitOp.memberId);
          const reviewsKnown = !!(next && !next.unknownReviews) || !!(kept && kept.reviewsKnown);
          const reviews = next && !next.unknownReviews && Array.isArray(next.reviews)
            ? next.reviews.slice()
            : (kept && kept.reviewsKnown ? kept.reviews.slice() : []);
          remember(submitOp, {
            reviews: reviews,
            reviewsKnown: reviewsKnown,
            pending: true,
            rejected: false,
            ownKnown: true
          });
          if (!sameContext(submitOp)) return { ok: true, saved: true, stale: true };
          paint(host, {
            reviews: reviews,
            signedIn: true,
            pending: true,
            rejected: false,
            readError: refreshFailed,
            refreshFailed: refreshFailed,
            saved: true,
            unknownReviews: false,
            ownUnknown: false,
            onSubmit: state.onSubmit,
            onRetry: state.onRetry
          });
          paintedKey = viewKey();
          return { ok: true, saved: true };
        } catch (error) {
          if (!sameContext(submitOp)) return { stale: true };
          return { ok: false, message: SEND_FAILED };
        } finally {
          submitLock = false;
          if (!sameContext(submitOp)) {
            paintedKey = "";
            refresh({ force: true });
          }
        }
      };
      paint(host, state);
      focusReviewHash(host);
      if (draft && sameContext(op) && currentMemberId() === op.memberId) {
        const nextArea = host.querySelector(".book-reviews-form textarea");
        if (nextArea) {
          nextArea.value = draft;
          if (formOpen) openForm(host);
        }
      }
      if (replyDrafts.length && sameContext(op) && currentMemberId() === op.memberId) {
        replyDrafts.forEach((item) => {
          const review = item.id ? host.querySelector("#" + item.id) : null;
          const nextArea = review && review.querySelector(".book-reviews-reply-form textarea");
          if (!nextArea) return;
          nextArea.value = item.value;
          nextArea.dispatchEvent(new Event("input"));
          if (item.open && nextArea.form) {
            nextArea.form.hidden = false;
            const opener = review.querySelector(".book-reviews-reply-open");
            if (opener) opener.hidden = true;
          }
        });
      }
      if (sameContext(op)) paintedKey = viewKey();
    } catch (error) {
      if (!sameContext(op)) return;
      try {
        if (bookId && detailIsPublic(doc)) {
          const host = mountHost(page);
          const failed = stateFromMemory(op, true);
          if (!failed.stale) {
            failed.onRetry = retryReviewRead;
            paint(host, failed);
            paintedKey = viewKey();
          }
        }
      } catch (ignore) {}
    }
  }

  function focusReviewHash(host) {
    const hash = String(root.location && root.location.hash || "");
    if (hash.indexOf("#review-") !== 0 && hash.indexOf("#reply-") !== 0) return;
    const node = host.querySelector(hash);
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
  }

  function clearMemberDraft(doc) {
    doc.querySelectorAll("[data-book-reviews] textarea").forEach((area) => {
      area.value = "";
    });
    doc.querySelectorAll("[data-book-reviews] form").forEach((form) => {
      form.hidden = true;
    });
  }

  let noticeGeneration = 0;
  let noticeLast = null;
  let noticeFailed = false;
  let noticeOpen = false;
  let noticeMember = "";
  let noticeInflight = null;
  let noticesBound = false;

  function ensureReviewCss() {
    const doc = root.document;
    if (!doc || !doc.head || doc.querySelector("link[href*='book-reviews.css']")) return;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = "/book-reviews.css?v=3";
    doc.head.appendChild(link);
  }

  function renderNoticeBell() {
    const bell = root.document && root.document.querySelector(".book-review-notices");
    if (!bell) return;
    const button = bell.querySelector(".book-review-notices-button");
    const panel = bell.querySelector(".book-review-notices-panel");
    const rows = Array.isArray(noticeLast) ? noticeLast : null;
    const unread = rows ? rows.filter((row) => row && !row.read_at).length : null;
    button.textContent = unread ? ("🔔 " + String(unread)) : "🔔";
    button.setAttribute("aria-expanded", noticeOpen ? "true" : "false");
    button.setAttribute("aria-label", noticeFailed && !rows ? NOTICE_FAILED : (unread ? ("ئۇقتۇرۇشلار " + String(unread)) : "ئۇقتۇرۇشلار"));
    panel.hidden = !noticeOpen;
    panel.replaceChildren();
    if (noticeFailed) {
      const retry = el("button", "", RETRY_LABEL);
      retry.type = "button";
      retry.addEventListener("click", (event) => {
        event.stopPropagation();
        refreshNotices();
      });
      panel.append(el("p", "", NOTICE_FAILED), retry);
    }
    if (!rows) return;
    if (!rows.length && !noticeFailed) panel.appendChild(el("p", "", "ئۇقتۇرۇش يوق."));
    rows.forEach((row) => {
      const item = el("button", "book-review-notice");
      item.type = "button";
      item.append(el("span", "", row && row.book_title ? String(row.book_title) : "كىتاب"), el("span", "", NOTICE_MESSAGE), el("span", "", row && row.excerpt ? String(row.excerpt) : ""));
      item.addEventListener("click", () => openNotice(row));
      panel.appendChild(item);
    });
  }

  function mountNoticeBell() {
    const doc = root.document;
    if (!doc) return;
    const account = doc.querySelector(".kutadgu-public-header a.kutadgu-header-account, a.member-account-button");
    const member = currentMemberId();
    let bell = doc.querySelector(".book-review-notices");
    if (!account || !member) {
      if (bell) bell.remove();
      noticeLast = null;
      noticeFailed = false;
      noticeOpen = false;
      noticeMember = "";
      return;
    }
    if (member !== noticeMember) {
      noticeGeneration += 1;
      noticeLast = null;
      noticeFailed = false;
      noticeOpen = false;
      noticeMember = member;
    }
    if (!bell) {
      bell = el("div", "book-review-notices");
      const button = el("button", "book-review-notices-button", "🔔");
      button.type = "button";
      button.setAttribute("aria-haspopup", "true");
      button.setAttribute("aria-label", "ئۇقتۇرۇشلار");
      button.addEventListener("click", () => {
        noticeOpen = !noticeOpen;
        renderNoticeBell();
      });
      const panel = el("div", "book-review-notices-panel");
      panel.hidden = true;
      bell.append(button, panel);
      account.insertAdjacentElement("beforebegin", bell);
    }
    renderNoticeBell();
  }

  function refreshNotices() {
    if (noticeInflight) return noticeInflight;
    const member = currentMemberId();
    mountNoticeBell();
    if (!member) return Promise.resolve();
    const api = memberApi();
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    if (!db || typeof db.rpc !== "function") {
      noticeFailed = true;
      renderNoticeBell();
      return Promise.resolve();
    }
    const gen = noticeGeneration;
    noticeInflight = (async () => {
      let result = null;
      try {
        result = await db.rpc("my_book_review_notifications");
      } catch (error) {
        result = { error: error };
      }
      if (gen !== noticeGeneration || currentMemberId() !== member) return;
      if (!result || result.error || !Array.isArray(result.data)) {
        noticeFailed = true;
        renderNoticeBell();
        return;
      }
      noticeFailed = false;
      noticeLast = result.data;
      renderNoticeBell();
    })().finally(() => {
      noticeInflight = null;
    });
    return noticeInflight;
  }

  async function openNotice(row) {
    const gen = noticeGeneration;
    const member = currentMemberId();
    const api = memberApi();
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    if (!db || typeof db.rpc !== "function" || !row || !row.id) return;
    let result = null;
    try {
      result = await db.rpc("mark_book_review_notification_read", { p_id: row.id });
    } catch (error) {
      result = { error: error };
    }
    if (gen !== noticeGeneration || currentMemberId() !== member) return;
    if (result && result.error) return;
    if (Array.isArray(noticeLast)) {
      noticeLast = noticeLast.map((item) => item && item.id === row.id ? Object.assign({}, item, { read_at: item.read_at || "read" }) : item);
      renderNoticeBell();
    }
    const bookId = String(row.book_id || "");
    const hash = "#reply-" + String(row.reply_id || "");
    const target = "/book/" + encodeURIComponent(bookId) + hash;
    if (String(bookIdFromLocation(root.location) || "") === bookId) {
      if (root.location && root.location.hash !== hash && root.history && typeof root.history.replaceState === "function") {
        root.history.replaceState(null, "", target);
      }
      const node = root.document && root.document.querySelector(hash);
      if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
      return;
    }
    if (root.location) root.location.assign(target);
  }

  function bootNotices() {
    const doc = root.document;
    if (!doc) return;
    ensureReviewCss();
    if (!noticesBound) {
      noticesBound = true;
      doc.addEventListener("kutadgu-member-change", () => {
        if (currentMemberId() !== noticeMember) noticeGeneration += 1;
        noticeOpen = false;
        mountNoticeBell();
        refreshNotices();
      });
      doc.addEventListener("visibilitychange", () => {
        if (doc.visibilityState === "hidden") {
          noticeGeneration += 1;
          return;
        }
        refreshNotices();
      });
    }
    refreshNotices();
  }

  function boot() {
    bootNotices();
    if (!bookIdFromLocation(root.location)) return;
    const doc = root.document;
    const page = doc && doc.querySelector(".book-detail-page");
    if (!page || typeof MutationObserver !== "function") {
      refresh();
      return;
    }
    const observer = new MutationObserver(() => {
      if (submitLock || replyLock) return;
      if (viewKey() === paintedKey) return;
      refresh();
    });
    observer.observe(page, { childList: true, subtree: true });
    activeMemberId = currentMemberId();
    doc.addEventListener("kutadgu-member-change", () => {
      const nextId = currentMemberId();
      const changed = nextId !== activeMemberId;
      activeMemberId = nextId;
      if (changed) {
        operationGeneration += 1;
        clearMemberDraft(doc);
      }
      paintedKey = "";
      const current = running;
      if (current) {
        current.finally(() => {
          paintedKey = "";
          refresh({ force: true });
        });
        return;
      }
      refresh({ force: changed });
    });
    refresh();
  }

  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }

  return {
    MAX: MAX,
    REPLY_MAX: REPLY_MAX,
    PENDING_MESSAGE: PENDING_MESSAGE,
    INVITE_LABEL: INVITE_LABEL,
    SIGN_IN_LABEL: SIGN_IN_LABEL,
    VISIBILITY_NOTE: VISIBILITY_NOTE,
    textLength: textLength,
    remainingLabel: remainingLabel,
    validateReviewBody: validateReviewBody,
    validateReplyBody: validateReplyBody,
    bookIdFromLocation: bookIdFromLocation,
    detailIsPublic: detailIsPublic,
    paint: paint
  };
});
