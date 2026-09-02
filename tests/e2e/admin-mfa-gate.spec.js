const { test, expect } = require("@playwright/test");

const VERIFIED = [{ id: "factor-v", factor_type: "totp", status: "verified" }];

async function installGateMock(page, opts = {}) {
  const currentLevel = opts.currentLevel || "aal1";
  const factors = opts.factors || [];
  await page.addInitScript(({ currentLevel, factors }) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminAalTest = { currentLevel, factors };
    window.__kutadguMfaFactors = factors.map((f) => ({ ...f }));
    window.__kutadguMfaUnenrollLog = [];
    window.__kutadguMfaApi = {
      async listFactors() {
        const all = (window.__kutadguMfaFactors || []).map((f) => ({ ...f }));
        return {
          data: {
            all,
            totp: all.filter((f) => f.factor_type === "totp" && f.status === "verified"),
            phone: []
          },
          error: null
        };
      },
      async getAuthenticatorAssuranceLevel() {
        const level = window.__kutadguAdminAalTest && window.__kutadguAdminAalTest.currentLevel;
        return { data: { currentLevel: level, nextLevel: "aal2" }, error: null };
      },
      async challengeAndVerify({ code }) {
        if (String(code) !== "123456") {
          return { data: null, error: { message: "Invalid code" } };
        }
        if (window.__kutadguAdminAalTest) window.__kutadguAdminAalTest.currentLevel = "aal2";
        return { data: { access_token: "test" }, error: null };
      },
      async enroll() {
        return { data: null, error: { message: "not used" } };
      },
      async unenroll({ factorId }) {
        window.__kutadguMfaUnenrollLog.push(factorId);
        return { data: { id: factorId }, error: null };
      }
    };
  }, { currentLevel, factors });
}

test.describe("stage 2C Admin AAL2 MFA gate", () => {
  test("unauthenticated user sees login, not dashboard or MFA gate", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#mfaCard")).toBeHidden();
  });

  test("Admin with no verified MFA factor remains usable", async ({ page }) => {
    await installGateMock(page, { currentLevel: "aal1", factors: [] });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#booksCard")).toBeVisible();
    await page.locator('[data-admin-section="system"]').click();
    await expect(page.locator("#mfaCard")).toBeVisible();
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلمىگەن");
  });

  test("AAL1 + verified TOTP shows MFA gate and hides dashboard", async ({ page }) => {
    await installGateMock(page, { currentLevel: "aal1", factors: VERIFIED });
    await page.goto("/admin.html#books", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#booksCard")).toBeHidden();
    await expect(page.locator("#mfaCard")).toBeHidden();
    await expect(page.locator("#mfaGateOtp")).toBeVisible();
  });

  test("valid 6-digit verification reaches AAL2 and shows dashboard", async ({ page }) => {
    await installGateMock(page, { currentLevel: "aal1", factors: VERIFIED });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.locator("#mfaGateOtp").fill("123456");
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#booksCard")).toBeVisible();
    const stored = await page.evaluate(() => {
      const dump = (store) => {
        const out = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          out.push(k + "=" + store.getItem(k));
        }
        return out.join("\n");
      };
      return dump(localStorage) + "\n" + dump(sessionStorage);
    });
    expect(stored).not.toMatch(/123456/);
  });

  test("invalid OTP keeps gate visible and does not sign out or unenroll", async ({ page }) => {
    await installGateMock(page, { currentLevel: "aal1", factors: VERIFIED });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#mfaGateOtp").fill("000000");
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#mfaGateStatus")).toContainText("كود توغرا ئەمەس");
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#loginPanel")).toBeHidden();
    const log = await page.evaluate(() => window.__kutadguMfaUnenrollLog.slice());
    expect(log).toEqual([]);
    const level = await page.evaluate(() => window.__kutadguAdminAalTest.currentLevel);
    expect(level).toBe("aal1");
  });

  test("AAL2 session reload goes directly to dashboard", async ({ page }) => {
    await installGateMock(page, { currentLevel: "aal2", factors: VERIFIED });
    await page.goto("/admin.html#system", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#mfaCard")).toBeVisible();
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلگەن");
  });

  test("gate logout returns to login", async ({ page }) => {
    await installGateMock(page, { currentLevel: "aal1", factors: VERIFIED });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.locator("#mfaGateLogout").click();
    await expect(page.locator("#loginPanel")).toBeVisible();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 800 }
  ]) {
    test(`MFA gate usable at ${viewport.name} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installGateMock(page, { currentLevel: "aal1", factors: VERIFIED });
      await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#mfaGatePanel")).toBeVisible();
      await expect(page.locator("#mfaGateOtp")).toBeVisible();
      await expect(page.locator("#mfaGateSubmit")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  }
});
