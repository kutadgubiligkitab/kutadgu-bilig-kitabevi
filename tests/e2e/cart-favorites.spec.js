const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const LEGACY_IDS = ["children-3", "children-4"];

async function startEmptyOnBook(page) {
  const book = await H.discoverLiveBook(page);
  await H.openFresh(page, book.detailPath);
  await H.waitForDetailTitle(page, book.title);
  await H.clearShopStorage(page);
  return book;
}

async function addBookOnce(page) {
  const book = await startEmptyOnBook(page);
  await page.locator(".detail-main-cart").click();
  await expect.poll(async () => H.badgeCount(page)).toBeGreaterThan(0);
  return book;
}

test.describe("guest cart and favorites", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("6 add to cart once — badge and cart page agree", async ({ page }) => {
    const book = await addBookOnce(page);
    const badge = await H.badgeCount(page);
    expect(badge).toBe(1);
    const stored = await H.readCart(page);
    expect(stored).toHaveLength(1);
    expect(String(stored[0].id)).toBe(String(book.id));
    expect(Number(stored[0].qty)).toBe(1);

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);
    await expect(page.locator("#cartItems .qty-control")).toHaveCount(1);
    const badgeOnCart = await H.badgeCount(page);
    expect(badgeOnCart).toBe(1);
  });

  test("7 quantity change persists after refresh", async ({ page }) => {
    const book = await addBookOnce(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);
    await expect(page.locator("#cartItems [data-plus]")).toBeEnabled();
    await page.locator("#cartItems [data-plus]").click();
    await expect.poll(async () => {
      const cart = await H.readCart(page);
      return Number(cart[0] && cart[0].qty);
    }).toBe(2);

    await expect(page.locator("#cartItems [data-minus]")).toBeEnabled();
    await page.locator("#cartItems [data-minus]").click();
    await expect.poll(async () => {
      const cart = await H.readCart(page);
      return Number(cart[0] && cart[0].qty);
    }).toBe(1);

    await page.locator("#cartItems [data-plus]").click();
    await expect.poll(async () => {
      const cart = await H.readCart(page);
      return Number(cart[0] && cart[0].qty);
    }).toBe(2);

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const after = await H.readCart(page);
    expect(Number(after[0].qty)).toBe(2);
    expect(await H.badgeCount(page)).toBe(2);
  });

  test("8 remove from cart stays removed after refresh", async ({ page }) => {
    const book = await addBookOnce(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);
    await page.locator("#cartItems [data-remove]").click();
    await expect.poll(async () => (await H.readCart(page)).length).toBe(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect(await H.readCart(page)).toEqual([]);
    expect(await H.badgeCount(page)).toBe(0);
  });

  test("9 add/remove favorite persists", async ({ page }) => {
    const book = await startEmptyOnBook(page);
    await page.locator(".detail-purchase-panel [data-fav-id]").click();
    await expect.poll(async () => (await H.readFavs(page)).map(String)).toContain(String(book.id));

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect((await H.readFavs(page)).map(String)).toContain(String(book.id));

    await page.locator(".detail-purchase-panel [data-fav-id]").click();
    await expect.poll(async () => (await H.readFavs(page)).map(String).includes(String(book.id))).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect((await H.readFavs(page)).map(String)).not.toContain(String(book.id));
  });

  test("10 cart/favorites do not auto-add children-3 / children-4", async ({ page }) => {
    await H.openFresh(page, "/index.html");
    await H.clearShopStorage(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const cart = JSON.stringify(await H.readCart(page));
    const favs = JSON.stringify(await H.readFavs(page));
    for (const id of LEGACY_IDS) {
      expect(cart).not.toContain(id);
      expect(favs).not.toContain(id);
    }
    expect(await H.readCart(page)).toEqual([]);
    expect(await H.readFavs(page)).toEqual([]);
  });

  test("11 cart quantity never multiplies on refresh", async ({ page }) => {
    const book = await addBookOnce(page);
    for (let i = 0; i < 4; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await H.waitForShop(page);
    }
    const cart = await H.readCart(page);
    expect(cart).toHaveLength(1);
    expect(String(cart[0].id)).toBe(String(book.id));
    expect(Number(cart[0].qty)).toBe(1);
    expect(await H.badgeCount(page)).toBe(1);
  });

  test("12 guest cart works without login", async ({ page }) => {
    const book = await addBookOnce(page);
    const member = await page.evaluate(() => !!(window.KutadguMember && window.KutadguMember.user));
    expect(member).toBeFalsy();
    expect((await H.readCart(page))[0].qty).toBe(1);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);
    await expect(page.locator("#cartItems .qty-control")).toHaveCount(1);
    await expect(page.locator("#whatsappOrder")).toBeVisible();
  });

  test("13 WhatsApp order button generates a valid target/message", async ({ page }) => {
    const book = await addBookOnce(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);
    await expect(page.locator("#checkoutCard")).toBeVisible();
    await page.locator("#customerName").fill("Playwright Test", { force: true });
    await page.locator("#customerPhone").fill("5550000111", { force: true });
    await page.locator("#customerAddress").fill("Test street 1", { force: true });

    const opened = [];
    await page.exposeFunction("__kutadguCaptureWa", (url) => {
      opened.push(url);
    });
    await page.evaluate(() => {
      window.open = (url) => {
        window.__kutadguCaptureWa(String(url));
        return { opener: null, close() {} };
      };
    });
    await page.locator("#whatsappOrder").click();
    await expect.poll(() => opened.length).toBeGreaterThan(0);
    const url = opened[0];
    expect(url).toMatch(/^https:\/\/wa\.me\/905368999888\?text=/);
    const text = decodeURIComponent(url.split("text=")[1] || "");
    expect(text).toContain(book.title);
    expect(text).toMatch(/1 دانە/);
    expect(text).toMatch(/كىتاب/);
    expect(text).toMatch(/Playwright Test/);
    expect(text).toMatch(/زاكاز نومۇرى/);
  });

  test("stale leftover cart is not shown as guest cart", async ({ page }) => {
    await H.openFresh(page, "/cart.html");
    await page.evaluate(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "102", qty: 2 }]));
      localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["102"]));
      localStorage.setItem("kutadgu-shop-owner-v1", "stale");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const visible = await page.evaluate(() => window.kutadguShop.cart());
    expect(visible).toEqual([]);
    await expect(page.locator("#cartItems")).toContainText(/سېۋەت ھازىرچە بوش/);
  });

  test("guest-owned cart still displays before login", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await H.openFresh(page, "/cart.html");
    await page.evaluate((id) => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id, qty: 1 }]));
      localStorage.setItem("kutadgu-shop-owner-v1", "guest");
    }, book.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const visible = await page.evaluate(() => window.kutadguShop.cart());
    expect(visible.some((row) => String(row.id) === String(book.id))).toBe(true);
    await expect(page.locator("#cartItems")).not.toContainText(/سېۋەت ھازىرچە بوش/);
  });

  test("favorited book appears on favorites.html and survives refresh", async ({ page }) => {
    const book = await startEmptyOnBook(page);
    await page.locator(".detail-purchase-panel [data-fav-id]").click();
    await expect.poll(async () => (await H.readFavs(page)).map(String)).toContain(String(book.id));
    await expect(page.locator(".detail-purchase-panel [data-fav-id]")).toHaveClass(/is-favorite/);

    await page.goto("/favorites.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#favoritesList")).not.toContainText(/ھازىرچە ياقتۇرغان كىتاب يوق/);
    await expect(page.locator("#favoritesList .favorites-grid")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#favoritesList .favorites-grid")).toBeVisible();
    expect((await H.readFavs(page)).map(String)).toContain(String(book.id));
  });

  test("favorites.html re-renders after authenticated member sync", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    const owner = "11111111-1111-4111-8111-111111111111";
    await H.openFresh(page, "/favorites.html");
    await H.waitForShop(page);
    await page.evaluate(({ ownerId, bookId }) => {
      localStorage.setItem("kutadgu-favorites-v1", JSON.stringify([bookId]));
      localStorage.setItem("kutadgu-shop-owner-v1", ownerId);
    }, { ownerId: owner, bookId: book.id });
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#favoritesList")).toContainText(/ھازىرچە ياقتۇرغان كىتاب يوق/);

    await page.evaluate((ownerId) => {
      const prev = window.KutadguMember || {};
      window.KutadguMember = Object.assign({}, prev, { getUser: () => ({ id: ownerId }) });
      document.dispatchEvent(new CustomEvent("kutadgu-member-state-synced"));
    }, owner);
    await expect.poll(async () => page.evaluate((id) => {
      const shop = window.kutadguShop;
      if (!shop) return false;
      const favs = shop.favorites ? shop.favorites() : [];
      return favs.map(String).includes(String(id)) && !!shop.find(id);
    }, book.id), { timeout: 20_000 }).toBe(true);
    await expect(page.locator("#favoritesList .favorites-grid")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#favoritesList")).not.toContainText(/ھازىرچە ياقتۇرغان كىتاب يوق/);
  });

  test("stale and foreign-owner favorites stay hidden on favorites.html", async ({ page }) => {
    await H.openFresh(page, "/favorites.html");
    await H.waitForShop(page);
    await page.evaluate(() => {
      localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["102"]));
      localStorage.setItem("kutadgu-shop-owner-v1", "stale");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#favoritesList")).toContainText(/ھازىرچە ياقتۇرغان كىتاب يوق/);
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("kutadgu-member-state-synced"));
    });
    await expect(page.locator("#favoritesList")).toContainText(/ھازىرچە ياقتۇرغان كىتاب يوق/);

    await page.evaluate(() => {
      localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["102"]));
      localStorage.setItem("kutadgu-shop-owner-v1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const prev = window.KutadguMember || {};
      window.KutadguMember = Object.assign({}, prev, {
        getUser: () => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })
      });
      document.dispatchEvent(new CustomEvent("kutadgu-member-state-synced"));
    });
    await expect(page.locator("#favoritesList")).toContainText(/ھازىرچە ياقتۇرغان كىتاب يوق/);
  });

  test("cart line total and grand total follow quantity", async ({ page }) => {
    const book = await addBookOnce(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);

    const expectedOnce = await page.evaluate(() => {
      const shop = window.kutadguShop;
      const line = shop.cart()[0];
      const book = shop.find(line.id);
      const n = (Number(book && book.price) || 0) * Number(line.qty || 1);
      return `${Number(n).toLocaleString("tr-TR")} ₺`;
    });
    await expect(page.locator("#cartItems .cart-line-price strong")).toContainText(expectedOnce);
    await expect(page.locator("#cartSummaryHost .cart-total strong")).toContainText(expectedOnce);

    await page.locator("#cartItems [data-plus]").click();
    await expect.poll(async () => {
      const cart = await H.readCart(page);
      return Number(cart[0] && cart[0].qty);
    }).toBe(2);
    const expectedTwice = await page.evaluate(() => {
      const shop = window.kutadguShop;
      const line = shop.cart()[0];
      const book = shop.find(line.id);
      const n = (Number(book && book.price) || 0) * Number(line.qty || 1);
      return `${Number(n).toLocaleString("tr-TR")} ₺`;
    });
    await expect(page.locator("#cartItems .cart-line-price strong")).toContainText(expectedTwice);
    await expect(page.locator("#cartSummaryHost .cart-total strong")).toContainText(expectedTwice);
  });

  test("cart grouped layout stays inside the viewport", async ({ page }) => {
    const book = await addBookOnce(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);
    await expect(page.locator(".cart-layout")).toBeVisible();
    await expect(page.locator("#cartItems .cart-item-cover")).toHaveCount(1);
    await expect(page.locator("#cartItems .cart-item-toolbar .qty-control")).toHaveCount(1);
    await expect(page.locator("#cartSummaryHost .cart-summary")).toBeVisible();
    await expect(page.locator("#whatsappOrder")).toBeVisible();

    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(async () => page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      ))).toBe(true);
      const columns = await page.locator(".cart-layout").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
      if (width >= 960) {
        expect(columns.split(" ").length).toBeGreaterThanOrEqual(2);
      } else {
        expect(columns.split(" ").filter(Boolean).length).toBe(1);
      }
    }
  });
});
