const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const DETAIL_TITLE = "سوغۇق يۈكلەش تەپسىلات كىتابى";
const RELATED_LONG = "سوغۇق يۈكلەش ئوخشاش كىتاب نامى بەك ئۇزۇن بولۇپ قېلىش ۋە قىسقارتماسلىق سىنىقى ئۈچۈن يەنە بىر قۇر";
const OTHER_CAT = "باشقا تۈردىكى كىتاب";

function bookRow(overrides) {
  return {
    id: 91001,
    title: DETAIL_TITLE,
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

async function mockCatalog(page, books) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes("is_active=eq.false")) {
      const inactive = books.filter((row) => row.is_active === false);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `*/${inactive.length}` },
        body: JSON.stringify(inactive.map((row) => ({ id: row.id, legacy_id: row.legacy_id || null })))
      });
    }
    const parsed = new URL(url);
    let filtered = books.filter((row) => row.is_active !== false);
    const wanted = [];
    const collect = (raw) => {
      const text = decodeURIComponent(String(raw || ""));
      const inMatch = text.match(/in\.\(([^)]*)\)/i);
      if (inMatch) {
        inMatch[1].split(",").forEach((part) => {
          const id = part.replace(/^"+|"+$/g, "").trim();
          if (id) wanted.push(id);
        });
      }
      const eqMatch = text.match(/eq\.([^,&)]+)/i);
      if (eqMatch) wanted.push(eqMatch[1].replace(/^"+|"+$/g, "").trim());
    };
    collect(parsed.searchParams.get("id") || "");
    collect(parsed.searchParams.get("legacy_id") || "");
    collect(parsed.searchParams.get("or") || "");
    if (wanted.length) {
      const set = new Set(wanted.map(String));
      filtered = books.filter((row) => set.has(String(row.id)) || set.has(String(row.legacy_id || "")));
    }
    const category = parsed.searchParams.get("category");
    if (category && category.startsWith("eq.")) {
      filtered = filtered.filter((row) => row.category === category.slice(3));
    }
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

function relatedMetrics() {
  return () => {
    const slack = 1.5;
    const inside = (parent, child) => {
      if (!parent || !child) return false;
      const p = parent.getBoundingClientRect();
      const c = child.getBoundingClientRect();
      return c.left >= p.left - slack && c.right <= p.right + slack && c.top >= p.top - slack && c.bottom <= p.bottom + slack;
    };
    const card = document.querySelector("[data-detail-related] .detail-related-grid .shop-mini-card");
    if (!card) return { missing: true };
    const wrap = card.querySelector(".cover-stock-wrap");
    const img = card.querySelector(".cover-stock-wrap img, a img");
    const title = card.querySelector(".shop-mini-title");
    const author = card.querySelector(".shop-mini-meta");
    const price = card.querySelector(".shop-mini-price");
    const actions = card.querySelector(".mini-actions");
    const wrapBox = wrap ? wrap.getBoundingClientRect() : null;
    const titleBox = title ? title.getBoundingClientRect() : null;
    const imgBox = img ? img.getBoundingClientRect() : null;
    const titleStyle = title ? getComputedStyle(title) : null;
    const gap = wrapBox && titleBox ? titleBox.top - wrapBox.bottom : 999;
    return {
      missing: false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      wrapHeight: wrapBox ? wrapBox.height : 0,
      wrapRatio: wrapBox && wrapBox.height ? wrapBox.width / wrapBox.height : 0,
      coverTitleGap: gap,
      wrapVsImg: wrapBox && imgBox ? wrapBox.height - imgBox.height : 0,
      titleInside: inside(card, title),
      authorInside: !author || inside(card, author),
      priceInside: inside(card, price),
      actionsInside: inside(card, actions),
      wrapInside: inside(card, wrap),
      imgInside: !img || inside(wrap || card, img),
      objectFit: img ? getComputedStyle(img).objectFit : "",
      wrapHeightCss: wrap ? getComputedStyle(wrap).height : "",
      titleClamp: titleStyle ? (titleStyle.webkitLineClamp || titleStyle.lineClamp) : "",
      titleLineHeight: titleStyle ? Number.parseFloat(titleStyle.lineHeight) : 0,
      titleFontSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : 0,
      titleHeight: titleBox ? titleBox.height : 0
    };
  };
}

