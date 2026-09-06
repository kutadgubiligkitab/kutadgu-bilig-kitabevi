/**
 * Stage 1 — unified public storefront header.
 * Low-risk helper: upgrades existing headers in place. Does not replace page HTML files.
 * All app destinations are root-relative so nested routes like /book/122 cannot resolve to /book/cart.html.
 */
(function (root) {
  "use strict";

  var CSS_HREF = "/public-header.css?v=2";
  var ROOT_APP_PAGES = {
    "account.html": "/account.html",
    "cart.html": "/cart.html",
    "favorites.html": "/favorites.html",
    "index.html": "/",
    "my-books.html": "/my-books.html",
    "order-info.html": "/order-info.html",
    "privacy.html": "/privacy.html",
    "returns.html": "/returns.html"
  };
  var HOME_HASHES = ["#home", "#books", "#about", "#contact", "#bookCategories"];
  var EXCLUDED_FILES = {
    "admin.html": true,
    "reset-password.html": true,
    "admin-quality-preview.html": true
  };

  function pageFile() {
    if (typeof location === "undefined") return "";
    return String(location.pathname || "/").split("/").pop().split(/[?#]/)[0] || "";
  }

  function isHomepage() {
    var file = pageFile();
    return file === "" || file === "index.html";
  }

  function isExcluded() {
    if (typeof document === "undefined") return true;
    if (document.querySelector(".admin-shell, .admin-topbar")) return true;
    return !!EXCLUDED_FILES[pageFile()];
  }

  function rootAppHref(page, fallback) {
    var raw = String(page || "").trim();
    var fb = fallback == null ? "/" : fallback;
    if (!raw) return fb;
    if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(raw) || raw.startsWith("//") || /[<>"'`]/.test(raw)) return fb;
    if (raw.startsWith("/") || raw.startsWith("#")) return raw;
    var hash = "";
    var hashAt = raw.indexOf("#");
    var path = raw;
    if (hashAt >= 0) {
      hash = raw.slice(hashAt);
      path = raw.slice(0, hashAt);
    }
    path = path.split("?")[0].replace(/^\.\//, "");
    var file = String(path.split("/").pop() || "").toLowerCase();
    if (file === "index.html" && hash === "#books") return "/#books";
    var dest = ROOT_APP_PAGES[file];
    if (!dest) return fb;
    if (dest === "/") return hash ? "/" + hash : "/";
    return dest + hash;
  }

  function rewriteHeaderHref(href) {
    var raw = String(href || "").trim();
    if (!raw) return raw;
    if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(raw) || raw.startsWith("//")) return "/";
    if (raw.startsWith("/")) return raw;
    if (raw.startsWith("#")) {
      if (isHomepage()) return raw;
      if (HOME_HASHES.indexOf(raw.split("?")[0]) >= 0) return "/" + raw;
      return "/" + raw;
    }
    var mapped = rootAppHref(raw, "");
    if (mapped) return mapped;
    return raw;
  }

  function rootAsset(src) {
    var value = String(src || "").trim();
    if (!value) return value;
    if (value.startsWith("/") || /^(https?:)?\/\//i.test(value) || value.startsWith("data:")) return value;
    return "/" + value.replace(/^\.\//, "");
  }

  function malformedBookAppPath(pathname) {
    return /^\/book\/.+\.html$/i.test(String(pathname || ""));
  }

  function ensureCss() {
    if (typeof document === "undefined") return;
    if (document.getElementById("kutadguPublicHeaderCss")) return;
    var link = document.createElement("link");
    link.id = "kutadguPublicHeaderCss";
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    (document.head || document.documentElement).appendChild(link);
  }

  function logoInnerHtml() {
    return '<picture class="kutadgu-site-logo-picture"><source type="image/webp" srcset="/kutadgu-logo.webp"><img src="/kutadgu-logo.png" alt="قۇتادغۇبىلىك كىتابخانىسى" class="kutadgu-site-logo" width="38" height="38" decoding="async"></picture><span class="kutadgu-brand-text">قۇتادغۇبىلىك كىتابخانىسى</span>';
  }

  function fixMediaUrls(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    rootEl.querySelectorAll("img[src], source[srcset]").forEach(function (node) {
      if (node.hasAttribute("src")) node.setAttribute("src", rootAsset(node.getAttribute("src")));
      if (node.hasAttribute("srcset")) node.setAttribute("srcset", rootAsset(node.getAttribute("srcset")));
    });
  }

  function ensureLogo(main) {
    var logo = main.querySelector(".logo, .mobile-site-brand, .account-brand");
    if (!logo) {
      logo = document.createElement("a");
      logo.className = "logo";
      logo.href = "/";
      logo.innerHTML = logoInnerHtml();
      main.prepend(logo);
    } else if (logo.tagName !== "A") {
      var a = document.createElement("a");
      a.className = (logo.className || "") + " logo";
      a.href = "/";
      a.setAttribute("aria-label", "باش بەت");
      while (logo.firstChild) a.appendChild(logo.firstChild);
      logo.replaceWith(a);
      logo = a;
    } else {
      logo.classList.add("logo");
      logo.setAttribute("href", "/");
    }
    if (!logo.querySelector("img, picture")) logo.innerHTML = logoInnerHtml();
    if (!logo.querySelector(".kutadgu-brand-text") && !logo.querySelector("span")) {
      var span = document.createElement("span");
      span.className = "kutadgu-brand-text";
      span.textContent = "قۇتادغۇبىلىك كىتابخانىسى";
      logo.appendChild(span);
    }
    var brandText = logo.querySelector(".kutadgu-brand-text, span");
    if (brandText) brandText.classList.add("kutadgu-brand-text");
    fixMediaUrls(logo);
    return logo;
  }

  function ensureSearch(main, nav) {
    var form = main.querySelector(".kutadgu-header-search") || (nav && nav.querySelector(".kutadgu-header-search"));
    if (!form) {
      form = document.createElement("form");
      form.className = "kutadgu-header-search";
      form.setAttribute("role", "search");
      form.setAttribute("action", "/");
      form.setAttribute("method", "get");
      form.innerHTML =
        '<label class="kutadgu-header-search-label" for="kutadguHeaderSearch">كىتاب ئىزدەش</label>' +
        '<input id="kutadguHeaderSearch" name="q" type="search" placeholder="كىتاب ئىسمى، ئاپتور ياكى تۈر…" autocomplete="off" enterkeyhint="search" aria-label="كىتاب ئىزدەش">' +
        '<button type="submit" class="kutadgu-header-search-submit" aria-label="ئىزدەش">🔎</button>';
      var logo = main.querySelector(".logo");
      if (logo && logo.nextSibling) main.insertBefore(form, logo.nextSibling);
      else main.appendChild(form);
    }
    form.setAttribute("action", "/");
    form.setAttribute("method", "get");
    if (form.dataset.kutadguBound === "1") return form;
    form.dataset.kutadguBound = "1";
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = form.querySelector("#kutadguHeaderSearch, input[type='search'], input[name='q']");
      var q = String(input && input.value || "").trim();
      var homeInput = document.querySelector("#searchInput");
      if (homeInput && isHomepage()) {
        homeInput.value = q;
        homeInput.dispatchEvent(new Event("input", { bubbles: true }));
        var btn = document.querySelector("#searchButton");
        if (btn && typeof btn.click === "function") btn.click();
        else homeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        var books = document.getElementById("books");
        if (books && books.scrollIntoView) books.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      var next = q ? "/?q=" + encodeURIComponent(q) + "#books" : "/#books";
      location.assign(next);
    });
    return form;
  }

  function findOrCreateNav(header, main) {
    var nav = header.querySelector("nav") ||
      (main && main.querySelector("nav")) ||
      document.getElementById("mobileSiteMenu") ||
      document.querySelector("nav.kutadgu-public-nav, nav.mobile-site-menu");
    if (!nav) {
      nav = document.createElement("nav");
      nav.setAttribute("aria-label", "ئاساسلىق يول باشلاش");
      if (main) main.appendChild(nav);
      else header.appendChild(nav);
    }
    if (!nav.classList.contains("kutadgu-public-nav")) nav.classList.add("kutadgu-public-nav");
    return nav;
  }

  function upsertLink(nav, href, label, extraClass) {
    var link = nav.querySelector('a[href="' + href + '"]');
    if (!link && href.charAt(0) === "/") {
      var file = href.slice(1);
      if (file) link = nav.querySelector('a[href="' + file + '"]');
    }
    if (!link && extraClass) link = nav.querySelector("a." + extraClass);
    if (!link) {
      link = document.createElement("a");
      if (extraClass) link.className = extraClass;
      nav.appendChild(link);
    }
    link.setAttribute("href", href);
    if (!link.textContent.trim()) link.textContent = label;
    return link;
  }

  function ensurePageLinks(nav) {
    var homeHref = isHomepage() ? "#home" : "/";
    var booksHref = isHomepage() ? "#books" : "/#books";
    var aboutHref = isHomepage() ? "#about" : "/#about";
    var contactHref = isHomepage() ? "#contact" : "/#contact";
    if (!nav.querySelector("a[href='#home'], a[href='/'], a[href='/index.html'], a[href='index.html']")) {
      upsertLink(nav, homeHref, "باش بەت", "kutadgu-header-home");
    }
    if (!nav.querySelector("a[href='#books'], a[href='/#books']")) {
      upsertLink(nav, booksHref, "كىتابلار", "kutadgu-header-books");
    }
    if (!nav.querySelector("a[href='#about'], a[href='/#about']")) {
      upsertLink(nav, aboutHref, "بىز ھەققىدە", "kutadgu-header-about");
    }
    if (!nav.querySelector("a[href='#contact'], a[href='/#contact']")) {
      upsertLink(nav, contactHref, "ئالاقە", "kutadgu-header-contact");
    }
  }

  function ensureShopLinks(nav) {
    var fav = upsertLink(nav, "/favorites.html", "❤️", "kutadgu-header-favorites");
    fav.setAttribute("aria-label", "ياقتۇرغانلىرىم");
    var cart = upsertLink(nav, "/cart.html", "🛒 سېۋەت", "kutadgu-header-cart");
    if (!cart.querySelector(".cart-count")) {
      var count = document.createElement("span");
      count.className = "cart-count";
      count.setAttribute("data-kutadgu-count-state", "pending");
      count.setAttribute("aria-hidden", "true");
      cart.appendChild(count);
    }
    upsertLink(nav, "/account.html", "👤 ھېسابىم", "kutadgu-header-account");
  }

  function ensureTheme(nav, header) {
    var button = header.querySelector(".theme-button, .theme-toggle") ||
      document.querySelector(".theme-button, .theme-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "theme-button";
      button.setAttribute("aria-label", "كۈندۈز ۋە كېچە ھالىتى");
      button.textContent = "🌙";
    }
    button.classList.add("kutadgu-header-theme");
    if (button.parentElement !== nav) nav.appendChild(button);
    return button;
  }

  function normalizeNavHrefs(nav) {
    nav.querySelectorAll("a[href]").forEach(function (a) {
      var next = rewriteHeaderHref(a.getAttribute("href"));
      if (next) a.setAttribute("href", next);
    });
  }

  function hideDuplicates(header) {
    header.querySelectorAll("a.home-link, a.account-home").forEach(function (a) {
      a.hidden = true;
      a.setAttribute("hidden", "");
      a.classList.add("kutadgu-header-duplicate");
    });
    var detail = document.querySelector(".detail-topbar");
    if (detail) {
      detail.classList.add("kutadgu-detail-topbar-reduced");
      var brand = detail.querySelector(".detail-brand");
      if (brand) {
        brand.hidden = true;
        brand.setAttribute("hidden", "");
      }
      detail.querySelectorAll(".kutadgu-desktop-shop-links").forEach(function (el) {
        el.hidden = true;
        el.setAttribute("hidden", "");
      });
    }
    document.querySelectorAll(".cart-page-top .kutadgu-desktop-shop-links").forEach(function (el) {
      el.hidden = true;
      el.setAttribute("hidden", "");
    });
  }

  function ensureMainRow(header) {
    var existing = header.querySelector(":scope > .kutadgu-public-header-main");
    if (existing) return existing;
    header.classList.add("kutadgu-public-header");
    return header;
  }

  function syncStickyOffset(header) {
    if (!header || typeof document === "undefined") return 0;
    var height = Math.ceil(header.getBoundingClientRect().height) || 0;
    document.documentElement.style.setProperty("--kutadgu-sticky-header-height", height + "px");
    return height;
  }

  function observeHeader(header) {
    if (!header || header.dataset.kutadguHeaderObserved === "1") return;
    header.dataset.kutadguHeaderObserved = "1";
    syncStickyOffset(header);
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(function () { syncStickyOffset(header); });
      ro.observe(header);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", function () { syncStickyOffset(header); }, { passive: true });
    }
  }

  function findHeader() {
    return document.querySelector("body > header.kutadgu-public-header") ||
      document.querySelector("body > header:not(.admin-topbar)") ||
      document.querySelector(".mobile-site-header");
  }

  function refreshHeaderCartCount() {
    if (typeof window === "undefined") return;
    if (window.kutadguShop && typeof window.kutadguShop.updateBadge === "function") {
      window.kutadguShop.updateBadge();
      return;
    }
    if (window.KutadguMember && typeof window.KutadguMember.refreshSafeCartCount === "function") {
      window.KutadguMember.refreshSafeCartCount();
    }
  }

  function bindCartCountRefresh() {
    if (typeof document === "undefined" || document.documentElement.dataset.kutadguSafeCartCount === "1") return;
    document.documentElement.dataset.kutadguSafeCartCount = "1";
    document.addEventListener("kutadgu-member-change", refreshHeaderCartCount);
    document.addEventListener("kutadgu-member-state-synced", refreshHeaderCartCount);
  }

  function ensure() {
    if (typeof document === "undefined" || !document.body) return null;
    if (isExcluded()) return null;
    ensureCss();
    var header = findHeader();
    if (!header) {
      header = document.createElement("header");
      document.body.insertBefore(header, document.body.firstChild);
    }
    header.classList.add("kutadgu-public-header");
    document.body.classList.add("has-kutadgu-public-header");
    var main = ensureMainRow(header);
    ensureLogo(main);
    var nav = findOrCreateNav(header, main);
    ensureSearch(main, nav);
    ensurePageLinks(nav);
    ensureTheme(nav, header);
    ensureShopLinks(nav);
    normalizeNavHrefs(nav);
    fixMediaUrls(header);
    hideDuplicates(header);
    observeHeader(header);
    document.documentElement.classList.add("kutadgu-has-public-header");
    bindCartCountRefresh();
    refreshHeaderCartCount();
    return header;
  }

  var api = {
    ensure: ensure,
    refreshHeaderCartCount: refreshHeaderCartCount,
    rootAppHref: rootAppHref,
    rewriteHeaderHref: rewriteHeaderHref,
    rootAsset: rootAsset,
    malformedBookAppPath: malformedBookAppPath,
    ROOT_APP_PAGES: ROOT_APP_PAGES
  };

  root.KutadguPublicHeader = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure, { once: true });
    else ensure();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
