const { test, expect } = require("./playwright-test");

async function install(page) {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguActivityMode = "ok";
    window.__kutadguActivityDelay = 0;
    window.__kutadguActivityCalls = [];
    window.__kutadguAnalyticsDb = {
      rpc(name, args) {
        const delay = window.__kutadguActivityDelay;
        return new Promise((resolve) => {
          window.setTimeout(() => {
            window.__kutadguActivityCalls.push({ name, args: Object.assign({}, args), mode: window.__kutadguActivityMode });
            if (name === "get_kutadgu_analytics") {
              resolve({
                data: {
                  page_views: 8,
                  book_views: 4,
                  cart_adds: 3,
                  whatsapp_clicks: 2,
                  unknown_result_searches: 1,
                  top_books: [{ book_id: "15", title: "HIDDEN-TOP-TEN", views: 99 }],
                  verified_visits: { today: { status: "zero", visits: 0 }, yesterday: { status: "zero", visits: 0 }, period: { status: "zero", visits: 0 }, daily: [] },
                  counted_visits: { period: { status: "unavailable", visits: null } }
                },
                error: null
              });
              return;
            }
            if (name !== "get_kutadgu_analytics_activity") {
              resolve({ data: null, error: { message: "unexpected rpc " + name } });
              return;
            }
            if (window.__kutadguActivityMode === "missing") {
              resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_kutadgu_analytics_activity in the schema cache" } });
              return;
            }
            if (window.__kutadguActivityMode === "fail") {
              resolve({ data: null, error: { message: "db down" } });
              return;
            }
            if (window.__kutadguActivityMode === "unavailable") {
              resolve({
                data: {
                  status: "unavailable",
                  scope: "verified",
                  category: args.p_category,
                  kind: "book",
                  sort: args.p_sort,
                  rows: null,
                  total: null,
                  total_events: null,
                  offset: 0,
                  limit: 20,
                  started_at: null
                },
                error: null
              });
              return;
            }
            const data = {
              schema_version: 1,
              metric: "verification_passed_browser_actions",
              scope: args.p_scope,
              category: args.p_category,
              kind: args.p_category === "search" || args.p_category === "zero_search" ? "phrase" : "book",
              sort: args.p_sort,
              status: "complete",
              started_at: "2026-10-16T20:18:04Z",
              range_start: "2026-09-17",
              range_end: "2026-10-16",
              offset: args.p_offset || 0,
              limit: 20,
              total: 1,
              total_events: 1,
              rows: [{
                key: "15",
                label: args.p_category === "search" ? "يېڭى-سۆز" : "نۆۋەتتىكى كىتاب",
                kind: args.p_category === "search" ? "phrase" : "book",
                count: 1,
                last_at: "2026-10-16T18:00:00Z"
              }]
            };
            if (args.p_category === "book_view" && window.__kutadguActivityMode === "stale-book") {
              data.rows[0].label = "ئەسكى-كىتاب";
            }
            if (args.p_category === "search") data.rows[0].label = "يېڭى-سۆز";
            resolve({ data, error: null });
          }, delay);
        });
      }
    };
  });
}

test.describe("admin analytics activity", () => {
  test("shows one category, ignores a stale reply, and keeps raw summaries unlabeled", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await install(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    const results = page.locator("#analyticsActivityResults");
    await expect(results).toContainText("نۆۋەتتىكى كىتاب");
    await expect(results).not.toContainText("HIDDEN-TOP-TEN");
    await expect(page.locator("#analyticsRawSummaryNote")).toContainText("خام خاتىرە");
    await expect(page.locator("#analyticsBookViews")).toHaveText("4");
    await expect(page.locator('[data-activity-scope="verified"]')).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => { window.__kutadguActivityDelay = 400; window.__kutadguActivityMode = "stale-book"; });
    await page.locator('[data-activity-category="book_view"]').click();
    await page.evaluate(() => { window.__kutadguActivityDelay = 0; window.__kutadguActivityMode = "ok"; });
    await page.locator('[data-activity-category="search"]').click();
    await expect(results).toContainText("يېڭى-سۆز");
    await expect(results).not.toContainText("ئەسكى-كىتاب");
    await expect(page.locator("#analyticsActivityPhraseNote")).toBeVisible();
    const html = await results.innerHTML();

    await page.evaluate(() => { window.__kutadguActivityMode = "fail"; window.__kutadguActivityDelay = 0; });
    await page.locator("#analyticsActivitySort").selectOption("count_desc");
    await expect(page.locator("#analyticsActivityStatus")).toContainText("ئوقۇلمىدى");
    await expect(results).toContainText("يېڭى-سۆز");

    await page.locator("#analyticsActivityPreset").selectOption("custom");
    await expect(results).toContainText("چېسلاسىنى تاللاڭ");
    await expect(results).not.toContainText("يېڭى-سۆز");
    await page.locator("#analyticsActivityPreset").selectOption("last_30");
    await expect(results).toContainText("يېڭى-سۆز");

    await page.evaluate(() => { window.__kutadguActivityMode = "unavailable"; });
    await page.locator('[data-activity-scope="raw"]').click();
    await page.locator('[data-activity-scope="verified"]').click();
    await expect(results).toContainText("نۆل دەپ قارالمايدۇ");
    await expect(page.locator("#analyticsActivityStatus")).toContainText("نۆل ئەمەس");
    expect(html).not.toContain("<img");
  });

  test("category buttons stay inside a phone width and use the server sort", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await install(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    const select = page.locator("#adminSectionSelect");
    if (await select.isVisible()) await select.selectOption("insights");
    else await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    const box = await page.locator(".admin-activity-categories").evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      columns: getComputedStyle(el).gridTemplateColumns,
      direction: getComputedStyle(el).direction
    }));
    expect(box.overflow).toBeLessThanOrEqual(1);
    expect(box.direction).toBe("rtl");
    expect(box.columns).not.toContain(" ");
    await expect(page.locator("#analyticsActivityCustom")).toBeHidden();
    await expect(page.locator("#analyticsActivityCustomEnd")).toBeHidden();
    const button = page.locator('[data-activity-category="whatsapp_order_click"]');
    const height = await button.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
    await page.locator("#analyticsActivitySort").selectOption("oldest");
    await expect.poll(async () => page.evaluate(() => {
      const calls = window.__kutadguActivityCalls.filter((call) => call.name === "get_kutadgu_analytics_activity");
      return calls.length ? calls[calls.length - 1].args.p_sort : "";
    })).toBe("oldest");
  });
});
