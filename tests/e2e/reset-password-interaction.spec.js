const { test, expect, devices } = require("./playwright-test");
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

async function mockVerifyOk(page) {
  await page.route("**/auth/v1/verify**", async (route) => {
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
  });
}

async function mockVerifyInvalid(page) {
  await page.route("**/auth/v1/verify**", async (route) => {
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "otp_expired", msg: "Invalid token" })
    });
  });
}

async function mockHashSessionUser(page) {
  await page.route("**/auth/v1/user**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "11111111-1111-1111-1111-111111111111",
          email: "member@example.com",
          role: "authenticated",
          aud: "authenticated"
        })
      });
    }
    return route.continue();
  });
}

async function hitCenter(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} must have a box`).toBeTruthy();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    if (!node || !(node instanceof Element)) return { id: "", tag: "" };
    return { id: node.id || "", tag: node.tagName, className: String(node.className || "") };
  }, { x, y });
}

async function expectControlReceivesHit(page, selector) {
  const hit = await hitCenter(page, selector);
  const el = page.locator(selector);
  const id = await el.getAttribute("id");
  expect(hit.id === id || hit.tag === "LABEL" || hit.tag === "SPAN" || hit.tag === "BUTTON" || hit.tag === "INPUT").toBeTruthy();
  expect(hit.className).not.toMatch(/overlay|backdrop|maint/i);
  expect(hit.id).not.toBe("kutadgu-maintenance-overlay");
}

test.describe("password reset form interaction", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("valid token_hash recovery enables real click/focus/tab without force", async ({ page }) => {
    await mockVerifyOk(page);
    await page.goto("/reset-password.html?next=account&token_hash=ok-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator("#confirmPassword")).toBeEnabled();
    await expect(page.locator("#savePasswordBtn")).toBeEnabled();

    await expectControlReceivesHit(page, "#newPassword");
    await expectControlReceivesHit(page, "#confirmPassword");
    await expectControlReceivesHit(page, "#savePasswordBtn");

    await page.locator("#newPassword").click();
    await expect(page.locator("#newPassword")).toBeFocused();
    await page.locator("#newPassword").fill("new-pass-12");

    await page.locator("#confirmPassword").click();
    await expect(page.locator("#confirmPassword")).toBeFocused();
    await page.locator("#confirmPassword").fill("new-pass-12");

    await page.locator("#newPassword").click();
    await page.keyboard.press("Tab");
    await expect(page.locator("#confirmPassword")).toBeFocused();

    await expectControlReceivesHit(page, "#savePasswordBtn");
    await page.locator("#savePasswordBtn").click();
  });

  test("Supabase recovery hash with access+refresh enables the form", async ({ page }) => {
    await mockHashSessionUser(page);
    const access = fakeJwt();
    await page.goto(`/reset-password.html#access_token=${access}&refresh_token=test-refresh&type=recovery&token_type=bearer`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
    await page.locator("#newPassword").click();
    await expect(page.locator("#newPassword")).toBeFocused();
    await expectControlReceivesHit(page, "#savePasswordBtn");
  });

  test("invalid recovery stays blocked and is not force-clickable", async ({ page }) => {
    await mockVerifyInvalid(page);
    await page.goto("/reset-password.html?next=account&token_hash=bad-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#confirmPassword")).toBeDisabled();
    await expect(page.locator("#savePasswordBtn")).toBeDisabled();
    await expect(page.locator("#resetStatus")).toContainText(/مەغلۇپ|invalid|expired|ئۇلانما/i);
    await expectControlReceivesHit(page, "#newPassword");
    const clickResult = await page.locator("#newPassword").click({ timeout: 1500 }).then(() => "clicked").catch((err) => String(err.message || err));
    expect(clickResult).not.toBe("clicked");
    expect(clickResult).toMatch(/disabled|not enabled|intercepts pointer/i);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focused).not.toBe("newPassword");
  });

  test("expired recovery stays blocked", async ({ page }) => {
    await page.route("**/auth/v1/verify**", async (route) => {
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "otp_expired", msg: "Token has expired or is invalid" })
      });
    });
    await page.goto("/reset-password.html?next=account&token_hash=expired-hash&type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newPassword")).toBeDisabled();
    await expect(page.locator("#savePasswordBtn")).toBeDisabled();
  });
});

for (const [width, height] of [[390, 844], [412, 915], [768, 1024], [1280, 800]]) {
  test.describe(`password reset interaction ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });
    test(`controls are hittable after valid recovery at ${width}`, async ({ page }) => {
      await H.installReadSafeNetwork(page);
      await mockVerifyOk(page);
      await page.goto("/reset-password.html?next=account&token_hash=ok-hash&type=recovery", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#newPassword")).toBeEnabled({ timeout: 15_000 });
      await expectControlReceivesHit(page, "#newPassword");
      await expectControlReceivesHit(page, "#confirmPassword");
      await expectControlReceivesHit(page, "#savePasswordBtn");
      await page.locator("#newPassword").click();
      await expect(page.locator("#newPassword")).toBeFocused();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  });
}
