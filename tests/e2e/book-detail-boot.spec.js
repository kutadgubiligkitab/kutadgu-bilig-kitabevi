const { test, expect } = require("./playwright-test");

const BOOK_ID = "252";

function textUrl(url) {
  try { return decodeURIComponent(url); } catch (error) { return String(url || ""); }
}

function pageBookUrl(url) {
  const text = textUrl(url);
  return /\/rest\/v1\/books\?/.test(text) && new RegExp(`(?:^|[?&])id=in\\.\\(${BOOK_ID}\\)(?:&|$)`).test(text);
}

function savedBooksUrl(url) {
  const text = textUrl(url);
  return /\/rest\/v1\/books\?/.test(text) && /(?:^|[?&])id=in\.\(/.test(text) && !pageBookUrl(text);
}

function availabilityHead(request) {
  if (request.method() !== "HEAD") return false;
  const text = textUrl(request.url());
  return /\/rest\/v1\/books\?/.test(text) && /(?:^|[?&])select=id(?:&|$)/.test(text) && /is_active=eq\.true/.test(text);
}

async function silenceAnalytics(page) {
  await page.route("**/rest/v1/analytics_events**", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: ""
  }));
}

async function rememberSavedBooks(page) {
  await page.addInitScript(() => {
    const now = Date.now();
    sessionStorage.setItem("kutadgu-catalog-active-count-v1", JSON.stringify({ total: 350, at: now }));
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "100", qty: 1 }]));
    localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["101"]));
    localStorage.setItem("kutadgu-recent-v1", JSON.stringify(["102"]));
  });
}

async function detailState(page) {
  return page.evaluate(() => {
    const cart = document.querySelector(".detail-main-cart");
    return {
      h1: (document.querySelector(".book-detail-info h1") || {}).textContent || "",
      purchase: !!document.querySelector(".detail-purchase-panel:not(.detail-unavailable-panel)"),
      price: (document.querySelector(".detail-price") || {}).textContent || "",
      cartDisabled: cart ? cart.disabled : null,
      fav: !!document.querySelector(".detail-purchase-panel .favorite-button"),
      gallery: !!document.querySelector(".book-gallery-thumbs"),
      reviews: !!document.querySelector("[data-book-reviews]"),
      related: !!document.querySelector("[data-detail-related]"),
      authorHref: (document.querySelector(".book-author a") || {}).getAttribute ? document.querySelector(".book-author a").getAttribute("href") || "" : "",
      boot: (document.querySelector("[data-detail-boot]") || {}).getAttribute ? document.querySelector("[data-detail-boot]").getAttribute("data-detail-boot") || "" : "",
      shop: typeof window.kutadguShop === "object" && !!window.kutadguShop
    };
  });
}

async function expectCompleteDetail(page) {
  await expect.poll(async () => (await detailState(page)).purchase, { timeout: 15000 }).toBe(true);
  const state = await detailState(page);
  expect(state.h1.trim()).not.toBe("");
  expect(state.h1).not.toBe("كىتاب");
  expect(state.price.trim()).not.toBe("");
  expect(state.authorHref).toContain("/author/");
  expect(state.fav).toBe(true);
  expect(state.related).toBe(true);
  expect(state.reviews).toBe(true);
  expect(state.boot).toBe("");
  expect(state.shop).toBe(true);
  return state;
}

test.beforeEach(async ({ page }) => {
  await silenceAnalytics(page);
});

test("direct entry with saved books completes the detail page without reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await rememberSavedBooks(page);
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  const state = await expectCompleteDetail(page);
  expect(state.gallery).toBe(true);
  expect(state.cartDisabled).toBe(false);
  await page.locator(".detail-purchase-panel .favorite-button").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("kutadgu-favorites-v1") || "[]";
    return JSON.parse(raw).map(String);
  })).toContain(BOOK_ID);
  await page.locator(".detail-main-cart").click();
  await expect.poll(async () => page.evaluate((id) => {
    const raw = localStorage.getItem("kutadgu-cart-v1") || "[]";
    return JSON.parse(raw).some((item) => String(item && item.id) === id);
  }, BOOK_ID)).toBe(true);
  expect(errors).toEqual([]);
});

test("phone-width direct entry completes the same detail page without reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await rememberSavedBooks(page);
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  const state = await expectCompleteDetail(page);
  expect(state.gallery).toBe(true);
  expect(state.cartDisabled).toBe(false);
});

