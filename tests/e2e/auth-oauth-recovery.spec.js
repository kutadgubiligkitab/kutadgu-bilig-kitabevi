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

  test("C PKCE code on reset-password is not treated as recovery and is not bounced", async ({ page }) => {
    await page.goto("/reset-password.html?code=oauth-test-code", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password.html");
    expect(page.url()).not.toMatch(/\/account\.html/);
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
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
    expect(urls.origin).toBe("https://www.kutadgubilik.com");
    expect(urls.google).toBe(`${new URL(page.url()).origin}/account.html`);
    expect(urls.google).not.toContain("reset-password.html");
    expect(urls.google).not.toContain("kutadgubilik.com");
    expect(JSON.stringify(urls)).not.toContain("kutadgubilig.com");
    const origin = new URL(page.url()).origin;
    expect(urls.account).toBe(`${origin}/reset-password.html?type=recovery&next=account`);
    expect(urls.admin).toBe(`${origin}/reset-password.html?type=recovery&next=admin`);
    expect(urls.account).not.toMatch(/account\.html/);
    expect(JSON.stringify(urls)).not.toContain("kutadgu-bilig-kitab.vercel.app");
  });

  test("C next=account PKCE code does not bounce to account.html or enable reset", async ({ page }) => {
    await page.goto("/reset-password.html?next=account&code=pkce-recovery-code", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password.html");
    expect(page.url()).not.toMatch(/\/account\.html\?code=/);
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
  });
});

test.describe("cross-device token_hash recovery", () => {
  async function mockVerify(page, outcome) {
    await page.route("**/auth/v1/verify**", async (route) => {
      if (outcome === "ok") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "test-recovery-access",
            refresh_token: "test-recovery-refresh",
            expires_in: 3600,
            token_type: "bearer",
            user: { id: "11111111-1111-1111-1111-111111111111", email: "member@example.com" }
          })
        });
      }
      const msg = outcome === "expired"
        ? "Token has expired or is invalid"
        : "Invalid token";
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "otp_expired", error_description: msg, msg })
      });
    });
  }

  test("desktop request, phone opens token_hash, form enables without PKCE storage", async ({ browser, baseURL }) => {
    const phone = await browser.newContext({
      viewport: devices["Pixel 5"].viewport,
      userAgent: devices["Pixel 5"].userAgent,
      isMobile: true,
      hasTouch: true,
      baseURL
    });
    const page = await phone.newPage();
    await H.installReadSafeNetwork(page);
    await mockVerify(page, "ok");
    await page.goto("/reset-password.html?next=account&token_hash=phone-opens-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe("/reset-password.html");
    await phone.close();
  });

  test("phone request, desktop opens token_hash, form enables", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockVerify(page, "ok");
    await page.goto("/reset-password.html?next=admin&token_hash=desktop-opens-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
  });

  test("same-device token_hash recovery enables the form", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockVerify(page, "ok");
    await page.goto("/reset-password.html?next=account&token_hash=same-device-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
  });

  test("invalid token_hash is rejected", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockVerify(page, "invalid");
    await page.goto("/reset-password.html?next=account&token_hash=invalid-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/مەغلۇپ|invalid|expired|ئۇلانما/i);
  });

  test("expired token_hash is rejected", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockVerify(page, "expired");
    await page.goto("/reset-password.html?next=account&token_hash=expired-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/مەغلۇپ|expired|invalid|ئۇلانما/i);
  });

  test("used token_hash is rejected", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockVerify(page, "invalid");
    await page.goto("/reset-password.html?next=account&token_hash=used-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/مەغلۇپ|invalid|expired|ئۇلانما/i);
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

