const { test, expect } = require("./playwright-test");

const viewports = [
  { width: 390, height: 800, label: "phone" },
  { width: 1280, height: 900, label: "desktop" }
];
const schemes = ["light", "dark"];

async function openInsights(page) {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguExposeAnalyticsRender = true;
  });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  const select = page.locator("#adminSectionSelect");
  if (await select.isVisible()) await select.selectOption("insights");
  else await page.locator('[data-admin-section="insights"]').click();
  await expect(page.locator("#analyticsManagement")).toBeVisible();
}

async function paintSample(page) {
  await page.evaluate(() => {
    const Core = window.KutadguAnalyticsCore;
    const now = new Date("2026-10-06T09:00:00Z");
    const end = Core.istanbulDate(now);
    const days = [];
    for (let i = 6; i >= 0; i -= 1) days.push(Core.addCalendarDays(end, -i));
    const described = Core.describeAnalytics({
      schema_version: 2,
      page_views: 7244,
      book_views: 1561,
      cart_adds: 235,
      whatsapp_clicks: 9,
      top_books: [{ book_id: "15", title: "كىتاب", views: 4 }],
      zero_searches: [],
      visitors: {
        today: { status: "complete", visitors: 99 },
        yesterday: { status: "complete", visitors: 99 },
        period: { status: "complete", visitors: 99 },
        daily: days.map((date) => ({ date, status: "complete", visitors: 99 }))
      },
      counted_visits: {
        version: 1,
        window_hours: 3,
        today: { date: end, status: "complete", visits: 3 },
        yesterday: { date: Core.addCalendarDays(end, -1), status: "unavailable", visits: null },
        period: { status: "partial", visits: 5 },
        daily: days.map((date, index) => {
          if (index === 6) return { date, status: "complete", visits: 3 };
          if (index === 5) return { date, status: "unavailable", visits: null };
          if (index === 4) return { date, status: "zero", visits: 0 };
          if (index === 3) return { date, status: "partial", visits: 2 };
          return { date, status: "zero", visits: 0 };
        })
      }
    }, now);
    window.__kutadguRenderAnalytics(described, { shownDays: 30 });
  });
}

for (const viewport of viewports) {
  for (const scheme of schemes) {
    test(`visit counts render at ${viewport.label} in ${scheme} color scheme`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await openInsights(page);
      await expect(page.locator("#analyticsVisitorsToday")).toHaveText("—");
      await expect(page.locator("#analyticsVisitorChart .admin-analytics-chart-col")).toHaveCount(7);
      await expect(page.locator("#analyticsVisitCounts")).toHaveCount(0);
      await paintSample(page);
      await expect(page.locator("#analyticsVisitorsToday")).toHaveText("3");
      await expect(page.locator("#analyticsVisitorsYesterday")).toHaveText("—");
      await expect(page.locator("#analyticsVisitorsPeriod")).toHaveText("5 (قىسمەن)");
      await expect(page.locator("#analyticsVisitorNote")).toContainText("زىيارەت قېتىمى");
      await expect(page.locator("#analyticsVisitorNote")).toContainText("3 سائەت");
      await expect(page.locator("#analyticsVisitors")).not.toContainText("99");
      await expect(page.locator("#analyticsManagement")).not.toContainText("بۈگۈنكى خاتىرىلەنگەن زىيارەتچى");
      await expect(page.locator("#analyticsBookViews")).toHaveText("1.561");
      await expect(page.locator("#analyticsCartAdds")).toHaveText("235");
      await expect(page.locator("#analyticsWhatsapp")).toHaveText("9");
      await expect(page.locator("#analyticsPageViews")).toHaveText("7.244");
      const chart = page.locator("#analyticsVisitorChart .admin-analytics-chart-col");
      await expect(chart).toHaveCount(7);
      await expect(chart.nth(6).locator("strong")).toHaveText("3");
      await expect(chart.nth(5).locator("strong")).toHaveText("—");
      await expect(chart.nth(4).locator("strong")).toHaveText("0");
      await expect(chart.nth(3).locator("strong")).toHaveText("2");
      const readable = await page.locator("#analyticsVisitorsToday").evaluate((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          color: style.color,
          display: style.display,
          width: box.width,
          height: box.height
        };
      });
      expect(readable.display).not.toBe("none");
      expect(readable.width).toBeGreaterThan(0);
      expect(readable.height).toBeGreaterThan(0);
      expect(readable.color).not.toBe("rgba(0, 0, 0, 0)");
      const overflow = await page.locator("#analyticsVisitors").evaluate((el) => el.scrollWidth <= el.clientWidth + 2);
      expect(overflow).toBe(true);
    });
  }
}

test("a legacy payload keeps visit counts unavailable and event totals visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openInsights(page);
  await page.evaluate(() => {
    const described = window.KutadguAnalyticsCore.describeAnalytics({
      page_views: 10,
      book_views: 4,
      cart_adds: 0,
      whatsapp_clicks: 1,
      top_books: [],
      zero_searches: []
    }, new Date("2026-10-06T09:00:00Z"));
    window.__kutadguRenderAnalytics(described, { shownDays: 30 });
  });
  await expect(page.locator("#analyticsVisitorsToday")).toHaveText("—");
  await expect(page.locator("#analyticsVisitorsYesterday")).toHaveText("—");
  await expect(page.locator("#analyticsVisitorsPeriod")).toHaveText("—");
  await expect(page.locator("#analyticsBookViews")).toHaveText("4");
  await expect(page.locator("#analyticsCartAdds")).toHaveText("0");
  await expect(page.locator("#analyticsWhatsapp")).toHaveText("1");
  await expect(page.locator("#analyticsVisitorChart .admin-analytics-chart-col strong")).toHaveText(["—", "—", "—", "—", "—", "—", "—"]);
});
