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
                    next_offset: args.p_offset || 0,
                    limit: args.p_limit || 20,
                    has_more: false,
                    as_of: "2026-10-01T12:00:00Z",
                    days: args.p_days,
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
                  next_offset: offset + slice.length,
                  limit,
                  has_more: offset + slice.length < tagged.length,
                  as_of: args.p_as_of || "2026-10-01T12:00:00Z",
                  days: args.p_days,
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

  test("keeps the snapshot when a not-yet-loaded query becomes newest", async ({ page }) => {
    const rows = Array.from({ length: 26 }, (_, i) => ({
      query: `query-${String(i + 1).padStart(2, "0")}`,
      searches: 1,
      last_searched_at: new Date(Date.parse("2026-09-30T19:59:00Z") - i * 60000).toISOString()
    }));
    await page.addInitScript((initial) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguZeroCalls = [];
      window.__kutadguLiveRows = initial.map((row) => ({ ...row }));
      window.__kutadguFrozen = null;
      window.__kutadguAnalyticsDb = {
        rpc(name, args) {
          window.__kutadguZeroCalls.push({ name, args: { ...args } });
          if (name === "get_kutadgu_analytics") {
            return Promise.resolve({
              data: { page_views: 1, book_views: args.p_days, cart_adds: 0, whatsapp_clicks: 0, zero_result_searches: 0 },
              error: null
            });
          }
          if (name !== "get_kutadgu_zero_searches") {
            return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
          }
          const asOf = args.p_as_of || null;
          if (!asOf) {
            window.__kutadguFrozen = {
              asOf: "snap-" + (window.__kutadguZeroCalls.length),
              rows: window.__kutadguLiveRows.map((row) => ({ ...row }))
            };
          }
          const frozen = window.__kutadguFrozen;
          const source = frozen ? frozen.rows : [];
          const offset = args.p_offset || 0;
          const limit = args.p_limit || 20;
          const slice = source.slice(offset, offset + limit);
          return Promise.resolve({
            data: {
              total_queries: source.length,
              total_events: source.reduce((sum, row) => sum + row.searches, 0),
              offset,
              next_offset: offset + slice.length,
              limit,
              has_more: offset + slice.length < source.length,
              as_of: frozen ? frozen.asOf : "snap-0",
              days: args.p_days,
              range_start: "2026-09-24",
              range_end: "2026-09-30",
              representation: "search",
              queries: slice
            },
            error: null
          });
        }
      };
    }, rows);

    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(20);
    await expect(page.locator("#analyticsZeroSearches")).toContainText("query-01");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("query-26");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");

    await page.evaluate(() => {
      const live = window.__kutadguLiveRows;
      const target = live.find((row) => row.query === "query-26");
      target.searches = 4;
      target.last_searched_at = "2026-09-30T20:05:00Z";
      live.sort((a, b) => Date.parse(b.last_searched_at) - Date.parse(a.last_searched_at) || a.query.localeCompare(b.query));
      live.unshift({ query: "arrived-later", searches: 1, last_searched_at: "2026-09-30T20:06:00Z" });
    });
    await page.locator("#analyticsZeroSearchesMore").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(26);
    await expect(page.locator("#analyticsZeroSearches")).toContainText("query-26");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("arrived-later");
    await expect(page.locator("#analyticsZeroSearchesMeta")).not.toContainText("چەكلىمىسى");
    await expect(page.locator("#analyticsZeroSearchesMore")).toBeHidden();
    const queries = await page.locator("#analyticsZeroSearches .admin-analytics-row").allTextContents();
    expect(new Set(queries).size).toBe(26);
    expect(queries.some((text) => text.includes("query-26"))).toBeTruthy();
    const pageCalls = await page.evaluate(() => window.__kutadguZeroCalls.filter((call) => call.name === "get_kutadgu_zero_searches"));
    const appended = pageCalls.filter((call) => call.args.p_offset === 20);
    expect(appended).toHaveLength(1);
    const snap = await page.evaluate(() => window.__kutadguFrozen.asOf);
    expect(appended[0].args.p_as_of).toBe(snap);
    expect(pageCalls.filter((call) => call.args.p_offset === 0).every((call) => call.args.p_as_of == null)).toBeTruthy();

    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row").first()).toContainText("arrived-later");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("query-26");
    const refreshed = await page.evaluate(() => window.__kutadguZeroCalls.filter((call) => call.name === "get_kutadgu_zero_searches"));
    const last = refreshed[refreshed.length - 1];
    expect(last.args.p_offset).toBe(0);
    expect(last.args.p_as_of).toBeUndefined();
  });

  test("keeps the date selector and labels each section with the data it still shows", async ({ page }) => {
    await page.addInitScript(() => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguZeroCalls = [];
      window.__kutadguAnalyticsMode = "ok";
      window.__kutadguZeroMode = "ok";
      window.__kutadguAnalyticsDelay = 0;
      window.__kutadguZeroDelay = 0;
      window.__kutadguAnalyticsDb = {
        rpc(name, args) {
          const delay = name === "get_kutadgu_analytics" ? window.__kutadguAnalyticsDelay : window.__kutadguZeroDelay;
          const mode = name === "get_kutadgu_analytics" ? window.__kutadguAnalyticsMode : window.__kutadguZeroMode;
          return new Promise((resolve) => {
            window.setTimeout(() => {
              window.__kutadguZeroCalls.push({ name, args: { ...args }, mode });
              if (mode === "fail") {
                resolve({ data: null, error: { code: "500", message: "network down" } });
                return;
              }
              if (name === "get_kutadgu_analytics") {
                resolve({
                  data: {
                    page_views: args.p_days,
                    book_views: args.p_days,
                    cart_adds: 0,
                    whatsapp_clicks: 0,
                    zero_result_searches: 0
                  },
                  error: null
                });
                return;
              }
              resolve({
                data: {
                  total_queries: 1,
                  total_events: args.p_days,
                  offset: 0,
                  next_offset: 1,
                  limit: args.p_limit || 20,
                  has_more: false,
                  as_of: "asof-" + args.p_days,
                  days: args.p_days,
                  range_start: "2026-09-01",
                  range_end: "2026-10-01",
                  representation: "search",
                  queries: [{ query: "zero-range-" + args.p_days, searches: args.p_days, last_searched_at: "2026-10-01T09:00:00Z" }]
                },
                error: null
              });
            }, delay);
          });
        }
      };
    });

    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsBookViews")).toHaveText("30");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-30");
    await expect(page.locator("#analyticsMeta")).toHaveAttribute("data-shown-days", "30");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    await expect(page.locator("#analyticsRange")).toHaveValue("30");

    await page.evaluate(() => {
      window.__kutadguAnalyticsMode = "fail";
      window.__kutadguAnalyticsDelay = 250;
      window.__kutadguZeroMode = "ok";
      window.__kutadguZeroDelay = 0;
    });
    await page.locator("#analyticsRange").selectOption("7");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-7");
    await expect(page.locator("#analyticsMeta")).toContainText("ئوقۇلمىدى");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
    await expect(page.locator("#analyticsBookViews")).toHaveText("30");
    await expect(page.locator("#analyticsMeta")).toHaveAttribute("data-shown-days", "30");
    await expect(page.locator("#analyticsMeta")).toContainText("30");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "7");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("7");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("zero-range-30");

    await page.evaluate(() => {
      window.__kutadguAnalyticsMode = "ok";
      window.__kutadguZeroMode = "ok";
      window.__kutadguAnalyticsDelay = 0;
      window.__kutadguZeroDelay = 0;
    });
    await page.locator("#analyticsRange").selectOption("30");
    await expect(page.locator("#analyticsBookViews")).toHaveText("30");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-30");

    await page.evaluate(() => {
      window.__kutadguAnalyticsMode = "ok";
      window.__kutadguAnalyticsDelay = 0;
      window.__kutadguZeroMode = "fail";
      window.__kutadguZeroDelay = 200;
    });
    await page.locator("#analyticsRange").selectOption("7");
    await expect(page.locator("#analyticsBookViews")).toHaveText("7");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("ئوقۇلمىدى");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
    await expect(page.locator("#analyticsMeta")).toHaveAttribute("data-shown-days", "7");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-30");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("30");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("30");

    await page.evaluate(() => {
      window.__kutadguAnalyticsMode = "ok";
      window.__kutadguZeroMode = "ok";
      window.__kutadguAnalyticsDelay = 0;
      window.__kutadguZeroDelay = 0;
    });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsBookViews")).toHaveText("7");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-7");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");

    await page.evaluate(() => {
      window.__kutadguAnalyticsDelay = 500;
      window.__kutadguZeroDelay = 40;
    });
    await page.locator("#analyticsRange").selectOption("90");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-90");
    await expect(page.locator("#analyticsBookViews")).toHaveText("90");
    await expect(page.locator("#analyticsRange")).toHaveValue("90");
    await expect(page.locator("#analyticsMeta")).toHaveAttribute("data-shown-days", "90");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "90");

    await page.evaluate(() => {
      window.__kutadguAnalyticsDelay = 0;
      window.__kutadguZeroDelay = 350;
      window.__kutadguLateMark = window.__kutadguZeroCalls.length;
    });
    await page.locator("#analyticsRange").selectOption("30");
    await expect(page.locator("#analyticsBookViews")).toHaveText("30");
    await page.evaluate(() => {
      window.__kutadguAnalyticsDelay = 0;
      window.__kutadguZeroDelay = 0;
    });
    await page.locator("#analyticsRange").selectOption("7");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
    await expect(page.locator("#analyticsBookViews")).toHaveText("7");
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-7");
    await expect(page.locator("#analyticsMeta")).toHaveAttribute("data-shown-days", "7");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "7");
    await expect.poll(async () => page.evaluate(() => window.__kutadguZeroCalls.slice(window.__kutadguLateMark).some((call) => call.name === "get_kutadgu_zero_searches" && call.args.p_days === 30))).toBeTruthy();
    await expect(page.locator("#analyticsZeroSearches")).toContainText("zero-range-7");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("zero-range-30");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("zero-range-90");
    await expect(page.locator("#analyticsBookViews")).toHaveText("7");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
  });

  test("load more continues the retained snapshot after a failed range change", async ({ page }) => {
    const rows30 = Array.from({ length: 26 }, (_, i) => ({
      query: `query-${String(i + 1).padStart(2, "0")}`,
      searches: 1,
      last_searched_at: new Date(Date.parse("2026-10-01T09:00:00Z") - i * 60000).toISOString()
    }));
    const rows7 = rows30.slice(0, 7).map((row) => ({ ...row, query: `week-${row.query}` }));
    await page.addInitScript(({ rows30: full, rows7: week }) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguZeroCalls = [];
      window.__kutadguZeroMode = "ok";
      window.__kutadguAppendMismatch = "";
      window.__kutadguSnapshots = {};
      window.__kutadguSnapSeq = 0;
      window.__kutadguAnalyticsDb = {
        rpc(name, args) {
          window.__kutadguZeroCalls.push({ name, args: { ...args } });
          if (name === "get_kutadgu_analytics") {
            return Promise.resolve({
              data: { page_views: 1, book_views: args.p_days, cart_adds: 0, whatsapp_clicks: 0, zero_result_searches: 0 },
              error: null
            });
          }
          if (name !== "get_kutadgu_zero_searches") {
            return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
          }
          if (window.__kutadguZeroMode === "fail") {
            return Promise.resolve({ data: null, error: { code: "500", message: "network down" } });
          }
          const mismatch = window.__kutadguAppendMismatch;
          if (mismatch && args.p_as_of) {
            const bad = {
              total_queries: 26,
              total_events: 40,
              offset: args.p_offset || 0,
              next_offset: (args.p_offset || 0) + 6,
              limit: args.p_limit || 20,
              has_more: false,
              as_of: args.p_as_of,
              days: 30,
              range_start: "2026-09-02",
              range_end: "2026-10-01",
              representation: "search",
              queries: [{ query: "should-not-appear", searches: 1, last_searched_at: "2026-10-01T09:00:00Z" }]
            };
            if (mismatch === "days") {
              bad.days = 7;
              bad.total_queries = 7;
              bad.total_events = 7;
            } else if (mismatch === "snapshot") {
              bad.as_of = "snap-other";
            } else if (mismatch === "range") {
              bad.range_start = "2026-09-25";
              bad.range_end = "2026-10-01";
            } else if (mismatch === "cursor") {
              bad.offset = 0;
              bad.next_offset = 7;
            }
            return Promise.resolve({ data: bad, error: null });
          }
          let snap = args.p_as_of ? window.__kutadguSnapshots[args.p_as_of] : null;
          if (!args.p_as_of) {
            const id = `snap-${args.p_days}-${window.__kutadguSnapSeq += 1}`;
            snap = {
              id,
              days: args.p_days,
              rows: args.p_days === 7 ? week : full,
              totalEvents: args.p_days === 7 ? 7 : 40,
              rangeStart: args.p_days === 7 ? "2026-09-25" : "2026-09-02",
              rangeEnd: "2026-10-01"
            };
            window.__kutadguSnapshots[id] = snap;
          }
          if (!snap) {
            return Promise.resolve({ data: null, error: { message: "unknown snapshot" } });
          }
          if (args.p_days !== snap.days) {
            const otherRows = args.p_days === 7 ? week : full;
            const offset = args.p_offset || 0;
            const limit = args.p_limit || 20;
            const slice = otherRows.slice(offset, offset + limit);
            return Promise.resolve({
              data: {
                total_queries: otherRows.length,
                total_events: args.p_days === 7 ? 7 : 40,
                offset,
                next_offset: offset + slice.length,
                limit,
                has_more: offset + slice.length < otherRows.length,
                as_of: args.p_as_of,
                days: args.p_days,
                range_start: args.p_days === 7 ? "2026-09-25" : "2026-09-02",
                range_end: "2026-10-01",
                representation: "search",
                queries: slice
              },
              error: null
            });
          }
          const offset = args.p_offset || 0;
          const limit = args.p_limit || 20;
          const slice = snap.rows.slice(offset, offset + limit);
          return Promise.resolve({
            data: {
              total_queries: snap.rows.length,
              total_events: snap.totalEvents,
              offset,
              next_offset: offset + slice.length,
              limit,
              has_more: offset + slice.length < snap.rows.length,
              as_of: snap.id,
              days: snap.days,
              range_start: snap.rangeStart,
              range_end: snap.rangeEnd,
              representation: "search",
              queries: slice
            },
            error: null
          });
        }
      };
    }, { rows30, rows7 });

    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(20);
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("40");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("20 / 26");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    const openedSnap = await page.evaluate(() => {
      window.__kutadguMark = window.__kutadguZeroCalls.length;
      return window.__kutadguZeroCalls.filter((call) => call.name === "get_kutadgu_zero_searches").pop().args;
    });
    expect(openedSnap.p_days).toBe(30);
    expect(openedSnap.p_offset).toBe(0);
    expect(openedSnap.p_as_of).toBeUndefined();

    await page.evaluate(() => { window.__kutadguZeroMode = "fail"; });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("ئوقۇلمىدى");
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(20);
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("40");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("20 / 26");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    await expect(page.locator("#analyticsRange")).toHaveValue("30");

    await page.evaluate(() => { window.__kutadguZeroMode = "ok"; });
    await page.locator("#analyticsZeroSearchesMore").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(26);
    await expect(page.locator("#analyticsZeroSearches")).toContainText("query-26");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("40");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("26 / 26");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    const afterFailedRefresh = await page.evaluate(() => window.__kutadguZeroCalls.slice(window.__kutadguMark).filter((call) => call.name === "get_kutadgu_zero_searches"));
    expect(afterFailedRefresh.map((call) => call.args.p_offset)).toEqual([0, 20]);
    expect(afterFailedRefresh[0].args.p_days).toBe(30);
    expect(afterFailedRefresh[0].args.p_as_of).toBeUndefined();
    expect(afterFailedRefresh[1].args.p_days).toBe(30);
    expect(afterFailedRefresh[1].args.p_as_of).toBeTruthy();
    expect(afterFailedRefresh[1].args.p_offset).toBe(20);

    await page.locator("#analyticsRange").selectOption("90");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "90");
    await page.locator("#analyticsRange").selectOption("30");
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(20);
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    await page.evaluate(() => { window.__kutadguZeroMode = "fail"; });
    await page.locator("#analyticsRange").selectOption("7");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("ئوقۇلمىدى");
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(20);
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("40");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("20 / 26");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");

    await page.evaluate(() => { window.__kutadguZeroMode = "ok"; });
    await page.locator("#analyticsZeroSearchesMore").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(26);
    await expect(page.locator("#analyticsZeroSearches")).toContainText("query-26");
    await expect(page.locator("#analyticsZeroSearches")).not.toContainText("week-");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("40");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("26 / 26");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
    const retainedAppend = await page.evaluate(() => window.__kutadguZeroCalls.filter((call) => call.name === "get_kutadgu_zero_searches" && call.args.p_offset === 20).pop());
    expect(retainedAppend.args.p_days).toBe(30);
    expect(retainedAppend.args.p_as_of).toBeTruthy();

    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(7);
    await expect(page.locator("#analyticsZeroSearches")).toContainText("week-query-01");
    await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("7");
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "7");
    await expect(page.locator("#analyticsRange")).toHaveValue("7");
    const opened = await page.evaluate(() => window.__kutadguZeroCalls.filter((call) => call.name === "get_kutadgu_zero_searches").pop());
    expect(opened.args.p_days).toBe(7);
    expect(opened.args.p_offset).toBe(0);
    expect(opened.args.p_as_of).toBeUndefined();

    await page.locator("#analyticsRange").selectOption("30");
    await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(20);
    await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
    for (const kind of ["days", "snapshot", "range", "cursor"]) {
      await page.evaluate((value) => { window.__kutadguAppendMismatch = value; }, kind);
      await page.locator("#analyticsZeroSearchesMore").click();
      await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("ماس كەلمىدى");
      await expect(page.locator("#analyticsZeroSearches")).not.toContainText("should-not-appear");
      await expect(page.locator("#analyticsZeroSearches .admin-analytics-row")).toHaveCount(20);
      await expect(page.locator("#analyticsZeroSearchesCount")).toHaveText("40");
      await expect(page.locator("#analyticsZeroSearchesMeta")).toContainText("20 / 26");
      await expect(page.locator("#analyticsZeroSearchesMeta")).toHaveAttribute("data-shown-days", "30");
      await expect(page.locator("#analyticsRange")).toHaveValue("30");
      await expect(page.locator("#analyticsZeroSearchesMore")).toBeVisible();
    }
  });
});
