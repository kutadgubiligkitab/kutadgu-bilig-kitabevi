const { test, expect } = require("./playwright-test");

test("search activity is one phrase list instead of the old simultaneous panels", async ({ page }) => {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguAnalyticsDb = {
      rpc(name, args) {
        if (name === "get_kutadgu_analytics") {
          return Promise.resolve({ data: { page_views: 1, book_views: 1, cart_adds: 1, whatsapp_clicks: 1, unknown_result_searches: 0 }, error: null });
        }
        if (name !== "get_kutadgu_analytics_activity") return Promise.resolve({ data: null, error: null });
        return Promise.resolve({
          data: {
            status: "complete",
            scope: args.p_scope,
            category: args.p_category,
            kind: "phrase",
            sort: args.p_sort,
            started_at: "2026-10-16T20:18:04Z",
            range_start: "2026-09-17",
            range_end: "2026-10-16",
            offset: 0,
            limit: 20,
            total: 1,
            total_events: 2,
            rows: [{ key: "گامما", label: "گامما <img src=x onerror=alert(1)>", kind: "phrase", count: 2, last_at: "2026-10-16T11:00:00Z" }]
          },
          error: null
        });
      }
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-admin-section="insights"]').click();
  await page.locator("#reloadAnalytics").click();
  await page.locator('[data-activity-category="search"]').click();
  const results = page.locator("#analyticsActivityResults");
  await expect(results).toContainText("گامما");
  await expect(page.locator("#analyticsSearches")).toHaveCount(0);
  await expect(page.locator("#analyticsTopBooks")).toHaveCount(0);
  const html = await results.innerHTML();
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  await expect(page.locator("#analyticsActivityPhraseNote")).toBeVisible();
});
