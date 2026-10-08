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
