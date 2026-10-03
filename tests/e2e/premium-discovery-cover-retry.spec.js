const { test, expect } = require("./playwright-test");
const fs = require("fs");
const path = require("path");
const H = require("./helpers");

const LOGO = fs.readFileSync(path.join(__dirname, "..", "..", "kutadgu-logo.png"));
const AUTHOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHOR_NAME = "تارىخ ئاپتورى";
const HISTORY_CATEGORY = "تارىخىي رومانلار";
const RELIGION_CATEGORY = "دىنىي كىتابلار";
const PROBE = "/premium-discovery-cover-probe.png";
const RELIGION_COVER = "/kutadgu-logo.png";

function bookRow(overrides) {
  return {
    id: 88001,
    title: "تارىخ مۇقاۋا سىنىقى",
    author: AUTHOR_NAME,
    price: 42,
    category: HISTORY_CATEGORY,
    image_url: PROBE,
    is_active: true,
    stock: 4,
    stock_status: "in_stock",
    created_at: "2026-08-01T00:00:00Z",
    credits: [{
      role: "author",
      position: 0,
      identity_id: AUTHOR_ID,
      catalog_identities: { id: AUTHOR_ID, display_name: AUTHOR_NAME }
    }],
    ...overrides
  };
}

function religionRow() {
  return bookRow({
    id: 88011,
    title: "دىنىي مۇقاۋا سىنىقى",
    author: "دىنىي ئاپتور",
    category: RELIGION_CATEGORY,
    image_url: RELIGION_COVER,
    credits: []
  });
}

async function mockBooks(page, books) {
  await page.route("**/rest/v1/book_credits**", async (route) => {
    const url = new URL(route.request().url());
    const bookId = String(url.searchParams.get("book_id") || "").replace(/^eq\./, "");
    const row = books.find((item) => String(item.id) === bookId);
    const credits = row && Array.isArray(row.credits) ? row.credits : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(credits)
    });
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.searchParams.get("is_active") === "eq.false") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0" },
        body: "[]"
      });
    }
    if (req.method() === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `0-0/${Math.max(books.length, 1)}` },
        body: ""
      });
    }
    const category = String(url.searchParams.get("category") || "").replace(/^eq\./, "");
    const idFilter = String(url.searchParams.get("id") || "");
    let rows = [];
    if (category) rows = books.filter((row) => row.category === category);
    if (idFilter.startsWith("eq.")) rows = books.filter((row) => String(row.id) === idFilter.slice(3));
    if (idFilter.startsWith("in.(")) {
      const ids = idFilter.slice(4, -1).split(",");
      rows = ids.map((id) => books.find((row) => String(row.id) === id)).filter(Boolean);
    }
    const payload = rows.map((row) => {
      const copy = { ...row };
      delete copy.credits;
      return copy;
    });
    const range = String(req.headers().range || req.headers().Range || "");
    const match = range.match(/(\d+)-(\d+)/);
    const from = match ? Number(match[1]) : 0;
    const to = match ? Number(match[2]) : Math.max(payload.length - 1, 0);
    const slice = payload.slice(from, to + 1);
    const last = slice.length ? from + slice.length - 1 : from;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": slice.length ? `${from}-${last}/${payload.length}` : "*/0" },
      body: JSON.stringify(slice)
    });
  });
}

