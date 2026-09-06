const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");
const path = require("path");

const DETAIL_TITLE = "سوغۇق يۈكلەش تەپسىلات كىتابى";
const RECENT_LONG = "سوغۇق يۈكلەش يېقىندا كۆرۈلگەن كىتاب نامى بەك ئۇزۇن بولۇپ قېلىش سىنىقى ئۈچۈن يەنە بىر قۇر";
const REC_KEY = "kutadgu-recent-v1";

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

function recentMetrics() {
  return () => {
    const slack = 1.5;
    const inside = (parent, child) => {
      if (!parent || !child) return false;
      const p = parent.getBoundingClientRect();
      const c = child.getBoundingClientRect();
      return c.left >= p.left - slack && c.right <= p.right + slack && c.top >= p.top - slack && c.bottom <= p.bottom + slack;
    };
    const card = document.querySelector("[data-recently-viewed] .shop-mini-card");
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
    const cardStyle = getComputedStyle(card);
    const gap = wrapBox && titleBox ? titleBox.top - wrapBox.bottom : 999;
    return {
      missing: false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      cardHeight: card.getBoundingClientRect().height,
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
      justify: cardStyle.justifyContent,
      titleClamp: titleStyle ? (titleStyle.webkitLineClamp || titleStyle.lineClamp) : "",
      titleOverflow: titleStyle ? titleStyle.overflow : "",
      titleLineHeight: titleStyle ? Number.parseFloat(titleStyle.lineHeight) : 0,
      titleFontSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : 0
    };
  };
}

function rowAlignMetrics(selector) {
  return () => {
    const slack = 2;
    const cards = [...document.querySelectorAll(selector)];
    const rows = [];
    cards.forEach((card) => {
      const box = card.getBoundingClientRect();
      const wrap = card.querySelector(".cover-stock-wrap");
      const title = card.querySelector(".shop-mini-title");
      const actions = card.querySelector(".mini-actions");
      const wrapBox = wrap ? wrap.getBoundingClientRect() : null;
      const titleBox = title ? title.getBoundingClientRect() : null;
      const actionsBox = actions ? actions.getBoundingClientRect() : null;
      const item = {
        height: box.height,
        bottom: box.bottom,
        titleTop: titleBox ? titleBox.top : 0,
        coverTitleGap: wrapBox && titleBox ? titleBox.top - wrapBox.bottom : 999,
        actionsBottom: actionsBox ? actionsBox.bottom : 0
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
        const actionBottoms = row.cards.map((c) => c.actionsBottom);
        const gaps = row.cards.map((c) => c.coverTitleGap);
        return {
          count: row.cards.length,
          heightSpread: Math.max(...heights) - Math.min(...heights),
          bottomSpread: Math.max(...bottoms) - Math.min(...bottoms),
          actionsBottomSpread: Math.max(...actionBottoms) - Math.min(...actionBottoms),
          maxCoverTitleGap: Math.max(...gaps)
        };
      })
    };
  };
}

const recentCatalog = [
  bookRow({ id: 91001, title: DETAIL_TITLE }),
  bookRow({ id: 91002, title: "قىسقا يېقىندا كۆرۈلگەن", author: "ئىككىنچى ئاپتور" }),
  bookRow({ id: 91003, title: RECENT_LONG, author: "ئۇزۇن ئاپتور ئىسمى سىناق" }),
  bookRow({ id: 91004, title: "باشقا تۈردىكى كىتاب", category: "شېئىرلار", source: "sheirlar.html" }),
  bookRow({ id: 91005, title: "ئوتتۇرا ئۇزۇنلۇقتىكى يېقىندا كۆرۈلگەن نام" })
];

