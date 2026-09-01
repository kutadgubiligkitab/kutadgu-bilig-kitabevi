const { test, expect } = require("@playwright/test");

const SECTIONS = {
  books: "#booksCard",
  overview: "#overviewSection",
  storefront: "#announcementCard",
  "import-covers": "#coverRepairCard",
  insights: "#analyticsManagement",
  customers: "#memberManagement",
  system: "#maintenanceCard"
};

async function openAuthorizedAdmin(page, hash = "") {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
  });
  await page.goto("/admin.html" + hash, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
}

async function expectOnlySection(page, id) {
  for (const [key, selector] of Object.entries(SECTIONS)) {
    const loc = page.locator(selector);
    if (key === id) await expect(loc).toBeVisible();
    else await expect(loc).toBeHidden();
  }
  await expect(page.locator(`[data-admin-section="${id}"]`)).toHaveClass(/is-active/);
  await expect(page.locator(`[data-admin-section="${id}"]`)).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#adminSectionSelect")).toHaveValue(id);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#" + id);
}

test.describe("admin navigation", () => {
  test("login gate unchanged and dashboard stays hidden before auth", async ({ page }) => {
    await page.goto("/admin.html#system", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#maintenanceCard")).toBeHidden();
    await expect(page.locator("#booksCard")).toBeHidden();
  });

  test("authorized default section is Books", async ({ page }) => {
    await openAuthorizedAdmin(page);
    await expectOnlySection(page, "books");
  });

  test("sidebar switches exclusive sections", async ({ page }) => {
    await openAuthorizedAdmin(page);
    await page.locator('[data-admin-section="overview"]').click();
    await expectOnlySection(page, "overview");
    await expect(page.locator("#adminStatus")).toBeVisible();
    await expect(page.locator(".admin-stats").first()).toBeVisible();

    await page.locator('[data-admin-section="storefront"]').click();
    await expectOnlySection(page, "storefront");

    await page.locator('[data-admin-section="import-covers"]').click();
    await expectOnlySection(page, "import-covers");

    await page.locator('[data-admin-section="insights"]').click();
    await expectOnlySection(page, "insights");

    await page.locator('[data-admin-section="customers"]').click();
    await expectOnlySection(page, "customers");

    await page.locator('[data-admin-section="system"]').click();
    await expectOnlySection(page, "system");

    await page.locator('[data-admin-section="books"]').click();
    await expectOnlySection(page, "books");
  });

  test("hash #system is restored after authorized dashboard", async ({ page }) => {
    await openAuthorizedAdmin(page, "#system");
    await expectOnlySection(page, "system");
  });

  test("unknown hash falls back to Books", async ({ page }) => {
    await openAuthorizedAdmin(page, "#not-a-section");
    await expectOnlySection(page, "books");
  });

  test("hashchange updates the visible section", async ({ page }) => {
    await openAuthorizedAdmin(page);
    await page.evaluate(() => {
      location.hash = "customers";
    });
    await expectOnlySection(page, "customers");
  });

  test("mobile selector switches section and stays in sync", async ({ page }) => {
    await openAuthorizedAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".admin-sidenav")).toBeHidden();
    await expect(page.locator("#adminSectionSelect")).toBeVisible();
    await page.locator("#adminSectionSelect").selectOption("insights");
    await expectOnlySection(page, "insights");
    await expect(page.locator('[data-admin-section="insights"]')).toHaveClass(/is-active/);

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
  });

  test("book and import modals open from Books independently of sections", async ({ page }) => {
    await openAuthorizedAdmin(page);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await page.locator("#closeBookModal").click();
    await expect(page.locator("#bookModal")).toBeHidden();

    await page.locator("#importCsvBtn").click();
    await expect(page.locator("#importModal")).toBeVisible();
    await page.locator("#closeImportModal").click();
    await expect(page.locator("#importModal")).toBeHidden();
  });
});
