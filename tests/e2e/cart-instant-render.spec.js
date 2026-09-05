const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const PREVIEW_TITLE = "سېۋەت ئالدىن كۆرۈش كىتابى";
const LIVE_TITLE = "نۆۋەتتىكى رەسمىي كىتاب";
const PREVIEW_PRICE = 11;
const LIVE_PRICE = 99;
const BOOK_ID = "91001";

function bookRow(overrides = {}) {
  return {
    id: Number(BOOK_ID),
    title: LIVE_TITLE,
    author: "رەسمىي ئاپتور",
    price: LIVE_PRICE,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 8,
    stock_status: "in_stock",
    sales_count: 1,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

function displayStore(items) {
  return JSON.stringify({ v: 1, items });
}

async function seedCart(page, { snapshot = true, extraSnapshot = false, malicious = false, owner = "guest", sessionUser = "", expiresAt } = {}) {
  await page.addInitScript(({ cart, display, ownerId, sessionId, sessionExpiresAt }) => {
    try {
      localStorage.setItem("kutadgu-cart-v1", cart);
      if (display) localStorage.setItem("kutadgu-cart-display-v1", display);
      else localStorage.removeItem("kutadgu-cart-display-v1");
      localStorage.setItem("kutadgu-shop-owner-v1", ownerId);
      const authKey = "sb-fxlojnqwyojqjskfggmh-auth-token";
      if (sessionId) {
        const session = {
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          user: { id: sessionId, aud: "authenticated", role: "authenticated", email: "member@example.com" }
        };
        if (sessionExpiresAt !== "missing") session.expires_at = sessionExpiresAt;
        localStorage.setItem(authKey, JSON.stringify(session));
      } else {
        localStorage.removeItem(authKey);
      }
    } catch (e) {}
  }, {
    cart: JSON.stringify([{ id: BOOK_ID, qty: 1 }]),
    ownerId: owner,
    sessionId: sessionUser,
    sessionExpiresAt: expiresAt == null ? Math.floor(Date.now() / 1000) + 3600 : expiresAt,
    display: snapshot ? displayStore({
      [BOOK_ID]: malicious ? {
        id: BOOK_ID,
        title: "<img src=x onerror=alert(1)><script>window.__xss=1</script>",
        author: "evil",
        price: PREVIEW_PRICE,
        image: "javascript:alert(1)"
      } : {
        id: BOOK_ID,
        title: PREVIEW_TITLE,
        author: "ئالدىن كۆرۈش ئاپتور",
        price: PREVIEW_PRICE,
        image: "/kutadgu-logo.png",
        href: "/book/91001",
        stock: 3,
        stockStatus: "in_stock"
      },
      ...(extraSnapshot ? {
        "99999": {
          id: "99999",
          title: "قالدۇق سىنپشوت",
          author: "",
          price: 1,
          image: "/kutadgu-logo.png"
        }
      } : {})
    }) : null
  });
}

async function mockMemberAuth(page, userId) {
  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.com",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z"
  };
  await page.route("**/auth/v1/user**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(user)
    });
  });
  await page.route("**/auth/v1/token**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user
      })
    });
  });
  await page.route("**/rest/v1/profiles**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: userId, full_name: "Test Member", status: "active" }])
    });
  });
  for (const rpc of ["record_member_visit", "record_member_login"]) {
    await page.route(`**/rest/v1/rpc/${rpc}**`, async (route) => {
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    });
  }
}

