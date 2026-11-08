"use strict";

(function () {
  var form = document.getElementById("advisorForm");
  var input = document.getElementById("advisorInput");
  var thread = document.getElementById("advisorThread");
  var status = document.getElementById("advisorStatus");
  var turns = [];
  if (!form || !input || !thread) return;

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
  }

  function addReply(payload) {
    var item = document.createElement("li");
    item.appendChild(text("p", payload && payload.message, "advisor-reply"));
    var cards = document.createElement("div");
    cards.className = "advisor-cards";
    (payload && payload.books || []).forEach(function (book) {
      var link = document.createElement("a");
      link.className = "advisor-card";
      link.href = book.href || ("/book/" + book.id);
      if (book.image_url) {
        var image = document.createElement("img");
        image.src = book.image_url;
        image.alt = "";
        link.appendChild(image);
      }
      var body = document.createElement("div");
      body.appendChild(text("h2", book.title));
      body.appendChild(text("p", book.author));
      if (book.price != null) body.appendChild(text("p", String(book.price) + " ₺"));
      link.appendChild(body);
      cards.appendChild(link);
    });
    item.appendChild(cards);
    thread.appendChild(item);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var message = String(input.value || "").replace(/\s+/g, " ").trim();
    if (message.length < 2) return;
    input.value = "";
    addUser(message);
    turns.push({ role: "user", content: message });
    status.textContent = "ئىزدەۋاتىدۇ…";
    fetch("/api/book-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns: turns.slice(-6) })
    }).then(function (response) {
      return response.json().then(function (body) {
        return { ok: response.ok, body: body };
      });
    }).then(function (result) {
      if (!result.ok || !result.body || result.body.ok !== true) {
        status.textContent = "مەسلىھەتچى ھازىر ئىشلىمەيدۇ.";
        return;
      }
      status.textContent = "";
      addReply(result.body);
      turns.push({ role: "assistant", content: result.body.message || "" });
    }).catch(function () {
      status.textContent = "مەسلىھەتچى ھازىر ئىشلىمەيدۇ.";
    });
  });
}());
