const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const HEADLINE = "سېۋەتتىكى كىتابلارنى ھېسابىڭىزدا ساقلاڭ";
const CTA = "ئەزا بولۇش";
const CONFIRM = "ئېلخەتتىكى جەزملەشتۈرۈش ئۇلانمىسىنى بېسىپ ئاندىن كىرىڭ";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  row("91021", "مېھمان كىتاب", 153, 8),
  row("91022", "ئىككىنچى كىتاب", 147, 8),
  row("91023", "تۈگەپ كەتكەن كىتاب", 153, 0)
];

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

async function installMember(page, options) {
  await page.addInitScript((opts) => {
    window.KutadguMember = (function () {
      let user = null;
      let profile = null;
      let blocked = false;
      let boot = false;
      let configured = true;
      let error = null;
      let signupMode = opts.signupMode || "session";
      const api = {
        ready: Promise.resolve(),
        configured() { return configured; },
        sessionBootDone() { return boot; },
        getUser() { return user; },
        getProfile() { return profile; },
        isBlocked() { return blocked; },
        applyFieldDirections() {},
        getClient() { return null; },
        async getOrders() { return []; },
        async signIn() { throw new Error("unused"); },
        async signUp() {
          if (signupMode === "fail") throw new Error("signup failed");
          if (signupMode === "confirm") return { session: null, user: null };
          user = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "new@example.com" };
          profile = { full_name: "يېڭى ئەزا", status: "active" };
          document.dispatchEvent(new CustomEvent("kutadgu-member-change", { detail: { user, profile, blocked, error } }));
          return { session: { user }, user };
        },
        async signOut() {
          user = null;
          profile = null;
          blocked = false;
        },
        async resetPassword() {},
        async signInWithGoogle() {},
        async updateProfile() {},
        __set(next) {
          if (next && Object.prototype.hasOwnProperty.call(next, "user")) user = next.user;
          if (next && Object.prototype.hasOwnProperty.call(next, "profile")) profile = next.profile;
          if (next && Object.prototype.hasOwnProperty.call(next, "blocked")) blocked = !!next.blocked;
          if (next && Object.prototype.hasOwnProperty.call(next, "boot")) boot = !!next.boot;
          if (next && Object.prototype.hasOwnProperty.call(next, "configured")) configured = !!next.configured;
          if (next && Object.prototype.hasOwnProperty.call(next, "error")) error = next.error;
          if (next && Object.prototype.hasOwnProperty.call(next, "signupMode")) signupMode = next.signupMode;
          document.dispatchEvent(new CustomEvent("kutadgu-member-change", { detail: { user, profile, blocked, error } }));
        }
      };
      return api;
    }());
    if (sessionStorage.getItem("kutadgu-e2e-seeded") === "1") return;
    sessionStorage.setItem("kutadgu-e2e-seeded", "1");
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify(opts.cart || []));
    if (opts.owner) localStorage.setItem("kutadgu-shop-owner-v1", opts.owner);
    else localStorage.removeItem("kutadgu-shop-owner-v1");
    localStorage.removeItem("kutadgu-cart-display-v1");
    localStorage.removeItem("kutadgu-member-auth-v1");
    if (opts.auth) localStorage.setItem("kutadgu-member-auth-v1", JSON.stringify(opts.auth));
  }, options);
}

async function publish(page, detail) {
  await page.waitForFunction(() => document.documentElement.dataset.kutadguShopListeners === "1");
  await page.evaluate((next) => window.KutadguMember.__set(next), detail);
}

const GUEST = { boot: true, configured: true, user: null, profile: null, blocked: false, error: null };

function invite(page) {
  return page.locator("#guestCartInvite");
}

