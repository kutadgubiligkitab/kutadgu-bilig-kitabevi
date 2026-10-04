(function () {
  const AAL2_MESSAGE = "بۇ مەشغۇلات ئۈچۈن 2-باسقۇچلۇق دەلىللەش (AAL2) كېرەك. قايتا كىرىپ قايتا سىناڭ.";
  const DENIED_MESSAGE = "بۇ مەشغۇلاتقا ئىجازەت يوق.";
  const EMPTY_MESSAGE = "تەستىق ساقلاۋاتقان باھا يوق.";
  let decisionLock = false;

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

  function renderRows(rows) {
    const list = document.querySelector("#bookReviewModerationList");
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "admin-help";
      empty.textContent = EMPTY_MESSAGE;
      list.appendChild(empty);
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement("article");
      item.className = "admin-review-item";
      item.dataset.reviewId = String(row.id || "");
      const title = document.createElement("p");
      title.className = "admin-help";
      const bookId = String(row.book_id || "");
      title.textContent = (row.display_name ? String(row.display_name) : "ئەزا") + " · كىتاب " + bookId;
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
      approve.addEventListener("click", () => decide(row.id, "approved", approve, reject));
      reject.addEventListener("click", () => decide(row.id, "rejected", approve, reject));
      actions.append(approve, reject);
      item.append(title, body, actions);
      list.appendChild(item);
    });
  }

  async function sessionAal(db) {
    if (!db || !db.auth || typeof db.auth.getSession !== "function") return "";
    const result = await db.auth.getSession();
    const session = result && result.data && result.data.session;
    return jwtAal(session && session.access_token);
  }

  async function load() {
    const db = client();
    if (!db) {
      setStatus("باشقۇرغۇچى كىرىشى كېرەك.");
      return;
    }
    const aal = await sessionAal(db);
    if (aal !== "aal2") {
      renderRows([]);
      setStatus(AAL2_MESSAGE);
      return;
    }
    const result = await db.from("book_reviews").select("id,book_id,display_name,body,status,created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(100);
    if (result && result.error) {
      setStatus(DENIED_MESSAGE);
      renderRows([]);
      return;
    }
    const rows = result && Array.isArray(result.data) ? result.data : [];
    renderRows(rows);
    setStatus(rows.length ? "" : EMPTY_MESSAGE);
  }

  function releaseDecision(approve, reject) {
    decisionLock = false;
    if (approve && approve.isConnected) approve.disabled = false;
    if (reject && reject.isConnected) reject.disabled = false;
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
    } catch (error) {
      setStatus(DENIED_MESSAGE);
    } finally {
      releaseDecision(approve, reject);
    }
  }

  window.KutadguAdminReviews = { load: load, jwtAal: jwtAal };
})();
