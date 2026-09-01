const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("homepage compact first-view", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("idle #searchResults does not consume vertical space", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#searchResults .advanced-search-hint")).toHaveCount(0);
    const box = await page.locator("#searchResults").boundingBox();
    const height = box ? box.height : 0;
    expect(height).toBeLessThan(8);
  });

  test("search still returns results after typing", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill(book.searchToken);
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
    await expect(page.locator(`.advanced-search-result[data-live-book-id="${book.id}"]`)).toBeVisible();
    const box = await page.locator("#searchResults").boundingBox();
    expect(box && box.height).toBeGreaterThan(40);
  });

  test("#books stays below the sticky header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await page.locator(".home-hero-actions a[href='#books']").click();
    await expect.poll(async () => new URL(page.url()).hash).toBe("#books");
    const gap = await page.evaluate(() => {
      const header = document.querySelector("header");
      const books = document.querySelector("#books");
      if (!header || !books) return -1;
      return books.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  test("homepage carousel remains visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack, .home-carousel-card").first()).toBeVisible();
  });

  test("recommended empty + new books → newest tab opens", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: false, newest: true, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-carousel-mode="recommended"]')).toBeVisible();
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
  });

  test("recommended books + new empty → recommended tab opens", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
  });

  test("both recommended and new books keep both tabs usable", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-carousel-mode="newest"]')).toBeVisible();
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
  });

  test("all carousel modes empty keep the existing empty state", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: false, newest: false, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack .home-carousel-card")).toHaveCount(0);
    await expect(page.locator("#homeCarouselTrack")).toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
  });

  test("more than 4 books auto-advance by one book", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform), { timeout: 8_000 }).not.toBe(before);
  });

  test("4 or fewer books do not auto-advance", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 4 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.waitForTimeout(5200);
    const after = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    expect(after).toBe(before);
  });

  test("hover pauses auto-slide and mouse leave resumes it", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await page.locator("#newBooksCarousel").hover();
    const paused = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.waitForTimeout(5200);
    const still = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    expect(still).toBe(paused);
    await page.locator("header").hover();
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform), { timeout: 8_000 }).not.toBe(paused);
  });

  test("manual carousel arrows still move books", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.locator("#carouselNext").click();
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform)).not.toBe(before);
    const afterNext = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.locator("#carouselPrev").click();
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform)).not.toBe(afterNext);
  });

  test("reduced motion disables automatic carousel animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.waitForTimeout(5200);
    const after = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    expect(after).toBe(before);
  });

  test("mobile carousel has no horizontal overflow and swipe still moves", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(4);
    const swipeReady = await page.locator("#homeCarouselViewport").evaluate((el) => el.dataset.mobileSwipe === "1");
    expect(swipeReady).toBe(true);
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.evaluate(() => {
      const viewport = document.querySelector("#homeCarouselViewport");
      const TouchCls = window.Touch;
      const fire = (type, x) => {
        if (typeof TouchCls === "function") {
          const t = new TouchCls({ identifier: 1, target: viewport, clientX: x, clientY: 80, radiusX: 2, radiusY: 2, rotationAngle: 0, force: 1 });
          viewport.dispatchEvent(new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === "touchend" ? [] : [t],
            targetTouches: type === "touchend" ? [] : [t],
            changedTouches: [t]
          }));
          return;
        }
        document.querySelector("#carouselNext")?.click();
      };
      fire("touchstart", 280);
      fire("touchend", 160);
    });
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform)).not.toBe(before);
  });

  test("mobile homepage search tap target is not cramped", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    const metrics = await page.evaluate(() => {
      const btn = document.querySelector("#searchButton");
      const input = document.querySelector("#searchInput");
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return {
        buttonHeight: btn ? btn.getBoundingClientRect().height : 0,
        inputHeight: input ? input.getBoundingClientRect().height : 0,
        overflow
      };
    });
    expect(metrics.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.inputHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.overflow).toBeLessThanOrEqual(4);
  });

  test("homepage section order puts books before category cards", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#books")).toHaveCount(1);
    await expect(page.locator("#newBooksCarousel")).toHaveCount(1);
    await expect(page.locator("#homeFeaturedBooks")).toHaveCount(1);
    await expect(page.locator("#bookCategories")).toHaveCount(1);
    await expect(page.locator("#searchInput")).toHaveCount(1);
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).toBeVisible();
    await expect(page.locator("#homeFeaturedBooks .home-featured-section, #homeFeaturedBooks .home-feature-card, #homeFeaturedBooks .empty-state").first()).toBeVisible();
    await page.waitForSelector("#premiumDiscovery", { timeout: 45_000 });
    await expect(page.locator("#premiumDiscovery")).toHaveCount(1);
    const ordered = await page.evaluate(() => {
      const ids = ["books", "newBooksCarousel", "homeFeaturedBooks", "premiumDiscovery", "bookCategories", "orderProcess"];
      const nodes = ids.map((id) => document.getElementById(id));
      if (nodes.some((n) => !n)) return { missing: ids.filter((id, i) => !nodes[i]) };
      const ok = nodes.every((node, i) => i === 0 || !!(nodes[i - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { ok, ids };
    });
    expect(ordered.missing || []).toEqual([]);
    expect(ordered.ok).toBe(true);
    const book = await H.discoverLiveBook(page);
    await page.locator("#searchInput").fill(book.searchToken);
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
    await expect(page.locator(`.advanced-search-result[data-live-book-id="${book.id}"]`)).toBeVisible();
    await page.locator("#premiumDiscovery [data-premium-group]").first().click();
    await expect(page.locator("#premiumDiscoveryResults .premium-book-grid, #premiumDiscoveryResults .premium-friendly-empty").first()).toBeVisible();
    await expect(page.locator('#bookCategories a.card[href="adabiyat.html"]')).toBeVisible();
    await expect(page.locator('#bookCategories a.card[href="dini.html"]')).toBeVisible();
    await expect(page.locator('#bookCategories a.card[href="children.html"]')).toBeVisible();
  });

  test("mobile homepage section order has no overflow regression", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator("#homeFeaturedBooks")).toBeVisible();
    await expect(page.locator("#bookCategories")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(4);
    const tops = await page.evaluate(() => {
      const ids = ["books", "newBooksCarousel", "homeFeaturedBooks", "bookCategories"];
      return Object.fromEntries(ids.map((id) => {
        const el = document.getElementById(id);
        return [id, el ? el.getBoundingClientRect().top : null];
      }));
    });
    expect(tops.books).toBeLessThan(tops.newBooksCarousel);
    expect(tops.newBooksCarousel).toBeLessThan(tops.homeFeaturedBooks);
    expect(tops.homeFeaturedBooks).toBeLessThan(tops.bookCategories);
  });

  function parseTranslateX(transform) {
    const px = /translateX\((-?[\d.]+)px\)/.exec(transform || "");
    if (px) return Number(px[1]);
    const matrix = /matrix\(([-.\d]+),\s*[-.\d]+,\s*[-.\d]+,\s*[-.\d]+,\s*(-?[.\d]+)/.exec(transform || "");
    if (matrix) return Number(matrix[2]);
    return 0;
  }

  test("featured desktop marquee shows two visible rows without page overflow", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 20 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks [data-featured-row]")).toHaveCount(2);
    await expect(page.locator('[data-featured-row="top"]')).toBeVisible();
    await expect(page.locator('[data-featured-row="bottom"]')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const top = document.querySelector('[data-featured-row="top"]');
      const bottom = document.querySelector('[data-featured-row="bottom"]');
      const topBox = top ? top.getBoundingClientRect() : null;
      const bottomBox = bottom ? bottom.getBoundingClientRect() : null;
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const display = getComputedStyle(document.querySelector("#homeFeaturedBooks .home-featured-grid.is-marquee")).display;
      return {
        overflow,
        display,
        topH: topBox ? topBox.height : 0,
        bottomH: bottomBox ? bottomBox.height : 0,
        stacked: !!(topBox && bottomBox && bottomBox.top >= topBox.bottom - 1)
      };
    });
    expect(metrics.display).toBe("flex");
    expect(metrics.topH).toBeGreaterThan(40);
    expect(metrics.bottomH).toBeGreaterThan(40);
    expect(metrics.stacked).toBe(true);
    expect(metrics.overflow).toBeLessThanOrEqual(4);
  });

  test("featured top and bottom rows move in opposite directions", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-direction", "rtl");
    await expect(page.locator('[data-featured-row="bottom"]')).toHaveAttribute("data-direction", "ltr");
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "1");
    await expect(page.locator('[data-featured-row="bottom"]')).toHaveAttribute("data-autoplay", "1");
    const before = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    await expect.poll(async () => page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    })), { timeout: 8_000 }).not.toEqual(before);
    const after = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    expect(parseTranslateX(after.top)).toBeLessThan(parseTranslateX(before.top));
    expect(parseTranslateX(after.bottom)).toBeGreaterThan(parseTranslateX(before.bottom));
  });

  test("featured rows with too few books do not autoplay", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 4 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks .home-feature-card").first()).toBeVisible();
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "0");
    await expect(page.locator('[data-featured-row="bottom"]')).toHaveAttribute("data-autoplay", "0");
    const before = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    await page.waitForTimeout(5800);
    const after = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    expect(after).toEqual(before);
  });

  test("featured hover pauses both rows and mouse leave resumes", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "1");
    await page.locator("#homeFeaturedBooks .home-featured-section").hover();
    const paused = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    await page.waitForTimeout(5800);
    const still = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    expect(still).toEqual(paused);
    await page.locator("header").hover();
    await expect.poll(async () => page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    })), { timeout: 8_000 }).not.toEqual(paused);
  });

  test("reduced motion disables featured autoplay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks .home-feature-card").first()).toBeVisible();
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "0");
    const before = await page.evaluate(() => document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "");
    await page.waitForTimeout(5800);
    const after = await page.evaluate(() => document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "");
    expect(after).toBe(before);
  });

  test("mobile featured has no forced autoplay or horizontal overflow", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks .home-feature-card").first()).toBeVisible();
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "0");
    const metrics = await page.evaluate(() => {
      const track = document.querySelector('[data-featured-row="top"] .home-featured-track');
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const display = track ? getComputedStyle(track).display : "";
      const transform = track ? track.style.transform : "";
      return { overflow, display, transform };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(4);
    expect(metrics.display).toBe("contents");
    expect(!metrics.transform || metrics.transform === "none" || metrics.transform === "").toBeTruthy();
  });

  test("featured card heart, cart, and links stay usable", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    const card = page.locator('[data-featured-row="top"] .home-feature-card:not([data-featured-clone])').first();
    await expect(card).toBeVisible();
    await expect(card.locator(".home-feature-price")).toBeVisible();
    await expect(card.locator(".home-feature-author")).toBeVisible();
    const href = await card.locator("a").first().getAttribute("href");
    expect(href).toMatch(/book\.html/);
    await card.locator(".home-feature-heart").click();
    await expect(card.locator(".home-feature-heart")).toHaveAttribute("aria-pressed", "true");
    const beforeCart = await H.badgeCount(page);
    await card.locator("[data-cart-id]").click();
    await expect.poll(async () => H.badgeCount(page)).toBeGreaterThan(beforeCart);
  });

  for (const width of [360, 390, 430]) {
    test(`mobile P1 homepage UX at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await H.openFresh(page, "/");
      await expect(page.locator(".mobile-filter-toggle")).toBeVisible();
      await expect(page.locator("#homeFeaturedBooks .home-feature-card, #homeFeaturedBooks .empty-state").first()).toBeVisible();
      await page.waitForTimeout(800);

      await expect(page.locator(".home-search-card .mobile-filter-toggle")).toBeVisible();
      const visibleCount = await page.locator(".home-search-card .mobile-filter-toggle, .home-search-card .premium-filter-toggle").evaluateAll((els) => els.filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && !el.hidden && el.getClientRects().length > 0;
      }).length);
      expect(visibleCount).toBe(1);

      const panel = page.locator("#advancedSearchPanel, .home-search-card .advanced-search-panel").first();
      await expect(panel).toHaveClass(/is-collapsed/);
      await page.locator(".mobile-filter-toggle").click();
      await expect(panel).not.toHaveClass(/is-collapsed/);
      await expect.poll(async () => panel.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(20);
      await expect(page.locator("#searchCategory, .advanced-search-panel select, .advanced-search-panel input").first()).toBeVisible();
      await page.locator(".mobile-filter-toggle").click();
      await expect(panel).toHaveClass(/is-collapsed/);

      const metrics = await page.evaluate(() => {
        const tab = [...document.querySelectorAll("#newBooksCarousel .home-carousel-tab")].find((el) => !el.hidden);
        const arrow = document.querySelector("#newBooksCarousel .home-carousel-arrow");
        const input = document.querySelector("#searchInput");
        const button = document.querySelector("#searchButton");
        const track = document.querySelector("#homeCarouselTrack");
        const featured = document.querySelector('[data-featured-row="top"]');
        const featuredTrack = document.querySelector('[data-featured-row="top"] .home-featured-track');
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tabH: tab ? tab.getBoundingClientRect().height : 0,
          arrowW: arrow ? arrow.getBoundingClientRect().width : 0,
          arrowH: arrow ? arrow.getBoundingClientRect().height : 0,
          inputH: input ? input.getBoundingClientRect().height : 0,
          buttonH: button ? button.getBoundingClientRect().height : 0,
          carouselTransform: track ? track.style.transform : "",
          featuredAutoplay: featured ? featured.dataset.autoplay : "",
          featuredDisplay: featuredTrack ? getComputedStyle(featuredTrack).display : "",
          clones: document.querySelectorAll("#homeFeaturedBooks [data-featured-clone]").length
        };
      });
      expect(metrics.overflow).toBeLessThanOrEqual(4);
      expect(metrics.tabH).toBeGreaterThanOrEqual(44);
      expect(metrics.arrowW).toBeGreaterThanOrEqual(44);
      expect(metrics.arrowH).toBeGreaterThanOrEqual(44);
      expect(metrics.inputH).toBeGreaterThanOrEqual(44);
      expect(metrics.buttonH).toBeGreaterThanOrEqual(44);
      expect(metrics.featuredAutoplay).toBe("0");
      expect(metrics.featuredDisplay).toBe("contents");
      expect(metrics.clones).toBe(0);
      await page.waitForTimeout(2200);
      const afterCarousel = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
      expect(afterCarousel).toBe(metrics.carouselTransform);
    });
  }
});