function rowAlignMetrics() {
  return (selector) => {
    const slack = 2;
    const cards = [...document.querySelectorAll(selector)];
    const rows = [];
    cards.forEach((card) => {
      const box = card.getBoundingClientRect();
      const wrap = card.querySelector(".cover-stock-wrap");
      const title = card.querySelector(".shop-mini-title");
      const author = card.querySelector(".shop-mini-meta");
      const price = card.querySelector(".shop-mini-price");
      const actions = card.querySelector(".mini-actions");
      const wrapBox = wrap ? wrap.getBoundingClientRect() : null;
      const titleBox = title ? title.getBoundingClientRect() : null;
      const actionsBox = actions ? actions.getBoundingClientRect() : null;
      const item = {
        height: box.height,
        bottom: box.bottom,
        top: box.top,
        wrapBottom: wrapBox ? wrapBox.bottom : 0,
        titleTop: titleBox ? titleBox.top : 0,
        titleHeight: titleBox ? titleBox.height : 0,
        coverTitleGap: wrapBox && titleBox ? titleBox.top - wrapBox.bottom : 999,
        actionsBottom: actionsBox ? actionsBox.bottom : 0,
        authorInside: !author || (
          author.getBoundingClientRect().bottom <= box.bottom + 1.5 &&
          author.getBoundingClientRect().top >= box.top - 1.5
        ),
        priceInside: !price || (
          price.getBoundingClientRect().bottom <= box.bottom + 1.5 &&
          price.getBoundingClientRect().top >= box.top - 1.5
        )
      };
      let row = rows.find((entry) => Math.abs(entry.top - box.top) <= slack);
      if (!row) {
        row = { top: box.top, cards: [] };
        rows.push(row);
      }
      row.cards.push(item);
    });
    return {
      cardCount: cards.length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      rows: rows.map((row) => {
        const heights = row.cards.map((c) => c.height);
        const bottoms = row.cards.map((c) => c.bottom);
        const titleTops = row.cards.map((c) => c.titleTop);
        const actionBottoms = row.cards.map((c) => c.actionsBottom);
        const gaps = row.cards.map((c) => c.coverTitleGap);
        const titleHeights = row.cards.map((c) => c.titleHeight);
        return {
          count: row.cards.length,
          heightSpread: Math.max(...heights) - Math.min(...heights),
          bottomSpread: Math.max(...bottoms) - Math.min(...bottoms),
          titleTopSpread: Math.max(...titleTops) - Math.min(...titleTops),
          actionsBottomSpread: Math.max(...actionBottoms) - Math.min(...actionBottoms),
          maxCoverTitleGap: Math.max(...gaps),
          minCoverTitleGap: Math.min(...gaps),
          maxTitleHeight: Math.max(...titleHeights),
          minTitleHeight: Math.min(...titleHeights),
          authorInside: row.cards.every((c) => c.authorInside),
          priceInside: row.cards.every((c) => c.priceInside)
        };
      })
    };
  };
}

const relatedCatalog = [
  bookRow({ id: 91001, title: DETAIL_TITLE }),
  bookRow({ id: 91002, title: RELATED_LONG, author: "ئۇزۇن ئاپتور ئىسمى سىناق" }),
  bookRow({ id: 91003, title: "قىسقا ئوخشاش رومان" }),
  bookRow({ id: 91005, title: "ئوتتۇرا ئۇزۇنلۇقتىكى ئوخشاش رومان نامى بىر قۇردىن ئېشىدۇ" }),
  bookRow({ id: 91006, title: "قىسقا" }),
  bookRow({ id: 91004, title: OTHER_CAT, category: "شېئىرلار", source: "sheirlar.html" })
];

