const { test, expect } = require("./playwright-test");
const H = require("./helpers");

function malformedBookPaths(pathname) {
  return /^\/book\/.+\.html$/i.test(String(pathname || ""));
}

async function collectedNavPaths(page) {
  return page.evaluate(() => {
    const resolveApp = window.kutadguShop && window.kutadguShop.storefrontAppHref;
    const nodes = [...document.querySelectorAll("a[href], [data-kutadgu-nav], .member-account-button")];
    return nodes.map((el) => {
      const nav = String(el.getAttribute("data-kutadgu-nav") || "").trim();
      const href = String(el.getAttribute("href") || "").trim();
      let raw = href;
      if (nav && resolveApp) raw = resolveApp(nav, href || "/");
      else if (!raw && nav && resolveApp) raw = resolveApp(nav, "/");
      if (!raw) return "";
      try {
        return new URL(raw, location.origin).pathname;
      } catch (err) {
        return raw;
      }
    }).filter(Boolean);
  });
}

async function clickVisibleRootNav(page, pageFile) {
  const href = `/${pageFile}`;
  const clicked = await page.evaluate((file) => {
    const rootHref = `/${file}`;
    const candidates = [
      ...document.querySelectorAll(`a[href="${rootHref}"]`),
      ...document.querySelectorAll(`a[href="${file}"]`),
      ...document.querySelectorAll(`.shop-float-btn[data-kutadgu-nav="${file}"]`)
    ];
    if (file === "cart.html") candidates.push(...document.querySelectorAll(".mobile-header-cart"));
    const visible = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
    });
    if (!visible) return false;
    if (typeof visible.click === "function") visible.click();
    return true;
  }, pageFile);
  expect(clicked, `visible ${href} navigation`).toBe(true);
}

test.describe("book detail Google entry navigation", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("direct /book/:id add-to-cart then cart nav lands on /cart.html", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await H.clearShopStorage(page);
    await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    expect(new URL(page.url()).pathname).toBe(`/book/${book.id}`);
    await page.locator(".detail-main-cart").click();
    await expect.poll(async () => H.badgeCount(page)).toBeGreaterThan(0);
    const stored = await H.readCart(page);
    expect(stored.some((row) => String(row.id) === String(book.id))).toBe(true);

    const paths = await collectedNavPaths(page);
    expect(paths.some(malformedBookPaths), paths.filter(malformedBookPaths).join(",")).toBeFalsy();

    await clickVisibleRootNav(page, "cart.html");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/cart.html");
    expect(page.url()).not.toMatch(/\/book\/cart\.html/);
    await H.waitForHydratedCartTitle(page, book.title);
    await expect(page.locator("#cartItems .cart-title")).toContainText(book.title);
  });

  test("direct /book/:id category CTA reaches a root listing, not /book/*.html", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    const cta = page.locator("a.detail-section-link", { hasText: "بۇ بۆلۈمدىكى كىتابلار" });
    await expect(cta).toBeVisible({ timeout: 20_000 });
    const href = await cta.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href.startsWith("/book/")).toBeFalsy();
    expect(href).not.toMatch(/book\.html/);
    await cta.click();
    await expect.poll(() => new URL(page.url()).pathname.startsWith("/book/")).toBeFalsy();
    expect(new URL(page.url()).pathname).not.toMatch(/book\.html/);
    await expect(page.locator(".books-grid .book-card, .books-grid .book-card.is-skeleton, #books .book-card, .shop-grid .book-card").first()).toBeVisible({ timeout: 20_000 });
  });

  test("favorites and account from /book/:id stay on root pages", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    await clickVisibleRootNav(page, "favorites.html");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/favorites.html");
    expect(page.url()).not.toMatch(/\/book\/favorites\.html/);

    await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    await clickVisibleRootNav(page, "account.html");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/account.html");
    expect(page.url()).not.toMatch(/\/book\/account\.html/);
  });

  for (const width of [390, 412, 768, 1280]) {
    test(`viewport ${width} keeps cart/favorites/account root-safe from /book/:id`, async ({ page }) => {
      test.setTimeout(45_000);
      const book = await H.discoverLiveBook(page);
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
      await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
      await H.waitForDetailTitle(page, book.title);
      const paths = await collectedNavPaths(page);
      expect(paths.some((p) => p === "/book/cart.html" || p === "/book/favorites.html" || p === "/book/account.html")).toBeFalsy();
      if (width <= 768) {
        await expect(page.locator('.mobile-bottom-nav a[href="/cart.html"]')).toBeVisible();
        await expect(page.locator('.mobile-bottom-nav a[href="/favorites.html"]')).toBeVisible();
        await expect(page.locator('.mobile-bottom-nav a[href="/account.html"]')).toBeVisible();
      } else {
        await expect(page.locator('a[href="/cart.html"]').first()).toBeVisible();
        await expect(page.locator('a[href="/favorites.html"]').first()).toBeVisible();
        await expect(page.locator('a[href="/account.html"]').first()).toBeVisible();
      }
    });
  }
});

