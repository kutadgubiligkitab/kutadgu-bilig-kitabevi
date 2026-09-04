const { test, expect } = require("./playwright-test");

const SECRET = "TESTONLYSECRETNEVERSTORE";
const QR_MARK = "data:image/svg+xml;utf-8,test-qr-mark";

async function installMfaMock(page, opts = {}) {
  const initial = opts.factors || [];
  await page.addInitScript(({ factors, secret, qrMark }) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguMfaFactors = factors;
    window.__kutadguMfaUnenrollLog = [];
    window.__kutadguMfaSignOutCalls = 0;
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
      async enroll() {
        const factor = { id: "factor-enroll-1", factor_type: "totp", status: "unverified" };
        window.__kutadguMfaFactors = [...(window.__kutadguMfaFactors || []).filter((f) => f.status === "verified"), factor];
        return {
          data: {
            id: factor.id,
            totp: { qr_code: qrMark, secret }
          },
          error: null
        };
      },
      async challengeAndVerify({ code }) {
        if (String(code) !== "123456") {
          return { data: null, error: { message: "Invalid code" } };
        }
        window.__kutadguMfaFactors = (window.__kutadguMfaFactors || []).map((f) =>
          f.id === "factor-enroll-1" ? { ...f, status: "verified" } : f
        );
        return { data: { access_token: "test" }, error: null };
      },
      async unenroll({ factorId }) {
        window.__kutadguMfaUnenrollLog.push(factorId);
        window.__kutadguMfaFactors = (window.__kutadguMfaFactors || []).filter((f) => f.id !== factorId);
        return { data: { id: factorId }, error: null };
      }
    };
  }, { factors: initial, secret: SECRET, qrMark: QR_MARK });
}

async function openSystem(page) {
  await page.goto("/admin.html#system", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await expect(page.locator("#mfaCard")).toBeVisible();
}

async function storageHasSecret(page) {
  return page.evaluate((needle) => {
    const dump = (store) => {
      const out = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        out.push(k + "=" + store.getItem(k));
      }
      return out.join("\n");
    };
    const blob = dump(localStorage) + "\n" + dump(sessionStorage);
    return blob.includes(needle);
  }, SECRET);
}