test("a storefront card opens a complete detail page without reload", async ({ page }) => {
  await page.goto("/books", { waitUntil: "commit" });
  const card = page.locator("a[href*='/book/']").first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page).toHaveURL(/\/book\/\d+/);
  await expectCompleteDetail(page);
});

test("held credits and saved-book requests do not block purchase", async ({ page }) => {
  let releaseCredits;
  let releaseSaved;
  const creditsGate = new Promise((resolve) => { releaseCredits = resolve; });
  const savedGate = new Promise((resolve) => { releaseSaved = resolve; });
  const seen = [];
  await rememberSavedBooks(page);
  await page.route("**/rest/v1/book_credits**", async (route) => {
    seen.push("credits");
    await creditsGate;
    await route.continue();
  });
  await page.route("**/rest/v1/books**", async (route) => {
    if (!savedBooksUrl(route.request().url())) return route.continue();
    seen.push("saved");
    await savedGate;
    await route.continue();
  });
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expect.poll(async () => (await detailState(page)).purchase, { timeout: 6000 }).toBe(true);
  const early = await detailState(page);
  expect(early.authorHref).toContain("/author/");
  expect(early.boot).toBe("");
  expect(seen).toContain("credits");
  expect(seen).toContain("saved");
  releaseCredits();
  releaseSaved();
  await expectCompleteDetail(page);
});

test("a held page-book request stays pending, then the same request completes the page", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let matched = false;
  await rememberSavedBooks(page);
  await page.route("**/rest/v1/books**", async (route) => {
    if (!pageBookUrl(route.request().url())) return route.continue();
    matched = true;
    await gate;
    await route.continue();
  });
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expect.poll(async () => (await detailState(page)).boot, { timeout: 6000 }).toBe("pending");
  await expect.poll(() => matched).toBe(true);
  await page.waitForTimeout(300);
  const held = await detailState(page);
  expect(held.purchase).toBe(false);
  expect(held.boot).toBe("pending");
  expect(held.h1).not.toBe("كىتاب");
  expect(held.h1.trim()).not.toBe("");
  release();
  const done = await expectCompleteDetail(page);
  expect(done.cartDisabled).toBe(false);
});

test("a rejected page-book request stays unpurchasable until retry", async ({ page }) => {
  let fail = true;
  await rememberSavedBooks(page);
  await page.route("**/rest/v1/books**", async (route) => {
    if (!pageBookUrl(route.request().url())) return route.continue();
    if (fail) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expect.poll(async () => (await detailState(page)).boot, { timeout: 6000 }).toBe("unavailable");
  const failed = await detailState(page);
  expect(failed.purchase).toBe(false);
  expect(failed.h1).not.toBe("كىتاب");
  fail = false;
  await page.locator("[data-detail-boot='unavailable'] .catalog-retry-btn").click();
  const done = await expectCompleteDetail(page);
  expect(done.cartDisabled).toBe(false);
});

test("a held app config shows the book without enabling purchase until config arrives", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await rememberSavedBooks(page);
  await page.route("**/app-config.js**", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expect.poll(async () => (await detailState(page)).purchase, { timeout: 12000 }).toBe(true);
  const waiting = await detailState(page);
  expect(waiting.cartDisabled).toBe(true);
  expect(waiting.price.trim()).not.toBe("");
  release();
  await expect.poll(async () => (await detailState(page)).cartDisabled, { timeout: 6000 }).toBe(false);
});

test("a held public header does not keep the detail page incomplete", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  await rememberSavedBooks(page);
  await page.route("**/public-header.js**", async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expect.poll(() => held, { timeout: 6000 }).toBe(true);
  const early = await detailState(page);
  expect(early.purchase).toBe(false);
  await expect.poll(async () => (await detailState(page)).purchase, { timeout: 14000 }).toBe(true);
  const state = await detailState(page);
  expect(state.authorHref).toContain("/author/");
  release();
  await expect.poll(() => page.locator(".kutadgu-public-header").count()).toBeGreaterThan(0);
});

test("a superseded book response does not replace the later row", async ({ page }) => {
  const held = [];
  await rememberSavedBooks(page);
  await page.route("**/rest/v1/books**", async (route) => {
    if (!pageBookUrl(route.request().url()) || route.request().method() !== "GET") return route.continue();
    const upstream = await route.fetch();
    const rows = await upstream.json();
    const range = upstream.headers()["content-range"] || "0-0/1";
    let finish = () => {};
    const done = new Promise((resolve) => { finish = resolve; });
    held.push({ route, rows, range, finish });
    await done;
  });
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expect.poll(async () => (await detailState(page)).boot, { timeout: 6000 }).toBe("pending");
  await expect.poll(() => held.length, { timeout: 6000 }).toBeGreaterThan(0);
  await page.locator("[data-detail-boot='pending'] .catalog-retry-btn").click();
  await expect.poll(() => held.length, { timeout: 6000 }).toBeGreaterThan(1);
  const latest = held[held.length - 1];
  const stale = held[0];
  const freshRows = latest.rows.map((row) => ({ ...row, price: 12, title: row.title }));
  const staleRows = stale.rows.map((row) => ({ ...row, price: 99, title: "STALE-TITLE" }));
  await latest.route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "content-range": latest.range, "content-type": "application/json" },
    body: JSON.stringify(freshRows)
  });
  latest.finish();
  await expect.poll(async () => (await detailState(page)).price, { timeout: 6000 }).toContain("12");
  try {
    await stale.route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": stale.range, "content-type": "application/json" },
      body: JSON.stringify(staleRows)
    });
  } catch (error) {}
  stale.finish();
  await page.waitForTimeout(400);
  const state = await detailState(page);
  expect(state.price).toContain("12");
  expect(state.price).not.toContain("99");
  expect(state.h1).not.toContain("STALE-TITLE");
  expect(state.purchase).toBe(true);
});

