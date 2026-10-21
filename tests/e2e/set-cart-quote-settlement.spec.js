const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shell = fs.readFileSync(path.join(__dirname, "..", "..", "book-shell.html"), "utf8");
const LIVE_SET_CART = String(process.env.KUTADGU_LIVE_SET_CART || "").trim() === "1";
const ALLOW_RPC = [
  "query_public_book_catalog",
  "get_public_book_volume_group_storefront",
  "resolve_public_book_volume_context",
  "quote_book_volume_cart",
  "list_public_book_volume_groups",
  "list_public_book_volume_discovery_unit_ids",
  "list_public_book_volume_group_members",
  "list_public_book_volume_group_storefront"
];

function rpcName(url) {
  const match = String(url).match(/\/rpc\/([a-z0-9_]+)/i);
  return match ? match[1] : "";
}

const appConfig = fs.readFileSync(path.join(__dirname, "..", "..", "app-config.js"), "utf8")
  .replace("multiVolumeBooks:false", "multiVolumeBooks:true");

const members = [
  {
    book_id: "156", position: 1, volume_label: "1-قىسىم", title: "ئويغانغان زېمىن 1. قىسىم",
    author: "ئابدۇرېھىم ئۆتكۈر", price: 370, image_url: "/volume-cover-1.svg",
    stock: 20, stock_status: "in_stock", is_active: true
  },
  {
    book_id: "157", position: 2, volume_label: "2-قىسىم", title: "ئويغانغان زېمىن 2. قىسىم",
    author: "ئابدۇرېھىم ئۆتكۈر", price: 399, image_url: "/volume-cover-2.svg",
    stock: 20, stock_status: "in_stock", is_active: true
  }
];

const group = {
  id: "1",
  slug: "series-156",
  title: "ئويغانغان زېمىن",
  author: "ئابدۇرېھىم ئۆتكۈر",
  category: "تارىخىي رومانلار",
  source: "tarikhiy-romanlar.html",
  description: "",
  complete_set_price: 750,
  effective_set_price: 750,
  representative_book_id: "156",
  revision: 2,
  quote_revision: "quote-owner",
  members
};

function defer() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

function quotePayload() {
  return {
    schema_version: 1,
    fingerprint: "quoted-set-1",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    total: 750,
    total_qty: 2,
    price_source: "explicit",
    items: [{
      kind: "set",
      group_id: "1",
      qty: 1,
      price: 750,
      line_total: 750,
      title: "ئويغانغان زېمىن",
      physical_qty: 2
    }]
  };
}

function isExactZeroTry(text) {
  return /^0\s*₺$/.test(String(text || "").trim());
}

async function expectNoExactZeroPrice(page) {
  const amounts = [
    page.locator(".cart-total strong"),
    page.locator(".cart-volume-set .cart-line-price strong")
  ];
  for (const amount of amounts) {
    if (await amount.count()) expect(isExactZeroTry(await amount.textContent())).toBeFalsy();
  }
}

async function expectGuestSetCart(page) {
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-set-cart-v1") || "[]")))
    .toEqual([expect.objectContaining({ kind: "set", group_id: "1", qty: 1 })]);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]")))
    .toEqual([]);
}

