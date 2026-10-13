const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const path = require("path");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STUB = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");

function jwtFor(userId) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  return header + "." + payload + ".sig";
}

function sessionFor(userId) {
  return {
    access_token: jwtFor(userId),
    refresh_token: "test-refresh-" + userId.slice(0, 8),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: userId.slice(0, 8) + "@example.com",
      app_metadata: { provider: "email" },
      user_metadata: { full_name: "ئەزا" },
      created_at: "2026-10-13T00:00:00Z"
    }
  };
}

function profileFor(userId, status) {
  return {
    id: userId,
    full_name: "ئەزا",
    status: status || "active",
    email: userId.slice(0, 8) + "@example.com"
  };
}

function giftBook(id, title, extra) {
  return Object.assign({
    id: id,
    title: title,
    author: "سىناق ئاپتور",
    image_url: "/kutadgu-logo.png",
    stock: 4,
    stock_status: "in_stock",
    is_active: true,
    submission_status: "approved",
    price: 180
  }, extra || {});
}

function offerRow(book, enabled) {
  return {
    book_id: book.id,
    enabled: enabled !== false,
    updated_at: "2026-10-13T00:00:00.000Z",
    books: book
  };
}

async function installMemberBoundary(page, gates) {
  await page.addInitScript((seed) => {
    window.__giftOpens = [];
    window.open = (url) => {
      window.__giftOpens.push(String(url || ""));
      return { opener: null, closed: false };
    };
    const stored = seed.storedSession || seed.session;
    if (stored) localStorage.setItem("kutadgu-member-auth-v1", JSON.stringify(stored));
    else localStorage.removeItem("kutadgu-member-auth-v1");
    localStorage.setItem("kutadgu-shop-owner-v1", seed.owner || "guest");
    localStorage.setItem("kutadgu-cart-v1", "[]");
    localStorage.setItem("kutadgu-favorites-v1", "[]");
  }, { session: gates.session || null, storedSession: gates.storedSession || null, owner: gates.owner || "guest" });
  await page.route("**://*.supabase.co/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (/\/auth\/v1\//.test(url)) {
      if (gates.holdAuth) await gates.holdAuth;
      if (url.includes("/logout")) {
        gates.session = null;
        gates.userId = "";
        return route.fulfill({ status: 204, body: "" });
      }
      if (gates.failAuth) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "auth failed" }) });
      }
      const session = gates.session;
      if (!session) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "no session" }) });
      if (url.includes("/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    }
    if (/\/rest\/v1\/gift_book_offers/.test(url)) {
      gates.giftReads += 1;
      if (gates.failGifts) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "gift read failed", code: "gift_read_failed" }) });
      }
      const holdThisRead = gates.holdGiftRead == null ? gates.giftReads === 1 : gates.giftReads === gates.holdGiftRead;
      if (gates.holdGifts && holdThisRead) await gates.holdGifts;
      if (gates.rejectGifts) return route.abort("failed");
      const rows = typeof gates.offers === "function" ? gates.offers() : (gates.offers || []);
      if (url.includes("book_id=eq.")) {
        const id = decodeURIComponent((url.match(/book_id=eq\.([^&]+)/) || [])[1] || "");
        const hit = rows.find((row) => String(row.book_id) === id);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hit ? { book_id: hit.book_id, enabled: hit.enabled, updated_at: hit.updated_at } : null) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (/\/rest\/v1\/books/.test(url) && /[?&]id=in\./.test(url)) {
      if (gates.holdPublicBooks) await gates.holdPublicBooks;
      const raw = decodeURIComponent((url.match(/[?&]id=in\.([^&]+)/) || [])[1] || "");
      const ids = raw.replace(/^\(/, "").replace(/\)$/, "").split(",").filter(Boolean);
      const rows = (gates.publicBooks || []).filter((book) => ids.includes(String(book.id)));
      const last = Math.max(0, rows.length - 1);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": rows.length ? `0-${last}/${rows.length}` : "*/0" },
        body: JSON.stringify(rows)
      });
    }
    if (/\/rest\/v1\/books/.test(url) && /[?&]id=eq\./.test(url)) {
      if (gates.holdBookRead) await gates.holdBookRead;
      const id = decodeURIComponent((url.match(/id=eq\.([^&]+)/) || [])[1] || "");
      const rows = typeof gates.offers === "function" ? gates.offers() : (gates.offers || []);
      const hit = rows.find((row) => String(row.book_id) === id);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hit ? hit.books : null) });
    }
    if (/\/rest\/v1\/profiles/.test(url)) {
      if (!gates.session || gates.missingProfile) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([profileFor(gates.session.user.id, gates.profileStatus || "active")]) });
    }
    if (/\/rest\/v1\/(member_cart_items|member_favorites|orders)/.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (/\/rest\/v1\/rpc\//.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    }
    if (method === "GET" || method === "HEAD") {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": "*/0" }, body: method === "HEAD" ? "" : "[]" });
    }
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "unexpected supabase write" }) });
  });
}

