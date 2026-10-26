const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BOOK_ID = "91001";
const TOKEN = "header.payload.signature";

function bookRow() {
  return {
    id: Number(BOOK_ID),
    title: "نۆۋەتتىكى رەسمىي كىتاب",
    author: "رەسمىي ئاپتور",
    price: 99,
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

async function seedCart(page, userId) {
  await page.addInitScript(({ cart, display, ownerId, token }) => {
    localStorage.setItem("kutadgu-cart-v1", cart);
    localStorage.setItem("kutadgu-cart-display-v1", display);
    localStorage.setItem("kutadgu-shop-owner-v1", ownerId);
    localStorage.setItem("kutadgu-member-auth-v1", JSON.stringify({
      access_token: token,
      refresh_token: "refresh.token.value",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: ownerId, aud: "authenticated", role: "authenticated", email: "member@example.com" }
    }));
  }, {
    cart: JSON.stringify([{ id: BOOK_ID, qty: 1 }]),
    display: JSON.stringify({
      v: 1,
      items: {
        [BOOK_ID]: {
          id: BOOK_ID,
          title: "سېۋەت ئالدىن كۆرۈش كىتابى",
          author: "ئالدىن كۆرۈش ئاپتور",
          price: 11,
          image: "/kutadgu-logo.png",
          href: "/book/91001",
          stock: 3,
          stockStatus: "in_stock"
        }
      }
    }),
    ownerId: userId,
    token: TOKEN
  });
}

async function mockMember(page, userId) {
  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.com",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z"
  };
  await page.route("**/auth/v1/user**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(user)
  }));
  await page.route("**/auth/v1/token**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      access_token: TOKEN,
      refresh_token: "refresh.token.value",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user
    })
  }));
  await page.route("**/rest/v1/profiles**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ id: userId, full_name: "Test Member", status: "active" }])
  }));
  await page.route("**/rest/v1/member_cart_items**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ user_id: userId, book_id: BOOK_ID, quantity: 1 }])
  }));
  await page.route("**/rest/v1/member_favorites**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/rest/v1/books**", (route) => {
    const method = route.request().method();
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([bookRow()])
    });
  });
  for (const rpc of ["record_member_visit", "record_member_login"]) {
    await page.route(`**/rest/v1/rpc/${rpc}**`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null"
    }));
  }
}

function memberRows() {
  const rows = [];
  for (let i = 1; i <= 25; i += 1) {
    rows.push({
      id: "00000000-0000-4000-8000-" + String(i).padStart(12, "0"),
      email: "member" + i + "@example.com",
      full_name: "ئەزا " + i,
      phone: "900" + i,
      country: "تۈركىيە",
      city: "ئانكارا",
      status: "active",
      created_at: new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(),
      last_login_at: null,
      last_seen_at: null,
      visit_count: i,
      last_page: "/book/" + i,
      cart: i === 2,
      order_count: 0,
      order_total: 0
    });
  }
  return rows;
}

