const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const MIXED = [
  {
    id: 81001,
    title: "ئەدەبىيات سىناق كىتابى",
    author: "سىناق ئاپتور",
    price: 40,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 8,
    stock_status: "in_stock",
    sales_count: 4,
    created_at: "2026-08-01T00:00:00Z"
  },
  {
    id: 81002,
    title: "دىنىي سىناق كىتابى",
    author: "سىناق ئاپتور",
    price: 90,
    source: "dini.html",
    category: "دىنىي",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: false,
    is_new: false,
    stock: 2,
    stock_status: "low_stock",
    sales_count: 1,
    created_at: "2026-07-01T00:00:00Z"
  },
  {
    id: 81003,
    title: "ئۇنىۋېرسال سىناق كىتابى",
    author: "سىناق ئاپتور",
    price: 25,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: false,
    is_new: true,
    stock: 0,
    stock_status: "out_of_stock",
    sales_count: 0,
    created_at: "2026-06-01T00:00:00Z"
  }
];

function bookRow(overrides) {
  return {
    id: 91001,
    title: "بارلىق كىتاب سىنىقى",
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

async function mockBooks(page, { delayMs = 0, fail = false, hang = false, books = MIXED, onRequest } = {}) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (onRequest) onRequest(url, req);
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
    } else if (source && source.startsWith("in.(")) {
      const allowed = source.slice(4, -1).split(",");
      filtered = filtered.filter((row) => allowed.includes(row.source));
    }
    const searchBlob = `${parsed.searchParams.get("or") || ""} ${parsed.searchParams.get("and") || ""}`;
    if (/ilike\./i.test(searchBlob)) {
      filtered = filtered.filter((row) => searchBlob.includes(row.title));
    }
    const collectionRec = parsed.searchParams.get("is_recommended");
    if (collectionRec === "eq.true") filtered = filtered.filter((row) => row.is_recommended);
    const order = parsed.searchParams.get("order") || "";
    if (order.startsWith("price.desc")) filtered.sort((a, b) => Number(b.price) - Number(a.price));
    else if (order.startsWith("price.asc")) filtered.sort((a, b) => Number(a.price) - Number(b.price));
    if (req.method() === "HEAD") {
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

test.describe("Stage 5D global /books page", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("/books serves the global listing and /books.html permanently redirects", async ({ page }) => {
    await mockBooks(page);
    const redirected = await page.goto("/books.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => new URL(page.url()).pathname).toBe("/books");
    let hop = redirected && redirected.request();
    let fromHtml = false;
    while (hop) {
      if (/\/books\.html(?:\?|$)/i.test(hop.url())) fromHtml = true;
      hop = hop.redirectedFrom();
    }
    expect(fromHtml).toBeTruthy();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.kutadgubilik.com/books");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index,\s*follow/);
    await expect(page.locator("h1")).toHaveText("بارلىق كىتابلار");
    expect(new URL(page.url()).pathname).not.toMatch(/adabiyat|universal|dini/);
  });

  test("/books listing query has no source restriction and mixes categories", async ({ page }) => {
    const listingUrls = [];
    await mockBooks(page, {
      onRequest(url) {
        if (/\/rest\/v1\/books/.test(url) && !/is_active=eq\.false/.test(url)) listingUrls.push(url);
      }
    });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".books-grid")).toContainText("ئەدەبىيات سىناق كىتابى");
    await expect(page.locator(".books-grid")).toContainText("دىنىي سىناق كىتابى");
    await expect(page.locator(".books-grid")).toContainText("ئۇنىۋېرسال سىناق كىتابى");
    const catalogGets = listingUrls.filter((u) => !/select=id(&|$)/.test(u) || /select=\*/.test(u));
    expect(catalogGets.some((u) => /source=eq\./.test(u) || /source=in\./.test(u))).toBeFalsy();
    await expect(page.locator(".book-card.is-skeleton")).toHaveCount(0);
    await expect(page.locator(".books-grid")).toHaveAttribute("aria-busy", "false");
  });

  test("/books search sort filter pagination empty and error states", async ({ page }) => {
    const unique = "ئالاھىدە بارلىق كىتاب";
    const books = Array.from({ length: 30 }, (_, i) => bookRow({
      id: 93000 + i,
      title: i === 5 ? unique : `بارلىق كىتاب ${i + 1}`,
      price: 10 + i,
      source: i % 2 ? "dini.html" : "romanlar.html",
      is_recommended: i === 0
    }));
    await mockBooks(page, { books });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)").first()).toBeVisible({ timeout: 20_000 });
    await page.locator("#catalogFilterText").fill(unique);
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(1, { timeout: 15_000 });
    await page.locator("#catalogFilterReset").click();
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(24, { timeout: 15_000 });
    await page.locator("#catalogSort").selectOption("priceHigh");
    await expect(page.locator(".book-card:not(.is-skeleton) .book-title").first()).toContainText("بارلىق كىتاب 30", { timeout: 15_000 });
    await page.locator("#catalogCollection").selectOption("recommended");
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(1, { timeout: 15_000 });
    await page.locator("#catalogFilterReset").click();
    await page.locator(".catalog-load-more").click();
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(30, { timeout: 15_000 });

    await mockBooks(page, { books: [] });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".catalog-filter-empty")).toBeVisible({ timeout: 20_000 });

    await mockBooks(page, { fail: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".catalog-error-state")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".catalog-retry-btn")).toBeVisible();
  });

  test("/books ignores a slower stale listing response", async ({ page }) => {
    let listingCalls = 0;
    await page.route("**/rest/v1/books**", async (route) => {
      const url = route.request().url();
      if (url.includes("is_active=eq.false") || route.request().method() === "HEAD") {
        return route.fulfill({
          status: 206,
          contentType: "application/json",
          headers: { "content-range": "*/0" },
          body: "[]"
        });
      }
      const parsed = new URL(url);
      const searchBlob = `${parsed.searchParams.get("or") || ""}`;
      listingCalls += 1;
      const slow = listingCalls === 1;
      const title = slow ? "ئاستا ئەسلى نەتىجە" : "يېڭى ئىزدەش نەتىجىسى";
      if (slow) await new Promise((r) => setTimeout(r, 1200));
      const row = bookRow({ id: slow ? 1 : 2, title });
      if (/ilike\./i.test(searchBlob) && !searchBlob.includes(title) && !slow) {
        return route.fulfill({
          status: 206,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: JSON.stringify([row])
        });
      }
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify([row])
      });
    });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await page.locator("#catalogFilterText").fill("يېڭى");
    await expect(page.locator(".book-card:not(.is-skeleton) .book-title")).toContainText("يېڭى ئىزدەش نەتىجىسى", { timeout: 20_000 });
    await expect(page.locator(".books-grid")).not.toContainText("ئاستا ئەسلى نەتىجە");
  });

  test("category routes keep their source filter", async ({ page }) => {
    const seen = [];
    await mockBooks(page, { onRequest(url) { seen.push(url); } });
    await page.goto("/dini", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)")).toContainText("دىنىي سىناق كىتابى", { timeout: 20_000 });
    await expect(page.locator(".books-grid")).not.toContainText("ئەدەبىيات سىناق كىتابى");
    expect(seen.some((u) => u.includes("source=eq.dini.html"))).toBeTruthy();
  });

  test("homepage and shared header Books links go to /books", async ({ page }) => {
    await mockBooks(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("header nav a[href='/books']")).toBeVisible();
    await expect(page.locator("[data-home-hero-primary]")).toHaveAttribute("href", "/books");
    await expect(page.locator("#homeFeaturedBooks .home-featured-all")).toHaveAttribute("href", "/books");
    await page.locator("[data-home-hero-primary]").click();
    await expect.poll(async () => new URL(page.url()).pathname).toBe("/books");
    await page.goto("/dini.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("header nav a[href='/books']")).toBeVisible();
    await page.locator("header nav a[href='/books']").click();
    await expect.poll(async () => new URL(page.url()).pathname).toBe("/books");
  });

  test("featured-all stays /books after homepage JS render", async ({ page }) => {
    await mockBooks(page);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await expect.poll(async () => page.locator("#homeFeaturedBooks .home-featured-all").getAttribute("href")).toBe("/books");
  });

  test("/books layout at 390 430 768 1366 including dark mode", async ({ page }) => {
    await mockBooks(page);
    for (const width of [390, 430, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/books", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".book-card:not(.is-skeleton), .book-card.is-skeleton").first()).toBeVisible({ timeout: 20_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, String(width)).toBeLessThanOrEqual(4);
      if (width <= 430) {
        await H.waitForShop(page);
        await expect(page.locator(".mobile-menu-toggle")).toBeVisible();
        await page.locator(".mobile-menu-toggle").click();
        await expect(page.locator("nav#mobileSiteMenu a[href='/books']")).toBeVisible();
        await expect(page.locator("nav#mobileSiteMenu a[href*='bookCategories']")).toBeVisible();
        await page.locator(".mobile-menu-toggle").click();
      }
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.evaluate(() => document.body.classList.add("dark-mode"));
    await expect(page.locator("body")).toHaveClass(/dark-mode/);
    const darkOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(darkOverflow).toBeLessThanOrEqual(4);
  });
});
