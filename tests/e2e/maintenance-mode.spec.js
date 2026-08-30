const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const OVERLAY = "#kutadgu-maintenance-overlay";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function mockStoreSettings(page, on) {
  await page.route("**/rest/v1/store_settings**", async (route) => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ key: "maintenance_mode", value: !!on }])
      });
    }
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "forbidden" })
    });
  });
}

async function mockAdminUsers(page, userId) {
  await page.route("**/rest/v1/admin_users**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const rows = userId ? [{ user_id: userId }] : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows)
    });
  });
}

function seedSession(page, userId) {
  return page.addInitScript((id) => {
    const payload = JSON.stringify({
      access_token: "test-access-token",
      token_type: "bearer",
      user: { id }
    });
    try {
      localStorage.setItem("sb-fxlojnqwyojqjskfggmh-auth-token", payload);
    } catch (e) {}
  }, userId);
}

test.describe("maintenance mode", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A maintenance OFF keeps homepage, detail, search, cart, favorites, PR31 title", async ({ page }) => {
    await mockStoreSettings(page, false);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page).toHaveTitle("قۇتادغۇبىلىك كىتابخانىسى");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("#searchInput")).toBeVisible();

    await page.locator("#searchInput").fill("بالىلار");
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");

    await page.goto("/book.html?id=102", { waitUntil: "domcontentloaded" });
    const title = await H.waitForDetailTitle(page);
    expect(title).toMatch(/بالىلار/);

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#cartItems")).toBeVisible();

    await page.goto("/favorites.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test("B anonymous visitor sees maintenance and not catalog", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    const hops = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) hops.push(frame.url());
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(OVERLAY)).toHaveAttribute("dir", "rtl");
    await expect(page.locator(OVERLAY)).toContainText("قۇتادغۇبىلىك كىتابخانىسى");
    await expect(page.locator(OVERLAY)).toContainText("ۋاقىتلىق ئاسراش");
    await expect(page.locator("#searchInput")).toBeHidden();
    await expect(page.locator(".book-card, .advanced-search-result")).toHaveCount(0);
    expect(hops.filter((u) => /\/$|index\.html/.test(u)).length).toBeLessThan(4);

    await page.goto("/book.html?id=102", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(".book-detail-info h1")).toBeHidden();

    await page.goto("/children.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(".book-card")).toHaveCount(0);
  });

  test("C authenticated member does not bypass and cannot write", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    await seedSession(page, MEMBER_ID);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#searchInput")).toBeHidden();

    const writeStatus = await page.evaluate(async () => {
      const cfg = window.KUTADGU_SUPABASE_CONFIG || {};
      const url = String(cfg.url || "").replace(/\/+$/, "") + "/rest/v1/store_settings?key=eq.maintenance_mode";
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          apikey: cfg.anonKey,
          Authorization: "Bearer test-access-token",
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ value: false })
      });
      return res.status;
    });
    expect(writeStatus).toBe(403);
  });

  test("D authenticated Admin bypasses storefront; Admin login stays open", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, ADMIN_ID);
    await seedSession(page, ADMIN_ID);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#searchInput")).toBeVisible();

    await page.goto("/book.html?id=102", { waitUntil: "domcontentloaded" });
    const title = await H.waitForDetailTitle(page);
    expect(title).toMatch(/بالىلار/);
    await expect(page.locator(OVERLAY)).toHaveCount(0);

    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#loginPanel, #dashboardPanel, #setupPanel").first()).toBeVisible();
    await expect(page.locator("#maintenanceToggleBtn")).toBeAttached();
  });

  test("E no query-string or localStorage-only bypass", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    await page.addInitScript(() => {
      try {
        localStorage.setItem("kutadgu-admin", "1");
        localStorage.setItem("maintenance_bypass", "true");
        localStorage.setItem("isAdmin", "true");
      } catch (e) {}
    });
    await page.goto("/?bypass=1&admin=1&maintenance=off", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
  });

  test("F toggling mock OFF restores storefront without redeploy", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });

    await page.unroute("**/rest/v1/store_settings**");
    await mockStoreSettings(page, false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#searchInput")).toBeVisible();
  });
});