async function installAdmin(page) {
  await page.addInitScript(({ adminId, members }) => {
    function answer(rows, args) {
      const pageIndex = Math.max(0, Number(args.p_page) || 0);
      const query = String(args.p_query || "").trim().toLocaleLowerCase("ug");
      const matched = rows.filter((member) => {
        if (!query) return true;
        return [member.full_name, member.email].join(" ").toLocaleLowerCase("ug").includes(query);
      }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return {
        total: matched.length,
        page: pageIndex,
        page_size: 20,
        rows: matched.slice(pageIndex * 20, pageIndex * 20 + 20).map((member) => {
          const copy = { ...member };
          delete copy.cart;
          return copy;
        }),
        stats: { members: rows.length, visits: 1, orders: 0, revenue: 0 }
      };
    }
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguMemberDirectoryMembers = members;
    window.__memberDirectoryCalls = [];
    window.__memberDirectoryAal = "aal2";
    window.__memberDirectoryUser = adminId;
    window.__cartShare = { global: false, grants: {}, failRead: false, holdWrite: false };
    const token = (aal, userId) => {
      const payload = btoa(JSON.stringify({ aal: aal, sub: userId })).replace(/=+$/g, "");
      return "e30." + payload + ".sig";
    };
    window.__kutadguAnalyticsDb = {
      auth: {
        getSession: async () => {
          if (window.__adminAuthGate) await window.__adminAuthGate;
          return {
            data: {
              session: window.__memberDirectoryUser ? {
                access_token: token(window.__memberDirectoryAal, window.__memberDirectoryUser),
                user: { id: window.__memberDirectoryUser }
              } : null
            },
            error: null
          };
        }
      },
      rpc(name, args) {
        window.__memberDirectoryCalls.push({ name: name, args: args });
        if (name === "admin_member_directory_page") {
          return Promise.resolve({ data: answer(window.__kutadguMemberDirectoryMembers, args), error: null });
        }
        if (name === "set_member_status") return Promise.resolve({ data: null, error: null });
        if (name === "admin_cart_share_state") {
          const build = () => {
            if (window.__cartShare.failRead) return { data: null, error: { message: "read failed" } };
            const ids = Array.isArray(args.p_user_ids) ? args.p_user_ids : [];
            return {
              data: {
                global_enabled: window.__cartShare.global === true,
                self_id: window.__memberDirectoryUser,
                self_granted: window.__cartShare.grants[window.__memberDirectoryUser] === true,
                self_eligible: true,
                grants: ids.map((id) => ({ id: id, granted: window.__cartShare.grants[id] === true }))
              },
              error: null
            };
          };
          if (window.__cartShare.holdRead) {
            return new Promise((resolve) => {
              window.__cartShareReadQueue = window.__cartShareReadQueue || [];
              window.__cartShareReadQueue.push(() => resolve(build()));
            });
          }
          return Promise.resolve(build());
        }
        if (name === "admin_set_cart_share_global" || name === "admin_set_cart_share_grant") {
          const apply = () => {
            if (name === "admin_set_cart_share_global") {
              window.__cartShare.global = args.p_enabled === true;
              return { data: { global_enabled: window.__cartShare.global }, error: null };
            }
            window.__cartShare.grants[args.p_user_id] = args.p_granted === true;
            return { data: { user_id: args.p_user_id, granted: args.p_granted === true }, error: null };
          };
          if (window.__cartShare.holdWrite) {
            return new Promise((resolve) => { window.__releaseCartShare = () => resolve(apply()); });
          }
          return Promise.resolve(apply());
        }
        return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
      },
      from() { throw new Error("unexpected table read"); }
    };
    window.__kutadguMemberCartAdminClient = {
      auth: { getSession: async () => window.__kutadguAnalyticsDb.auth.getSession() },
      rpc() { return Promise.resolve({ data: [], error: null }); }
    };
  }, { adminId: ADMIN, members: memberRows() });
}

async function openMembers(page) {
  await page.goto("/admin.html#customers", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#memberManagement")).toBeVisible();
  await page.locator("#reloadMembers").click();
  await expect(page.locator("#cartShareStatus")).toContainText("ئومۇمىي ئىجازەت تاقاق");
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
}

async function seedGuestCart(page) {
  await page.addInitScript(({ cart, display }) => {
    localStorage.setItem("kutadgu-cart-v1", cart);
    localStorage.setItem("kutadgu-cart-display-v1", display);
    localStorage.setItem("kutadgu-shop-owner-v1", "guest");
    localStorage.removeItem("kutadgu-member-auth-v1");
  }, {
    cart: JSON.stringify([{ id: BOOK_ID, qty: 1 }]),
    display: JSON.stringify({
      v: 1,
      items: {
        [BOOK_ID]: {
          id: BOOK_ID,
          title: "سېۋەت ئالدىن كۆرۈش كىتابى",
          author: "ئالدىن كۆرۈش ئاپتور",
          price: 11,
          image: "/kutadgu-logo.png",
          href: "/book/91001",
          stock: 3,
          stockStatus: "in_stock"
        }
      }
    })
  });
}

test("a guest cart keeps order controls and hides cart-link sharing", async ({ page }) => {
  await H.installReadSafeNetwork(page);
  await seedGuestCart(page);
  await page.route("**/rest/v1/books**", (route) => {
    const method = route.request().method();
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      body: JSON.stringify([bookRow()]),
      headers: { "content-range": "0-0/1" }
    });
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await expect(page.locator("#whatsappOrder")).toBeVisible();
  await expect(page.locator("#prepareOrder")).toBeVisible();
  await expect(page.locator("#copyOrder")).toBeVisible();
  await expect(page.locator("#shareOrder")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await expect(page.locator("#whatsappOrder")).toBeVisible();
});

test("a granted member sends one authorized create and a denial hides the action", async ({ page }) => {
  const posts = [];
  await H.installReadSafeNetwork(page);
  await seedCart(page, MEMBER_A);
  await mockMember(page, MEMBER_A);
  let permissionCalls = 0;
  await page.route("**/rest/v1/rpc/my_cart_share_permission**", (route) => {
    permissionCalls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
  });
  await page.route("**/api/shared-cart", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push({
      authorization: route.request().headers().authorization || "",
      body: route.request().postData() || ""
    });
    const status = posts.length === 1 ? 200 : 403;
    const body = posts.length === 1
      ? { ok: true, code: "Abcdefg2", url: "https://www.kutadgubilik.com/c/Abcdefg2" }
      : { ok: false, error: "denied" };
    return route.fulfill({ status: status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  const share = page.locator("#shareCart");
  await expect(share).toBeVisible();
  await expect(share).toHaveText("📤 سېۋەتنى ھەمبەھىرلەش");
  await page.evaluate(() => {
    const button = document.querySelector("#shareCart");
    button.click();
    button.click();
  });
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].authorization).toBe("Bearer " + TOKEN);
  expect(posts[0].body).toContain(BOOK_ID);
  await expect(page.locator(".shop-toast")).toContainText(/كۆچۈر|ھەمبەھىرلەندى/);
  await share.click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await expect(page.locator("#whatsappOrder")).toBeVisible();
  expect(permissionCalls).toBeGreaterThan(0);
});

test("a delayed permission for account A does not enable account B or survive logout", async ({ page }) => {
  const jobs = [];
  await H.installReadSafeNetwork(page);
  await seedCart(page, MEMBER_A);
  await mockMember(page, MEMBER_A);
  await page.route("**/rest/v1/rpc/my_cart_share_permission**", async (route) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    jobs.push(release);
    const allowed = await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: allowed ? "true" : "false"
    });
  });
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => jobs.length).toBeGreaterThan(0);
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await page.evaluate((nextId) => {
    const member = window.KutadguMember;
    member.getUser = () => ({ id: nextId });
    member.getProfile = () => ({ status: "active", id: nextId });
    member.isBlocked = () => false;
    document.dispatchEvent(new Event("kutadgu-member-change"));
  }, MEMBER_B);
  await expect(page.locator("#shareCart")).toHaveCount(0);
  for (const release of jobs) release(true);
  await page.waitForTimeout(500);
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await page.evaluate(() => {
    const member = window.KutadguMember;
    member.getUser = () => null;
    member.getProfile = () => null;
    member.isBlocked = () => false;
    document.dispatchEvent(new Event("kutadgu-member-change"));
  });
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await expect(page.locator("#prepareOrder")).toBeVisible();
});

