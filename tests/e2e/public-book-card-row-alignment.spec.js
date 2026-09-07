const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");

const LONG = "سوغۇق يۈكلەش ئۈچۈن بەك ئۇزۇن ئۇيغۇرچە كىتاب نامى بولۇپ قېلىش ۋە قىسقارتماسلىق سىنىقى ئۈچۈن يەنە بىر قۇر تېكىست قوشۇلدى";
const SHORT = "قىسقا";
const MID = "ئوتتۇرا ناملىق رومان";

function bookRow(overrides) {
  return {
    id: "91001",
    title: LONG,
    author: "سىناق ئاپتور",
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

const catalog = [
  bookRow({ id: 91001, title: LONG, stock: 5, stock_status: "in_stock" }),
  bookRow({ id: 91002, title: "ئاز قالغان رومان", author: "ئاپتور ئىككى", stock: 2, stock_status: "low_stock" }),
  bookRow({ id: 91003, title: "تۈگىگەن رومان", stock: 0, stock_status: "out_of_stock" }),
  bookRow({ id: 91004, title: SHORT, author: "قىسقا ئاپتور", is_new: false, is_recommended: false, stock: 8 }),
  bookRow({ id: 91005, title: MID, author: "B", is_new: true, is_recommended: true, stock: 6 }),
  bookRow({ id: 91006, title: `${LONG} يەنە`, author: "ئۇزۇن ئاپتور ئىسمى", stock: 1, stock_status: "low_stock" }),
  bookRow({ id: 91007, title: "رومان تۆت", is_new: false, stock: 9 }),
  bookRow({ id: 91008, title: "رومان بەش", is_recommended: false, stock: 4 }),
  bookRow({ id: "91009", title: "باشقا شېئىر", source: "sheirlar.html", category: "شېئىرلار", stock: 8 }),
  bookRow({ id: "91010", title: "شېئىر ئىككى", source: "sheirlar.html", category: "شېئىرلار", is_new: false, stock: 7 }),
  bookRow({ id: "91011", title: "شېئىر ئۈچ", source: "sheirlar.html", category: "شېئىرلار", is_new: false, is_recommended: false, stock: 5 }),
  bookRow({ id: "91012", title: "شېئىر تۆت ئۇزۇن نام", source: "sheirlar.html", category: "شېئىرلار", is_new: true, stock: 3, stock_status: "low_stock" })
];

function parseSourceFilter(raw) {
  const value = String(raw || "");
  if (value.startsWith("eq.")) return { eq: value.slice(3) };
  const match = value.match(/^in\.\((.*)\)$/);
  if (!match) return {};
  const list = match[1].split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  return { in: list };
}

async function mockCatalog(page, books = catalog) {
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
    const orParamRaw = parsed.searchParams.get("or") || "";
    if (/\bid\.eq\./i.test(orParamRaw) || /legacy_id\.eq\./i.test(orParamRaw) || /\bid\.in\./i.test(orParamRaw)) {
      collect(orParamRaw);
    }
    if (wanted.length) {
      const set = new Set(wanted.map(String));
      filtered = books.filter((row) => set.has(String(row.id)) || set.has(String(row.legacy_id || "")));
    }
    const sourceFilter = parseSourceFilter(parsed.searchParams.get("source") || "");
    if (sourceFilter.eq) filtered = filtered.filter((row) => row.source === sourceFilter.eq);
    if (sourceFilter.in) filtered = filtered.filter((row) => sourceFilter.in.includes(row.source));
    const category = parsed.searchParams.get("category");
    if (category && category.startsWith("eq.")) {
      filtered = filtered.filter((row) => row.category === category.slice(3));
    }
    if (parsed.searchParams.get("is_recommended") === "eq.true") {
      filtered = filtered.filter((row) => row.is_recommended);
    }
    if (parsed.searchParams.get("is_new") === "eq.true") {
      filtered = filtered.filter((row) => row.is_new);
    }
    const orParam = parsed.searchParams.get("or") || "";
    const ilike = orParam.match(/ilike\.\*?([^*,)]+)/i);
    if (ilike) {
      const q = decodeURIComponent(ilike[1]).toLocaleLowerCase("ug");
      filtered = filtered.filter((row) => `${row.title} ${row.author} ${row.category}`.toLocaleLowerCase("ug").includes(q));
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

async function measure(page, cardSelector, cartSelector, opts = {}) {
  return page.evaluate(({ cardSelector, cartSelector, titleSelector }) => {
    const cards = [...document.querySelectorAll(cardSelector)];
    return cards.map((card) => {
      const cart = card.querySelector(cartSelector);
      const img = card.querySelector("img");
      const cover = card.querySelector(".premium-card-cover, .home-feature-cover-frame, .home-carousel-cover, .mini-cover, .book-cover-frame, .book-image, .cover-stock-wrap, .favorite-cover");
      const title = titleSelector ? card.querySelector(titleSelector) : card.querySelector("strong, .home-feature-title, .home-carousel-title, .book-title, .shop-mini-title, .favorite-card-title, .advanced-search-title");
      const afterCover = card.querySelector(".premium-card-badges") || title;
      const coverBox = cover ? cover.getBoundingClientRect() : { bottom: 0 };
      const nextBox = afterCover ? afterCover.getBoundingClientRect() : { top: 0 };
      const cartBox = cart ? cart.getBoundingClientRect() : { bottom: 0 };
      const cardBox = card.getBoundingClientRect();
      const titleCs = title ? getComputedStyle(title) : null;
      const text = card.innerText || "";
      return {
        top: Math.round(cardBox.top * 100) / 100,
        cartBottom: cart ? cartBox.bottom : null,
        coverTitleGap: nextBox.top - coverBox.bottom,
        objectFit: img ? getComputedStyle(img).objectFit : "",
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        titleClamp: titleCs ? String(titleCs.webkitLineClamp || titleCs.lineClamp || "") : "",
        hasInStockLabel: /ئامباردا بار/.test(text),
        exactQty: /\d+\s*دانە/.test(text) || /stock\s*[:=]\s*\d/i.test(text)
      };
    });
  }, { cardSelector, cartSelector, titleSelector: opts.titleSelector || "" });
}

function expectAlignedRows(items, { tile = true, clamp = false, requireComparableRow = false } = {}) {
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    if (item.objectFit) expect(item.objectFit).toBe("contain");
    expect(item.overflowX).toBeLessThanOrEqual(2);
    expect(item.hasInStockLabel).toBeFalsy();
    expect(item.exactQty).toBeFalsy();
    if (tile) {
      expect(item.coverTitleGap).toBeGreaterThanOrEqual(-1);
      expect(item.coverTitleGap).toBeLessThan(28);
    }
    if (clamp) expect(item.titleClamp === "2" || item.titleClamp === "2.0").toBeTruthy();
  }
  const rows = [];
  for (const item of items) {
    if (item.cartBottom == null) continue;
    const row = rows.find((candidate) => Math.abs(candidate.top - item.top) <= 2);
    if (row) row.items.push(item);
    else rows.push({ top: item.top, items: [item] });
  }
  const comparable = rows.filter((row) => row.items.length >= 2);
  if (requireComparableRow) expect(comparable.length).toBeGreaterThan(0);
  for (const row of comparable) {
    const bottoms = row.items.map((item) => item.cartBottom);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(2);
  }
}

function requireRow(width, minWidth) {
  return width >= minWidth;
}

async function enableDarkMode(page) {
  await page.evaluate(() => {
    document.body.classList.add("dark-mode");
    document.documentElement.classList.add("dark-mode");
  });
}

async function applyMode(page, mode) {
  if (mode === "dark") {
    await enableDarkMode(page);
    await expect.poll(async () =>
      page.evaluate(() =>
        document.documentElement.classList.contains("dark-mode") ||
        document.body.classList.contains("dark-mode")
      )
    ).toBeTruthy();
    return;
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark-mode");
    document.body.classList.remove("dark-mode");
  });
}

async function assertDocumentMode(page, mode) {
  if (mode !== "dark") return;
  await expect.poll(async () =>
    page.evaluate(() =>
      document.documentElement.classList.contains("dark-mode") ||
      document.body.classList.contains("dark-mode")
    )
  ).toBeTruthy();
}

async function seedLocalLists(page, { favIds = [], recentIds = [] } = {}) {
  await page.addInitScript(({ favIds, recentIds }) => {
    try {
      localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(favIds));
      localStorage.setItem("kutadgu-recent-v1", JSON.stringify(recentIds));
    } catch (err) {}
  }, { favIds, recentIds });
}

