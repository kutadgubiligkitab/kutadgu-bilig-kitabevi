const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const LONG_TITLE = "ئۇزۇن ئۇيغۇرچە كىتاب نامى ".repeat(8).trim();

function row(id, title, price, stock = 8) {
  return {
    id: Number(id),
    title,
    author: "سىناق ئاپتور",
    price,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: false,
    is_new: false,
    stock,
    stock_status: stock > 0 ? "in_stock" : "out_of_stock",
    sales_count: 0,
    created_at: "2026-08-01T00:00:00Z"
  };
}

const BOOKS = [
  row("91011", LONG_TITLE, 153, 8),
  row("91012", "ئاچىل", 153, 8),
  row("91013", "يەنە بىر كىتاب", 147, 8),
  row("91014", "كەسىرلىك كىتاب", 412.1, 8)
];

async function seedCart(page) {
  await page.addInitScript((cart) => {
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify(cart));
    localStorage.setItem("kutadgu-shop-owner-v1", "guest");
    localStorage.removeItem("kutadgu-member-auth-v1");
    localStorage.removeItem("kutadgu-cart-display-v1");
  }, [
    { id: "91011", qty: 1 },
    { id: "91012", qty: 2 },
    { id: "91013", qty: 2 },
    { id: "91014", qty: 2 }
  ]);
}

async function mockBooks(page, books = BOOKS) {
  await page.route("**/rest/v1/books**", async (route) => {
    const method = route.request().method();
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${books.length}` },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(books.length - 1, 0)}/${books.length}` },
      body: JSON.stringify(books)
    });
  });
}

async function fillCustomer(page, note) {
  await page.locator("#customerName").fill("Aygul Test", { force: true });
  await page.locator("#customerPhone").fill("0555 000 11 11", { force: true });
  await page.locator("#customerCity").fill("Istanbul / Fatih", { force: true });
  await page.locator("#customerAddress").fill("Test street 1, door 4", { force: true });
  await page.locator("#customerNote").fill(note, { force: true });
}