test("admin cart-share controls batch the page, keep grants, and drop a stale AAL2 write", async ({ page }) => {
  await installAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMembers(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const shareCalls = () => page.evaluate(() => window.__memberDirectoryCalls.filter((call) => call.name === "admin_cart_share_state").length);
  expect(await shareCalls()).toBe(1);
  const firstIds = await page.evaluate(() => window.__memberDirectoryCalls.find((call) => call.name === "admin_cart_share_state").args.p_user_ids.length);
  expect(firstIds).toBe(20);
  await expect(page.locator("[data-cart-share]")).toHaveCount(20);
  await expect(page.locator("#cartShareSelfToggle")).toContainText("مېنىڭ ھېسابىمغا سېۋەت ئۇلانمىسى: ئېچىش");

  await page.locator("#cartShareSelfToggle").click();
  await expect(page.locator("#cartShareSelfToggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-cart-share]").first().click();
  await expect(page.locator("[data-cart-share]").first()).toHaveAttribute("aria-pressed", "true");
  const savedGrant = await page.evaluate(() => Object.values(window.__cartShare.grants).filter(Boolean).length);
  expect(savedGrant).toBe(2);

  await page.locator("#cartShareGlobal").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cartShareStatus")).toContainText("ئومۇمىي ئىجازەت ئوچۇق");
  await expect(page.locator("#cartShareStatus")).toContainText("توختىتىلغان ھېساب");
  await expect(page.locator("[data-cart-share]")).toHaveCount(0);
  await expect(page.locator(".admin-member-share-saved").first()).toContainText("ساقلانغان ئالاھىدە ئىجازەت");
  expect(await page.evaluate(() => Object.values(window.__cartShare.grants).filter(Boolean).length)).toBe(2);

  await page.locator("#cartShareGlobal").click();
  await expect(page.locator("#cartShareStatus")).toContainText("ئومۇمىي ئىجازەت تاقاق");
  await expect(page.locator("[data-cart-share][aria-pressed='true']")).toHaveCount(1);
  await expect(page.locator("#cartShareSelfToggle")).toHaveAttribute("aria-pressed", "true");

  await page.locator("#memberSearch").fill("ئەزا 25");
  await expect(page.locator(".admin-member-row")).toHaveCount(1);
  await page.locator("#memberSearch").fill("");
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
  await page.locator("#adminMemberPager").getByRole("button", { name: "كېيىنكى" }).click();
  await expect(page.locator(".admin-member-row")).toHaveCount(5);
  expect(await shareCalls()).toBeGreaterThan(1);
  const perRow = await page.evaluate(() => window.__memberDirectoryCalls.filter((call) => call.name === "admin_cart_share_state").some((call) => (call.args.p_user_ids || []).length > 20));
  expect(perRow).toBe(false);

  await page.evaluate(() => { window.__cartShare.holdWrite = true; });
  await page.locator("#cartShareGlobal").click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseCartShare === "function")).toBe(true);
  await page.evaluate(() => { window.__memberDirectoryAal = "aal1"; window.__releaseCartShare(); });
  await expect(page.locator("#cartShareStatus")).toContainText("يۈكلىنىۋاتىدۇ");
  await expect(page.locator("#cartShareStatus")).not.toContainText("ئومۇمىي ئىجازەت ئوچۇق");
  await expect(page.locator(".admin-member-row")).toHaveCount(5);

  await page.setViewportSize({ width: 390, height: 800 });
  const box = await page.locator("#cartShareControls").boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  await expect(page.locator("#cartShareGlobal")).toBeVisible();
});

function sessionFor(userId) {
  return {
    access_token: "header.payload." + userId.slice(0, 8),
    refresh_token: "refresh.token.value",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, aud: "authenticated", role: "authenticated", email: userId.slice(0, 8) + "@example.com" }
  };
}

