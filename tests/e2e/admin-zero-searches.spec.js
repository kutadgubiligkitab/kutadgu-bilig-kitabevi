const { test, expect } = require("./playwright-test");

test("no-result searches show the phrase and do not paint a missing list as zero", async ({ page }) => {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguActivityMode = "ok";
    window.__kutadguAnalyticsDb = {
      rpc(name, args) {
        if (name === "get_kutadgu_analytics") {
          return Promise.resolve({ data: { page_views: 1, book_views: 1, cart_adds: 0, whatsapp_clicks: 0, unknown_result_searches: 1, zero_searches: [{ query: "HIDDEN-TOP-TEN", searches: 100 }] }, error: null });
        }
        if (name !== "get_kutadgu_analytics_activity") return Promise.resolve({ data: null, error: null });
        if (window.__kutadguActivityMode === "missing") {
          return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_kutadgu_analytics_activity in the schema cache" } });
        }
        return Promise.resolve({
          data: {
            status: "partial",
            scope: "verified",
            category: args.p_category,
            kind: "phrase",
            sort: "latest",
            started_at: "2026-10-16T20:18:04Z",
            range_start: "2026-10-01",
            range_end: "2026-10-16",
            offset: 0,
            limit: 20,
            total: 1,
            total_events: 3,
            rows: [{ key: "يوق", label: "يوق", kind: "phrase", count: 3, last_at: "2026-10-16T09:30:00Z" }]
          },
          error: null
        });
      }
    };
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  const select = page.locator("#adminSectionSelect");
  if (await select.isVisible()) await select.selectOption("insights");
  else await page.locator('[data-admin-section="insights"]').click();
  await page.locator("#reloadAnalytics").click();
  await page.locator('[data-activity-category="zero_search"]').click();
  await expect(page.locator("#analyticsActivityResults")).toContainText("يوق");
  await expect(page.locator("#analyticsActivityResults")).not.toContainText("HIDDEN-TOP-TEN");
  await expect(page.locator("#analyticsActivityStatus")).toContainText("قىسمەن");
  await expect(page.locator("#analyticsZeroSearches")).toHaveCount(0);
  await page.evaluate(() => { window.__kutadguActivityMode = "missing"; });
  await page.locator("#analyticsActivitySort").selectOption("count_asc");
  await expect(page.locator("#analyticsActivityResults")).toContainText("قاچىلانمىغان");
  await expect(page.locator("#analyticsActivityResults")).not.toContainText("يوق");
  await expect(page.locator("#analyticsActivityStatus")).toContainText("نۆل دەپ قارالمايدۇ");
});
