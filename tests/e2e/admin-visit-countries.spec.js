const { test, expect } = require("./playwright-test");

test("a cached analytics.js?v=7 is not the recorder the new homepage runs", async ({ page }) => {
  await page.route("**/analytics.js?v=7", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript; charset=utf-8",
    headers: { "cache-control": "public, max-age=300" },
    body: "window.__kutadguOldAnalytics = true;"
  }));
  const planted = await page.goto("/analytics.js?v=7");
  expect(planted.status()).toBe(200);
  await page.unroute("**/analytics.js?v=7");
  const requested = [];
  page.on("request", (req) => requested.push(new URL(req.url()).pathname + new URL(req.url()).search));
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  expect(requested).toContain("/analytics.js?v=8");
  expect(requested).not.toContain("/analytics.js?v=7");
  const served = await page.evaluate(async () => {
    const res = await fetch("/analytics.js?v=8", { cache: "no-store" });
    return res.text();
  });
  expect(served).toContain("/api/analytics-event");
  const cached = await page.evaluate(async () => {
    try {
      const res = await fetch("/analytics.js?v=7", { cache: "only-if-cached", mode: "same-origin" });
      if (!res.ok) return "miss";
      return res.text();
    } catch (err) {
      return "miss";
    }
  });
  expect(cached === "miss" || cached.includes("__kutadguOldAnalytics")).toBe(true);
  expect(cached).not.toContain("/api/analytics-event");
});

const viewports = [
  { width: 390, height: 800, label: "phone" },
  { width: 1280, height: 900, label: "desktop" }
];

function countryPayload(code, visits, latestCountry, latestAt) {
  return {
    page_views: 10,
    book_views: 4,
    cart_adds: 1,
    whatsapp_clicks: 0,
    top_books: [],
    zero_searches: [],
    top_cart_books: [],
    visit_countries: {
      version: 1,
      status: "complete",
      started_at: "2026-10-01T00:00:00Z",
      countries: code ? [{ code, visits }] : [],
      unknown_visits: code ? 0 : visits,
      latest: [{
        country: latestCountry,
        counted_at: latestAt
      }]
    }
  };
}

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
  await expect(page.locator("#analyticsVisitCountries")).toBeVisible();
}

