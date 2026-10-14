const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONFIRM = "ئېلخەتتىكى جەزملەشتۈرۈش ئۇلانمىسىنى بېسىپ ئاندىن كىرىڭ";
const SIGNUP_ERROR = "ئەزالىق ئېچىش مەغلۇپ بولدى";

function bookRow(id, title) {
  return {
    id: Number(id),
    title,
    author: "سىناق ئاپتور",
    price: 153,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: false,
    is_new: false,
    stock: 8,
    stock_status: "in_stock",
    sales_count: 0,
    legacy_id: null,
    created_at: "2026-08-01T00:00:00Z"
  };
}

const BOOKS = [
  bookRow(91021, "مېھمان كىتاب"),
  bookRow(91022, "ئىككىنچى كىتاب")
];

function sessionFor(userId, email) {
  return {
    access_token: "test-access-" + userId.slice(0, 8),
    refresh_token: "test-refresh-" + userId.slice(0, 8),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email,
      app_metadata: { provider: "email" },
      user_metadata: { full_name: "يېڭى ئەزا" },
      created_at: "2026-10-12T00:00:00Z"
    }
  };
}

function profileFor(userId) {
  return {
    id: userId,
    full_name: "يېڭى ئەزا",
    status: "active",
    email: "guest-invite@example.com",
    created_at: "2026-10-12T00:00:00Z",
    last_seen_at: "2026-10-12T00:00:00Z",
    visit_count: 1
  };
}

function parseEq(url, key) {
  try {
    const parsed = new URL(String(url || ""), "https://example.supabase.co");
    const raw = parsed.searchParams.get(key);
    if (!raw) return "";
    const match = String(raw).match(/^eq\.(.*)$/i);
    return match ? match[1].replace(/^"+|"+$/g, "") : "";
  } catch (err) {
    return "";
  }
}

async function seedBrowser(page, { cart, owner, session = null }) {
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("kutadgu-e2e-persist-seeded") === "1") return;
    sessionStorage.setItem("kutadgu-e2e-persist-seeded", "1");
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify(seed.cart));
    localStorage.setItem("kutadgu-favorites-v1", "[]");
    localStorage.setItem("kutadgu-shop-owner-v1", seed.owner);
    localStorage.removeItem("kutadgu-cart-display-v1");
    localStorage.removeItem("kutadgu-member-shop-merged-v3");
    if (seed.session) localStorage.setItem("kutadgu-member-auth-v1", JSON.stringify(seed.session));
    else localStorage.removeItem("kutadgu-member-auth-v1");
  }, { cart, owner, session });
}

async function mockBooks(page) {
  await page.route("**/rest/v1/books**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, body: "" });
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

function requestBearer(request) {
  const header = String((request.headers() || {}).authorization || "");
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : "";
}

function expectedBearer(userId) {
  return "test-access-" + String(userId || "").slice(0, 8);
}

function bearerAllowed(request, userId) {
  return requestBearer(request) === expectedBearer(userId);
}

function unauthorized(route) {
  return route.fulfill({
    status: 401,
    contentType: "application/json",
    headers: { "www-authenticate": "Bearer" },
    body: JSON.stringify({ message: "JWT required", code: "PGRST301" })
  });
}

function answerSignup(route, gates) {
  if (route.request().method() === "POST") {
    gates.signupBodies = gates.signupBodies || [];
    gates.signupBodies.push(route.request().postDataJSON());
  }
  if (gates.abortSignup) return route.abort("failed");
  if (gates.failSignup) {
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "signup_failed", message: "signup failed" })
    });
  }
  if (gates.signupMode === "confirm") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: gates.userId,
        aud: "authenticated",
        email: gates.email,
        role: "authenticated",
        identities: [{ provider: "email", user_id: gates.userId }]
      })
    });
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(sessionFor(gates.userId, gates.email))
  });
}