test.describe("compact order message", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("preview, copy, share, and WhatsApp use one compact message", async ({ page, context }) => {
    test.setTimeout(45_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedCart(page);
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("script[src*='shop.js']")).toHaveAttribute("src", /shop\.js\?v=170/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("#cartItems")).toContainText(LONG_TITLE);
    await expect(page.locator("#checkoutCard")).toBeVisible();

    await page.locator("#prepareOrder").click();
    await expect(page.locator("#orderPreviewWrap")).toBeHidden();

    await fillCustomer(page, "  كەلگەندە تېلېفون قىلىڭ  ");
    await page.locator("#prepareOrder").click();
    await expect(page.locator("#orderPreviewWrap")).toBeVisible();
    const preview = await page.locator("#orderPreview").innerText();
    expect(preview).toContain(`1. ${LONG_TITLE} — 1 دانە · 153 ₺`);
    expect(preview).toContain("2. ئاچىل — 2 دانە · 306 ₺");
    expect(preview).toContain("3. يەنە بىر كىتاب — 2 دانە · 294 ₺");
    expect(preview).toContain("4. كەسىرلىك كىتاب — 2 دانە · 824,20 ₺");
    expect(preview).toContain("*جەمئىي كىتاب سانى: 7 — جەمئىي: 1.577,20 ₺*");
    expect(preview).toContain("ئىسمى: Aygul Test");
    expect(preview).toContain("تېلېفون: 0555 000 11 11");
    expect(preview).toContain("شەھەر / رايون: Istanbul / Fatih");
    expect(preview).toContain("ئادرېس: Test street 1, door 4");
    expect(preview).toContain("يەتكۈزۈش: كارگو ئارقىلىق");
    expect(preview).toContain("ئىزاھات: كەلگەندە تېلېفون قىلىڭ");
    expect(preview).not.toContain("×");
    const titleLine = preview.split("\n").find((line) => line.includes(LONG_TITLE));
    expect(titleLine.startsWith("1. ")).toBe(true);
    expect(titleLine.endsWith("153 ₺")).toBe(true);
    const orderNo = preview.match(/زاكاز نومۇرى:\s*(KB-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8})/)[1];
    await page.locator("#prepareOrder").click();
    await expect(page.locator("#orderPreview")).toContainText(orderNo);

    await page.locator("#copyOrder").click();
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe(preview);

    await page.evaluate(() => {
      window.__sharedOrder = "";
      navigator.share = async (payload) => { window.__sharedOrder = payload.text; };
    });
    await page.locator("#shareOrder").click();
    await expect.poll(() => page.evaluate(() => window.__sharedOrder)).toBe(preview);

    const opened = [];
    await page.exposeFunction("__kutadguCaptureWa", (url) => opened.push(url));
    await page.evaluate(() => {
      window.open = (url) => {
        window.__kutadguCaptureWa(String(url));
        const location = {};
        Object.defineProperty(location, "href", {
          set(value) { window.__kutadguCaptureWa(String(value)); }
        });
        return { opener: null, location, close() {} };
      };
    });
    await page.locator("#whatsappOrder").click();
    await expect.poll(() => opened.length).toBe(2);
    expect(opened[0]).toBe("about:blank");
    expect(opened[1]).toMatch(/^https:\/\/wa\.me\/905368999888\?text=/);
    expect(decodeURIComponent(opened[1].split("text=")[1])).toBe(preview);

    const payload = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(payload.totalQty).toBe(7);
    expect(Math.round(payload.total * 100)).toBe(157720);
    expect(payload.items.map((item) => [item.qty, item.price, item.line_total])).toEqual([
      [1, 153, 153],
      [2, 153, 306],
      [2, 147, 294],
      [2, 412.1, 824.2]
    ]);

    await page.locator("#customerNote").fill("   ", { force: true });
    await page.locator("#prepareOrder").click();
    const blank = await page.locator("#orderPreview").innerText();
    expect(blank).not.toContain("ئىزاھات");
    expect(blank).toContain("تېلېفون: 0555 000 11 11");
    expect(blank).not.toContain(orderNo);

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 800 });
      const box = await page.locator("#orderPreview").boundingBox();
      expect(box.width).toBeGreaterThan(100);
      const overflow = await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      ));
      expect(overflow).toBe(true);
      const wrap = await page.locator("#orderPreview").evaluate((el) => getComputedStyle(el).whiteSpace);
      expect(wrap).toBe("pre-wrap");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    }
  });

  test("an empty cart and an out-of-stock cart still do not build a message", async ({ page }) => {
    test.setTimeout(45_000);
    await page.addInitScript(() => { window.KUTADGU_STOCK_ENFORCEMENT = true; });
    await page.addInitScript(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "91015", qty: 1 }]));
      localStorage.setItem("kutadgu-shop-owner-v1", "guest");
      localStorage.removeItem("kutadgu-member-auth-v1");
    });
    await mockBooks(page, [row("91015", "تۈگەپ كەتكەن كىتاب", 153, 0)]);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#cartItems")).toContainText("تۈگەپ كەتكەن كىتاب");
    const blocked = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(blocked).toBeNull();

    await page.evaluate(() => {
      localStorage.setItem("kutadgu-cart-v1", "[]");
      window.kutadguShop.remove("91015");
    });
    const empty = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(empty).toBeNull();
  });

  test("copy allows blank and partial details, falls back, and WhatsApp still validates", async ({ page, context }) => {
    test.setTimeout(45_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const writes = [];
    await page.route("**/rest/v1/orders**", async (route) => {
      const method = route.request().method();
      if (method !== "GET" && method !== "HEAD") writes.push(method + " " + route.request().url());
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    });
    await page.route("**/rest/v1/rpc/create_member_order**", async (route) => {
      writes.push(route.request().method() + " " + route.request().url());
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    });
    await seedCart(page);
    await mockBooks(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#cartItems")).toContainText(LONG_TITLE);
    await expect(page.locator("#copyOrderNote")).toBeVisible();
    await expect(page.locator("#copyOrderNote")).toContainText("كۆچۈرۈشتە ئىسىم، تېلېفون ۋە ئادرېسنى تولدۇرۇش شەرت ئەمەس");
    await expect(page.locator("#customerName")).toHaveValue("");
    await expect(page.locator("#customerPhone")).toHaveValue("");
    await expect(page.locator("#customerAddress")).toHaveValue("");

    await page.locator("#copyOrder").click();
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain("ئىسمى: -");
    const blank = await page.evaluate(() => navigator.clipboard.readText());
    expect(blank).toContain(`1. ${LONG_TITLE} — 1 دانە · 153 ₺`);
    expect(blank).toContain("تېلېفون: -");
    expect(blank).toContain("ئادرېس: -");
    expect(blank).toContain("يەتكۈزۈش: كارگو ئارقىلىق");
    expect(blank).toContain("*جەمئىي كىتاب سانى: 7 — جەمئىي: 1.577,20 ₺*");
    const orderNo = blank.match(/KB-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}/)[0];
    await page.locator("#copyOrder").click();
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(`زاكاز نومۇرى: ${orderNo}`);
    await expect(page.locator("#orderPreviewWrap")).toBeHidden();

    await page.locator("#customerName").fill("Aygul Test", { force: true });
    await page.locator("#copyOrder").click();
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain("ئىسمى: Aygul Test");
    const partial = await page.evaluate(() => navigator.clipboard.readText());
    expect(partial).toContain("تېلېفون: -");
    expect(partial).toContain("ئادرېس: -");
    expect(partial).not.toContain(orderNo);

    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new Error("denied"); };
      document.execCommand = (cmd) => {
        const nodes = document.querySelectorAll("textarea");
        const ta = nodes[nodes.length - 1];
        window.__fallbackCopy = { cmd, value: ta ? ta.value : "" };
        return true;
      };
    });
    await page.locator("#copyOrder").click();
    await expect.poll(() => page.evaluate(() => window.__fallbackCopy && window.__fallbackCopy.cmd)).toBe("copy");
    const fallback = await page.evaluate(() => window.__fallbackCopy.value);
    expect(fallback).toContain("ئىسمى: Aygul Test");
    expect(fallback).toContain("تېلېفون: -");
    expect(fallback).toContain(LONG_TITLE);

    const opened = [];
    await page.exposeFunction("__kutadguCaptureWa", (url) => opened.push(url));
    await page.evaluate(() => {
      window.open = (url) => {
        window.__kutadguCaptureWa(String(url));
        const location = {};
        Object.defineProperty(location, "href", {
          set(value) { window.__kutadguCaptureWa(String(value)); }
        });
        return { opener: null, location, close() {} };
      };
    });
    await page.locator("#whatsappOrder").click();
    await expect.poll(() => page.locator("#customerPhone").evaluate((el) => el.validity.valueMissing)).toBe(true);
    expect(opened).toEqual([]);
    expect(writes).toEqual([]);

    await page.locator("#customerPhone").fill("0555 000 11 11", { force: true });
    await page.locator("#customerAddress").fill("Test street 1, door 4", { force: true });
    await page.locator("#whatsappOrder").click();
    await expect.poll(() => opened.length).toBe(2);
    expect(opened[0]).toBe("about:blank");
    expect(opened[1]).toMatch(/^https:\/\/wa\.me\/905368999888\?text=/);
    const sent = decodeURIComponent(opened[1].split("text=")[1]);
    expect(sent).toContain("ئىسمى: Aygul Test");
    expect(sent).toContain("تېلېفون: 0555 000 11 11");
    expect(sent).toContain("ئادرېس: Test street 1, door 4");
    expect(sent).not.toContain("تېلېفون: -");
    expect(sent).not.toContain(orderNo);
    expect(writes).toEqual([]);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator("#copyOrderNote")).toBeVisible();
    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    ));
    expect(overflow).toBe(true);
  });
});
