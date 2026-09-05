const { test, expect } = require("./playwright-test");
const H = require("./helpers");

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

async function fillCheckout(page) {
  await page.locator("#customerName").fill("Playwright Test", { force: true });
  await page.locator("#customerPhone").fill("5550000111", { force: true });
  await page.locator("#customerAddress").fill("Test street 1", { force: true });
}

test.describe("order prepared semantics", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("prepare/copy/share do not POST orders; WhatsApp still opens", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const book = await addBookOnce(page);
    const orderWrites = [];
    await page.route("**/rest/v1/rpc/create_member_order**", async (route) => {
      const method = route.request().method();
      if (method === "POST" || method === "PATCH" || method === "PUT") {
        orderWrites.push({ method, url: route.request().url() });
      }
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    });
    await page.route("**/rest/v1/orders**", async (route) => {
      const method = route.request().method();
      if (method === "POST" || method === "PATCH" || method === "PUT") {
        orderWrites.push({ method, url: route.request().url() });
      }
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    });

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForHydratedCartTitle(page, book.title);
    await expect(page.locator("#checkoutCard")).toBeVisible();
    await expect(page.locator("#checkoutForm #customerName")).toBeVisible();
    await fillCheckout(page);
    await expect(page.locator("#customerName")).toHaveValue("Playwright Test");
    await expect(page.locator("#customerPhone")).toHaveValue("5550000111");
    await expect(page.locator("#customerAddress")).toHaveValue("Test street 1");

    await page.locator("#prepareOrder").click();
    await expect(page.locator("#orderPreviewWrap")).toBeVisible();
    await expect(page.locator("#orderPreview")).toContainText(book.title);
    await page.locator("#prepareOrder").click();
    await page.locator("#copyOrder").click();
    await page.locator("#copyOrder").click();
    await page.evaluate(() => { navigator.share = undefined; });
    await page.locator("#shareOrder").click();
    await page.locator("#shareOrder").click();
    expect(orderWrites).toEqual([]);

    const opened = [];
    await page.exposeFunction("__kutadguCaptureWa", (url) => opened.push(url));
    await page.evaluate(() => {
      window.open = (url) => {
        window.__kutadguCaptureWa(String(url));
        return { opener: null, close() {} };
      };
    });
    await page.locator("#whatsappOrder").click();
    await expect.poll(() => opened.length).toBeGreaterThan(0);
    expect(opened[0]).toMatch(/^https:\/\/wa\.me\/905368999888\?text=/);
  });

  for (const width of [390, 412, 768, 1280]) {
    test(`checkout controls remain usable at ${width}`, async ({ page }) => {
      const book = await addBookOnce(page);
      await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
      await H.waitForShop(page);
      await H.waitForHydratedCartTitle(page, book.title);
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
      for (const id of ["#whatsappOrder", "#prepareOrder", "#copyOrder", "#shareOrder"]) {
        const loc = page.locator(id);
        await expect(loc).toBeVisible();
        const box = await loc.boundingBox();
        expect(box).toBeTruthy();
        expect(box.width).toBeGreaterThan(24);
        expect(box.height).toBeGreaterThan(24);
      }
      await expect.poll(async () => page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      ))).toBe(true);
    });
  }
});
