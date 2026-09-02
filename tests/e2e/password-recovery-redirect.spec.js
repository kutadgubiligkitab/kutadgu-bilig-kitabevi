const { test, expect } = require("@playwright/test");
const H = require("./helpers");

function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "11111111-1111-1111-1111-111111111111",
    email: "member@example.com",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

async function mockVerify(page, outcome) {
  await page.route("**/auth/v1/verify**", async (route) => {
    if (outcome === "ok") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: fakeJwt(),
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

test.describe("password recovery token_hash", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A valid token_hash + type=recovery enables the form after verifyOtp", async ({ page }) => {
    await mockVerify(page, "ok");
    await page.goto("/reset-password.html?type=recovery&next=account&token_hash=ok-hash", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator("#confirmPassword")).toBeEnabled();
    await expect(page.locator("#savePasswordBtn")).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe("/reset-password.html");
    expect(new URL(page.url()).searchParams.has("token_hash")).toBe(false);
    expect(new URL(page.url()).searchParams.get("type")).toBe("recovery");
    expect(new URL(page.url()).searchParams.get("next")).toBe("account");
    await page.locator("#newPassword").click();
    await expect(page.locator("#newPassword")).toBeFocused();
  });

  test("B invalid token_hash keeps the form disabled", async ({ page }) => {
    await mockVerify(page, "invalid");
    await page.goto("/reset-password.html?type=recovery&next=account&token_hash=bad-hash", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#savePasswordBtn")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/مەغلۇپ|invalid|expired|ئۇلانما/i);
    expect(new URL(page.url()).searchParams.get("token_hash")).toBe("bad-hash");
  });

  test("C expired token_hash keeps the form disabled", async ({ page }) => {
    await mockVerify(page, "expired");
    await page.goto("/reset-password.html?type=recovery&next=account&token_hash=expired-hash", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#savePasswordBtn")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/مەغلۇپ|expired|invalid|ئۇلانما/i);
  });

  test("D missing token_hash keeps the form disabled", async ({ page }) => {
    await page.goto("/reset-password.html?type=recovery&next=account", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#savePasswordBtn")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/پارول يېڭىلاش|ئۇلانمىدىن/);
  });

  test("E Google OAuth account.html?code= stays on account", async ({ page }) => {
    await page.goto("/account.html?code=google-oauth-code", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/account.html");
    expect(page.url()).not.toMatch(/reset-password\.html/);
    await expect(page.locator("#resetPasswordForm")).toHaveCount(0);
    await expect(page.locator("#loginEmail")).toBeVisible();
  });

  test("F password reset does not use exchangeCodeForSession", async ({ page }) => {
    await page.goto("/reset-password.html?type=recovery&next=account", { waitUntil: "domcontentloaded" });
    const flags = await page.evaluate(() => {
      const t = window.kutadguResetPasswordTest;
      return {
        usesPkceCodeExchange: t.usesPkceCodeExchange,
        pkceCodeIsRecovery: t.isIntendedRecoveryLink({
          type: "recovery",
          next: "account",
          code: "pkce-code",
          tokenHash: "",
          hasProviderToken: false,
          hasAccessToken: false,
          params: new URLSearchParams(),
          hashParams: new URLSearchParams()
        }),
        tokenHashIsRecovery: t.isIntendedRecoveryLink({
          type: "recovery",
          next: "account",
          code: "",
          tokenHash: "th",
          hasProviderToken: false,
          hasAccessToken: false,
          params: new URLSearchParams(),
          hashParams: new URLSearchParams()
        })
      };
    });
    expect(flags.usesPkceCodeExchange).toBe(false);
    expect(flags.pkceCodeIsRecovery).toBe(false);
    expect(flags.tokenHashIsRecovery).toBe(true);
  });

  test("RedirectTo is TokenHash-compatible and not ConfirmationURL", async ({ page }) => {
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.kutadguPasswordResetRedirectTo === "function");
    const urls = await page.evaluate(() => ({
      account: window.kutadguPasswordResetRedirectTo("account"),
      admin: window.kutadguPasswordResetRedirectTo("admin"),
      google: window.kutadguGoogleAccountRedirectTo()
    }));
    const origin = new URL(page.url()).origin;
    expect(urls.account).toBe(`${origin}/reset-password.html?type=recovery&next=account`);
    expect(urls.admin).toBe(`${origin}/reset-password.html?type=recovery&next=admin`);
    expect(urls.account).toContain("?");
    expect(`${urls.account}&token_hash=example&type=recovery`).toMatch(/token_hash=example/);
    expect(urls.google).toBe(`${origin}/account.html`);
  });

  test("PKCE recovery code is not bounced to account.html and does not enable the form", async ({ page }) => {
    await page.goto("/reset-password.html?code=pkce-recovery-code&next=account", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password.html");
    expect(page.url()).not.toMatch(/\/account\.html\?code=/);
    await expect(page.locator("#newPassword")).toBeDisabled();
  });
});

for (const [width, height] of [[390, 844], [412, 915], [768, 1024], [1280, 800]]) {
  test.describe(`password recovery token_hash ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test(`G-J valid token_hash enables form at ${width}`, async ({ page }) => {
      await H.installReadSafeNetwork(page);
      await mockVerify(page, "ok");
      await page.goto("/reset-password.html?type=recovery&next=account&token_hash=ok-hash", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
      expect(new URL(page.url()).searchParams.has("token_hash")).toBe(false);
      await page.locator("#newPassword").click();
      await expect(page.locator("#newPassword")).toBeFocused();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  });
}