async function installControlledMember(page, userId) {
  await page.addInitScript(({ ownerId }) => {
    const listeners = [];
    function rowsFor(table) {
      if (table === "profiles") {
        const id = window.__session && window.__session.user && window.__session.user.id;
        return id ? [{ id: id, full_name: "Test Member", status: "active", email: "member@example.com" }] : [];
      }
      if (table === "member_cart_items") {
        const id = window.__session && window.__session.user && window.__session.user.id;
        return [{ user_id: id, book_id: "91001", quantity: 1 }];
      }
      if (table === "books") return [{ id: 91001, legacy_id: null }];
      return [];
    }
    function answerQuery(table) {
      const data = rowsFor(table);
      return Promise.resolve({ data: data, error: null });
    }
    function chain(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        in() { return api; },
        order() { return api; },
        limit() { return api; },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        update() { return api; },
        delete() { return api; },
        insert() { return Promise.resolve({ data: null, error: null }); },
        maybeSingle() { return answerQuery(table).then((result) => ({ data: result.data[0] || null, error: null })); },
        single() { return answerQuery(table).then((result) => ({ data: result.data[0] || null, error: null })); },
        then(resolve, reject) { return answerQuery(table).then(resolve, reject); }
      };
      return api;
    }
    window.__authListeners = listeners;
    window.__posts = [];
    window.__session = null;
    window.__emitAuth = (event, session) => {
      if (session) window.__session = session;
      if (event === "SIGNED_OUT") window.__session = null;
      listeners.forEach((listener) => listener(event, session || null));
    };
    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange(callback) {
              listeners.push(callback);
              return { data: { subscription: { unsubscribe() {} } } };
            },
            async getSession() {
              window.__sessionReads = (window.__sessionReads || 0) + 1;
              if (window.__sessionOverride) return window.__sessionOverride;
              if (window.__sessionError) return { data: { session: null }, error: window.__sessionError };
              if (window.__sessionThrow) throw window.__sessionThrow;
              return { data: { session: window.__session }, error: null };
            },
            async refreshSession() {
              return { data: { session: window.__session }, error: null };
            },
            async signOut() {
              if (window.__signOutGate) await window.__signOutGate;
              if (window.__signOutError) throw window.__signOutError;
              window.__session = null;
              listeners.forEach((listener) => listener("SIGNED_OUT", null));
              return { error: null };
            }
          },
          rpc(name) {
            if (name !== "my_cart_share_permission") return Promise.resolve({ data: null, error: null });
            if (window.__permissionFailsLeft > 0) {
              window.__permissionFailsLeft -= 1;
              return Promise.resolve({ data: null, error: { message: "temporary" } });
            }
            if (window.__permissionHold) {
              return new Promise((resolve, reject) => {
                window.__permissionWaits = window.__permissionWaits || [];
                window.__permissionWaits.push({ resolve, reject });
              });
            }
            if (window.__permissionMode === "deny") return Promise.resolve({ data: false, error: null });
            return Promise.resolve({ data: true, error: null });
          },
          from(table) { return chain(table); }
        };
      }
    };
    window.__bootSession = {
      access_token: "header.payload.signature",
      refresh_token: "refresh.token.value",
      token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: ownerId, aud: "authenticated", role: "authenticated", email: "member@example.com" }
    };
  }, { ownerId: userId });
}

async function openControlledCart(page) {
  await page.route("**/rest/v1/books**", (route) => {
    const method = route.request().method();
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([bookRow()])
    });
  });
  await page.route("**/api/shared-cart", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const record = {
      authorization: route.request().headers().authorization || "",
      body: route.request().postData() || ""
    };
    await page.evaluate((entry) => { window.__posts.push(entry); }, record);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, code: "Abcdefg2", url: "https://www.kutadgubilik.com/c/Abcdefg2" })
    });
  });
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__session = window.__bootSession;
    window.__emitAuth("INITIAL_SESSION", window.__bootSession);
  });
}

test("sdk identity B closes sharing while the member facade still exposes A", async ({ page }) => {
  const posts = [];
  await H.installReadSafeNetwork(page);
  await seedCart(page, MEMBER_A);
  await installControlledMember(page, MEMBER_A);
  await page.route("**/api/shared-cart", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push({ authorization: route.request().headers().authorization || "" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, code: "Abcdefg2", url: "https://www.kutadgubilik.com/c/Abcdefg2" })
    });
  });
  await page.route("**/rest/v1/books**", (route) => route.fulfill({
    status: 206,
    contentType: "application/json",
    headers: { "content-range": "0-0/1" },
    body: JSON.stringify([bookRow()])
  }));
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__session = window.__bootSession;
    window.__emitAuth("INITIAL_SESSION", window.__bootSession);
  });
  await expect(page.locator("#shareCart")).toBeVisible();
  const raced = await page.evaluate(async (nextSession) => {
    window.__permissionHold = true;
    document.querySelector("#shareCart").click();
    for (let i = 0; i < 20 && !(window.__permissionWaits && window.__permissionWaits.length); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const held = (window.__permissionWaits || []).length;
    window.__emitAuth("SIGNED_IN", nextSession);
    const during = {
      listeners: window.__authListeners.length,
      facade: window.KutadguMember.getUser() && window.KutadguMember.getUser().id,
      visible: !!document.querySelector("#shareCart")
    };
    const waiter = window.__permissionWaits[0];
    if (waiter) waiter.resolve({ data: true, error: null });
    window.__sessionOverride = { data: { session: nextSession }, error: null };
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    return {
      held: held,
      during: during,
      facadeAfterRelease: window.KutadguMember.getUser() && window.KutadguMember.getUser().id,
      visibleAfterRelease: !!document.querySelector("#shareCart"),
      toast: document.querySelector(".shop-toast") ? document.querySelector(".shop-toast").textContent : ""
    };
  }, sessionFor(MEMBER_B));
  expect(raced.held).toBeGreaterThan(0);
  expect(raced.during.listeners).toBeGreaterThan(1);
  expect(raced.during.facade).toBe(MEMBER_A);
  expect(raced.during.visible).toBe(false);
  expect(raced.facadeAfterRelease).toBe(MEMBER_A);
  expect(raced.visibleAfterRelease).toBe(false);
  expect(raced.toast).not.toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(posts).toEqual([]);
  await page.waitForTimeout(50);
  const afterQueue = await page.evaluate(() => ({
    facade: window.KutadguMember.getUser() && window.KutadguMember.getUser().id,
    toast: document.querySelector(".shop-toast") ? document.querySelector(".shop-toast").textContent : ""
  }));
  expect(afterQueue.facade).toBe(MEMBER_B);
  expect(afterQueue.toast).not.toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(posts).toEqual([]);
  expect(await page.locator(".shop-toast").count()).toBe(0);
});

