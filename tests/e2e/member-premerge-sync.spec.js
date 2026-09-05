const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const OWNER = "11111111-1111-4111-8111-111111111111";
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

async function seedMember(page, { cart = [], fav = [], snapshotIds = [] } = {}) {
  await page.addInitScript(({ cartItems, favItems, ownerId, display, sessionExpiresAt }) => {
    try {
      localStorage.setItem("kutadgu-cart-v1", cartItems);
      localStorage.setItem("kutadgu-favorites-v1", favItems);
      if (display) localStorage.setItem("kutadgu-cart-display-v1", display);
      else localStorage.removeItem("kutadgu-cart-display-v1");
      localStorage.setItem("kutadgu-shop-owner-v1", ownerId);
      localStorage.setItem("sb-fxlojnqwyojqjskfggmh-auth-token", JSON.stringify({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: sessionExpiresAt,
        user: { id: ownerId, aud: "authenticated", role: "authenticated", email: "member@example.com" }
      }));
    } catch (e) {}
  }, {
    cartItems: JSON.stringify(cart),
    favItems: JSON.stringify(fav),
    ownerId: OWNER,
    display: snapshotIds.length ? displayStore(snapshotIds) : null,
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600
  });
}

async function mockMemberAuth(page) {
  const user = {
    id: OWNER,
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.com",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z"
  };
  await page.route("**/auth/v1/user**", async (route) => {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
  });
  await page.route("**/auth/v1/token**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user })
    });
  });
  await page.route("**/rest/v1/profiles**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: OWNER, full_name: "Test Member", status: "active" }])
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
  try {
    const parsed = new URL(rawUrl, "https://example.supabase.co");
    const raw = parsed.searchParams.get("book_id");
    if (!raw) return null;
    const inMatch = String(raw).match(/^in\.\((.*)\)$/i);
    if (inMatch) {
      return inMatch[1].split(",").map((part) => part.replace(/^"+|"+$/g, "").trim()).filter(Boolean);
    }
    const eqMatch = String(raw).match(/^eq\.(.*)$/i);
    if (eqMatch) return [eqMatch[1].replace(/^"+|"+$/g, "")];
  } catch (err) {}
  return null;
}

async function mockDelayedMemberShop(page, {
  cartItems = [],
  favItems = [],
  delayMs = 2500,
  failFirstGet = false,
  control = null
} = {}) {
  let cloudCart = cartItems.map((item) => ({
    user_id: OWNER,
    book_id: String(item.id),
    quantity: Number(item.qty) || 1
  }));
  let cloudFav = favItems.map((id) => ({ user_id: OWNER, book_id: String(id) }));
  let firstCartGet = true;
  let firstFavGet = true;
  const writes = [];
  const gates = control || {};
  function upsertCart(rows) {
    for (const row of rows) {
      if (!row || !row.book_id) continue;
      const id = String(row.book_id);
      const qty = Number(row.quantity) || 1;
      const hit = cloudCart.find((item) => String(item.book_id) === id);
      if (hit) hit.quantity = qty;
      else cloudCart.push({ user_id: OWNER, book_id: id, quantity: qty });
    }
  }
  function deleteCart(ids) {
    if (!ids) {
      writes.push("UNFILTERED_CART_DELETE");
      cloudCart = [];
      return;
    }
    const drop = new Set(ids.map(String));
    cloudCart = cloudCart.filter((row) => !drop.has(String(row.book_id)));
  }
  function upsertFav(rows) {
    for (const row of rows) {
      if (!row || !row.book_id) continue;
      const id = String(row.book_id);
      if (!cloudFav.some((item) => String(item.book_id) === id)) {
        cloudFav.push({ user_id: OWNER, book_id: id });
      }
    }
  }
  function deleteFav(ids) {
    if (!ids) {
      writes.push("UNFILTERED_FAV_DELETE");
      cloudFav = [];
      return;
    }
    const drop = new Set(ids.map(String));
    cloudFav = cloudFav.filter((row) => !drop.has(String(row.book_id)));
  }
  await page.route("**/rest/v1/member_cart_items**", async (route) => {
    const method = String(route.request().method() || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      if (firstCartGet) {
        firstCartGet = false;
        if (failFirstGet) {
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "cloud cart unavailable" }) });
        }
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudCart) });
    }
    writes.push(method);
    if (method === "DELETE") {
      if (gates.failDelete) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "stale delete failed" }) });
      }
      deleteCart(parseBookIdFilter(route.request().url()));
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    const posted = route.request().postDataJSON();
    const rows = Array.isArray(posted) ? posted : posted ? [posted] : [];
    upsertCart(rows);
    if (gates.holdAfterUpsert) await gates.holdAfterUpsert;
    if (gates.failAfterUpsert) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "upsert failed after apply" }) });
    }
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(cloudCart) });
  });
  await page.route("**/rest/v1/member_favorites**", async (route) => {
    const method = String(route.request().method() || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      if (firstFavGet) {
        firstFavGet = false;
        if (failFirstGet) {
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "cloud favorites unavailable" }) });
        }
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudFav) });
    }
    writes.push("FAV_" + method);
    if (method === "DELETE") {
      if (gates.failDelete) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "stale delete failed" }) });
      }
      deleteFav(parseBookIdFilter(route.request().url()));
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    const posted = route.request().postDataJSON();
    const rows = Array.isArray(posted) ? posted : posted ? [posted] : [];
    upsertFav(rows);
    if (gates.holdAfterUpsert) await gates.holdAfterUpsert;
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