test("an empty current book response does not purchase a book cached by saved-book hydration", async ({ page }) => {
  let releasePage = () => {};
  const pageGate = new Promise((resolve) => { releasePage = resolve; });
  let savedCached = false;
  await page.addInitScript(() => {
    const now = Date.now();
    sessionStorage.setItem("kutadgu-catalog-active-count-v1", JSON.stringify({ total: 350, at: now }));
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "252", qty: 1 }, { id: "100", qty: 1 }]));
    localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["101"]));
    localStorage.setItem("kutadgu-recent-v1", JSON.stringify(["102"]));
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const url = route.request().url();
    if (pageBookUrl(url) && route.request().method() === "GET") {
      await pageGate;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0", "content-type": "application/json" },
        body: "[]"
      });
    }
    if (savedBooksUrl(url) && /(?:^|[?&])id=in\.\([^)]*\b252\b/.test(textUrl(url))) {
      await route.continue();
      savedCached = true;
      return;
    }
    return route.continue();
  });
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expect.poll(() => savedCached, { timeout: 15000 }).toBe(true);
  await page.waitForTimeout(300);
  const cached = await detailState(page);
  expect(cached.purchase).toBe(false);
  expect(cached.h1).toContain("لۇغەت");
  releasePage();
  await expect.poll(async () => (await detailState(page)).h1, { timeout: 6000 }).toContain("تەمىنلەنمەيدۇ");
  const after = await detailState(page);
  expect(after.purchase).toBe(false);
  expect(after.price).toBe("");
  expect(after.cartDisabled).toBe(null);
});

async function recoverAvailability(page, mode) {
  let open = true;
  await page.route("**/rest/v1/books**", async (route) => {
    if (!availabilityHead(route.request())) return route.continue();
    if (!open) return route.continue();
    if (mode === "status") return route.fulfill({ status: 500, contentType: "application/json", body: "" });
    await new Promise(() => {});
  });
  return {
    recover() { open = false; }
  };
}

async function expectAvailabilityFailure(page) {
  await expect.poll(async () => (await detailState(page)).boot, { timeout: 12000 }).toBe("unavailable");
  const failed = await detailState(page);
  expect(failed.purchase).toBe(false);
  expect(failed.price).toBe("");
  expect(failed.cartDisabled).toBe(null);
  expect(failed.h1).toContain("لۇغەت");
  expect(failed.h1).not.toContain("تەمىنلەنمەيدۇ");
  return failed;
}

test("a failed catalog availability check keeps the server book and retry reloads it", async ({ page }) => {
  const gate = await recoverAvailability(page, "status");
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expectAvailabilityFailure(page);
  gate.recover();
  await page.locator("[data-detail-boot='unavailable'] .catalog-retry-btn").click();
  const done = await expectCompleteDetail(page);
  expect(done.cartDisabled).toBe(false);
});

test("a timed-out catalog availability check keeps the server book and retry reloads it", async ({ page }) => {
  const gate = await recoverAvailability(page, "timeout");
  await page.goto(`/book/${BOOK_ID}`, { waitUntil: "commit" });
  await expectAvailabilityFailure(page);
  gate.recover();
  await page.locator("[data-detail-boot='unavailable'] .catalog-retry-btn").click();
  const done = await expectCompleteDetail(page);
  expect(done.cartDisabled).toBe(false);
});
