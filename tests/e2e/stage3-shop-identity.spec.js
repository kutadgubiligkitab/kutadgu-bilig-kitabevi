const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");
const path = require("path");

test.describe("Stage 3 real shop identity", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("hero uses real shop photos and search stays below it", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator(".bookstore-scene")).toHaveCount(0);
    await expect(page.locator('img[src="/assets/store/shop-interior-main.webp"]')).toBeVisible();
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(3);
    const hero = await page.locator(".home-bookstore-hero").boundingBox();
    expect(hero && hero.height).toBeGreaterThan(120);
    expect(hero && hero.height).toBeLessThan(560);
    const searchTop = await page.locator("#books").evaluate((el) => el.getBoundingClientRect().top);
    const heroBottom = await page.locator(".home-bookstore-hero").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(searchTop).toBeGreaterThan(heroBottom - 2);
    await expect(page.locator("#searchInput")).toBeVisible();
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
  });

  test("About hours address and Instagram are the real shop facts", async ({ page }) => {
    await H.openFresh(page, "/");
    await expect(page.locator("#about")).toContainText("2013-يىلى قۇرۇلغان");
    await expect(page.locator("#about")).toContainText("كىتاب ئارىيەت بېرىش");
    await expect(page.locator("#contact")).toContainText("08:30–20:00");
    await expect(page.locator("#contact")).toContainText("Küçükçekmece");
    const ig = page.locator('#contact a[href="https://www.instagram.com/kutadgu_bilig_kitabhanisi/"]');
    await expect(ig).toBeVisible();
    await expect(ig).toHaveAttribute("target", "_blank");
    await expect(ig).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.locator('#contact a[href="https://wa.me/905368999888"]')).toBeVisible();
  });

  test("slideshow dots are keyboard accessible and reduced motion stays on first slide", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await H.openFresh(page, "/");
    const first = page.locator("[data-shop-hero-slide]").nth(0);
    const second = page.locator("[data-shop-hero-slide]").nth(1);
    await expect(first).toHaveClass(/is-active/);
    await page.waitForTimeout(800);
    await expect(first).toHaveClass(/is-active/);
    await expect(second).not.toHaveClass(/is-active/);
    await page.locator("[data-shop-hero-dot]").nth(2).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-shop-hero-slide]").nth(2)).toHaveClass(/is-active/);
  });

  test("390 768 1366 have no overflow and compact hero", async ({ page }) => {
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      await H.openFresh(page, "/");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, String(width)).toBeLessThanOrEqual(2);
      const hero = await page.locator(".home-bookstore-hero").boundingBox();
      expect(hero && hero.height, String(width)).toBeLessThan(width === 390 ? 580 : 620);
      await page.locator(".home-bookstore-hero").screenshot({
        path: path.join(outDir, `stage3-hero-${width}.png`)
      });
      await page.evaluate(() => {
        document.body.classList.add("dark-mode");
        document.documentElement.classList.add("dark-mode");
      });
      await page.locator(".home-bookstore-hero").screenshot({
        path: path.join(outDir, `stage3-hero-${width}-dark.png`)
      });
      await page.evaluate(() => {
        document.body.classList.remove("dark-mode");
        document.documentElement.classList.remove("dark-mode");
      });
    }
  });
});