function hold() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

async function openHome(page, width) {
  await page.setViewportSize({ width: width || 1280, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#newBooksCarousel")).toBeVisible();
  await expect(page.locator('[data-carousel-mode="gifts"]')).toBeVisible();
}

test.describe("members-only physical gift books", () => {
  test("signed-out visitors keep the public tab and see an invitation", async ({ page }) => {
    const gates = { giftReads: 0, offers: [offerRow(giftBook(91001, "يوشۇرۇن سوۋغا"), true)] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack")).toContainText("Recommended Stub");
    expect(gates.giftReads).toBe(0);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    await expect(page.locator("[data-gift-state='guest'] a")).toHaveAttribute("href", "account.html#signup");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("يوشۇرۇن سوۋغا");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("ھازىر سوۋغا قىلىنىدىغان كىتاب يوق");
    expect(gates.giftReads).toBe(0);
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain("gift_book_offers");
    expect(stored).not.toContain("يوشۇرۇن سوۋغا");
  });

  test("eligible members see available gifts before the public tabs", async ({ page }) => {
    const book = giftBook(91001, "ھەقسىز سوۋغا كىتاب");
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: [offerRow(book, true)] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator(".home-carousel-gift-label").first()).toHaveText("ھەقسىز قەغەز سوۋغا");
    await expect(page.locator("[data-gift-request='91001']")).toHaveText("WhatsApp ئارقىلىق سوراش");
    await expect(page.locator("#homeCarouselTrack")).toContainText("ھەقسىز سوۋغا كىتاب");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("180");
    await expect(page.locator("#homeCarouselTrack [data-cart-id]")).toHaveCount(0);
    await page.locator('[data-carousel-mode="recommended"]').click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("Recommended Stub");
    await expect(page.locator(".home-carousel-price").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack [data-cart-id]").first()).toBeVisible();
  });

  test("a successful empty gift read falls through, and a manual empty tab stays", async ({ page }) => {
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: [] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack")).toContainText("Recommended Stub");
    await expect(page.locator("[data-gift-state='empty']")).toHaveCount(0);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-gift-state='empty']")).toContainText("ھازىر سوۋغا قىلىنىدىغان كىتاب يوق");
    await page.waitForTimeout(400);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
  });

  test("empty gifts and empty recommended land on another public tab", async ({ page }) => {
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: [] };
    await H.installCarouselCatalogStub(page, { recommended: false, newest: true, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack")).toContainText("Newest Stub");
  });

  test("a failed gift read stays an error and retry is scoped", async ({ page }) => {
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, failGifts: true, offers: [offerRow(giftBook(91001, "كېيىنكى سوۋغا"), true)] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-state='error']")).toContainText("سوۋغا كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Recommended Stub");
    await expect(page.locator("[data-gift-state='empty']")).toHaveCount(0);
    const reads = gates.giftReads;
    gates.failGifts = false;
    await page.locator("[data-gift-retry]").click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("كېيىنكى سوۋغا");
    expect(gates.giftReads).toBeGreaterThan(reads);
  });

  test("unresolved and failed authentication do not fetch gifts", async ({ page }) => {
    const held = hold();
    const stale = sessionFor(MEMBER);
    stale.expires_at = Math.floor(Date.now() / 1000) - 120;
    const gates = {
      giftReads: 0,
      holdAuth: held.promise,
      storedSession: stale,
      offers: [offerRow(giftBook(91001, "يوشۇرۇن سوۋغا"), true)]
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect.poll(() => page.evaluate(() => document.querySelector("#homeCarouselViewport")?.dataset.kutadguCarouselReady || "")).toBe("1");
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-state='unresolved']")).toBeVisible();
    expect(gates.giftReads).toBe(0);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("يوشۇرۇن سوۋغا");
    held.release();
    await expect(page.locator("[data-gift-state='unresolved'], [data-gift-state='guest']")).toBeVisible();
    await expect(page.locator("[data-gift-state='empty']")).toHaveCount(0);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("يوشۇرۇن سوۋغا");
    expect(gates.giftReads).toBe(0);
  });

  test("a missing profile stays unresolved and does not reveal offers", async ({ page }) => {
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      missingProfile: true,
      offers: [offerRow(giftBook(91001, "يوشۇرۇن سوۋغا"), true)]
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-state='unresolved']")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("يوشۇرۇن سوۋغا");
    expect(gates.giftReads).toBe(0);
  });

  test("a suspended profile does not reveal offers", async ({ page }) => {
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      profileStatus: "suspended",
      offers: [offerRow(giftBook(91001, "يوشۇرۇن سوۋغا"), true)]
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("يوشۇرۇن سوۋغا");
    await expect(page.locator("[data-gift-state='guest'], [data-gift-state='blocked']")).toHaveCount(1);
    expect(gates.giftReads).toBe(0);
  });

  test("logout and a late response cannot restore gift cards", async ({ page }) => {
    const held = hold();
    const book = giftBook(91001, "كېچىككەن سوۋغا");
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      holdGifts: held.promise,
      holdGiftRead: 3,
      offers: [offerRow(book, true)]
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("#homeCarouselTrack")).toContainText("كېچىككەن سوۋغا");
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect.poll(() => gates.giftReads).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.KutadguMember.signOut());
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("كېچىككەن سوۋغا");
    held.release();
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("كېچىككەن سوۋغا");
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
  });

  test("a manual tab choice beats a late gift response", async ({ page }) => {
    const held = hold();
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      holdGifts: held.promise,
      offers: [offerRow(giftBook(91001, "كېچىككەن سوۋغا"), true)]
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("Newest Stub");
    held.release();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack")).toContainText("Newest Stub");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("كېچىككەن سوۋغا");
  });

  test("stock, manual status, and disabled offers stay off the gift tab", async ({ page }) => {
    const offers = [
      offerRow(giftBook(1, "بار سوۋغا"), true),
      offerRow(giftBook(2, "نۆل ئامبار", { stock: 0 }), true),
      offerRow(giftBook(3, "قولدا تۈگەنگەن", { stock: 5, stock_status: "out_of_stock" }), true),
      offerRow(giftBook(4, "ئۆچۈك سوۋغا"), false)
    ];
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: offers };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("#homeCarouselTrack")).toContainText("بار سوۋغا");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("نۆل ئامبار");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("قولدا تۈگەنگەن");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("ئۆچۈك سوۋغا");
  });

  test("the gift request rechecks the offer before opening WhatsApp", async ({ page }) => {
    const book = giftBook(91001, "سوۋغا كىتاب");
    const offers = [offerRow(book, true)];
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: () => offers };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-request='91001']")).toBeVisible();
    offers[0] = offerRow(book, false);
    await page.locator("[data-gift-request='91001']").click();
    await expect(page.locator("[data-gift-state='unavailable']")).toContainText("بۇ سوۋغا ھازىر ئىشلەتكىلى بولمايدۇ");
    const opens = await page.evaluate(() => window.__giftOpens);
    expect(opens).toEqual([]);
    offers[0] = offerRow(book, true);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-request='91001']")).toBeVisible();
    await page.locator("[data-gift-request='91001']").click();
    await expect.poll(() => page.evaluate(() => window.__giftOpens.length)).toBe(1);
    const url = await page.evaluate(() => window.__giftOpens[0]);
    expect(url).toContain("https://wa.me/905368999888?text=");
    expect(decodeURIComponent(url)).toContain("سوۋغا كىتاب");
    expect(decodeURIComponent(url)).toContain("/book/91001");
    expect(decodeURIComponent(url)).not.toContain("180");
    expect(decodeURIComponent(url)).not.toContain("₺");
  });

  test("account switch clears the previous gift list", async ({ page }) => {
    const first = [offerRow(giftBook(91001, "بىرىنچى سوۋغا"), true)];
    const second = [offerRow(giftBook(91002, "ئىككىنچى سوۋغا"), true)];
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: () => first };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("#homeCarouselTrack")).toContainText("بىرىنچى سوۋغا");
    gates.offers = () => second;
    gates.session = sessionFor(OTHER);
    await page.evaluate(async (next) => {
      const client = window.KutadguMember.getClient();
      await client.auth.setSession({ access_token: next.access_token, refresh_token: next.refresh_token });
    }, gates.session);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("بىرىنچى سوۋغا");
    await expect(page.locator("#homeCarouselTrack")).toContainText("ئىككىنچى سوۋغا");
  });

  async function expectGiftCard(page, id) {
    await expect(page.locator(".home-carousel-gift-label").first()).toHaveText("ھەقسىز قەغەز سوۋغا");
    await expect(page.locator(`[data-gift-request='${id}']`)).toHaveCount(1);
    await expect(page.locator("#homeCarouselTrack [data-cart-id]")).toHaveCount(0);
    await expect(page.locator(".home-carousel-price")).toHaveCount(0);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("باھا تېخى بېكىتىلمىگەن");
  }

  test("gift cards stay gifts after a two-row resize", async ({ page }) => {
    await page.addInitScript(() => {
      window.KUTADGU_APP_CONFIG = Object.assign({}, window.KUTADGU_APP_CONFIG, { carousel: { desktopRows: 2 } });
    });
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: [offerRow(giftBook(91001, "ھەقسىز سوۋغا كىتاب"), true)] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expectGiftCard(page, "91001");
    await page.setViewportSize({ width: 390, height: 800 });
    await expectGiftCard(page, "91001");
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
  });

  test("gift cards stay gifts after a one-row resize", async ({ page }) => {
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: [offerRow(giftBook(91001, "ھەقسىز سوۋغا كىتاب"), true)] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expectGiftCard(page, "91001");
    await page.setViewportSize({ width: 390, height: 800 });
    await expectGiftCard(page, "91001");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectGiftCard(page, "91001");
  });

  test("a two-row resize keeps gift messages", async ({ page }) => {
    await page.addInitScript(() => {
      window.KUTADGU_APP_CONFIG = Object.assign({}, window.KUTADGU_APP_CONFIG, { carousel: { desktopRows: 2 } });
    });
    const gates = { giftReads: 0, offers: [offerRow(giftBook(91001, "يوشۇرۇن سوۋغا"), true)] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack [data-cart-id]")).toHaveCount(0);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("يوشۇرۇن سوۋغا");
  });

  test("a two-row resize keeps empty, error, loading, and unavailable gift states", async ({ page }) => {
    await page.addInitScript(() => {
      window.KUTADGU_APP_CONFIG = Object.assign({}, window.KUTADGU_APP_CONFIG, { carousel: { desktopRows: 2 } });
    });
    const book = giftBook(91001, "سوۋغا كىتاب");
    const offers = [offerRow(book, true)];
    const held = hold();
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      offers: () => offers,
      failGifts: true,
      holdGifts: held.promise,
      holdGiftRead: 3
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-state='error']")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator("[data-gift-state='error']")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack [data-cart-id]")).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    gates.failGifts = false;
    offers.splice(0, offers.length);
    await page.locator("[data-gift-retry]").click();
    await expect(page.locator("[data-gift-state='empty']")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator("[data-gift-state='empty']")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    offers.push(offerRow(book, true));
    const reads = gates.giftReads;
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect.poll(() => gates.giftReads).toBeGreaterThan(reads);
    await expect(page.locator(".is-skeleton").first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator(".is-skeleton").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack [data-cart-id]")).toHaveCount(0);
    await expect(page.locator(".home-carousel-gift-label")).toHaveCount(0);
    held.release();
    await expect(page.locator("[data-gift-request='91001']")).toBeVisible();
    offers[0] = offerRow(giftBook(91001, "سوۋغا كىتاب", { stock: 0 }), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("[data-gift-request='91001']").click();
    await expect(page.locator("[data-gift-state='unavailable']")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator("[data-gift-state='unavailable']")).toBeVisible();
    expect(await page.evaluate(() => window.__giftOpens)).toEqual([]);
  });

  function publicGiftBook(id, title, price) {
    return {
      id: id,
      title: title,
      author: "سىناق ئاپتور",
      price: price,
      stock: 4,
      stock_status: "in_stock",
      is_active: true,
      submission_status: "approved",
      image_url: "/kutadgu-logo.png"
    };
  }

  test("a gift heart favorites the public book and leaves paid cards unchanged", async ({ page }) => {
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      offers: [offerRow(giftBook(95077, "سوۋغا كۆرۈنۈشى"), true)],
      publicBooks: [publicGiftBook(95077, "ئاممىۋى كىتاب", 180)]
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, passIdIn: true });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expectGiftCard(page, "95077");
    await expect.poll(() => page.evaluate(() => {
      const found = window.kutadguShop.find("95077");
      return found ? { title: found.title, price: found.price } : null;
    })).toEqual({ title: "ئاممىۋى كىتاب", price: 180 });
    await page.locator("[data-fav-id='95077']").click();
    await expect.poll(() => page.evaluate(() => window.kutadguShop.favorites())).toEqual(["95077"]);
    const stored = await page.evaluate(() => ({
      owner: localStorage.getItem("kutadgu-shop-owner-v1"),
      dump: JSON.stringify(localStorage)
    }));
    expect(stored.owner).toBe(MEMBER);
    expect(stored.dump).toContain("95077");
    expect(stored.dump).not.toContain("gift_book_offers");
    expect(stored.dump).not.toContain("سوۋغا كۆرۈنۈشى");
    await page.locator("[data-fav-id='95077']").click();
    await expect.poll(() => page.evaluate(() => window.kutadguShop.favorites())).toEqual([]);
    await page.locator('[data-carousel-mode="recommended"]').click();
    await expect(page.locator(".home-carousel-price").first()).toContainText("25");
    await expect(page.locator("#homeCarouselTrack [data-cart-id]").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("باھا تېخى بېكىتىلمىگەن");
    expect(await page.evaluate(() => window.kutadguShop.find("95077").price)).toBe(180);
  });

  test("a delayed gift favorite is dropped on logout and on an account switch", async ({ page }) => {
    const held = hold();
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      offers: () => [offerRow(giftBook(95077, "سوۋغا كۆرۈنۈشى"), true)],
      publicBooks: [publicGiftBook(95077, "ئاممىۋى كىتاب", 180)],
      holdPublicBooks: held.promise
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, passIdIn: true });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-fav-id='95077']")).toBeVisible();
    expect(await page.evaluate(() => window.kutadguShop.find("95077") || null)).toBeNull();
    await page.locator("[data-fav-id='95077']").click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.kutadguShop.favorites())).toEqual([]);
    await page.evaluate(() => window.KutadguMember.signOut());
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    held.release();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.kutadguShop.favorites())).toEqual([]);
    const storedFav = await page.evaluate(() => localStorage.getItem("kutadgu-favorites-v1"));
    expect(storedFav || "[]").not.toContain("95077");
  });

  test("a delayed gift favorite does not move to the next account", async ({ page }) => {
    const held = hold();
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      offers: () => [offerRow(giftBook(95077, "سوۋغا كۆرۈنۈشى"), true)],
      publicBooks: [publicGiftBook(95077, "ئاممىۋى كىتاب", 180)],
      holdPublicBooks: held.promise
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, passIdIn: true });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-fav-id='95077']")).toBeVisible();
    await page.locator("[data-fav-id='95077']").click();
    gates.session = sessionFor(OTHER);
    gates.offers = () => [offerRow(giftBook(95078, "باشقا سوۋغا"), true)];
    gates.publicBooks = [publicGiftBook(95078, "باشقا ئاممىۋى", 90)];
    await page.evaluate(async (next) => {
      const client = window.KutadguMember.getClient();
      await client.auth.setSession({ access_token: next.access_token, refresh_token: next.refresh_token });
    }, gates.session);
    await expect(page.locator("#homeCarouselTrack")).toContainText("باشقا سوۋغا");
    held.release();
    await page.waitForTimeout(500);
    const fav = await page.evaluate(() => window.kutadguShop.favorites());
    expect(fav).not.toContain("95077");
    expect(await page.evaluate(() => localStorage.getItem("kutadgu-shop-owner-v1"))).toBe(OTHER);
    await page.locator('[data-carousel-mode="recommended"]').click();
    await expect(page.locator(".home-carousel-price").first()).toContainText("25");
    await expect(page.locator("#homeCarouselTrack [data-cart-id]").first()).toBeVisible();
  });

  test("a held gift recheck does not open WhatsApp after logout", async ({ page }) => {
    const held = hold();
    const book = giftBook(91001, "سوۋغا كىتاب");
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      holdGifts: held.promise,
      holdBookRead: held.promise,
      holdGiftRead: 3,
      offers: [offerRow(book, true)]
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-request='91001']")).toBeVisible();
    const click = page.locator("[data-gift-request='91001']").click();
    await expect.poll(() => gates.giftReads).toBeGreaterThanOrEqual(3);
    await page.evaluate(() => window.KutadguMember.signOut());
    held.release();
    await click;
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    expect(await page.evaluate(() => window.__giftOpens)).toEqual([]);
  });

  test("a held gift recheck does not open WhatsApp after stock exhaustion", async ({ page }) => {
    const held = hold();
    const offers = [offerRow(giftBook(91001, "سوۋغا كىتاب"), true)];
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      holdGifts: held.promise,
      holdBookRead: held.promise,
      holdGiftRead: 3,
      offers: () => offers
    };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-request='91001']")).toBeVisible();
    const click = page.locator("[data-gift-request='91001']").click();
    await expect.poll(() => gates.giftReads).toBeGreaterThanOrEqual(3);
    offers[0] = offerRow(giftBook(91001, "سوۋغا كىتاب", { stock: 0 }), true);
    held.release();
    await click;
    await expect(page.locator("[data-gift-state='unavailable']")).toBeVisible();
    expect(await page.evaluate(() => window.__giftOpens)).toEqual([]);
  });

  test("gift tab fits both themes and a narrow viewport", async ({ page }) => {
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: [offerRow(giftBook(91001, "ھەقسىز سوۋغا كىتاب"), true)] };
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await installMemberBoundary(page, gates);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      if (width === 390) await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-carousel-mode="gifts"]')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.locator('[data-carousel-mode="gifts"]').focus();
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    }
    await page.evaluate(() => {
      document.documentElement.classList.add("dark-mode");
      document.body.classList.add("dark-mode");
    });
    await expect(page.locator(".home-carousel-gift-card").first()).toBeVisible();
    const darkOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(darkOverflow).toBeLessThanOrEqual(1);
    const dir = await page.locator("html").getAttribute("dir");
    expect(dir).toBe("rtl");
  });

  function paidCarouselFlags(extra) {
    return Object.assign({
      recommended: true,
      newest: false,
      bestseller: false,
      pageRecommended: true,
      holdRecommendedAppend: true,
      recommendedTotal: 24,
      recommendedStartId: 97000
    }, extra || {});
  }

  async function attrValues(page, selector, name) {
    return page.locator(selector).evaluateAll((nodes, attr) => {
      return [...new Set(nodes.map((node) => node.getAttribute(attr)).filter(Boolean))];
    }, name);
  }

  async function advanceUntilRecommendedAppend(page) {
    await page.locator("#newBooksCarousel").hover();
    for (let step = 0; step < 4; step += 1) {
      await page.locator("#carouselNext").click();
      await page.waitForTimeout(40);
    }
    await page.locator("#carouselNext").click();
    await page.locator("#newBooksCarousel").dispatchEvent("mouseenter");
    await expect.poll(() => page.evaluate(() => window.__carouselRecommendedHeld === true)).toBe(true);
  }

  async function releaseRecommendedAppend(page) {
    await page.evaluate(() => {
      if (typeof window.__releaseCarouselRecommended === "function") window.__releaseCarouselRecommended();
    });
  }

  async function showRecommendedPage(page) {
    await page.locator("#newBooksCarousel").hover();
    await page.locator('[data-carousel-mode="recommended"]').click();
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-cart-id='97000']").first()).toBeVisible();
    await expect(page.locator("[data-cart-id='97007']").first()).toBeVisible();
    await expect(page.locator("[data-cart-id='97008']")).toHaveCount(0);
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
  }

  test("a held recommended page does not replace the populated gift tab", async ({ page }) => {
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      offers: [offerRow(giftBook(95077, "سوۋغا 95077"), true)]
    };
    await H.installCarouselCatalogStub(page, paidCarouselFlags());
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-request='95077']")).toBeVisible();
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-gift-request='95077']")).toBeVisible();
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual(["95077"]);
    expect(await attrValues(page, "#homeCarouselTrack [data-cart-id]", "data-cart-id")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).toContainText("سوۋغا 95077");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 97008");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 97000");
  });

  test("a held recommended page leaves the guest gift invitation in place", async ({ page }) => {
    const gates = { giftReads: 0, session: null, owner: "guest", offers: [offerRow(giftBook(95077, "سوۋغا 95077"), true)] };
    await H.installCarouselCatalogStub(page, paidCarouselFlags());
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-state='guest']")).toContainText("ھەقسىز قەغەز سوۋغا كىتابلارنى كۆرۈش ئۈچۈن ئەزا بولۇڭ");
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
    expect(await attrValues(page, "#homeCarouselTrack [data-cart-id]", "data-cart-id")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 970");
  });

  test("a held recommended page leaves the empty gift state in place", async ({ page }) => {
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: [] };
    await H.installCarouselCatalogStub(page, paidCarouselFlags());
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-state='empty']")).toContainText("ھازىر سوۋغا قىلىنىدىغان كىتاب يوق");
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-gift-state='empty']")).toBeVisible();
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 970");
  });

  test("a held recommended page leaves a gift read error in place", async ({ page }) => {
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      failGifts: true,
      offers: [offerRow(giftBook(95077, "سوۋغا 95077"), true)]
    };
    await H.installCarouselCatalogStub(page, paidCarouselFlags());
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-state='error']")).toBeVisible();
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-state='error']")).toContainText("سوۋغا كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-gift-state='error']")).toBeVisible();
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 970");
    await expect(page.locator("[data-gift-request='95077']")).toHaveCount(0);
  });

  test("logout during a held recommended page cannot restore obsolete cards", async ({ page }) => {
    const gates = {
      giftReads: 0,
      session: sessionFor(MEMBER),
      owner: MEMBER,
      offers: [offerRow(giftBook(95077, "سوۋغا 95077"), true)]
    };
    await H.installCarouselCatalogStub(page, paidCarouselFlags());
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-request='95077']")).toBeVisible();
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-request='95077']")).toBeVisible();
    await page.evaluate(() => window.KutadguMember.signOut());
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    await expect(page.locator("[data-gift-request='95077']")).toHaveCount(0);
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-gift-state='guest']")).toBeVisible();
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
    expect(await attrValues(page, "#homeCarouselTrack [data-cart-id]", "data-cart-id")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("سوۋغا 95077");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 970");
  });

  test("an account switch during a held recommended page cannot restore obsolete cards", async ({ page }) => {
    const first = [offerRow(giftBook(95077, "سوۋغا 95077"), true)];
    const second = [offerRow(giftBook(95078, "سوۋغا 95078"), true)];
    const gates = { giftReads: 0, session: sessionFor(MEMBER), owner: MEMBER, offers: () => first };
    await H.installCarouselCatalogStub(page, paidCarouselFlags());
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await expect(page.locator("[data-gift-request='95077']")).toBeVisible();
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="gifts"]').click();
    await expect(page.locator("[data-gift-request='95077']")).toBeVisible();
    gates.offers = () => second;
    gates.session = sessionFor(OTHER);
    await page.evaluate(async (next) => {
      const client = window.KutadguMember.getClient();
      await client.auth.setSession({ access_token: next.access_token, refresh_token: next.refresh_token });
    }, gates.session);
    await expect(page.locator("[data-gift-request='95078']")).toBeVisible();
    await expect(page.locator("[data-gift-request='95077']")).toHaveCount(0);
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="gifts"]')).toHaveClass(/is-active/);
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual(["95078"]);
    expect(await attrValues(page, "#homeCarouselTrack [data-cart-id]", "data-cart-id")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).toContainText("سوۋغا 95078");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("سوۋغا 95077");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 970");
  });

  test("a held recommended page does not overwrite another public tab", async ({ page }) => {
    const gates = { giftReads: 0, session: null, owner: "guest", offers: [] };
    await H.installCarouselCatalogStub(page, paidCarouselFlags({ newest: true }));
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-cart-id='92001']")).toBeVisible();
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    expect(await attrValues(page, "#homeCarouselTrack [data-cart-id]", "data-cart-id")).toEqual(["92001"]);
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).toContainText("Newest Stub");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 970");
  });

  test("a held recommended page does not overwrite a cached public tab", async ({ page }) => {
    const gates = { giftReads: 0, session: null, owner: "guest", offers: [] };
    await H.installCarouselCatalogStub(page, paidCarouselFlags({ newest: true }));
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await page.locator("#newBooksCarousel").hover();
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator("[data-cart-id='92001']")).toBeVisible();
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator("[data-cart-id='92001']")).toBeVisible();
    await expect(page.locator("[data-cart-id='97008']")).toHaveCount(0);
    await releaseRecommendedAppend(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    expect(await attrValues(page, "#homeCarouselTrack [data-cart-id]", "data-cart-id")).toEqual(["92001"]);
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 970");
  });

  test("same-tab recommended pagination still appends paid books", async ({ page }) => {
    const gates = { giftReads: 0, session: null, owner: "guest", offers: [] };
    await H.installCarouselCatalogStub(page, paidCarouselFlags());
    await installMemberBoundary(page, gates);
    await openHome(page, 1280);
    await showRecommendedPage(page);
    await advanceUntilRecommendedAppend(page);
    await releaseRecommendedAppend(page);
    await page.locator("#newBooksCarousel").dispatchEvent("mouseenter");
    await expect.poll(async () => {
      const ids = await attrValues(page, "#homeCarouselTrack [data-cart-id]", "data-cart-id");
      return ids.slice().sort();
    }).toEqual(Array.from({ length: 16 }, (_, i) => String(97000 + i)));
    expect(await attrValues(page, "#homeCarouselTrack [data-gift-request]", "data-gift-request")).toEqual([]);
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator(".home-carousel-price").first()).toContainText("25");
    await expect(page.locator("#homeCarouselTrack")).toContainText("Paid 97000");
    await expect(page.locator("#homeCarouselTrack")).toContainText("Paid 97015");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Paid 97016");
    await expect(page.locator(".home-carousel-gift-label")).toHaveCount(0);
  });
});

