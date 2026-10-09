const { test, expect } = require("./playwright-test");
const http = require("http");

test("a cached analytics.js?v=7 stays reusable while the new homepage runs v=8", async ({ browser }) => {
  const oldBody = "window.__kutadguOldAnalytics = true;";
  const hits = { v7: 0, v8: 0 };
  const origin = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/analytics-cache-old.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end("<!DOCTYPE html><html><body><script src=\"/analytics.js?v=7\"></script></body></html>");
        return;
      }
      if (url.pathname === "/analytics.js" && url.searchParams.get("v") === "7") {
        hits.v7 += 1;
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300, immutable",
          "content-length": Buffer.byteLength(oldBody)
        });
        res.end(oldBody);
        return;
      }
      if (url.pathname === "/analytics.js" && url.searchParams.get("v") === "8") hits.v8 += 1;
      const proxy = http.request({
        hostname: "127.0.0.1",
        port: 4173,
        path: req.url,
        method: req.method,
        headers: Object.assign({}, req.headers, { host: "127.0.0.1:4173" })
      }, (upstream) => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      });
      proxy.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("proxy failed");
      });
      req.pipe(proxy);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: "http://127.0.0.1:" + server.address().port }));
    server.on("error", reject);
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(origin.origin + "/analytics-cache-old.html", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => window.__kutadguOldAnalytics === true)).toBe(true);
    expect(hits.v7).toBe(1);
    expect(hits.v8).toBe(0);
    const cached = await page.evaluate(async () => {
      const res = await fetch("/analytics.js?v=7", { cache: "only-if-cached", mode: "same-origin" });
      if (!res.ok) throw new Error("cached recorder missed");
      return res.text();
    });
    expect(cached).toContain("__kutadguOldAnalytics");
    expect(cached).not.toContain("/api/analytics-event");
    await page.goto(origin.origin + "/analytics-cache-old.html", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => window.__kutadguOldAnalytics === true)).toBe(true);
    expect(hits.v7).toBe(1);
    const reused = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("analytics.js?v=7"))
      .map((entry) => ({ transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize })));
    expect(reused.some((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0)).toBe(true);
    await page.goto(origin.origin + "/index.html", { waitUntil: "domcontentloaded" });
    await expect.poll(() => hits.v8).toBe(1);
    expect(hits.v7).toBe(1);
    expect(await page.evaluate(() => window.__kutadguOldAnalytics === true)).toBe(false);
    const ran = await page.evaluate(async () => {
      const res = await fetch("/analytics.js?v=8", { cache: "no-store" });
      return res.text();
    });
    expect(ran).toContain("/api/analytics-event");
    expect(hits.v8).toBe(2);
  } finally {
    await context.close();
    await new Promise((resolve) => origin.server.close(resolve));
  }
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
  await expect(page.locator("#analyticsVisitCountryToggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#analyticsVisitCountryPanel")).toBeHidden();
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
      await page.locator("#analyticsVisitCountryToggle").click();
      await expect(page.locator("#analyticsVisitCountryPanel")).toBeVisible();
      await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-name").first()).toHaveText("تۈركىيە");
      await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-count").first()).toContainText("4");
      await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("نامەلۇم");
      await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-name").first()).toHaveText("تۈركىيە");
      await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-date").first()).toHaveText("2026-10-08");
      await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-time").first()).toHaveText("12:30");
      const box = await page.locator("#analyticsVisitCountryPanel").evaluate((el) => {
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

  test(`country panel toggles in place at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguExposeAnalyticsRender = true;
      window.__kutadguAnalyticsDb = {
        from() {
          const q = {};
          ["select", "eq", "in", "or", "order", "range", "is", "limit", "gte", "lte", "neq"].forEach((method) => {
            q[method] = () => q;
          });
          q.maybeSingle = async () => ({ data: null, error: null });
          q.then = (resolve, reject) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
          return q;
        },
        rpc(name) {
          if (name !== "get_kutadgu_analytics") {
            return Promise.resolve({ data: null, error: { message: "يوق", code: "PGRST202" } });
          }
          return Promise.resolve({
            data: {
              page_views: 2,
              book_views: 1,
              cart_adds: 0,
              whatsapp_clicks: 0,
              top_books: [],
              zero_searches: [],
              visit_countries: {
                status: "complete",
                countries: [{ code: "US", visits: 1 }, { code: "SA", visits: 1 }],
                unknown_visits: 0,
                latest: [
                  { country: "US", counted_at: "2026-10-08T10:00:00Z" },
                  { country: "SA", counted_at: "2026-10-07T10:00:00Z" }
                ]
              }
            },
            error: null
          });
        }
      };
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    const select = page.locator("#adminSectionSelect");
    if (await select.isVisible()) await select.selectOption("insights");
    else await page.locator('[data-admin-section="insights"]').click();
    const toggle = page.locator("#analyticsVisitCountryToggle");
    const panel = page.locator("#analyticsVisitCountryPanel");
    await expect(toggle).toHaveAttribute("aria-controls", "analyticsVisitCountryPanel");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("ئامېرىكا");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-count").first()).toContainText("1");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    const box = await toggle.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    const outline = await toggle.evaluate((el) => {
      el.focus({ focusVisible: true });
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).toBe("solid");
    expect(outline.width).toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    await expect(page.locator("#analyticsVisitCountryNote")).toHaveText("ساناش ئارىلىقى: 3 سائەت. VPN دۆلەت نەتىجىسىگە تەسىر قىلىشى مۇمكىن.");
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("ئامېرىكا");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-count").first()).toContainText("1");
    await expect(page.locator("#analyticsVisitCountryLatestTitle")).toHaveText("ئاخىرقى 20 سانىلىدىغان زىيارەت");
    await expect(page.locator("#analyticsVisitCountryLatestNote")).toContainText("تولۇق زىيارەت خاتىرىسى ئەمەس");
    await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-name").first()).toHaveText("ئامېرىكا");
    await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-date").first()).toHaveText("2026-10-08");
    await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-time").first()).toHaveText("13:00");
    await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-name").nth(1)).toHaveText("سەئۇدى ئەرەبىستان");
    await expect(page.locator("#analyticsVisitCountryLatest .admin-country-row .admin-country-date").nth(1)).toHaveText("2026-10-07");
    const order = await page.locator("#analyticsVisitCountryLatest .admin-country-row").first().evaluate((row) => {
      const cells = [...row.querySelectorAll("[role=cell]")].map((el) => {
        const box = el.getBoundingClientRect();
        const isolate = el.querySelector("bdi");
        return { text: el.innerText.replace(/\s+/g, " ").trim(), left: box.left, dir: isolate ? isolate.dir : "" };
      });
      return cells;
    });
    expect(order.map((cell) => cell.text)).toEqual(["ئامېرىكا", "2026-10-08", "13:00"]);
    expect(order[0].left).toBeGreaterThan(order[1].left);
    expect(order[1].left).toBeGreaterThan(order[2].left);
    expect(order[1].dir).toBe("ltr");
    expect(order[2].dir).toBe("ltr");
    const fit = await page.locator("#analyticsVisitCountryPanel").evaluate((panel) => {
      const card = document.querySelector("#analyticsManagement");
      const style = getComputedStyle(card);
      const inner = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const panelBox = panel.getBoundingClientRect();
      const row = panel.querySelector("#analyticsVisitCountryTotals .admin-country-row");
      const name = row.querySelector(".admin-country-name").getBoundingClientRect();
      const count = row.querySelector(".admin-country-count").getBoundingClientRect();
      return {
        panel: panelBox.width,
        inner,
        gap: name.left - count.right,
        pageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        inside: panel.scrollWidth <= panel.clientWidth + 2
      };
    });
    expect(fit.panel).toBeGreaterThan(fit.inner * 0.92);
    expect(fit.gap).toBeGreaterThan(-2);
    expect(fit.gap).toBeLessThan(36);
    expect(fit.pageOverflow).toBe(true);
    expect(fit.inside).toBe(true);
    const shortHeight = await page.locator("#analyticsVisitCountryTotals .admin-country-row").first().evaluate((el) => el.getBoundingClientRect().height);
    await page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-name bdi").first().evaluate((el) => {
      el.textContent = "بۈيۈك بىرىتانىيە ئۇيغۇر ئاپتونوم رايونى ".repeat(8);
    });
    const wrapped = await page.locator("#analyticsVisitCountryTotals .admin-country-row").first().evaluate((el, previousHeight) => {
      const panelBox = document.querySelector("#analyticsVisitCountryPanel").getBoundingClientRect();
      const rowBox = el.getBoundingClientRect();
      const name = el.querySelector(".admin-country-name");
      const count = el.querySelector(".admin-country-count");
      return {
        wraps: rowBox.height > previousHeight + 8,
        inside: el.scrollWidth <= panelBox.width + 2 && rowBox.left >= panelBox.left - 2 && rowBox.right <= panelBox.right + 2,
        countVisible: count && count.getBoundingClientRect().width > 0 && name.getBoundingClientRect().right > count.getBoundingClientRect().right
      };
    }, shortHeight);
    expect(wrapped.wraps).toBe(true);
    expect(wrapped.inside).toBe(true);
    expect(wrapped.countVisible).toBe(true);
    await page.locator("#reloadAnalytics").click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("ئامېرىكا");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-count").first()).toContainText("1");
    await page.locator("#analyticsRange").selectOption("7");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await panel.evaluate((el) => el.hidden)).toBe(true);
    await page.locator("#reloadAnalytics").click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(panel).toBeVisible();
    await page.locator("#analyticsVisitCountrySearch").fill("ئامېرىكا");
    await page.evaluate(() => window.__kutadguLogoutAnalytics());
    await expect(page.locator("#analyticsVisitCountrySearch")).toHaveValue("");
    expect(await page.locator("#analyticsVisitCountryFilter").evaluate((el) => el.hidden)).toBe(true);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await panel.evaluate((el) => el.hidden)).toBe(true);
    await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("ئامېرىكا");
  });
}

test("country totals search and pages stay local at phone and desktop", async ({ page }) => {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguExposeAnalyticsRender = true;
    window.__kutadguCountryRpc = 0;
    window.__kutadguCountryMode = "ok";
    function countryPayload(days) {
      if (days === 7) {
        return {
          page_views: 1,
          book_views: 1,
          cart_adds: 0,
          whatsapp_clicks: 0,
          top_books: [],
          zero_searches: [],
          visit_countries: {
            status: "complete",
            countries: [{ code: "JP", visits: 1 }],
            unknown_visits: 0,
            latest: [{ country: "JP", counted_at: "2026-10-08T08:00:00Z" }]
          }
        };
      }
      const countries = [];
      for (let i = 0; i < 200; i += 1) {
        const code = String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26));
        countries.push({ code, visits: 300 - i });
      }
      countries.push({ code: "HK", visits: 50 });
      return {
        page_views: 3,
        book_views: 1,
        cart_adds: 0,
        whatsapp_clicks: 0,
        top_books: [],
        zero_searches: [],
        visit_countries: {
          status: "complete",
          countries,
          unknown_visits: 4,
          latest: [
            { country: "HK", counted_at: "2026-10-08T09:30:00Z" },
            { country: "QZ", counted_at: "2026-10-08T06:00:00Z" },
            { country: null, counted_at: "2026-10-07T06:00:00Z" }
          ]
        }
      };
    }
    window.__kutadguAnalyticsDb = {
      rpc(name, args) {
        window.__kutadguCountryRpc += 1;
        if (name !== "get_kutadgu_analytics") {
          return Promise.resolve({ data: null, error: { message: "يوق", code: "PGRST202" } });
        }
        if (window.__kutadguCountryMode === "error") {
          return Promise.resolve({ data: null, error: { message: "ئوقۇش مەغلۇپ" } });
        }
        return Promise.resolve({ data: countryPayload(args && args.p_days), error: null });
      }
    };
  });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    const select = page.locator("#adminSectionSelect");
    if (await select.isVisible()) await select.selectOption("insights");
    else await page.locator('[data-admin-section="insights"]').click();
    await page.locator("#analyticsVisitCountryToggle").click();
    await page.evaluate(() => {
      const Core = window.KutadguAnalyticsCore;
      const none = Core.describeAnalytics({ visit_countries: { status: "zero", countries: [], unknown_visits: 0, latest: [] } }, new Date());
      window.__kutadguRenderAnalytics(none, { shownDays: 30 });
    });
    await expect(page.locator("#analyticsVisitCountryFilter")).toBeHidden();
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("سانىلىدىغان زىيارەت 0");
    await page.evaluate(() => {
      const countries = [{ code: "TR", visits: 1 }];
      const one = window.KutadguAnalyticsCore.describeAnalytics({
        visit_countries: { status: "complete", countries, unknown_visits: 0, latest: [{ country: "TR", counted_at: "2026-10-08T09:00:00Z" }] }
      }, new Date());
      window.__kutadguRenderAnalytics(one, { shownDays: 30 });
    });
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row")).toHaveCount(1);
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("1 / 1");
    await page.evaluate(() => {
      const countries = [];
      for (let i = 0; i < 21; i += 1) countries.push({ code: String.fromCharCode(65 + i) + "A", visits: 30 - i });
      const view = window.KutadguAnalyticsCore.describeAnalytics({
        visit_countries: { status: "complete", countries, unknown_visits: 1, latest: [] }
      }, new Date());
      window.__kutadguRenderAnalytics(view, { shownDays: 30 });
    });
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("جەمئىي 22");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row")).toHaveCount(20);
    await page.locator("#analyticsVisitCountryNext").click();
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row")).toHaveCount(2);
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("نامەلۇم");
    await page.locator("#analyticsRange").selectOption("30");
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("جەمئىي 202");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row")).toHaveCount(20);
    await expect(page.locator("#analyticsVisitCountryFilter")).toBeVisible();
    const before = await page.evaluate(() => window.__kutadguCountryRpc);
    await page.locator("#analyticsVisitCountrySearch").fill("HK");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-name")).toHaveText("خوڭكوڭ");
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("ماس كەلگىنى 1");
    await page.locator("#analyticsVisitCountrySearch").fill("خوڭكوڭ");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-name")).toHaveText("خوڭكوڭ");
    await page.locator("#analyticsVisitCountrySearch").fill("نامەلۇم");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row .admin-country-name")).toHaveText("نامەلۇم");
    await page.locator("#analyticsVisitCountrySearch").fill("");
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("1 / 11");
    await page.locator("#analyticsVisitCountryNext").click();
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("2 / 11");
    await expect(page.locator("#analyticsVisitCountryTotals .admin-country-row")).toHaveCount(20);
    const after = await page.evaluate(() => window.__kutadguCountryRpc);
    expect(after).toBe(before);
    await page.evaluate(() => { window.__kutadguCountryMode = "error"; });
    await page.locator("#reloadAnalytics").click();
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("2 / 11");
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("جەمئىي 202");
    await expect(page.locator("#analyticsMeta")).toContainText("30");
    await page.evaluate(() => { window.__kutadguCountryMode = "ok"; });
    await page.locator("#analyticsRange").selectOption("7");
    await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("ياپونىيە");
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("1 / 1");
    await expect(page.locator("#analyticsVisitCountryPage")).not.toContainText("202");
    await page.locator("#analyticsRange").selectOption("30");
    await expect(page.locator("#analyticsVisitCountryPage")).toContainText("1 / 11");
    const latin = await page.locator("#analyticsVisitCountryLatest .admin-country-row", { hasText: "QZ" }).evaluate((row) => {
      const cells = [...row.querySelectorAll("[role=cell]")];
      return {
        name: cells[0].innerText.trim(),
        date: cells[1].innerText.trim(),
        time: cells[2].innerText.trim(),
        nameDir: cells[0].querySelector("bdi").dir,
        dateDir: cells[1].querySelector("bdi").dir,
        timeDir: cells[2].querySelector("bdi").dir,
        nameLeft: cells[0].getBoundingClientRect().left,
        dateLeft: cells[1].getBoundingClientRect().left,
        timeLeft: cells[2].getBoundingClientRect().left
      };
    });
    expect(latin.name).toBe("QZ");
    expect(latin.date).toBe("2026-10-08");
    expect(latin.time).toBe("09:00");
    expect(latin.nameDir).toBe("ltr");
    expect(latin.dateDir).toBe("ltr");
    expect(latin.timeDir).toBe("ltr");
    expect(latin.nameLeft).toBeGreaterThan(latin.dateLeft);
    expect(latin.dateLeft).toBeGreaterThan(latin.timeLeft);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(overflow).toBe(true);
    await page.locator("#analyticsVisitCountryPanel").screenshot({ path: viewport.width === 390 ? "/tmp/country-panel-390.png" : "/tmp/country-panel-1280.png" });
  }
});

test("thrown analytics reads keep the last period and retry", async ({ page }) => {
  const unhandled = [];
  page.on("pageerror", (err) => unhandled.push(String(err)));
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
    window.__kutadguExposeAnalyticsRender = true;
    window.__kutadguCountryMode = "throw";
    window.__kutadguUnhandled = [];
    window.addEventListener("unhandledrejection", (event) => {
      window.__kutadguUnhandled.push(String(event.reason && event.reason.message || event.reason));
    });
    window.__kutadguAnalyticsDb = {
      from() {
        const q = {};
        ["select", "eq", "in", "or", "order", "range", "is", "limit", "gte", "lte", "neq"].forEach((method) => {
          q[method] = () => q;
        });
        q.maybeSingle = async () => ({ data: null, error: null });
        q.then = (resolve, reject) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
        return q;
      },
      rpc(name, args) {
        if (name !== "get_kutadgu_analytics") {
          return Promise.resolve({ data: null, error: { message: "يوق", code: "PGRST202" } });
        }
        const mode = window.__kutadguCountryMode;
        if (mode === "throw") return Promise.reject(new Error("تور ئۈزۈلدى"));
        const days = args && args.p_days;
        const code = days === 30 ? "DE" : "JP";
        return Promise.resolve({
          data: {
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
          },
          error: null
        });
      }
    };
  });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  const select = page.locator("#adminSectionSelect");
  if (await select.isVisible()) await select.selectOption("insights");
  else await page.locator('[data-admin-section="insights"]').click();
  await page.locator("#analyticsRange").selectOption("30");
  await page.locator("#reloadAnalytics").click();
  await expect(page.locator("#analyticsVisitCountryToggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#analyticsVisitCountryToggle").click();
  await expect(page.locator("#analyticsVisitCountryRetry")).toBeVisible();
  await expect(page.locator("#analyticsVisitCountryStatus")).toContainText("تور ئۈزۈلدى");
  await expect(page.locator("#analyticsVisitCountryStatus")).not.toContainText("يۈكلىنىۋاتىدۇ");
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("سانىلىدىغان زىيارەت 0");
  await page.evaluate(() => { window.__kutadguCountryMode = "ok"; });
  await page.locator("#analyticsVisitCountryRetry").click();
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("گېرمانىيە");
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("4");
  await page.evaluate(() => { window.__kutadguCountryMode = "throw"; });
  await page.locator("#analyticsRange").selectOption("7");
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("گېرمانىيە");
  await expect(page.locator("#analyticsMeta")).toContainText("يەنىلا ئاخىرقى 30 كۈن");
  await expect(page.locator("#analyticsVisitCountryStatus")).not.toContainText("يۈكلىنىۋاتىدۇ");
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("سانىلىدىغان زىيارەت 0");
  await page.evaluate(() => { window.__kutadguCountryMode = "ok"; });
  await page.locator("#reloadAnalytics").click();
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("ياپونىيە");
  expect(await page.evaluate(() => window.__kutadguUnhandled)).toEqual([]);
  expect(unhandled).toEqual([]);
});

async function installCountryAdmin(page) {
  await page.addInitScript(() => {
    const now = Math.floor(Date.now() / 1000);
    function sessionFor(user) {
      return {
        access_token: "access-" + user.id,
        refresh_token: "refresh-" + user.id,
        expires_at: now + 3600,
        user
      };
    }
    window.__kutadguAuthCalls = { signOut: 0 };
    window.__kutadguAllowAdmin = true;
    window.__kutadguHoldNext = false;
    window.__kutadguReleaseHeld = null;
    window.__kutadguSignOutImpl = null;
    window.__kutadguMockSession = sessionFor({ id: "admin-a", email: "a@example.com" });
    window.__kutadguCountryByUser = { "admin-a": "TR", "admin-b": "FR" };
    window.__kutadguMfaApi = {
      async listFactors() {
        return { data: { all: [], totp: [], phone: [] }, error: null };
      },
      async getAuthenticatorAssuranceLevel() {
        return { data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null };
      }
    };
    function chain(result) {
      const q = {};
      ["select", "eq", "in", "or", "order", "range", "is", "limit", "gte", "lte", "neq"].forEach((method) => {
        q[method] = () => q;
      });
      q.update = async () => result;
      q.insert = async () => result;
      q.delete = async () => result;
      q.maybeSingle = async () => result;
      q.single = async () => result;
      q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return q;
    }
    function analyticsPayload(code, visits) {
      return {
        page_views: 2,
        book_views: 1,
        cart_adds: 0,
        whatsapp_clicks: 0,
        top_books: [],
        zero_searches: [],
        visit_countries: {
          status: "complete",
          countries: [{ code, visits }],
          unknown_visits: 0,
          latest: [{ country: code, counted_at: "2026-10-08T10:00:00Z" }]
        }
      };
    }
    function wrapClient() {
      return {
        auth: {
          initialize: async () => {},
          getSession: async () => ({ data: { session: window.__kutadguMockSession }, error: null }),
          getUser: async () => ({
            data: { user: window.__kutadguMockSession && window.__kutadguMockSession.user },
            error: window.__kutadguMockSession ? null : { name: "AuthSessionMissingError", message: "Auth session missing" }
          }),
          refreshSession: async () => ({
            data: { session: window.__kutadguMockSession, user: window.__kutadguMockSession && window.__kutadguMockSession.user },
            error: null
          }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => {
            window.__kutadguAuthCalls.signOut += 1;
            if (window.__kutadguSignOutImpl) return window.__kutadguSignOutImpl();
            window.__kutadguMockSession = null;
            return { error: null };
          },
          signInWithPassword: async () => ({ error: null }),
          mfa: window.__kutadguMfaApi
        },
        from(table) {
          if (table === "admin_users") {
            const user = window.__kutadguMockSession && window.__kutadguMockSession.user;
            return chain(window.__kutadguAllowAdmin && user
              ? { data: { user_id: user.id }, error: null, count: 1 }
              : { data: null, error: null, count: 0 });
          }
          return chain({ data: [], error: null, count: 0 });
        },
        rpc(name) {
          if (name !== "get_kutadgu_analytics") {
            return Promise.resolve({ data: null, error: { message: "يوق", code: "PGRST202" } });
          }
          if (window.__kutadguHoldNext) {
            window.__kutadguHoldNext = false;
            return new Promise((resolve) => {
              window.__kutadguReleaseHeld = () => resolve({
                data: analyticsPayload("JP", 9),
                error: null
              });
            });
          }
          const id = window.__kutadguMockSession && window.__kutadguMockSession.user && window.__kutadguMockSession.user.id;
          const code = window.__kutadguCountryByUser[id] || "TR";
          return Promise.resolve({ data: analyticsPayload(code, code === "FR" ? 2 : 4), error: null });
        },
        storage: { from() { return { upload: async () => ({ error: null }), getPublicUrl() { return { data: { publicUrl: "" } }; } }; } }
      };
    }
    let supabaseValue;
    Object.defineProperty(window, "supabase", {
      configurable: true,
      enumerable: true,
      get() { return supabaseValue; },
      set(value) {
        if (value && typeof value.createClient === "function") {
          value.createClient = function () { return wrapClient(); };
        }
        supabaseValue = value;
      }
    });
  });
}

async function openCountryAdmin(page) {
  await installCountryAdmin(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  const select = page.locator("#adminSectionSelect");
  if (await select.isVisible()) await select.selectOption("insights");
  else await page.locator('[data-admin-section="insights"]').click();
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("تۈركىيە");
}

async function showInsights(page) {
  const select = page.locator("#adminSectionSelect");
  if (await select.isVisible()) await select.selectOption("insights");
  else if (await page.locator('[data-admin-section="insights"]').isVisible()) {
    await page.locator('[data-admin-section="insights"]').click();
  }
}

async function holdNextCountryRead(page) {
  await page.evaluate(() => {
    window.__kutadguReleaseHeld = null;
    window.__kutadguHoldNext = true;
  });
  await page.locator("#reloadAnalytics").click();
  await page.waitForFunction(() => typeof window.__kutadguReleaseHeld === "function");
}

test("session loss, account switch, and logout drop an in-flight country read", async ({ page }) => {
  await openCountryAdmin(page);
  await holdNextCountryRead(page);
  await page.evaluate(() => { window.__kutadguMockSession = null; });
  await page.evaluate(() => window.__kutadguAdminTest.routeSession());
  await expect(page.locator("#loginPanel")).toBeVisible();
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("تۈركىيە");
  await page.evaluate(() => window.__kutadguReleaseHeld());
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("ياپونىيە");
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("تۈركىيە");

  await page.evaluate(() => {
    window.__kutadguMockSession = {
      access_token: "access-admin-a",
      refresh_token: "refresh-admin-a",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "admin-a", email: "a@example.com" }
    };
    window.__kutadguAllowAdmin = true;
  });
  await page.evaluate(() => window.__kutadguAdminTest.routeSession());
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await showInsights(page);
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("تۈركىيە");
  await holdNextCountryRead(page);
  await page.evaluate(() => {
    window.__kutadguMockSession = {
      access_token: "access-admin-b",
      refresh_token: "refresh-admin-b",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "admin-b", email: "b@example.com" }
    };
  });
  await page.evaluate(() => window.__kutadguAdminTest.routeSession());
  await showInsights(page);
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("فرانسىيە");
  await page.evaluate(() => window.__kutadguReleaseHeld());
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("فرانسىيە");
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("ياپونىيە");
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("تۈركىيە");

  await holdNextCountryRead(page);
  await page.evaluate(() => { window.__kutadguAllowAdmin = false; });
  await page.evaluate(() => window.__kutadguAdminTest.routeSession());
  await expect(page.locator("#loginStatus")).toHaveText("بۇ ھېسابات Admin ھېسابى ئەمەس.");
  expect(await page.evaluate(() => window.__kutadguAuthCalls.signOut)).toBe(0);
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("فرانسىيە");
  await page.evaluate(() => window.__kutadguReleaseHeld());
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("ياپونىيە");

  await page.evaluate(() => {
    window.__kutadguAllowAdmin = true;
    window.__kutadguMockSession = {
      access_token: "access-admin-a",
      refresh_token: "refresh-admin-a",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "admin-a", email: "a@example.com" }
    };
  });
  await page.evaluate(() => window.__kutadguAdminTest.routeSession());
  await showInsights(page);
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("تۈركىيە");
  await holdNextCountryRead(page);
  await page.evaluate(() => {
    window.__kutadguSignOutImpl = () => new Promise((resolve) => {
      window.__kutadguFinishSignOut = () => {
        window.__kutadguMockSession = null;
        resolve({ error: null });
      };
    });
  });
  const logoutClick = page.locator("#adminLogout").click();
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("تۈركىيە");
  await page.evaluate(() => window.__kutadguReleaseHeld());
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("ياپونىيە");
  expect(await page.evaluate(() => window.__kutadguAuthCalls.signOut)).toBe(1);
  await page.evaluate(() => window.__kutadguFinishSignOut());
  await logoutClick;
  await expect(page.locator("#loginPanel")).toBeVisible();

  await page.evaluate(() => {
    window.__kutadguMockSession = {
      access_token: "access-admin-a",
      refresh_token: "refresh-admin-a",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "admin-a", email: "a@example.com" }
    };
    window.__kutadguSignOutImpl = () => Promise.reject(new Error("چېكىنىش مەغلۇپ"));
  });
  await page.evaluate(() => window.__kutadguAdminTest.routeSession());
  await expect(page.locator("#analyticsVisitCountryTotals")).toContainText("تۈركىيە");
  await page.locator("#adminLogout").click();
  await expect(page.locator("#loginPanel")).toBeVisible();
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("تۈركىيە");
  await expect(page.locator("#analyticsVisitCountryTotals")).not.toContainText("ياپونىيە");
});
