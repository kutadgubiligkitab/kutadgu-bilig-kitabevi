const { test, expect } = require("./playwright-test");
const H = require("./helpers");

async function addOnceOnMobile(page) {
  const book = await H.discoverLiveBook(page);
  await H.openFresh(page, book.detailPath);
  await H.waitForDetailTitle(page, book.title);
  await H.clearShopStorage(page);
  await page.locator(".detail-main-cart").click();
  return book;
}

test.describe("mobile toast stays above bottom nav", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("signed-out mobile add-to-cart toast is above the bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await addOnceOnMobile(page);
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    const toast = page.locator(".shop-toast");
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText(/كىتاب سېۋەتكە قوشۇلدى/);
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const toastEl = document.querySelector(".shop-toast");
      const nav = document.querySelector(".mobile-bottom-nav");
      const toastBox = toastEl.getBoundingClientRect();
      const navBox = nav.getBoundingClientRect();
      return {
        toastTop: toastBox.top,
        toastBottom: toastBox.bottom,
        toastLeft: toastBox.left,
        toastRight: toastBox.right,
        navTop: navBox.top,
        viewportH: window.innerHeight,
        viewportW: window.innerWidth,
        opacity: getComputedStyle(toastEl).opacity,
        text: String(toastEl.textContent || "")
      };
    });
    expect(geometry.toastBottom).toBeLessThanOrEqual(geometry.navTop - 4);
    expect(geometry.toastTop).toBeGreaterThanOrEqual(0);
    expect(geometry.toastLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.toastRight).toBeLessThanOrEqual(geometry.viewportW + 1);
    expect(geometry.toastBottom).toBeLessThanOrEqual(geometry.viewportH);
    expect(Number(geometry.opacity)).toBeGreaterThan(0.9);
    expect(geometry.text).toMatch(/كىتاب سېۋەتكە قوشۇلدى/);
  });

  test("iPhone safe-area inset keeps toast above bottom controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const book = await H.discoverLiveBook(page);
    await H.openFresh(page, book.detailPath);
    await H.waitForDetailTitle(page, book.title);
    await H.clearShopStorage(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--mobile-bottom-safe", "34px");
    });
    await page.locator(".detail-main-cart").click();
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    const toast = page.locator(".shop-toast");
    await expect(toast).toBeVisible();
    const geometry = await page.evaluate(() => {
      const toastEl = document.querySelector(".shop-toast");
      const nav = document.querySelector(".mobile-bottom-nav");
      return {
        toastBottom: toastEl.getBoundingClientRect().bottom,
        navTop: nav.getBoundingClientRect().top,
        navHeight: nav.getBoundingClientRect().height,
        safe: getComputedStyle(document.documentElement).getPropertyValue("--mobile-bottom-safe").trim()
      };
    });
    expect(geometry.safe).toBe("34px");
    expect(geometry.navHeight).toBeGreaterThan(80);
    expect(geometry.toastBottom).toBeLessThanOrEqual(geometry.navTop - 4);
  });

  test("desktop toast layout stays near the bottom-right corner", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await addOnceOnMobile(page);
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    const toast = page.locator(".shop-toast");
    await expect(toast).toBeVisible();
    await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
    const geometry = await page.evaluate(() => {
      const toastEl = document.querySelector(".shop-toast");
      const box = toastEl.getBoundingClientRect();
      const css = getComputedStyle(toastEl);
      return {
        bottom: box.bottom,
        right: box.right,
        viewportH: window.innerHeight,
        viewportW: window.innerWidth,
        cssBottom: css.bottom,
        cssRight: css.right,
        cssZ: css.zIndex
      };
    });
    expect(geometry.cssBottom).toBe("18px");
    expect(geometry.cssRight).toBe("18px");
    expect(Number(geometry.cssZ)).toBe(10000);
    expect(geometry.viewportH - geometry.bottom).toBeLessThanOrEqual(28);
    expect(geometry.viewportW - geometry.right).toBeLessThanOrEqual(28);
  });
});