async function waitForMemberUser(page) {
  await page.waitForFunction(() => !!(window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser() && window.KutadguMember.getUser().id), null, { timeout: 15_000 });
}

async function ensureCatalogBook(page, id) {
  await page.evaluate(async (bookId) => {
    if (window.kutadguShop && typeof window.kutadguShop.hydrateBooksByIds === "function") {
      await window.kutadguShop.hydrateBooksByIds([bookId]);
    }
  }, id);
  await page.waitForFunction((bookId) => !!(window.kutadguShop && window.kutadguShop.find && window.kutadguShop.find(bookId)), id, { timeout: 10_000 });
}

async function shopReady(page) {
  return page.evaluate(() => {
    const member = window.KutadguMember;
    const user = member && member.getUser && member.getUser();
    return !!(member && member.shopStateReadyFor && user && member.shopStateReadyFor(user.id));
  });
}

async function replaceLocalCartWith(page, nextIds) {
  await page.evaluate((ids) => {
    const current = (() => {
      try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]"); }
      catch (e) { return []; }
    })();
    for (const row of current) {
      if (row && row.id) window.kutadguShop.remove(String(row.id));
    }
    for (const id of ids) window.kutadguShop.add(id);
  }, nextIds);
}

async function openDelayedOwnedCart(page, { delayMs = 2500, control = null } = {}) {
  await seedMember(page, {
    cart: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
    snapshotIds: [BOOK_A, BOOK_B]
  });
  await mockMemberAuth(page);
  const shopMock = await mockDelayedMemberShop(page, {
    cartItems: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
    delayMs,
    control
  });
  await mockBooks(page);
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await H.waitForShop(page);
  await waitForMemberUser(page);
  return shopMock;
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

test.describe("member pre-merge sync safety", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("early add during delayed cloud merge keeps A+B+C", async ({ page }) => {
    test.setTimeout(45_000);
    await seedMember(page, { cart: [], snapshotIds: [] });
    await mockMemberAuth(page);
    await mockDelayedMemberShop(page, {
      cartItems: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
      delayMs: 2500
    });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page);
    await ensureCatalogBook(page, BOOK_C);
    expect(await shopReady(page)).toBe(false);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_C);
    expect(await shopReady(page)).toBe(false);
    expect(await readCartIds(page)).toEqual([BOOK_C]);
    await expect.poll(async () => shopReady(page), { timeout: 20_000 }).toBe(true);
    const ids = (await readCartIds(page)).slice().sort();
    expect(ids).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
  });

  test("early favorite during delayed cloud merge keeps A+B+C", async ({ page }) => {
    test.setTimeout(45_000);
    await seedMember(page, { fav: [] });
    await mockMemberAuth(page);
    await mockDelayedMemberShop(page, {
      favItems: [BOOK_A, BOOK_B],
      delayMs: 2500
    });
    await mockBooks(page);
    await page.goto("/favorites.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page);
    await ensureCatalogBook(page, BOOK_C);
    expect(await shopReady(page)).toBe(false);
    await page.evaluate((id) => window.kutadguShop.toggleFav(id), BOOK_C);
    expect(await shopReady(page)).toBe(false);
    expect(await readFavIds(page)).toEqual([BOOK_C]);
    await expect.poll(async () => shopReady(page), { timeout: 20_000 }).toBe(true);
    expect((await readFavIds(page)).slice().sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
  });

  test("early unfavorite during delayed merge does not resurrect B", async ({ page }) => {
    test.setTimeout(45_000);
    await seedMember(page, { fav: [BOOK_A, BOOK_B] });
    await mockMemberAuth(page);
    await mockDelayedMemberShop(page, {
      favItems: [BOOK_A, BOOK_B],
      delayMs: 2500
    });
    await mockBooks(page);
    await page.goto("/favorites.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page);
    expect(await shopReady(page)).toBe(false);
    await page.evaluate((id) => window.kutadguShop.toggleFav(id), BOOK_B);
    expect(await shopReady(page)).toBe(false);
    expect((await readFavIds(page)).slice().sort()).toEqual([BOOK_A]);
    await expect.poll(async () => shopReady(page), { timeout: 20_000 }).toBe(true);
    expect((await readFavIds(page)).slice().sort()).toEqual([BOOK_A]);
  });

  test("early quantity increase during delayed merge keeps qty2", async ({ page }) => {
    test.setTimeout(45_000);
    await seedMember(page, {
      cart: [{ id: BOOK_A, qty: 1 }],
      snapshotIds: [BOOK_A]
    });
    await mockMemberAuth(page);
    await mockDelayedMemberShop(page, {
      cartItems: [{ id: BOOK_A, qty: 1 }],
      delayMs: 2500
    });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page);
    expect(await shopReady(page)).toBe(false);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_A);
    const during = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]"); }
      catch (e) { return []; }
    });
    expect(during).toHaveLength(1);
    expect(String(during[0].id)).toBe(BOOK_A);
    expect(Number(during[0].qty)).toBe(2);
    await expect.poll(async () => shopReady(page), { timeout: 20_000 }).toBe(true);
    const after = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]"); }
      catch (e) { return []; }
    });
    expect(after).toHaveLength(1);
    expect(String(after[0].id)).toBe(BOOK_A);
    expect(Number(after[0].qty)).toBe(2);
  });

  test("initial merge failure does not replace cloud cart", async ({ page }) => {
    test.setTimeout(45_000);
    await seedMember(page, { cart: [] });
    await mockMemberAuth(page);
    const shopMock = await mockDelayedMemberShop(page, {
      cartItems: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
      failFirstGet: true
    });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await waitForMemberUser(page);
    await ensureCatalogBook(page, BOOK_C);
    await page.evaluate((id) => window.kutadguShop.add(id), BOOK_C);
    await page.waitForTimeout(800);
    expect(await shopReady(page)).toBe(false);
    expect(await readCartIds(page)).toEqual([BOOK_C]);
    expect(shopMock.writes).toEqual([]);
    expect(shopMock.readCloudCart().map((row) => row.book_id).sort()).toEqual([BOOK_A, BOOK_B]);
  });

  test("early remove during delayed merge does not resurrect B", async ({ page }) => {
    test.setTimeout(45_000);
    await seedMember(page, {
      cart: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
      snapshotIds: [BOOK_A, BOOK_B]
    });
    await mockMemberAuth(page);
    await mockDelayedMemberShop(page, {
      cartItems: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
      delayMs: 2500
    });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(2, { timeout: 4000 });
    await waitForMemberUser(page);
    expect(await shopReady(page)).toBe(false);
    await page.locator(`#cartItems [data-remove="${BOOK_B}"]`).click();
    expect(await shopReady(page)).toBe(false);
    expect(await readCartIds(page)).toEqual([BOOK_A]);
    await expect.poll(async () => shopReady(page), { timeout: 20_000 }).toBe(true);
    expect(await readCartIds(page)).toEqual([BOOK_A]);
    await expect(page.locator("#cartItems .cart-title")).toHaveCount(1);
  });

  test("signed-in current owner still paints cart before delayed merge", async ({ page }) => {
    test.setTimeout(45_000);
    await seedMember(page, {
      cart: [{ id: BOOK_A, qty: 1 }],
      snapshotIds: [BOOK_A]
    });
    await mockMemberAuth(page);
    await mockDelayedMemberShop(page, {
      cartItems: [{ id: BOOK_A, qty: 1 }, { id: BOOK_B, qty: 1 }],
      delayMs: 2500
    });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cartItems .cart-title")).toHaveText("كىتاب A", { timeout: 4000 });
    await waitForMemberUser(page);
    expect(await shopReady(page)).toBe(false);
    await expect.poll(async () => shopReady(page), { timeout: 20_000 }).toBe(true);
    expect((await readCartIds(page)).slice().sort()).toEqual([BOOK_A, BOOK_B].sort());
  });

  test("user switch after desired upsert does not wipe existing cloud rows", async ({ page }) => {
    test.setTimeout(45_000);
    let release;
    const holdAfterUpsert = new Promise((resolve) => { release = resolve; });
    await page.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204, body: "" }));
    const shopMock = await openDelayedOwnedCart(page, {
      delayMs: 2500,
      control: { holdAfterUpsert }
    });
    await ensureCatalogBook(page, BOOK_C);
    expect(await shopReady(page)).toBe(false);
    await replaceLocalCartWith(page, [BOOK_C]);
    await expect.poll(() => shopMock.readCloudCart().some((row) => String(row.book_id) === BOOK_C), { timeout: 20_000 }).toBeTruthy();
    const beforeLogout = shopMock.readCloudCart().map((row) => String(row.book_id)).sort();
    expect(beforeLogout).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    const signOutDone = page.evaluate(async () => {
      if (window.KutadguMember && window.KutadguMember.signOut) await window.KutadguMember.signOut();
    });
    await page.waitForTimeout(200);
    release();
    await signOutDone;
    const ids = shopMock.readCloudCart().map((row) => String(row.book_id)).sort();
    expect(ids).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    expect(shopMock.writes).not.toContain("UNFILTERED_CART_DELETE");
    expect(await shopReady(page)).toBe(false);
  });

  test("stale-row cleanup failure keeps existing cloud rows and does not mark ready", async ({ page }) => {
    test.setTimeout(45_000);
    let release;
    const holdAfterUpsert = new Promise((resolve) => { release = resolve; });
    const control = { holdAfterUpsert, failDelete: false };
    const shopMock = await openDelayedOwnedCart(page, {
      delayMs: 2500,
      control
    });
    await ensureCatalogBook(page, BOOK_C);
    expect(await shopReady(page)).toBe(false);
    await replaceLocalCartWith(page, [BOOK_C]);
    await expect.poll(() => shopMock.readCloudCart().some((row) => String(row.book_id) === BOOK_C), { timeout: 20_000 }).toBeTruthy();
    expect(shopMock.readCloudCart().map((row) => String(row.book_id)).sort()).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    control.failDelete = true;
    release();
    await page.waitForTimeout(800);
    expect(await shopReady(page)).toBe(false);
    const ids = shopMock.readCloudCart().map((row) => String(row.book_id)).sort();
    expect(ids).toEqual([BOOK_A, BOOK_B, BOOK_C].sort());
    expect(await readCartIds(page)).toEqual([BOOK_C]);
    expect(shopMock.writes).not.toContain("UNFILTERED_CART_DELETE");
  });

  test("empty desired cart clears only after successful stale delete", async ({ page }) => {
    test.setTimeout(45_000);
    const shopMock = await openDelayedOwnedCart(page, { delayMs: 2500 });
    expect(await shopReady(page)).toBe(false);
    await replaceLocalCartWith(page, []);
    expect(await readCartIds(page)).toEqual([]);
    await expect.poll(async () => shopReady(page), { timeout: 20_000 }).toBe(true);
    expect(await readCartIds(page)).toEqual([]);
    expect(shopMock.readCloudCart()).toEqual([]);
    expect(shopMock.writes).not.toContain("UNFILTERED_CART_DELETE");
  });

  test("empty desired failed delete keeps cloud rows and local empty state", async ({ page }) => {
    test.setTimeout(45_000);
    const shopMock = await openDelayedOwnedCart(page, {
      delayMs: 2500,
      control: { failDelete: true }
    });
    expect(await shopReady(page)).toBe(false);
    await replaceLocalCartWith(page, []);
    expect(await readCartIds(page)).toEqual([]);
    await expect.poll(() => shopMock.writes.includes("DELETE"), { timeout: 20_000 }).toBeTruthy();
    expect(await shopReady(page)).toBe(false);
    expect(await readCartIds(page)).toEqual([]);
    const ids = shopMock.readCloudCart().map((row) => String(row.book_id)).sort();
    expect(ids).toEqual([BOOK_A, BOOK_B].sort());
    expect(shopMock.writes).not.toContain("UNFILTERED_CART_DELETE");
  });
});
