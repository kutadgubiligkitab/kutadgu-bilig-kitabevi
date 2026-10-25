const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const { registerRemovedDiscoveryTests } = require("./removed-discovery-absence");

test.describe("compact discovery carousel cards", () => {
  registerRemovedDiscoveryTests();

  test("recommended carousel also drops forced min-height", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newBooksCarousel .home-carousel-card").first()).toBeVisible();
    await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
    const geo = await page.evaluate(() => {
      const card = document.querySelector("#newBooksCarousel .home-carousel-card");
      const img = document.querySelector("#newBooksCarousel .home-carousel-cover img");
      return {
        minHeight: card ? getComputedStyle(card).minHeight : "",
        objectFit: img ? getComputedStyle(img).objectFit : "",
        titleClamp: (() => {
          const title = document.querySelector("#newBooksCarousel .home-carousel-title");
          if (!title) return "";
          const cs = getComputedStyle(title);
          return cs.webkitLineClamp || cs.lineClamp || "";
        })()
      };
    });
    expect(geo.minHeight === "0px" || geo.minHeight === "auto" || Number.parseFloat(geo.minHeight) === 0).toBeTruthy();
    if (geo.objectFit) expect(geo.objectFit).toBe("contain");
    if (geo.titleClamp) expect(String(geo.titleClamp)).toBe("2");
  });
});