test.describe("book detail Google entry related books", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  async function discoverSameCategoryPair(page) {
    const setup = await page.context().newPage();
    await H.installReadSafeNetwork(setup);
    await H.openFresh(setup, "/");
    const pair = await setup.evaluate(async () => {
      const shop = window.kutadguShop;
      const first = await shop.queryCatalog({ pageSize: 24, sort: "new" });
      const visible = (first.items || []).filter((b) => b && shop.isStorefrontVisible(b) && String(b.category || "").trim());
      for (const book of visible) {
        const listing = await shop.queryCatalog({ category: book.category, pageSize: 16, sort: "new" });
        const others = (listing.items || []).filter((item) => {
          if (!item || !shop.isStorefrontVisible(item)) return false;
          if (String(item.id) === String(book.id)) return false;
          return String(item.category || "").trim() === String(book.category || "").trim();
        });
        if (others.length) {
          return {
            id: String(book.id),
            title: book.title,
            category: String(book.category).trim(),
            otherId: String(others[0].id)
          };
        }
      }
      return null;
    });
    await setup.close();
    return pair;
  }

  async function waitForDetailRelatedSettled(page) {
    await page.waitForFunction(() => Array.isArray(window.KUTADGU_LIVE_CATALOG), null, { timeout: 20_000 });
    await expect.poll(async () => page.locator("[data-detail-related], .book-detail-info h1").count()).toBeGreaterThan(0);
  }

  test("fresh direct /book/:id loads same-category related books without homepage navigation", async ({ page }) => {
    const pair = await discoverSameCategoryPair(page);
    expect(pair && pair.id, "need two live books in one category").toBeTruthy();
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("kutadgu-cart-v1");
        localStorage.removeItem("kutadgu-cart-display-v1");
        localStorage.removeItem("kutadgu-favorites-v1");
        localStorage.removeItem("kutadgu-recent-v1");
        localStorage.removeItem("kutadgu-customer-v1");
        localStorage.removeItem("kutadgu-shop-owner-v1");
      } catch (err) {}
    });
    let categoryQueries = 0;
    await page.route("**/rest/v1/books**", async (route) => {
      const url = route.request().url();
      if (url.includes("category=eq.")) categoryQueries += 1;
      return route.fallback();
    });
    await page.goto(`/book/${pair.id}`, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe(`/book/${pair.id}`);
    await H.waitForDetailTitle(page, pair.title);
    const grid = page.locator("[data-detail-related] .detail-related-grid .shop-mini-card");
    await expect(grid.first()).toBeVisible({ timeout: 20_000 });
    const related = await page.evaluate((current) => {
      const shop = window.kutadguShop;
      const ids = [...document.querySelectorAll("[data-detail-related] [data-fav-id]")].map((el) => String(el.getAttribute("data-fav-id") || ""));
      return ids.map((id) => {
        const book = shop.find(id);
        return { id, category: book ? String(book.category || "").trim() : "" };
      }).concat([{ currentId: String(current.id), currentCategory: String(current.category || "").trim() }]);
    }, pair);
    const current = related.pop();
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(4);
    expect(related.some((row) => row.id === current.currentId)).toBeFalsy();
    expect(related.every((row) => row.category === current.currentCategory)).toBeTruthy();
    expect(categoryQueries).toBe(1);
  });

  test("related query failure does not fill Similar Books from another category", async ({ page }) => {
    const pair = await discoverSameCategoryPair(page);
    expect(pair && pair.id).toBeTruthy();
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("kutadgu-cart-v1");
        localStorage.removeItem("kutadgu-favorites-v1");
        localStorage.removeItem("kutadgu-recent-v1");
      } catch (err) {}
    });
    await page.route("**/rest/v1/books**", async (route) => {
      if (route.request().url().includes("category=eq.")) {
        return route.fulfill({ status: 500, contentType: "application/json", body: "{\"message\":\"related query failed\"}" });
      }
      return route.fallback();
    });
    await page.goto(`/book/${pair.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, pair.title);
    await waitForDetailRelatedSettled(page);
    const cards = page.locator("[data-detail-related] .detail-related-grid .shop-mini-card");
    await expect(cards).toHaveCount(0);
    await expect(page.locator("[data-detail-related] h2", { hasText: "ئوخشاش كىتابلار" })).toHaveCount(0);
  });

  test("zero other same-category matches hide Similar Books instead of inventing cards", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("kutadgu-cart-v1");
        localStorage.removeItem("kutadgu-favorites-v1");
        localStorage.removeItem("kutadgu-recent-v1");
      } catch (err) {}
    });
    await page.route("**/rest/v1/books**", async (route) => {
      if (route.request().url().includes("category=eq.")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "*/0" },
          body: "[]"
        });
      }
      return route.fallback();
    });
    await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    await waitForDetailRelatedSettled(page);
    await expect(page.locator("[data-detail-related] .detail-related-grid .shop-mini-card")).toHaveCount(0);
    await expect(page.locator("[data-detail-related] h2", { hasText: "ئوخشاش كىتابلار" })).toHaveCount(0);
  });

  test("recommendations feature flag disables related query and Similar Books", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await page.route("**/app-config.js**", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace("recommendations:true", "recommendations:false");
      return route.fulfill({ response: res, body, contentType: "text/javascript; charset=utf-8" });
    });
    let categoryQueries = 0;
    await page.route("**/rest/v1/books**", async (route) => {
      if (route.request().url().includes("category=eq.")) categoryQueries += 1;
      return route.fallback();
    });
    await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    await page.waitForFunction(() => Array.isArray(window.KUTADGU_LIVE_CATALOG), null, { timeout: 20_000 });
    await expect(page.locator("h2", { hasText: "ئوخشاش كىتابلار" })).toHaveCount(0);
    await expect(page.locator("[data-detail-related]")).toHaveCount(0);
    expect(categoryQueries).toBe(0);
  });
});
