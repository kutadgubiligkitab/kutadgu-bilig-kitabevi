/**
 * Public homepage Hero overlay.
 * Fail-open: missing tables / request failure / malformed data → restoreHardcodedHero().
 * Never hide the hard-coded first-paint Hero while waiting.
 * Database text is assigned with textContent only.
 */
(function (root) {
  "use strict";

  var HARDCODED_INTERVAL_MS = 7000;
  var ALLOWED_INTERVALS = { 5000: 1, 7000: 1, 10000: 1, 15000: 1 };
  var DEFAULT_BOOK_LABEL = "كىتابنى كۆرۈش";
  var HIDDEN_REFETCH_MS = 60000;
  var REPO_SLIDES = {
    main: {
      src: "/assets/store/shop-interior-main.webp",
      alt: "قۇتادغۇبىلىك كىتابخانىسىنىڭ ئىچكى كۆرۈنۈشى",
      shot: "main",
      label: "كىتابخانا ئىچى"
    },
    library: {
      src: "/assets/store/shop-interior-library.webp",
      alt: "قۇتادغۇبىلىك كىتابخانىسىنىڭ كۈتۈپخانا بۆلىكى",
      shot: "library",
      label: "كۈتۈپخانا بۆلىكى"
    },
    exterior: {
      src: "/assets/store/shop-exterior.webp",
      alt: "قۇتادغۇبىلىك كىتابخانىسىنىڭ سىرتقى كۆرۈنۈشى",
      shot: "exterior",
      label: "كىتابخانا سىرتى"
    }
  };

  var snapshot = null;
  var campaignItems = [];
  var mode = "store";
  var applyGen = 0;
  var expiryTimer = null;
  var lastFetchAt = 0;
  var booted = false;
  var slideBound = false;
  var readyResolve = null;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function markReady() {
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
  }

  function textOf(el) {
    return el ? String(el.textContent || "") : "";
  }

  function attrOf(el, name) {
    return el ? String(el.getAttribute(name) || "") : "";
  }

  function heroEls() {
    var section = typeof document === "undefined" ? null : document.querySelector(".home-bookstore-hero");
    if (!section) return null;
    return {
      section: section,
      eyebrow: section.querySelector("[data-home-hero-eyebrow]"),
      trust: section.querySelector("[data-home-hero-trust]"),
      title: section.querySelector("[data-home-hero-title]"),
      body: section.querySelector("[data-home-hero-body]"),
      primary: section.querySelector("[data-home-hero-primary]"),
      secondary: section.querySelector("[data-home-hero-secondary]"),
      media: section.querySelector("[data-home-hero-media]") || section.querySelector("[data-shop-hero-slideshow]"),
      frame: section.querySelector(".shop-hero-frame"),
      dots: section.querySelector(".shop-hero-dots")
    };
  }

  function captureHardcodedHero() {
    var els = heroEls();
    if (!els || !els.media) return null;
    return {
      eyebrow: textOf(els.eyebrow),
      trust: textOf(els.trust),
      body: textOf(els.body),
      primaryLabel: textOf(els.primary),
      primaryHref: attrOf(els.primary, "href"),
      secondaryLabel: textOf(els.secondary),
      secondaryHref: attrOf(els.secondary, "href"),
      titleHidden: !els.title || els.title.hasAttribute("hidden"),
      titleText: textOf(els.title),
      mediaHtml: els.media.innerHTML,
      ariaLabel: attrOf(els.media, "aria-label"),
      intervalMs: HARDCODED_INTERVAL_MS
    };
  }

  function slideshow() {
    return root.KutadguHeroSlideshow || null;
  }

  function setIntervalMs(ms) {
    var api = slideshow();
    var n = ALLOWED_INTERVALS[Number(ms)] ? Number(ms) : HARDCODED_INTERVAL_MS;
    if (api && typeof api.setIntervalMs === "function") api.setIntervalMs(n);
  }

  function refreshSlideshow() {
    var api = slideshow();
    if (api && typeof api.refresh === "function") api.refresh();
  }

  function restoreHardcodedHero() {
    mode = "store";
    campaignItems = [];
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    var els = heroEls();
    if (!els || !snapshot) {
      refreshSlideshow();
      return;
    }
    if (els.eyebrow) els.eyebrow.textContent = snapshot.eyebrow;
    if (els.trust) els.trust.textContent = snapshot.trust;
    if (els.body) els.body.textContent = snapshot.body;
    if (els.primary) {
      els.primary.textContent = snapshot.primaryLabel;
      els.primary.setAttribute("href", snapshot.primaryHref);
      els.primary.removeAttribute("hidden");
    }
    if (els.secondary) {
      els.secondary.textContent = snapshot.secondaryLabel;
      els.secondary.setAttribute("href", snapshot.secondaryHref);
      els.secondary.removeAttribute("hidden");
    }
    if (els.title) {
      els.title.textContent = snapshot.titleText || "";
      els.title.setAttribute("hidden", "");
    }
    if (els.section) {
      els.section.setAttribute("data-hero-mode", "store");
      els.section.classList.remove("is-hero-campaign");
    }
    if (els.media) {
      els.media.innerHTML = snapshot.mediaHtml;
      if (snapshot.ariaLabel) els.media.setAttribute("aria-label", snapshot.ariaLabel);
    }
    setIntervalMs(HARDCODED_INTERVAL_MS);
    refreshSlideshow();
    markReady();
  }

  function publicConfig() {
    var c = (root.KUTADGU_SUPABASE_CONFIG) || {};
    return {
      url: String(c.url || "").replace(/\/+$/, ""),
      key: String(c.anonKey || c.publishableKey || "")
    };
  }

  function restHeaders() {
    var c = publicConfig();
    return {
      apikey: c.key,
      Authorization: "Bearer " + c.key,
      Accept: "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache"
    };
  }

  function restGet(path) {
    var c = publicConfig();
    if (!c.url || !c.key) return Promise.resolve({ error: true });
    return fetch(c.url + path, {
      method: "GET",
      headers: restHeaders(),
      cache: "no-store",
      credentials: "omit"
    }).then(function (res) {
      if (!res.ok) return { error: true, status: res.status };
      return res.json().then(function (data) {
        return { data: data };
      });
    }).catch(function () {
      return { error: true };
    });
  }

  function trimText(value) {
    if (value == null) return "";
    return String(value).trim();
  }

  function isInternalHref(raw) {
    var t = trimText(raw);
    if (!t) return false;
    if (/^#[A-Za-z0-9_-]+$/.test(t)) return true;
    if (/^\/[^/]/.test(t) && t.indexOf("./") === -1) return true;
    return false;
  }

  function isSafeImageUrl(raw) {
    var t = trimText(raw);
    if (!t) return false;
    if (/^(javascript|data|vbscript|file|blob)\s*:/i.test(t)) return false;
    if (/^http:\/\//i.test(t)) return false;
    if (t.indexOf("//") === 0) return false;
    if (/^https:\/\/[^/ \t\n\r].+/i.test(t)) return true;
    if (t.charAt(0) === "/" && t.charAt(1) !== "/") return true;
    return false;
  }

  function repoSlideForKey(key) {
    var k = trimText(key);
    if (!Object.prototype.hasOwnProperty.call(REPO_SLIDES, k)) return null;
    return REPO_SLIDES[k];
  }

  function intervalFromSettings(settings) {
    var sec = settings && settings.rotation_interval_seconds;
    var ms = Number(sec) * 1000;
    return ALLOWED_INTERVALS[ms] ? ms : HARDCODED_INTERVAL_MS;
  }

  function isEnabled(row) {
    if (!row || typeof row !== "object") return false;
    if (row.enabled === false || row.enabled === "false" || row.enabled === 0) return false;
    return true;
  }

  function inSchedule(row, nowMs) {
    var now = nowMs == null ? Date.now() : Number(nowMs);
    if (row.starts_at) {
      var start = Date.parse(row.starts_at);
      if (!Number.isNaN(start) && start > now) return false;
    }
    if (row.ends_at) {
      var end = Date.parse(row.ends_at);
      if (!Number.isNaN(end) && end < now) return false;
    }
    return true;
  }

  function sortRows(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort(function (a, b) {
      var sa = Number(a && a.sort_order);
      var sb = Number(b && b.sort_order);
      if (!Number.isFinite(sa)) sa = 0;
      if (!Number.isFinite(sb)) sb = 0;
      if (sa !== sb) return sa - sb;
      return String((a && a.created_at) || "").localeCompare(String((b && b.created_at) || ""));
    });
  }

  function bookIdKey(id) {
    if (id == null || id === "") return "";
    var n = Number(id);
    if (Number.isFinite(n) && n > 0 && Math.floor(n) === n) return String(n);
    return "";
  }

  function isPublicBookEligible(book) {
    if (!book || typeof book !== "object") return false;
    if (book.is_active === false || book.is_active === "false" || book.is_active === 0) return false;
    var stock = Number(book.stock);
    if (!Number.isFinite(stock) || stock <= 0) return false;
    return true;
  }

  function resolveStoreSlide(row) {
    if (!isEnabled(row)) return null;
    var origin = trimText(row.origin);
    if (origin === "repo") {
      var mapped = repoSlideForKey(row.repo_key);
      if (!mapped) return null;
      var alt = trimText(row.alt_text);
      return {
        src: mapped.src,
        alt: alt || mapped.alt,
        kind: "store",
        shot: mapped.shot,
        label: mapped.label
      };
    }
    if (origin === "upload") {
      if (!isSafeImageUrl(row.image_url)) return null;
      return {
        src: trimText(row.image_url),
        alt: trimText(row.alt_text) || "كىتابخانا رەسىمى",
        kind: "store",
        shot: "",
        label: trimText(row.alt_text) || "كىتابخانا رەسىمى"
      };
    }
    return null;
  }

  function probeImage(url) {
    var src = trimText(url);
    if (!src) return Promise.resolve(false);
    return new Promise(function (resolve) {
      if (typeof Image === "undefined") {
        resolve(true);
        return;
      }
      var img = new Image();
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        resolve(!!ok);
      }
      img.onload = function () { finish(true); };
      img.onerror = function () { finish(false); };
      setTimeout(function () { finish(false); }, 8000);
      img.src = src;
    });
  }

  function setCopyField(el, value, fallback) {
    if (!el) return;
    if (value == null || trimText(value) === "") {
      el.textContent = fallback;
      return;
    }
    el.textContent = String(value);
  }

  function applyButton(el, label, href, fallbackLabel, fallbackHref, optional) {
    if (!el) return;
    var safeHref = isInternalHref(href) ? trimText(href) : "";
    var safeLabel = trimText(label);
    if (optional && !safeLabel && !safeHref) {
      el.setAttribute("hidden", "");
      return;
    }
    el.removeAttribute("hidden");
    if (safeLabel) el.textContent = safeLabel;
    else el.textContent = fallbackLabel;
    el.setAttribute("href", safeHref || fallbackHref);
  }

  function applyStoreCopy(settings) {
    var els = heroEls();
    if (!els || !snapshot) return;
    var s = settings && typeof settings === "object" ? settings : {};
    setCopyField(els.eyebrow, s.eyebrow, snapshot.eyebrow);
    setCopyField(els.trust, s.trust_line, snapshot.trust);
    setCopyField(els.body, s.body, snapshot.body);
    applyButton(
      els.primary,
      s.primary_label,
      s.primary_href,
      snapshot.primaryLabel,
      snapshot.primaryHref,
      false
    );
    applyButton(
      els.secondary,
      s.secondary_label,
      s.secondary_href,
      snapshot.secondaryLabel,
      snapshot.secondaryHref,
      false
    );
    if (els.title) {
      els.title.textContent = "";
      els.title.setAttribute("hidden", "");
    }
    if (els.section) {
      els.section.setAttribute("data-hero-mode", "store");
      els.section.classList.remove("is-hero-campaign");
    }
  }

  function applyCampaignCopy(item) {
    var els = heroEls();
    if (!els || !snapshot) return;
    var row = item || {};
    if (els.eyebrow) {
      if (trimText(row.eyebrow)) els.eyebrow.textContent = String(row.eyebrow);
      else els.eyebrow.textContent = snapshot.eyebrow;
    }
    if (els.trust) els.trust.textContent = snapshot.trust;
    if (els.title) {
      els.title.textContent = trimText(row.title);
      if (trimText(row.title)) els.title.removeAttribute("hidden");
      else els.title.setAttribute("hidden", "");
    }
    if (els.body) {
      if (trimText(row.body)) els.body.textContent = String(row.body);
      else els.body.textContent = snapshot.body;
    }
    applyButton(
      els.primary,
      row.primary_label,
      row.primary_href,
      row.defaultPrimaryLabel || snapshot.primaryLabel,
      row.defaultPrimaryHref || snapshot.primaryHref,
      false
    );
    applyButton(
      els.secondary,
      row.secondary_label,
      row.secondary_href,
      snapshot.secondaryLabel,
      snapshot.secondaryHref,
      true
    );
    if (els.section) {
      els.section.setAttribute("data-hero-mode", "campaign");
      els.section.classList.add("is-hero-campaign");
    }
  }

  function renderSlides(items, campaign) {
    var els = heroEls();
    if (!els || !els.frame || !els.dots) return;
    els.frame.replaceChildren();
    els.dots.replaceChildren();
    items.forEach(function (item, i) {
      var img = document.createElement("img");
      img.setAttribute("data-shop-hero-slide", "");
      img.setAttribute("data-hero-kind", campaign ? "campaign" : "store");
      if (item.shot) img.setAttribute("data-hero-shot", item.shot);
      img.src = item.src;
      img.alt = item.alt || "";
      img.width = 1440;
      img.height = 1081;
      img.decoding = "async";
      if (i === 0 && !campaign) {
        img.setAttribute("fetchpriority", "high");
      } else {
        img.loading = "lazy";
      }
      img.setAttribute("aria-hidden", i === 0 ? "false" : "true");
      if (i === 0) img.classList.add("is-active");
      img.addEventListener("error", function () {
        onSlideImageError(img);
      });
      els.frame.appendChild(img);

      var dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("data-shop-hero-dot", "");
      dot.setAttribute("aria-label", item.label || item.alt || "رەسىم");
      if (i === 0) {
        dot.classList.add("is-active");
        dot.setAttribute("aria-current", "true");
      }
      els.dots.appendChild(dot);
    });
    if (items.length < 2) els.dots.setAttribute("hidden", "");
    else els.dots.removeAttribute("hidden");
    if (els.media) {
      els.media.setAttribute("aria-label", campaign ? "ئالاھىدە تەۋسىيە" : (snapshot && snapshot.ariaLabel) || "كىتابخانا رەسىملىرى");
    }
    refreshSlideshow();
  }

  function onSlideImageError(img) {
    var src = img ? img.getAttribute("src") : "";
    if (mode === "campaign") {
      campaignItems = campaignItems.filter(function (item) { return item.src !== src; });
      if (!campaignItems.length) {
        applyStoreMode(lastSettings, lastStoreSlides);
        return;
      }
      renderSlides(campaignItems.map(toSlideView), true);
      applyCampaignCopy(campaignItems[0]);
      return;
    }
    if (!img || !img.parentNode) return;
    img.parentNode.removeChild(img);
    var els = heroEls();
    var remaining = els && els.frame ? els.frame.querySelectorAll("[data-shop-hero-slide]").length : 0;
    if (!remaining) restoreHardcodedHero();
    else refreshSlideshow();
  }

  var lastSettings = null;
  var lastStoreSlides = [];

  function toSlideView(item) {
    return {
      src: item.src,
      alt: item.alt,
      kind: item.kind || "campaign",
      shot: item.shot || "",
      label: item.label || item.alt || ""
    };
  }

  function restoreHardcodedMedia() {
    var els = heroEls();
    if (els && els.media && snapshot) els.media.innerHTML = snapshot.mediaHtml;
  }

  function matchesHardcodedStoreSlides(usable) {
    var order = ["main", "library", "exterior"];
    if (!usable || usable.length !== 3) return false;
    return order.every(function (key, i) {
      return usable[i] && usable[i].src === REPO_SLIDES[key].src;
    });
  }

  function applyStoreMode(settings, storeSlides) {
    mode = "store";
    campaignItems = [];
    lastSettings = settings;
    lastStoreSlides = storeSlides || [];
    applyStoreCopy(settings);
    setIntervalMs(intervalFromSettings(settings));
    var usable = [];
    sortRows(lastStoreSlides).forEach(function (row) {
      var slide = resolveStoreSlide(row);
      if (slide) usable.push(slide);
    });
    if (!usable.length) {
      restoreHardcodedMedia();
      refreshSlideshow();
      markReady();
      return;
    }
    if (matchesHardcodedStoreSlides(usable)) {
      refreshSlideshow();
      markReady();
      return;
    }
    Promise.all(usable.map(function (slide) {
      return probeImage(slide.src).then(function (ok) {
        return ok ? slide : null;
      });
    })).then(function (rows) {
      var live = rows.filter(Boolean);
      if (!live.length) {
        restoreHardcodedMedia();
        refreshSlideshow();
        markReady();
        return;
      }
      renderSlides(live, false);
      markReady();
    });
  }

  function earliestExpiryMs(items, nowMs) {
    var now = nowMs == null ? Date.now() : Number(nowMs);
    var soon = 0;
    items.forEach(function (item) {
      if (!item || !item.ends_at) return;
      var end = Date.parse(item.ends_at);
      if (Number.isNaN(end) || end <= now) return;
      if (!soon || end < soon) soon = end;
    });
    return soon;
  }

  function scheduleExpiry(items) {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    var at = earliestExpiryMs(items);
    if (!at) return;
    var delay = Math.min(Math.max(at - Date.now(), 250), 24 * 60 * 60 * 1000);
    expiryTimer = setTimeout(function () {
      loadHero(true);
    }, delay);
  }

  function buildCampaignItem(row, bookMap) {
    if (!isEnabled(row) || !inSchedule(row)) return null;
    var bookId = bookIdKey(row.book_id);
    var book = bookId ? bookMap[bookId] : null;
    if (bookId) {
      if (!book || !isPublicBookEligible(book)) return null;
    } else {
      if (!trimText(row.title) || !isSafeImageUrl(row.image_url)) return null;
    }

    var image = isSafeImageUrl(row.image_url) ? trimText(row.image_url) : "";
    if (!image && book && isSafeImageUrl(book.image_url)) image = trimText(book.image_url);
    if (!image) return null;

    var title = trimText(row.title) || (book ? trimText(book.title) : "");
    if (!title) return null;

    var defaultHref = bookId ? "/book/" + bookId : (snapshot ? snapshot.primaryHref : "#books");
    var defaultLabel = bookId ? DEFAULT_BOOK_LABEL : (snapshot ? snapshot.primaryLabel : DEFAULT_BOOK_LABEL);
    var primaryHref = isInternalHref(row.primary_href) ? trimText(row.primary_href) : defaultHref;
    var primaryLabel = trimText(row.primary_label) || defaultLabel;

    return {
      src: image,
      alt: title,
      title: title,
      eyebrow: trimText(row.eyebrow),
      body: trimText(row.body),
      primary_label: primaryLabel,
      primary_href: primaryHref,
      secondary_label: trimText(row.secondary_label),
      secondary_href: isInternalHref(row.secondary_href) ? trimText(row.secondary_href) : "",
      defaultPrimaryLabel: defaultLabel,
      defaultPrimaryHref: defaultHref,
      ends_at: row.ends_at || null,
      label: title,
      kind: "campaign"
    };
  }

  function applyCampaignMode(items, settings) {
    mode = "campaign";
    campaignItems = items;
    lastSettings = settings;
    setIntervalMs(intervalFromSettings(settings));
    renderSlides(items.map(toSlideView), true);
    applyCampaignCopy(items[0]);
    scheduleExpiry(items);
    markReady();
  }

  function onHeroSlideChange(event) {
    if (mode !== "campaign") return;
    var i = event && event.detail ? Number(event.detail.index) : 0;
    if (!Number.isFinite(i) || i < 0) i = 0;
    if (campaignItems[i]) applyCampaignCopy(campaignItems[i]);
  }

  function bindSlideChange() {
    if (slideBound) return;
    var els = heroEls();
    if (!els || !els.media) return;
    slideBound = true;
    els.media.addEventListener("kutadgu:hero-slide-change", onHeroSlideChange);
  }

  function settingsRow(data) {
    if (!Array.isArray(data) || !data.length) return {};
    return data[0] && typeof data[0] === "object" ? data[0] : {};
  }

  function loadBooks(ids) {
    var unique = [];
    var seen = {};
    ids.forEach(function (id) {
      var key = bookIdKey(id);
      if (!key || seen[key]) return;
      seen[key] = 1;
      unique.push(key);
    });
    if (!unique.length) return Promise.resolve({ data: [] });
    var path = "/rest/v1/books?select=id,title,image_url,stock,is_active&id=in.(" + unique.join(",") + ")";
    return restGet(path);
  }

  function loadHero() {
    var gen = ++applyGen;
    lastFetchAt = Date.now();
    var settingsPath = "/rest/v1/store_hero_settings?select=id,rotation_interval_seconds,eyebrow,trust_line,body,primary_label,primary_href,secondary_label,secondary_href&id=eq.1";
    var slidesPath = "/rest/v1/store_hero_store_slides?select=id,enabled,sort_order,origin,repo_key,image_url,alt_text,created_at&enabled=eq.true&order=sort_order.asc,created_at.asc";
    var campaignsPath = "/rest/v1/store_hero_campaigns?select=id,enabled,sort_order,book_id,image_url,eyebrow,title,body,primary_label,primary_href,secondary_label,secondary_href,starts_at,ends_at,created_at&enabled=eq.true&order=sort_order.asc,created_at.asc";
    return Promise.all([
      restGet(settingsPath),
      restGet(slidesPath),
      restGet(campaignsPath)
    ]).then(function (parts) {
      if (gen !== applyGen) return;
      if (parts[0].error || parts[1].error || parts[2].error) {
        restoreHardcodedHero();
        return;
      }
      var settings = settingsRow(parts[0].data);
      var slides = Array.isArray(parts[1].data) ? parts[1].data : [];
      var campaigns = sortRows(Array.isArray(parts[2].data) ? parts[2].data : []);
      var bookIds = campaigns.map(function (row) { return row && row.book_id; }).filter(function (id) {
        return bookIdKey(id);
      });
      var booksPromise = bookIds.length ? loadBooks(bookIds) : Promise.resolve({ data: [] });
      return booksPromise.then(function (booksRes) {
        if (gen !== applyGen) return;
        var bookMap = {};
        if (!booksRes.error) {
          (Array.isArray(booksRes.data) ? booksRes.data : []).forEach(function (book) {
            var key = bookIdKey(book && book.id);
            if (key) bookMap[key] = book;
          });
        }
        return Promise.all(campaigns.map(function (row) {
          var item = buildCampaignItem(row, bookMap);
          if (!item) return Promise.resolve(null);
          return probeImage(item.src).then(function (ok) {
            return ok ? item : null;
          });
        })).then(function (rows) {
          if (gen !== applyGen) return;
          var eligible = rows.filter(Boolean);
          if (eligible.length) {
            applyCampaignMode(eligible, settings);
            return;
          }
          applyStoreMode(settings, slides);
        });
      });
    }).catch(function () {
      if (gen !== applyGen) return;
      restoreHardcodedHero();
    });
  }

  function onVisibility() {
    if (typeof document === "undefined" || document.hidden) return;
    if (Date.now() - lastFetchAt < HIDDEN_REFETCH_MS) return;
    loadHero();
  }

  function boot() {
    if (booted) return;
    if (typeof document === "undefined") return;
    if (!document.querySelector(".home-bookstore-hero")) return;
    booted = true;
    snapshot = captureHardcodedHero();
    bindSlideChange();
    var run = function () { loadHero(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
    else run();
    if (document.addEventListener) document.addEventListener("visibilitychange", onVisibility);
  }

  var api = {
    HARDCODED_INTERVAL_MS: HARDCODED_INTERVAL_MS,
    REPO_SLIDES: REPO_SLIDES,
    isInternalHref: isInternalHref,
    isSafeImageUrl: isSafeImageUrl,
    repoSlideForKey: repoSlideForKey,
    intervalFromSettings: intervalFromSettings,
    isPublicBookEligible: isPublicBookEligible,
    inSchedule: inSchedule,
    resolveStoreSlide: resolveStoreSlide,
    buildCampaignItem: buildCampaignItem,
    restoreHardcodedHero: restoreHardcodedHero,
    captureHardcodedHero: captureHardcodedHero,
    loadHero: loadHero,
    boot: boot,
    ready: ready
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.KutadguHeroContent = api;
    if (typeof document !== "undefined") boot();
  }
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