async function capture(page, sel, name, mode) {
  await assertDocumentMode(page, mode);
  const dirs = ["/opt/cursor/artifacts", "/tmp/public-card-row-screens"];
  for (const dir of dirs) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
  }
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const buf = await loc.screenshot({ animations: "disabled", timeout: 15000 });
  for (const dir of dirs) {
    try { fs.writeFileSync(`${dir}/${name}`, buf); } catch (err) {}
  }
}

const WIDTHS = [390, 768, 1366];

test.describe("public book-card same-row cart alignment", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, catalog.map((row) => String(row.id)));
    await H.clearShopStorage(page);
  });

  async function withModes(page, width, fn) {
    await page.setViewportSize({ width, height: width >= 1366 ? 1100 : 900 });
    await fn("light");
    await fn("dark");
  }

  test("A listing category cards stay aligned", async ({ page }) => {
    test.setTimeout(120000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const items = await measure(page, ".books-grid[data-catalog-source] .book-card:not(.is-skeleton)", ".book-actions .add-to-cart", { titleSelector: ".book-title" });
        expectAlignedRows(items, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        await expect(page.locator('.book-card[data-live-book-id="91003"] .add-to-cart')).toBeDisabled();
        await expect(page.locator(".books-grid")).not.toContainText("ئامباردا بار");
        await expect(page.locator(".books-grid")).not.toContainText("دانە");
      });
    }
  });

  test("B /adabiyat listing stays aligned", async ({ page }) => {
    test.setTimeout(120000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/adabiyat", { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const items = await measure(page, ".books-grid[data-catalog-source] .book-card:not(.is-skeleton)", ".book-actions .add-to-cart", { titleSelector: ".book-title" });
        expectAlignedRows(items, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
      });
    }
  });

  test("C homepage featured cards align in each visual row", async ({ page }) => {
    test.setTimeout(360000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator('link[data-kutadgu-public-book-card-row-alignment]').count()).toBeGreaterThan(0);
        await expect.poll(async () => page.locator("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        await page.locator("#homeFeaturedBooks .home-feature-card img").first().evaluate((img) => img.decode?.() || Promise.resolve()).catch(() => {});
        const items = await measure(page, "#homeFeaturedBooks .home-feature-card:not(.is-skeleton)", ".home-feature-cart", { titleSelector: ".home-feature-title" });
        expectAlignedRows(items, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        await capture(page, "#homeFeaturedBooks", `public_align_featured_${width}_${mode}.png`, mode);
      });
    }
  });

  test("D homepage carousel cards align in each visual row", async ({ page }) => {
    test.setTimeout(360000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator("#newBooksCarousel .home-carousel-card:not(.is-skeleton)").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const items = await measure(page, "#newBooksCarousel .home-carousel-card:not(.is-skeleton)", ".home-carousel-cart", { titleSelector: ".home-carousel-title" });
        expectAlignedRows(items, { tile: true, clamp: true, requireComparableRow: requireRow(width, 768) });
        await capture(page, "#newBooksCarousel", `public_align_carousel_${width}_${mode}.png`, mode);
      });
    }
  });

  test("E homepage premium discovery stays aligned", async ({ page }) => {
    test.setTimeout(360000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#premiumDiscovery", { timeout: 20000 });
        await page.locator("#premiumDiscovery [data-premium-group]").first().click();
        await expect.poll(async () => page.locator("#premiumDiscoveryResults .premium-book-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const items = await measure(page, "#premiumDiscoveryResults .premium-book-card", ".premium-card-cart");
        expectAlignedRows(items, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        await capture(page, "#premiumDiscoveryResults", `public_align_discovery_${width}_${mode}.png`, mode);
      });
    }
  });

  test("F premium wizard results align", async ({ page }) => {
    test.setTimeout(360000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#premiumWizardOpen", { timeout: 20000 });
        await page.locator("#premiumWizardOpen").click();
        await page.locator('#premiumWizard [data-wizard-group]').first().click();
        await page.locator('#premiumWizard [data-wizard-style="story"]').click();
        await page.locator('#premiumWizard [data-wizard-price="all"]').click();
        await expect.poll(async () => page.locator("#premiumWizardResults .premium-book-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const items = await measure(page, "#premiumWizardResults .premium-book-card", ".premium-card-cart");
        expectAlignedRows(items, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        await capture(page, "#premiumWizardResults", `public_align_wizard_${width}_${mode}.png`, mode);
      });
    }
  });

  test("G search-empty premium recommendations align", async ({ page }) => {
    test.setTimeout(360000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#searchInput", { timeout: 20000 });
        await page.locator("#searchInput").fill("zzzz-no-match-kutadgu");
        await page.locator("#searchInput").press("Enter");
        await expect.poll(async () => page.locator("#searchResults .premium-empty-books .premium-book-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const items = await measure(page, "#searchResults .premium-empty-books .premium-book-card", ".premium-card-cart");
        expectAlignedRows(items, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        await capture(page, "#searchResults .premium-empty-books", `public_align_search_empty_${width}_${mode}.png`, mode);
      });
    }
  });

  test("H I J book-detail similar recent and people-also-viewed", async ({ page }) => {
    test.setTimeout(360000);
    await seedLocalLists(page, {
      recentIds: ["91005", "91006", "91007", "91008"],
      favIds: ["91009", "91010", "91011", "91012"]
    });
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
        await H.waitForDetailTitle(page, LONG);
        await expect.poll(async () => page.locator("[data-detail-related] .shop-mini-card").count()).toBeGreaterThan(1);
        await expect.poll(async () => page.locator("[data-recently-viewed] .shop-mini-card").count()).toBeGreaterThan(1);
        await expect.poll(async () => page.evaluate(() => window.KUTADGU_PREMIUM_UX_READY === true)).toBeTruthy();
        await expect.poll(async () => page.evaluate(() => {
          const extras = document.querySelector(".detail-extra-sections");
          const catalog = window.kutadguShop && window.kutadguShop.getCatalog ? window.kutadguShop.getCatalog() : [];
          const currentId = document.body.dataset.bookId || "";
          return extras && currentId && catalog.some((book) => String(book.id) === String(currentId)) && catalog.length >= 8;
        })).toBeTruthy();
        await expect.poll(async () => page.locator("[data-people-also-viewed] .premium-book-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const similar = await measure(page, "[data-detail-related] .detail-related-grid .shop-mini-card", ".mini-actions .add-to-cart", { titleSelector: ".shop-mini-title" });
        expectAlignedRows(similar, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        const recent = await measure(page, "[data-recently-viewed] .shop-mini-card", ".mini-actions .add-to-cart", { titleSelector: ".shop-mini-title" });
        expectAlignedRows(recent, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        const also = await measure(page, "[data-people-also-viewed] .premium-book-card", ".premium-card-cart");
        expectAlignedRows(also, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
        await capture(page, "[data-people-also-viewed]", `public_align_people_also_${width}_${mode}.png`, mode);
      });
    }
  });

  test("K L M My Books newest recommended recent", async ({ page }) => {
    test.setTimeout(360000);
    await seedLocalLists(page, { recentIds: ["91001", "91002", "91004", "91006"] });
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/my-books.html", { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator("#myBooksApp .mybooks-grid .shop-mini-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const newest = await measure(page, "#myBooksApp .mybooks-grid:not([data-recently-viewed]) .shop-mini-card", ".mini-actions .add-to-cart", { titleSelector: ".shop-mini-title" });
        expectAlignedRows(newest, { tile: true, clamp: false, requireComparableRow: requireRow(width, 390) });
        await capture(page, "#myBooksContent", `public_align_mybooks_newest_${width}_${mode}.png`, mode);
        await page.locator('[data-mybooks-tab="recommended"]').click();
        await expect.poll(async () => page.locator("#myBooksApp .mybooks-grid .shop-mini-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const rec = await measure(page, "#myBooksApp .mybooks-grid:not([data-recently-viewed]) .shop-mini-card", ".mini-actions .add-to-cart", { titleSelector: ".shop-mini-title" });
        expectAlignedRows(rec, { tile: true, clamp: false, requireComparableRow: requireRow(width, 390) });
        await capture(page, "#myBooksContent", `public_align_mybooks_recommended_${width}_${mode}.png`, mode);
        await page.locator('[data-mybooks-tab="recent"]').click();
        await expect.poll(async () => page.locator("#myBooksApp [data-recently-viewed] .shop-mini-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const recent = await measure(page, "#myBooksApp [data-recently-viewed] .shop-mini-card", ".mini-actions .add-to-cart", { titleSelector: ".shop-mini-title" });
        expectAlignedRows(recent, { tile: true, clamp: true, requireComparableRow: requireRow(width, 390) });
      });
    }
  });

  test("N O favorites page and My Books favorites", async ({ page }) => {
    test.setTimeout(360000);
    await seedLocalLists(page, { favIds: ["91001", "91002", "91004", "91006"] });
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/favorites.html", { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator("#favoritesList .favorite-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const favs = await measure(page, "#favoritesList .favorite-card", ".favorite-card-actions .add-to-cart", { titleSelector: ".favorite-card-title" });
        expectAlignedRows(favs, { tile: false, clamp: false, requireComparableRow: requireRow(width, 768) });
        await capture(page, "#favoritesList", `public_align_favorites_${width}_${mode}.png`, mode);
        await page.goto("/my-books.html", { waitUntil: "domcontentloaded" });
        await page.locator('[data-mybooks-tab="favorites"]').click();
        await expect.poll(async () => page.locator("#myBooksApp .favorites-grid .favorite-card").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const mine = await measure(page, "#myBooksApp .favorites-grid .favorite-card", ".favorite-card-actions .add-to-cart", { titleSelector: ".favorite-card-title" });
        expectAlignedRows(mine, { tile: false, clamp: false, requireComparableRow: requireRow(width, 768) });
      });
    }
  });

  test("P search results stay aligned without CSS changes", async ({ page }) => {
    test.setTimeout(120000);
    await mockCatalog(page);
    for (const width of WIDTHS) {
      await withModes(page, width, async (mode) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#searchInput", { timeout: 20000 });
        await page.locator("#searchInput").fill("رومان");
        await page.locator("#searchInput").press("Enter");
        await expect.poll(async () => page.locator("#searchResults .advanced-search-result").count()).toBeGreaterThan(1);
        await applyMode(page, mode);
        const items = await measure(page, "#searchResults .advanced-search-result", ".advanced-search-actions .add-to-cart", { titleSelector: ".advanced-search-title" });
        expectAlignedRows(items, { tile: false, clamp: false, requireComparableRow: requireRow(width, 1366) });
      });
    }
  });
});