function sharedCartSuccess() {
  return { ok: true, code: "Abcdefg2", url: "https://www.kutadgubilik.com/c/Abcdefg2" };
}

async function installShareProbes(page) {
  await page.addInitScript(() => {
    window.__copyCalls = [];
    window.__shareCalls = [];
    window.__execCopies = [];
    window.__afterJson = 0;
    window.__armShareProbes = () => {
      const clipboard = {
        writeText(text) {
          window.__copyCalls.push(String(text || ""));
          return Promise.resolve();
        }
      };
      try {
        Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: clipboard });
      } catch (error) {
        navigator.clipboard = clipboard;
      }
      const nativeExec = document.execCommand ? document.execCommand.bind(document) : null;
      document.execCommand = (command) => {
        if (command === "copy") {
          window.__execCopies.push("copy");
          return true;
        }
        return nativeExec ? nativeExec(command) : false;
      };
      const share = (data) => {
        window.__shareCalls.push(data && data.url ? String(data.url) : "");
        return Promise.resolve();
      };
      try {
        Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: share });
      } catch (error) {
        navigator.share = share;
      }
    };
    window.__armShareProbes();
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      return nativeFetch(input, init).then((response) => {
        if (String(url).indexOf("/api/shared-cart") === -1) return response;
        const originalJson = response.json.bind(response);
        response.json = () => originalJson().then((data) => {
          queueMicrotask(() => {
            queueMicrotask(() => { window.__afterJson += 1; });
          });
          return data;
        });
        return response;
      });
    };
  });
}

async function routeHeldCreates(page, posts) {
  await page.route("**/api/shared-cart", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    posts.push({
      authorization: route.request().headers().authorization || "",
      body: route.request().postData() || "",
      release
    });
    const outcome = await gate;
    return route.fulfill({
      status: outcome.status,
      contentType: "application/json",
      body: JSON.stringify(outcome.body)
    });
  });
}

async function routeCanonicalBook(page) {
  await page.route("**/rest/v1/books**", (route) => {
    const method = route.request().method();
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([bookRow()])
    });
  });
}

async function bootControlledShare(page, posts) {
  await H.installReadSafeNetwork(page);
  await seedCart(page, MEMBER_A);
  await installControlledMember(page, MEMBER_A);
  await installShareProbes(page);
  await routeHeldCreates(page, posts);
  await routeCanonicalBook(page);
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__armShareProbes();
    window.__session = window.__bootSession;
    window.__emitAuth("INITIAL_SESSION", window.__bootSession);
  });
  await expect(page.locator("#shareCart")).toBeVisible();
  expect(await page.evaluate(() => window.__authListeners.length)).toBeGreaterThan(1);
}

async function toastText(page) {
  return page.evaluate(() => {
    const toast = document.querySelector(".shop-toast");
    return toast ? toast.textContent : "";
  });
}

async function shareActionCount(page) {
  return page.evaluate(() => window.__copyCalls.length + window.__shareCalls.length + window.__execCopies.length);
}

test("an owned operation rejects another account session", async ({ page }) => {
  const posts = [];
  await H.installReadSafeNetwork(page);
  await seedCart(page, MEMBER_A);
  await installControlledMember(page, MEMBER_A);
  await page.route("**/api/shared-cart", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    posts.push({ authorization: route.request().headers().authorization || "", release: release });
    await gate;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, code: "Abcdefg2", url: "https://www.kutadgubilik.com/c/Abcdefg2" })
    });
  });
  await page.route("**/rest/v1/books**", (route) => route.fulfill({
    status: 206,
    contentType: "application/json",
    headers: { "content-range": "0-0/1" },
    body: JSON.stringify([bookRow()])
  }));
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__session = window.__bootSession;
    window.__emitAuth("INITIAL_SESSION", window.__bootSession);
  });
  await expect(page.locator("#shareCart")).toBeVisible();
  const mismatched = await page.evaluate(async (nextSession) => {
    window.__permissionHold = true;
    document.querySelector("#shareCart").click();
    for (let i = 0; i < 20 && !(window.__permissionWaits && window.__permissionWaits.length); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const waiter = window.__permissionWaits.shift();
    window.__sessionOverride = { data: { session: nextSession }, error: null };
    waiter.resolve({ data: true, error: null });
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    return document.querySelector(".shop-toast") ? document.querySelector(".shop-toast").textContent : "";
  }, sessionFor(MEMBER_B));
  expect(mismatched).toContain("ھەمبەھىرلىيەلمىدۇق");
  expect(mismatched).not.toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(posts).toEqual([]);
  expect(await page.locator(".shop-toast").count()).toBe(1);
});

