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

async function familyMetrics(page, cardSelector, titleSelector, authorSelector, cartSelector) {
  return page.evaluate(({ cardSelector, titleSelector, authorSelector, cartSelector }) => {
    const cards = [...document.querySelectorAll(cardSelector)];
    const grid = document.querySelector("#homeFeaturedBooks .home-featured-grid") ||
      document.querySelector("#homeFeaturedBooks");
    const cols = grid ? (getComputedStyle(grid).gridTemplateColumns || "").split(" ").filter(Boolean).length : 0;
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      gridColumns: cols,
      cards: cards.map((card) => {
        const title = card.querySelector(titleSelector);
        const author = card.querySelector(authorSelector);
        const cart = card.querySelector(cartSelector);
        const img = card.querySelector("img");
        const titleCs = title ? getComputedStyle(title) : null;
        const authorCs = author ? getComputedStyle(author) : null;
        const cartCs = cart ? getComputedStyle(cart) : null;
        const imgCs = img ? getComputedStyle(img) : null;
        const titleBox = title ? title.getBoundingClientRect() : { height: 0 };
        const cartBox = cart ? cart.getBoundingClientRect() : { bottom: 0, height: 0 };
        const cardBox = card.getBoundingClientRect();
        const lineHeight = titleCs ? parseFloat(titleCs.lineHeight) : 0;
        return {
          top: Math.round(cardBox.top * 100) / 100,
          titleHeight: titleBox.height,
          titleLines: lineHeight ? titleBox.height / lineHeight : 0,
          titleClamp: titleCs ? String(titleCs.webkitLineClamp || titleCs.lineClamp || "") : "",
          titleSize: titleCs ? parseFloat(titleCs.fontSize) : 0,
          authorSize: authorCs ? parseFloat(authorCs.fontSize) : 0,
          objectFit: imgCs ? imgCs.objectFit : "",
          actionBottom: cart ? cartBox.bottom : null,
          cartText: cart ? String(cart.textContent || "") : "",
          cartDisabled: cart ? cart.disabled : null,
          cartMinHeight: cartCs ? parseFloat(cartCs.minHeight) : 0,
          direction: titleCs ? titleCs.direction : ""
        };
      })
    };
  }, { cardSelector, titleSelector, authorSelector, cartSelector });
}

function expectAlignedActions(cards, label) {
  const rows = [];
  for (const item of cards) {
    if (item.actionBottom == null) continue;
    const row = rows.find((candidate) => Math.abs(candidate.top - item.top) <= 3);
    if (row) row.items.push(item);
    else rows.push({ top: item.top, items: [item] });
  }
  for (const row of rows.filter((r) => r.items.length >= 2)) {
    const bottoms = row.items.map((item) => item.actionBottom);
    expect(Math.max(...bottoms) - Math.min(...bottoms), label).toBeLessThanOrEqual(3);
  }
}

