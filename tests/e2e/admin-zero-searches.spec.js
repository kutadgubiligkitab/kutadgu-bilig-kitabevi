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

test("the raw no-result card uses the summary total and ignores the activity page", async ({ page }) => {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguZeroMode = "ok";
    window.__kutadguZeroDelay = 0;
    window.__kutadguZeroCalls = [];
    window.__kutadguAnalyticsDb = {
      rpc(name, args) {
        if (name === "get_kutadgu_analytics") {
          return Promise.resolve({
            data: { page_views: 1, book_views: 1, cart_adds: 0, whatsapp_clicks: 0, unknown_result_searches: 1 },
            error: null
          });
        }
        if (name === "get_kutadgu_zero_searches") {
          const delay = window.__kutadguZeroDelay;
          return new Promise((resolve) => {
            window.setTimeout(() => {
              window.__kutadguZeroCalls.push({ args: Object.assign({}, args), mode: window.__kutadguZeroMode });
              if (window.__kutadguZeroMode === "missing") {
                resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_kutadgu_zero_searches in the schema cache" } });
                return;
              }
              if (window.__kutadguZeroMode === "fail") {
                resolve({ data: null, error: { message: "db down" } });
                return;
              }
              const days = args.p_days;
              const total = days === 7 ? 0 : days === 90 ? 4 : 7;
              resolve({
                data: {
                  schema_version: 2,
                  timezone: "Europe/Istanbul",
                  range_start: "2026-09-17",
                  range_end: "2026-10-16",
                  days,
                  as_of: "2026-10-16T12:00:00Z",
                  offset: 0,
                  next_offset: 1,
                  limit: args.p_limit,
                  total_events: total,
                  total_queries: 3,
                  has_more: true,
                  representation: "search",
                  queries: [{ query: "يوق", searches: 2, last_searched_at: "2026-10-16T09:00:00Z" }]
                },
                error: null
              });
            }, delay);
          });
        }
        if (name === "get_kutadgu_analytics_activity") {
          return Promise.resolve({
            data: {
              status: "complete",
              scope: args.p_scope,
              category: args.p_category,
              kind: args.p_category === "zero_search" || args.p_category === "search" ? "phrase" : "book",
              sort: args.p_sort,
              started_at: "2026-10-16T20:18:04Z",
              range_start: args.p_start || "2026-09-17",
              range_end: args.p_end || "2026-10-16",
              offset: args.p_offset || 0,
              limit: 20,
              total: 1,
              total_events: 3,
              rows: [{
                key: "يوق",
                label: "يوق",
                kind: "phrase",
                count: 3,
                last_at: "2026-10-16T09:30:00Z"
              }]
            },
            error: null
          });
        }
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-admin-section="insights"]').click();
  await page.locator("#reloadAnalytics").click();
  const card = page.locator("#analyticsZeroSearchesCount");
  await expect(card).toHaveText("7");
  await expect(page.locator("#analyticsActivityResults")).toContainText("يوق");
  const opened = await page.evaluate(() => window.__kutadguZeroCalls.map((call) => call.args));
  expect(opened.length).toBeGreaterThan(0);
  opened.forEach((args) => {
    expect(args).toEqual(expect.objectContaining({ p_days: 30, p_offset: 0, p_limit: 1 }));
    expect(args.p_scope).toBeUndefined();
  });
  const settled = opened.length;

  await page.locator('[data-activity-category="zero_search"]').click();
  await page.locator('[data-activity-scope="raw"]').click();
  await page.locator("#analyticsActivityPreset").selectOption("custom");
  await expect(card).toHaveText("7");
  await expect(page.locator("#analyticsActivityResults")).toContainText("چېسلاسىنى تاللاڭ");
  expect(await page.evaluate(() => window.__kutadguZeroCalls.length)).toBe(settled);

  await page.locator("#analyticsRange").selectOption("7");
  await expect(card).toHaveText("0");

  await page.evaluate(() => { window.__kutadguZeroMode = "fail"; });
  await page.locator("#analyticsRange").selectOption("90");
  await expect.poll(() => page.evaluate(() => window.__kutadguZeroCalls.length)).toBe(settled + 2);
  await expect(card).toHaveText("0");

  await page.evaluate(() => { window.__kutadguZeroMode = "ok"; window.__kutadguZeroDelay = 400; });
  const beforeStale = await page.evaluate(() => window.__kutadguZeroCalls.length);
  await page.locator("#analyticsRange").selectOption("30");
  await page.evaluate(() => { window.__kutadguZeroDelay = 0; });
  await page.locator("#analyticsRange").selectOption("90");
  await expect(card).toHaveText("4");
  await expect.poll(() => page.evaluate((start) => window.__kutadguZeroCalls.length > start + 1, beforeStale)).toBe(true);
  await expect(card).toHaveText("4");

  await page.evaluate(() => { window.__kutadguZeroMode = "missing"; window.__kutadguZeroDelay = 0; });
  await page.locator("#analyticsRange").selectOption("7");
  await expect(card).toHaveText("—");
});
