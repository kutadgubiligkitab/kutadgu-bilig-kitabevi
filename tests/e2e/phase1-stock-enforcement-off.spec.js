const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const ZERO_ID = "91010";
const ONE_ID = "91011";
const THREE_ID = "91012";
const FOUR_ID = "91013";
const NULL_ID = "91014";
const INACTIVE_ID = "91015";

function bookRow(overrides = {}) {
  return {
    id: Number(ZERO_ID),
    title: "ئامبار سىناق كىتابى",
    author: "رەسمىي ئاپتور",
    price: 88,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 0,
    sales_count: 1,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

const BOOKS = [
  bookRow({ id: Number(ZERO_ID), title: "ئامبار نۆل كىتاب", stock: 0 }),
  bookRow({ id: Number(ONE_ID), title: "ئامبار بىر كىتاب", stock: 1 }),
  bookRow({ id: Number(THREE_ID), title: "ئامبار ئۈچ كىتاب", stock: 3 }),
  bookRow({ id: Number(FOUR_ID), title: "ئامبار تۆت كىتاب", stock: 4 }),
  bookRow({ id: Number(NULL_ID), title: "ئامبار تەڭشەلمىگەن كىتاب", stock: null }),
  bookRow({ id: Number(INACTIVE_ID), title: "يوشۇرۇلغان كىتاب", stock: 8, is_active: false })
];

async function mockBooks(page, books = BOOKS) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes("is_active=eq.false")) {
      const inactive = books.filter((row) => row.is_active === false);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `*/${inactive.length}` },
        body: JSON.stringify(inactive.map((row) => ({ id: row.id, legacy_id: row.legacy_id || null })))
      });
    }
    const parsed = new URL(url);
    let filtered = books.filter((row) => row.is_active !== false);
    const idParam = parsed.searchParams.get("id") || "";
    const legacyParam = parsed.searchParams.get("legacy_id") || "";
    const orParam = parsed.searchParams.get("or") || "";
    const wanted = [];
    const collect = (raw) => {
      const text = decodeURIComponent(String(raw || ""));
      const inMatch = text.match(/in\.\(([^)]*)\)/i);
      if (inMatch) {
        inMatch[1].split(",").forEach((part) => {
          const id = part.replace(/^"+|"+$/g, "").trim();
          if (id) wanted.push(id);
        });
      }
      const eqMatch = text.match(/eq\.([^,&)]+)/i);
      if (eqMatch) wanted.push(eqMatch[1].replace(/^"+|"+$/g, "").trim());
    };
    collect(idParam);
    collect(legacyParam);
    collect(orParam);
    if (wanted.length) {
      const set = new Set(wanted.map(String));
      filtered = books.filter((row) => set.has(String(row.id)) || set.has(String(row.legacy_id || "")));
    }
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${filtered.length}` },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` },
      body: JSON.stringify(filtered)
    });
  });
}

async function openBook(page, id, title) {
  await page.goto(`/book/${id}`, { waitUntil: "domcontentloaded" });
  await H.waitForShop(page);
  await H.waitForDetailTitle(page, title);
}

test.describe("Phase 1 storefront stock enforcement stays off", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("production gate is off and stock values do not change buy/qty/badge", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const state = await page.evaluate(() => {
      const shop = window.kutadguShop;
      const samples = [null, 0, 1, 3, 4].map((qty) => shop.stockInfo({
        id: "1",
        stock: qty,
        isActive: true,
        isRemote: true
      }));
      return {
        enforcement: shop.isStockEnforcementEnabled(),
        config: window.KUTADGU_STOCK_ENFORCEMENT,
        flag: !!(window.KUTADGU_APP_CONFIG && window.KUTADGU_APP_CONFIG.featureFlags && window.KUTADGU_APP_CONFIG.featureFlags.stockEnforcement),
        samples
      };
    });
    expect(state.enforcement).toBe(false);
    expect(state.config).toBe(false);
    expect(state.flag).toBe(false);
    for (const info of state.samples) {
      expect(info.canBuy).toBe(true);
      expect(info.qty).toBeNull();
      expect(info.key).toBe("unknown");
      expect(info.label).toBe("");
    }
  });

  test("stock 0 does not disable Add to Cart", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await openBook(page, ZERO_ID, "ئامبار نۆل كىتاب");
    const cartBtn = page.locator(".detail-main-cart");
    await expect(cartBtn).toBeVisible();
    await expect(cartBtn).toBeEnabled();
    await expect(cartBtn).not.toHaveAttribute("aria-disabled", "true");
    await expect(cartBtn).toHaveText(/سېۋەتكە/);
    await expect(page.locator(".stock-badge")).toHaveCount(0);
    await cartBtn.click();
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    const cart = await H.readCart(page);
    expect(String(cart[0].id)).toBe(ZERO_ID);
    expect(Number(cart[0].qty)).toBe(1);
  });

  test("stock 1 and 3 do not cap cart quantity", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await openBook(page, ONE_ID, "ئامبار بىر كىتاب");
    await page.locator(".detail-main-cart").click();
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, "ئامبار بىر كىتاب");
    await expect(page.locator("#cartItems [data-plus]")).toBeEnabled();
    await page.locator("#cartItems [data-plus]").click();
    await page.locator("#cartItems [data-plus]").click();
    await expect.poll(async () => Number((await H.readCart(page))[0]?.qty)).toBe(3);

    await H.clearShopStorage(page);
    await openBook(page, THREE_ID, "ئامبار ئۈچ كىتاب");
    await page.locator(".detail-main-cart").click();
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, "ئامبار ئۈچ كىتاب");
    await expect(page.locator("#cartItems [data-plus]")).toBeEnabled();
    for (let i = 0; i < 4; i++) await page.locator("#cartItems [data-plus]").click();
    await expect.poll(async () => Number((await H.readCart(page))[0]?.qty)).toBe(5);
  });

  test("inactive and static-demo protections still block", async ({ page }) => {
    await page.addInitScript(() => {
      window.KUTADGU_REQUIRE_REMOTE_PRODUCT_AUTHORITY = true;
    });
    await mockBooks(page);
    await page.goto(`/book/${INACTIVE_ID}`, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(".detail-unavailable-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".detail-main-cart")).toHaveCount(0);

    const visibility = await page.evaluate(() => {
      const vis = window.kutadguShop.isStorefrontVisible;
      return {
        inactive: vis({ id: "91015", isActive: false, isRemote: true }),
        demo: vis({ id: "romanlar-2", isActive: true, isRemote: false }),
        activeRemote: vis({ id: "91010", isActive: true, isRemote: true })
      };
    });
    expect(visibility.inactive).toBe(false);
    expect(visibility.demo).toBe(false);
    expect(visibility.activeRemote).toBe(true);

    await page.goto("/book/romanlar-2", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(".detail-unavailable-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".detail-main-cart")).toHaveCount(0);
  });
});
