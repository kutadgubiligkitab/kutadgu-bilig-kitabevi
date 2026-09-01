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
