const { test, expect } = require("./playwright-test");

async function openStaff(page) {
  await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.KutadguBookStaff && window.KutadguAdminMfa);
}

async function installStaffSession(page, inspect) {
  await page.evaluate(async (mode) => {
    window.__staffInspects = 0;
    window.KutadguMember = {
      ready: Promise.resolve(),
      getUser() { return { id: "11111111-1111-4111-8111-111111111111", email: "staff@example.com" }; },
      getClient() {
        return {
          rpc: async () => ({ data: true, error: null }),
          auth: {
            mfa: {
              async getAuthenticatorAssuranceLevel() {
                window.__staffInspects += 1;
                return { data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null };
              },
              async listFactors() { throw new Error("list down"); }
            }
          }
        };
      },
      signOut: async () => {}
    };
    if (mode === "missing") delete window.KutadguAdminMfa.inspectAccess;
    await window.KutadguBookStaff.routeStaffSession();
  }, inspect);
}

test("blocked Book Staff MFA inspection hides the OTP and retries", async ({ page }) => {
  await openStaff(page);
  await installStaffSession(page, "blocked");
  await expect(page.locator("#mfaGatePanel")).toBeVisible();
  await expect(page.locator("#mfaGateOtp")).toBeHidden();
  await expect(page.locator("#staffWorkspace")).toBeHidden();
  await expect(page.locator("#mfaEnrollPanelWrap")).toBeHidden();
  await expect(page.locator("#mfaGateSubmit")).toHaveText("قايتا سىناش");
  const before = await page.evaluate(() => window.__staffInspects);
  await page.locator("#mfaGateSubmit").click();
  await expect.poll(() => page.evaluate(() => window.__staffInspects)).toBe(before + 1);
  await expect(page.locator("#mfaGateOtp")).toBeHidden();
  await expect(page.locator("#staffWorkspace")).toBeHidden();
  await expect(page.locator("#mfaEnrollPanelWrap")).toBeHidden();
});

test("missing Book Staff inspectAccess does not open enrollment or the workspace", async ({ page }) => {
  await openStaff(page);
  await installStaffSession(page, "missing");
  await expect(page.locator("#mfaGatePanel")).toBeVisible();
  await expect(page.locator("#mfaGateOtp")).toBeHidden();
  await expect(page.locator("#mfaGateSubmit")).toHaveText("قايتا سىناش");
  await expect(page.locator("#staffWorkspace")).toBeHidden();
  await expect(page.locator("#mfaEnrollPanelWrap")).toBeHidden();
});
