const { test, expect } = require("./playwright-test");
const H = require("./helpers");

test.describe("stage 2C AAL2 books/RPC storefront/admin/auth smoke", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("storefront homepage still loads", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#searchInput")).toBeVisible();
  });

  test("Admin MFA gate markup still exists between login and dashboard", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  test("Google OAuth still targets account.html", async ({ page }) => {
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.kutadguGoogleAccountRedirectTo === "function");
    const google = await page.evaluate(() => window.kutadguGoogleAccountRedirectTo());
    expect(google).toMatch(/\/account\.html$/);
    expect(google).not.toMatch(/reset-password/);
  });

  test("password reset still requires a recovery link", async ({ page }) => {
    await page.goto("/reset-password.html?type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
  });
});
