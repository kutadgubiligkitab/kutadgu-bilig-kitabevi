const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");

const LONG_TITLE = "سوغۇق يۈكلەش ئۈچۈن بەك ئۇزۇن ئۇيغۇرچە كىتاب نامى بولۇپ قېلىش ۋە قىسقارتماسلىق سىنىقى ئۈچۈن يەنە بىر قۇر تېكىست قوشۇلدى";

function bookRow(overrides) {
  return {
    id: 91001,
    title: LONG_TITLE,
    author: "سىناق ئاپتور",
    price: 128,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 5,
    stock_status: "in_stock",
    sales_count: 3,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

function parseSourceFilter(raw) {
  const value = String(raw || "");
  if (value.startsWith("eq.")) return { eq: value.slice(3) };
  const match = value.match(/^in\.\((.*)\)$/);
  if (!match) return {};
  const list = match[1].split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  return { in: list };
}

async function mockHomepageBooks(page, books) {
  const catalog = books;
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes("is_active=eq.false")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0" },
        body: "[]"
      });
    }
    const parsed = new URL(url);
    let filtered = catalog.filter((row) => row.is_active !== false);
    const wanted = [];
    const collect = (raw) => {
      const text = decodeURIComponent(String(raw || ""));
      const inMatch = text.match(/in\.\(([^)]*)\)/i);
      if (inMatch) {
        inMatch[1].split(",").forEach((part) => {
          const id = part.replace(/^"+|"+$/g, "").trim();
          if (id) wanted.push(id);
        });
      }
      const eqMatch = text.match(/eq\.([^,&)]+)/i);
      if (eqMatch) wanted.push(eqMatch[1].replace(/^"+|"+$/g, "").trim());
    };
    collect(parsed.searchParams.get("id") || "");
    collect(parsed.searchParams.get("legacy_id") || "");
    collect(parsed.searchParams.get("or") || "");
    if (wanted.length) {
      const set = new Set(wanted.map(String));
      filtered = catalog.filter((row) => set.has(String(row.id)) || set.has(String(row.legacy_id || "")));
    }
    const sourceFilter = parseSourceFilter(parsed.searchParams.get("source") || "");
    if (sourceFilter.eq) filtered = filtered.filter((row) => row.source === sourceFilter.eq);
    if (sourceFilter.in) filtered = filtered.filter((row) => sourceFilter.in.includes(row.source));
    const category = parsed.searchParams.get("category");
    if (category && category.startsWith("eq.")) {
      filtered = filtered.filter((row) => row.category === category.slice(3));
    }
    if (parsed.searchParams.get("is_recommended") === "eq.true") {
      filtered = filtered.filter((row) => row.is_recommended);
    }
    if (parsed.searchParams.get("is_new") === "eq.true") {
      filtered = filtered.filter((row) => row.is_new);
    }
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${filtered.length}` },
        body: ""
      });
    }
    const range = String(req.headers()["range"] || "0-23");
    const [from, to] = range.split("-").map(Number);
    const slice = filtered.slice(from || 0, (to || 23) + 1);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `${from || 0}-${(from || 0) + Math.max(slice.length - 1, 0)}/${filtered.length}` },
      body: JSON.stringify(slice)
    });
  });
}

function tokenProbe() {
  return () => {
    const tokenColor = (name) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color.replace(/\s+/g, "");
      probe.remove();
      return value;
    };
    const tokenSize = (name) => {
      const probe = document.createElement("span");
      probe.style.fontSize = `var(${name})`;
      document.body.appendChild(probe);
      const value = Number.parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      return value;
    };
    return {
      siteText: tokenColor("--site-text"),
      siteTextSoft: tokenColor("--site-text-soft"),
      md: tokenSize("--font-size-md"),
      xs: tokenSize("--font-size-xs")
    };
  };
}

function familyMetrics() {
  return (kind) => {
    const slack = 1.5;
    const inside = (parent, child) => {
      if (!parent || !child) return false;
      const p = parent.getBoundingClientRect();
      const c = child.getBoundingClientRect();
      return c.left >= p.left - slack && c.right <= p.right + slack && c.top >= p.top - slack && c.bottom <= p.bottom + slack;
    };
    let card;
    let title;
    let author;
    let price;
    let cart;
    let fav;
    let cover;
    if (kind === "featured") {
      card = document.querySelector("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)");
      if (!card) return { missing: true };
      title = card.querySelector(".home-feature-title");
      author = card.querySelector(".home-feature-author");
      price = card.querySelector(".home-feature-price");
      cart = card.querySelector(".home-feature-cart");
      fav = card.querySelector(".home-feature-heart");
      cover = card.querySelector(".home-feature-cover");
    } else if (kind === "carousel") {
      card = document.querySelector("#newBooksCarousel .home-carousel-card:not(.is-skeleton)");
      if (!card) return { missing: true };
      title = card.querySelector(".home-carousel-title");
      author = card.querySelector(".home-carousel-author");
      price = card.querySelector(".home-carousel-price");
      cart = card.querySelector(".home-carousel-cart");
      fav = card.querySelector(".home-carousel-fav");
      cover = card.querySelector(".home-carousel-cover");
    } else {
      card = document.querySelector("#premiumDiscoveryResults .premium-book-card[data-premium-book-id]");
      if (!card) return { missing: true };
      title = card.querySelector(".premium-card-link strong");
      author = card.querySelector(".premium-card-link small");
      price = card.querySelector(".premium-card-price");
      cart = card.querySelector(".premium-card-cart");
      fav = card.querySelector(".premium-card-favorite");
      cover = card.querySelector(".premium-card-cover");
    }
    const img = cover && cover.querySelector("img");
    const coverBox = cover ? cover.getBoundingClientRect() : { bottom: 0 };
    const afterCover = (kind === "premium" && card.querySelector(".premium-card-badges")) || title;
    const nextBox = afterCover ? afterCover.getBoundingClientRect() : { top: 0 };
    const cartBox = cart ? cart.getBoundingClientRect() : { width: 0, height: 0 };
    const favBox = fav ? fav.getBoundingClientRect() : { width: 0, height: 0 };
    const cardBox = card.getBoundingClientRect();
    const text = card.innerText || "";
    return {
      missing: false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      titleColor: title ? getComputedStyle(title).color.replace(/\s+/g, "") : "",
      authorColor: author ? getComputedStyle(author).color.replace(/\s+/g, "") : "",
      priceColor: price ? getComputedStyle(price).color.replace(/\s+/g, "") : "",
      titleSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      authorSize: author ? Number.parseFloat(getComputedStyle(author).fontSize) : 0,
      priceSize: price ? Number.parseFloat(getComputedStyle(price).fontSize) : 0,
      cartW: cartBox.width,
      cartH: cartBox.height,
      favW: favBox.width,
      favH: favBox.height,
      cartFullWidth: cartBox.width >= cardBox.width * 0.85,
      objectFit: img ? getComputedStyle(img).objectFit : "",
      coverTitleGap: nextBox.top - coverBox.bottom,
      heightCss: getComputedStyle(card).height,
      hasInStockLabel: /ئامباردا بار/.test(text),
      exactQty: /\d+\s*دانە/.test(text) || /stock\s*[:=]\s*\d/i.test(text),
      titleInside: inside(card, title),
      cartInside: inside(card, cart),
      overlayHref: !!document.querySelector('link[data-kutadgu-stage4b2-homepage-discovery]')
    };
  };
}

const catalog = [
  bookRow({ id: 91001, title: LONG_TITLE, stock: 5, stock_status: "in_stock" }),
  bookRow({ id: 91002, title: "ئاز قالغان رومان", stock: 2, stock_status: "low_stock" }),
  bookRow({ id: 91003, title: "تۈگىگەن رومان", stock: 0, stock_status: "out_of_stock" }),
  bookRow({ id: 91004, title: "باشقا شېئىر", source: "sheirlar.html", category: "شېئىرلار", stock: 8 })
];

const alignmentCatalog = [
  ...catalog,
  bookRow({
    id: 91005,
    title: "قىسقا",
    author: "قىسقا ئاپتور",
    is_new: false,
    is_recommended: false,
    stock: 6
  }),
  bookRow({
    id: 91006,
    title: `${LONG_TITLE} يەنە ئۇزۇن قۇر`,
    author: "ئۇزۇن ئاپتور ئىسمى",
    is_new: true,
    is_recommended: true,
    stock: 1,
    stock_status: "low_stock"
  }),
  bookRow({
    id: 91007,
    title: "ئوتتۇرا ناملىق رومان",
    author: "B",
    is_new: false,
    is_recommended: true,
    stock: 4
  }),
  bookRow({
    id: 91008,
    title: "شېئىر قىسقا",
    source: "sheirlar.html",
    category: "شېئىرلار",
    is_new: false,
    is_recommended: false,
    stock: 9
  })
];

function installDiscoverySettleObserver() {
  const state = {
    premiumAt: 0,
    lastMoveAt: 0,
    lastLoadAt: 0,
    failed: false
  };
  window.__kutadguDiscoverySettle = state;
  const bound = new WeakSet();
  const linkOf = () => document.querySelector("link[data-kutadgu-stage4b2-homepage-discovery]");
  const bindLink = (link) => {
    if (!link || bound.has(link)) return;
    bound.add(link);
    link.addEventListener("load", () => { state.lastLoadAt = performance.now(); });
    link.addEventListener("error", () => {
      state.failed = true;
      state.lastLoadAt = performance.now();
    });
  };
  const noteMove = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.matches("link[data-kutadgu-stage4b2-homepage-discovery]") || node.querySelector("link[data-kutadgu-stage4b2-homepage-discovery]")) {
      state.lastMoveAt = performance.now();
    }
  };
  const bindPremium = (script) => {
    if (!script || bound.has(script)) return;
    bound.add(script);
    const mark = () => { if (!state.premiumAt) state.premiumAt = performance.now(); };
    script.addEventListener("load", mark, { once: true });
    script.addEventListener("error", mark, { once: true });
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      [...record.addedNodes, ...record.removedNodes].forEach(noteMove);
      record.addedNodes.forEach((node) => {
        if (!node || node.nodeType !== 1) return;
        if (node.id === "kutadguPremiumUxScript") bindPremium(node);
        const nested = node.querySelector && node.querySelector("#kutadguPremiumUxScript");
        if (nested) bindPremium(nested);
      });
    }
    bindLink(linkOf());
    bindPremium(document.getElementById("kutadguPremiumUxScript"));
  });
  observer.observe(document, { childList: true, subtree: true });
  bindLink(linkOf());
  bindPremium(document.getElementById("kutadguPremiumUxScript"));
}

function readSettledDiscoveryChrome(page) {
  const reader = new Function(`
    const tokenProbe = (${tokenProbe().toString()});
    const familyMetrics = (${familyMetrics().toString()});
    const state = window.__kutadguDiscoverySettle;
    if (!state) return Promise.reject(new Error("discovery stylesheet observer missing"));
    return new Promise((resolve, reject) => {
      const started = performance.now();
      let frames = 0;
      let mark = "";
      const tick = () => {
        if (performance.now() - started > 15000) {
          reject(new Error("discovery stylesheet did not settle"));
          return;
        }
        if (state.failed) {
          reject(new Error("discovery stylesheet failed to load"));
          return;
        }
        if (!state.premiumAt) {
          const premium = performance.getEntriesByType("resource").find((entry) => entry.name.includes("/premium-ux.js") && entry.responseEnd > 0);
          if (premium) state.premiumAt = premium.responseEnd;
        }
        const link = document.querySelector("link[data-kutadgu-stage4b2-homepage-discovery]");
        let rules = 0;
        try { rules = link && link.sheet ? link.sheet.cssRules.length : 0; } catch (err) { rules = 0; }
        const cssAfterPremium = performance.getEntriesByType("resource").filter((entry) => entry.name.includes("stage4b2-homepage-discovery.css") && entry.responseEnd >= state.premiumAt);
        if (cssAfterPremium.length) state.lastLoadAt = Math.max(state.lastLoadAt, cssAfterPremium[cssAfterPremium.length - 1].responseEnd);
        const quiet = state.premiumAt > 0 && rules > 0 && state.lastLoadAt >= state.premiumAt && state.lastLoadAt >= state.lastMoveAt;
        const signature = quiet ? [state.lastLoadAt, state.lastMoveAt, rules].join(":") : "";
        if (!quiet || signature !== mark) {
          frames = 0;
          mark = signature;
          requestAnimationFrame(tick);
          return;
        }
        frames += 1;
        if (frames < 2) {
          requestAnimationFrame(tick);
          return;
        }
        resolve({
          tokens: tokenProbe(),
          featured: familyMetrics("featured"),
          carousel: familyMetrics("carousel")
        });
      };
      requestAnimationFrame(tick);
    });
  `);
  return page.evaluate(reader);
}

test("discovery settle observer starts when documentElement is absent", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error && error.message ? error.message : error)));
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "documentElement");
    let absent = true;
    Object.defineProperty(Document.prototype, "documentElement", {
      configurable: true,
      get() {
        if (absent) return null;
        return original.get.call(this);
      }
    });
    window.__restoreDocumentElement = () => { absent = false; };
  });
  await page.addInitScript(installDiscoverySettleObserver);
  await page.goto("about:blank", { waitUntil: "commit" });
  expect(errors).toEqual([]);
  const moved = await page.evaluate(() => new Promise((resolve) => {
    window.__restoreDocumentElement();
    const state = window.__kutadguDiscoverySettle;
    if (!state) {
      resolve({ started: false, moved: 0 });
      return;
    }
    const link = document.createElement("link");
    link.setAttribute("data-kutadgu-stage4b2-homepage-discovery", "1");
    document.documentElement.appendChild(link);
    queueMicrotask(() => resolve({ started: true, moved: state.lastMoveAt }));
  }));
  expect(moved.started).toBe(true);
  expect(moved.moved).toBeGreaterThan(0);
});

test.describe("Stage 4B-2 homepage discovery chrome", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installDiscoverySettleObserver);
    await H.installReadSafeNetwork(page);
    await H.clearShopStorage(page);
  });

  async function openHome(page, width, books = catalog) {
    await mockHomepageBooks(page, books);
    await page.setViewportSize({ width, height: width >= 1366 ? 1100 : 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator('link[data-kutadgu-stage4b2-homepage-discovery]').count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator('link[data-kutadgu-premium-cart-row-alignment]').count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator("#newBooksCarousel .home-carousel-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator("#bookCategories [data-category-group]").count()).toBeGreaterThan(0);
    await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const ready = (selector) => {
        const link = document.querySelector(selector);
        if (!link) return false;
        const sheet = [...document.styleSheets].find((item) => item.ownerNode === link);
        if (!sheet) return false;
        try { return sheet.cssRules.length > 0; } catch (err) { return false; }
      };
      return ready('link[href*="theme.css"]')
        && ready('link[data-kutadgu-stage4b2-homepage-discovery]')
        && ready('link[data-kutadgu-storefront-cards-1a]');
    })).toBe(true);
    await page.evaluate(() => document.fonts && document.fonts.ready);
  }

  function expectType(geo, tokens, width) {
    expect(geo.missing).toBeFalsy();
    expect(geo.titleColor).toBe(tokens.siteText);
    expect(geo.authorColor).toBe(tokens.siteTextSoft);
    expect(geo.priceColor).toBe(tokens.siteText);
    expect(Math.abs(geo.titleSize - tokens.md)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(geo.authorSize - tokens.xs)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(geo.priceSize - tokens.md)).toBeLessThanOrEqual(1.5);
    expect(geo.objectFit).toBe("contain");
    expect(geo.coverTitleGap).toBeGreaterThanOrEqual(-1);
    expect(geo.coverTitleGap).toBeLessThan(28);
    expect(geo.overflowX).toBeLessThanOrEqual(2);
    expect(geo.hasInStockLabel).toBeFalsy();
    expect(geo.exactQty).toBeFalsy();
    if (width >= 1366) {
      expect(geo.favW).toBeLessThanOrEqual(48);
      expect(geo.favH).toBeLessThanOrEqual(48);
    } else {
      expect(geo.favW).toBeLessThan(72);
      expect(geo.favH).toBeLessThan(72);
    }
  }

  function expectDiscoveryChrome(featured, carousel, tokens, width) {
    expectType(featured, tokens, width);
    expectType(carousel, tokens, width);
    expect(featured.missing).toBeFalsy();
    expect(carousel.missing).toBeFalsy();
    expect(featured.objectFit).toBe("contain");
    expect(carousel.objectFit).toBe("contain");
    expect(featured.overflowX).toBeLessThanOrEqual(2);
    expect(carousel.overflowX).toBeLessThanOrEqual(2);
    expect(featured.hasInStockLabel).toBeFalsy();
    expect(carousel.hasInStockLabel).toBeFalsy();
    expect(featured.exactQty).toBeFalsy();
    expect(carousel.exactQty).toBeFalsy();
    if (width >= 1366) {
      expect(featured.cartW).toBeGreaterThan(48);
      expect(carousel.cartW).toBeGreaterThan(48);
      expect(featured.cartW).toBeLessThan(140);
      expect(carousel.cartW).toBeLessThan(140);
    } else {
      expect(featured.cartW).toBeGreaterThan(40);
      expect(carousel.cartW).toBeGreaterThan(40);
      expect(featured.cartW).toBeLessThan(160);
      expect(carousel.cartW).toBeLessThan(160);
    }
    expect(featured.cartFullWidth).toBeFalsy();
    expect(carousel.cartFullWidth).toBeFalsy();
    expect(carousel.heightCss).not.toBe("100%");
  }

  async function enableDarkMode(page) {
    await page.evaluate(() => {
      document.body.classList.add("dark-mode");
      document.documentElement.classList.add("dark-mode");
    });
    await expect.poll(async () => page.evaluate(() => {
      if (!document.body.classList.contains("dark-mode")) return false;
      const token = (name) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).color.replace(/\s+/g, "");
        probe.remove();
        return value;
      };
      const text = token("--site-text");
      const soft = token("--site-text-soft");
      const pairs = [
        ["#homeFeaturedBooks .home-feature-title", text],
        ["#homeFeaturedBooks .home-feature-price", text],
        ["#newBooksCarousel .home-carousel-title", text],
        ["#homeFeaturedBooks .home-feature-author", soft],
        ["#newBooksCarousel .home-carousel-author", soft]
      ];
      return pairs.every(([selector, color]) => {
        const node = document.querySelector(selector);
        return !!node && getComputedStyle(node).color.replace(/\s+/g, "") === color;
      });
    })).toBe(true);
  }

  async function captureFamily(page, width, mode, outDir) {
    const dirs = [...new Set([outDir, "/tmp/stage4b2-screens"])];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const shots = [
      ["#homeFeaturedBooks", `stage4b2_featured_${width}_${mode}.png`],
      ["#newBooksCarousel", `stage4b2_carousel_${width}_${mode}.png`],
      ["#bookCategories", `stage4b2_categories_${width}_${mode}.png`]
    ];
    for (const [sel, name] of shots) {
      await page.locator(sel).scrollIntoViewIfNeeded();
      const buf = await page.locator(sel).screenshot({ animations: "disabled", timeout: 15000 });
      let wrote = false;
      let lastErr = null;
      for (const dir of dirs) {
        try {
          fs.writeFileSync(`${dir}/${name}`, buf);
          wrote = true;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!wrote) throw lastErr;
    }
  }

  for (const width of [390, 768, 1366]) {
    test(`light chrome at ${width}`, async ({ page }) => {
      await openHome(page, width);
      const sample = await readSettledDiscoveryChrome(page);
      expectDiscoveryChrome(sample.featured, sample.carousel, sample.tokens, width);
    });
  }

  for (const width of [390, 768, 1366]) {
    test(`dark chrome at ${width}`, async ({ page }) => {
      await openHome(page, width);
      await enableDarkMode(page);
      const sample = await readSettledDiscoveryChrome(page);
      expectDiscoveryChrome(sample.featured, sample.carousel, sample.tokens, width);
    });
  }

  test("a delayed discovery stylesheet reload is measured after it settles", async ({ page }) => {
    let holdReload = false;
    let releaseReload;
    const reloadHeld = new Promise((resolve) => { releaseReload = resolve; });
    await page.route("**/stage4b2-homepage-discovery.css*", async (route) => {
      if (holdReload) await reloadHeld;
      await route.continue();
    });
    await openHome(page, 1366);
    holdReload = true;
    await page.evaluate(() => { window.__discoverySettled = false; });
    const nextRequest = page.waitForRequest((request) => request.url().includes("/stage4b2-homepage-discovery.css"));
    const reading = (async () => {
      await page.evaluate(() => {
        const link = document.querySelector("link[data-kutadgu-stage4b2-homepage-discovery]");
        document.head.appendChild(link);
      });
      const sample = await readSettledDiscoveryChrome(page);
      await page.evaluate(() => { window.__discoverySettled = true; });
      return sample;
    })();
    await nextRequest;
    expect(await page.evaluate(() => window.__discoverySettled)).toBe(false);
    releaseReload();
    const sample = await reading;
    expect(sample.tokens.md).toBeGreaterThan(0);
    expectDiscoveryChrome(sample.featured, sample.carousel, sample.tokens, 1366);
  });

  test("stock states stay silent / low / unavailable on homepage cards", async ({ page }) => {
    await openHome(page, 1366);
    const inStock = page.locator('#homeFeaturedBooks .home-feature-card[data-fav-id], #homeFeaturedBooks .home-feature-card').filter({ has: page.locator('[data-fav-id="91001"], [data-cart-id="91001"]') }).first();
    await expect(page.locator('#homeFeaturedBooks [data-cart-id="91001"]')).toBeVisible();
    await expect(page.locator("#homeFeaturedBooks")).not.toContainText("ئامباردا بار");
    await expect(page.locator('#homeFeaturedBooks [data-cart-id="91001"]')).toBeEnabled();
    const low = page.locator('#homeFeaturedBooks [data-cart-id="91002"]').locator("xpath=ancestor::article[contains(@class,'home-feature-card')]");
    await expect(low).toContainText("ئاز قالدى");
    await expect(low).not.toContainText("دانە");
    await expect(low).not.toContainText("2 قالدى");
    await expect(page.locator('#homeFeaturedBooks [data-cart-id="91003"]')).toBeDisabled();
    await expect(page.locator("#homeFeaturedBooks")).not.toContainText("0 دانە");
    await expect(inStock).toBeTruthy();
  });

  test("preview screenshots of homepage discovery chrome", async ({ page }) => {
    test.setTimeout(180000);
    const outDir = "/opt/cursor/artifacts";
    fs.mkdirSync(outDir, { recursive: true });
    for (const width of [390, 768, 1366]) {
      await openHome(page, width);
      await captureFamily(page, width, "light", outDir);
      await enableDarkMode(page);
      await captureFamily(page, width, "dark", outDir);
    }
  });

  function premiumRowMetrics() {
    return () => {
      const cards = [...document.querySelectorAll("#newBooksCarousel .home-carousel-card:not(.is-skeleton)")];
      return cards.map((card) => {
        const cover = card.querySelector(".home-carousel-cover");
        const img = cover && cover.querySelector("img");
        const title = card.querySelector(".home-carousel-title");
        const afterCover = title;
        const cart = card.querySelector(".home-carousel-cart");
        const coverBox = cover ? cover.getBoundingClientRect() : { bottom: 0 };
        const nextBox = afterCover ? afterCover.getBoundingClientRect() : { top: 0 };
        const cartBox = cart ? cart.getBoundingClientRect() : { bottom: 0, width: 0 };
        const cardBox = card.getBoundingClientRect();
        const titleCs = title ? getComputedStyle(title) : null;
        const cardCs = getComputedStyle(card);
        const cartCs = cart ? getComputedStyle(cart) : null;
        const text = card.innerText || "";
        return {
          top: Math.round(cardBox.top * 100) / 100,
          cartBottom: cartBox.bottom,
          coverTitleGap: nextBox.top - coverBox.bottom,
          objectFit: img ? getComputedStyle(img).objectFit : "",
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          heightCss: cardCs.height,
          heightSpecified: cardCs.getPropertyValue("height"),
          cartFullWidth: cartBox.width >= cardBox.width * 0.85,
          cartWidthCss: cartCs ? cartCs.width : "",
          titleClamp: titleCs ? String(titleCs.webkitLineClamp || titleCs.lineClamp || "") : "",
          hasInStockLabel: /ئامباردا بار/.test(text),
          exactQty: /\d+\s*دانە/.test(text) || /stock\s*[:=]\s*\d/i.test(text)
        };
      });
    };
  }

  function groupByVisualRow(items) {
    const rows = [];
    for (const item of items) {
      const row = rows.find((candidate) => Math.abs(candidate.top - item.top) <= 2);
      if (row) row.items.push(item);
      else rows.push({ top: item.top, items: [item] });
    }
    return rows;
  }

  function expectAlignedPremiumRows(items) {
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) {
      expect(item.objectFit).toBe("contain");
      expect(item.coverTitleGap).toBeGreaterThanOrEqual(-1);
      expect(item.coverTitleGap).toBeLessThan(28);
      expect(item.overflowX).toBeLessThanOrEqual(2);
      expect(item.heightCss).not.toBe("100%");
      expect(item.heightSpecified).not.toBe("100%");
      expect(item.cartFullWidth).toBeFalsy();
      expect(item.hasInStockLabel).toBeFalsy();
      expect(item.exactQty).toBeFalsy();
    }
    const rows = groupByVisualRow(items);
    expect(rows.length).toBeGreaterThan(0);
  }

  async function captureAlignedCarts(page, width, mode, outDir) {
    const dirs = [...new Set([outDir, "/tmp/stage4b2-screens", "/tmp/premium-cart-row-screens"])];
    for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
    await page.locator("#newBooksCarousel").scrollIntoViewIfNeeded();
    const buf = await page.locator("#newBooksCarousel").screenshot({ animations: "disabled", timeout: 15000 });
    const name = `premium_cart_row_alignment_${width}_${mode}.png`;
    let wrote = false;
    let lastErr = null;
    for (const dir of dirs) {
      try {
        fs.writeFileSync(`${dir}/${name}`, buf);
        wrote = true;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!wrote) throw lastErr;
  }

  for (const width of [390, 768, 1366]) {
    test(`light premium cart row alignment at ${width}`, async ({ page }) => {
      await openHome(page, width, alignmentCatalog);
      const items = await page.evaluate(premiumRowMetrics());
      expectAlignedPremiumRows(items);
    });
  }

  for (const width of [390, 768, 1366]) {
    test(`dark premium cart row alignment at ${width}`, async ({ page }) => {
      await openHome(page, width, alignmentCatalog);
      await enableDarkMode(page);
      const items = await page.evaluate(premiumRowMetrics());
      expectAlignedPremiumRows(items);
    });
  }

  test("preview screenshots of aligned premium cart buttons", async ({ page }) => {
    test.setTimeout(180000);
    const outDir = "/opt/cursor/artifacts";
    fs.mkdirSync(outDir, { recursive: true });
    for (const width of [390, 768, 1366]) {
      await openHome(page, width, alignmentCatalog);
      await captureAlignedCarts(page, width, "light", outDir);
      await enableDarkMode(page);
      await captureAlignedCarts(page, width, "dark", outDir);
    }
  });
});
