const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const LONG_TITLE = "سوغۇق يۈكلەش ئۈچۈن بەك ئۇزۇن ئۇيغۇرچە كىتاب نامى بولۇپ قېلىش ۋە قىسقارتماسلىق سىنىقى ئۈچۈن يەنە بىر قۇر تېكىست قوشۇلدى";
const DETAIL_TITLE = "سوغۇق يۈكلەش تەپسىلات كىتابى";
const REC_KEY = "kutadgu-recent-v1";

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

async function mockBooks(page, books) {
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

function chromeMetrics() {
  return () => {
    const card = document.querySelector(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)");
    if (!card) return { missing: true };
    const title = card.querySelector(".book-title");
    const author = card.querySelector(".book-author");
    const price = card.querySelector(".book-price");
    const cart = card.querySelector(".add-to-cart");
    const detail = card.querySelector(".detail-button");
    const fav = card.querySelector(".favorite-button");
    const share = card.querySelector(".share-button");
    const img = card.querySelector(".book-image img, .cover-stock-wrap img");
    const tokenColor = (name) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color.replace(/\s+/g, "");
      probe.remove();
      return value;
    };
    const tokenBg = (name) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).backgroundColor.replace(/\s+/g, "");
      probe.remove();
      return value;
    };
    const box = (el) => el ? el.getBoundingClientRect() : { height: 0, width: 0 };
    const text = card.innerText || "";
    return {
      missing: false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      titleSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      authorSize: author ? Number.parseFloat(getComputedStyle(author).fontSize) : 0,
      priceSize: price ? Number.parseFloat(getComputedStyle(price).fontSize) : 0,
      titleColor: title ? getComputedStyle(title).color.replace(/\s+/g, "") : "",
      authorColor: author ? getComputedStyle(author).color.replace(/\s+/g, "") : "",
      priceColor: price ? getComputedStyle(price).color.replace(/\s+/g, "") : "",
      siteText: tokenColor("--site-text"),
      siteTextSoft: tokenColor("--site-text-soft"),
      cartBg: cart ? getComputedStyle(cart).backgroundColor.replace(/\s+/g, "") : "",
      detailBg: detail ? getComputedStyle(detail).backgroundColor.replace(/\s+/g, "") : "",
      primaryBg: tokenBg("--button-primary-bg"),
      secondaryBg: tokenBg("--button-secondary-bg"),
      cartMinH: cart ? Number.parseFloat(getComputedStyle(cart).minHeight) : 0,
      detailMinH: detail ? Number.parseFloat(getComputedStyle(detail).minHeight) : 0,
      favMinH: fav ? Number.parseFloat(getComputedStyle(fav).minHeight) : 0,
      shareMinH: share ? Number.parseFloat(getComputedStyle(share).minHeight) : 0,
      cartH: box(cart).height,
      detailH: box(detail).height,
      favH: box(fav).height,
      shareH: box(share).height,
      objectFit: img ? getComputedStyle(img).objectFit : "",
      hasInStockLabel: /ئامباردا بار/.test(text),
      hasLow: !!card.querySelector(".stock-low") || /ئاز قالدى/.test(text),
      exactQty: /\d+\s*دانە/.test(text) || /stock\s*[:=]\s*\d/i.test(text)
    };
  };
}

const listingCatalog = [
  bookRow({ id: 91001, title: LONG_TITLE, stock: 5, stock_status: "in_stock" }),
  bookRow({ id: 91002, title: "ئاز قالغان رومان", stock: 2, stock_status: "low_stock" }),
  bookRow({ id: 91003, title: "تۈگىگەن رومان", stock: 0, stock_status: "out_of_stock" }),
  bookRow({ id: 91004, title: "باشقا شېئىر", source: "sheirlar.html", category: "شېئىرلار", stock: 8 })
];