for (const [mode, label] of [
  ["success", "a late successful permission"],
  ["error", "a late returned permission error"],
  ["reject", "a late rejected permission"]
]) {
  test(label + " cannot share the older account or release the newer operation", async ({ page }) => {
    const posts = [];
    await bootControlledShare(page, posts);
    await page.evaluate(() => {
      window.__permissionHold = true;
      window.__permissionWaits = [];
      document.querySelector("#shareCart").click();
    });
    await expect.poll(() => page.evaluate(() => (window.__permissionWaits || []).length)).toBe(1);
    await page.evaluate((nextSession) => {
      window.__emitAuth("SIGNED_IN", nextSession);
    }, sessionFor(MEMBER_B));
    await expect.poll(() => page.evaluate(() => window.KutadguMember.getUser() && window.KutadguMember.getUser().id)).toBe(MEMBER_B);
    await expect.poll(() => page.evaluate(() => (window.__permissionWaits || []).length)).toBe(2);
    expect(await page.evaluate(() => window.__authListeners.length)).toBeGreaterThan(1);
    await page.evaluate(() => { window.__permissionWaits[1].resolve({ data: true, error: null }); });
    await expect(page.locator("#shareCart")).toBeVisible();
    await page.evaluate(() => { document.querySelector("#shareCart").click(); });
    await expect.poll(() => page.evaluate(() => (window.__permissionWaits || []).length)).toBe(3);
    await page.evaluate(() => { document.querySelector("#shareCart").click(); });
    expect(await page.evaluate(() => (window.__permissionWaits || []).length)).toBe(3);
    expect(await page.evaluate(() => window.__permissionWaits[0] !== window.__permissionWaits[2])).toBe(true);
    expect(posts).toEqual([]);
    const settled = await page.evaluate(async (settlement) => {
      const beforeReads = window.__sessionReads || 0;
      const beforeActions = window.__copyCalls.length + window.__shareCalls.length + window.__execCopies.length;
      const older = window.__permissionWaits[0];
      if (settlement === "success") older.resolve({ data: true, error: null });
      else if (settlement === "error") older.resolve({ data: null, error: { message: "late" } });
      else older.reject(new Error("late"));
      await Promise.resolve();
      await Promise.resolve();
      const toast = document.querySelector(".shop-toast");
      return {
        beforeReads,
        afterReads: window.__sessionReads || 0,
        beforeActions,
        afterActions: window.__copyCalls.length + window.__shareCalls.length + window.__execCopies.length,
        waits: window.__permissionWaits.length,
        visible: !!document.querySelector("#shareCart"),
        toast: toast ? toast.textContent : ""
      };
    }, mode);
    expect(settled.afterReads).toBe(settled.beforeReads);
    expect(settled.afterActions).toBe(settled.beforeActions);
    expect(settled.waits).toBe(3);
    expect(settled.visible).toBe(true);
    expect(settled.toast).not.toMatch(/كۆچۈر|ھەمبەھىرلەندى|ھەمبەھىرلىيەلمىدۇق/);
    expect(posts).toEqual([]);
    await page.evaluate(() => { document.querySelector("#shareCart").click(); });
    expect(await page.evaluate(() => (window.__permissionWaits || []).length)).toBe(3);
    expect(posts).toEqual([]);
    await expect(page.locator("#whatsappOrder")).toBeVisible();
    await page.evaluate(() => { window.__permissionWaits[2].resolve({ data: true, error: null }); });
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].authorization).toContain(MEMBER_B.slice(0, 8));
    expect(posts[0].authorization).not.toContain(MEMBER_A.slice(0, 8));
    expect(posts[0].body).toContain(BOOK_ID);
    await page.evaluate(() => { document.querySelector("#shareCart").click(); });
    expect(posts).toHaveLength(1);
    const heldActions = await shareActionCount(page);
    posts[0].release({ status: 200, body: sharedCartSuccess() });
    await expect.poll(() => page.evaluate(() => window.__afterJson)).toBe(1);
    await expect.poll(() => toastText(page)).toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
    expect(posts).toHaveLength(1);
    expect(await shareActionCount(page)).toBe(heldActions + 1);
    const shared = await page.evaluate(() => window.__copyCalls.concat(window.__shareCalls));
    expect(shared.some((url) => String(url).indexOf("/c/Abcdefg2") !== -1)).toBe(true);
    await expect(page.locator("#whatsappOrder")).toBeVisible();
  });
}

test("a held cart creation delays its own success, ignores an overlap, and retries one error", async ({ page }) => {
  const posts = [];
  await bootControlledShare(page, posts);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].authorization).toBe("Bearer " + TOKEN);
  expect(posts[0].body).toContain(BOOK_ID);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  expect(posts).toHaveLength(1);
  posts[0].release({ status: 200, body: sharedCartSuccess() });
  await expect.poll(() => page.evaluate(() => window.__afterJson)).toBe(1);
  await expect.poll(() => toastText(page)).toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(await shareActionCount(page)).toBe(1);
  expect(posts).toHaveLength(1);

  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  await expect.poll(() => posts.length).toBe(2);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  expect(posts).toHaveLength(2);
  expect(posts[1].authorization).toBe("Bearer " + TOKEN);
  posts[1].release({ status: 503, body: { ok: false, error: "unavailable" } });
  await expect.poll(() => page.evaluate(() => window.__afterJson)).toBe(2);
  await expect.poll(() => toastText(page)).toContain("ھەمبەھىرلىيەلمىدۇق");
  await expect(page.locator("#shareCart")).toBeVisible();
  expect(await shareActionCount(page)).toBe(1);
  expect(posts).toHaveLength(2);

  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  await expect.poll(() => posts.length).toBe(3);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  expect(posts).toHaveLength(3);
  posts[2].release({ status: 200, body: sharedCartSuccess() });
  await expect.poll(() => page.evaluate(() => window.__afterJson)).toBe(3);
  await expect.poll(() => toastText(page)).toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(await shareActionCount(page)).toBe(2);
  expect(posts).toHaveLength(3);
  await expect(page.locator("#whatsappOrder")).toBeVisible();
  await expect(page.locator("#prepareOrder")).toBeVisible();
});

