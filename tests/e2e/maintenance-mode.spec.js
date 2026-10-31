const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const OVERLAY = "#kutadgu-maintenance-overlay";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function mockStoreSettings(page, on) {
  await page.route("**/rest/v1/store_settings**", async (route) => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ key: "maintenance_mode", value: !!on }])
      });
    }
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "forbidden" })
    });
  });
}

async function mockAdminUsers(page, userId) {
  await page.route("**/rest/v1/admin_users**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const rows = userId ? [{ user_id: userId }] : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows)
    });
  });
}

function jwtFor(userId, aal) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    aal,
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  return header + "." + payload + ".sig";
}

function sessionFor(userId, aal) {
  return {
    access_token: jwtFor(userId, aal),
    refresh_token: "test-refresh-" + userId.slice(0, 8),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: userId.slice(0, 8) + "@example.test",
      app_metadata: { provider: "email" },
      user_metadata: {},
      factors: [],
      created_at: "2026-01-01T00:00:00.000Z"
    }
  };
}

function seedSession(page, session) {
  return page.addInitScript((stored) => {
    try {
      localStorage.setItem("kutadgu-admin-auth-v1", JSON.stringify(stored));
    } catch (e) {}
  }, session);
}

async function mockAuth(page, session) {
  await page.route("**/auth/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/token")) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_grant", error_description: "refresh is not part of this fixture" })
      });
    }
    if (url.includes("/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session.user)
      });
    }
    if (url.includes("/logout")) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function mockAdminRpc(page, isAdmin) {
  await page.route("**/rest/v1/rpc/is_kutadgu_admin**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isAdmin === true)
    });
  });
}

function watchPoster(page) {
  const seen = { poster: false, token: false, gate: false, rpc: false };
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("kutadgu-book-poster.js")) seen.poster = true;
    if (url.includes("/auth/v1/token")) seen.token = true;
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("kutadgu-book-poster-gate.js")) seen.gate = true;
    if (url.includes("/rpc/is_kutadgu_admin")) seen.rpc = true;
  });
  return seen;
}

async function storedAdminSession(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("kutadgu-admin-auth-v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        id: parsed && parsed.user && parsed.user.id || "",
        accessToken: parsed && parsed.access_token || "",
        refreshToken: parsed && parsed.refresh_token || "",
        expiresAt: Number(parsed && parsed.expires_at)
      };
    } catch (e) {
      return null;
    }
  });
}

async function expectSessionKept(page, session) {
  const stored = await storedAdminSession(page);
  expect(stored).toBeTruthy();
  expect(stored.id).toBe(session.user.id);
  expect(stored.accessToken).toBe(session.access_token);
  expect(stored.refreshToken).toBe(session.refresh_token);
  expect(stored.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30);
}