test.describe("Recently Viewed card spacing hotfix", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["91001"]);
    await H.clearShopStorage(page);
    await page.addInitScript((key) => {
      try {
        localStorage.setItem(key, JSON.stringify(["91003", "91002", "91005", "91004"]));
      } catch (e) {}
    }, REC_KEY);
  });

  async function openDetail(page, width = 1366) {
    await mockCatalog(page, recentCatalog);
    await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
    await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, DETAIL_TITLE);
    await expect.poll(async () => page.locator("[data-recently-viewed] .shop-mini-card").count()).toBeGreaterThan(0);
  }

  test("A cover to title gap is compact", async ({ page }) => {
    await openDetail(page);
    const geo = await page.evaluate(recentMetrics());
    expect(geo.missing).toBeFalsy();
    expect(geo.coverTitleGap).toBeGreaterThanOrEqual(0);
    expect(geo.coverTitleGap).toBeLessThan(28);
  });

  test("B card height is content-based not stretched", async ({ page }) => {
    await openDetail(page);
    const geo = await page.evaluate(recentMetrics());
    expect(geo.wrapHeightCss).not.toBe("100%");
    expect(geo.justify).not.toBe("space-between");
    expect(geo.coverTitleGap).toBeLessThan(28);
    expect(geo.cardHeight).toBeLessThan(geo.wrapHeight + 280);
  });

  test("C title is clamped to two lines", async ({ page }) => {
    await openDetail(page);
    const geo = await page.evaluate(recentMetrics());
    expect(String(geo.titleClamp)).toBe("2");
    expect(geo.titleOverflow).toBe("hidden");
    expect(geo.titleLineHeight / geo.titleFontSize).toBeGreaterThanOrEqual(1.55);
  });

  test("D cover uses contain inside a 2:3 frame", async ({ page }) => {
    await openDetail(page);
    const geo = await page.evaluate(recentMetrics());
    expect(geo.objectFit).toBe("contain");
    expect(geo.wrapRatio).toBeGreaterThan(0.6);
    expect(geo.wrapRatio).toBeLessThan(0.76);
  });

  test("E title meta price stay inside the card", async ({ page }) => {
    await openDetail(page);
    const geo = await page.evaluate(recentMetrics());
    expect(geo.titleInside).toBeTruthy();
    expect(geo.authorInside).toBeTruthy();
    expect(geo.priceInside).toBeTruthy();
    expect(geo.imgInside).toBeTruthy();
  });

  test("F actions stay inside the card", async ({ page }) => {
    await openDetail(page);
    const geo = await page.evaluate(recentMetrics());
    expect(geo.actionsInside).toBeTruthy();
  });

  test("G 390 768 1366 have no overflow or giant cover-title gap", async ({ page }) => {
    for (const width of [390, 768, 1366]) {
      await openDetail(page, width);
      const geo = await page.evaluate(recentMetrics());
      expect(geo.missing, String(width)).toBeFalsy();
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      expect(geo.coverTitleGap, String(width)).toBeLessThan(28);
      expect(geo.objectFit, String(width)).toBe("contain");
      expect(geo.actionsInside, String(width)).toBeTruthy();
    }
  });

  test("same-row Recently Viewed cards have equal outer height without giant gaps", async ({ page }) => {
    for (const width of [390, 768, 1366]) {
      await openDetail(page, width);
      const geo = await page.evaluate(rowAlignMetrics("[data-recently-viewed] .shop-mini-card"));
      expect(geo.cardCount, String(width)).toBeGreaterThanOrEqual(4);
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      for (const row of geo.rows) {
        if (row.count < 2) continue;
        expect(row.heightSpread, String(width)).toBeLessThanOrEqual(2);
        expect(row.bottomSpread, String(width)).toBeLessThanOrEqual(2);
        expect(row.actionsBottomSpread, String(width)).toBeLessThanOrEqual(2);
        expect(row.maxCoverTitleGap, String(width)).toBeLessThan(28);
      }
    }
  });

  test("H recently viewed order follows stored history and excludes current book", async ({ page }) => {
    await openDetail(page);
    const ids = await page.locator("[data-recently-viewed] [data-fav-id]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-fav-id"))
    );
    expect(ids[0]).toBe("91003");
    expect(ids[1]).toBe("91002");
    expect(ids).toContain("91005");
    expect(ids).not.toContain("91001");
  });

  test("light and dark recently viewed cards keep a compact cover-title gap", async ({ page }) => {
    await openDetail(page);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((next) => {
        document.body.classList.toggle("dark-mode", next === "dark");
        document.documentElement.classList.toggle("dark-mode", next === "dark");
      }, mode);
      const geo = await page.evaluate(recentMetrics());
      expect(geo.coverTitleGap, mode).toBeLessThan(28);
      expect(geo.objectFit, mode).toBe("contain");
      expect(geo.titleInside, mode).toBeTruthy();
    }
  });

  test("preview screenshots of recently viewed at 1366 and 390", async ({ page }) => {
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    for (const width of [1366, 390]) {
      await openDetail(page, width);
      const section = page.locator("[data-recently-viewed]");
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({
        path: path.join(outDir, `recently-viewed-${width}.png`)
      });
      await page.evaluate(() => {
        document.body.classList.add("dark-mode");
        document.documentElement.classList.add("dark-mode");
      });
      await section.screenshot({
        path: path.join(outDir, `recently-viewed-${width}-dark.png`)
      });
    }
  });
});