async function openGuestSetCart(page, holds) {
  holds.groupFails = Number(holds.groupFails || 0);
  holds.quoteFails = Number(holds.quoteFails || 0);
  holds.quoteCalls = 0;
  holds.groupBody = holds.groupBody || group;
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.removeItem("kutadgu-catalog-active-count-v1");
      localStorage.setItem("kutadgu-cart-v1", "[]");
      localStorage.setItem("kutadgu-set-cart-v1", JSON.stringify([
        { kind: "set", group_id: "1", qty: 1, quote_revision: "quote-owner" }
      ]));
    } catch (error) {}
  });
  await page.route("**/app-config.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: appConfig
  }));
  await page.route("**/volume-cover-*.svg", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#70503d"/></svg>'
  }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: null })
  }));
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/rpc/get_public_book_volume_group_storefront")) {
      await holds.group.promise;
      if (holds.groupFails > 0) {
        holds.groupFails -= 1;
        return route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ message: "group_failed" })
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(holds.groupBody) });
    }
    if (url.includes("/rpc/quote_book_volume_cart")) {
      holds.quoteCalls += 1;
      await holds.quote.promise;
      if (holds.quoteFails > 0) {
        holds.quoteFails -= 1;
        return route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ message: "quote_failed" })
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(quotePayload()) });
    }
    if (url.includes("/rest/v1/books")) {
      if (request.method() === "HEAD") {
        return route.fulfill({ status: 200, headers: { "content-range": "0-1/2" }, body: "" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-1/2" },
        body: JSON.stringify(members.map((member) => ({
          id: Number(member.book_id),
          title: member.title,
          author: member.author,
          category: "تارىخىي رومانلار",
          source: "tarikhiy-romanlar.html",
          price: member.price,
          image_url: member.image_url,
          stock: member.stock,
          stock_status: member.stock_status,
          is_active: true,
          submission_status: "approved"
        })))
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function expectQuotePending(page) {
  const setRow = page.locator(".cart-volume-set");
  await expect(setRow).toBeVisible();
  await expect(setRow).toHaveAttribute("data-set-quote-state", "pending");
  await expect(page.locator(".cart-total strong")).toHaveText("جەزملەۋاتىدۇ…");
  await expect(page.locator(".cart-volume-set .cart-line-price strong")).toHaveText("جەزملەۋاتىدۇ…");
  await expectNoExactZeroPrice(page);
  await expect(page.locator("#checkoutCard")).toBeHidden();
}

async function expectQuoteReadError(page) {
  const setRow = page.locator(".cart-volume-set");
  await expect(setRow).toHaveAttribute("data-set-quote-state", "error");
  await expect(page.locator("[data-cart-quote-error]")).toBeVisible();
  await expect(page.locator("[data-set-quote-retry]")).toBeVisible();
  await expect(page.locator(".cart-stock-block-note")).toHaveCount(0);
  await expect(page.locator("#checkoutCard")).toBeHidden();
  await expect(page.locator(".cart-total strong")).toHaveText("—");
  await expectNoExactZeroPrice(page);
  await expectGuestSetCart(page);
}

async function expectAuthoritative750(page) {
  const setRow = page.locator(".cart-volume-set");
  await expect(setRow).toHaveAttribute("data-set-quote-state", "ready");
  await expect(page.locator(".cart-total strong")).toHaveText("750 ₺");
  await expect(page.locator(".cart-volume-set .cart-line-price strong")).toHaveText("750 ₺");
  await expect(setRow.locator(".cart-unit-price")).toContainText("750 ₺");
  await expect(page.locator("#cartItems")).not.toContainText("769");
  await expect(page.locator("#checkoutCard")).toBeVisible();
}

test.describe("set-cart quote settlement", () => {
  test("cold load and reload settle after a delayed group, then quote", async ({ page }) => {
    const holds = { group: defer(), quote: defer() };
    holds.quote.release();
    await openGuestSetCart(page, holds);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expectQuotePending(page);
    holds.group.release();
    await expectAuthoritative750(page);

    const reloadHolds = { group: defer(), quote: defer() };
    holds.group = reloadHolds.group;
    holds.quote = reloadHolds.quote;
    holds.quote.release();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectQuotePending(page);
    holds.group.release();
    await expectAuthoritative750(page);
  });

  test("cold load settles after group, then a delayed quote", async ({ page }) => {
    const holds = { group: defer(), quote: defer() };
    holds.group.release();
    await openGuestSetCart(page, holds);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expectQuotePending(page);
    holds.quote.release();
    await expectAuthoritative750(page);
  });

  test("quote 502 on an in-stock group shows a read error and retries the same cart", async ({ page }) => {
    const holds = { group: defer(), quote: defer(), quoteFails: 1 };
    holds.group.release();
    holds.quote.release();
    await openGuestSetCart(page, holds);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expectQuoteReadError(page);
    await page.locator("[data-set-quote-retry]").click();
    await expectAuthoritative750(page);
    await expectGuestSetCart(page);
    expect(holds.quoteCalls).toBeGreaterThanOrEqual(2);
  });

  test("group 502 shows a read error, then retry loads the quote without changing the cart", async ({ page }) => {
    const holds = { group: defer(), quote: defer(), groupFails: 1 };
    holds.group.release();
    holds.quote.release();
    await openGuestSetCart(page, holds);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expectQuoteReadError(page);
    await page.locator("[data-set-quote-retry]").click();
    await expectAuthoritative750(page);
    await expectGuestSetCart(page);
  });

  test("confirmed insufficient stock stays a stock block, not a quote retry", async ({ page }) => {
    const holds = {
      group: defer(),
      quote: defer(),
      groupBody: {
        ...group,
        members: members.map((member) => ({ ...member, stock: 0, stock_status: "out_of_stock" }))
      }
    };
    holds.group.release();
    holds.quote.release();
    await openGuestSetCart(page, holds);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".cart-volume-set")).toHaveAttribute("data-set-quote-state", "blocked");
    await expect(page.locator(".cart-stock-block-note")).toBeVisible();
    await expect(page.locator("[data-cart-quote-error]")).toHaveCount(0);
    await expect(page.getByText("بەزى قىسىملار تەمىنلەنمەيدۇ")).toBeVisible();
    await expect(page.locator("#checkoutCard")).toBeHidden();
    await expectGuestSetCart(page);
    expect(holds.quoteCalls).toBe(0);
  });
});

test.describe("set-cart live quote settlement", () => {
  test.skip(!LIVE_SET_CART, "set KUTADGU_LIVE_SET_CART=1 for the public read/quote check");

  test("write-guarded guest set add then cart.html reaches 750 without a click", async ({ page }) => {
    const blocked = [];
    await page.addInitScript(() => {
      window.__kutadguGuestGuard = true;
      try {
        if (!sessionStorage.getItem("__kutadguGuestOnce")) {
          sessionStorage.setItem("__kutadguGuestOnce", "1");
          localStorage.clear();
        }
      } catch (error) {}
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const method = request.method();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
      if (method === "POST" && ALLOW_RPC.includes(rpcName(url))) return route.continue();
      blocked.push({ method, url: url.slice(0, 180) });
      return route.fulfill({ status: 204, contentType: "application/json", body: "[]" });
    });
    await page.route("**/volume-group/series-156**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: shell });
    });
    await page.goto("/volume-group/series-156", { waitUntil: "domcontentloaded" });
    const addSet = page.locator(".volume-add-set");
    await expect(addSet).toBeVisible();
    await expect(addSet).toBeEnabled();
    await addSet.click();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-set-cart-v1") || "[]")))
      .toEqual([expect.objectContaining({ kind: "set", group_id: "1", qty: 1 })]);
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]")))
      .toEqual([]);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    const setRow = page.locator(".cart-volume-set");
    await expect(setRow).toBeVisible();
    const firstState = await setRow.getAttribute("data-set-quote-state");
    const firstTotal = await page.locator(".cart-total strong").textContent();
    if (firstState === "pending") {
      await expect(page.locator(".cart-total strong")).toHaveText("جەزملەۋاتىدۇ…");
      await expectNoExactZeroPrice(page);
    }
    await expectAuthoritative750(page);
    expect(firstState === "pending" || firstState === "ready").toBeTruthy();
    expect(isExactZeroTry(firstTotal)).toBeFalsy();
    expect(blocked.some((item) => /analytics_events|visit-count|\/orders|create_member_order|admin_/i.test(item.url))).toBeFalsy();
    expect(await page.evaluate(() => window.__kutadguGuestGuard)).toBe(true);
  });
});
