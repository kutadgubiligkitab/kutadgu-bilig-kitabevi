const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("storefront smoke", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("1 homepage loads", async ({ page }) => {
    const errors = H.collectPageErrors(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#searchInput")).toBeVisible();
    await expect(page.locator("#homeFeaturedBooks, .home-search-card").first()).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("2 search returns results", async ({ page }) => {
    await H.openFresh(page, "/index.html");
    await page.locator("#searchInput").fill("بالىلار");
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator(".advanced-search-result").first()).toBeVisible();
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
  });

  test("3 zero-result search shows empty state", async ({ page }) => {
    await H.openFresh(page, "/index.html");
    await page.locator("#searchInput").fill("999888777666555444xxx");
    await page.locator("#searchButton").click();
    await page.waitForSelector(".search-empty, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator(".search-empty")).toBeVisible();
    await expect(page.locator("#searchResults")).toContainText(/نەتىجە تېپىلمىدى|ئىزدەش نەتىجىسى تېپىلمىدى/);
  });

  test("4 book detail opens by bigint id", async ({ page }) => {
    await H.openFresh(page, "/book.html?id=102");
    const title = await H.waitForDetailTitle(page);
    expect(title).toMatch(/بالىلار/);
    await expect(page.locator(".detail-main-cart, .detail-unavailable-panel").first()).toBeVisible();
    expect(page.url()).toMatch(/id=102/);
  });

  test("5 legacy id resolves to the same book", async ({ page }) => {
    await H.openFresh(page, "/book.html?id=102");
    const canonicalTitle = (await H.waitForDetailTitle(page)).trim();
    const canonicalId = await page.evaluate(() => window.kutadguShop.find("children-3")?.id || window.kutadguShop.find("102")?.id);

    await H.openFresh(page, "/children-3.html");
    const legacyTitle = (await H.waitForDetailTitle(page)).trim();
    expect(legacyTitle).toBe(canonicalTitle);

    await H.openFresh(page, "/book.html?id=children-3");
    const queryTitle = (await H.waitForDetailTitle(page)).trim();
    expect(queryTitle).toBe(canonicalTitle);
    expect(String(canonicalId)).toBe("102");
  });

  test("14 hidden/inactive books are not listed", async ({ page }) => {
    const listingUrls = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/rest/v1/books") && req.method() === "GET") listingUrls.push(u);
    });
    await H.openFresh(page, "/index.html");
    await page.waitForTimeout(1500);
    const catalogGets = listingUrls.filter((u) => /is_active=eq\.true/.test(u) || /select=/.test(u));
    const publicLists = listingUrls.filter((u) => !/is_active=eq\.false/.test(u) && /\/rest\/v1\/books/.test(u));
    expect(publicLists.some((u) => /is_active=eq\.true/.test(u)), "storefront listings should filter is_active=eq.true").toBeTruthy();

    const visibility = await page.evaluate(() => {
      const vis = window.kutadguShop.isStorefrontVisible;
      return {
        inactiveHidden: vis({ id: "999999", is_active: false, isActive: false }) === false,
        activeOk: vis({ id: "102", is_active: true, isActive: true }) === true
      };
    });
    expect(visibility.inactiveHidden).toBe(true);
    expect(visibility.activeOk).toBe(true);

    const inactiveOnPage = await page.evaluate(() => {
      const books = window.kutadguShop.getCatalog() || [];
      return books.filter((b) => b.isActive === false || b.is_active === false).map((b) => b.id);
    });
    expect(inactiveOnPage).toEqual([]);
  });

  test("15 mobile viewport has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/index.html");
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(4);

    await page.goto("/book.html?id=102", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForDetailTitle(page);
    const overflowDetail = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflowDetail).toBeLessThanOrEqual(4);
  });

  test("16 desktop main pages render without JS errors", async ({ page }) => {
    const errors = H.collectPageErrors(page);
    for (const path of ["/index.html", "/children.html", "/romanlar.html", "/book.html?id=102", "/cart.html"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await H.waitForShop(page);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
