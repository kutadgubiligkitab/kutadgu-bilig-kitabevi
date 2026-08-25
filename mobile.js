(function () {
  "use strict";

  const MOBILE_QUERY = window.matchMedia("(max-width: 768px)");
  const STORE_PAGES_EXCLUDED = new Set(["admin.html", "reset-password.html"]);

  function pageName() {
    return (location.pathname.split("/").pop() || "index.html").split(/[?#]/)[0];
  }

  function link(label, href, icon) {
    const a = document.createElement("a");
    a.href = href;
    a.innerHTML = `<span aria-hidden="true">${icon}</span><span>${label}</span>`;
    return a;
  }

  function buildMenu() {
    const menu = document.createElement("nav");
    menu.className = "mobile-site-menu";
    menu.id = "mobileSiteMenu";
    menu.setAttribute("aria-label", "ئاساسلىق يول باشلاش");
    [
      ["باش بەت", "index.html", "🏠"],
      ["كىتابلار", "index.html#books", "📚"],
      ["كىتاب تۈرلىرى", "index.html#books", "🗂️"],
      ["ياقتۇرغانلار", "favorites.html", "❤️"],
      ["سېۋەت", "cart.html", "🛒"],
      ["ھېسابىم / ئەزا بولۇش", "account.html", "👤"],
      ["بىز ھەققىدە", "index.html#about", "ℹ️"],
      ["ئالاقە", "index.html#contact", "💬"]
    ].forEach(([label, href, icon]) => menu.appendChild(link(label, href, icon)));
    return menu;
  }

  function ensureMenuControls(header, menu) {
    const themeButton = document.querySelector(".theme-button, .theme-toggle");
    if (themeButton && !menu.contains(themeButton)) menu.appendChild(themeButton);
    let toggle = header.querySelector(".mobile-menu-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mobile-menu-toggle";
      toggle.setAttribute("aria-label", "تىزىملىكنى ئېچىش");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", menu.id || "mobileSiteMenu");
      toggle.textContent = "☰";
      header.appendChild(toggle);
    }

    let cart = header.querySelector(".mobile-header-cart");
    if (!cart) {
      cart = document.createElement("a");
      cart.className = "mobile-header-cart";
      cart.href = "cart.html";
      cart.setAttribute("aria-label", "سېۋەت");
      cart.innerHTML = `🛒<span class="cart-count">0</span>`;
      header.appendChild(cart);
    }

    let backdrop = document.querySelector(".mobile-menu-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "mobile-menu-backdrop";
      backdrop.hidden = false;
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.style.pointerEvents = "none";
      document.body.appendChild(backdrop);
    }

    const close = () => {
      menu.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.style.pointerEvents = "none";
      document.body.classList.remove("mobile-menu-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "تىزىملىكنى ئېچىش");
      toggle.textContent = "☰";
    };
    const open = () => {
      menu.classList.add("is-open");
      backdrop.classList.add("is-open");
      backdrop.setAttribute("aria-hidden", "false");
      backdrop.style.pointerEvents = "auto";
      document.body.classList.add("mobile-menu-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "تىزىملىكنى يېپىش");
      toggle.textContent = "×";
    };

    toggle.addEventListener("click", () => menu.classList.contains("is-open") ? close() : open());
    backdrop.addEventListener("click", close);
    menu.querySelectorAll("a").forEach(a => a.addEventListener("click", close));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && menu.classList.contains("is-open")) close();
    });
    MOBILE_QUERY.addEventListener?.("change", event => {
      if (!event.matches) close();
    });
  }

  function enhanceHeader() {
    if (STORE_PAGES_EXCLUDED.has(pageName())) return;
    const accountHeader = document.querySelector("body[data-account-page] .account-topbar");
    if (accountHeader) {
      const themeButton = document.querySelector(".theme-button, .theme-toggle");
      if (themeButton) {
        themeButton.classList.add("account-mobile-theme");
        accountHeader.appendChild(themeButton);
      }
      return;
    }
    const existing = document.querySelector("body > header:not(.account-topbar)");
    if (existing) {
      existing.classList.add("is-mobile-enhanced");
      document.body.classList.add("has-mobile-fixed-header");
      const menu = existing.querySelector("nav") || buildMenu();
      if (!menu.parentElement) existing.appendChild(menu);
      if (!menu.id) menu.id = "mobileSiteMenu";
      ensureMenuControls(existing, menu);
      return;
    }

    if (document.querySelector(".mobile-site-header")) return;
    const header = document.createElement("header");
    header.className = "mobile-site-header";
    document.body.classList.add("has-mobile-fixed-header");
    const brand = document.createElement("a");
    brand.className = "mobile-site-brand";
    brand.href = "index.html";
    brand.innerHTML = `<img src="kutadgu-logo.png" alt="قۇتادغۇبىلىك لوگوسى"><span>قۇتادغۇبىلىك كىتابخانىسى</span>`;
    const menu = buildMenu();
    header.append(brand, menu);
    document.body.prepend(header);
    ensureMenuControls(header, menu);
  }

  function ensureBottomNav() {
    if (STORE_PAGES_EXCLUDED.has(pageName()) || document.querySelector(".mobile-bottom-nav")) return;
    const nav = document.createElement("nav");
    nav.className = "mobile-bottom-nav";
    nav.setAttribute("aria-label", "تېلېفون تېز يول باشلاش");
    nav.innerHTML = `
      <a href="cart.html" data-mobile-page="cart.html"><span class="mobile-bottom-icon" aria-hidden="true">🛒</span><span>سېۋەت</span><span class="cart-count">0</span></a>
      <a href="favorites.html" data-mobile-page="favorites.html"><span class="mobile-bottom-icon" aria-hidden="true">❤️</span><span>ياقتۇرغانلىرىم</span></a>
      <a href="account.html" data-mobile-page="account.html"><span class="mobile-bottom-icon" aria-hidden="true">👤</span><span>كىرىش / ئەزا</span></a>`;
    const current = pageName();
    [...nav.querySelectorAll("[data-mobile-page]")]
      .find(item => item.dataset.mobilePage === current)
      ?.setAttribute("aria-current", "page");
    document.body.appendChild(nav);
    document.body.classList.add("has-mobile-bottom-nav");
    try {
      const items = JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]");
      const total = Array.isArray(items) ? items.reduce((sum, item) => sum + (Number(item.qty) || 1), 0) : 0;
      document.querySelectorAll(".cart-count").forEach(count => count.textContent = total);
    } catch (_) {}
  }

  function countActiveFilters(panel) {
    return [...panel.querySelectorAll("input, select")].reduce((count, control) => {
      if (control.matches("[type=checkbox], [type=radio]")) return count + (control.checked ? 1 : 0);
      const value = String(control.value || "").trim();
      const isDefaultSort = control.id === "searchSort" || control.id === "catalogSort";
      return count + (value && !(isDefaultSort && value === "new") ? 1 : 0);
    }, 0);
  }

  function enhanceFilter(panel) {
    if (!panel || panel.dataset.mobileCollapsible === "1") return;
    panel.dataset.mobileCollapsible = "1";
    panel.classList.add("mobile-collapsible");
    panel.setAttribute("aria-hidden", "true");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mobile-filter-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `<span>⚙️ سۈزگۈچ ۋە تەرتىپلەش <span class="mobile-filter-badge" hidden>0</span></span><span class="mobile-filter-chevron" aria-hidden="true">⌄</span>`;
    panel.insertAdjacentElement("beforebegin", toggle);

    const update = () => {
      const count = countActiveFilters(panel);
      const badge = toggle.querySelector(".mobile-filter-badge");
      badge.textContent = count;
      badge.hidden = count === 0;
      toggle.classList.toggle("has-active-filter", count > 0);
    };

    toggle.addEventListener("click", () => {
      const open = !panel.classList.contains("is-open");
      panel.classList.toggle("is-open", open);
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    panel.addEventListener("input", update);
    panel.addEventListener("change", update);
    panel.querySelector(".advanced-search-reset, .catalog-filter-reset")?.addEventListener("click", () => setTimeout(update));
    update();
  }

  function enhanceFilters() {
    document.querySelectorAll(".advanced-search-panel, .catalog-filter-bar").forEach(enhanceFilter);
    const observer = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches(".advanced-search-panel, .catalog-filter-bar")) enhanceFilter(node);
        node.querySelectorAll?.(".advanced-search-panel, .catalog-filter-bar").forEach(enhanceFilter);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function applyAutomaticDirection() {
    document.querySelectorAll("input, textarea").forEach(field => {
      const type = (field.getAttribute("type") || "text").toLowerCase();
      if (["email", "tel", "number", "password", "url"].includes(type)) return;
      if (!field.hasAttribute("dir") || field.getAttribute("dir") === "rtl") field.setAttribute("dir", "auto");
    });
  }

  function limitCarouselDots() {
    if (!MOBILE_QUERY.matches) {
      document.querySelectorAll(".home-carousel-dot").forEach(dot => {
        if (dot.classList.contains("mobile-dot-hidden")) dot.classList.remove("mobile-dot-hidden");
      });
      return;
    }
    const dots = [...document.querySelectorAll(".home-carousel-dot")];
    if (dots.length <= 7) {
      dots.forEach(dot => dot.classList.remove("mobile-dot-hidden"));
      return;
    }
    const active = Math.max(0, dots.findIndex(dot => dot.classList.contains("is-active")));
    let start = Math.max(0, active - 3);
    start = Math.min(start, dots.length - 7);
    dots.forEach((dot, index) => {
      const shouldHide = index < start || index >= start + 7;
      if (dot.classList.contains("mobile-dot-hidden") !== shouldHide) {
        dot.classList.toggle("mobile-dot-hidden", shouldHide);
      }
    });
  }

  function enhanceCarousel() {
    const viewport = document.querySelector("#homeCarouselViewport");
    if (!viewport || viewport.dataset.mobileSwipe === "1") return;
    viewport.dataset.mobileSwipe = "1";
    let startX = 0;
    let startY = 0;
    viewport.addEventListener("touchstart", event => {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    }, { passive: true });
    viewport.addEventListener("touchend", event => {
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 42 || Math.abs(dx) <= Math.abs(dy)) return;
      const button = dx < 0 ? document.querySelector("#carouselNext") : document.querySelector("#carouselPrev");
      button?.click();
      setTimeout(limitCarouselDots);
    }, { passive: true });

    const dots = document.querySelector("#homeCarouselDots");
    if (dots) {
      new MutationObserver(limitCarouselDots).observe(dots, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
    limitCarouselDots();
    window.addEventListener("resize", limitCarouselDots, { passive: true });
  }

  let initialized = false;

  function init() {
    if (initialized || !MOBILE_QUERY.matches) return;
    initialized = true;
    // Recover safely from any stale mobile-menu state restored by Safari/BFCache.
    document.body.classList.remove("mobile-menu-open");
    const staleBackdrop = document.querySelector(".mobile-menu-backdrop");
    if (staleBackdrop) {
      staleBackdrop.classList.remove("is-open");
      staleBackdrop.setAttribute("aria-hidden", "true");
      staleBackdrop.style.pointerEvents = "none";
    }
    enhanceHeader();
    ensureBottomNav();
    enhanceFilters();
    applyAutomaticDirection();
    enhanceCarousel();
    // Avoid rescanning the whole document after every dynamic catalog mutation on mobile.
    new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        const fields=[];
        if (node.matches?.("input, textarea")) fields.push(node);
        node.querySelectorAll?.("input, textarea").forEach(field => fields.push(field));
        fields.forEach(field => {
          const type=(field.getAttribute("type")||"text").toLowerCase();
          if (["email","tel","number","password","url"].includes(type)) return;
          if (!field.hasAttribute("dir") || field.getAttribute("dir") === "rtl") field.setAttribute("dir","auto");
        });
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  MOBILE_QUERY.addEventListener?.("change", event => {
    if (event.matches) init();
  });
})();

/* =========================================================
   TEMP MOBILE DIAGNOSTIC SAFE MODE — 2026-08-26
   Does not touch catalog/Supabase/cart business logic.
   ========================================================= */
(function mobileDiagnosticSafeMode(){
  if (!window.matchMedia || !window.matchMedia('(max-width: 900px)').matches) return;

  function ensureBadge(){
    let badge = document.getElementById('mobileDiagBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'mobileDiagBadge';
      badge.setAttribute('aria-hidden','true');
      badge.textContent = 'DIAG booting…';
      document.body.appendChild(badge);
    }
    return badge;
  }

  function selectorFor(el){
    if (!el || el === document || el === window) return String(el);
    let s = (el.tagName || 'node').toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + Array.from(el.classList).slice(0,3).join('.');
    return s;
  }

  function neutralizeBlockers(){
    document.body.classList.remove('mobile-menu-open');
    document.querySelectorAll('.mobile-menu-backdrop,.cover-zoom-overlay,.modal-backdrop,.auth-backdrop,.dialog-backdrop,[data-backdrop]').forEach(el => {
      el.style.setProperty('display','none','important');
      el.style.setProperty('pointer-events','none','important');
    });

    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    if (!vw || !vh) return [];
    const blockers = [];
    document.body.querySelectorAll('*').forEach(el => {
      if (el.id === 'mobileDiagBadge') return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
      const r = el.getBoundingClientRect();
      const area = Math.max(0, Math.min(vw, r.right)-Math.max(0,r.left)) * Math.max(0, Math.min(vh,r.bottom)-Math.max(0,r.top));
      const ratio = area / (vw*vh);
      if (ratio > 0.72 && r.width > vw*0.75 && r.height > vh*0.75) {
        const tag = selectorFor(el);
        /* Do not disable actual page shell/body-like structural nodes. */
        if (!/^(html|body|main)([#. ]|$)/.test(tag)) {
          el.style.setProperty('pointer-events','none','important');
          blockers.push(tag);
        }
      }
    });
    return blockers;
  }

  let lastTarget = 'none';
  let lastBlockers = [];
  let ticks = 0;

  document.addEventListener('pointerdown', function(e){
    lastTarget = selectorFor(e.target);
  }, true);
  document.addEventListener('touchstart', function(e){
    if (e.touches && e.touches[0]) {
      const t = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
      lastTarget = selectorFor(t || e.target);
    }
  }, {capture:true, passive:true});

  function run(){
    const badge = ensureBadge();
    lastBlockers = neutralizeBlockers();
    ticks++;
    badge.textContent = 'DIAG ✓ heartbeat ' + ticks + ' | touch: ' + lastTarget + (lastBlockers.length ? ' | blocked→disabled: ' + lastBlockers.slice(0,2).join(',') : ' | blockers: none');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, {once:true});
  } else run();
  setInterval(run, 1000);
})();