test.describe("Similar Books card spacing hotfix", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["91001"]);
    await H.clearShopStorage(page);
  });

  test("A–F cover title author price and actions stay compact inside the card", async ({ page }) => {
    await mockCatalog(page, relatedCatalog);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, DETAIL_TITLE);
    await expect(page.locator("[data-detail-related] h2", { hasText: "ئوخشاش كىتابلار" })).toBeVisible();
    await expect.poll(async () => page.locator("[data-detail-related] .shop-mini-card").count()).toBeGreaterThan(0);
    const geo = await page.evaluate(relatedMetrics());
    expect(geo.missing).toBeFalsy();
    expect(geo.coverTitleGap).toBeGreaterThanOrEqual(0);
    expect(geo.coverTitleGap).toBeLessThan(28);
    expect(geo.wrapRatio).toBeGreaterThan(0.6);
    expect(geo.wrapRatio).toBeLessThan(0.76);
    expect(geo.objectFit).toBe("contain");
    expect(geo.titleInside).toBeTruthy();
    expect(geo.authorInside).toBeTruthy();
    expect(geo.priceInside).toBeTruthy();
    expect(geo.actionsInside).toBeTruthy();
    expect(geo.imgInside).toBeTruthy();
    expect(String(geo.titleClamp)).toBe("2");
    expect(geo.titleLineHeight / geo.titleFontSize).toBeGreaterThanOrEqual(1.55);
  });

  test("G 390 768 1366 have no overflow or giant cover-title gap", async ({ page }) => {
    await mockCatalog(page, relatedCatalog);
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
      await H.waitForDetailTitle(page, DETAIL_TITLE);
      await expect.poll(async () => page.locator("[data-detail-related] .shop-mini-card").count()).toBeGreaterThan(0);
      const geo = await page.evaluate(relatedMetrics());
      expect(geo.missing, String(width)).toBeFalsy();
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      expect(geo.coverTitleGap, String(width)).toBeLessThan(28);
      expect(geo.objectFit, String(width)).toBe("contain");
      expect(geo.actionsInside, String(width)).toBeTruthy();
    }
  });

  test("H Similar Books stays same-category and excludes the open book", async ({ page }) => {
    await mockCatalog(page, relatedCatalog);
    await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, DETAIL_TITLE);
    await expect(page.locator("[data-detail-related] .shop-mini-title", { hasText: RELATED_LONG })).toBeVisible();
    await expect(page.locator("[data-detail-related] .shop-mini-title", { hasText: OTHER_CAT })).toHaveCount(0);
    const ids = await page.locator("[data-detail-related] [data-fav-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-fav-id")));
    expect(ids).not.toContain("91001");
    expect(ids).toContain("91002");
    expect(ids).not.toContain("91004");
  });

  test("I zero same-category matches hide the Similar Books heading", async ({ page }) => {
    await mockCatalog(page, [bookRow({ id: 91001, title: DETAIL_TITLE }), bookRow({ id: 91004, title: OTHER_CAT, category: "شېئىرلار" })]);
    await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, DETAIL_TITLE);
    await expect.poll(async () => page.locator("[data-detail-related]").count()).toBeGreaterThan(0);
    await expect(page.locator("[data-detail-related] h2", { hasText: "ئوخشاش كىتابلار" })).toHaveCount(0);
    await expect(page.locator("[data-detail-related] .shop-mini-card")).toHaveCount(0);
  });

  test("light and dark similar cards keep a compact cover-title gap", async ({ page }) => {
    await mockCatalog(page, relatedCatalog);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, DETAIL_TITLE);
    await expect.poll(async () => page.locator("[data-detail-related] .shop-mini-card").count()).toBeGreaterThan(0);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((next) => {
        document.body.classList.toggle("dark-mode", next === "dark");
        document.documentElement.classList.toggle("dark-mode", next === "dark");
      }, mode);
      const geo = await page.evaluate(relatedMetrics());
      expect(geo.coverTitleGap, mode).toBeLessThan(28);
      expect(geo.objectFit, mode).toBe("contain");
      expect(geo.titleInside, mode).toBeTruthy();
    }
  });

  test("same-row Similar Books cards have equal outer height without giant gaps", async ({ page }) => {
    await mockCatalog(page, relatedCatalog);
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
      await H.waitForDetailTitle(page, DETAIL_TITLE);
      await expect.poll(async () => page.locator("[data-detail-related] .shop-mini-card").count()).toBe(4);
      const geo = await page.evaluate(rowAlignMetrics(), "[data-detail-related] .detail-related-grid .shop-mini-card");
      expect(geo.cardCount, String(width)).toBe(4);
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      expect(geo.rows.length, String(width)).toBeGreaterThan(0);
      for (const row of geo.rows) {
        expect(row.count, String(width)).toBeGreaterThan(1);
        expect(row.heightSpread, String(width)).toBeLessThanOrEqual(2);
        expect(row.bottomSpread, String(width)).toBeLessThanOrEqual(2);
        expect(row.titleTopSpread, String(width)).toBeLessThanOrEqual(2);
        expect(row.actionsBottomSpread, String(width)).toBeLessThanOrEqual(2);
        expect(row.maxCoverTitleGap, String(width)).toBeLessThan(28);
        expect(row.minCoverTitleGap, String(width)).toBeGreaterThanOrEqual(0);
        expect(row.maxTitleHeight - row.minTitleHeight, String(width)).toBeLessThanOrEqual(2);
        expect(row.authorInside, String(width)).toBeTruthy();
        expect(row.priceInside, String(width)).toBeTruthy();
      }
    }
  });

  test("preview screenshots of Similar Books at 1366 and 390", async ({ page }) => {
    const fs = require("fs");
    const path = require("path");
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    await mockCatalog(page, relatedCatalog);
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
      await H.waitForDetailTitle(page, DETAIL_TITLE);
      await expect.poll(async () => page.locator("[data-detail-related] .shop-mini-card").count()).toBe(4);
      const section = page.locator("[data-detail-related]");
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: path.join(outDir, `similar-books-equal-height-${width}.png`) });
      await page.evaluate(() => {
        document.body.classList.add("dark-mode");
        document.documentElement.classList.add("dark-mode");
      });
      await section.screenshot({ path: path.join(outDir, `similar-books-equal-height-${width}-dark.png`) });
    }
  });
});
