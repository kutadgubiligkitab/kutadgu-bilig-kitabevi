"use strict";

var advisorUi = (function () {
  var SESSION = /^(?:[a-f0-9]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

  function customerState(status, error) {
    if (status === 413 || error === "payload_too_large") return "سوئال بەك ئۇزۇن. قىسقىراق يېزىڭ.";
    if (error === "advisor_rate_limit") return "بىر ئازدىن كېيىن قايتا سىناڭ.";
    if (error === "advisor_budget") return "بۈگۈنكى مەسلىھەت چېكى توشتى.";
    if (error === "advisor_query") return "سوئالنى ئېنىقراق يېزىڭ.";
    if (status === 503 || error === "disabled" || error === "advisor_unconfigured" || error === "advisor_unavailable" || error === "advisor_catalog_unavailable" || error === "advisor_model_unavailable" || error === "advisor_budget_unavailable") {
      return "مەسلىھەتچى ھازىر ئىشلىمەيدۇ.";
    }
    return "تور ئۇلىنىشىدا مەسىلە چىقتى. قايتا سىناڭ.";
  }

  function safeHref(book) {
    var href = String(book && book.href || "");
    if (/^\/book\/[1-9]\d*$/.test(href) || /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(href)) return href;
    var id = Number(book && book.id);
    if (Number.isInteger(id) && id > 0) return "/book/" + id;
    return "/books";
  }

  function safeImage(value) {
    var text = String(value || "").trim();
    return /^https:\/\/[^\s]+$/i.test(text) ? text : "";
  }

  return { customerState: customerState, safeHref: safeHref, safeImage: safeImage, sessionPattern: SESSION };
}());

if (typeof document !== "undefined") (function () {
  var form = document.getElementById("advisorForm");
  var input = document.getElementById("advisorInput");
  var thread = document.getElementById("advisorThread");
  var status = document.getElementById("advisorStatus");
  var send = document.getElementById("advisorSend");
  var turns = [];
  var sessionId = "";
  var pending = false;
  if (!form || !input || !thread || !status) return;

  function text(tag, value, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value || "";
    return node;
  }

  function addUser(value) {
    var item = document.createElement("li");
    item.appendChild(text("p", value, "advisor-user"));
    thread.appendChild(item);
    item.scrollIntoView({ block: "nearest" });
  }

  function addReply(payload) {
    var item = document.createElement("li");
    item.appendChild(text("p", payload && payload.message, "advisor-reply"));
    var cards = document.createElement("div");
    cards.className = "advisor-cards";
    (payload && payload.books || []).forEach(function (book) {
      if (!book || !book.title) return;
      var link = document.createElement("a");
      link.className = "advisor-card";
      link.href = advisorUi.safeHref(book);
      var imageUrl = advisorUi.safeImage(book.image_url);
      if (imageUrl) {
        var image = document.createElement("img");
        image.src = imageUrl;
        image.alt = "";
        image.width = 72;
        image.height = 96;
        link.appendChild(image);
      }
      var body = document.createElement("div");
      body.appendChild(text("h2", book.title));
      if (book.author) body.appendChild(text("p", book.author));
      if (book.price != null && book.price !== "") body.appendChild(text("p", String(book.price) + " ₺"));
      link.appendChild(body);
      cards.appendChild(link);
    });
    item.appendChild(cards);
    thread.appendChild(item);
    item.scrollIntoView({ block: "nearest" });
  }

  function setPending(value) {
    pending = value;
    if (send) send.disabled = value;
    thread.setAttribute("aria-busy", value ? "true" : "false");
    status.textContent = value ? "ئىزدەۋاتىدۇ…" : status.textContent;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (pending) return;
    var message = String(input.value || "").replace(/\s+/g, " ").trim();
    if (message.length < 2) {
      status.textContent = advisorUi.customerState(400, "advisor_query");
      return;
    }
    input.value = "";
    addUser(message);
    var nextTurns = turns.concat([{ role: "user", content: message }]).slice(-6);
    var payload = { turns: nextTurns };
    if (advisorUi.sessionPattern.test(sessionId)) payload.session_id = sessionId;
    setPending(true);
    fetch("/api/book-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (body) {
        return { status: response.status, ok: response.ok, body: body };
      }).catch(function () {
        return { status: response.status, ok: false, body: null };
      });
    }).then(function (result) {
      setPending(false);
      if (!result.ok || !result.body || result.body.ok !== true) {
        status.textContent = advisorUi.customerState(result.status, result.body && result.body.error);
        return;
      }
      status.textContent = "";
      if (advisorUi.sessionPattern.test(String(result.body.session_id || ""))) sessionId = String(result.body.session_id);
      turns = nextTurns.concat([{ role: "assistant", content: result.body.message || "" }]).slice(-6);
      addReply(result.body);
    }).catch(function () {
      setPending(false);
      status.textContent = advisorUi.customerState(0, "");
    });
  });
}());

if (typeof module === "object" && module && module.exports) module.exports = advisorUi;
