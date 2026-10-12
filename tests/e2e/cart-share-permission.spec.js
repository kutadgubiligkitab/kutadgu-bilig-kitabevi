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
        getSession: async () => ({
          data: {
            session: window.__memberDirectoryUser ? {
              access_token: token(window.__memberDirectoryAal, window.__memberDirectoryUser),
              user: { id: window.__memberDirectoryUser }
            } : null
          },
          error: null
        })
      },
      rpc(name, args) {
        window.__memberDirectoryCalls.push({ name: name, args: args });
        if (name === "admin_member_directory_page") {
          return Promise.resolve({ data: answer(window.__kutadguMemberDirectoryMembers, args), error: null });
        }
        if (name === "set_member_status") return Promise.resolve({ data: null, error: null });
        if (name === "admin_cart_share_state") {
          if (window.__cartShare.failRead) return Promise.resolve({ data: null, error: { message: "read failed" } });
          const ids = Array.isArray(args.p_user_ids) ? args.p_user_ids : [];
          return Promise.resolve({
            data: {
              global_enabled: window.__cartShare.global === true,
              self_id: window.__memberDirectoryUser,
              self_granted: window.__cartShare.grants[window.__memberDirectoryUser] === true,
              self_eligible: true,
              grants: ids.map((id) => ({ id: id, granted: window.__cartShare.grants[id] === true }))
            },
            error: null
          });
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
  const beforeSwitch = jobs.length;
  await page.evaluate((nextId) => {
    const member = window.KutadguMember;
    member.getUser = () => ({ id: nextId });
    member.getProfile = () => ({ status: "active", id: nextId });
    member.isBlocked = () => false;
    document.dispatchEvent(new Event("kutadgu-member-change"));
  }, MEMBER_B);
  await expect.poll(() => jobs.length).toBeGreaterThan(beforeSwitch);
  for (let index = 0; index < beforeSwitch; index += 1) jobs[index](true);
  await page.waitForTimeout(500);
  await expect(page.locator("#shareCart")).toHaveCount(0);
  for (let index = beforeSwitch; index < jobs.length; index += 1) jobs[index](false);
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

test("ordinary navigation requests the current shop pin", async ({ page }) => {
  await H.installReadSafeNetwork(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("script[src*='shop.js']").first()).toHaveAttribute("src", /shop\.js\?v=152/);
  const body = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='shop.js']").src)).text());
  expect(body).toContain("my_cart_share_permission");
  expect(body).not.toContain("shop.js?v=151");
});
