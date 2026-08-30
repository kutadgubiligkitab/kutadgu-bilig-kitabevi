const { test, expect, devices } = require("@playwright/test");
const H = require("./helpers");

test.describe("auth oauth vs recovery", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A generic homepage ?code= is not sent to reset-password", async ({ page }) => {
    await page.goto("/?code=oauth-test-code", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(page.url()).not.toMatch(/reset-password\.html/);
  });

  test("A account.html?code= stays on account, not reset-password", async ({ page }) => {
    await page.goto("/account.html?code=oauth-test-code", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/account.html");
    expect(page.url()).not.toMatch(/reset-password\.html/);
  });

  test("A homepage OAuth hash access_token is not sent to reset-password", async ({ page }) => {
    await page.goto("/#access_token=oauth-hash-token&token_type=bearer", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(page.url()).not.toMatch(/reset-password\.html/);
    expect(page.url()).toContain("access_token=oauth-hash-token");
  });

  test("A account.html OAuth hash stays on account, not reset-password", async ({ page }) => {
    await page.goto("/account.html#access_token=oauth-hash-token&token_type=bearer", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/account.html");
    expect(page.url()).not.toMatch(/reset-password\.html/);
    await expect(page.locator("#resetPasswordForm")).toHaveCount(0);
    await expect(page.locator("body")).toContainText(/Google|ھېساب|كىرىش/);
  });

  test("B type=recovery on homepage routes to reset UI", async ({ page }) => {
    await page.goto("/?type=recovery", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/reset-password.html");
    expect(new URL(page.url()).searchParams.get("type")).toBe("recovery");
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
  });

  test("B implicit recovery hash still opens reset UI", async ({ page }) => {
    await page.goto("/#access_token=recovery-hash-token&type=recovery", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/reset-password.html");
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
  });

  test("C generic OAuth code on reset-password is not treated as recovery", async ({ page }) => {
    await page.goto("/reset-password.html?code=oauth-test-code", { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => new URL(url).pathname === "/account.html", { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get("code")).toBe("oauth-test-code");
    await expect(page.locator("#resetPasswordForm")).toHaveCount(0);
  });

  test("C generic OAuth hash on reset-password is not treated as recovery", async ({ page }) => {
    await page.goto("/reset-password.html#access_token=oauth-hash-token&token_type=bearer", { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => new URL(url).pathname === "/account.html", { timeout: 10_000 });
    expect(new URL(page.url()).hash).toContain("access_token=oauth-hash-token");
    await expect(page.locator("#resetPasswordForm")).toHaveCount(0);
  });

  test("B intended recovery next=account does not bounce away from reset", async ({ page }) => {
    await page.goto("/reset-password.html?next=account&type=recovery", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/reset-password.html");
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/پارول يېڭىلاش|ئۇلانمىدىن/);
  });

  test("D Google redirect helper uses www on custom domain", async ({ page }) => {
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    const urls = await page.evaluate(() => ({
      origin: window.KUTADGU_SITE_ORIGIN,
      google: window.kutadguGoogleAccountRedirectTo(),
      account: window.kutadguPasswordResetRedirectTo("account"),
      admin: window.kutadguPasswordResetRedirectTo("admin")
    }));
    expect(urls.origin).toBe("https://www.kutadgubilig.com");
    expect(urls.google).toMatch(/\/account\.html$/);
    expect(urls.google).not.toContain("reset-password.html");
    expect(urls.account).toBe("https://www.kutadgubilig.com/reset-password.html?next=account");
    expect(urls.admin).toBe("https://www.kutadgubilig.com/reset-password.html?next=admin");
    expect(JSON.stringify(urls)).not.toContain("kutadgu-bilig-kitab.vercel.app");
  });
});

test.describe("auth oauth vs recovery — mobile viewport", () => {
  test.use({
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    isMobile: true,
    hasTouch: true
  });

  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("F mobile: homepage ?code= stays on storefront", async ({ page }) => {
    await page.goto("/?code=oauth-mobile-code", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(page.url()).not.toMatch(/reset-password\.html/);
  });

  test("F mobile: type=recovery still opens reset page", async ({ page }) => {
    await page.goto("/?type=recovery", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/reset-password.html");
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
  });

  test("F mobile: OAuth hash access_token is not sent to reset-password", async ({ page }) => {
    await page.goto("/#access_token=oauth-mobile-hash&token_type=bearer", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(page.url()).not.toMatch(/reset-password\.html/);
  });
});
