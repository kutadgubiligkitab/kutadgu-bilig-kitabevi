const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("stage 2B books RLS storefront/admin/auth smoke", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("storefront homepage still loads active catalog UI", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#searchInput")).toBeVisible();
  });

  test("Admin login gate still hides dashboard", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  test("Google OAuth still targets account.html not reset-password", async ({ page }) => {
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.kutadguGoogleAccountRedirectTo === "function");
    const google = await page.evaluate(() => window.kutadguGoogleAccountRedirectTo());
    expect(google).toMatch(/\/account\.html$/);
    expect(google).not.toMatch(/reset-password/);
  });

  test("password reset page still requires a recovery link", async ({ page }) => {
    await page.goto("/reset-password.html?type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
  });
});

for (const [width, height] of [[390, 844], [412, 915], [768, 1024], [1280, 800]]) {
  test.describe(`stage 2B viewport ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });
    test(`homepage search remains usable at ${width}`, async ({ page }) => {
      await H.installReadSafeNetwork(page);
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#searchInput")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  });
}
