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
  const NOTICE_MISSING = "بۇ جاۋاب تېپىلمىدى.";
  const HEART_FAILED = "ياقتۇرۇش يوللانمىدى. قايتا سىناڭ.";

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
    const saved = typeof state.savedBodies === "function" ? state.savedBodies(reviewId) : [];
    saved.forEach((body) => {
      if (own.some((reply) => reply && reply.body === body)) return;
      item.appendChild(el("p", "book-reviews-note", REPLY_PENDING));
      const kept = el("p", "book-reviews-note", REPLY_SAVED);
      kept.appendChild(document.createTextNode(" " + String(body)));
      item.appendChild(kept);
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
      const showFailure = (message) => {
        if (!button.isConnected) return;
        button.disabled = false;
        const host = button.parentElement;
        if (!host) return;
        let note = host.querySelector(".book-reviews-heart-note");
        if (!note) {
          note = el("p", "book-reviews-note book-reviews-heart-note", message || HEART_FAILED);
          button.insertAdjacentElement("afterend", note);
          return;
        }
        note.hidden = false;
        note.textContent = message || HEART_FAILED;
      };
      Promise.resolve(state.onHeart(row.id, !mine)).then((result) => {
        if (result && result.stale) return;
        if (result && result.ok) return;
        showFailure(result && result.message);
      }, () => showFailure(HEART_FAILED));
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
      if (typeof state.replyAlreadySaved === "function" && state.replyAlreadySaved(row.id, check.value)) {
        note.hidden = false;
        note.textContent = REPLY_SAVED;
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
            const pending = el("p", "book-reviews-note", REPLY_PENDING);
            const saved = el("p", "book-reviews-note", REPLY_SAVED);
            saved.appendChild(document.createTextNode(" " + check.value));
            const retry = el("button", "", RETRY_LABEL);
            retry.type = "button";
            retry.addEventListener("click", () => {
              if (typeof state.onRetry === "function") state.onRetry();
            });
            wrap.append(pending, saved, retry);
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
  let refreshAfterLock = false;
  const savedReplies = [];
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

  function savedMatch(memberId, bookId, reviewId, body) {
    return savedReplies.find((item) => item.memberId === String(memberId || "") && item.bookId === String(bookId || "") && item.reviewId === String(reviewId || "") && item.body === body);
  }

  function rememberSavedReply(op, reviewId, body) {
    if (!op || !op.memberId || savedMatch(op.memberId, op.bookId, reviewId, body)) return;
    savedReplies.push({ memberId: String(op.memberId), bookId: String(op.bookId), reviewId: String(reviewId), body: body });
  }

  function savedBodies(memberId, bookId, reviewId) {
    return savedReplies.filter((item) => item.memberId === String(memberId || "") && item.bookId === String(bookId || "") && item.reviewId === String(reviewId || "")).map((item) => item.body);
  }

  function reconcileSavedReplies(op, stored) {
    if (!op || !op.memberId || !stored) return;
    const own = stored.ownRepliesKnown && Array.isArray(stored.ownReplies) ? stored.ownReplies : [];
    const replies = stored.repliesKnown && Array.isArray(stored.replies) ? stored.replies : [];
    if (!stored.ownRepliesKnown && !stored.repliesKnown) return;
    for (let index = savedReplies.length - 1; index >= 0; index -= 1) {
      const item = savedReplies[index];
      if (item.memberId !== String(op.memberId) || item.bookId !== String(op.bookId)) continue;
      const seen = (stored.ownRepliesKnown && own.some((row) => row && String(row.review_id) === item.reviewId && row.body === item.body))
        || (stored.repliesKnown && replies.some((row) => row && String(row.review_id) === item.reviewId && row.body === item.body));
      if (seen) savedReplies.splice(index, 1);
    }
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
    const approvedEmpty = !approvedFailed && !approvedRows.length;
    let extras = {
      hearts: {},
      heartsKnown: approvedEmpty,
      replies: [],
      repliesKnown: approvedEmpty,
      ownReplies: [],
      ownRepliesKnown: !signedIn || approvedEmpty
    };
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
    reconcileSavedReplies(context, stored);
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
      if (summary && !summary.error && Array.isArray(summary.data)) {
        extras.heartsKnown = true;
        summary.data.forEach((row) => {
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
        if (own && !own.error && Array.isArray(own.data)) {
          extras.ownRepliesKnown = true;
          extras.ownReplies = own.data;
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
      if (submitLock || replyLock) {
        refreshAfterLock = true;
        return;
      }
      const host = mountHost(page);
      const area = host.querySelector(".book-reviews-form textarea");
      const draft = area && op.memberId && area.value ? area.value : "";
      const formOpen = !!(draft && area && area.form && !area.form.hidden);
      const replyDrafts = [];
      if (op.memberId) {
        host.querySelectorAll(".book-reviews-reply-form textarea").forEach((node) => {
          const review = node.closest(".book-reviews-item");
          const reviewId = review && review.id.indexOf("review-") === 0 ? review.id.slice("review-".length) : "";
          if (node.value && review && !savedMatch(op.memberId, op.bookId, reviewId, node.value)) {
            replyDrafts.push({ id: review.id, reviewId: reviewId, value: node.value, open: !!(node.form && !node.form.hidden) });
          }
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
      if (submitLock || replyLock) {
        refreshAfterLock = true;
        return;
      }
      state.onRetry = retryReviewRead;
      state.savedBodies = (reviewId) => savedBodies(op.memberId, op.bookId, reviewId);
      state.replyAlreadySaved = (reviewId, body) => !!savedMatch(op.memberId, op.bookId, reviewId, body);
      state.onHeart = async (reviewId, want) => {
        const heartOp = beginOperation(bookId);
        if (heartLocks[reviewId]) return { ok: true, duplicate: true };
        heartLocks[reviewId] = true;
        let outcome = { ok: false, message: HEART_FAILED };
        try {
          const api = memberApi();
          const db = api && typeof api.getClient === "function" ? api.getClient() : null;
          if (db && typeof db.rpc === "function") {
            const name = want ? "add_book_review_heart" : "remove_book_review_heart";
            const result = await db.rpc(name, { p_review_id: reviewId });
            if (!sameContext(heartOp)) outcome = { stale: true };
            else if (!(result && result.error)) outcome = { ok: true };
            else outcome = { ok: false, message: HEART_FAILED };
          }
        } catch (error) {
          if (!sameContext(heartOp)) outcome = { stale: true };
          else outcome = { ok: false, message: HEART_FAILED };
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
        if (savedMatch(replyOp.memberId, replyOp.bookId, reviewId, body)) {
          return { ok: true, saved: true, refreshFailed: true, duplicate: true };
        }
        replyLock = true;
        let failed = null;
        let insertedOk = false;
        try {
          const api = memberApi();
          const db = api && typeof api.getClient === "function" ? api.getClient() : null;
          if (!db || typeof db.from !== "function") failed = { ok: false, message: REPLY_FAILED };
          else {
            const inserted = await db.from("book_review_replies").insert({ review_id: reviewId, body: body });
            const error = inserted && inserted.error;
            if (error) {
              if (!sameContext(replyOp)) failed = { stale: true, ok: false };
              else if (intervalMessage(error)) failed = { ok: false, message: INTERVAL_MESSAGE };
              else failed = { ok: false, message: REPLY_FAILED };
            } else {
              insertedOk = true;
              if (sameContext(replyOp)) rememberSavedReply(replyOp, reviewId, body);
            }
          }
        } catch (error) {
          if (!sameContext(replyOp)) failed = { stale: true, ok: false };
          else failed = { ok: false, message: REPLY_FAILED };
        } finally {
          replyLock = false;
        }
        const queued = refreshAfterLock;
        refreshAfterLock = false;
        if (!sameContext(replyOp)) {
          paintedKey = "";
          refresh({ force: true });
          return failed || { stale: true, ok: insertedOk };
        }
        if (failed) {
          if (queued) {
            paintedKey = "";
            refresh({ force: true });
          }
          return failed;
        }
        let refreshFailed = false;
        try {
          const next = await loadState(bookId, replyOp);
          if (!next || next.stale || !sameContext(replyOp)) {
            paintedKey = "";
            refresh({ force: true });
            return { ok: true, saved: true, stale: true };
          }
          const found = (next.reviews || []).some((row) => {
            return String(row.id) === String(reviewId) && (row.ownReplies || []).some((reply) => reply && reply.status === "pending" && reply.body === body);
          });
          refreshFailed = !!next.readError || !found;
        } catch (error) {
          if (!sameContext(replyOp)) {
            paintedKey = "";
            refresh({ force: true });
            return { ok: true, saved: true, stale: true };
          }
          refreshFailed = true;
        }
        if (!sameContext(replyOp)) {
          paintedKey = "";
          refresh({ force: true });
          return { ok: true, saved: true, stale: true };
        }
        paintedKey = "";
        if (!refreshFailed) {
          const currentHost = root.document && root.document.querySelector("[data-book-reviews]");
          const reviewNode = currentHost && currentHost.querySelector("#review-" + reviewId);
          const sent = reviewNode && reviewNode.querySelector(".book-reviews-reply-form textarea");
          if (sent) sent.value = "";
          refresh({ force: true });
        } else if (queued) {
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
          if (!sameContext(submitOp) || refreshAfterLock) {
            refreshAfterLock = false;
            paintedKey = "";
            refresh({ force: true });
          }
        }
      };
      paint(host, state);
      void resolveHashedTarget(op);
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
            failed.savedBodies = (reviewId) => savedBodies(op.memberId, op.bookId, reviewId);
            failed.replyAlreadySaved = (reviewId, body) => !!savedMatch(op.memberId, op.bookId, reviewId, body);
            paint(host, failed);
            void resolveHashedTarget(op);
            paintedKey = viewKey();
          }
        }
      } catch (ignore) {}
    }
  }

  function revealTarget(node) {
    if (!node || !node.isConnected) return false;
    const body = node.querySelector(".book-reviews-body");
    if (!body || !String(body.textContent || "").trim()) return false;
    node.classList.add("book-reviews-target");
    if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
    if (typeof node.focus === "function") {
      try { node.focus({ preventScroll: true }); } catch (error) { node.focus(); }
    }
    if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function showNoticeProblem(message) {
    noticeOpen = true;
    renderNoticeBell();
    const panel = root.document && root.document.querySelector(".book-review-notices-panel");
    if (!panel) return;
    panel.hidden = false;
    panel.appendChild(el("p", "book-review-notice-error", message));
  }

  function showMissingTarget(host) {
    if (!host || host.querySelector(".book-review-notice-error")) return;
    host.appendChild(el("p", "book-reviews-note book-review-notice-error", NOTICE_MISSING));
  }

  function appendPublicTarget(host, target) {
    const reviewId = String(target.review_id || "");
    const replyId = String(target.reply_id || "");
    if (!reviewId || !replyId) return null;
    let list = host.querySelector(".book-reviews-list");
    if (!list) {
      list = el("div", "book-reviews-list");
      host.insertBefore(list, host.firstChild);
    }
    let review = host.querySelector("#review-" + reviewId);
    if (!review) {
      review = el("article", "book-reviews-item");
      review.id = "review-" + reviewId;
      review.appendChild(el("p", "book-reviews-name", target.review_display_name ? String(target.review_display_name) : "ئەزا"));
      review.appendChild(el("p", "book-reviews-body", target.review_body != null ? String(target.review_body) : ""));
      list.appendChild(review);
    }
    let reply = host.querySelector("#reply-" + replyId);
    if (!reply) {
      let replyList = review.querySelector(".book-reviews-replies");
      if (!replyList) {
        replyList = el("div", "book-reviews-replies");
        review.appendChild(replyList);
      }
      reply = el("article", "book-reviews-reply");
      reply.id = "reply-" + replyId;
      reply.appendChild(el("p", "book-reviews-name", target.reply_display_name ? String(target.reply_display_name) : "ئەزا"));
      reply.appendChild(el("p", "book-reviews-body", target.reply_body != null ? String(target.reply_body) : ""));
      replyList.appendChild(reply);
    }
    return reply;
  }

  function rememberLoadedTarget(target) {
    if (!target || target.reply_id == null || target.reply_body == null || target.review_id == null) return;
    loadedTargets[String(target.reply_id)] = {
      review_id: target.review_id,
      review_display_name: target.review_display_name,
      review_body: target.review_body,
      reply_id: target.reply_id,
      reply_display_name: target.reply_display_name,
      reply_body: target.reply_body,
      book_id: target.book_id
    };
  }

  async function fetchReplyTarget(db, replyId) {
    if (!db || typeof db.rpc !== "function" || !replyId) return null;
    try {
      const result = await db.rpc("public_book_review_reply_target", { p_reply_id: replyId });
      if (!result || result.error || !Array.isArray(result.data) || !result.data.length) return null;
      const row = result.data[0];
      if (!row || !row.reply_id || row.reply_body == null || !row.review_id) return null;
      return row;
    } catch (error) {
      return null;
    }
  }

  function readStoredNotice() {
    try {
      if (!root.sessionStorage) return null;
      return JSON.parse(root.sessionStorage.getItem("kutadgu-review-notice-v1") || "null");
    } catch (error) {
      return null;
    }
  }

  function writeStoredNotice(value) {
    try {
      if (!root.sessionStorage) return;
      if (!value) root.sessionStorage.removeItem("kutadgu-review-notice-v1");
      else root.sessionStorage.setItem("kutadgu-review-notice-v1", JSON.stringify(value));
    } catch (error) {}
  }

  async function markNoticeRead(db, row, gen, member) {
    if (!db || !row || !row.id) return false;
    let result = null;
    try {
      result = await db.rpc("mark_book_review_notification_read", { p_id: row.id });
    } catch (error) {
      result = { error: error };
    }
    if (gen !== noticeGeneration || currentMemberId() !== member) return false;
    if (!result || result.error) return false;
    if (Array.isArray(noticeLast)) {
      noticeLast = noticeLast.map((item) => item && item.id === row.id ? Object.assign({}, item, { read_at: item.read_at || "read" }) : item);
      renderNoticeBell();
    }
    return true;
  }

  async function completeStoredNotice(replyId) {
    const stored = readStoredNotice();
    const member = currentMemberId();
    if (!stored || String(stored.replyId) !== String(replyId) || String(stored.memberId || "") !== member) return false;
    const api = memberApi();
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    const ok = await markNoticeRead(db, { id: stored.id }, noticeGeneration, member);
    if (ok) writeStoredNotice(null);
    return ok;
  }

  async function resolveHashedTarget(op) {
    const hash = String(root.location && root.location.hash || "");
    if (hash.indexOf("#reply-") !== 0 && hash.indexOf("#review-") !== 0) return;
    const doc = root.document;
    const page = doc && doc.querySelector(".book-detail-page");
    if (!page || !detailIsPublic(doc)) return;
    const host = mountHost(page);
    if (hash.indexOf("#review-") === 0) {
      const review = host.querySelector(hash);
      if (review) revealTarget(review);
      else showMissingTarget(host);
      return;
    }
    const replyId = decodeURIComponent(hash.slice("#reply-".length));
    const existing = host.querySelector("#reply-" + replyId);
    if (existing && revealTarget(existing)) {
      await completeStoredNotice(replyId);
      return;
    }
    const cached = loadedTargets[replyId];
    const here = String(bookIdFromLocation(root.location) || "");
    if (cached && String(cached.book_id) === here) {
      const cachedNode = appendPublicTarget(host, cached);
      if (cachedNode && revealTarget(cachedNode)) {
        await completeStoredNotice(replyId);
        return;
      }
    }
    const api = await waitForMember();
    if (op && !sameContext(op)) return;
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    const target = await fetchReplyTarget(db, replyId);
    if (op && !sameContext(op)) return;
    if (!target || String(target.book_id) !== here) {
      showMissingTarget(host);
      return;
    }
    rememberLoadedTarget(target);
    const node = appendPublicTarget(host, target);
    if (!node || !revealTarget(node)) {
      showMissingTarget(host);
      return;
    }
    await completeStoredNotice(replyId);
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
  let noticeQueued = false;
  let noticesBound = false;
  const loadedTargets = {};

  function ensureReviewCss() {
    const doc = root.document;
    if (!doc || !doc.head || doc.querySelector("link[href*='book-reviews.css']")) return;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = "/book-reviews.css?v=4";
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
    placeNoticeBell(bell, account);
    renderNoticeBell();
  }

  function placeNoticeBell(bell, account) {
    if (!bell || !account) return;
    const header = account.closest("header");
    const narrow = !!(header && root.matchMedia && root.matchMedia("(max-width: 768px)").matches);
    if (narrow) {
      if (bell.parentElement !== header) header.insertBefore(bell, header.firstChild);
      return;
    }
    if (bell.nextElementSibling !== account) account.insertAdjacentElement("beforebegin", bell);
  }

  function refreshNotices() {
    if (noticeInflight) {
      noticeQueued = true;
      return noticeInflight;
    }
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
      if (noticeQueued) {
        noticeQueued = false;
        refreshNotices();
      }
    });
    return noticeInflight;
  }

  async function openNotice(row) {
    const gen = noticeGeneration;
    const member = currentMemberId();
    const api = memberApi();
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    if (!db || typeof db.rpc !== "function" || !row || !row.id || !row.reply_id) {
      showNoticeProblem(NOTICE_MISSING);
      return;
    }
    const target = await fetchReplyTarget(db, row.reply_id);
    if (gen !== noticeGeneration || currentMemberId() !== member) return;
    if (!target || (row.book_id && String(target.book_id) !== String(row.book_id))) {
      showNoticeProblem(NOTICE_MISSING);
      return;
    }
    rememberLoadedTarget(target);
    const bookId = String(target.book_id || "");
    const hash = "#reply-" + String(target.reply_id);
    const here = String(bookIdFromLocation(root.location) || "");
    if (here === bookId) {
      const page = root.document && root.document.querySelector(".book-detail-page");
      const host = page ? mountHost(page) : null;
      const node = host ? appendPublicTarget(host, target) : null;
      if (!node || !revealTarget(node)) {
        showNoticeProblem(NOTICE_MISSING);
        return;
      }
      const url = "/book/" + encodeURIComponent(bookId) + hash;
      if (root.history && typeof root.history.replaceState === "function") root.history.replaceState(null, "", url);
      await markNoticeRead(db, row, gen, member);
      return;
    }
    writeStoredNotice({ id: row.id, replyId: String(target.reply_id), bookId: bookId, memberId: member });
    if (root.location) root.location.assign("/book/" + encodeURIComponent(bookId) + hash);
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
      const place = () => {
        const account = doc.querySelector(".kutadgu-public-header a.kutadgu-header-account, a.member-account-button");
        const bell = doc.querySelector(".book-review-notices");
        placeNoticeBell(bell, account);
      };
      root.addEventListener("resize", place);
      if (root.matchMedia) {
        const media = root.matchMedia("(max-width: 768px)");
        if (typeof media.addEventListener === "function") media.addEventListener("change", place);
      }
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
      if (submitLock || replyLock) {
        refreshAfterLock = true;
        return;
      }
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
