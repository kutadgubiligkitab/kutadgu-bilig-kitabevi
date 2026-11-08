"use strict";

var advisorUi = (function () {
  var SESSION = /^(?:[a-f0-9]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  var MEMORY_KEY = "kutadgu-book-advisor-v1";

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

  function cleanTurns(turns) {
    var clean = [];
    var list = Array.isArray(turns) ? turns : [];
    for (var i = 0; i < list.length; i += 1) {
      var role = list[i] && list[i].role === "assistant" ? "assistant" : "user";
      var content = String(list[i] && list[i].content || "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (content) clean.push({ role: role, content: content });
    }
    return clean.slice(-6);
  }

  function cleanCards(cards) {
    var out = [];
    var list = Array.isArray(cards) ? cards.slice(0, 6) : [];
    for (var i = 0; i < list.length; i += 1) {
      var card = list[i] || {};
      if (!card.title) continue;
      out.push({
        title: String(card.title).slice(0, 180),
        author: String(card.author || "").slice(0, 180),
        price: card.price == null ? null : card.price,
        href: safeHref(card),
        image_url: safeImage(card.image_url)
      });
    }
    return out;
  }

  function readMemory(storage) {
    var empty = { turns: [], sessionId: "", open: false, entries: [] };
    try {
      var parsed = JSON.parse(storage.getItem(MEMORY_KEY) || "");
      if (!parsed || typeof parsed !== "object") return empty;
      var entries = Array.isArray(parsed.entries) ? parsed.entries.slice(-8) : [];
      return {
        turns: cleanTurns(parsed.turns),
        sessionId: SESSION.test(String(parsed.sessionId || "")) ? String(parsed.sessionId) : "",
        open: parsed.open === true,
        entries: entries.map(function (entry) {
          return {
            role: entry && entry.role === "user" ? "user" : "assistant",
            text: String(entry && entry.text || "").slice(0, 600),
            cards: cleanCards(entry && entry.cards)
          };
        }).filter(function (entry) { return entry.text || entry.cards.length; })
      };
    } catch (_error) {
      return empty;
    }
  }

  function writeMemory(storage, state) {
    var payload = {
      turns: cleanTurns(state && state.turns),
      sessionId: SESSION.test(String(state && state.sessionId || "")) ? String(state.sessionId) : "",
      open: !!(state && state.open),
      entries: (Array.isArray(state && state.entries) ? state.entries : []).slice(-8).map(function (entry) {
        return {
          role: entry.role === "user" ? "user" : "assistant",
          text: String(entry.text || "").slice(0, 600),
          cards: cleanCards(entry.cards)
        };
      })
    };
    var encoded = JSON.stringify(payload);
    if (encoded.length > 24000) {
      payload.entries = payload.entries.slice(-4);
      encoded = JSON.stringify(payload);
    }
    storage.setItem(MEMORY_KEY, encoded);
  }

  return {
    customerState: customerState,
    safeHref: safeHref,
    safeImage: safeImage,
    sessionPattern: SESSION,
    readMemory: readMemory,
    writeMemory: writeMemory
  };
}());

if (typeof document !== "undefined") (function () {
  if (document.getElementById("kutadguAdvisorRoot")) return;
  if (document.querySelector(".admin-shell, .admin-topbar")) return;
  var root = document.createElement("div");
  root.id = "kutadguAdvisorRoot";
  root.className = "kutadgu-advisor";
  root.innerHTML = ''
    + '<button type="button" class="kutadgu-advisor-launcher" aria-label="كىتاب مەسلىھەتچىسى" aria-expanded="false" aria-controls="kutadguAdvisorPanel">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5.5h7.2A2.8 2.8 0 0 1 14 8.3V19a2.2 2.2 0 0 0-2.2-2.2H4z"/><path d="M20 5.5h-7.2A2.8 2.8 0 0 0 10 8.3V19a2.2 2.2 0 0 1 2.2-2.2H20z"/></svg>'
    + '<span class="kutadgu-advisor-sr" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">كىتاب مەسلىھەتچىسى</span></button>'
    + '<section id="kutadguAdvisorPanel" class="kutadgu-advisor-panel" role="dialog" aria-label="كىتاب مەسلىھەتچىسى" hidden>'
    + '<header class="kutadgu-advisor-head"><h2>كىتاب مەسلىھەتچىسى</h2>'
    + '<button type="button" class="kutadgu-advisor-new">يېڭى</button>'
    + '<button type="button" class="kutadgu-advisor-close" aria-label="يېپىش">×</button></header>'
    + '<ol class="kutadgu-advisor-log" aria-live="polite"></ol>'
    + '<p class="kutadgu-advisor-status" role="status"></p>'
    + '<form class="kutadgu-advisor-form"><label class="kutadgu-advisor-sr" for="kutadguAdvisorInput" style="position:absolute;width:1px;height:1px;overflow:hidden">سوئالىڭىز</label>'
    + '<textarea id="kutadguAdvisorInput" rows="1" maxlength="500" placeholder="ئىزدەۋاتقان كىتابىڭىز ياكى سوئالىڭىزنى يېزىڭ..."></textarea>'
    + '<button class="kutadgu-advisor-send" type="submit">يوللاش</button></form></section>';
  document.body.appendChild(root);

  var launcher = root.querySelector(".kutadgu-advisor-launcher");
  var panel = root.querySelector(".kutadgu-advisor-panel");
  var log = root.querySelector(".kutadgu-advisor-log");
  var status = root.querySelector(".kutadgu-advisor-status");
  var form = root.querySelector("form");
  var input = root.querySelector("textarea");
  var send = root.querySelector(".kutadgu-advisor-send");
  var memory = advisorUi.readMemory(window.sessionStorage);
  var turns = memory.turns.slice();
  var entries = memory.entries.slice();
  var sessionId = memory.sessionId;
  var pending = false;

  function text(tag, value, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value || "";
    return node;
  }

  function addEntry(entry) {
    var item = document.createElement("li");
    item.appendChild(text("p", entry.text, entry.role === "user" ? "kutadgu-advisor-bubble kutadgu-advisor-user" : "kutadgu-advisor-bubble kutadgu-advisor-reply"));
    if (entry.cards && entry.cards.length) {
      var cards = document.createElement("div");
      cards.className = "kutadgu-advisor-cards";
      entry.cards.forEach(function (book) {
        var link = document.createElement("a");
        link.className = "kutadgu-advisor-card";
        link.href = advisorUi.safeHref(book);
        var imageUrl = advisorUi.safeImage(book.image_url);
        if (imageUrl) {
          var image = document.createElement("img");
          image.src = imageUrl;
          image.alt = "";
          image.width = 52;
          image.height = 72;
          link.appendChild(image);
        }
        var body = document.createElement("div");
        body.appendChild(text("h3", book.title));
        if (book.author) body.appendChild(text("p", book.author));
        if (book.price != null && book.price !== "") body.appendChild(text("p", String(book.price) + " ₺"));
        link.appendChild(body);
        cards.appendChild(link);
      });
      item.appendChild(cards);
    }
    log.appendChild(item);
  }

  function paint() {
    log.replaceChildren();
    if (!entries.length) addEntry({ role: "assistant", text: "ئەسسالامۇ ئەلەيكۇم! قانداق كىتاب ئىزدەۋاتىسىز؟", cards: [] });
    entries.forEach(addEntry);
    log.scrollTop = log.scrollHeight;
  }

  function persist() {
    try {
      advisorUi.writeMemory(window.sessionStorage, { turns: turns, sessionId: sessionId, open: root.classList.contains("is-open"), entries: entries });
    } catch (_error) { /* storage can be unavailable */ }
  }

  function setOpen(open) {
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      panel.removeAttribute("hidden");
      panel.getBoundingClientRect();
      root.classList.add("is-open");
    } else {
      root.classList.remove("is-open");
      window.setTimeout(function () { if (!root.classList.contains("is-open")) panel.setAttribute("hidden", ""); }, 260);
    }
    persist();
    if (open) input.focus();
  }

  function syncKeyboard() {
    var viewport = window.visualViewport;
    if (!viewport) return;
    var top = Math.max(0, viewport.offsetTop || 0);
    var keyboard = Math.max(0, window.innerHeight - viewport.height - top);
    root.style.setProperty("--advisor-viewport-top", top + "px");
    root.style.setProperty("--advisor-keyboard", keyboard + "px");
  }

  launcher.addEventListener("click", function () { setOpen(!root.classList.contains("is-open")); });
  root.querySelector(".kutadgu-advisor-close").addEventListener("click", function () { setOpen(false); });
  root.querySelector(".kutadgu-advisor-new").addEventListener("click", function () {
    turns = [];
    entries = [];
    sessionId = "";
    status.textContent = "";
    paint();
    persist();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncKeyboard);
    window.visualViewport.addEventListener("scroll", syncKeyboard);
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
    entries.push({ role: "user", text: message, cards: [] });
    var nextTurns = turns.concat([{ role: "user", content: message }]).slice(-6);
    paint();
    pending = true;
    send.disabled = true;
    log.setAttribute("aria-busy", "true");
    status.textContent = "ئىزدەۋاتىدۇ…";
    var payload = { turns: nextTurns };
    if (advisorUi.sessionPattern.test(sessionId)) payload.session_id = sessionId;
    fetch("/api/book-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (body) {
        return { status: response.status, ok: response.ok, body: body };
      }).catch(function () { return { status: response.status, ok: false, body: null }; });
    }).then(function (result) {
      pending = false;
      send.disabled = false;
      log.setAttribute("aria-busy", "false");
      if (!result.ok || !result.body || result.body.ok !== true) {
        entries.pop();
        paint();
        status.textContent = advisorUi.customerState(result.status, result.body && result.body.error);
        persist();
        return;
      }
      status.textContent = "";
      if (advisorUi.sessionPattern.test(String(result.body.session_id || ""))) sessionId = String(result.body.session_id);
      turns = nextTurns.concat([{ role: "assistant", content: result.body.message || "" }]).slice(-6);
      entries.push({ role: "assistant", text: result.body.message || "", cards: result.body.books || [] });
      paint();
      persist();
    }).catch(function () {
      pending = false;
      send.disabled = false;
      log.setAttribute("aria-busy", "false");
      entries.pop();
      paint();
      status.textContent = advisorUi.customerState(0, "");
      persist();
    });
  });
  paint();
  if (memory.open || document.body.dataset.advisorOpen === "1") setOpen(true);
}());

if (typeof module === "object" && module && module.exports) module.exports = advisorUi;
