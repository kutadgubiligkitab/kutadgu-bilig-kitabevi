const { test, expect } = require("./playwright-test");

function rows() {
  const rest = Array.from({ length: 22 }, (_, i) => ({
    query: `سۆز-${String(i + 1).padStart(2, "0")}`,
    searches: 1,
    last_searched_at: new Date(Date.UTC(2026, 9, 1, 8, i, 0)).toISOString()
  }));
  return [
    { query: "گامما", searches: 5, last_searched_at: "2026-10-06T11:00:00Z" },
    { query: "ئالفا", searches: 4, last_searched_at: "2026-10-06T10:00:00Z" },
    { query: "بېتا", searches: 4, last_searched_at: "2026-10-06T10:00:00Z" },
    { query: "<img src=x onerror=alert(1)>", searches: 3, last_searched_at: "2026-10-06T09:30:00Z" },
    ...rest
  ];
}

async function install(page) {
  await page.addInitScript((searchRows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguSearchRows = searchRows;
    window.__kutadguSearchMode = "ok";
    window.__kutadguSearchDelay = 0;
    window.__kutadguSearchCalls = [];
    window.__kutadguAnalyticsDb = {
      rpc(name, args) {
        const mode = window.__kutadguSearchMode;
        const delay = window.__kutadguSearchDelay;
        return new Promise((resolve) => {
          window.setTimeout(() => {
            window.__kutadguSearchCalls.push({ name, args: Object.assign({}, args), mode });
            if (name === "get_kutadgu_analytics") {
              resolve({
                data: {
                  page_views: 8,
                  book_views: 4,
                  cart_adds: 3,
                  whatsapp_clicks: 2,
                  unknown_result_searches: 1,
                  top_books: [{ book_id: "15", title: "Canon", views: 4 }],
                  top_cart_books: [{ book_id: "15", title: "سېۋەت كىتابى", adds: 2 }],
                  top_whatsapp_books: [
                    { book_id: "16", title: "WhatsApp كىتابى", clicks: 2 },
                    { book_id: "15", title: "سېۋەت كىتابى", clicks: 1 }
                  ],
                  zero_searches: [{ query: "HIDDEN-TOP-TEN", searches: 100 }]
                },
                error: null
              });
              return;
            }
            if (name === "get_kutadgu_zero_searches") {
              resolve({
                data: {
                  total_queries: 1,
                  total_events: 1,
                  offset: 0,
                  next_offset: 1,
                  limit: 20,
                  has_more: false,
                  as_of: "2026-10-06T12:00:00Z",
                  days: args.p_days,
                  range_start: "2026-09-30",
                  range_end: "2026-10-06",
                  representation: "search",
                  queries: [{ query: "نۆل-سۆز", searches: 1, last_searched_at: "2026-10-06T09:00:00Z" }]
                },
                error: null
              });
              return;
            }
            if (name !== "get_kutadgu_searches") {
              resolve({ data: null, error: { message: "unknown rpc" } });
              return;
            }
            if (mode === "missing") {
              resolve({
                data: null,
                error: { code: "PGRST202", message: "Could not find the function public.get_kutadgu_searches in the schema cache" }
              });
              return;
            }
            if (mode === "fail") {
              resolve({ data: null, error: { code: "500", message: "network down" } });
              return;
            }
            const tagged = [{ query: "range-" + args.p_days, searches: 9, last_searched_at: "2026-10-06T12:30:00Z" }].concat(window.__kutadguSearchRows);
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
                as_of: args.p_as_of || "2026-10-06T12:00:00Z",
                days: args.p_days,
                range_start: "2026-09-07",
                range_end: "2026-10-06",
                representation: "search",
                queries: slice
              },
              error: null
            });
          }, delay);
        });
      }
    };
  }, rows());
}