async function installBoundary(page, gates) {
  const leaks = [];
  let cloudCart = (gates.cloudCart || []).map((row) => ({
    user_id: String(row.user_id),
    book_id: String(row.book_id),
    quantity: Number(row.quantity) || 1
  }));
  const cloudFav = [];
  const mutations = [];
  let cartReadsHeld = 0;
  let favReadsHeld = 0;
  await page.route("**://*.supabase.co/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const handled = /\/auth\/v1\/|\/rest\/v1\/(books|profiles|orders|member_cart_items|member_favorites|rpc\/)/.test(url);
    if (handled) return route.fallback();
    if (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE") {
      leaks.push(method + " " + url.split("?")[0]);
      return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ message: "unexpected supabase write" }) });
    }
    return route.fallback();
  });
  gates.visitPosts = [];
  await page.route("**/api/member-visit", async (route) => {
    gates.visitPosts.push({
      body: route.request().postDataJSON(),
      authorization: String(route.request().headers().authorization || "").replace(/^Bearer\s+/i, "")
    });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    if (method === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (url.includes("/signup")) return answerSignup(route, gates);
    if (url.includes("/token")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionFor(gates.userId, gates.email))
      });
    }
    if (url.includes("/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionFor(gates.userId, gates.email).user)
      });
    }
    if (url.includes("/logout")) return route.fulfill({ status: 204, body: "" });
    leaks.push(method + " " + url.split("?")[0]);
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ message: "unexpected auth" }) });
  });
  await page.route("**/rest/v1/profiles**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (!bearerAllowed(route.request(), gates.userId)) return unauthorized(route);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([profileFor(gates.userId)])
    });
  });
  await page.route("**/rest/v1/orders**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (!bearerAllowed(route.request(), gates.userId)) return unauthorized(route);
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/rpc/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (!bearerAllowed(route.request(), gates.userId)) return unauthorized(route);
    const url = route.request().url();
    if (url.includes("is_kutadgu_book_staff")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "false" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.route("**/rest/v1/member_favorites**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (!bearerAllowed(route.request(), gates.userId)) return unauthorized(route);
    if (method === "GET" || method === "HEAD") {
      if (gates.holdReads && favReadsHeld === 0) {
        favReadsHeld += 1;
        gates.readsSeen = cartReadsHeld + favReadsHeld;
        await gates.holdReads;
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudFav) });
    }
    const urlUser = parseEq(route.request().url(), "user_id");
    mutations.push({ table: "favorites", method, user_id: urlUser, urlUser, authorization: requestBearer(route.request()) });
    return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/member_cart_items**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    if (method === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    const urlUser = parseEq(url, "user_id");
    if (!bearerAllowed(request, gates.userId)) return unauthorized(route);
    if (method === "GET" || method === "HEAD") {
      if (gates.holdReads && cartReadsHeld === 0) {
        cartReadsHeld += 1;
        gates.readsSeen = cartReadsHeld + favReadsHeld;
        await gates.holdReads;
      }
      const rows = urlUser ? cloudCart.filter((row) => row.user_id === urlUser) : cloudCart.slice();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (gates.holdCartWrite && method === "POST") {
      gates.cartWriteSeen = true;
      await gates.holdCartWrite;
    }
    if (gates.failCartWrite && method === "POST") {
      mutations.push({ table: "cart", method, user_id: "", urlUser, failed: true, authorization: requestBearer(request) });
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "cart write failed", code: "cart_write_failed" })
      });
    }
    if (method === "POST") {
      const posted = request.postDataJSON();
      const rows = Array.isArray(posted) ? posted : posted ? [posted] : [];
      rows.forEach((row) => {
        const userId = String(row.user_id || "");
        const bookId = String(row.book_id || "");
        const quantity = Number(row.quantity) || 1;
        mutations.push({ table: "cart", method, user_id: userId, urlUser, book_id: bookId, quantity, authorization: requestBearer(request) });
        const hit = cloudCart.find((item) => item.user_id === userId && item.book_id === bookId);
        if (hit) hit.quantity = quantity;
        else cloudCart.push({ user_id: userId, book_id: bookId, quantity });
      });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(cloudCart) });
    }
    if (method === "PATCH") {
      const posted = request.postDataJSON() || {};
      const quantity = Number(posted.quantity) || 1;
      const bookId = parseEq(url, "book_id");
      mutations.push({ table: "cart", method, user_id: urlUser, urlUser, book_id: bookId, quantity, authorization: requestBearer(request) });
      const hit = cloudCart.find((item) => item.user_id === urlUser && item.book_id === bookId);
      if (hit) hit.quantity = quantity;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cloudCart) });
    }
    if (method === "DELETE") {
      mutations.push({ table: "cart", method, user_id: urlUser, urlUser, authorization: requestBearer(request) });
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    leaks.push(method + " " + url.split("?")[0]);
    return route.fulfill({ status: 599, contentType: "application/json", body: "[]" });
  });
  return {
    leaks,
    mutations,
    cloud() {
      return cloudCart.map((row) => ({
        user_id: row.user_id,
        book_id: row.book_id,
        quantity: row.quantity
      })).sort((a, b) => a.book_id.localeCompare(b.book_id) || a.user_id.localeCompare(b.user_id));
    }
  };
}