for (const viewport of viewports) {
  for (const scheme of ["light", "dark"]) {
    test(`country report renders at ${viewport.label} in ${scheme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await openInsights(page);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("#analyticsVisitCountryStatus")).toContainText("يۈكلىنىۋاتىدۇ");
      await expect(page.locator("#analyticsVisitCountryNote")).toContainText("VPN");
      await expect(page.locator("#analyticsRange")).toBeVisible();
      const described = await page.evaluate(() => {
        const Core = window.KutadguAnalyticsCore;
        const view = Core.describeAnalytics({
          page_views: 10,
          book_views: 4,
          cart_adds: 1,
          whatsapp_clicks: 0,
          top_books: [],
          zero_searches: [],
          visit_countries: {
            status: "complete",
            countries: [{ code: "TR", visits: 4 }, { code: "DE", visits: 1 }],
            unknown_visits: 2,
            latest: [
              { country: "TR", counted_at: "2026-10-08T09:30:00Z" },
              { country: null, counted_at: "2026-10-08T06:00:00Z" }
            ]
          }
        }, new Date("2026-10-08T12:00:00Z"));
        window.__kutadguRenderAnalytics(view, { shownDays: 30 });
        return view.visitCountries.rows.map((row) => row.label + ":" + row.visits);
      });
      expect(described[0]).toBe("تۈركىيە:4");
      await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("تۈركىيە");
      await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("نامەلۇم");
      await expect(page.locator("#analyticsVisitCountryLatest")).toContainText("2026-10-08 12:30");
      const box = await page.locator("#analyticsVisitCountries").evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          dir: getComputedStyle(document.documentElement).direction,
          overflow: el.scrollWidth <= el.clientWidth + 2,
          color: style.color,
          width: el.getBoundingClientRect().width
        };
      });
      expect(box.dir).toBe("rtl");
      expect(box.overflow).toBe(true);
      expect(box.width).toBeGreaterThan(0);
      expect(box.color).not.toBe("rgba(0, 0, 0, 0)");
      await page.evaluate(() => {
        const view = window.KutadguAnalyticsCore.describeAnalytics({
          visit_countries: { status: "unavailable", countries: null, unknown_visits: null, latest: null }
        }, new Date());
        window.__kutadguRenderAnalytics(view, { shownDays: 30 });
      });
      await expect(page.locator("#analyticsVisitCountryStatus")).toContainText("نۆل ئەمەس");
      await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("سانىلىدىغان زىيارەت 0");
      await page.evaluate(() => {
        const view = window.KutadguAnalyticsCore.describeAnalytics({
          visit_countries: { status: "zero", countries: [], unknown_visits: 0, latest: [] }
        }, new Date());
        window.__kutadguRenderAnalytics(view, { shownDays: 30 });
      });
      await expect(page.locator("#analyticsVisitCountryStatus")).toContainText("0");
      await page.evaluate(() => {
        const view = window.KutadguAnalyticsCore.describeAnalytics({
          visit_countries: {
            status: "partial",
            countries: [{ code: "FR", visits: 1 }],
            unknown_visits: 0,
            latest: [{ country: "FR", counted_at: "2026-10-08T08:00:00Z" }]
          }
        }, new Date());
        window.__kutadguRenderAnalytics(view, { shownDays: 7 });
      });
      await expect(page.locator("#analyticsVisitCountryStatus")).toContainText("قىسمەن");
      await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("فرانسىيە");
    });
  }

  test(`failed refresh, stale period, and sign-out keep country results honest at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguExposeAnalyticsRender = true;
      window.__kutadguCountryMode = "ok";
      window.__kutadguCountryRelease = null;
      window.__kutadguAnalyticsDb = {
        rpc(name, args) {
          if (name !== "get_kutadgu_analytics") {
            return Promise.resolve({ data: null, error: { message: "يوق", code: "PGRST202" } });
          }
          const mode = window.__kutadguCountryMode;
          const days = args && args.p_days;
          const finish = (data, error) => Promise.resolve({ data, error });
          if (mode === "delay-7" && days === 7) {
            return new Promise((resolve) => {
              window.__kutadguCountryRelease = () => resolve({
                data: {
                  page_views: 1,
                  book_views: 1,
                  cart_adds: 0,
                  whatsapp_clicks: 0,
                  top_books: [],
                  zero_searches: [],
                  visit_countries: {
                    status: "complete",
                    countries: [{ code: "TR", visits: 9 }],
                    unknown_visits: 0,
                    latest: [{ country: "TR", counted_at: "2026-10-08T09:00:00Z" }]
                  }
                },
                error: null
              });
            });
          }
          if (mode === "error") {
            return finish(null, { message: "ئوقۇش مەغلۇپ" });
          }
          const code = days === 30 ? "DE" : "JP";
          return finish({
            page_views: 2,
            book_views: 1,
            cart_adds: 0,
            whatsapp_clicks: 0,
            top_books: [],
            zero_searches: [],
            visit_countries: {
              status: "complete",
              countries: [{ code, visits: days === 30 ? 4 : 1 }],
              unknown_visits: 0,
              latest: [{ country: code, counted_at: "2026-10-08T10:00:00Z" }]
            }
          }, null);
        }
      };
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    const select = page.locator("#adminSectionSelect");
    if (await select.isVisible()) await select.selectOption("insights");
    else await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#analyticsRange").selectOption("30");
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("گېرمانىيە");
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("4");
    await page.evaluate(() => { window.__kutadguCountryMode = "error"; });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("گېرمانىيە");
    await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("سانىلىدىغان زىيارەت 0");
    await expect(page.locator("#analyticsMeta")).toContainText("نۆلگە ئالماشتۇرۇلمىدى");
    await page.evaluate(async () => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const db = window.__kutadguAnalyticsDb;
      const original = db.rpc.bind(db);
      db.rpc = (name, args) => {
        if (name === "get_kutadgu_analytics" && args && args.p_days === 7) {
          return held.then(() => ({
            data: {
              page_views: 1,
              book_views: 1,
              cart_adds: 0,
              whatsapp_clicks: 0,
              top_books: [],
              zero_searches: [],
              visit_countries: {
                status: "complete",
                countries: [{ code: "TR", visits: 9 }],
                unknown_visits: 0,
                latest: [{ country: "TR", counted_at: "2026-10-08T09:00:00Z" }]
              }
            },
            error: null
          }));
        }
        return original(name, args);
      };
      window.__kutadguCountryMode = "ok";
      const range = document.querySelector("#analyticsRange");
      range.value = "7";
      range.dispatchEvent(new Event("change"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      range.value = "30";
      range.dispatchEvent(new Event("change"));
      await new Promise((resolve) => setTimeout(resolve, 40));
      release();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("گېرمانىيە");
    await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("تۈركىيە");
    await page.evaluate(() => window.__kutadguLogoutAnalytics());
    await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("گېرمانىيە");
    await expect(page.locator("#analyticsVisitCountryStatus")).toContainText("يۈكلىنىۋاتىدۇ");
  });
}