test.describe("guest cart membership invitation", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("shows one invitation only for a confirmed nonempty guest cart", async ({ page }) => {
    test.setTimeout(45_000);
    await installMember(page, { cart: [{ id: "91021", qty: 1 }], owner: "guest" });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(invite(page)).toHaveCount(1);
    await expect(page.locator(".checkout-member-note")).toHaveCount(1);
    await expect(invite(page)).toBeHidden();
    await publish(page, { boot: false, configured: true, user: null, profile: null, blocked: false, error: null });
    await expect(invite(page)).toBeHidden();
    await publish(page, GUEST);
    await expect(invite(page)).toBeVisible();
    await expect(invite(page).locator("p")).toHaveText(HEADLINE);
    await expect(invite(page).locator("a")).toHaveText(CTA);
    await expect(invite(page).locator("a")).toHaveAttribute("href", "account.html#signup");
    await expect(page.locator("#checkoutCard")).toBeVisible();

    await page.locator("[data-remove='91021']").click();
    await expect(page.locator("#cartItems")).toContainText("سېۋەت ھازىرچە بوش");
    await expect(invite(page)).toBeHidden();

    await page.evaluate(() => window.kutadguShop.add("91022", 1));
    await expect(page.locator("#cartItems")).toContainText("ئىككىنچى كىتاب");
    await expect(invite(page)).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#clearCart").click();
    await expect(invite(page)).toBeHidden();
    await expect(page.locator("#cartItems")).toContainText("سېۋەت ھازىرچە بوش");
  });

  test("hides the invitation for auth, foreign, and unresolved states without flashing", async ({ page }) => {
    test.setTimeout(45_000);
    const auth = {
      currentSession: {
        access_token: "local-test-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: USER_A }
      }
    };
    await installMember(page, {
      cart: [{ id: "91021", qty: 2 }],
      owner: USER_A,
      auth: null
    });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await publish(page, GUEST);
    await expect(invite(page)).toBeHidden();
    await expect(page.locator("#cartItems")).not.toContainText("مېھمان كىتاب");
    const stored = await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"));
    expect(stored).toContain("91021");
    expect(await page.evaluate(() => localStorage.getItem("kutadgu-shop-owner-v1"))).toBe(USER_A);
    await page.evaluate((persisted) => {
      localStorage.setItem("kutadgu-member-auth-v1", JSON.stringify(persisted));
    }, auth);
    await publish(page, { boot: false, configured: true, user: null, profile: null, blocked: false, error: null });
    await expect(invite(page)).toBeHidden();

    await page.evaluate(() => {
      localStorage.setItem("kutadgu-shop-owner-v1", "guest");
      localStorage.removeItem("kutadgu-member-auth-v1");
    });
    await page.evaluate(() => {
      const note = document.querySelector("#guestCartInvite");
      window.__inviteLog = [];
      const obs = new MutationObserver(() => {
        const user = window.KutadguMember.getUser();
        window.__inviteLog.push({ hidden: note.hidden, user: user && user.id || "", blocked: window.KutadguMember.isBlocked() });
      });
      obs.observe(note, { attributes: true, attributeFilter: ["hidden"] });
    });
    await publish(page, { boot: true, configured: true, user: { id: USER_A }, profile: null, blocked: false, error: null });
    await publish(page, { boot: true, configured: true, user: { id: USER_A }, profile: { status: "active" }, blocked: false, error: null });
    await publish(page, { boot: true, configured: true, user: { id: USER_B }, profile: { status: "suspended" }, blocked: true, error: null });
    await publish(page, { boot: true, configured: true, user: null, profile: null, blocked: false, error: { message: "init failed" } });
    await expect(invite(page)).toBeHidden();
    const wrong = await page.evaluate(() => window.__inviteLog.filter((row) => row.hidden === false && (row.user || row.blocked)));
    expect(wrong).toEqual([]);
    await expect(page.locator("#cartItems")).toContainText("91021");
    const after = await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"));
    expect(after).toContain("91021");
    expect(after).not.toContain(USER_B);
  });

  test("signup entry preserves the guest cart through failure, confirmation, and back", async ({ page }) => {
    test.setTimeout(45_000);
    await installMember(page, { cart: [{ id: "91021", qty: 2 }], owner: "guest", signupMode: "fail" });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await publish(page, GUEST);
    await invite(page).locator("a").click();
    await expect(page).toHaveURL(/account\.html#signup$/);
    await expect(page.locator("#signupForm")).toBeVisible();
    await expect(page.locator("#loginForm")).toBeHidden();
    const before = await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"));
    await page.locator("#signupName").fill("مېھمان");
    await page.locator("#signupEmail").fill("guest@example.com");
    await page.locator("#signupPassword").fill("password1");
    await page.locator("#signupConfirm").fill("password1");
    await page.locator("#signupForm").locator("button[type='submit']").click();
    await expect(page.locator("#authStatus")).toContainText("مەغلۇپ");
    await expect(page.locator("#signupForm")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"))).toBe(before);

    await page.evaluate(() => window.KutadguMember.__set({ signupMode: "confirm" }));
    await page.locator("#signupForm").locator("button[type='submit']").click();
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#signupForm")).toBeHidden();
    await expect(page.locator("#authStatus")).toContainText(CONFIRM);
    await expect(page.locator("#authStatus")).not.toContainText("سېۋەت");
    expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"))).toBe(before);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("kutadgu-member-change", { detail: { user: null, profile: null, blocked: false, error: null } })));
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#signupForm")).toBeHidden();

    await page.goBack();
    await H.waitForShop(page);
    await publish(page, GUEST);
    await expect(page.locator("#cartItems")).toContainText("مېھمان كىتاب");
    await expect(invite(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"))).toBe(before);
  });

  test("ordinary account entry opens login and a session signup does not clear the cart", async ({ page }) => {
    test.setTimeout(45_000);
    await installMember(page, { cart: [{ id: "91021", qty: 2 }, { id: "91022", qty: 1 }], owner: "guest", signupMode: "session" });
    await mockBooks(page);
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#signupForm")).toBeHidden();
    await page.locator("[data-auth-tab='signup']").click();
    await expect(page.locator("#signupForm")).toBeVisible();
    await page.locator("[data-auth-tab='login']").click();
    await expect(page.locator("#loginForm")).toBeVisible();

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await page.goto("/account.html#signup", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#signupForm")).toBeVisible();
    await page.locator("#signupName").fill("يېڭى ئەزا");
    await page.locator("#signupEmail").fill("new@example.com");
    await page.locator("#signupPassword").fill("password1");
    await page.locator("#signupConfirm").fill("password1");
    await page.locator("#signupForm").locator("button[type='submit']").click();
    await expect(page.locator("#memberPanel")).toBeVisible();
    const cart = await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"));
    expect(cart).toContain("91021");
    expect(cart).toContain("91022");
    const merged = await page.evaluate(() => {
      const local = JSON.parse(localStorage.getItem("kutadgu-cart-v1"));
      const cloud = [{ id: "91021", qty: 5 }, { id: "91024", qty: 1 }];
      return window.KutadguLegacyIds.syncAuthenticatedShopState({
        localCart: local,
        localFav: [],
        cloudCart: cloud,
        cloudFav: [],
        resolveId: (id) => String(id),
        aliasMap: {}
      }).cart;
    });
    expect(merged).toEqual([
      { id: "91021", qty: 5 },
      { id: "91024", qty: 1 },
      { id: "91022", qty: 1 }
    ]);
  });

  test("guest WhatsApp stays compact and stock-blocked checkout stays closed", async ({ page }) => {
    test.setTimeout(45_000);
    await page.addInitScript(() => { window.KUTADGU_STOCK_ENFORCEMENT = true; });
    await installMember(page, { cart: [{ id: "91023", qty: 1 }], owner: "guest" });
    await mockBooks(page);
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await publish(page, GUEST);
    await expect(page.locator("#cartItems")).toContainText("تۈگەپ كەتكەن كىتاب");
    await expect(page.locator("#checkoutCard")).toBeHidden();
    await expect(invite(page)).toBeVisible();
    expect(await page.evaluate(() => window.kutadguShop.buildOrderText(false))).toBeNull();

    await page.evaluate(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "91021", qty: 1 }]));
      window.kutadguShop && document.querySelector("#cartItems");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await publish(page, GUEST);
    await expect(page.locator("#checkoutCard")).toBeVisible();
    await expect(invite(page)).toBeVisible();
    await page.locator("#customerName").fill("Aygul Test");
    await page.locator("#customerPhone").fill("0555 000 11 11");
    await page.locator("#customerCity").fill("Istanbul / Fatih");
    await page.locator("#customerAddress").fill("Test street 1, door 4");
    const opened = [];
    await page.exposeFunction("__kutadguCaptureWa", (url) => opened.push(url));
    await page.evaluate(() => {
      window.open = (url) => {
        window.__kutadguCaptureWa(String(url));
        return { opener: null, close() {} };
      };
    });
    await page.locator("#whatsappOrder").click();
    await expect.poll(() => opened.length).toBe(1);
    const text = decodeURIComponent(opened[0].split("text=")[1]);
    expect(text).toContain("1. مېھمان كىتاب — 1 دانە · 153 ₺");
    expect(text).toContain("*جەمئىي كىتاب سانى: 1 — جەمئىي: 153,00 ₺*");
    expect(text).not.toContain("×");
    expect(await page.evaluate(() => window.kutadguShop.buildOrderText(false))).not.toBeNull();
  });

  test("invitation is readable, keyboard reachable, and wrapped at narrow and desktop widths", async ({ page }) => {
    test.setTimeout(45_000);
    await installMember(page, { cart: [{ id: "91021", qty: 1 }], owner: "guest" });
    await mockBooks(page);
    await page.goto("/cart.html?v=155", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await publish(page, GUEST);
    await expect(page.locator("script[src*='shop.js']")).toHaveAttribute("src", /shop\.js\?v=167/);
    const live = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='shop.js']").src)).text());
    expect(live).toContain("guestCartInviteDecision");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 800 });
      await expect(invite(page)).toBeVisible();
      const box = await invite(page).boundingBox();
      expect(box.width).toBeGreaterThan(80);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      const metrics = await invite(page).evaluate((el) => {
        const link = el.querySelector("a");
        const paragraph = el.querySelector("p");
        const linkStyle = getComputedStyle(link);
        const noteStyle = getComputedStyle(el);
        return {
          dir: noteStyle.direction,
          align: noteStyle.textAlign,
          minHeight: linkStyle.minHeight,
          wrap: noteStyle.overflowWrap,
          paragraphFits: paragraph.scrollWidth <= paragraph.clientWidth + 1,
          pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          lightColor: linkStyle.color,
          lightBackground: noteStyle.backgroundColor
        };
      });
      expect(metrics.dir).toBe("rtl");
      expect(metrics.align).toBe("right");
      expect(metrics.minHeight).toBe("44px");
      expect(metrics.wrap).toBe("anywhere");
      expect(metrics.paragraphFits).toBe(true);
      expect(metrics.pageFits).toBe(true);
      expect(metrics.lightBackground).not.toBe("rgba(0, 0, 0, 0)");
    }

    await page.locator("#guestCartInvite a").focus();
    const focus = await page.locator("#guestCartInvite a").evaluate((el) => {
      const style = getComputedStyle(el);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focus.outlineStyle).not.toBe("none");
    expect(parseFloat(focus.outlineWidth)).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/account\.html#signup$/);

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await publish(page, GUEST);
    const light = await invite(page).locator("a").evaluate((el) => getComputedStyle(el).color);
    await page.evaluate(() => document.body.classList.add("dark-mode"));
    const dark = await invite(page).locator("a").evaluate((el) => getComputedStyle(el).color);
    expect(light).not.toBe(dark);
    const darkBackground = await invite(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(darkBackground).not.toBe("rgba(0, 0, 0, 0)");
  });
});