test("a held cart creation from the previous account cannot complete after the SDK account changes", async ({ page }) => {
  const posts = [];
  await bootControlledShare(page, posts);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].authorization).toBe("Bearer " + TOKEN);
  expect(posts[0].body).toContain(BOOK_ID);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  expect(posts).toHaveLength(1);
  await page.evaluate((nextSession) => {
    window.__emitAuth("SIGNED_IN", nextSession);
  }, sessionFor(MEMBER_B));
  await expect.poll(() => page.evaluate(() => window.KutadguMember.getUser() && window.KutadguMember.getUser().id)).toBe(MEMBER_B);
  await expect(page.locator("#shareCart")).toBeVisible();
  expect(await shareActionCount(page)).toBe(0);
  expect(await toastText(page)).toBe("");
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].authorization).toContain(MEMBER_B.slice(0, 8));
  expect(posts[1].authorization).not.toContain(MEMBER_A.slice(0, 8));
  expect(posts[1].body).toContain(BOOK_ID);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  expect(posts).toHaveLength(2);
  posts[0].release({ status: 200, body: sharedCartSuccess() });
  await expect.poll(() => page.evaluate(() => window.__afterJson)).toBe(1);
  const stale = await page.evaluate(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const toast = document.querySelector(".shop-toast");
    return {
      toast: toast ? toast.textContent : "",
      actions: window.__copyCalls.length + window.__shareCalls.length + window.__execCopies.length,
      visible: !!document.querySelector("#shareCart")
    };
  });
  expect(stale.toast).not.toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(stale.actions).toBe(0);
  expect(stale.visible).toBe(true);
  expect(posts).toHaveLength(2);
  await page.evaluate(() => { document.querySelector("#shareCart").click(); });
  expect(posts).toHaveLength(2);
  posts[1].release({ status: 200, body: sharedCartSuccess() });
  await expect.poll(() => page.evaluate(() => window.__afterJson)).toBe(2);
  await expect.poll(() => toastText(page)).toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(await shareActionCount(page)).toBe(1);
  expect(posts).toHaveLength(2);
  const shared = await page.evaluate(() => window.__copyCalls.concat(window.__shareCalls));
  expect(shared).toEqual(["https://www.kutadgubilik.com/c/Abcdefg2"]);
  await expect(page.locator("#whatsappOrder")).toBeVisible();
  await expect(page.locator("#prepareOrder")).toBeVisible();
});

test("sign-out closes sharing before auth.signOut finishes or fails", async ({ page }) => {
  await H.installReadSafeNetwork(page);
  await seedCart(page, MEMBER_A);
  await installControlledMember(page, MEMBER_A);
  await page.route("**/rest/v1/books**", (route) => route.fulfill({
    status: 206,
    contentType: "application/json",
    headers: { "content-range": "0-0/1" },
    body: JSON.stringify([bookRow()])
  }));
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__session = window.__bootSession;
    window.__emitAuth("INITIAL_SESSION", window.__bootSession);
  });
  await expect(page.locator("#shareCart")).toBeVisible();
  const delayed = await page.evaluate(async () => {
    let release;
    let settled = false;
    window.__signOutGate = new Promise((resolve) => { release = resolve; });
    const pending = window.KutadguMember.signOut();
    pending.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const during = {
      gateHeld: !!window.__signOutGate,
      settled: settled,
      facade: window.KutadguMember.getUser() && window.KutadguMember.getUser().id,
      visible: !!document.querySelector("#shareCart"),
      toast: document.querySelector(".shop-toast") ? document.querySelector(".shop-toast").textContent : ""
    };
    release();
    await pending.catch(() => {});
    return {
      during: during,
      afterFacade: window.KutadguMember.getUser() && window.KutadguMember.getUser().id,
      afterVisible: !!document.querySelector("#shareCart")
    };
  });
  expect(delayed.during.gateHeld).toBe(true);
  expect(delayed.during.settled).toBe(false);
  expect(delayed.during.facade).toBeFalsy();
  expect(delayed.during.visible).toBe(false);
  expect(delayed.during.toast).not.toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  expect(delayed.afterFacade).toBeFalsy();
  expect(delayed.afterVisible).toBe(false);

  await page.evaluate(() => {
    window.__signOutGate = null;
    window.__signOutError = null;
    window.__session = window.__bootSession;
    window.__emitAuth("SIGNED_IN", window.__bootSession);
  });
  await expect(page.locator("#shareCart")).toBeVisible();
  const failed = await page.evaluate(async () => {
    window.__signOutError = new Error("sign-out failed");
    let threw = false;
    try { await window.KutadguMember.signOut(); } catch (error) { threw = true; }
    return {
      threw: threw,
      facade: window.KutadguMember.getUser() && window.KutadguMember.getUser().id,
      session: window.__session && window.__session.user && window.__session.user.id,
      visible: !!document.querySelector("#shareCart"),
      toast: document.querySelector(".shop-toast") ? document.querySelector(".shop-toast").textContent : ""
    };
  });
  expect(failed.threw).toBe(true);
  expect(failed.facade).toBeFalsy();
  expect(failed.session).toBe(MEMBER_A);
  expect(failed.visible).toBe(false);
  expect(failed.toast).not.toMatch(/كۆچۈر|ھەمبەھىرلەندى/);
  await expect(page.locator("#checkoutCard")).toBeHidden();
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await expect(page.locator("#whatsappOrder")).toHaveCount(1);
  await page.evaluate((bookId) => {
    window.kutadguShop.add(bookId, 1);
    document.dispatchEvent(new Event("kutadgu-member-change"));
  }, BOOK_ID);
  await expect(page.locator("#whatsappOrder")).toBeVisible();
  await expect(page.locator("#prepareOrder")).toBeVisible();
  await expect(page.locator("#shareCart")).toHaveCount(0);
});