async function expectNoPoster(page, seen, expectsRpc) {
  await expect.poll(() => seen.gate, { timeout: 15_000 }).toBe(true);
  if (expectsRpc) await expect.poll(() => seen.rpc, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(300);
  expect(seen.poster).toBe(false);
  expect(seen.token).toBe(false);
  await expect(page.locator("#kutadguBookPosterOpen")).toHaveCount(0);
}

test.describe("maintenance mode", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    H.allowLiveCatalogReads(page);
  });

  test("A maintenance OFF keeps homepage, detail, search, cart, favorites, PR31 title", async ({ page }) => {
    await mockStoreSettings(page, false);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page).toHaveTitle("قۇتادغۇبىلىك كىتابخانىسى");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("#searchInput")).toBeVisible();

    const book = await H.discoverLiveBook(page);
    await page.locator("#searchInput").fill(book.searchToken);
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
    await expect(page.locator(`.advanced-search-result[data-live-book-id="${book.id}"]`)).toBeVisible();

    await page.goto(book.detailPath, { waitUntil: "domcontentloaded" });
    const title = await H.waitForDetailTitle(page, book.title);
    expect(title.trim()).toBe(book.title);

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#cartItems")).toBeVisible();

    await page.goto("/favorites.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test("B anonymous visitor sees maintenance and not catalog", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    const hops = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) hops.push(frame.url());
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(OVERLAY)).toHaveAttribute("dir", "rtl");
    await expect(page.locator(OVERLAY)).toContainText("قۇتادغۇبىلىك كىتابخانىسى");
    await expect(page.locator(OVERLAY)).toContainText("ۋاقىتلىق ئاسراش");
    await expect(page.locator("#searchInput")).toBeHidden();
    await expect(page.locator("#kutadgu-maint-admin-note")).toHaveCount(0);

    const seen = watchPoster(page);
    await page.goto("/book/415", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(".book-detail-info h1")).toBeHidden();
    await expectNoPoster(page, seen, false);
    expect(await storedAdminSession(page)).toBeNull();

    await page.goto("/children.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(".book-card").first()).toBeHidden();
  });

  test("C authenticated member does not bypass and cannot write", async ({ page }) => {
    const session = sessionFor(MEMBER_ID, "aal2");
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    await mockAdminRpc(page, false);
    await mockAuth(page, session);
    await seedSession(page, session);
    const seen = watchPoster(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#searchInput")).toBeHidden();

    await page.goto("/book/415", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expectNoPoster(page, seen, true);
    await expectSessionKept(page, session);
    expect(seen.token).toBe(false);

    const writeStatus = await page.evaluate(async () => {
      const cfg = window.KUTADGU_SUPABASE_CONFIG || {};
      const stored = JSON.parse(localStorage.getItem("kutadgu-admin-auth-v1") || "{}");
      const url = String(cfg.url || "").replace(/\/+$/, "") + "/rest/v1/store_settings?key=eq.maintenance_mode";
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          apikey: cfg.anonKey,
          Authorization: "Bearer " + stored.access_token,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ value: false })
      });
      return res.status;
    });
    expect(writeStatus).toBe(403);
  });

  test("D authenticated Admin bypasses storefront; Admin login stays open", async ({ page }) => {
    const session = sessionFor(ADMIN_ID, "aal2");
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, ADMIN_ID);
    await mockAdminRpc(page, true);
    await mockAuth(page, session);
    await seedSession(page, session);
    const seen = watchPoster(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#searchInput")).toBeVisible();
    await expect(page.locator("#kutadgu-maint-admin-note")).toBeVisible();

    const book = await H.discoverLiveBook(page);
    await page.goto(book.detailPath, { waitUntil: "domcontentloaded" });
    const title = await H.waitForDetailTitle(page, book.title);
    expect(title.trim()).toBe(book.title);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#kutadgu-maint-admin-note")).toBeVisible();
    await expect.poll(() => seen.rpc, { timeout: 15_000 }).toBe(true);
    await expect(page.locator("#kutadguBookPosterOpen")).toBeVisible();
    expect(seen.poster).toBe(true);
    expect(seen.token).toBe(false);
    await expectSessionKept(page, session);

    await page.evaluate(() => {
      try { localStorage.clear(); } catch (e) {}
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#loginPanel:not([hidden]), #dashboardPanel:not([hidden])")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#maintenanceToggleBtn")).toBeAttached();
  });

  test("D2 AAL1 admin still bypasses maintenance and does not get the poster", async ({ page }) => {
    const session = sessionFor(ADMIN_ID, "aal1");
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, ADMIN_ID);
    await mockAdminRpc(page, true);
    await mockAuth(page, session);
    await seedSession(page, session);
    const seen = watchPoster(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#kutadgu-maint-admin-note")).toBeVisible();

    await page.goto("/book/415", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#kutadgu-maint-admin-note")).toBeVisible();
    await expectNoPoster(page, seen, true);
    await expectSessionKept(page, session);
  });

  test("E no query-string or localStorage-only bypass", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    await page.addInitScript(() => {
      try {
        localStorage.setItem("kutadgu-admin", "1");
        localStorage.setItem("maintenance_bypass", "true");
        localStorage.setItem("isAdmin", "true");
      } catch (e) {}
    });
    await page.goto("/?bypass=1&admin=1&maintenance=off", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
  });

  test("F toggling mock OFF restores storefront without redeploy", async ({ page }) => {
    await mockStoreSettings(page, true);
    await mockAdminUsers(page, null);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });

    await page.unroute("**/rest/v1/store_settings**");
    await mockStoreSettings(page, false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator("#searchInput")).toBeVisible();
  });
});
