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
      card = document.querySelector("#premiumDiscoveryResults .premium-book-card");
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

test.describe("Stage 4B-2 homepage discovery chrome", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.clearShopStorage(page);
  });

  async function openHome(page, width) {
    await mockHomepageBooks(page, catalog);
    await page.setViewportSize({ width, height: width >= 1366 ? 900 : 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator('link[data-kutadgu-stage4b2-homepage-discovery]').count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    await expect.poll(async () => page.locator("#newBooksCarousel .home-carousel-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    await page.waitForSelector("#premiumDiscovery", { timeout: 20000 });
    await page.locator("#premiumDiscovery [data-premium-group]").first().click();
    await expect.poll(async () => page.locator("#premiumDiscoveryResults .premium-book-card").count()).toBeGreaterThan(0);
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

  for (const width of [390, 768, 1366]) {
    test(`light chrome at ${width}`, async ({ page }) => {
      await openHome(page, width);
      const tokens = await page.evaluate(tokenProbe());
      const featured = await page.evaluate(familyMetrics(), "featured");
      const carousel = await page.evaluate(familyMetrics(), "carousel");
      const premium = await page.evaluate(familyMetrics(), "premium");
      expectType(featured, tokens, width);
      expectType(carousel, tokens, width);
      expectType(premium, tokens, width);
      if (width >= 1366) {
        expect(featured.cartW).toBeLessThanOrEqual(48);
        expect(carousel.cartW).toBeLessThanOrEqual(48);
      } else {
        expect(featured.cartW).toBeLessThan(72);
        expect(carousel.cartW).toBeLessThan(72);
      }
      expect(featured.cartFullWidth).toBeFalsy();
      expect(carousel.cartFullWidth).toBeFalsy();
      expect(premium.cartFullWidth).toBeTruthy();
      expect(carousel.heightCss).not.toBe("100%");
      expect(premium.heightCss).not.toBe("100%");
    });
  }

  test("dark mode keeps token colors and compact carts", async ({ page }) => {
    await openHome(page, 1366);
    await page.locator(".theme-toggle, .theme-button").first().click();
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark-mode"))).toBeTruthy();
    const tokens = await page.evaluate(tokenProbe());
    for (const kind of ["featured", "carousel", "premium"]) {
      const geo = await page.evaluate(familyMetrics(), kind);
      expectType(geo, tokens, 1366);
    }
    const featured = await page.evaluate(familyMetrics(), "featured");
    const carousel = await page.evaluate(familyMetrics(), "carousel");
    const premium = await page.evaluate(familyMetrics(), "premium");
    expect(featured.cartW).toBeLessThanOrEqual(48);
    expect(carousel.cartW).toBeLessThanOrEqual(48);
    expect(premium.cartFullWidth).toBeTruthy();
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
    test.setTimeout(120000);
    const outDir = "/opt/cursor/artifacts";
    fs.mkdirSync(outDir, { recursive: true });
    for (const width of [390, 768, 1366]) {
      await openHome(page, width);
      await page.locator("#homeFeaturedBooks").scrollIntoViewIfNeeded();
      await page.locator("#homeFeaturedBooks").screenshot({ path: `${outDir}/stage4b2_featured_${width}_light.png` });
      await page.locator("#newBooksCarousel").scrollIntoViewIfNeeded();
      await page.locator("#newBooksCarousel").screenshot({ path: `${outDir}/stage4b2_carousel_${width}_light.png` });
      await page.locator("#premiumDiscovery").scrollIntoViewIfNeeded();
      await page.locator("#premiumDiscovery").screenshot({ path: `${outDir}/stage4b2_premium_${width}_light.png` });
      if (width === 1366) {
        await page.locator(".theme-toggle, .theme-button").first().click();
        await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark-mode"))).toBeTruthy();
        await page.locator("#homeFeaturedBooks").scrollIntoViewIfNeeded();
        await page.locator("#homeFeaturedBooks").screenshot({ path: `${outDir}/stage4b2_featured_${width}_dark.png` });
        await page.locator("#newBooksCarousel").scrollIntoViewIfNeeded();
        await page.locator("#newBooksCarousel").screenshot({ path: `${outDir}/stage4b2_carousel_${width}_dark.png` });
        await page.locator("#premiumDiscovery").scrollIntoViewIfNeeded();
        await page.locator("#premiumDiscovery").screenshot({ path: `${outDir}/stage4b2_premium_${width}_dark.png` });
      }
    }
  });
});
