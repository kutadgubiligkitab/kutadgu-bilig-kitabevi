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

  function nextSize(current, mobile) {
    if (mobile) return current === "full" ? "compact" : "full";
    if (current === "large") return "full";
    if (current === "full") return "compact";
    return "large";
  }

  function clampPanel(width, height) {
    var viewWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
    var viewHeight = typeof window !== "undefined" ? window.innerHeight : 800;
    var maxWidth = Math.max(320, viewWidth - 24);
    var maxHeight = Math.max(360, viewHeight - 24);
    return {
      width: Math.min(maxWidth, Math.max(320, Math.round(width))),
      height: Math.min(maxHeight, Math.max(360, Math.round(height)))
    };
  }

  function safeWhatsApp(value) {
    var href = String(value && value.href || "");
    if (!/^https:\/\/wa\.me\/905368999888\?text=/.test(href) || href.length > 900) return null;
    var text = "";
    try { text = decodeURIComponent(href.slice(href.indexOf("text=") + 5)); } catch (_error) { return null; }
    if (text.indexOf("ئەسسالامۇ ئەلەيكۇم، مەن قۇتادغۇبىلىگ كىتابخانىسىنىڭ كىتاب مەسلىھەتچىسى ئارقىلىق كەلدىم.") !== 0) return null;
    if (/\d{5,}|@|ئادرېس|زاكاز/.test(text)) return null;
    return { label: "WhatsApp ئارقىلىق ئالاقىلىشىش", href: href };
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

  function cleanToken(value) {
    var token = String(value || "");
    return /^[A-Za-z0-9_-]{8,500}\.[a-f0-9]{64}$/.test(token) ? token : "";
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
    var empty = { turns: [], sessionId: "", constraintToken: "", open: false, entries: [], size: "compact" };
    try {
      var parsed = JSON.parse(storage.getItem(MEMORY_KEY) || "");
      if (!parsed || typeof parsed !== "object") return empty;
      var entries = Array.isArray(parsed.entries) ? parsed.entries.slice(-8) : [];
      return {
        turns: cleanTurns(parsed.turns),
        sessionId: SESSION.test(String(parsed.sessionId || "")) ? String(parsed.sessionId) : "",
        constraintToken: cleanToken(parsed.constraintToken),
        open: parsed.open === true,
        size: parsed.size === "large" || parsed.size === "full" ? parsed.size : "compact",
        entries: entries.map(function (entry) {
          return {
            role: entry && entry.role === "user" ? "user" : "assistant",
            text: String(entry && entry.text || "").slice(0, 600),
            cards: cleanCards(entry && entry.cards),
            handoff: safeWhatsApp(entry && entry.handoff)
          };
        }).filter(function (entry) { return entry.text || entry.cards.length || entry.handoff; })
      };
    } catch (_error) {
      return empty;
    }
  }

  function writeMemory(storage, state) {
    var payload = {
      turns: cleanTurns(state && state.turns),
      sessionId: SESSION.test(String(state && state.sessionId || "")) ? String(state.sessionId) : "",
      constraintToken: cleanToken(state && state.constraintToken),
      open: !!(state && state.open),
      size: state && (state.size === "large" || state.size === "full") ? state.size : "compact",
      entries: (Array.isArray(state && state.entries) ? state.entries : []).slice(-8).map(function (entry) {
        return {
          role: entry.role === "user" ? "user" : "assistant",
          text: String(entry.text || "").slice(0, 600),
          cards: cleanCards(entry.cards),
          handoff: safeWhatsApp(entry.handoff)
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
    safeWhatsApp: safeWhatsApp,
    nextSize: nextSize,
    clampPanel: clampPanel,
    cleanTurns: cleanTurns,
    sessionPattern: SESSION,
    readMemory: readMemory,
    writeMemory: writeMemory
  };
}());

function mountAdvisor() {
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
    + '<button type="button" class="kutadgu-advisor-size" aria-label="چوڭايتىش">⛶</button>'
    + '<button type="button" class="kutadgu-advisor-close" aria-label="يېپىش">×</button></header>'
    + '<div class="kutadgu-advisor-tools"><button type="button" class="kutadgu-advisor-new">يېڭى سۆھبەت</button>'
    + '<button type="button" class="kutadgu-advisor-clear">سۆھبەت خاتىرىسىنى ئۆچۈرۈش</button></div>'
    + '<p class="kutadgu-advisor-confirm" hidden>سۆھبەت خاتىرىسى ئۆچسۇنمۇ؟ '
    + '<button type="button" class="kutadgu-advisor-confirm-yes">ھەئە</button>'
    + '<button type="button" class="kutadgu-advisor-confirm-no">ياق</button></p>'
    + '<button type="button" class="kutadgu-advisor-resize" aria-label="چوڭلۇقىنى ئۆزگەرتىش"></button>'
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
  var constraintToken = memory.constraintToken;
  var pending = false;
  var generation = 0;
  var size = memory.size || "compact";

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
    var handoff = advisorUi.safeWhatsApp(entry.handoff);
    if (handoff) {
      var contact = document.createElement("a");
      contact.className = "kutadgu-advisor-whatsapp";
      contact.href = handoff.href;
      contact.target = "_blank";
      contact.rel = "noopener noreferrer";
      contact.textContent = handoff.label;
      item.appendChild(contact);
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
      advisorUi.writeMemory(window.sessionStorage, { turns: turns, sessionId: sessionId, constraintToken: constraintToken, open: root.classList.contains("is-open"), entries: entries, size: size });
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
  function applySize() {
    root.classList.toggle("is-large", size === "large");
    root.classList.toggle("is-full", size === "full");
    var sizeButton = root.querySelector(".kutadgu-advisor-size");
    sizeButton.setAttribute("aria-label", size === "compact" ? "چوڭايتىش" : "ئەسلىگە قايتۇرۇش");
  }
  function resetConversation() {
    generation += 1;
    pending = false;
    send.disabled = false;
    turns = [];
    entries = [];
    sessionId = "";
    constraintToken = "";
    status.textContent = "";
    log.setAttribute("aria-busy", "false");
    paint();
    persist();
  }
  function mobileLayout() {
    return window.matchMedia("(max-width: 720px)").matches;
  }
  applySize();
  root.querySelector(".kutadgu-advisor-size").addEventListener("click", function () {
    size = advisorUi.nextSize(size, mobileLayout());
    root.style.removeProperty("--advisor-panel-width");
    root.style.removeProperty("--advisor-panel-height");
    applySize();
    persist();
  });
  root.querySelector(".kutadgu-advisor-new").addEventListener("click", resetConversation);
  root.querySelector(".kutadgu-advisor-clear").addEventListener("click", function () {
    root.querySelector(".kutadgu-advisor-confirm").hidden = false;
  });
  root.querySelector(".kutadgu-advisor-confirm-no").addEventListener("click", function () {
    root.querySelector(".kutadgu-advisor-confirm").hidden = true;
  });
  root.querySelector(".kutadgu-advisor-confirm-yes").addEventListener("click", function () {
    root.querySelector(".kutadgu-advisor-confirm").hidden = true;
    resetConversation();
  });
  var resizeHandle = root.querySelector(".kutadgu-advisor-resize");
  resizeHandle.addEventListener("pointerdown", function (event) {
    if (mobileLayout() || !root.classList.contains("is-open")) return;
    event.preventDefault();
    var startX = event.clientX;
    var startY = event.clientY;
    var rect = panel.getBoundingClientRect();
    function move(next) {
      var clamped = advisorUi.clampPanel(rect.width + (startX - next.clientX), rect.height + (startY - next.clientY));
      root.style.setProperty("--advisor-panel-width", clamped.width + "px");
      root.style.setProperty("--advisor-panel-height", clamped.height + "px");
      size = "large";
      applySize();
    }
    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      persist();
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
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
    var nextTurns = advisorUi.cleanTurns(turns.concat([{ role: "user", content: message }]));
    paint();
    pending = true;
    send.disabled = true;
    log.setAttribute("aria-busy", "true");
    status.textContent = "ئىزدەۋاتىدۇ…";
    var ticket = generation;
    var payload = { turns: nextTurns };
    if (advisorUi.sessionPattern.test(sessionId)) payload.session_id = sessionId;
    if (constraintToken) payload.constraint_token = constraintToken;
    fetch("/api/book-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (body) {
        return { status: response.status, ok: response.ok, body: body };
      }).catch(function () { return { status: response.status, ok: false, body: null }; });
    }).then(function (result) {
      if (ticket !== generation) return;
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
      constraintToken = advisorUi.cleanTurns ? (function () {
        var token = String(result.body.constraint_token || "");
        return /^[A-Za-z0-9_-]{8,500}\.[a-f0-9]{64}$/.test(token) ? token : "";
      }()) : "";
      turns = advisorUi.cleanTurns(nextTurns.concat([{ role: "assistant", content: result.body.message || "" }]));
      entries.push({ role: "assistant", text: result.body.message || "", cards: result.body.books || [], handoff: result.body.handoff || null });
      paint();
      persist();
    }).catch(function () {
      if (ticket !== generation) return;
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
}

if (typeof document !== "undefined") {
  window.fetch("/api/book-advisor", { method: "GET", credentials: "same-origin", cache: "no-store" }).then(function (response) {
    return response && response.ok ? response.json() : null;
  }).then(function (body) {
    if (!body || body.enabled !== true) return;
    mountAdvisor();
  }).catch(function () {});
}

if (typeof module === "object" && module && module.exports) module.exports = advisorUi;