async function mockDelayedMemberShop(page, { userId, cartItems = [], delayMs = 2500 } = {}) {
  let cloudCart = cartItems.map((item) => ({
    user_id: userId,
    book_id: String(item.id),
    quantity: Number(item.qty) || 1
  }));
  let firstCartGet = true;
  let firstFavGet = true;
  await page.route("**/rest/v1/member_cart_items**", async (route) => {
    const method = String(route.request().method() || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      if (firstCartGet) {
        firstCartGet = false;
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cloudCart)
      });
    }
    if (method === "DELETE") {
      cloudCart = [];
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    const posted = route.request().postDataJSON();
    const rows = Array.isArray(posted) ? posted : posted ? [posted] : [];
    for (const row of rows) {
      if (!row || !row.book_id) continue;
      cloudCart.push({
        user_id: userId,
        book_id: String(row.book_id),
        quantity: Number(row.quantity) || 1
      });
    }
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(cloudCart)
    });
  });
  await page.route("**/rest/v1/member_favorites**", async (route) => {
    const method = String(route.request().method() || "GET").toUpperCase();
    if ((method === "GET" || method === "HEAD") && firstFavGet) {
      firstFavGet = false;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function mockBooks(page, { delayMs = 0, books = [bookRow()] } = {}) {
  await page.route("**/rest/v1/books**", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const req = route.request();
    const method = req.method();
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

test.describe("cart instant display snapshot", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A instant preview appears before delayed catalog", async ({ page }) => {
    test.setTimeout(45_000);
    await seedCart(page, { snapshot: true });
    await mockBooks(page, { delayMs: 2500, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText(PREVIEW_TITLE, { timeout: 4000 });
    await expect(page.locator("#cartItems .cart-item.is-skeleton")).toHaveCount(0);
    await expect(page.locator("#cartItems")).not.toContainText(/سېۋەت ھازىرچە بوش/);
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "pending");
    await expect(page.locator("#cartItems [data-plus]")).toBeDisabled();
    await expect(page.locator("#cartItems [data-minus]")).toBeDisabled();
    await expect(page.locator("#cartItems [data-remove]")).toBeEnabled();
    await expect(page.locator("#checkoutCard")).toBeHidden();
    await expect.poll(async () => page.evaluate(() => window.kutadguShop && window.kutadguShop.cartHydrationPending && window.kutadguShop.cartHydrationPending())).toBe(true);
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "ready");
  });

  test("B stale snapshot title/price refresh to live catalog values", async ({ page }) => {
    test.setTimeout(45_000);
    await seedCart(page, { snapshot: true });
    await mockBooks(page, { delayMs: 1800, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText(PREVIEW_TITLE, { timeout: 4000 });
    await expect(page.locator("#cartItems .cart-unit-price")).toContainText("11");
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
    await expect(page.locator("#cartItems .cart-unit-price")).toContainText("99");
    const snap = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("kutadgu-cart-display-v1") || "{}"); }
      catch (e) { return {}; }
    });
    expect(snap.items?.[BOOK_ID]?.title).toBe(LIVE_TITLE);
    expect(Number(snap.items?.[BOOK_ID]?.price)).toBe(LIVE_PRICE);
  });

  test("C snapshot price is not used for WhatsApp order before or after hydrate", async ({ page }) => {
    test.setTimeout(45_000);
    await seedCart(page, { snapshot: true });
    await mockBooks(page, { delayMs: 1800, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText(PREVIEW_TITLE, { timeout: 4000 });
    const pendingOrder = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(pendingOrder).toBeNull();
    await expect(page.locator("#checkoutCard")).toBeHidden();
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
    await expect(page.locator("#checkoutCard")).toBeVisible();
    await page.locator("#customerName").fill("Playwright Test", { force: true });
    await page.locator("#customerPhone").fill("5550000111", { force: true });
    await page.locator("#customerAddress").fill("Test street 1", { force: true });
    const order = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(order).toBeTruthy();
    expect(order.text).toContain(LIVE_TITLE);
    expect(order.text).toContain("99");
    expect(order.text).not.toContain(PREVIEW_TITLE);
    expect(order.total).toBe(LIVE_PRICE);
  });

  test("D old CART_KEY without snapshot still uses skeleton then hydrates", async ({ page }) => {
    test.setTimeout(45_000);
    await seedCart(page, { snapshot: false });
    await mockBooks(page, { delayMs: 1800, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-item.is-skeleton")).toHaveCount(1, { timeout: 4000 });
    await expect(page.locator("#cartItems")).not.toContainText(/سېۋەت ھازىرچە بوش/);
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(0);
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
  });

  test("E removed cart item snapshot is pruned", async ({ page }) => {
    test.setTimeout(45_000);
    await seedCart(page, { snapshot: true, extraSnapshot: true });
    await mockBooks(page, { delayMs: 200, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
    const afterHydrate = await page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-display-v1") || "{}"));
    expect(afterHydrate.items?.["99999"]).toBeFalsy();
    await page.locator("#cartItems [data-remove]").click();
    await expect.poll(async () => (await H.readCart(page)).length).toBe(0);
    const afterRemove = await page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-display-v1") || "{}"));
    expect(afterRemove.items?.[BOOK_ID]).toBeFalsy();
    expect(Object.keys(afterRemove.items || {})).toEqual([]);
  });

  test("F malicious snapshot title/cover cannot inject HTML", async ({ page }) => {
    test.setTimeout(45_000);
    await seedCart(page, { snapshot: true, malicious: true });
    await mockBooks(page, { delayMs: 1800, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toBeVisible({ timeout: 4000 });
    const injected = await page.evaluate(() => {
      const host = document.querySelector("#cartItems");
      const title = document.querySelector("#cartItems .cart-title");
      const imgs = [...(host?.querySelectorAll("img") || [])].map((img) => img.getAttribute("src") || "");
      return {
        xss: window.__xss === 1,
        titleHtml: title ? title.innerHTML : "",
        titleText: title ? title.textContent : "",
        scriptNodes: host ? host.querySelectorAll("script").length : 0,
        imgs
      };
    });
    expect(injected.xss).toBeFalsy();
    expect(injected.scriptNodes).toBe(0);
    expect(injected.titleHtml).not.toMatch(/<img/i);
    expect(injected.titleHtml).not.toMatch(/<script/i);
    expect(injected.titleText).toContain("<img");
    expect(injected.imgs.every((src) => !/javascript:/i.test(src))).toBeTruthy();
  });

  test("G partial snapshot keeps skeleton and does not invent a raw-id row", async ({ page }) => {
    test.setTimeout(45_000);
    const secondId = "91002";
    const secondTitle = "ئىككىنچى رەسمىي كىتاب";
    await page.addInitScript(({ cart, display }) => {
      try {
        localStorage.setItem("kutadgu-cart-v1", cart);
        localStorage.setItem("kutadgu-cart-display-v1", display);
        localStorage.setItem("kutadgu-shop-owner-v1", "guest");
      } catch (e) {}
    }, {
      cart: JSON.stringify([{ id: BOOK_ID, qty: 1 }, { id: secondId, qty: 1 }]),
      display: displayStore({
        [BOOK_ID]: {
          id: BOOK_ID,
          title: PREVIEW_TITLE,
          author: "ئالدىن كۆرۈش ئاپتور",
          price: PREVIEW_PRICE,
          image: "/kutadgu-logo.png",
          stock: 8,
          stockStatus: "in_stock"
        }
      })
    });
    await mockBooks(page, {
      delayMs: 1800,
      books: [
        bookRow(),
        bookRow({ id: Number(secondId), title: secondTitle, price: 44, stock: 4 })
      ]
    });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-item.is-skeleton")).toHaveCount(2, { timeout: 4000 });
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(0);
    await expect(page.locator("#cartItems")).not.toContainText(PREVIEW_TITLE);
    await expect(page.locator("#cartItems")).not.toContainText(secondId);
    await expect(page.locator("#cartItems")).not.toContainText(/سېۋەت ھازىرچە بوش/);
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(2, { timeout: 20_000 });
    await expect(page.locator("#cartItems .cart-title", { hasText: LIVE_TITLE })).toHaveCount(1);
    await expect(page.locator("#cartItems .cart-title", { hasText: secondTitle })).toHaveCount(1);
    const snap = await page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-display-v1") || "{}"));
    expect(snap.items?.[BOOK_ID]?.title).toBe(LIVE_TITLE);
    expect(snap.items?.[secondId]?.title).toBe(secondTitle);
  });

  test("H pending preview disables qty controls and ignores stale snapshot stock", async ({ page }) => {
    test.setTimeout(45_000);
    await page.addInitScript(({ cart, display }) => {
      try {
        localStorage.setItem("kutadgu-cart-v1", cart);
        localStorage.setItem("kutadgu-cart-display-v1", display);
        localStorage.setItem("kutadgu-shop-owner-v1", "guest");
      } catch (e) {}
    }, {
      cart: JSON.stringify([{ id: BOOK_ID, qty: 1 }]),
      display: displayStore({
        [BOOK_ID]: {
          id: BOOK_ID,
          title: PREVIEW_TITLE,
          author: "ئالدىن كۆرۈش ئاپتور",
          price: PREVIEW_PRICE,
          image: "/kutadgu-logo.png",
          stock: 8,
          stockStatus: "in_stock"
        }
      })
    });
    await mockBooks(page, { delayMs: 1800, books: [bookRow({ stock: 1, stock_status: "in_stock" })] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText(PREVIEW_TITLE, { timeout: 4000 });
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "pending");
    const plus = page.locator("#cartItems [data-plus]");
    const minus = page.locator("#cartItems [data-minus]");
    await expect(plus).toBeDisabled();
    await expect(minus).toBeDisabled();
    await expect(plus).toHaveAttribute("aria-disabled", "true");
    await expect(minus).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#cartItems [data-remove]")).toBeEnabled();
    await plus.click({ force: true });
    await minus.click({ force: true });
    await page.evaluate(() => {
      const plusBtn = document.querySelector("#cartItems [data-plus]");
      const minusBtn = document.querySelector("#cartItems [data-minus]");
      if (plusBtn) {
        plusBtn.disabled = false;
        plusBtn.removeAttribute("aria-disabled");
        plusBtn.click();
      }
      if (minusBtn) {
        minusBtn.disabled = false;
        minusBtn.removeAttribute("aria-disabled");
        minusBtn.click();
      }
    });
    expect(Number((await H.readCart(page))[0]?.qty)).toBe(1);
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "ready");
    await expect(page.locator("#cartItems [data-plus]")).toBeDisabled();
    await expect(page.locator("#cartItems [data-plus]")).toHaveAttribute("aria-disabled", "true");
    expect(Number((await H.readCart(page))[0]?.qty)).toBe(1);
  });

  test("signed-in current owner paints snapshot before delayed catalog and member cart", async ({ page }) => {
    test.setTimeout(45_000);
    const owner = "11111111-1111-4111-8111-111111111111";
    await seedCart(page, { snapshot: true, owner, sessionUser: owner });
    await mockMemberAuth(page, owner);
    await mockDelayedMemberShop(page, { userId: owner, cartItems: [{ id: BOOK_ID, qty: 1 }], delayMs: 2500 });
    await mockBooks(page, { delayMs: 2500, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText(PREVIEW_TITLE, { timeout: 4000 });
    await expect(page.locator("#cartItems .cart-item.is-skeleton")).toHaveCount(0);
    await expect(page.locator("#cartItems")).not.toContainText(/سېۋەت ھازىرچە بوش/);
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "pending");
    await expect(page.locator("#cartItems [data-plus]")).toBeDisabled();
    await expect(page.locator("#cartItems [data-minus]")).toBeDisabled();
    await expect(page.locator("#checkoutCard")).toBeHidden();
    const pendingOrder = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(pendingOrder).toBeNull();
    await expect.poll(async () => page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]").map((x) => String(x.id)); }
      catch (e) { return []; }
    })).toContain(BOOK_ID);
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "ready");
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(1);
    await expect(page.locator("#cartItems .cart-unit-price")).toContainText("99");
  });

  test("signed-in same-owner delayed empty cloud does not erase the local cart", async ({ page }) => {
    test.setTimeout(45_000);
    const owner = "11111111-1111-4111-8111-111111111111";
    await seedCart(page, { snapshot: true, owner, sessionUser: owner });
    await mockMemberAuth(page, owner);
    await mockDelayedMemberShop(page, { userId: owner, cartItems: [], delayMs: 2500 });
    await mockBooks(page, { delayMs: 2500, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText(PREVIEW_TITLE, { timeout: 4000 });
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "pending");
    await expect(page.locator("#checkoutCard")).toBeHidden();
    await expect(page.locator("#cartItems .cart-title")).toHaveText(LIVE_TITLE, { timeout: 20_000 });
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "ready");
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(1);
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]"); }
      catch (e) { return []; }
    });
    expect(stored.map((x) => String(x.id))).toEqual([BOOK_ID]);
    expect(Number(stored[0].qty)).toBe(1);
  });

  test("expired persisted session does not flash the previous member cart", async ({ page }) => {
    test.setTimeout(45_000);
    const owner = "11111111-1111-4111-8111-111111111111";
    await seedCart(page, {
      snapshot: true,
      owner,
      sessionUser: owner,
      expiresAt: Math.floor(Date.now() / 1000) - 120
    });
    await mockBooks(page, { delayMs: 2500, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems")).toContainText(/سېۋەت ھازىرچە بوش/, { timeout: 4000 });
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(0);
    await expect(page.locator("#cartItems")).not.toContainText(PREVIEW_TITLE);
    await page.waitForTimeout(800);
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(0);
  });

  test("stale owner leftover cart is not shown as the current member cart", async ({ page }) => {
    test.setTimeout(45_000);
    const owner = "11111111-1111-4111-8111-111111111111";
    await seedCart(page, { snapshot: true, owner: "stale", sessionUser: owner });
    await mockBooks(page, { delayMs: 2500, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems")).toContainText(/سېۋەت ھازىرچە بوش/, { timeout: 4000 });
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(0);
    await page.waitForTimeout(800);
    await expect(page.locator("#cartItems")).toContainText(/سېۋەت ھازىرچە بوش/);
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(0);
  });

  test("different persisted session does not flash the previous user's cart", async ({ page }) => {
    test.setTimeout(45_000);
    await seedCart(page, {
      snapshot: true,
      owner: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionUser: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    });
    await mockBooks(page, { delayMs: 2500, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems")).toContainText(/سېۋەت ھازىرچە بوش/, { timeout: 4000 });
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(0);
    await expect(page.locator("#cartItems")).not.toContainText(PREVIEW_TITLE);
  });
});
