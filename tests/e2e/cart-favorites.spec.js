const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const LEGACY_IDS = ["children-3", "children-4"];

async function startEmptyOnBook(page, id = "102") {
  await H.openFresh(page, `/book.html?id=${id}`);
  await H.waitForDetailTitle(page);
  await H.clearShopStorage(page);
}

async function addBookOnce(page, id = "102") {
  await startEmptyOnBook(page, id);
  await page.locator(".detail-main-cart").click();
  await expect.poll(async () => H.badgeCount(page)).toBeGreaterThan(0);
}

test.describe("guest cart and favorites", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("6 add to cart once — badge and cart page agree", async ({ page }) => {
    await addBookOnce(page, "102");
    const badge = await H.badgeCount(page);
    expect(badge).toBe(1);
    const stored = await H.readCart(page);
    expect(stored).toHaveLength(1);
    expect(String(stored[0].id)).toBe("102");
    expect(Number(stored[0].qty)).toBe(1);

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#cartItems .qty-control")).toHaveCount(1);
    const badgeOnCart = await H.badgeCount(page);
    expect(badgeOnCart).toBe(1);
  });

  test("7 quantity change persists after refresh", async ({ page }) => {
    await addBookOnce(page, "102");
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
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
    await addBookOnce(page, "102");
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.locator("#cartItems [data-remove]").click();
    await expect.poll(async () => (await H.readCart(page)).length).toBe(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect(await H.readCart(page)).toEqual([]);
    expect(await H.badgeCount(page)).toBe(0);
  });

  test("9 add/remove favorite persists", async ({ page }) => {
    await startEmptyOnBook(page, "102");
    await page.locator(".detail-purchase-panel [data-fav-id]").click();
    await expect.poll(async () => (await H.readFavs(page)).map(String)).toContain("102");

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect((await H.readFavs(page)).map(String)).toContain("102");

    await page.locator(".detail-purchase-panel [data-fav-id]").click();
    await expect.poll(async () => (await H.readFavs(page)).map(String).includes("102")).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect((await H.readFavs(page)).map(String)).not.toContain("102");
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
    await addBookOnce(page, "102");
    for (let i = 0; i < 4; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await H.waitForShop(page);
    }
    const cart = await H.readCart(page);
    expect(cart).toHaveLength(1);
    expect(String(cart[0].id)).toBe("102");
    expect(Number(cart[0].qty)).toBe(1);
    expect(await H.badgeCount(page)).toBe(1);
  });

  test("12 guest cart works without login", async ({ page }) => {
    await addBookOnce(page, "102");
    const member = await page.evaluate(() => !!(window.KutadguMember && window.KutadguMember.user));
    expect(member).toBeFalsy();
    expect((await H.readCart(page))[0].qty).toBe(1);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#cartItems .qty-control")).toHaveCount(1);
    await expect(page.locator("#whatsappOrder")).toBeVisible();
  });

  test("13 WhatsApp order button generates a valid target/message", async ({ page }) => {
    await addBookOnce(page, "102");
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
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
    expect(text).toMatch(/بالىلار|كىتاب/);
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
    await H.openFresh(page, "/cart.html");
    await page.evaluate(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "102", qty: 1 }]));
      localStorage.setItem("kutadgu-shop-owner-v1", "guest");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const visible = await page.evaluate(() => window.kutadguShop.cart());
    expect(visible.some((row) => String(row.id) === "102")).toBe(true);
    await expect(page.locator("#cartItems")).not.toContainText(/سېۋەت ھازىرچە بوش/);
  });
});