test.describe("admin search lists", () => {
  test("paginates every term, keeps counts stable, and escapes Uyghur text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await install(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    const searches = page.locator("#analyticsSearches");
    await expect(searches.locator(".admin-analytics-row").first()).toContainText("range-30");
    await expect(searches).toContainText("گامما");
    await expect(searches).toContainText("ئالفا");
    await expect(searches).toContainText("14:00");
    const html = await searches.innerHTML();
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("HIDDEN-TOP-TEN");
    await expect(page.locator("#analyticsTopCart")).toContainText("سېۋەت كىتابى");
    await expect(page.locator("#analyticsTopCart")).toContainText("2");
    await expect(page.getByText("سېۋەتكە قوشۇش ۋەقىسى")).toBeVisible();
    await expect(page.locator("#analyticsTopWhatsapp")).toContainText("WhatsApp كىتابى");
    await expect(page.getByText("چېكىش سانى")).toBeVisible();
    await expect(page.locator("#analyticsUnknownSearches")).toContainText("1");
    await expect(page.locator("#analyticsSearches .admin-analytics-row")).toHaveCount(20);
    await expect(page.locator("#analyticsSearchesMore")).toBeVisible();

    await page.evaluate(() => { window.__kutadguSearchDelay = 400; });
    await page.evaluate(() => {
      const button = document.querySelector("#analyticsSearchesMore");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(page.locator("#analyticsSearches .admin-analytics-row")).toHaveCount(27);
    const pageCalls = await page.evaluate(() => window.__kutadguSearchCalls.filter((call) => call.name === "get_kutadgu_searches" && call.args.p_offset === 20));
    expect(pageCalls).toHaveLength(1);
    const texts = await page.locator("#analyticsSearches .admin-analytics-row").allTextContents();
    expect(new Set(texts).size).toBe(texts.length);

    await page.evaluate(() => { window.__kutadguSearchDelay = 500; });
    await page.locator("#analyticsRange").selectOption("7");
    await page.locator("#analyticsRange").selectOption("90");
    await expect(searches).toContainText("range-90");
    await expect(searches).not.toContainText("range-7");
    await expect(searches.locator(".admin-analytics-row").first()).toContainText("range-90");
    const meta = await page.locator("#analyticsSearchesMeta").innerText();
    expect(meta).toContain("90");
    expect(meta).not.toContain("range-7");

    const beforeFail = await searches.innerText();
    await page.evaluate(() => { window.__kutadguSearchMode = "fail"; window.__kutadguSearchDelay = 0; });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsSearchesMeta")).toContainText("ئوقۇلمىدى");
    await expect(searches).toContainText("range-90");
    await expect(searches).not.toContainText("range-7");
    await expect(page.locator("#analyticsSearchesMeta")).not.toContainText("0 / 0");
    const afterFail = await searches.innerText();
    expect(afterFail).toContain("گامما");
    expect(beforeFail).toContain("گامما");

    await page.evaluate(() => { window.__kutadguSearchMode = "missing"; });
    await page.locator("#reloadAnalytics").click();
    await expect(searches).toContainText("قاچىلانمىغان");
    await expect(searches).not.toContainText("گامما");
    await expect(page.locator("#analyticsSearchesMeta")).toHaveText("");
    await expect(page.locator("#analyticsBookViews")).toHaveText("4");
  });

  test("stacks the lists on a phone width without overflowing the escaped term", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await install(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    const select = page.locator("#adminSectionSelect");
    if (await select.isVisible()) await select.selectOption("insights");
    else await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#reloadAnalytics").click();
    const card = page.locator("#analyticsSearches");
    await expect(card).toContainText("گامما");
    const html = await card.innerHTML();
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    const box = await page.locator(".admin-analytics-grid").evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        columns: style.gridTemplateColumns,
        overflow: el.scrollWidth - el.clientWidth
      };
    });
    expect(box.columns).not.toContain(" ");
    expect(box.overflow).toBeLessThanOrEqual(1);
    await expect(page.getByText("چېكىش سانى")).toBeVisible();
  });
});
