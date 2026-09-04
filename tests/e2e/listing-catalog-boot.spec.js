const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const LISTING_PAGES = [
  "/romanlar.html",
  "/universal.html",
  "/children.html",
  "/dini.html",
  "/derslik.html",
  "/terbiye.html",
  "/tibb.html",
  "/dastanlar.html",
  "/sheirlar.html",
  "/hekayiler.html",
  "/uyghur-adabiyati.html",
  "/dunya-edebiyati.html",
  "/adabiyat-roman.html",
  "/tarikhiy-romanlar.html"
];

const DEMO_TITLE = "رومان كىتابى 2";
const REAL_TITLE = "سوغۇق يۈكلەش رومانى";
const MISSING_TITLE = "مۇقاۋىسىز سىناق كىتاب";
const UNSAFE_TITLE = "خەتەرلىك مۇقاۋا كىتابى";

function bookRow(overrides) {
  return {
    id: 91001,
    title: REAL_TITLE,
    author: "سىناق ئاپتور",
    price: 88,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 5,
    stock_status: "in_stock",
    sales_count: 3,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

async function mockBooks(page, { delayMs = 0, fail = false, hang = false, books = [bookRow()] } = {}) {
  await page.route("**/rest/v1/books**", async (route) => {
    if (hang) {
      await new Promise((r) => setTimeout(r, 20_000));
      return route.abort();
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (fail) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "catalog down" })
      });
    }
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes("is_active=eq.false")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0" },
        body: "[]"
      });
    }
    const parsed = new URL(url);
    let filtered = books.slice();
    const source = parsed.searchParams.get("source");
    if (source && source.startsWith("eq.")) {
      filtered = filtered.filter((row) => row.source === source.slice(3));
    }
    const searchBlob = `${parsed.searchParams.get("or") || ""} ${parsed.searchParams.get("and") || ""}`;
    if (/ilike\./i.test(searchBlob)) {
      filtered = filtered.filter((row) => searchBlob.includes(row.title));
    }
    const order = parsed.searchParams.get("order") || "";
    if (order.startsWith("price.desc")) filtered.sort((a, b) => Number(b.price) - Number(a.price));
    else if (order.startsWith("price.asc")) filtered.sort((a, b) => Number(a.price) - Number(b.price));
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${filtered.length || books.length}` },
        body: ""
      });
    }
    const range = String(req.headers()["range"] || "0-23");
    const [from, to] = range.split("-").map(Number);
    const slice = filtered.slice(from || 0, (to || 23) + 1);
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": `${from || 0}-${(from || 0) + Math.max(slice.length - 1, 0)}/${filtered.length}` },
      body: JSON.stringify(slice)
    });
  });
}

async function listingSnapshot(page) {
  return page.evaluate(() => {
    const grid = document.querySelector(".books-grid[data-catalog-source]");
    if (!grid) return { missing: true };
    const html = grid.innerHTML;
    const imgs = [...grid.querySelectorAll("img")].map((img) => img.getAttribute("src") || img.src || "");
    const titles = [...grid.querySelectorAll(".book-title")].map((el) => el.textContent.trim());
    return {
      html,
      imgs,
      titles,
      skeleton: grid.querySelectorAll(".book-card.is-skeleton").length,
      live: grid.querySelectorAll(".book-card:not(.is-skeleton)").length,
      error: !!grid.querySelector(".catalog-error-state"),
      sample: /sample-book-cover\.png/i.test(html) || imgs.some((src) => /sample-book-cover\.png/i.test(src)),
      demoTitle: /رومان كىتابى|ئاپتور ئىسمى/.test(html),
      ariaBusy: grid.getAttribute("aria-busy"),
      ready: grid.hasAttribute("data-catalog-ready")
    };
  });
}

test.describe("listing catalog cold load", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("pre-JS first paint is skeleton-only on romanlar", async ({ page }) => {
    await page.route(/\/shop\.js(\?|$)/, (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.kutadguShop={};"
    }));
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    const snap = await listingSnapshot(page);
    expect(snap.skeleton).toBeGreaterThan(0);
    expect(snap.live).toBe(0);
    expect(snap.sample).toBeFalsy();
    expect(snap.demoTitle).toBeFalsy();
    expect(snap.ariaBusy).toBe("true");
    await expect(page.locator("h1, .page-hero, .hero-title, .back-button").first()).toBeVisible();
  });

  test("configured delay keeps skeleton and then paints the real book", async ({ page }) => {
    await mockBooks(page, { delayMs: 2500, books: [bookRow()] });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    const started = Date.now();
    while (Date.now() - started < 2200) {
      const snap = await listingSnapshot(page);
      expect(snap.sample, "sample cover during delay").toBeFalsy();
      expect(snap.demoTitle, "demo title during delay").toBeFalsy();
      expect(snap.live).toBe(0);
      expect(snap.skeleton).toBeGreaterThan(0);
      await page.waitForTimeout(200);
    }
    await expect(page.locator(`.book-card:not(.is-skeleton) .book-title`)).toContainText(REAL_TITLE, { timeout: 20_000 });
    const after = await listingSnapshot(page);
    expect(after.sample).toBeFalsy();
    expect(after.imgs.some((src) => /kutadgu-logo\.png/i.test(src))).toBeTruthy();
    expect(after.ariaBusy).toBe("false");
    expect(after.ready).toBeTruthy();
  });

  test("configured failure shows error without demo books", async ({ page }) => {
    await mockBooks(page, { fail: true });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".catalog-error-state")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".catalog-error-state")).toContainText("كىتابلارنى يۈكلەشتە خاتالىق كۆرۈلدى");
    const snap = await listingSnapshot(page);
    expect(snap.sample).toBeFalsy();
    expect(snap.demoTitle).toBeFalsy();
    expect(snap.live).toBe(0);
    await expect(page.locator(".catalog-retry-btn")).toBeVisible();
  });

  test("configured timeout shows error without demo fallback", async ({ page }) => {
    test.setTimeout(45_000);
    await mockBooks(page, { hang: true });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".catalog-error-state")).toBeVisible({ timeout: 20_000 });
    const snap = await listingSnapshot(page);
    expect(snap.sample).toBeFalsy();
    expect(snap.demoTitle).toBeFalsy();
    expect(snap.live).toBe(0);
  });

  test("missing and unsafe covers use a neutral placeholder", async ({ page }) => {
    await mockBooks(page, {
      books: [
        bookRow({ id: 91001, title: REAL_TITLE, image_url: "/kutadgu-logo.png" }),
        bookRow({ id: 91002, title: MISSING_TITLE, image_url: "" }),
        bookRow({ id: 91003, title: UNSAFE_TITLE, image_url: "javascript:alert(1)" })
      ]
    });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(`[data-live-book-id="91001"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-live-book-id="91001"] img`)).toHaveAttribute("src", /kutadgu-logo\.png/);
    await expect(page.locator(`[data-live-book-id="91002"] .book-cover-unavailable`)).toBeVisible();
    await expect(page.locator(`[data-live-book-id="91003"] .book-cover-unavailable`)).toBeVisible();
    const html = await page.locator(".books-grid[data-catalog-source]").innerHTML();
    expect(html).not.toMatch(/sample-book-cover\.png/i);
    const cartId = await page.locator(`[data-live-book-id="91001"] [data-cart-id]`).getAttribute("data-cart-id");
    const favId = await page.locator(`[data-live-book-id="91001"] [data-fav-id]`).getAttribute("data-fav-id");
    expect(cartId).toBe("91001");
    expect(favId).toBe("91001");
  });

  test("every data-catalog-source page first-paints without demo cards", async ({ page }) => {
    await page.route(/\/shop\.js(\?|$)/, (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.kutadguShop={};"
    }));
    for (const path of LISTING_PAGES) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const snap = await listingSnapshot(page);
      expect(snap.missing, path).toBeFalsy();
      expect(snap.skeleton, path).toBeGreaterThan(0);
      expect(snap.live, path).toBe(0);
      expect(snap.sample, path).toBeFalsy();
    }
  });

  test("homepage delayed catalog still avoids sample covers", async ({ page }) => {
    await mockBooks(page, { delayMs: 1800, books: [bookRow({ source: "universal.html" })] });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const started = Date.now();
    while (Date.now() - started < 1500) {
      const html = await page.locator("#homeCarouselTrack, #homeFeaturedBooks").evaluateAll((els) => els.map((el) => el.innerHTML).join(""));
      expect(html).not.toMatch(/sample-book-cover\.png/i);
      expect(html).not.toMatch(/رومان كىتابى 2/);
      await page.waitForTimeout(200);
    }
  });

  test("cart delayed hydrate still avoids sample covers", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "91001", qty: 1 }]));
    });
    await mockBooks(page, { delayMs: 1800, books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    const started = Date.now();
    while (Date.now() - started < 1500) {
      const html = await page.locator("#cartItems").innerHTML();
      expect(html).not.toMatch(/sample-book-cover\.png/i);
      expect(html).not.toMatch(/رومان كىتابى/);
      await page.waitForTimeout(200);
    }
  });

  test("category search filter sort and load more still work", async ({ page }) => {
    const uniqueFilterTitle = "ئالاھىدە سۈزگۈچ كىتابى";
    const books = Array.from({ length: 30 }, (_, i) => bookRow({
      id: 92000 + i,
      title: i === 7 ? uniqueFilterTitle : `${REAL_TITLE} ${i + 1}`,
      price: 10 + i,
      is_recommended: i === 0
    }));
    await mockBooks(page, { books });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)").first()).toBeVisible({ timeout: 20_000 });
    await page.locator("#catalogFilterText").fill(uniqueFilterTitle);
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".book-card:not(.is-skeleton) .book-title")).toHaveText(uniqueFilterTitle);
    await page.locator("#catalogFilterReset").click();
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(24, { timeout: 15_000 });
    await page.locator("#catalogSort").selectOption("priceHigh");
    await expect(page.locator(".book-card:not(.is-skeleton) .book-title").first()).toContainText(`${REAL_TITLE} 30`, { timeout: 15_000 });
    await page.locator(".catalog-load-more").click();
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(30, { timeout: 15_000 });
  });

  test("listing grid does not overflow at 390/768/1280", async ({ page }) => {
    await mockBooks(page, { books: [bookRow(), bookRow({ id: 91002, title: `${REAL_TITLE} 2` })] });
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".book-card:not(.is-skeleton)").first()).toBeVisible({ timeout: 20_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `overflow at ${width}`).toBeFalsy();
    }
  });
});
