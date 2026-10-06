const { test, expect } = require("./playwright-test");

test.describe("admin analytics daily visitors", () => {
  test("shows Istanbul visitor states without calling production analytics", async ({ page }) => {
    const blocked = [];
    page.on("request", (request) => {
      const url = request.url();
      if (/analytics_events|get_kutadgu_analytics/i.test(url)) blocked.push(url);
    });
    await page.addInitScript(() => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.locator('[data-admin-section="insights"]').click();
    const panel = page.locator('[data-admin-section-panel="insights"]');
    await expect(panel).toBeVisible();
    await expect(page.locator("#analyticsVisitorsToday")).toHaveText("—");
    await expect(page.locator("#analyticsVisitorsYesterday")).toHaveText("—");
    await expect(page.locator("#analyticsVisitorsPeriod")).toHaveText("—");
    await expect(page.locator("#analyticsBookViews")).toHaveText("—");
    await expect(page.locator("#analyticsMeta")).toContainText("Europe/Istanbul");
    await expect(page.locator("#analyticsVisitorChart .admin-analytics-chart-col")).toHaveCount(7);
    await expect(page.locator("#analyticsVisitorNote")).toContainText("زىيارەت قېتىمى");
    await expect(page.locator("#analyticsVisitorNote")).toContainText("3 سائەت");
    await expect(page.locator("#analyticsManagement")).not.toContainText("بۈگۈنكى خاتىرىلەنگەن زىيارەتچى");
    await page.locator("#analyticsRange").selectOption("7");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsVisitorsToday")).toHaveText("—");
    expect(blocked).toEqual([]);
  });
});