function installProbe(page, initialMode) {
  const hits = { n: 0 };
  const state = { mode: initialMode, release: null };
  const ready = page.route(`**${PROBE}`, async (route) => {
    hits.n += 1;
    if (state.mode === "always-fail") return route.abort("failed");
    if (state.mode === "fail-first" && hits.n === 1) return route.abort("failed");
    if (state.mode === "fail-then-hold") {
      if (hits.n === 1) return route.abort("failed");
      await new Promise((resolve) => { state.release = resolve; });
      return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
  });
  return ready.then(() => ({
    hits,
    setMode(mode) { state.mode = mode; },
    release() { if (state.release) state.release(); }
  }));
}

async function boot(page, books, mode, viewport) {
  await page.setViewportSize(viewport);
  await H.installReadSafeNetwork(page);
  await mockBooks(page, books);
  const probe = await installProbe(page, mode);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#premiumDiscovery [data-premium-group="history"]', { timeout: 45_000 });
  return probe;
}

async function showGroup(page, id) {
  await page.locator(`#premiumDiscovery [data-premium-group="${id}"]`).click();
  await page.locator("#premiumDiscoveryResults").scrollIntoViewIfNeeded();
}

async function cardImageWidth(page, bookId) {
  return page.locator(`#premiumDiscoveryResults [data-premium-book-id="${bookId}"] img`).evaluate((img) => img.naturalWidth || 0).catch(() => 0);
}

const VIEWPORTS = [{ width: 390, height: 800 }, { width: 1280, height: 900 }];

test.describe("premium discovery cover retry", () => {
  for (const viewport of VIEWPORTS) {
    test(`injected transient image failure recovers on the History cards without reload at ${viewport.width}`, async ({ page }) => {
      const probe = await boot(page, [bookRow()], "fail-first", viewport);
      await showGroup(page, "history");
      await expect(page.locator('#premiumDiscoveryResults [data-premium-book-id="88001"]')).toBeVisible();
      await expect.poll(() => cardImageWidth(page, "88001"), { timeout: 8_000 }).toBeGreaterThan(0);
      await expect(page.locator('#premiumDiscoveryResults [data-premium-book-id="88001"] .book-cover-unavailable')).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe("/");
      expect(probe.hits.n).toBeGreaterThanOrEqual(2);
      expect(probe.hits.n).toBeLessThanOrEqual(3);
    });
  }

  for (const viewport of VIEWPORTS) {
  test(`injected cached image failure during binding recovers on the History cards at ${viewport.width}`, async ({ page }) => {
    const probe = await boot(page, [bookRow()], "always-fail", viewport);
    await page.evaluate((src) => new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve("error");
      img.onload = () => resolve("load");
      img.src = src;
    }), PROBE);
    expect(probe.hits.n).toBeGreaterThanOrEqual(1);
    probe.setMode("ok");
    await page.evaluate(() => {
      const shop = window.kutadguShop;
      const fail = shop.handleCoverError.bind(shop);
      window.__premiumCoverTrace = [];
      shop.handleCoverError = (img) => {
        const stack = new Error().stack || "";
        window.__premiumCoverTrace.push({
          fromRecover: stack.includes("recoverCachedCoverFailure"),
          complete: !!(img && img.complete),
          width: img && img.naturalWidth || 0,
          connected: !!(img && img.isConnected !== false)
        });
        return fail(img);
      };
    });
    const before = probe.hits.n;
    await showGroup(page, "history");
    await expect.poll(() => cardImageWidth(page, "88001"), { timeout: 8_000 }).toBeGreaterThan(0);
    await expect(page.locator('#premiumDiscoveryResults [data-premium-book-id="88001"] .book-cover-unavailable')).toHaveCount(0);
    const trace = await page.evaluate(() => window.__premiumCoverTrace || []);
    expect(trace.some((entry) => entry.fromRecover && entry.complete && entry.width === 0 && entry.connected)).toBe(true);
    expect(probe.hits.n).toBeGreaterThan(before);
  });
  }

  for (const viewport of VIEWPORTS) {
  test(`injected permanent image failure stops at the existing retry limit at ${viewport.width}`, async ({ page }) => {
    const probe = await boot(page, [bookRow()], "always-fail", viewport);
    await showGroup(page, "history");
    await expect(page.locator('#premiumDiscoveryResults [data-premium-book-id="88001"] .book-cover-unavailable')).toBeVisible({ timeout: 8_000 });
    const after = probe.hits.n;
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(3);
    await page.waitForTimeout(1600);
    expect(probe.hits.n).toBe(after);
    await expect(page.locator('#premiumDiscoveryResults [data-premium-book-id="88001"] strong')).toHaveText("تارىخ مۇقاۋا سىنىقى");
  });
  }

  for (const viewport of VIEWPORTS) {
    test(`injected pending retry cannot change cards after the group switches at ${viewport.width}`, async ({ page }) => {
      const books = [bookRow(), religionRow()];
      const probe = await boot(page, books, "fail-then-hold", viewport);
      await showGroup(page, "history");
      await expect(page.locator('#premiumDiscoveryResults [data-premium-book-id="88001"] img.is-cover-retrying')).toBeVisible({ timeout: 8_000 });
      await showGroup(page, "religion");
      await expect(page.locator('#premiumDiscoveryResults [data-premium-book-id="88011"]')).toBeVisible();
      await expect.poll(() => cardImageWidth(page, "88011"), { timeout: 8_000 }).toBeGreaterThan(0);
      const beforeRelease = await page.locator("#premiumDiscoveryResults [data-premium-book-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-premium-book-id")));
      expect(beforeRelease).toEqual(["88011"]);
      probe.release();
      await page.waitForTimeout(1600);
      const afterRelease = await page.locator("#premiumDiscoveryResults [data-premium-book-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-premium-book-id")));
      expect(afterRelease).toEqual(["88011"]);
      await expect.poll(() => cardImageWidth(page, "88011")).toBeGreaterThan(0);
      await expect(page.locator("#premiumDiscoveryResults .book-cover-unavailable")).toHaveCount(0);
      const src = await page.locator('#premiumDiscoveryResults [data-premium-book-id="88011"] img').evaluate((img) => img.currentSrc || img.getAttribute("src") || "");
      expect(src).toContain("kutadgu-logo.png");
      expect(src).not.toContain("premium-discovery-cover-probe.png");
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`normal History cards keep covers, favorites, cart, and contributor links at ${viewport.width}`, async ({ page }) => {
      const books = [bookRow({ image_url: RELIGION_COVER })];
      await boot(page, books, "ok", viewport);
      await showGroup(page, "history");
      const card = page.locator('#premiumDiscoveryResults [data-premium-book-id="88001"]');
      await expect(card).toBeVisible();
      await expect.poll(() => cardImageWidth(page, "88001"), { timeout: 8_000 }).toBeGreaterThan(0);
      await expect(card.locator(".book-cover-unavailable")).toHaveCount(0);
      await expect(card.locator("small")).toHaveText(AUTHOR_NAME);
      await expect(card.locator("small a")).toHaveCount(0);
      await expect(card.locator("a.premium-card-link")).toHaveAttribute("href", "/book/88001");
      const favorite = card.locator("[data-premium-favorite='88001']");
      await favorite.click();
      await expect(favorite).toHaveAttribute("aria-pressed", "true");
      const favs = await H.readFavs(page);
      expect(favs.map(String)).toContain("88001");
      await card.locator("[data-premium-cart='88001']").click();
      await expect.poll(async () => {
        const cart = await H.readCart(page);
        return cart.some((item) => String(item.id) === "88001");
      }).toBe(true);
      await page.goto("/book-shell.html?id=88001", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.body.dataset.bookId === "88001");
      const link = page.locator(`a.book-credit-name[href="/author/${AUTHOR_ID}"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveText(AUTHOR_NAME);
    });
  }
});
