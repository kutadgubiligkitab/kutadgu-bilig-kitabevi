const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const LONG = "سوغۇق يۈكلەش ئۈچۈن بەك ئۇزۇن ئۇيغۇرچە كىتاب نامى بولۇپ قېلىش ۋە قىسقارتماسلىق سىنىقى ئۈچۈن يەنە بىر قۇر تېكىست قوشۇلدى";
const LONG_AUTHOR = "بەك ئۇزۇن ئاپتور ئىسمى بىلەن سىناق قىلىش ئۈچۈن يېزىلغان ئىسىم";

function bookRow(overrides) {
  return {
    id: "91001",
    title: "قىسقا نام",
    author: "قىسقا ئاپتور",
    price: 128,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 5,
    stock_status: "in_stock",
    sales_count: 12,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

const catalog = [
  bookRow({ id: 91001, title: "قىسقا نام", author: "قىسقا ئاپتور", stock: 8 }),
  bookRow({ id: 91002, title: "ئوتتۇرا ئۇزۇنلۇقتىكى ئىككى قۇرلۇق كىتاب نامى", author: "ئاپتور ئىككى", stock: 5 }),
  bookRow({ id: 91003, title: LONG, author: LONG_AUTHOR, stock: 4 }),
  bookRow({ id: 91004, title: "تۈگىگەن كىتاب", stock: 0, stock_status: "out_of_stock", is_new: false, is_recommended: false, sales_count: 0 }),
  bookRow({ id: 91005, title: "تەۋسىيەلىك يېڭى", is_new: true, is_recommended: true, sales_count: 40 }),
  bookRow({ id: 91006, title: "كەڭ مۇقاۋا", image_url: "/kutadgu-logo.png", stock: 6 }),
  bookRow({ id: 91007, title: "ئىككىنچى قىسقا", stock: 9 }),
  bookRow({ id: 91008, title: "ئۈچىنچى قىسقا", stock: 7 })
];

async function mockCatalog(page) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("is_active=eq.false")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": "*/0" }, body: "[]" });
    }
    const parsed = new URL(url);
    let filtered = catalog.filter((row) => row.is_active !== false);
    const category = parsed.searchParams.get("category");
    if (category && category.startsWith("eq.")) {
      filtered = filtered.filter((row) => row.category === category.slice(3));
    }
    if (parsed.searchParams.get("is_recommended") === "eq.true") {
      filtered = filtered.filter((row) => row.is_recommended);
    }
    const source = parsed.searchParams.get("source") || "";
    if (source.startsWith("eq.")) filtered = filtered.filter((row) => row.source === source.slice(3));
    const range = String(req.headers()["range"] || "0-23");
    const [from, to] = range.split("-").map(Number);
    const slice = filtered.slice(from || 0, (to || 23) + 1);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `${from || 0}-${(from || 0) + Math.max(slice.length - 1, 0)}/${filtered.length}` },
      body: JSON.stringify(slice)
    });
  });
}

async function metrics(page, cardSelector, titleSelector, actionSelector) {
  return page.evaluate(({ cardSelector, titleSelector, actionSelector }) => {
    const cards = [...document.querySelectorAll(cardSelector)];
    return cards.map((card) => {
      const title = card.querySelector(titleSelector);
      const action = card.querySelector(actionSelector);
      const img = card.querySelector("img");
      const titleCs = title ? getComputedStyle(title) : null;
      const imgCs = img ? getComputedStyle(img) : null;
      const titleBox = title ? title.getBoundingClientRect() : { height: 0 };
      const actionBox = action ? action.getBoundingClientRect() : { bottom: 0 };
      const cardBox = card.getBoundingClientRect();
      const lineHeight = titleCs ? parseFloat(titleCs.lineHeight) : 0;
      return {
        top: Math.round(cardBox.top * 100) / 100,
        titleHeight: titleBox.height,
        titleLines: lineHeight ? titleBox.height / lineHeight : 0,
        titleClamp: titleCs ? String(titleCs.webkitLineClamp || titleCs.lineClamp || "") : "",
        lineHeight,
        objectFit: imgCs ? imgCs.objectFit : "",
        objectPosition: imgCs ? imgCs.objectPosition : "",
        actionBottom: action ? actionBox.bottom : null,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        direction: titleCs ? titleCs.direction : ""
      };
    });
  }, { cardSelector, titleSelector, actionSelector });
}

