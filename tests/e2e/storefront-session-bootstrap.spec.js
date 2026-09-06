const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOOK_A = "91001";
const BOOK_B = "91002";
const BOOK_C = "91003";

function bookRow(id, title) {
  return {
    id: Number(id),
    title,
    author: "رەسمىي ئاپتور",
    price: 20,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 8,
    stock_status: "in_stock",
    sales_count: 1,
    created_at: "2026-08-01T00:00:00Z"
  };
}

const BOOKS = [
  bookRow(BOOK_A, "كىتاب A"),
  bookRow(BOOK_B, "كىتاب B"),
  bookRow(BOOK_C, "كىتاب C")
];

function displayStore(ids) {
  const items = {};
  for (const id of ids) {
    const book = BOOKS.find((row) => String(row.id) === String(id));
    items[id] = {
      id,
      title: book.title,
      author: book.author,
      price: book.price,
      image: "/kutadgu-logo.png",
      stock: book.stock,
      stockStatus: book.stock_status
    };
  }
  return JSON.stringify({ v: 1, items });
}

async function seedShop(page, {
  owner = "guest",
  sessionUser = "",
  expiresAt,
  refreshToken = "test-refresh-token",
  cart = [],
  fav = [],
  snapshotIds = []
} = {}) {
  await page.addInitScript(({ ownerId, sessionId, sessionExpiresAt, refresh, cartItems, favItems, display }) => {
    try {
      localStorage.setItem("kutadgu-cart-v1", cartItems);
      localStorage.setItem("kutadgu-favorites-v1", favItems);
      if (display) localStorage.setItem("kutadgu-cart-display-v1", display);
      else localStorage.removeItem("kutadgu-cart-display-v1");
      localStorage.setItem("kutadgu-shop-owner-v1", ownerId);
      const authKey = "sb-fxlojnqwyojqjskfggmh-auth-token";
      if (sessionId) {
        localStorage.setItem(authKey, JSON.stringify({
          access_token: "test-access-token",
          refresh_token: refresh,
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
    refresh: refreshToken,
    cartItems: JSON.stringify(cart),
    favItems: JSON.stringify(fav),
    display: snapshotIds.length ? displayStore(snapshotIds) : null
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

function parseBookIdFilter(url) {
  const rawUrl = String(url || "");
  const encodedIn = rawUrl.match(/book_id=in\.(\((?:[^)]|%29)+)/i);
  const plainIn = rawUrl.match(/book_id=in\.\(([^)]*)\)/i);
  const body = encodedIn ? encodedIn[1] : (plainIn ? `(${plainIn[1]})` : "");
  if (body) {
    const inner = decodeURIComponent(body).replace(/^\(/, "").replace(/\)$/, "");
    const ids = inner.split(",").map((part) => part.replace(/^"+|"+$/g, "").trim()).filter(Boolean);
    if (ids.length) return ids;
  }
  return null;
}

async function mockMemberShop(page, userId, { cartItems = [], favItems = [] } = {}) {
  let cloudCart = cartItems.map((item) => ({
    user_id: userId,
    book_id: String(item.id),
    quantity: Number(item.qty) || 1
  }));
  let cloudFav = favItems.map((id) => ({ user_id: userId, book_id: String(id) }));
  const writes = [];
  await page.route("**/rest/v1/member_cart_items**", async (route) => {
    const method = String(route.request().method() || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudCart) });
    }
    writes.push("CART_" + method);
    if (method === "PATCH") {
      const posted = route.request().postDataJSON() || {};
      const quantity = Number(posted.quantity) || 1;
      const ids = parseBookIdFilter(route.request().url()) || [];
      const bookId = ids[0];
      if (bookId) {
        const hit = cloudCart.find((item) => String(item.book_id) === String(bookId));
        if (hit) hit.quantity = quantity;
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudCart) });
    }
    if (method === "DELETE") {
      const ids = parseBookIdFilter(route.request().url());
      if (!ids) writes.push("UNFILTERED_CART_DELETE");
      else {
        const drop = new Set(ids.map(String));
        cloudCart = cloudCart.filter((row) => !drop.has(String(row.book_id)));
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    const posted = route.request().postDataJSON();
    const rows = Array.isArray(posted) ? posted : posted ? [posted] : [];
    for (const row of rows) {
      if (!row || !row.book_id) continue;
      const hit = cloudCart.find((item) => String(item.book_id) === String(row.book_id));
      if (hit) hit.quantity = Number(row.quantity) || 1;
      else cloudCart.push({ user_id: userId, book_id: String(row.book_id), quantity: Number(row.quantity) || 1 });
    }
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(cloudCart) });
  });
  await page.route("**/rest/v1/member_favorites**", async (route) => {
    const method = String(route.request().method() || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudFav) });
    }
    writes.push("FAV_" + method);
    if (method === "DELETE") {
      const ids = parseBookIdFilter(route.request().url());
      if (!ids) writes.push("UNFILTERED_FAV_DELETE");
      else {
        const drop = new Set(ids.map(String));
        cloudFav = cloudFav.filter((row) => !drop.has(String(row.book_id)));
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    const posted = route.request().postDataJSON();
    const rows = Array.isArray(posted) ? posted : posted ? [posted] : [];
    for (const row of rows) {
      if (!row || !row.book_id) continue;
      if (!cloudFav.some((item) => String(item.book_id) === String(row.book_id))) {
        cloudFav.push({ user_id: userId, book_id: String(row.book_id) });
      }
    }
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(cloudFav) });
  });
  return {
    writes,
    readCloudCart() { return cloudCart.slice(); },
    readCloudFav() { return cloudFav.slice(); }
  };
}

