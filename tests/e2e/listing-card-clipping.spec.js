const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const LONG_TITLE = "سوغۇق يۈكلەش ئۈچۈن بەك ئۇزۇن ئۇيغۇرچە كىتاب نامى بولۇپ قېلىش ۋە قىسقارتماسلىق سىنىقى ئۈچۈن يەنە بىر قۇر تېكىست قوشۇلدى";
const ROMAN_TITLE = "سوغۇق يۈكلەش رومانى";
const POEM_TITLE = "سوغۇق يۈكلەش شېئىرى";

function bookRow(overrides) {
  return {
    id: 91001,
    title: LONG_TITLE,
    author: "بەك ئۇزۇن ئاپتور ئىسمى بولغان سىناق يازغۇچى",
    price: 128,
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

async function mockBooks(page, { books } = {}) {
  const catalog = books || [
    bookRow({ id: 91001, title: LONG_TITLE, source: "romanlar.html" }),
    bookRow({ id: 91002, title: POEM_TITLE, source: "sheirlar.html" }),
    bookRow({ id: 91003, title: ROMAN_TITLE, source: "romanlar.html", author: "قىسقا ئاپتور" }),
    bookRow({ id: 91004, title: "تۈگىگەن رومان", source: "romanlar.html", stock: 0, stock_status: "out_of_stock" })
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
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${filtered.length}` },
        body: ""
      });
    }
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

function cardMetricsScript() {
  return () => {
    const slack = 1.5;
    const inside = (parent, child) => {
      if (!parent || !child) return false;
      const p = parent.getBoundingClientRect();
      const c = child.getBoundingClientRect();
      return c.left >= p.left - slack && c.right <= p.right + slack && c.top >= p.top - slack && c.bottom <= p.bottom + slack;
    };
    const card = document.querySelector('.books-grid[data-catalog-source] .book-card:not(.is-skeleton)[data-live-book-id="91001"]')
      || document.querySelector(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)");
    if (!card) return { missing: true };
    const title = card.querySelector(".book-title");
    const author = card.querySelector(".book-author");
    const price = card.querySelector(".book-price");
    const actions = card.querySelector(".book-actions");
    const image = card.querySelector(".book-image, .book-cover");
    const img = card.querySelector(".book-image img, .cover-stock-wrap img, .book-cover img");
    const titleStyle = title ? getComputedStyle(title) : null;
    const imageBox = image ? image.getBoundingClientRect() : null;
    const cards = [...document.querySelectorAll(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)")];
    let overlap = false;
    for (let i = 0; i < cards.length; i++) {
      const a = cards[i].getBoundingClientRect();
      for (let j = i + 1; j < cards.length; j++) {
        const b = cards[j].getBoundingClientRect();
        const hit = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        if (hit) overlap = true;
      }
    }
    const actionKids = actions ? [...actions.children].map((el) => inside(card, el) && inside(actions, el)) : [];
    return {
      missing: false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      titleInside: inside(card, title),
      authorInside: !author || author.hidden || inside(card, author),
      priceInside: inside(card, price),
      actionsInside: inside(card, actions),
      imageInside: inside(card, image),
      imgInside: !img || inside(image, img),
      actionKidsInside: actionKids.every(Boolean),
      overlap,
      titleClamp: titleStyle ? (titleStyle.webkitLineClamp || titleStyle.lineClamp) : "",
      titleLineHeight: titleStyle ? Number.parseFloat(titleStyle.lineHeight) : 0,
      titleFontSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : 0,
      objectFit: img ? getComputedStyle(img).objectFit : "",
      imageDisplay: image ? getComputedStyle(image).display : "",
      imageRatio: imageBox && imageBox.height ? imageBox.width / imageBox.height : 0,
      cartDisabled: !!card.querySelector(".add-to-cart[disabled], .add-to-cart[aria-disabled='true']"),
      gridCols: getComputedStyle(document.querySelector(".books-grid[data-catalog-source]")).gridTemplateColumns.split(" ").filter(Boolean).length
    };
  };
}

test.describe("listing card clipping hotfix", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["91001"]);
  });

  test("A–E long Uyghur title cover author price and actions stay inside the card", async ({ page }) => {
    await mockBooks(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    await expect(page.locator(".book-title", { hasText: LONG_TITLE })).toBeVisible();
    const geo = await page.evaluate(cardMetricsScript());
    expect(geo.missing).toBeFalsy();
    expect(geo.titleInside).toBeTruthy();
    expect(geo.authorInside).toBeTruthy();
    expect(geo.priceInside).toBeTruthy();
    expect(geo.actionsInside).toBeTruthy();
    expect(geo.imageInside).toBeTruthy();
    expect(geo.imgInside).toBeTruthy();
    expect(geo.actionKidsInside).toBeTruthy();
    expect(geo.overlap).toBeFalsy();
    expect(String(geo.titleClamp)).toBe("2");
    expect(geo.titleLineHeight / geo.titleFontSize).toBeGreaterThanOrEqual(1.55);
    expect(geo.objectFit).toBe("contain");
    expect(geo.imageDisplay).toContain("flex");
    expect(geo.imageRatio).toBeGreaterThan(0.6);
    expect(geo.imageRatio).toBeLessThan(0.76);
    expect(geo.overflowX).toBeLessThanOrEqual(2);
  });

  test("F stock-zero card still disables Add to Cart", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/adabiyat?sub=romanlar", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-live-book-id="91004"] [data-cart-id]')).toBeDisabled();
    await expect(page.locator('[data-live-book-id="91004"] .add-to-cart')).toHaveClass(/is-cart-unavailable/);
  });

  test("G 390 768 1366 have no horizontal overflow or clipped listing cards", async ({ page }) => {
    await mockBooks(page);
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
      await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
      await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
      const geo = await page.evaluate(cardMetricsScript());
      expect(geo.missing, String(width)).toBeFalsy();
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      expect(geo.titleInside, String(width)).toBeTruthy();
      expect(geo.priceInside, String(width)).toBeTruthy();
      expect(geo.actionsInside, String(width)).toBeTruthy();
      expect(geo.actionKidsInside, String(width)).toBeTruthy();
      expect(geo.objectFit, String(width)).toBe("contain");
      expect(geo.overlap, String(width)).toBeFalsy();
      if (width === 390) expect(geo.gridCols, "390 2-col").toBe(2);
    }
  });

  test("H dedicated listing pages still render real books", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/romanlar", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton) .book-title").count()).toBeGreaterThan(0);
    await expect(page.locator(".book-title", { hasText: LONG_TITLE })).toBeVisible();
    await expect(page.locator(".book-title", { hasText: POEM_TITLE })).toHaveCount(0);
    const romanGeo = await page.evaluate(cardMetricsScript());
    expect(romanGeo.objectFit).toBe("contain");
    expect(romanGeo.titleInside).toBeTruthy();
    await page.goto("/sheirlar", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-title", { hasText: POEM_TITLE })).toBeVisible();
    await expect(page.locator(".book-title", { hasText: LONG_TITLE })).toHaveCount(0);
  });

  test("I Stage 2 filter URL state still works with safe cards", async ({ page }) => {
    await mockBooks(page);
    await page.goto("/adabiyat?sub=romanlar", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".adabiyat-hub-pill.is-selected")).toContainText("رومان");
    await expect(page.locator(".book-title", { hasText: LONG_TITLE })).toBeVisible();
    await expect(page.locator(".book-title", { hasText: POEM_TITLE })).toHaveCount(0);
    const geo = await page.evaluate(cardMetricsScript());
    expect(geo.titleInside).toBeTruthy();
    expect(geo.objectFit).toBe("contain");
  });

  test("light and dark listing cards stay inside bounds", async ({ page }) => {
    await mockBooks(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator(".book-card:not(.is-skeleton)").count()).toBeGreaterThan(0);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((next) => {
        document.body.classList.toggle("dark-mode", next === "dark");
        document.documentElement.classList.toggle("dark-mode", next === "dark");
      }, mode);
      const geo = await page.evaluate(cardMetricsScript());
      expect(geo.titleInside, mode).toBeTruthy();
      expect(geo.priceInside, mode).toBeTruthy();
      expect(geo.actionsInside, mode).toBeTruthy();
      expect(geo.objectFit, mode).toBe("contain");
    }
  });
});
