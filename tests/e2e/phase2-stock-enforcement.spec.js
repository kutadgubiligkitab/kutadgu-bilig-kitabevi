const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const ZERO_ID = "91010";
const ONE_ID = "91011";
const THREE_ID = "91012";
const FOUR_ID = "91013";
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
  bookRow({ id: Number(INACTIVE_ID), title: "يوشۇرۇلغان كىتاب", stock: 8, is_active: false })
];

async function mockBooks(page, books = BOOKS) {
  await H.stubNumericBookDocuments(page, books.map((row) => row.id));
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

test.describe("Phase 2 storefront stock enforcement", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("production gate is on and stock 0/1-3/4+ derive correctly", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const state = await page.evaluate(() => {
      const shop = window.kutadguShop;
      return {
        enforcement: shop.isStockEnforcementEnabled(),
        config: window.KUTADGU_STOCK_ENFORCEMENT,
        flag: !!(window.KUTADGU_APP_CONFIG && window.KUTADGU_APP_CONFIG.featureFlags && window.KUTADGU_APP_CONFIG.featureFlags.stockEnforcement),
        zero: shop.stockInfo({ stock: 0, isActive: true, isRemote: true }),
        one: shop.stockInfo({ stock: 1, isActive: true, isRemote: true }),
        three: shop.stockInfo({ stock: 3, isActive: true, isRemote: true }),
        four: shop.stockInfo({ stock: 4, isActive: true, isRemote: true })
      };
    });
    expect(state.enforcement).toBe(true);
    expect(state.config).toBe(true);
    expect(state.flag).toBe(true);
    expect(state.zero).toMatchObject({ canBuy: false, key: "out", qty: 0, label: "تۈگەپ كەتتى" });
    expect(state.one).toMatchObject({ canBuy: true, key: "low", qty: 1, label: "ئاز قالدى" });
    expect(state.three).toMatchObject({ canBuy: true, key: "low", qty: 3 });
    expect(state.four).toMatchObject({ canBuy: true, key: "in", qty: 4, label: "ئامباردا بار" });
  });

  test("stock 0 disables Add to Cart", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await openBook(page, ZERO_ID, "ئامبار نۆل كىتاب");
    const cartBtn = page.locator(".detail-main-cart");
    await expect(cartBtn).toBeVisible();
    await expect(cartBtn).toBeDisabled();
    await expect(cartBtn).toHaveAttribute("aria-disabled", "true");
    await expect(cartBtn).toHaveText(/تۈگەپ كەتتى/);
    await expect(page.locator(".detail-purchase-panel .stock-badge.stock-out")).toBeVisible();
  });

  test("stock 1 caps cart quantity", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await openBook(page, ONE_ID, "ئامبار بىر كىتاب");
    await expect(page.locator(".detail-purchase-panel .stock-badge.stock-low")).toBeVisible();
    await page.locator(".detail-main-cart").click();
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, "ئامبار بىر كىتاب");
    await expect(page.locator("#cartItems [data-plus]")).toBeDisabled();
    await page.locator("#cartItems [data-plus]").click({ force: true });
    await expect.poll(async () => Number((await H.readCart(page))[0]?.qty)).toBe(1);
  });

  test("stock 3 allows buy and caps at 3; stock 4 shows in-stock", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await openBook(page, THREE_ID, "ئامبار ئۈچ كىتاب");
    await page.locator(".detail-qty-plus").click();
    await page.locator(".detail-qty-plus").click();
    await page.locator(".detail-qty-plus").click();
    await page.locator(".detail-main-cart").click();
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, "ئامبار ئۈچ كىتاب");
    await expect.poll(async () => Number((await H.readCart(page))[0]?.qty)).toBe(3);
    await expect(page.locator("#cartItems [data-plus]")).toBeDisabled();

    await H.clearShopStorage(page);
    await openBook(page, FOUR_ID, "ئامبار تۆت كىتاب");
    await expect(page.locator(".detail-purchase-panel .stock-badge.stock-in")).toHaveCount(0);
    await expect(page.locator(".detail-purchase-panel")).not.toContainText("ئامباردا بار");
    await expect(page.locator(".detail-main-cart")).toBeEnabled();
    await expect(page.locator(".book-cover-box")).not.toHaveClass(/is-stock-out/);
  });

  test("stale cart qty above stock cannot build an order", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.evaluate(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "91011", qty: 9 }]));
    });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, "ئامبار بىر كىتاب");
    await expect.poll(async () => Number((await H.readCart(page))[0]?.qty)).toBe(1);
    const order = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(order).not.toBeNull();
    expect(order.items[0].qty).toBe(1);
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

    await page.goto("/book/romanlar-2", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(".detail-unavailable-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".detail-main-cart")).toHaveCount(0);
  });

  test("customer stock UX is silent in-stock, low, and out without exposing qty", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(`[data-live-book-id="${FOUR_ID}"]`)).toBeVisible({ timeout: 20_000 });
    const four = page.locator(`[data-live-book-id="${FOUR_ID}"]`);
    await expect(four).not.toContainText("ئامباردا بار");
    await expect(four.locator(".stock-badge")).toHaveCount(0);
    await expect(four.locator("[data-cart-id]")).toBeEnabled();
    await expect(four).not.toHaveClass(/is-stock-out/);

    const one = page.locator(`[data-live-book-id="${ONE_ID}"]`);
    await expect(one.locator(".stock-badge.stock-low")).toHaveText(/ئاز قالدى/);
    await expect(one).not.toContainText("1 دانە");
    await expect(one.locator("[data-cart-id]")).toBeEnabled();

    const three = page.locator(`[data-live-book-id="${THREE_ID}"]`);
    await expect(three.locator(".stock-badge.stock-low")).toBeVisible();
    await expect(three.locator("[data-cart-id]")).toBeEnabled();

    const zero = page.locator(`[data-live-book-id="${ZERO_ID}"]`);
    await expect(zero).toHaveClass(/is-stock-out/);
    await expect(zero.locator(".cover-stock-overlay")).toHaveText(/تۈگەپ كەتتى/);
    await expect(zero.locator("[data-cart-id]")).toBeDisabled();
    await expect(zero.locator(".detail-button")).toHaveAttribute("href", new RegExp(`/book/${ZERO_ID}`));
    const coverOpacity = await zero.locator(".cover-stock-wrap img, .book-image img").first().evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(coverOpacity).toBeGreaterThan(0.5);
    expect(coverOpacity).toBeLessThan(0.85);

    await page.setViewportSize({ width: 390, height: 844 });
    const overlayBox = await zero.locator(".cover-stock-overlay").boundingBox();
    const titleBox = await zero.locator(".book-title").boundingBox();
    const actionsBox = await zero.locator(".book-actions").boundingBox();
    expect(overlayBox).toBeTruthy();
    expect(titleBox).toBeTruthy();
    expect(actionsBox).toBeTruthy();
    expect(overlayBox.y + overlayBox.height).toBeLessThanOrEqual(titleBox.y + 2);
    expect(overlayBox.y + overlayBox.height).toBeLessThanOrEqual(actionsBox.y + 2);
  });

  test("detail favorites mini-cards and stale cart share out-of-stock UX", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await openBook(page, ZERO_ID, "ئامبار نۆل كىتاب");
    await expect(page.locator(".book-cover-box")).toHaveClass(/is-stock-out/);
    await expect(page.locator(".book-cover-box .cover-stock-overlay")).toBeVisible();
    await expect(page.locator(".detail-main-cart")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("h1")).toContainText("ئامبار نۆل كىتاب");
    await expect(page.locator(".detail-price")).toBeVisible();

    const cards = await page.evaluate(() => {
      const shop = window.kutadguShop;
      const zero = shop.find("91010");
      const one = shop.find("91011");
      const four = shop.find("91013");
      return {
        favZero: shop.favoriteCard(zero),
        miniOne: shop.miniCard(one),
        listingFour: shop.bookCardMarkup(four),
        badgeFour: shop.stockBadge(four)
      };
    });
    expect(cards.favZero).toMatch(/is-stock-out/);
    expect(cards.favZero).toMatch(/تۈگەپ كەتتى/);
    expect(cards.miniOne).toMatch(/ئاز قالدى/);
    expect(cards.listingFour).not.toMatch(/ئامباردا بار/);
    expect(cards.badgeFour).toBe("");

    await page.evaluate(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "91010", qty: 2 }]));
      localStorage.setItem("kutadgu-shop-owner-v1", "guest");
    });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, "ئامبار نۆل كىتاب");
    await expect(page.locator("#cartItems .cart-item")).toHaveCount(1);
    await expect(page.locator("#cartItems .cart-item")).toHaveClass(/is-stock-out/);
    await expect(page.locator("#cartItems")).toContainText("تۈگەپ كەتتى");
    await expect(page.locator("#cartItems [data-plus]")).toBeDisabled();
    await expect(page.locator("#cartItems .cart-title")).toBeVisible();
    await expect.poll(async () => Number((await H.readCart(page))[0]?.qty)).toBe(2);
    const blocked = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(blocked).toBeNull();
    await expect(page.locator("#checkoutCard")).toBeHidden();
  });

  test("legacy static cards synced from live catalog match dynamic out-of-stock UX", async ({ page }) => {
    await mockBooks(page);
    await H.clearShopStorage(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.evaluate(async ({ zero, one, four }) => {
      const shop = window.kutadguShop;
      if (typeof shop.hydrateBooksByIds === "function") {
        await shop.hydrateBooksByIds([zero, one, four]);
      }
      if (!shop.find(zero) || !shop.find(one) || !shop.find(four)) {
        throw new Error("legacy static stock fixtures missing from catalog");
      }
      const host = document.createElement("div");
      host.id = "legacy-static-stock-host";
      host.innerHTML = `
        <article class="book-card" data-cart-id="${zero}">
          <a class="book-image" href="/book/${zero}"><img src="/kutadgu-logo.png" alt=""></a>
          <div class="book-info">
            <h2 class="book-title">Static zero title</h2>
            <div class="book-price">12 ₺</div>
            <a class="detail-button" href="/book/${zero}">تەپسىلات</a>
            <button class="add-to-cart" data-cart-id="${zero}">🛒 سېۋەتكە سېلىش</button>
          </div>
        </article>
        <article class="book-card" data-cart-id="${one}">
          <a class="book-cover" href="/book/${one}"><img src="/kutadgu-logo.png" alt=""></a>
          <div class="book-info">
            <h2 class="book-title">Static one title</h2>
            <div class="book-price">12 ₺</div>
            <a class="detail-button" href="/book/${one}">تەپسىلات</a>
            <button class="add-to-cart" data-cart-id="${one}">🛒 سېۋەتكە سېلىش</button>
          </div>
        </article>
        <article class="book-card" data-cart-id="${four}">
          <a class="book-image" href="/book/${four}"><img src="/kutadgu-logo.png" alt=""></a>
          <div class="book-info">
            <h2 class="book-title">Static four title</h2>
            <div class="book-price">12 ₺</div>
            <a class="detail-button" href="/book/${four}">تەپسىلات</a>
            <button class="add-to-cart" data-cart-id="${four}">🛒 سېۋەتكە سېلىش</button>
          </div>
        </article>
      `;
      document.body.appendChild(host);
      if (typeof shop.syncStaticCards !== "function") throw new Error("syncStaticCards not exported");
      shop.syncStaticCards();
    }, { zero: ZERO_ID, one: ONE_ID, four: FOUR_ID });

    const zero = page.locator(`#legacy-static-stock-host .book-card[data-cart-id="${ZERO_ID}"]`);
    const one = page.locator(`#legacy-static-stock-host .book-card[data-cart-id="${ONE_ID}"]`);
    const four = page.locator(`#legacy-static-stock-host .book-card[data-cart-id="${FOUR_ID}"]`);

    await expect(zero).toBeVisible();
    await expect(zero.locator("a.book-image > img")).toHaveCount(1);
    await expect(zero.locator(".cover-stock-wrap")).toHaveCount(0);
    await expect(zero.locator(".cover-stock-overlay")).toHaveText(/تۈگەپ كەتتى/);
    await expect(zero.locator("button.add-to-cart")).toBeDisabled();
    const zeroStyles = await zero.evaluate((card) => {
      const img = card.querySelector("a.book-image img");
      const title = card.querySelector(".book-title");
      const price = card.querySelector(".book-price");
      const detail = card.querySelector(".detail-button");
      return {
        imgOpacity: Number(getComputedStyle(img).opacity),
        titleOpacity: Number(getComputedStyle(title).opacity),
        priceOpacity: Number(getComputedStyle(price).opacity),
        detailOpacity: Number(getComputedStyle(detail).opacity),
        titleText: title.textContent.trim(),
        priceText: price.textContent.trim(),
        detailHref: detail.getAttribute("href")
      };
    });
    expect(zeroStyles.imgOpacity).toBeGreaterThan(0.6);
    expect(zeroStyles.imgOpacity).toBeLessThan(0.76);
    expect(Math.abs(zeroStyles.imgOpacity - 0.68)).toBeLessThan(0.03);
    expect(zeroStyles.titleOpacity).toBe(1);
    expect(zeroStyles.priceOpacity).toBe(1);
    expect(zeroStyles.detailOpacity).toBe(1);
    expect(zeroStyles.titleText).toBe("ئامبار نۆل كىتاب");
    expect(zeroStyles.priceText).toMatch(/88/);
    expect(zeroStyles.detailHref).toMatch(new RegExp(`/book/${ZERO_ID}`));

    await expect(four).toBeVisible();
    await expect(four).not.toContainText("ئامباردا بار");
    await expect(four.locator(".stock-badge")).toHaveCount(0);
    await expect(four.locator("button.add-to-cart")).toBeEnabled();
    await expect(four.locator(".cover-stock-overlay")).toHaveCount(0);
    const fourOpacity = await four.locator("a.book-image img").evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(fourOpacity).toBe(1);

    await expect(one.locator(".stock-badge.stock-low")).toHaveText(/ئاز قالدى/);
    await expect(one).not.toContainText("1 دانە");
    await expect(one).not.toContainText("دانە قالدى");
    await expect(one.locator("button.add-to-cart")).toBeEnabled();
    await expect(one.locator(".cover-stock-overlay")).toHaveCount(0);
    const oneOpacity = await one.locator("a.book-cover img").evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(oneOpacity).toBe(1);

    await page.locator(`#legacy-static-stock-host .book-card[data-cart-id="${ZERO_ID}"] .detail-button`).click();
    await H.waitForDetailTitle(page, "ئامبار نۆل كىتاب");
  });
});
