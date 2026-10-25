const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const WIDTHS = [320, 390, 768, 1024, 1280];

async function openHome(page, width) {
  await page.setViewportSize({ width, height: width >= 768 ? 900 : 800 });
  await H.openFresh(page, "/");
  await expect.poll(async () => page.locator("#bookCategories [data-category-group]").count()).toBeGreaterThan(0);
}

test.describe("compact category navigation", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    H.allowLiveCatalogReads(page);
  });

  for (const width of WIDTHS) {
    for (const dark of [false, true]) {
      test(`closed and open states at ${width}px ${dark ? "dark" : "light"}`, async ({ page }) => {
        await openHome(page, width);
        if (dark) await page.evaluate(() => document.body.classList.add("dark-mode"));
        const mobile = width < 768;
        const toggle = page.locator(".category-nav-toggle");
        const groups = page.locator("#bookCategories [data-category-group]");
        await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
        if (mobile) {
          await expect(toggle).toBeVisible();
          const height = await toggle.evaluate((el) => el.getBoundingClientRect().height);
          expect(height).toBeGreaterThanOrEqual(54);
          expect(height).toBeLessThan(72);
          await expect(groups.first()).toBeHidden();
          await toggle.click();
          await expect(groups.first()).toBeVisible();
          await groups.first().click();
          await expect(page.locator("#bookCategories [data-category-back]")).toBeVisible();
          await expect(page.locator("#bookCategories .category-nav-leaf").first()).toBeVisible();
          await page.locator("#bookCategories [data-category-back]").click();
          await expect(groups.first()).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(groups.first()).toBeHidden();
          await expect(toggle).toBeFocused();
        } else {
          await expect(toggle).toBeHidden();
          const rowHeight = await page.locator("#bookCategories .category-nav-groups").evaluate((el) => el.getBoundingClientRect().height);
          expect(rowHeight).toBeGreaterThanOrEqual(57);
          expect(rowHeight).toBeLessThan(96);
          await expect(page.locator("#bookCategories .category-nav-leaf")).toHaveCount(0);
          await groups.first().click();
          await expect(page.locator("#bookCategories .category-nav-leaf").first()).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.locator("#bookCategories .category-nav-leaf")).toHaveCount(0);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(4);
        await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
      });
    }
  }

  test("all categories reaches an unmapped public category and a leaf closes the mobile picker", async ({ page }) => {
    await page.route("**/rpc/list_public_book_categories**", async (route) => {
      const rows = [
        { slug: "romanlar", source: "romanlar.html", label: "رومانلار", sort_order: 1 },
        { slug: "dastanlar", source: "dastanlar.html", label: "داستانلار", sort_order: 2 },
        { slug: "yoshurun", source: "yoshurun.html", label: "يوشۇرۇن", is_hidden: true, sort_order: 3 }
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ categories: rows, direct: rows, redirects: [] })
      });
    });
    await page.setViewportSize({ width: 390, height: 800 });
    await H.openFresh(page, "/");
    await page.locator(".category-nav-toggle").click();
    await page.locator("#bookCategories [data-category-all]").click();
    await expect(page.locator('#bookCategories a[href="/dastanlar"]')).toBeVisible();
    await expect(page.locator('#bookCategories a[href="/yoshurun"]')).toHaveCount(0);
    await expect(page.locator('#bookCategories a[href="/meshhur-shexisler"]')).toHaveCount(0);
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.locator('#bookCategories a[href="/dastanlar"]').click();
    await expect(page).toHaveURL(/\/dastanlar$/);
    expect(requests.some((url) => url.includes("premium-ux.js?v=22"))).toBe(false);
    await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
  });
});
