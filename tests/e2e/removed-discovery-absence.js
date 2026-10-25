const { test, expect } = require("./playwright-test");
const H = require("./helpers");

function registerRemovedDiscoveryTests() {
  test("reading discovery is not constructed after startup", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.openFresh(page, "/");
    await expect.poll(async () => page.locator("#bookCategories, #newBooksCarousel").count()).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
    await expect(page.locator("#premiumWizard")).toHaveCount(0);
  });
}

module.exports = { registerRemovedDiscoveryTests };