function adminToken(aal) {
  const body = Buffer.from(JSON.stringify({ aal: aal })).toString("base64url");
  return "e30." + body + ".sig";
}

test.describe("admin gift selection", () => {
  test("aal1 cannot write, a failed read is not saved as off, and a new book can skip the offer", async ({ page }) => {
    const writes = [];
    await page.addInitScript((token) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguSkipSuggestFetch = true;
      window.__kutadguSuggestionRows = [];
      window.__kutadguAdminPreviewBooks = [{
        id: 7, title: "تەھرىر كىتاب", author: "ئاپتور", price: 20, source: "universal.html",
        category: "ئۇنىۋېرسال", image_url: "https://cdn.example/cover.webp", is_active: true, stock: 3
      }];
      window.__giftWrites = [];
      window.__kutadguBookSaves = [];
      window.__kutadguAdminPersistBook = async (payload, operation, id) => {
        window.__kutadguBookSaves.push({ payload: Object.assign({}, payload), operation: operation, id: String(id || "") });
        return { error: null, data: [{ id: id || 44 }] };
      };
      window.__kutadguAdminFetchGiftOffer = async () => ({ ok: false, error: new Error("read failed") });
      window.__kutadguAdminPersistGiftOffer = async (id, snapshot) => {
        const row = { id: id, want: snapshot.want };
        window.__giftWrites.push(row);
        return { ok: true, enabled: snapshot.want, updatedAt: "2026-10-13T00:00:00Z", present: true };
      };
      function quietTable() {
        const api = {
          select() { return api; },
          eq() { return api; },
          neq() { return api; },
          or() { return api; },
          limit() { return api; },
          abortSignal() { return api; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          then(ok, bad) { return Promise.resolve({ data: [], error: null }).then(ok, bad); }
        };
        return api;
      }
      window.__kutadguAnalyticsDb = {
        rpc() { return Promise.resolve({ data: null, error: null }); },
        auth: { getSession: async () => ({ data: { session: { user: { id: "admin" }, access_token: token } } }) },
        from() { return quietTable(); }
      };
    }, adminToken("aal1"));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(7));
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookGiftStatus")).toContainText("سوۋغا تەڭشىكى ئوقۇلمىدى");
    await expect(page.locator("#bookIsGift")).toBeDisabled();
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    const failedWrites = await page.evaluate(() => window.__giftWrites.slice());
    expect(failedWrites).toEqual([]);
    expect(await page.evaluate(() => window.__kutadguBookSaves.length)).toBeGreaterThan(0);

    await page.evaluate((token) => {
      window.__kutadguAnalyticsDb.auth.getSession = async () => ({ data: { session: { user: { id: "admin" }, access_token: token } } });
      window.__kutadguAdminFetchGiftOffer = async () => ({ ok: true, present: true, enabled: false, updatedAt: "2026-10-01T00:00:00.000Z" });
    }, adminToken("aal2"));
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(7));
    await expect(page.locator("#bookIsGift")).toBeEnabled();
    await page.locator("#bookIsGift").check();
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    const saved = await page.evaluate(() => window.__giftWrites.slice());
    expect(saved.map((row) => ({ id: String(row.id), want: row.want }))).toEqual([{ id: "7", want: true }]);
    expect((await page.evaluate(() => window.__kutadguBookSaves.at(-1).payload)).price).toBe(20);
    expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call(window.__kutadguBookSaves.at(-1).payload, "enabled"))).toBe(false);
    await page.evaluate(() => {
      window.__kutadguAdminPersistGiftOffer = async () => ({ ok: false, message: "كىتاب ساقلاندى، لېكىن سوۋغا تەڭشىكى يېزىلمىدى." });
      return window.__kutadguAdminTest.openEdit(7);
    });
    await expect(page.locator("#bookIsGift")).toBeEnabled();
    await page.locator("#bookIsGift").check();
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookSaveStatus")).toContainText("كىتاب ساقلاندى، لېكىن سوۋغا تەڭشىكى يېزىلمىدى");
    await expect(page.locator("#bookModal")).toBeVisible();
  });

  test("new unchecked books do not write an offer, and a failed offer write stays partial", async ({ page }) => {
    await page.addInitScript((token) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguSkipSuggestFetch = true;
      window.__kutadguSuggestionRows = [];
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguBookSaves = [];
      window.__giftWrites = [];
      window.__kutadguAdminPersistBook = async (payload, operation, id) => {
        window.__kutadguBookSaves.push({ operation: operation, id: String(id || ""), title: payload.title });
        return { error: null, data: [{ id: 44 }] };
      };
      window.__giftWrites = [];
      window.__kutadguAdminPersistGiftOffer = async (id, snapshot) => {
        window.__giftWrites.push({ id: id, want: snapshot.want });
        return { ok: true, enabled: snapshot.want, updatedAt: "2026-10-13T00:00:00Z", present: true };
      };
    }, adminToken("aal2"));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#newBookBtn").click();
    await page.locator("#bookTitle").fill("يېڭى كىتاب");
    await page.locator("#bookAuthor").fill("يېڭى ئاپتور");
    await page.locator("#bookPrice").fill("12");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookCover").setInputFiles(STUB);
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    expect(await page.evaluate(() => window.__giftWrites.slice())).toEqual([]);

    await page.locator("#newBookBtn").click();
    await page.locator("#bookTitle").fill("سوۋغالىق يېڭى كىتاب");
    await page.locator("#bookAuthor").fill("يېڭى ئاپتور");
    await page.locator("#bookPrice").fill("12");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookCover").setInputFiles(STUB);
    await page.locator("#bookIsGift").check();
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookSaveStatus")).toContainText("ئىككىنچى دەلىللەش");
    await expect(page.locator("#bookModal")).toBeVisible();
    expect(await page.evaluate(() => window.__giftWrites.slice())).toEqual([]);
  });

  test("a delayed offer read does not mark a different book", async ({ page }) => {
    await page.addInitScript((token) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguSkipSuggestFetch = true;
      const books = {
        7: { id: 7, title: "بىرىنچى", author: "ئاپتور", price: 10, source: "universal.html", image_url: "https://cdn.example/a.webp", is_active: true, stock: 2 },
        8: { id: 8, title: "ئىككىنچى", author: "ئاپتور", price: 11, source: "universal.html", image_url: "https://cdn.example/b.webp", is_active: true, stock: 2 }
      };
      window.__kutadguAdminPreviewBooks = Object.values(books);
      window.__kutadguAdminFetchBook = async (id) => books[String(id)];
      let releaseFirst;
      window.__releaseFirstGift = () => releaseFirst && releaseFirst();
      window.__kutadguAdminFetchGiftOffer = (id) => {
        if (String(id) === "7") {
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ ok: true, present: true, enabled: true, updatedAt: "2026-10-01T00:00:00.000Z" });
          });
        }
        return Promise.resolve({ ok: true, present: true, enabled: false, updatedAt: "2026-10-02T00:00:00.000Z" });
      };
      window.__kutadguAnalyticsDb = {
        rpc() { return Promise.resolve({ data: null, error: null }); },
        auth: { getSession: async () => ({ data: { session: { user: { id: "admin" }, access_token: token } } }) }
      };
    }, adminToken("aal2"));
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(7));
    await expect(page.locator("#bookGiftStatus")).toContainText("يۈكلىنىۋاتىدۇ");
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(8));
    await expect(page.locator("#bookTitle")).toHaveValue("ئىككىنچى");
    await expect(page.locator("#bookIsGift")).not.toBeChecked();
    await page.evaluate(() => window.__releaseFirstGift());
    await page.waitForTimeout(300);
    await expect(page.locator("#bookTitle")).toHaveValue("ئىككىنچى");
    await expect(page.locator("#bookIsGift")).not.toBeChecked();
  });
});
