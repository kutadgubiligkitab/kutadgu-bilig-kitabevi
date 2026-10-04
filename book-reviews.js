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
      return host;
    }
    if (state.rejected) host.appendChild(el("p", "book-reviews-note", REJECTED_NOTE));
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
        if (result && result.ok) return;
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

  async function loadState(bookId) {
    const api = await waitForMember();
    const db = api && typeof api.getClient === "function" ? api.getClient() : null;
    const user = api && typeof api.getUser === "function" ? api.getUser() : null;
    const signedIn = !!(user && user.id);
    if (!db || typeof db.from !== "function") {
      return { reviews: [], signedIn: signedIn, pending: false, rejected: false, submitLock: submitLock };
    }
    const numericId = Number(bookId);
    const approved = await db.from("book_reviews").select("id,display_name,body,created_at").eq("book_id", numericId).eq("status", "approved").order("created_at", { ascending: false }).limit(50);
    let pending = false;
    let rejected = false;
    if (signedIn) {
      const own = await db.from("book_reviews").select("id,status").eq("book_id", numericId).in("status", ["pending", "rejected"]);
      const rows = own && Array.isArray(own.data) ? own.data : [];
      pending = rows.some((row) => row && row.status === "pending");
      rejected = !pending && rows.some((row) => row && row.status === "rejected");
    }
    return {
      reviews: approved && Array.isArray(approved.data) ? approved.data : [],
      signedIn: signedIn,
      pending: pending,
      rejected: rejected,
      submitLock: submitLock
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

  function refresh() {
    if (running) return running;
    running = refreshNow().finally(() => {
      running = null;
    });
    return running;
  }

  async function refreshNow() {
    try {
    const doc = root.document;
    if (!doc) return;
    const page = doc.querySelector(".book-detail-page");
    if (!page) return;
    const bookId = bookIdFromLocation(root.location);
    const key = viewKey();
    if (!bookId || !detailIsPublic(doc)) {
      if (paintedKey === key) return;
      page.querySelector("[data-book-reviews]")?.remove();
      paintedKey = key;
      return;
    }
    if (key === paintedKey && page.querySelector("[data-book-reviews]")) return;
    if (submitLock) return;
    const state = await loadState(bookId);
    if (submitLock) return;
    const host = mountHost(page);
    const area = host.querySelector("textarea");
    if (area && doc.activeElement === area) return;
    state.onSubmit = async (body) => {
      submitLock = true;
      const result = await submitReview(bookId, body);
      submitLock = false;
      if (result && result.ok) {
        const next = await loadState(bookId);
        next.pending = true;
        next.onSubmit = state.onSubmit;
        paint(host, next);
        paintedKey = viewKey();
      }
      return result;
    };
    paint(host, state);
    paintedKey = viewKey();
    } catch (error) {
      paintedKey = viewKey();
    }
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
    doc.addEventListener("kutadgu-member-change", () => {
      paintedKey = "";
      const current = running;
      if (current) {
        current.finally(() => {
          paintedKey = "";
          refresh();
        });
        return;
      }
      refresh();
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
