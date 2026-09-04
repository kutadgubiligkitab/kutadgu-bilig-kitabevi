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