test("a temporary permission failure is retried for the same account", async ({ page }) => {
  await H.installReadSafeNetwork(page);
  await seedCart(page, MEMBER_A);
  await installControlledMember(page, MEMBER_A);
  await page.addInitScript(() => { window.__permissionFailsLeft = 1; });
  await page.route("**/rest/v1/books**", (route) => route.fulfill({
    status: 206,
    contentType: "application/json",
    headers: { "content-range": "0-0/1" },
    body: JSON.stringify([bookRow()])
  }));
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__permissionFailsLeft = 1;
    window.__session = window.__bootSession;
    window.__emitAuth("INITIAL_SESSION", window.__bootSession);
  });
  await expect(page.locator("#shareCart")).toHaveCount(0);
  await expect(page.locator("#shareCart")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#whatsappOrder")).toBeVisible();
});

test("admin cart-share writes keep the earliest operation through preflight", async ({ page }) => {
  await installAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMembers(page);
  await page.evaluate(() => {
    let release;
    window.__adminAuthGate = new Promise((resolve) => { release = resolve; });
    window.__releaseAdminAuth = () => {
      const done = release;
      window.__adminAuthGate = null;
      done();
    };
  });
  await page.evaluate(() => {
    document.querySelector("#cartShareGlobal").click();
    document.querySelector("[data-cart-share]").click();
    document.querySelector("#cartShareGlobal").click();
  });
  const during = await page.evaluate(() => window.__memberDirectoryCalls.filter((call) => call.name === "admin_set_cart_share_global" || call.name === "admin_set_cart_share_grant").length);
  expect(during).toBe(0);
  await page.evaluate(() => window.__releaseAdminAuth());
  await expect.poll(() => page.evaluate(() => window.__memberDirectoryCalls.filter((call) => call.name === "admin_set_cart_share_global" || call.name === "admin_set_cart_share_grant").length)).toBe(1);
  await expect(page.locator("#cartShareStatus")).toContainText("ئومۇمىي ئىجازەت ئوچۇق");
  const onlyGlobal = await page.evaluate(() => window.__memberDirectoryCalls.filter((call) => call.name === "admin_set_cart_share_global" || call.name === "admin_set_cart_share_grant").map((call) => call.name));
  expect(onlyGlobal).toEqual(["admin_set_cart_share_global"]);

  await page.evaluate(() => {
    window.__cartShare.failRead = true;
  });
  await page.locator("#reloadMembers").click();
  await expect(page.locator("#cartShareRetry")).toBeVisible();
  await page.evaluate(() => {
    window.__cartShare.failRead = false;
    window.__cartShare.holdRead = true;
    window.__cartShareReadQueue = [];
    document.querySelector("#cartShareRetry").click();
    document.querySelector("#cartShareRetry").click();
  });
  await expect.poll(() => page.evaluate(() => (window.__cartShareReadQueue || []).length)).toBe(2);
  await page.evaluate(() => {
    const queue = window.__cartShareReadQueue;
    window.__cartShare.global = false;
    queue[1]();
    window.__cartShare.global = true;
    queue[0]();
  });
  await expect(page.locator("#cartShareStatus")).toContainText("ئومۇمىي ئىجازەت تاقاق");
  await expect(page.locator("#cartShareStatus")).not.toContainText("ئومۇمىي ئىجازەت ئوچۇق");

  await page.evaluate(() => {
    window.__cartShare.holdRead = false;
    let release;
    window.__adminAuthGate = new Promise((resolve) => { release = resolve; });
    window.__releaseAdminAuth = () => {
      const done = release;
      window.__adminAuthGate = null;
      done();
    };
    window.__writesAtChange = window.__memberDirectoryCalls.filter((call) => call.name === "admin_set_cart_share_global").length;
    document.querySelector("#cartShareGlobal").click();
  });
  await page.locator("#adminMemberPager").getByRole("button", { name: "كېيىنكى" }).click();
  await page.evaluate(() => {
    window.__memberDirectoryUser = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    window.__memberDirectoryAal = "aal1";
    window.__releaseAdminAuth();
  });
  await expect.poll(() => page.evaluate(() => window.__memberDirectoryCalls.filter((call) => call.name === "admin_set_cart_share_global").length)).toBe(await page.evaluate(() => window.__writesAtChange));
  await expect(page.locator("#cartShareStatus")).not.toContainText("ئومۇمىي ئىجازەت ئوچۇق");
});

test("ordinary navigation requests the current shop pin", async ({ page }) => {
  await H.installReadSafeNetwork(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("script[src*='shop.js']").first()).toHaveAttribute("src", /shop\.js\?v=187/);
  const body = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='shop.js']").src)).text());
  expect(body).toContain("my_cart_share_permission");
  expect(body).not.toContain("shop.js?v=151");
});
