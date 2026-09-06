const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function seedShop(page, {
  owner = "guest",
  sessionUser = "",
  expiresAt,
  cart = []
} = {}) {
  await page.addInitScript(({ ownerId, sessionId, sessionExpiresAt, cartItems }) => {
    try {
      localStorage.setItem("kutadgu-cart-v1", cartItems);
      localStorage.setItem("kutadgu-shop-owner-v1", ownerId);
      const authKey = "sb-fxlojnqwyojqjskfggmh-auth-token";
      if (sessionId) {
        localStorage.setItem(authKey, JSON.stringify({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: sessionExpiresAt,
          user: { id: sessionId, aud: "authenticated", role: "authenticated", email: "member@example.com" }
        }));
      } else {
        localStorage.removeItem(authKey);
      }
    } catch (e) {}
  }, {
    ownerId: owner,
    sessionId: sessionUser,
    sessionExpiresAt: expiresAt == null ? Math.floor(Date.now() / 1000) + 3600 : expiresAt,
    cartItems: JSON.stringify(cart)
  });
}

async function mockMemberAuth(page, userId, { delayMs = 0, refreshOk = true } = {}) {
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
    if (!refreshOk) {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "invalid claim" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
  });
  await page.route("**/auth/v1/token**", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (!refreshOk) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "fresh-access-token",
        refresh_token: "fresh-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user
      })
    });
  });
  await page.route("**/auth/v1/logout**", async (route) => {
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/rest/v1/orders**", async (route) => {
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
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

async function mockMemberShop(page, userId, { cartItems = [] } = {}) {
  await page.route("**/rest/v1/member_cart_items**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartItems.map((item) => ({
        user_id: userId,
        book_id: String(item.id),
        quantity: Number(item.qty) || 1
      })))
    });
  });
  await page.route("**/rest/v1/member_favorites**", async (route) => {
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function headerBadge(page) {
  return page.evaluate(() => {
    const el = document.querySelector("header.kutadgu-public-header a[href='/cart.html'] .cart-count");
    if (!el) return { text: "", state: "", hidden: true };
    const cs = getComputedStyle(el);
    return {
      text: String(el.textContent || "").trim(),
      state: String(el.getAttribute("data-kutadgu-count-state") || ""),
      hidden: el.hidden || cs.visibility === "hidden"
    };
  });
}

async function bottomBadge(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".mobile-bottom-nav a[href='/cart.html'] .cart-count");
    if (!el) return { text: "", state: "", present: false };
    return {
      present: true,
      text: String(el.textContent || "").trim(),
      state: String(el.getAttribute("data-kutadgu-count-state") || "")
    };
  });
}

test.describe("desktop account header safe cart count", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A desktop /account.html guest-owned cart shows total qty", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await seedShop(page, { owner: "guest", cart: [{ id: "102", qty: 2 }, { id: "103", qty: 3 }] });
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await headerBadge(page)).text).toBe("5");
    expect((await headerBadge(page)).state).toBe("ready");
  });

  test("B desktop /account.html foreign member cart does not expose qty", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await seedShop(page, { owner: OWNER_A, sessionUser: OWNER_B, cart: [{ id: "102", qty: 9 }] });
    await mockMemberAuth(page, OWNER_B);
    await mockMemberShop(page, OWNER_B, { cartItems: [] });
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!(window.KutadguMember && window.KutadguMember.sessionBootDone && window.KutadguMember.sessionBootDone()));
    const badge = await headerBadge(page);
    expect(badge.text).not.toBe("9");
    expect(["0", ""]).toContain(badge.text);
  });

  test("C current authenticated owner count appears after identity resolves", async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1366, height: 800 });
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      expiresAt: Math.floor(Date.now() / 1000) - 120,
      cart: [{ id: "102", qty: 4 }]
    });
    await mockMemberAuth(page, OWNER_A, { delayMs: 1600 });
    await mockMemberShop(page, OWNER_A, { cartItems: [{ id: "102", qty: 4 }] });
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    const during = await headerBadge(page);
    expect(during.text).not.toBe("4");
    expect(during.hidden || during.text === "" || during.state === "pending" || during.state === "hidden").toBeTruthy();
    await page.waitForFunction(() => {
      const user = window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser();
      return !!(user && user.id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    }, null, { timeout: 20_000 });
    await expect.poll(async () => (await headerBadge(page)).text).toBe("4");
  });

  test("D sign-out removes the previous member cart count", async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1366, height: 800 });
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      cart: [{ id: "102", qty: 4 }]
    });
    await mockMemberAuth(page, OWNER_A);
    await mockMemberShop(page, OWNER_A, { cartItems: [{ id: "102", qty: 4 }] });
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await headerBadge(page)).text).toBe("4");
    await page.evaluate(async () => { await window.KutadguMember.signOut(); });
    await expect.poll(async () => (await headerBadge(page)).text).not.toBe("4");
    expect((await headerBadge(page)).text).toBe("0");
  });

  test("E mobile bottom-nav cart count still works for a guest cart", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedShop(page, { owner: "guest", cart: [{ id: "102", qty: 2 }] });
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!document.querySelector(".mobile-bottom-nav"));
    await expect.poll(async () => (await bottomBadge(page)).text).toBe("2");
    await expect.poll(async () => (await headerBadge(page)).text).toBe("2");
  });

  test("F homepage and cart badges still follow the storefront cart", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await seedShop(page, { owner: "guest", cart: [{ id: "102", qty: 2 }] });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => H.badgeCount(page)).toBe(2);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => (await headerBadge(page)).text).toBe("2");
  });
});
