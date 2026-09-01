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
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill("بالىلار");
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
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
});
