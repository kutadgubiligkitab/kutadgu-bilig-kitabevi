(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) root.KutadguBookReviews = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const MAX = 2000;
  const PENDING_MESSAGE = "باھايىڭىز تەستىقنى ساقلاۋاتىدۇ. تەستىقلانغاندىن كېيىن بۇ كىتاب بېتىدە كۆرۈنىدۇ.";
  const INVITE_LABEL = "تۇنجى باھانى يېزىڭ";
  const SIGN_IN_LABEL = "كىرىپ تۇنجى باھانى يېزىڭ";
  const WRITE_LABEL = "باھا يېزىش";
  const WRITE_SIGN_IN_LABEL = "باھا يېزىش ئۈچۈن كىرىڭ";
  const REJECTED_NOTE = "ئالدىنقى باھا رەت قىلىندى. يېڭى باھا يازالايسىز.";
  const EMPTY_MESSAGE = "باھا يېزىڭ.";
  const LONG_MESSAGE = "باھا 2000 ھەرپتىن ئېشىپ كەتمىسۇن.";
  const SEND_FAILED = "باھا يوللانمىدى. قايتا سىناڭ.";
  const READ_FAILED = "باھالار يۈكلەنمىدى.";
  const RETRY_LABEL = "قايتا سىناش";
  const SAVED_REFRESH_FAILED = "باھا ساقلاندى. كۆرۈنۈش يېڭىلانمىدى.";

  function validateReviewBody(value) {
    const text = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
    if (!text) return { ok: false, reason: "empty", message: EMPTY_MESSAGE, value: "" };
    if (Array.from(text).length > MAX) return { ok: false, reason: "long", message: LONG_MESSAGE, value: text };
    return { ok: true, reason: "", message: "", value: text };
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
      host.setAttribute("aria-label", "كىتاب باھالىرى");
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
        const item = el("article", "book-reviews-item");
        item.appendChild(el("p", "book-reviews-name", row && row.display_name ? String(row.display_name) : "ئەزا"));
        item.appendChild(el("p", "book-reviews-body", row && row.body != null ? String(row.body) : ""));
        list.appendChild(item);
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
    return host;
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
    area.setAttribute("aria-label", "باھا");
    const button = el("button", "", "يوللاش");
    button.type = "submit";
    const note = el("p", "book-reviews-note", "");
    note.hidden = true;
    form.append(area, button, note);
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
      ownKnown: ownKnown
    };
    if (patch.reviewsKnown || patch.ownKnown || previous) lastGood = next;
    return next;
  }

  function stateFromMemory(op, readError) {
    const signedIn = !!op.memberId;
    const stored = remember(op, { reviews: [], reviewsKnown: false, pending: false, rejected: false, ownKnown: false });
    if (stored.stale) return { stale: true };
    return {
      reviews: stored.reviewsKnown ? stored.reviews.slice() : [],
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
    const stored = remember(context, {
      reviews: approvedRows,
      reviewsKnown: !approvedFailed,
      pending: pending,
      rejected: rejected,
      ownKnown: !signedIn || !ownFailed
    });
    if (stored.stale) return { stale: true };
    return {
      reviews: stored.reviewsKnown ? stored.reviews.slice() : [],
      signedIn: signedIn,
      pending: stored.ownKnown ? stored.pending : false,
      rejected: stored.ownKnown ? stored.rejected : false,
      submitLock: submitLock,
      readError: approvedFailed || ownFailed,
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
    return { ok: false, message: SEND_FAILED };
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
      if (submitLock) return;
      const host = mountHost(page);
      const area = host.querySelector("textarea");
      const draft = area && op.memberId && area.value ? area.value : "";
      const formOpen = !!(draft && area && area.form && !area.form.hidden);
      if (!force && area && doc.activeElement === area) return;
      let state;
      try {
        state = await loadState(bookId, op);
      } catch (error) {
        if (!sameContext(op)) return;
        state = stateFromMemory(op, true);
      }
      if (!sameContext(op) || !state || state.stale) return;
      if (submitLock) return;
      state.onRetry = retryReviewRead;
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
      if (draft && sameContext(op) && currentMemberId() === op.memberId) {
        const nextArea = host.querySelector("textarea");
        if (nextArea) {
          nextArea.value = draft;
          if (formOpen) openForm(host);
        }
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

  function clearMemberDraft(doc) {
    const area = doc.querySelector("[data-book-reviews] textarea");
    if (area) area.value = "";
    const form = doc.querySelector("[data-book-reviews] form");
    if (form) form.hidden = true;
  }

  function boot() {
    if (!bookIdFromLocation(root.location)) return;
    const doc = root.document;
    const page = doc && doc.querySelector(".book-detail-page");
    if (!page || typeof MutationObserver !== "function") {
      refresh();
      return;
    }
    const observer = new MutationObserver(() => {
      if (submitLock) return;
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
    PENDING_MESSAGE: PENDING_MESSAGE,
    INVITE_LABEL: INVITE_LABEL,
    SIGN_IN_LABEL: SIGN_IN_LABEL,
    validateReviewBody: validateReviewBody,
    bookIdFromLocation: bookIdFromLocation,
    detailIsPublic: detailIsPublic,
    paint: paint
  };
});
