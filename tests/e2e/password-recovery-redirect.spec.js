const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const VERIFIER_KEY = "sb-fxlojnqwyojqjskfggmh-auth-token-code-verifier";

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

async function seedPkceVerifier(page) {
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, "test-pkce-verifier/PASSWORD_RECOVERY");
    } catch (err) {}
  }, VERIFIER_KEY);
}

async function mockPkceToken(page, outcome) {
  await page.route("**/auth/v1/token**", async (route) => {
    if (route.request().method() !== "POST") {
      return route.continue();
    }
    if (outcome === "ok") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: fakeJwt(),
          refresh_token: "pkce-recovery-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: { id: "11111111-1111-1111-1111-111111111111", email: "member@example.com" }
        })
      });
    }
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "Invalid or expired code",
        msg: "Invalid or expired code"
      })
    });
  });
}

test.describe("password recovery redirect", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A resetPasswordForEmail redirect target is reset-password.html", async ({ page }) => {
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
    expect(urls.account).toContain("/reset-password.html");
    expect(urls.account).not.toMatch(/account\.html/);
    expect(urls.google).toBe(`${origin}/account.html`);
    expect(urls.google).not.toContain("reset-password");
  });

  test("B recovery PKCE callback does not end at account.html?code=&next=account", async ({ page }) => {
    await page.goto("/reset-password.html?code=pkce-recovery-code&next=account", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password.html");
    expect(page.url()).not.toMatch(/\/account\.html\?code=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe("account");
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
  });

  test("C valid recovery PKCE code enables reset form", async ({ page }) => {
    await seedPkceVerifier(page);
    await mockPkceToken(page, "ok");
    await page.goto("/reset-password.html?code=valid-pkce-recovery&type=recovery&next=account", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password.html");
    expect(page.url()).not.toMatch(/\/account\.html/);
    await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator("#confirmPassword")).toBeEnabled();
    await expect(page.locator("#savePasswordBtn")).toBeEnabled();
    await page.locator("#newPassword").click();
    await expect(page.locator("#newPassword")).toBeFocused();
  });

  test("D invalid or expired recovery PKCE stays disabled", async ({ page }) => {
    await mockPkceToken(page, "invalid");
    await page.goto("/reset-password.html?code=expired-pkce-recovery&type=recovery&next=account", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset-password.html");
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#savePasswordBtn")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/مەغلۇپ|invalid|expired|ئۇلانما/i);
    const clickResult = await page.locator("#newPassword").click({ timeout: 1500 }).then(() => "clicked").catch((err) => String(err.message || err));
    expect(clickResult).not.toBe("clicked");
    expect(clickResult).toMatch(/disabled|not enabled|intercepts pointer/i);
  });

  test("E Google OAuth account.html?code= stays on account", async ({ page }) => {
    await page.goto("/account.html?code=google-oauth-code", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/account.html");
    expect(page.url()).not.toMatch(/reset-password\.html/);
    await expect(page.locator("#resetPasswordForm")).toHaveCount(0);
    await expect(page.locator("#loginEmail")).toBeVisible();
  });

  test("F email/password login controls remain on account", async ({ page }) => {
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginEmail")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#loginPassword")).toBeVisible();
    await expect(page.locator("#loginForm button[type=submit]")).toBeVisible();
    await expect(page.locator("#loginForm button[type=submit]")).toBeEnabled();
    await page.waitForFunction(() => !!(window.KutadguMember && typeof window.KutadguMember.signIn === "function"), { timeout: 20_000 });
  });
});

for (const [width, height] of [[390, 844], [412, 915], [768, 1024], [1280, 800]]) {
  test.describe(`password recovery redirect ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test(`G-J recovery PKCE stays on reset and enables after exchange at ${width}`, async ({ page }) => {
      await H.installReadSafeNetwork(page);
      await seedPkceVerifier(page);
      await mockPkceToken(page, "ok");
      await page.goto("/reset-password.html?code=valid-pkce-recovery&type=recovery&next=account", { waitUntil: "domcontentloaded" });
      expect(new URL(page.url()).pathname).toBe("/reset-password.html");
      expect(page.url()).not.toMatch(/\/account\.html\?code=/);
      await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
      await page.locator("#newPassword").click();
      await expect(page.locator("#newPassword")).toBeFocused();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  });
}