test.describe("storefront cards 1B polish", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, catalog.map((row) => String(row.id)));
    await H.clearShopStorage(page);
    await mockCatalog(page);
  });

  test("desktop featured/carousel readability, CTA, alignment, and cart add-once", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
    await expect.poll(async () => page.locator('link[data-kutadgu-storefront-cards-1a]').count()).toBeGreaterThan(0);

    const featured = await familyMetrics(
      page,
      "#homeFeaturedBooks .home-feature-card:not(.is-skeleton)",
      ".home-feature-title",
      ".home-feature-author",
      ".home-feature-cart"
    );
    expect(featured.overflowX).toBeLessThanOrEqual(2);
    expect(featured.gridColumns).toBeGreaterThanOrEqual(4);
    for (const item of featured.cards) {
      expect(item.objectFit).toBe("contain");
      expect(item.titleClamp === "2" || item.titleClamp === "2.0").toBeTruthy();
      expect(item.titleLines).toBeLessThanOrEqual(2.4);
      expect(item.titleSize).toBeGreaterThanOrEqual(14);
      expect(item.titleSize).toBeLessThanOrEqual(16);
      expect(item.authorSize).toBeGreaterThanOrEqual(11);
      expect(item.authorSize).toBeLessThan(item.titleSize);
      expect(item.direction).toBe("rtl");
      expect(item.cartText).toContain("سېۋەتكە");
    }
    expectAlignedActions(featured.cards, "featured 1440");

    const carousel = await familyMetrics(
      page,
      "#newBooksCarousel .home-carousel-card:not(.is-skeleton)",
      ".home-carousel-title",
      ".home-carousel-author",
      ".home-carousel-cart"
    );
    expect(carousel.overflowX).toBeLessThanOrEqual(2);
    for (const item of carousel.cards) {
      expect(item.objectFit).toBe("contain");
      expect(item.titleLines).toBeLessThanOrEqual(2.4);
      expect(item.titleSize).toBeGreaterThanOrEqual(14);
      expect(item.cartText).toContain("سېۋەتكە");
    }

    const inStock = page.locator("#homeFeaturedBooks .home-feature-cart:not(:disabled)").first();
    await expect(inStock).toBeEnabled();
    await inStock.click();
    await expect.poll(async () => page.evaluate(() => {
      const cart = window.kutadguShop && window.kutadguShop.cart && window.kutadguShop.cart();
      if (!Array.isArray(cart) || !cart.length) return 0;
      return cart.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
    })).toBe(1);

    const oos = page.locator("#homeFeaturedBooks .home-feature-cart:disabled");
    if (await oos.count()) {
      await expect(oos.first()).toBeDisabled();
    }

    const heart = page.locator("#homeFeaturedBooks .home-feature-heart, #homeFeaturedBooks .favorite-button").first();
    await heart.click();
    await expect(heart).toHaveClass(/is-favorite/);
    await expect(page.locator("#homeFeaturedBooks .home-feature-card a").first()).toHaveAttribute("href", /\/book\//);
  });

  test("tablet and mobile keep overflow, clamp, contain, and tappable cart", async ({ page }) => {
    test.setTimeout(90000);
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect.poll(async () => page.locator("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
      const featured = await familyMetrics(
        page,
        "#homeFeaturedBooks .home-feature-card:not(.is-skeleton)",
        ".home-feature-title",
        ".home-feature-author",
        ".home-feature-cart"
      );
      expect(featured.overflowX, `overflow ${width}`).toBeLessThanOrEqual(2);
      for (const item of featured.cards) {
        expect(item.objectFit, `contain ${width}`).toBe("contain");
        expect(item.titleLines, `lines ${width}`).toBeLessThanOrEqual(2.45);
        expect(item.cartText, `cta ${width}`).toContain("سېۋەتكە");
        expect(item.cartMinHeight, `touch ${width}`).toBeGreaterThanOrEqual(36);
      }
      expectAlignedActions(featured.cards, `featured ${width}`);
    }
  });

  test("listing covers stay contain; OOS cart disabled; light and dark readable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
    const listing = await familyMetrics(
      page,
      ".books-grid[data-catalog-source] .book-card:not(.is-skeleton)",
      ".book-title",
      ".book-author",
      ".book-actions .add-to-cart"
    );
    expect(listing.overflowX).toBeLessThanOrEqual(2);
    for (const item of listing.cards) {
      expect(item.objectFit).toBe("contain");
      expect(item.titleLines).toBeLessThanOrEqual(2.35);
    }
    await expect(page.locator(".book-card[data-live-book-id='91004'] .add-to-cart")).toBeDisabled();
    await expect(page.locator(".book-card[data-live-book-id='91001'] .detail-button")).toHaveAttribute("href", /91001/);

    for (const mode of ["light", "dark"]) {
      await page.evaluate((next) => {
        document.body.classList.toggle("dark-mode", next === "dark");
        document.documentElement.classList.toggle("dark-mode", next === "dark");
      }, mode);
      const colors = await page.evaluate(() => {
        const title = document.querySelector(".books-grid[data-catalog-source] .book-title");
        const author = document.querySelector(".books-grid[data-catalog-source] .book-author");
        const parse = (value) => {
          const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0;
        };
        return {
          title: parse(getComputedStyle(title).color),
          author: parse(getComputedStyle(author).color),
          titleColor: getComputedStyle(title).color
        };
      });
      expect(colors.titleColor, mode).not.toBe("rgba(0, 0, 0, 0)");
      expect(colors.title, mode).toBeGreaterThan(0);
      expect(colors.author, mode).toBeGreaterThan(0);
    }
  });
});