async function mockBooks(page) {
  await page.route("**/rest/v1/books**", async (route) => {
    const method = route.request().method();
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${BOOKS.length}` },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": `0-${BOOKS.length - 1}/${BOOKS.length}` },
      body: JSON.stringify(BOOKS)
    });
  });
}

async function waitForMemberUser(page, userId) {
  await page.waitForFunction((id) => {
    const user = window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser();
    if (!user || !user.id) return false;
    return !id || String(user.id) === String(id);
  }, userId || "", { timeout: 20_000 });
}

async function ensureCatalogBook(page, id) {
  await page.evaluate(async (bookId) => {
    if (window.kutadguShop && typeof window.kutadguShop.hydrateBooksByIds === "function") {
      await window.kutadguShop.hydrateBooksByIds([bookId]);
    }
  }, id);
  await page.waitForFunction((bookId) => !!(window.kutadguShop && window.kutadguShop.find && window.kutadguShop.find(bookId)), id, { timeout: 10_000 });
}

async function readCartIds(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]").map((row) => String(row.id)); }
    catch (e) { return []; }
  });
}

async function readFavIds(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("kutadgu-favorites-v1") || "[]").map(String); }
    catch (e) { return []; }
  });
}

async function readOwner(page) {
  return page.evaluate(() => {
    try { return String(localStorage.getItem("kutadgu-shop-owner-v1") || ""); }
    catch (e) { return ""; }
  });
}

test.describe("storefront signed-in session bootstrap", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("guest add-to-cart increments the badge immediately", async ({ page }) => {
    await seedShop(page, { owner: "guest", cart: [] });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await ensureCatalogBook(page, BOOK_A);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_A);
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    expect(await readCartIds(page)).toEqual([BOOK_A]);
    expect(await readOwner(page)).toBe("guest");
  });

  test("fresh signed-in session uses storefront cart without visiting Account", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      cart: [{ id: BOOK_A, qty: 1 }],
      snapshotIds: [BOOK_A]
    });
    await mockMemberAuth(page, OWNER_A);
    await mockMemberShop(page, OWNER_A, { cartItems: [{ id: BOOK_A, qty: 1 }] });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    await ensureCatalogBook(page, BOOK_C);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_C);
    await expect.poll(async () => (await readCartIds(page)).slice().sort()).toEqual([BOOK_A, BOOK_C].sort());
    await expect.poll(async () => H.badgeCount(page)).toBe(2);
    expect(page.url()).not.toContain("account.html");
  });

  test("expired refreshable session restores storefront cart without Account", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      expiresAt: Math.floor(Date.now() / 1000) - 120,
      cart: [{ id: BOOK_A, qty: 1 }],
      snapshotIds: [BOOK_A]
    });
    await mockMemberAuth(page, OWNER_A);
    await mockMemberShop(page, OWNER_A, { cartItems: [{ id: BOOK_A, qty: 1 }] });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page, OWNER_A);
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    await ensureCatalogBook(page, BOOK_C);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_C);
    await expect.poll(async () => (await readCartIds(page)).slice().sort()).toEqual([BOOK_A, BOOK_C].sort());
    await expect.poll(async () => H.badgeCount(page)).toBe(2);
    expect(page.url()).not.toContain("account.html");
  });

  test("early add during session bootstrap survives and does not destroy local cart", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      expiresAt: Math.floor(Date.now() / 1000) - 120,
      cart: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
      snapshotIds: [BOOK_A, BOOK_B]
    });
    await mockMemberAuth(page, OWNER_A, { delayMs: 1800 });
    const shopMock = await mockMemberShop(page, OWNER_A, {
      cartItems: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }]
    });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await ensureCatalogBook(page, BOOK_C);
    expect(await page.evaluate(() => !!(window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser()))).toBe(false);
    const during = await page.evaluate((id) => {
      window.kutadguShop.add(id);
      let cart = [];
      try { cart = JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]").map((row) => String(row.id)); }
      catch (e) {}
      const toast = document.querySelector(".shop-toast");
      const toastText = toast && String(toast.style.opacity || "") !== "0" ? String(toast.textContent || "") : "";
      const badge = [...document.querySelectorAll(".cart-count")].map((el) => String(el.textContent || "").trim());
      const live = !!(window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser());
      return { cart, toastText, badge, live };
    }, BOOK_C);
    expect(during.live).toBe(false);
    expect(during.cart).toEqual([BOOK_A, BOOK_B]);
    expect(await readOwner(page)).toBe(OWNER_A);
    expect(during.badge.every((n) => n === "0")).toBe(true);
    expect(during.toastText).not.toMatch(/كىتاب سېۋەتكە قوشۇلدى/);
    await waitForMemberUser(page, OWNER_A);
    await expect.poll(async () => (await readCartIds(page)).slice().sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    await expect.poll(async () => H.badgeCount(page)).toBe(3);
    await expect.poll(async () => shopMock.readCloudCart().map((row) => String(row.book_id)).sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    expect(shopMock.writes).not.toContain("UNFILTERED_CART_DELETE");
  });

  test("valid persisted session does not guest-recover before member identity resolves", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      cart: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
      snapshotIds: [BOOK_A, BOOK_B]
    });
    await mockMemberAuth(page, OWNER_A, { delayMs: 1800 });
    const shopMock = await mockMemberShop(page, OWNER_A, {
      cartItems: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }]
    });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await ensureCatalogBook(page, BOOK_C);
    expect(await page.evaluate(() => !!(window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser()))).toBe(false);
    const during = await page.evaluate((id) => {
      window.kutadguShop.add(id);
      let cart = [];
      try { cart = JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]").map((row) => String(row.id)); }
      catch (e) {}
      return {
        owner: String(localStorage.getItem("kutadgu-shop-owner-v1") || ""),
        cart,
        live: !!(window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser())
      };
    }, BOOK_C);
    expect(during.live).toBe(false);
    expect(during.owner).toBe(OWNER_A);
    expect(during.cart.slice().sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    await waitForMemberUser(page, OWNER_A);
    await expect.poll(async () => (await readCartIds(page)).slice().sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    expect(await readOwner(page)).toBe(OWNER_A);
    expect(shopMock.writes).not.toContain("UNFILTERED_CART_DELETE");
  });

  test("early favorite during session bootstrap survives", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      expiresAt: Math.floor(Date.now() / 1000) - 120,
      fav: [BOOK_A, BOOK_B]
    });
    await mockMemberAuth(page, OWNER_A, { delayMs: 1800 });
    const shopMock = await mockMemberShop(page, OWNER_A, { favItems: [BOOK_A, BOOK_B] });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await ensureCatalogBook(page, BOOK_C);
    await page.evaluate((id) => window.kutadguShop.toggleFav(id), BOOK_C);
    expect(await readFavIds(page)).toEqual([BOOK_A, BOOK_B]);
    await waitForMemberUser(page, OWNER_A);
    await expect.poll(async () => (await readFavIds(page)).slice().sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    await expect.poll(async () => shopMock.readCloudFav().map((row) => String(row.book_id)).sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    expect(shopMock.writes).not.toContain("UNFILTERED_FAV_DELETE");
  });

  test("A stored owner plus B authenticated never exposes or writes A state", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_B,
      cart: [{ id: BOOK_A, qty: 1 }],
      fav: [BOOK_A],
      snapshotIds: [BOOK_A]
    });
    await mockMemberAuth(page, OWNER_B);
    await mockMemberShop(page, OWNER_B, { cartItems: [{ id: BOOK_B, qty: 1 }], favItems: [BOOK_B] });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page, OWNER_B);
    await expect.poll(async () => readOwner(page)).toBe(OWNER_B);
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    expect(await page.evaluate(() => window.kutadguShop.cart().map((row) => String(row.id)))).toEqual([BOOK_B]);
    expect(await page.evaluate(() => window.kutadguShop.favorites())).toEqual([BOOK_B]);
    await ensureCatalogBook(page, BOOK_C);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_C);
    await expect.poll(async () => (await page.evaluate(() => window.kutadguShop.cart().map((row) => String(row.id)))).slice().sort()).toEqual([BOOK_B, BOOK_C].sort());
    expect(await page.evaluate(() => window.kutadguShop.cart().map((row) => String(row.id)))).not.toContain(BOOK_A);
    expect(await readOwner(page)).toBe(OWNER_B);
  });

  test("expired unrefreshable session stays fail-closed without destructive cloud writes", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      expiresAt: Math.floor(Date.now() / 1000) - 120,
      cart: [{ id: BOOK_A, qty: 1 }],
      fav: [BOOK_A],
      snapshotIds: [BOOK_A]
    });
    await mockMemberAuth(page, OWNER_A, { refreshOk: false });
    const shopMock = await mockMemberShop(page, OWNER_A, { cartItems: [{ id: BOOK_A, qty: 1 }], favItems: [BOOK_A] });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.waitForFunction(() => !!(window.KutadguMember && typeof window.KutadguMember.sessionBootDone === "function" && window.KutadguMember.sessionBootDone()), null, { timeout: 20_000 });
    expect(await H.badgeCount(page)).toBe(0);
    expect(await page.evaluate(() => window.kutadguShop.cart())).toEqual([]);
    expect(await page.evaluate(() => window.kutadguShop.favorites())).toEqual([]);
    await ensureCatalogBook(page, BOOK_C);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_C);
    await page.evaluate((id) => window.kutadguShop.toggleFav(id), BOOK_C);
    expect(await page.evaluate(() => window.kutadguShop.cart().map((row) => String(row.id)))).toEqual([BOOK_C]);
    expect(await page.evaluate(() => window.kutadguShop.favorites().map(String))).toEqual([BOOK_C]);
    expect(await readOwner(page)).toBe("guest");
    expect(await readCartIds(page)).toEqual([BOOK_C]);
    expect(await readFavIds(page)).toEqual([BOOK_C]);
    expect(shopMock.writes.filter((item) => String(item).includes("UNFILTERED"))).toEqual([]);
    expect(shopMock.writes).toEqual([]);
  });

  test("logout then guest cart works immediately", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, {
      owner: OWNER_A,
      sessionUser: OWNER_A,
      cart: [{ id: BOOK_A, qty: 1 }],
      snapshotIds: [BOOK_A]
    });
    await mockMemberAuth(page, OWNER_A);
    await mockMemberShop(page, OWNER_A, { cartItems: [{ id: BOOK_A, qty: 1 }] });
    await mockBooks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page, OWNER_A);
    await page.evaluate(async () => { await window.KutadguMember.signOut(); });
    await expect.poll(async () => page.evaluate(() => !(window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser()))).toBe(true);
    await expect.poll(async () => H.badgeCount(page)).toBe(0);
    await ensureCatalogBook(page, BOOK_C);
    const afterAdd = await page.evaluate((id) => {
      window.kutadguShop.add(id);
      try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]").map((row) => String(row.id)); }
      catch (e) { return []; }
    }, BOOK_C);
    expect(afterAdd).toEqual([BOOK_C]);
    await expect.poll(async () => H.badgeCount(page)).toBe(1);
    expect(await readCartIds(page)).toEqual([BOOK_C]);
    expect(["guest", "stale"]).toContain(await readOwner(page));
  });

  test("account page still works and storefront has a single member button", async ({ page }) => {
    test.setTimeout(45_000);
    await seedShop(page, { owner: OWNER_A, sessionUser: OWNER_A });
    await mockMemberAuth(page, OWNER_A);
    await mockMemberShop(page, OWNER_A, { cartItems: [] });
    await mockBooks(page);
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#memberPanel")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.locator(".member-account-button").count()).toBe(0);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page, OWNER_A);
    await expect.poll(async () => page.locator(".member-account-button").count()).toBe(1);
  });
});
