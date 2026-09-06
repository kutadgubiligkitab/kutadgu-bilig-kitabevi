const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const ROMAN_TITLE = "سوغۇق يۈكلەش رومانى";
const POEM_TITLE = "سوغۇق يۈكلەش شېئىرى";
const HIST_TITLE = "سوغۇق يۈكلەش تارىخىي رومانى";

function bookRow(overrides) {
  return {
    id: 91001,
    title: ROMAN_TITLE,
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

function parseSourceFilter(raw) {
  const value = String(raw || "");
  if (value.startsWith("eq.")) return { eq: value.slice(3) };
  const match = value.match(/^in\.\((.*)\)$/);
  if (!match) return {};
  const list = match[1].split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  return { in: list };
}

async function mockBooks(page, { books, pageSize } = {}) {
  const catalog = books || [
    bookRow({ id: 91001, title: ROMAN_TITLE, source: "romanlar.html" }),
    bookRow({ id: 91002, title: POEM_TITLE, source: "sheirlar.html" }),
    bookRow({ id: 91003, title: HIST_TITLE, source: "tarikhiy-romanlar.html" }),
    bookRow({ id: 91004, title: "تۈگىگەن رومان", source: "romanlar.html", stock: 0, stock_status: "out_of_stock" }),
    bookRow({ id: 91005, title: "ئاز قالغان رومان", source: "romanlar.html", stock: 2, stock_status: "low_stock" })
  ];
  await page.route("**/rest/v1/books**", async (route) => {
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
    let filtered = catalog.filter((row) => row.is_active !== false);
    const sourceFilter = parseSourceFilter(parsed.searchParams.get("source") || "");
    if (sourceFilter.eq) filtered = filtered.filter((row) => row.source === sourceFilter.eq);
    if (sourceFilter.in) filtered = filtered.filter((row) => sourceFilter.in.includes(row.source));
    const searchBlob = `${parsed.searchParams.get("or") || ""} ${parsed.searchParams.get("and") || ""}`;
    if (/ilike\./i.test(searchBlob)) {
      filtered = filtered.filter((row) => /رومان/i.test(searchBlob) ? /رومان/.test(row.title) : true);
      if (searchBlob.includes(POEM_TITLE) || /شېئىر/.test(decodeURIComponent(searchBlob))) {
        filtered = catalog.filter((row) => row.title.includes("شېئىر") && (!sourceFilter.eq || row.source === sourceFilter.eq) && (!sourceFilter.in || sourceFilter.in.includes(row.source)));
      }
    }
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${filtered.length || catalog.length}` },
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

test.describe("adabiyat books-first hub", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["91001"]);
  });

  test("A default /adabiyat shows real books not emoji cards", async ({ page }) => {
    await mockBooks(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect(page.locator("header.kutadgu-public-header")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".book-icon")).toHaveCount(0);
    await expect(page.locator(".adabiyat-hub-pill")).toHaveCount(7);
    await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    const geo = await page.evaluate(() => {
      const card = document.querySelector(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)");
      const box = card ? card.getBoundingClientRect() : null;
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        cardTop: box ? box.top : 9999,
        viewportH: window.innerHeight
      };
    });
    expect(geo.overflowX).toBeLessThanOrEqual(1);
    expect(geo.cardTop).toBeLessThan(geo.viewportH);
    await expect(page.locator(".adabiyat-hub-pill.is-selected")).toHaveText("ھەممىسى");
    await expect(page.locator(".book-card:not(.is-skeleton) .book-title").first()).toBeVisible();
  });

  test("B subcategory pills filter by authoritative source", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
    await page.locator('.adabiyat-hub-pill[data-adabiyat-sub="romanlar"]').click();
    await expect.poll(async () => page.url()).toMatch(/sub=romanlar/);
    await expect(page.locator(".adabiyat-hub-pill.is-selected")).toHaveText("رومان");
    await expect(page.locator("[data-adabiyat-heading]")).toHaveText("رومان");
    await expect(page.locator(".book-title", { hasText: ROMAN_TITLE })).toBeVisible();
    await expect(page.locator(".book-title", { hasText: POEM_TITLE })).toHaveCount(0);
    await page.locator('.adabiyat-hub-pill[data-adabiyat-sub="sheirlar"]').click();
    await expect.poll(async () => page.url()).toMatch(/sub=sheirlar/);
    await expect(page.locator(".book-title", { hasText: POEM_TITLE })).toBeVisible();
    await expect(page.locator(".book-title", { hasText: ROMAN_TITLE })).toHaveCount(0);
  });

  test("C URL state reload back-forward and invalid sub", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".adabiyat-hub-pill").count()).toBe(7);
    await page.locator('.adabiyat-hub-pill[data-adabiyat-sub="romanlar"]').click();
    await expect.poll(async () => page.url()).toMatch(/sub=romanlar/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".adabiyat-hub-pill.is-selected")).toHaveText("رومان");
    await page.goBack();
    await expect.poll(async () => page.locator(".adabiyat-hub-pill.is-selected").textContent()).toBe("ھەممىسى");
    await page.goForward();
    await expect(page.locator(".adabiyat-hub-pill.is-selected")).toHaveText("رومان");
    await page.goto("/adabiyat?sub=not-real", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".adabiyat-hub-pill.is-selected").textContent()).toBe("ھەممىسى");
    expect(page.url()).not.toMatch(/sub=not-real/);
  });

  test("D local search respects selected subcategory", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/adabiyat?sub=romanlar", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    await page.locator("#catalogFilterText").fill("شېئىر");
    await page.locator("#catalogFilterText").press("Enter");
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBe(0);
    await page.locator("#catalogFilterText").fill("");
    await page.locator("#catalogFilterText").press("Enter");
    await expect(page.locator(".book-title", { hasText: ROMAN_TITLE })).toBeVisible();
  });

  test("E all-literature in() query dedupes load-more ids", async ({ page }) => {
    const books = [];
    for (let i = 0; i < 20; i++) {
      books.push(bookRow({
        id: 92000 + i,
        title: `ئەدەبىيات ${i}`,
        source: i % 2 ? "sheirlar.html" : "romanlar.html"
      }));
    }
    await mockBooks(page, { books });
    await page.setViewportSize({ width: 390, height: 844 });
    const seen = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/rest/v1/books") && req.method() === "GET" && !u.includes("is_active=eq.false")) seen.push(u);
    });
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    expect(seen.some((u) => /source=in\./.test(u) || decodeURIComponent(u).includes("source=in."))).toBeTruthy();
    const firstIds = await page.$$eval(".book-card:not(.is-skeleton)[data-live-book-id]", (els) => els.map((el) => el.getAttribute("data-live-book-id")));
    expect(new Set(firstIds).size).toBe(firstIds.length);
    if (await page.locator(".catalog-load-more").count()) {
      await page.locator(".catalog-load-more").click();
      await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(firstIds.length);
      const allIds = await page.$$eval(".book-card:not(.is-skeleton)[data-live-book-id]", (els) => els.map((el) => el.getAttribute("data-live-book-id")));
      expect(new Set(allIds).size).toBe(allIds.length);
    }
  });

  test("F canonical and dedicated routes stay indexable", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/adabiyat?sub=romanlar", { waitUntil: "domcontentloaded" });
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe("https://www.kutadgubilik.com/adabiyat");
    await page.goto("/romanlar", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".books-grid[data-catalog-source='romanlar.html']")).toHaveCount(1);
    const romanCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(romanCanonical).toBe("https://www.kutadgubilik.com/romanlar");
    await page.goto("/sheirlar", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".books-grid[data-catalog-source='sheirlar.html']")).toHaveCount(1);
  });

  test("G cart favorite stock and detail link still work", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/adabiyat?sub=romanlar", { waitUntil: "domcontentloaded" });
    await expect(page.locator(`[data-live-book-id="91001"]`)).toBeVisible({ timeout: 20_000 });
    await page.locator(`[data-live-book-id="91001"] [data-cart-id]`).click();
    await expect.poll(async () => page.evaluate(() => (window.kutadguShop.cart() || []).some((row) => String(row.id) === "91001"))).toBeTruthy();
    await page.locator(`[data-live-book-id="91001"] [data-fav-id]`).click();
    await expect.poll(async () => page.evaluate(() => window.kutadguShop.favHas("91001"))).toBeTruthy();
    await expect(page.locator(`[data-live-book-id="91004"] [data-cart-id]`)).toBeDisabled();
    await expect(page.locator(`[data-live-book-id="91005"]`)).toContainText(/ئاز|قالدى|stock|سان/i);
    const href = await page.locator(`[data-live-book-id="91001"] a[href*="/book/"]`).first().getAttribute("href");
    expect(href).toMatch(/\/book\/91001/);
  });

  test("H 390 768 1366 no overflow and compact chrome", async ({ page }) => {
    await mockBooks(page);
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
      await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
      await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
      const geo = await page.evaluate(() => {
        const header = document.querySelector("header.kutadgu-public-header");
        const card = document.querySelector(".books-grid .book-card:not(.is-skeleton)");
        return {
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          headerH: header ? header.getBoundingClientRect().height : 0,
          cardTop: card ? card.getBoundingClientRect().top : 9999,
          viewportH: window.innerHeight
        };
      });
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      expect(geo.headerH, String(width)).toBeLessThanOrEqual(width === 1366 ? 120 : 210);
      if (width === 390) expect(geo.cardTop).toBeLessThan(geo.viewportH);
    }
  });
});