test.describe("Stage 4B-1 public card chrome", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["91001"]);
    await H.clearShopStorage(page);
  });

  test("listing cart is primary, details secondary, type uses tokens", async ({ page }) => {
    await mockBooks(page, listingCatalog);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    const geo = await page.evaluate(chromeMetrics());
    expect(geo.missing).toBeFalsy();
    expect(geo.titleSize).toBeGreaterThanOrEqual(15);
    expect(geo.titleSize).toBeLessThanOrEqual(18);
    expect(geo.authorSize).toBeLessThan(geo.titleSize);
    expect(geo.titleColor).toBe(geo.siteText);
    expect(geo.authorColor).toBe(geo.siteTextSoft);
    expect(geo.priceColor).toBe(geo.siteText);
    expect(geo.cartBg).toBe(geo.primaryBg);
    expect(geo.detailBg).toBe(geo.secondaryBg);
    expect(geo.objectFit).toBe("contain");
  });

  test("listing stock states stay silent / low / unavailable", async ({ page }) => {
    await mockBooks(page, listingCatalog);
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
    const inStock = page.locator('.book-card[data-live-book-id="91001"]');
    await expect(inStock).toBeVisible();
    await expect(inStock.locator(".stock-in")).toHaveCount(0);
    await expect(inStock).not.toContainText("ئامباردا بار");
    await expect(inStock.locator(".add-to-cart")).toBeEnabled();
    const low = page.locator('.book-card[data-live-book-id="91002"]');
    await expect(low.locator(".stock-low")).toBeVisible();
    await expect(low).toContainText("ئاز قالدى");
    await expect(low).not.toContainText("دانە");
    await expect(low).not.toContainText("2 قالدى");
    const zero = page.locator('.book-card[data-live-book-id="91003"]');
    await expect(zero).toBeVisible();
    await expect(zero.locator(".add-to-cart")).toBeDisabled();
    await expect(zero).not.toContainText("0 دانە");
  });

  test("mobile listing and mini actions meet 44px targets without oversized buttons", async ({ page }) => {
    await mockBooks(page, listingCatalog);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    const geo = await page.evaluate(chromeMetrics());
    expect(geo.cartH).toBeGreaterThanOrEqual(44);
    expect(geo.detailH).toBeGreaterThanOrEqual(44);
    expect(geo.favH).toBeGreaterThanOrEqual(44);
    expect(geo.shareH).toBeGreaterThanOrEqual(44);
    expect(geo.cartH).toBeLessThan(72);
    expect(geo.overflowX).toBeLessThanOrEqual(2);
    expect(geo.objectFit).toBe("contain");
  });

  test("Similar Books keep wrap auto, compact gap, and 44px cart", async ({ page }) => {
    await mockBooks(page, [
      bookRow({ id: 91001, title: DETAIL_TITLE }),
      bookRow({ id: 91002, title: "ئوخشاش رومان قىسقا" }),
      bookRow({ id: 91005, title: "يەنە بىر ئوخشاش رومان" })
    ]);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, DETAIL_TITLE);
    await expect.poll(async () => page.locator("[data-detail-related] .shop-mini-card").count()).toBeGreaterThan(0);
    const geo = await page.evaluate(() => {
      const card = document.querySelector("[data-detail-related] .shop-mini-card");
      const wrap = card.querySelector(".cover-stock-wrap");
      const title = card.querySelector(".shop-mini-title");
      const cart = card.querySelector(".mini-actions .add-to-cart");
      const wrapBox = wrap.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      return {
        wrapHeightCss: getComputedStyle(wrap).height,
        wrapFlex: getComputedStyle(wrap).flexGrow,
        objectFit: getComputedStyle(wrap.querySelector("img")).objectFit,
        gap: titleBox.top - wrapBox.bottom,
        titleMinH: getComputedStyle(title).minHeight,
        cartH: cart.getBoundingClientRect().height,
        overflowX: document.documentElement.scrollWidth - window.innerWidth
      };
    });
    expect(geo.wrapHeightCss).not.toBe("100%");
    expect(geo.objectFit).toBe("contain");
    expect(geo.gap).toBeGreaterThanOrEqual(0);
    expect(geo.gap).toBeLessThan(28);
    expect(geo.titleMinH).toMatch(/px$/);
    expect(geo.cartH).toBeGreaterThanOrEqual(44);
    expect(geo.overflowX).toBeLessThanOrEqual(2);
  });

  test("my-books recently viewed mini cards keep compact cover-title gap", async ({ page }) => {
    await mockBooks(page, listingCatalog.concat([
      bookRow({ id: 91005, title: "يېقىندا كۆرۈلگەن باشقا" })
    ]));
    await page.addInitScript((key) => {
      try { localStorage.setItem(key, JSON.stringify(["91002", "91005", "91001"])); } catch (e) {}
    }, REC_KEY);
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/my-books.html", { waitUntil: "domcontentloaded" });
    await page.locator('[data-mybooks-tab="recent"]').click();
    await expect.poll(async () => page.locator("[data-recently-viewed] .shop-mini-card").count()).toBeGreaterThan(0);
    const geo = await page.evaluate(() => {
      const card = document.querySelector("[data-recently-viewed] .shop-mini-card");
      const wrap = card.querySelector(".cover-stock-wrap");
      const title = card.querySelector(".shop-mini-title");
      const cart = card.querySelector(".mini-actions .add-to-cart");
      return {
        wrapHeightCss: getComputedStyle(wrap).height,
        gap: title.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom,
        objectFit: getComputedStyle(wrap.querySelector("img")).objectFit,
        cartH: cart.getBoundingClientRect().height,
        overflowX: document.documentElement.scrollWidth - window.innerWidth
      };
    });
    expect(geo.wrapHeightCss).not.toBe("100%");
    expect(geo.gap).toBeLessThan(28);
    expect(geo.objectFit).toBe("contain");
    expect(geo.cartH).toBeGreaterThanOrEqual(44);
    expect(geo.overflowX).toBeLessThanOrEqual(2);
  });

  test("light and dark listing chrome stay readable", async ({ page }) => {
    await mockBooks(page, listingCatalog);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    const light = await page.evaluate(chromeMetrics());
    expect(light.cartBg).toBe(light.primaryBg);
    expect(light.detailBg).toBe(light.secondaryBg);
    await page.locator(".theme-toggle, .theme-button").first().click();
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark-mode"))).toBeTruthy();
    const dark = await page.evaluate(chromeMetrics());
    expect(dark.titleColor).toBe(dark.siteText);
    expect(dark.authorColor).toBe(dark.siteTextSoft);
    expect(dark.priceColor).toBe(dark.siteText);
    expect(dark.authorColor).not.toBe(dark.titleColor);
    expect(dark.cartBg).not.toBe(dark.detailBg);
    expect(dark.objectFit).toBe("contain");
  });
});