function scopedCartWrites(mutations, userId) {
  return mutations.filter((row) => row.table === "cart" && !row.failed);
}

async function readCart(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]"); }
    catch (err) { return []; }
  });
}

async function openGuestCart(page) {
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await H.waitForShop(page);
  await page.waitForFunction(() => {
    const member = window.KutadguMember;
    return !!(member && member.sessionBootDone && member.sessionBootDone() === true && member.configured && member.configured() === true && !member.getUser());
  });
  await expect(page.locator("#guestCartInvite")).toBeVisible();
  await expect(page.locator("#guestCartInvite a")).toHaveAttribute("href", "account.html#signup");
}

async function followInviteToSignup(page) {
  await page.locator("#guestCartInvite a").click();
  await expect(page).toHaveURL(/\/account\.html#signup$/);
  await expect(page.locator("#signupForm")).toBeVisible();
  await expect(page.locator("#loginForm")).toBeHidden();
  await expect(page.locator("#signupName")).toBeVisible();
}

async function fillSignup(page) {
  await page.locator("#signupName").fill("يېڭى ئەزا");
  await page.locator("#signupEmail").fill("guest-invite@example.com");
  await page.locator("#signupPassword").fill("password1");
  await page.locator("#signupConfirm").fill("password1");
  await page.locator("#signupForm button[type='submit']").click();
}

async function fillLogin(page) {
  await page.locator("#loginPassword").fill("password1");
  await page.locator("#loginForm button[type='submit']").click();
}

test.describe("guest cart invitation persistence through member.js", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockBooks(page);
  });

  test("signup with a session writes the guest books under that user", async ({ page }) => {
    test.setTimeout(45_000);
    const gates = {
      userId: USER,
      email: "guest-invite@example.com",
      signupMode: "session",
      cloudCart: [{ user_id: USER, book_id: "91021", quantity: 5 }]
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }, { id: "91022", qty: 1 }],
      owner: "guest"
    });
    const shop = await installBoundary(page, gates);
    await openGuestCart(page);
    await followInviteToSignup(page);
    await fillSignup(page);
    await expect.poll(() => shop.cloud()).toEqual([
      { user_id: USER, book_id: "91021", quantity: 5 },
      { user_id: USER, book_id: "91022", quantity: 1 }
    ]);
    await expect(page.locator("#memberPanel")).toBeVisible();
    await expect(page.locator("#authStatus")).not.toContainText("سېۋەت");
    const writes = scopedCartWrites(shop.mutations);
    expect(writes.length).toBeGreaterThan(0);
    writes.forEach((row) => {
      expect(row.user_id).toBe(USER);
      expect(row.urlUser === "" || row.urlUser === USER).toBe(true);
    });
    expect(writes.some((row) => row.user_id && row.user_id !== USER)).toBe(false);
    writes.forEach((row) => expect(row.authorization).toBe(expectedBearer(USER)));
    const posted = gates.signupBodies && gates.signupBodies[0];
    expect(posted && posted.code_challenge_method).toBe("s256");
    expect(posted && posted.code_challenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(posted && posted.data && posted.data.full_name).toBe("يېڭى ئەزا");
    expect(posted && posted.country).toBeUndefined();
    expect(gates.visitPosts.length).toBeGreaterThan(0);
    gates.visitPosts.forEach((visit) => {
      expect(visit.body.country).toBeUndefined();
      expect(visit.body.user_id).toBeUndefined();
      expect(visit.body.page_path).toBeTruthy();
      expect(visit.authorization).toBe(expectedBearer(USER));
    });
    const auth = await page.evaluate(async () => {
      const client = window.KutadguMember.getClient();
      const session = await client.auth.getSession();
      return {
        token: session.data.session && session.data.session.access_token,
        userId: session.data.session && session.data.session.user && session.data.session.user.id,
        stored: localStorage.getItem("kutadgu-member-auth-v1"),
        verifier: localStorage.getItem("kutadgu-member-auth-v1-code-verifier")
      };
    });
    expect(auth.token).toBe(expectedBearer(USER));
    expect(auth.userId).toBe(USER);
    expect(auth.stored).toContain(expectedBearer(USER));
    expect(auth.verifier).toBeTruthy();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction((id) => {
      const member = window.KutadguMember;
      return !!(member && member.getUser && member.getUser() && member.getUser().id === id);
    }, USER);
    const other = await page.context().newPage();
    await H.installReadSafeNetwork(other);
    await mockBooks(other);
    await installBoundary(other, gates);
    await other.goto("/account.html", { waitUntil: "domcontentloaded" });
    await other.waitForFunction((id) => {
      const member = window.KutadguMember;
      return !!(member && member.getUser && member.getUser() && member.getUser().id === id);
    }, USER);
    const otherSession = await other.evaluate(async () => {
      const client = window.KutadguMember.getClient();
      const session = await client.auth.getSession();
      return session.data.session && session.data.session.user && session.data.session.user.id;
    });
    expect(otherSession).toBe(USER);
    await other.close();
    await expect.poll(() => readCart(page)).toEqual([
      { id: "91021", qty: 5 },
      { id: "91022", qty: 1 }
    ]);
    expect(shop.leaks).toEqual([]);
  });

  test("email confirmation writes nothing and the later login persists the guest cart", async ({ page }) => {
    test.setTimeout(45_000);
    const gates = {
      userId: USER,
      email: "guest-invite@example.com",
      signupMode: "confirm",
      cloudCart: []
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }, { id: "91022", qty: 1 }],
      owner: "guest"
    });
    const shop = await installBoundary(page, gates);
    await openGuestCart(page);
    await followInviteToSignup(page);
    await fillSignup(page);
    await expect(page.locator("#authStatus")).toContainText(CONFIRM);
    await expect(page.locator("#authStatus")).not.toContainText("سېۋەت");
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#signupForm")).toBeHidden();
    expect(shop.mutations.filter((row) => row.table === "cart")).toEqual([]);
    expect(shop.cloud()).toEqual([]);
    const confirmAuth = await page.evaluate(async () => {
      const client = window.KutadguMember.getClient();
      const session = await client.auth.getSession();
      return {
        session: session.data.session,
        stored: localStorage.getItem("kutadgu-member-auth-v1"),
        verifier: localStorage.getItem("kutadgu-member-auth-v1-code-verifier")
      };
    });
    expect(confirmAuth.session).toBeNull();
    expect(confirmAuth.stored).toBeNull();
    expect(confirmAuth.verifier).toBeTruthy();
    const confirmBody = gates.signupBodies && gates.signupBodies[0];
    expect(confirmBody && confirmBody.code_challenge_method).toBe("s256");
    await expect.poll(() => readCart(page)).toEqual([
      { id: "91021", qty: 2 },
      { id: "91022", qty: 1 }
    ]);
    await expect(page.locator("#loginEmail")).toHaveValue("guest-invite@example.com");
    await fillLogin(page);
    await expect.poll(() => shop.cloud()).toEqual([
      { user_id: USER, book_id: "91021", quantity: 2 },
      { user_id: USER, book_id: "91022", quantity: 1 }
    ]);
    shop.mutations.filter((row) => row.table === "cart" && !row.failed).forEach((row) => {
      expect(row.user_id).toBe(USER);
    });
    expect(shop.leaks).toEqual([]);
  });

  test("a failed signup can be retried without an early or foreign cart write", async ({ page }) => {
    test.setTimeout(45_000);
    const gates = {
      userId: USER,
      email: "guest-invite@example.com",
      signupMode: "session",
      failSignup: true,
      cloudCart: []
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }],
      owner: "guest"
    });
    const shop = await installBoundary(page, gates);
    await openGuestCart(page);
    await followInviteToSignup(page);
    await fillSignup(page);
    await expect(page.locator("#authStatus")).toContainText(SIGNUP_ERROR);
    await expect(page.locator("#signupForm")).toBeVisible();
    expect(shop.mutations.filter((row) => row.table === "cart")).toEqual([]);
    expect(shop.cloud()).toEqual([]);
    await expect.poll(() => readCart(page)).toEqual([{ id: "91021", qty: 2 }]);
    gates.failSignup = false;
    await page.locator("#signupForm button[type='submit']").click();
    await expect.poll(() => shop.cloud()).toEqual([
      { user_id: USER, book_id: "91021", quantity: 2 }
    ]);
    expect(shop.leaks).toEqual([]);
  });

  test("a rejected signup request leaves the guest cart and writes nothing", async ({ page }) => {
    test.setTimeout(45_000);
    const gates = {
      userId: USER,
      email: "guest-invite@example.com",
      signupMode: "session",
      abortSignup: true,
      cloudCart: []
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }],
      owner: "guest"
    });
    const shop = await installBoundary(page, gates);
    await openGuestCart(page);
    await followInviteToSignup(page);
    await fillSignup(page);
    await expect(page.locator("#authStatus")).toContainText(SIGNUP_ERROR);
    await expect(page.locator("#memberPanel")).toBeHidden();
    expect(shop.mutations.filter((row) => row.table === "cart")).toEqual([]);
    await expect.poll(() => readCart(page)).toEqual([{ id: "91021", qty: 2 }]);
    expect(shop.leaks).toEqual([]);
  });

  test("a delayed cart write leaves the cloud empty and does not claim the cart is saved", async ({ page }) => {
    test.setTimeout(45_000);
    let releaseWrite;
    const gates = {
      userId: USER,
      email: "guest-invite@example.com",
      signupMode: "session",
      cloudCart: [],
      cartWriteSeen: false,
      holdCartWrite: new Promise((resolve) => { releaseWrite = resolve; })
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }, { id: "91022", qty: 1 }],
      owner: "guest"
    });
    const shop = await installBoundary(page, gates);
    await openGuestCart(page);
    await followInviteToSignup(page);
    await fillSignup(page);
    await expect.poll(() => gates.cartWriteSeen).toBe(true);
    await expect(page.locator("#authStatus")).not.toContainText("سېۋەت");
    await expect(page.locator("#authStatus")).not.toContainText(CONFIRM);
    expect(shop.cloud()).toEqual([]);
    await expect.poll(() => readCart(page)).toEqual([
      { id: "91021", qty: 2 },
      { id: "91022", qty: 1 }
    ]);
    releaseWrite();
    await expect.poll(() => shop.cloud()).toEqual([
      { user_id: USER, book_id: "91021", quantity: 2 },
      { user_id: USER, book_id: "91022", quantity: 1 }
    ]);
    await expect(page.locator("#memberPanel")).toBeVisible();
    expect(shop.leaks).toEqual([]);
  });

  test("a returned cart error keeps the guest cart and does not claim it was saved", async ({ page }) => {
    test.setTimeout(45_000);
    const gates = {
      userId: USER,
      email: "guest-invite@example.com",
      signupMode: "session",
      failCartWrite: true,
      cloudCart: []
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }],
      owner: "guest"
    });
    const shop = await installBoundary(page, gates);
    await openGuestCart(page);
    await followInviteToSignup(page);
    await fillSignup(page);
    await expect.poll(() => shop.mutations.some((row) => row.table === "cart" && row.failed)).toBe(true);
    await expect(page.locator("#memberPanel")).toBeVisible();
    await expect(page.locator("#authStatus")).not.toContainText("سېۋەت");
    expect(shop.cloud()).toEqual([]);
    expect(shop.mutations.some((row) => row.table === "cart" && !row.failed)).toBe(false);
    await expect.poll(() => readCart(page)).toEqual([{ id: "91021", qty: 2 }]);
    const owner = await page.evaluate(() => localStorage.getItem("kutadgu-shop-owner-v1"));
    expect(owner).toBe("guest");
    expect(shop.leaks).toEqual([]);
  });

  test("the cart control cannot copy a foreign retained cart into the signed-in account", async ({ page }) => {
    test.setTimeout(45_000);
    let releaseReads;
    const gates = {
      userId: USER_B,
      email: "member-b@example.com",
      signupMode: "session",
      cloudCart: [],
      readsSeen: 0,
      holdReads: new Promise((resolve) => { releaseReads = resolve; })
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }],
      owner: USER_A,
      session: sessionFor(USER_B, "member-b@example.com")
    });
    const shop = await installBoundary(page, gates);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.waitForFunction((id) => {
      const member = window.KutadguMember;
      return !!(member && member.getUser && member.getUser() && member.getUser().id === id);
    }, USER_B);
    await expect(page.locator("#guestCartInvite")).toBeHidden();
    await expect.poll(() => gates.readsSeen).toBeGreaterThan(0);
    await page.evaluate(() => window.kutadguShop.add("91021", 1));
    await expect.poll(() => readCart(page)).toEqual([{ id: "91021", qty: 2 }]);
    releaseReads();
    await page.waitForFunction((id) => localStorage.getItem("kutadgu-shop-owner-v1") === id, USER_B);
    expect(shop.cloud()).toEqual([]);
    expect(shop.mutations.some((row) => row.book_id === "91021")).toBe(false);
    expect(shop.leaks).toEqual([]);
  });

  test("member.js still applies a foreign cart edit made in storage during the merge", async ({ page }) => {
    test.setTimeout(45_000);
    let releaseReads;
    const gates = {
      userId: USER_B,
      email: "member-b@example.com",
      signupMode: "session",
      cloudCart: [{ user_id: USER_B, book_id: "91022", quantity: 3 }],
      readsSeen: 0,
      holdReads: new Promise((resolve) => { releaseReads = resolve; })
    };
    await seedBrowser(page, {
      cart: [{ id: "91021", qty: 2 }],
      owner: USER_A
    });
    const shop = await installBoundary(page, gates);
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#signupForm")).toBeHidden();
    await page.locator("#loginEmail").fill("member-b@example.com");
    await page.locator("#loginPassword").fill("password1");
    await page.locator("#loginForm button[type='submit']").click();
    await expect.poll(() => gates.readsSeen).toBe(2);
    await page.evaluate(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "91021", qty: 9 }]));
    });
    releaseReads();
    await expect.poll(() => shop.cloud()).toEqual([
      { user_id: USER_B, book_id: "91021", quantity: 9 },
      { user_id: USER_B, book_id: "91022", quantity: 3 }
    ]);
    expect(shop.mutations.some((row) => row.user_id && row.user_id !== USER_B)).toBe(false);
    expect(shop.leaks).toEqual([]);
  });
});