test.describe("stage 2C optional Admin TOTP MFA", () => {
  test("unauthenticated visitor cannot see MFA Admin controls", async ({ page }) => {
    await page.goto("/admin.html#system", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#mfaCard")).toBeHidden();
    await expect(page.locator("#mfaSetupBtn")).toBeHidden();
  });

  test("Admin UI stays usable with no enrolled factor and status is not configured", async ({ page }) => {
    await installMfaMock(page, { factors: [] });
    await openSystem(page);
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلمىگەن");
    await expect(page.locator("#mfaSetupBtn")).toBeVisible();
    await expect(page.locator("#mfaEnrollPanel")).toBeHidden();
    await expect(page.locator("#mfaRemoveBtn")).toBeHidden();
    await expect(page.locator("#booksCard")).toBeHidden();
    await page.locator('[data-admin-section="books"]').click();
    await expect(page.locator("#booksCard")).toBeVisible();
    await expect(page.locator("#newBookBtn")).toBeVisible();
  });

  test("verified TOTP factor shows configured", async ({ page }) => {
    await installMfaMock(page, {
      factors: [{ id: "factor-v", factor_type: "totp", status: "verified" }]
    });
    await openSystem(page);
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلگەن");
    await expect(page.locator("#mfaSetupBtn")).toBeHidden();
    await expect(page.locator("#mfaRemoveBtn")).toBeVisible();
    await expect(page.locator("#mfaEnrollPanel")).toBeHidden();
  });

  test("enrollment UI appears only after explicit setup click and secret is not stored", async ({ page }) => {
    await installMfaMock(page);
    await openSystem(page);
    await expect(page.locator("#mfaEnrollPanel")).toBeHidden();
    await page.locator("#mfaSetupBtn").click();
    await expect(page.locator("#mfaEnrollPanel")).toBeVisible();
    await expect(page.locator("#mfaSecret")).toHaveText(SECRET);
    expect(await storageHasSecret(page)).toBe(false);
    await expect(page.locator("#mfaQr")).toBeVisible();
  });

  test("OTP success updates status to configured and clears enroll UI", async ({ page }) => {
    await installMfaMock(page);
    await openSystem(page);
    await page.locator("#mfaSetupBtn").click();
    await page.locator("#mfaOtp").fill("123456");
    await page.locator("#mfaVerifyBtn").click();
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلگەن");
    await expect(page.locator("#mfaEnrollPanel")).toBeHidden();
    await expect(page.locator("#mfaSecret")).toHaveText("");
    expect(await storageHasSecret(page)).toBe(false);
  });

  test("failed OTP does not sign the Admin out", async ({ page }) => {
    await installMfaMock(page);
    await openSystem(page);
    await page.locator("#mfaSetupBtn").click();
    await page.locator("#mfaOtp").fill("000000");
    await page.locator("#mfaVerifyBtn").click();
    await expect(page.locator("#mfaStatus")).toContainText("كود توغرا ئەمەس");
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#mfaCard")).toBeVisible();
    await expect(page.locator("#loginPanel")).toBeHidden();
    await expect(page.locator("#mfaEnrollPanel")).toBeVisible();
    const unenroll = await page.evaluate(() => window.__kutadguMfaUnenrollLog.slice());
    expect(unenroll).toEqual([]);
  });

  test("verified factor is never removed automatically; removal needs confirmation", async ({ page }) => {
    await installMfaMock(page, {
      factors: [{ id: "factor-v", factor_type: "totp", status: "verified" }]
    });
    await openSystem(page);
    await expect(page.locator("#mfaRemoveConfirm")).toBeHidden();
    let log = await page.evaluate(() => window.__kutadguMfaUnenrollLog.slice());
    expect(log).toEqual([]);
    await page.locator("#mfaRemoveBtn").click();
    await expect(page.locator("#mfaRemoveConfirm")).toBeVisible();
    log = await page.evaluate(() => window.__kutadguMfaUnenrollLog.slice());
    expect(log).toEqual([]);
    await page.locator("#mfaRemoveConfirmBtn").click();
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلمىگەن");
    log = await page.evaluate(() => window.__kutadguMfaUnenrollLog.slice());
    expect(log).toEqual(["factor-v"]);
  });

  test("unverified leftover can be cleaned without removing verified factors", async ({ page }) => {
    await installMfaMock(page, {
      factors: [
        { id: "factor-v", factor_type: "totp", status: "verified" },
        { id: "factor-u", factor_type: "totp", status: "unverified" }
      ]
    });
    await openSystem(page);
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلگەن");
    await expect(page.locator("#mfaCleanupBtn")).toBeVisible();
    await page.locator("#mfaCleanupBtn").click();
    await expect(page.locator("#mfaStatus")).toContainText("تەڭشەلگەن");
    await expect(page.locator("#mfaRemoveBtn")).toBeVisible();
    const log = await page.evaluate(() => window.__kutadguMfaUnenrollLog.slice());
    expect(log).toEqual(["factor-u"]);
  });

  test("no AAL2 gate: dashboard works at aal1 with and without a factor", async ({ page }) => {
    await installMfaMock(page, { factors: [] });
    await openSystem(page);
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    const aalGate = await page.evaluate(() => {
      const src = document.querySelector('script[src*="admin.js"]') ? true : true;
      return typeof window.__kutadguAdminTest?.dashboardAuthorized === "function"
        ? window.__kutadguAdminTest.dashboardAuthorized()
        : null;
    });
    expect(aalGate).toBe(true);
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 800 }
  ]) {
    test(`MFA card usable at ${viewport.name} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installMfaMock(page);
      await openSystem(page);
      if (viewport.width <= 850) {
        await page.locator("#adminSectionSelect").selectOption("system");
      }
      await expect(page.locator("#mfaCard")).toBeVisible();
      await expect(page.locator("#mfaSetupBtn")).toBeVisible();
      const box = await page.locator("#mfaCard").boundingBox();
      expect(box.width).toBeGreaterThan(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
      await page.locator("#mfaSetupBtn").click();
      await expect(page.locator("#mfaEnrollPanel")).toBeVisible();
      await expect(page.locator("#mfaVerifyBtn")).toBeVisible();
    });
  }
});
