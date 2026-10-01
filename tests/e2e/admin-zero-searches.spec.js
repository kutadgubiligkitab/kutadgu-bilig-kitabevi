const { test, expect } = require("./playwright-test");

function queries() {
  const older = Array.from({ length: 24 }, (_, i) => ({
    query: `old-${String(i + 1).padStart(2, "0")}`,
    searches: 30 - i,
    last_searched_at: new Date(Date.UTC(2026, 8, 20, 9, i, 0)).toISOString()
  }));
  return [
    { query: "new-once", searches: 1, last_searched_at: "2026-10-01T09:30:00Z" },
    { query: "<img src=x onerror=alert(1)>", searches: 2, last_searched_at: "2026-10-01T09:00:00Z" },
    ...older
  ];
}

test.describe("admin no-result searches", () => {
  test("paginates every group, keeps a new count-1 query first, and ignores stale responses", async ({ page }) => {
    const calls = [];
    await page.addInitScript((rows) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguZeroRows = rows;
      window.__kutadguZeroCalls = [];
      window.__kutadguZeroMode = "ok";
      window.__kutadguZeroDelay = 0;
      window.__kutadguAnalyticsDb = {
        rpc(name, args) {
          const mode = window.__kutadguZeroMode;
          const delay = window.__kutadguZeroDelay;
          return new Promise((resolve) => {
            window.setTimeout(() => {
              window.__kutadguZeroCalls.push({ name, args: { ...args }, mode });
              if (name === "get_kutadgu_analytics") {
                resolve({
                  data: {
                    page_views: 4,
                    book_views: 2,
                    cart_adds: 1,
                    whatsapp_clicks: 0,
                    zero_result_searches: 99,
                    zero_searches: [{ query: "HIDDEN-TOP-TEN", searches: 100 }]
                  },
                  error: null
                });
                return;
              }
              if (name !== "get_kutadgu_zero_searches") {
                resolve({ data: null, error: { message: "unknown rpc" } });
                return;
              }
              if (mode === "missing") {
                resolve({
                  data: null,
                  error: { code: "PGRST202", message: "Could not find the function public.get_kutadgu_zero_searches in the schema cache" }
                });
                return;
              }
              if (mode === "fail") {
                resolve({ data: null, error: { code: "500", message: "network down" } });
                return;
              }
              if (mode === "empty") {
                resolve({
                  data: {
                    total_queries: 0,
                    total_events: 0,
                    offset: args.p_offset || 0,
                    limit: args.p_limit || 20,
                    has_more: false,
                    range_start: "2026-09-25",
                    range_end: "2026-10-01",
                    representation: "search",
                    queries: []
                  },
                  error: null
                });
                return;
              }
              const all = window.__kutadguZeroRows.filter((row) => !args.marker || row.query !== "skip");
              const tagged = [{ query: "range-" + args.p_days, searches: 1, last_searched_at: "2026-10-01T09:45:00Z" }].concat(all);
              const offset = args.p_offset || 0;
              const limit = args.p_limit || 20;
              const slice = tagged.slice(offset, offset + limit);
              resolve({
                data: {
                  total_queries: tagged.length,
                  total_events: tagged.reduce((sum, row) => sum + row.searches, 0),
                  offset,
                  limit,
                  has_more: offset + slice.length < tagged.length,
                  range_start: "2026-09-02",
                  range_end: "2026-10-01",
                  representation: "search",
                  queries: slice
                },
                error: null
              });
            }, delay);
          });
        }
      };
    }, queries());

    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches")).toContainText("new-once");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("12:30");
    const html = await page.locator("#analyticsZeroSearches").innerHTML();
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("HIDDEN-TOP-TEN");
    await expect(page.locator("#analyticsBookViews")).toHaveText("2");
    await expect(page.locator("#analyticsZeroSearchesCount")).not.toHaveText("99");
    await expect(page.locator("#analyticsZeroSearchesCount")).not.toHaveText("—");
    const firstCount = await page.locator("#analyticsZeroSearches .admin-analytics-row").count();
    expect(firstCount).toBe(20);
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row").first()).toContainText("range-30");
    await expect(page.locator("#analyticsZeroSearchesMore")).toBeVisible();

    await page.evaluate(() => { window.__kutadguZeroDelay = 400; });
    await page.evaluate(() => {
      const button = document.querySelector("#analyticsZeroSearchesMore");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(27);
    const pageCalls = await page.evaluate(() => window.__kutadguZeroCalls.filter((call) => call.name === "get_kutadgu_zero_searches" && call.args.p_offset === 20));
    expect(pageCalls).toHaveLength(1);
    const texts = await page.locator("#analyticsZeroSearches .admin-analytics-row").allTextContents();
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.some((text) => text.includes("old-15"))).toBeTruthy();

    await page.evaluate(() => { window.__kutadguZeroDelay = 500; });
    await page.locator("#analyticsRange").selectOption("7");
    await page.locator("#analyticsRange").selectOption("90");
    await expect.poll(async () => page.evaluate(() => window.__kutadguZeroCalls.filter((call) => call.name === "get_kutadgu_zero_searches" && (call.args.p_days === 7 || call.args.p_days === 90)).length)).toBeGreaterThan(1);
    await expect(page.locator("#analyticsZeroSearches")).toContainText("range-90");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("range-7");
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row").first()).toContainText("range-90");

    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row").first()).toContainText("range-90");
    const offsets = await page.evaluate(() => window.__kutadguZeroCalls
      .filter((call) => call.name === "get_kutadgu_zero_searches" && call.args.p_days === 90)
      .map((call) => call.args.p_offset));
    expect(offsets[offsets.length - 1]).toBe(0);

    await page.evaluate(() => { window.__kutadguZeroMode = "empty"; window.__kutadguZeroDelay = 0; });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches")).toContainText("يوق");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("0");
    await expect(page.locator("#analyticsZeroSearchesMore")).toBeHidden();

    await page.evaluate(() => { window.__kutadguZeroMode = "missing"; });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches")).toContainText("قاچىلانمىغان");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("—");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("HIDDEN-TOP-TEN");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("new-once");

    await page.evaluate(() => { window.__kutadguZeroMode = "fail"; });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches")).toContainText("ئوقۇلمىدى");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("—");
    await expect(page.locator("#analyticsBookViews")).toHaveText("2");
    expect(calls).toEqual([]);
  });
});