test.describe("storefront cards 1A polish", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, catalog.map((row) => String(row.id)));
    await H.clearShopStorage(page);
    await mockCatalog(page);
  });

  test("listing cards clamp titles, contain covers, and align actions", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
    await expect.poll(async () => page.locator('link[data-kutadgu-storefront-cards-1a]').count()).toBeGreaterThan(0);
    const items = await metrics(page, ".books-grid[data-catalog-source] .book-card:not(.is-skeleton)", ".book-title", ".book-actions .add-to-cart");
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) {
      expect(item.objectFit).toBe("contain");
      expect(item.titleClamp === "2" || item.titleClamp === "2.0").toBeTruthy();
      expect(item.titleLines).toBeLessThanOrEqual(2.35);
      expect(item.overflowX).toBeLessThanOrEqual(2);
    }
    const long = await page.locator(".book-card[data-live-book-id='91003'] .book-title").textContent();
    expect(long).toContain("ئۇيغۇرچە");
    await expect(page.locator(".book-card[data-live-book-id='91004'] .add-to-cart")).toBeDisabled();
    const inStock = page.locator(".book-card[data-live-book-id='91001'] .add-to-cart");
    await expect(inStock).toBeEnabled();
    await inStock.click();
    await expect.poll(async () => page.evaluate(() => (window.kutadguShop && window.kutadguShop.cart && window.kutadguShop.cart().length) || 0)).toBeGreaterThan(0);
    const fav = page.locator(".book-card[data-live-book-id='91001'] .favorite-button");
    await fav.click();
    await expect(fav).toHaveClass(/is-favorite/);
    await expect(page.locator(".book-card[data-live-book-id='91001'] .detail-button")).toHaveAttribute("href", /91001/);
  });

  test("featured and discovery cards stay aligned at desktop tablet mobile", async ({ page }) => {
    test.setTimeout(90000);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect.poll(async () => page.locator("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
      const featured = await metrics(page, "#homeFeaturedBooks .home-feature-card:not(.is-skeleton)", ".home-feature-title", ".home-feature-cart");
      for (const item of featured) {
        expect(item.objectFit, `featured ${width}`).toBe("contain");
        expect(item.titleClamp === "2" || item.titleClamp === "2.0", `featured clamp ${width}`).toBeTruthy();
        expect(item.titleLines, `featured lines ${width}`).toBeLessThanOrEqual(2.4);
        expect(item.overflowX, `featured overflow ${width}`).toBeLessThanOrEqual(2);
        expect(item.direction).toBe("rtl");
      }
      const rows = [];
      for (const item of featured) {
        if (item.actionBottom == null) continue;
        const row = rows.find((candidate) => Math.abs(candidate.top - item.top) <= 3);
        if (row) row.items.push(item);
        else rows.push({ top: item.top, items: [item] });
      }
      for (const row of rows.filter((r) => r.items.length >= 2)) {
        const bottoms = row.items.map((item) => item.actionBottom);
        expect(Math.max(...bottoms) - Math.min(...bottoms), `featured actions ${width}`).toBeLessThanOrEqual(3);
      }

      await page.locator("#premiumDiscovery [data-premium-group='literature']").click();
      await expect.poll(async () => page.locator("#premiumDiscoveryResults .premium-book-card").count()).toBeGreaterThan(0);
      const discovery = await metrics(page, "#premiumDiscoveryResults .premium-book-card", ".premium-card-link strong", ".premium-card-cart");
      for (const item of discovery) {
        expect(item.objectFit, `discovery ${width}`).toBe("contain");
        expect(item.titleClamp === "2" || item.titleClamp === "2.0", `discovery clamp ${width}`).toBeTruthy();
        expect(item.overflowX, `discovery overflow ${width}`).toBeLessThanOrEqual(2);
      }
    }
  });

  test("light and dark theme keep readable card text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((next) => {
        document.body.classList.toggle("dark-mode", next === "dark");
        document.documentElement.classList.toggle("dark-mode", next === "dark");
      }, mode);
      const colors = await page.evaluate(() => {
        const title = document.querySelector(".books-grid[data-catalog-source] .book-title");
        const author = document.querySelector(".books-grid[data-catalog-source] .book-author");
        const csTitle = getComputedStyle(title);
        const csAuthor = getComputedStyle(author);
        const parse = (value) => {
          const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0;
        };
        return { title: parse(csTitle.color), author: parse(csAuthor.color), titleColor: csTitle.color };
      });
      expect(colors.titleColor, mode).not.toBe("rgba(0, 0, 0, 0)");
      expect(colors.title, mode).toBeGreaterThan(0);
    }
  });
});
