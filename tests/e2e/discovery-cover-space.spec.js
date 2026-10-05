const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const LOADING = "كىتابلار يۈكلىنىۋاتىدۇ…";
const EMPTY = "بۇ تۈردە ھازىرچە كىتاب يوق. باشقا تۈرنى تاللاپ كۆرۈڭ.";
const ERROR = "كىتابلارنى يۈكلەشتە ۋاقىتلىق خاتالىق كۆرۈلدى. سەل تۇرۇپ قايتا سىناڭ.";
const PROBE = "/premium-discovery-cover-probe.png";

const VIEWPORTS = [
  { width: 390, height: 800 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 }
];

function bookRow(overrides) {
  return {
    id: 92001,
    title: "رومان",
    author: "سىناق ئاپتور",
    price: 42,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: false,
    stock: 4,
    stock_status: "in_stock",
    sales_count: 1,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

function eightBooks() {
  return Array.from({ length: 8 }, (_, index) => bookRow({
    id: 92001 + index,
    title: `رومان ${index + 1}`,
    is_recommended: false,
    is_new: false
  }));
}

function booksForRequest(req, books) {
  const url = new URL(req.url());
  if (url.searchParams.get("is_active") === "eq.false") return [];
  let rows = books.filter((row) => row.is_active !== false);
  const category = url.searchParams.get("category") || "";
  if (category.startsWith("eq.")) rows = rows.filter((row) => row.category === category.slice(3));
  if (url.searchParams.get("is_recommended") === "eq.true") rows = rows.filter((row) => row.is_recommended);
  if (url.searchParams.get("is_new") === "eq.true") rows = rows.filter((row) => row.is_new);
  const idFilter = url.searchParams.get("id") || "";
  if (idFilter.startsWith("eq.")) rows = rows.filter((row) => String(row.id) === idFilter.slice(3));
  return rows;
}

async function fulfillBooks(route, rows) {
  const req = route.request();
  if (req.method() === "HEAD") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `*/${rows.length}` },
      body: ""
    });
    return;
  }
  const range = String(req.headers().range || req.headers().Range || "");
  const match = range.match(/(\d+)-(\d+)/);
  const from = match ? Number(match[1]) : 0;
  const to = match ? Number(match[2]) : Math.max(rows.length - 1, 0);
  const slice = rows.slice(from, to + 1);
  const last = slice.length ? from + slice.length - 1 : from;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "content-range": slice.length ? `${from}-${last}/${rows.length}` : "*/0" },
    body: JSON.stringify(slice)
  });
}

async function installCatalog(page, books) {
  const state = { gate: null, mode: "books", started: 0, finished: 0 };
  await page.route("**/rest/v1/book_credits**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const raw = req.url();
    const decoded = decodeURIComponent(raw);
    const discoveryQuery = decoded.includes("category=eq.");
    if (!discoveryQuery) {
      await fulfillBooks(route, booksForRequest(req, books));
      return;
    }
    state.started += 1;
    try {
      if (state.gate) await state.gate;
      if (state.mode === "error") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "injected" })
        });
        return;
      }
      const category = new URL(raw).searchParams.get("category") || "";
      const name = category.startsWith("eq.") ? category.slice(3) : "";
      const filtered = state.mode === "empty" ? [] : books.filter((row) => row.category === name && row.is_active !== false);
      await fulfillBooks(route, filtered);
    } catch (err) {
      // An aborted discovery request can reject fulfill. The later group owns the results.
    } finally {
      state.finished += 1;
    }
  });
  return {
    state,
    hold() {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      state.gate = gate;
      state.mode = "books";
      return release;
    }
  };
}

async function openDiscovery(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 800 : 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#premiumDiscovery [data-premium-group='literature']", { timeout: 20000 });
  expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe("rtl");
}

async function setTheme(page, theme) {
  await page.evaluate((mode) => {
    document.body.classList.toggle("dark-mode", mode === "dark");
    document.documentElement.classList.toggle("dark-mode", mode === "dark");
  }, theme);
}

async function pendingState(page) {
  return page.evaluate(() => {
    const pending = document.querySelector("#premiumDiscoveryResults .premium-discovery-pending");
    const grid = pending && pending.querySelector(".premium-book-grid");
    const msg = pending && pending.querySelector(".premium-discovery-loading");
    const cover = pending && pending.querySelector(".premium-card-cover");
    if (!pending || !grid || !msg || !cover) return { missing: true };
    const pr = pending.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    const mr = msg.getBoundingClientRect();
    const cr = cover.getBoundingClientRect();
    const results = document.querySelector("#premiumDiscoveryResults").getBoundingClientRect();
    const msgStyle = getComputedStyle(msg);
    const token = document.createElement("span");
    token.style.color = "var(--site-text)";
    document.body.appendChild(token);
    const tokenColor = getComputedStyle(token).color;
    token.remove();
    const carts = [...pending.querySelectorAll(".premium-card-cart")];
    return {
      missing: false,
      pendingH: Math.round(pr.height),
      gridH: Math.round(gr.height),
      resultsH: Math.round(results.height),
      msgH: Math.round(mr.height),
      msgW: Math.round(mr.width),
      coverW: Math.round(cr.width),
      coverH: Math.round(cr.height),
      msgColor: msgStyle.color,
      tokenColor,
      pointerEvents: msgStyle.pointerEvents,
      slots: pending.querySelectorAll(".premium-book-card").length,
      links: pending.querySelectorAll("a").length,
      bookIds: pending.querySelectorAll("[data-premium-book-id]").length,
      cartsDisabled: carts.length > 0 && carts.every((node) => node.disabled && node.tabIndex === -1),
      messageAccessible: !msg.closest("[aria-hidden='true']"),
      text: msg.innerText.replace(/\s+/g, " ").trim()
    };
  });
}

async function populatedCover(page) {
  return page.evaluate(() => {
    const results = document.querySelector("#premiumDiscoveryResults");
    const card = results && results.querySelector(".premium-book-card[data-premium-book-id]");
    const cover = card && card.querySelector(".premium-card-cover");
    if (!results || !cover) return { missing: true };
    const rr = results.getBoundingClientRect();
    const cr = cover.getBoundingClientRect();
    const mark = cover.querySelector(".book-cover-unavailable");
    const mr = mark ? mark.getBoundingClientRect() : null;
    return {
      missing: false,
      resultsH: Math.round(rr.height),
      coverW: Math.round(cr.width),
      coverH: Math.round(cr.height),
      coverTop: cr.top,
      coverRight: cr.right,
      coverBottom: cr.bottom,
      coverLeft: cr.left,
      mark: mr ? {
        top: mr.top,
        right: mr.right,
        bottom: mr.bottom,
        left: mr.left,
        minHeight: getComputedStyle(mark).minHeight
      } : null,
      cards: results.querySelectorAll("[data-premium-book-id]").length
    };
  });
}

test.describe("discovery cover space reservation", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.clearShopStorage(page);
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      test(`delayed response shows the loading sentence without changing the reserved grid at ${viewport.width} ${theme}`, async ({ page }) => {
        const catalog = await installCatalog(page, eightBooks());
        const release = catalog.hold();
        await openDiscovery(page, viewport.width);
        await setTheme(page, theme);
        await page.locator("[data-premium-group='literature']").click();
        await expect.poll(async () => (await pendingState(page)).slots).toBe(8);
        const pending = await pendingState(page);
        expect(pending.missing).toBe(false);
        expect(pending.text).toContain(LOADING);
        expect(pending.msgH).toBeGreaterThan(20);
        expect(pending.msgW).toBeGreaterThan(80);
        expect(pending.pointerEvents).toBe("none");
        expect(pending.msgColor).toBe(pending.tokenColor);
        expect(pending.messageAccessible).toBe(true);
        expect(pending.pendingH).toBe(pending.gridH);
        expect(pending.links).toBe(0);
        expect(pending.bookIds).toBe(0);
        expect(pending.cartsDisabled).toBe(true);
        expect(pending.coverW).toBeGreaterThan(40);
        expect(pending.coverH / pending.coverW).toBeGreaterThan(1.45);
        expect(pending.coverH / pending.coverW).toBeLessThan(1.55);
        const groupHit = await page.locator("[data-premium-group='literature']").evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return !!hit && (hit === el || el.contains(hit));
        });
        expect(groupHit).toBe(true);

        release();
        await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id]")).toHaveCount(8);
        await expect(page.locator("#premiumDiscoveryResults .premium-discovery-pending")).toHaveCount(0);
        await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(LOADING);
        const populated = await populatedCover(page);
        expect(populated.coverW).toBe(pending.coverW);
        expect(populated.coverH).toBe(pending.coverH);
        expect(Math.abs(populated.resultsH - pending.resultsH)).toBeLessThanOrEqual(2);

        const favorite = page.locator("[data-premium-favorite='92001']");
        await favorite.click();
        await expect(favorite).toHaveAttribute("aria-pressed", "true");
        expect((await H.readFavs(page)).map(String)).toContain("92001");
        await page.locator("[data-premium-cart='92001']").click();
        await expect.poll(async () => {
          const cart = await H.readCart(page);
          return cart.some((item) => String(item.id) === "92001");
        }).toBe(true);
        await expect(page.locator("[data-premium-book-id='92001'] a.premium-card-link")).toHaveAttribute("href", "/book/92001");
      });
    }
  }

  for (const width of [390, 1280]) {
    test(`rapid group switch renders only the latest response at ${width}`, async ({ page }) => {
      const books = [
        bookRow({ id: 92001, title: "ئەدەبىيات كىتابى", category: "رومانلار" }),
        bookRow({ id: 92011, title: "دىنىي كىتاب", category: "دىنىي كىتابلار", source: "dini.html" })
      ];
      const catalog = await installCatalog(page, books);
      const release = catalog.hold();
      await openDiscovery(page, width);
      await page.locator("[data-premium-group='literature']").click();
      await expect.poll(() => catalog.state.started).toBeGreaterThan(0);
      await expect(page.locator("#premiumDiscoveryResults .premium-discovery-loading")).toContainText(LOADING);
      const literatureRequests = catalog.state.started;
      await page.locator("[data-premium-group='religion']").click();
      await expect.poll(() => catalog.state.started).toBeGreaterThan(literatureRequests);
      await expect(page.locator("[data-premium-group='religion']")).toHaveClass(/is-active/);
      release();
      await expect.poll(() => catalog.state.finished === catalog.state.started && catalog.state.finished > literatureRequests).toBe(true);
      await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id='92011']")).toHaveCount(1);
      await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id='92001']")).toHaveCount(0);
      await expect(page.locator("#premiumDiscoveryResults .premium-discovery-pending")).toHaveCount(0);
    });
  }

  for (const width of [390, 768, 1280]) {
    test(`empty discovery response removes the reserved placeholders at ${width}`, async ({ page }) => {
      const catalog = await installCatalog(page, eightBooks());
      const release = catalog.hold();
      await openDiscovery(page, width);
      await page.locator("[data-premium-group='literature']").click();
      await expect.poll(async () => (await pendingState(page)).slots).toBe(8);
      catalog.state.mode = "empty";
      release();
      await expect(page.locator("#premiumDiscoveryResults")).toContainText(EMPTY);
      await expect(page.locator("#premiumDiscoveryResults .premium-book-card")).toHaveCount(0);
      await expect(page.locator("#premiumDiscoveryResults .premium-discovery-pending")).toHaveCount(0);
    });

    test(`failed discovery response removes the reserved placeholders at ${width}`, async ({ page }) => {
      const catalog = await installCatalog(page, eightBooks());
      const release = catalog.hold();
      await openDiscovery(page, width);
      await page.locator("[data-premium-group='literature']").click();
      await expect.poll(async () => (await pendingState(page)).slots).toBe(8);
      catalog.state.mode = "error";
      release();
      await expect(page.locator("#premiumDiscoveryResults")).toContainText(ERROR);
      await expect(page.locator("#premiumDiscoveryResults .premium-book-card")).toHaveCount(0);
      await expect(page.locator("#premiumDiscoveryResults .premium-discovery-pending")).toHaveCount(0);
    });

    test(`a two-book result is shorter than the eight-slot reserve at ${width}`, async ({ page }) => {
      const books = [bookRow({ id: 92001, title: "بىرىنچى" }), bookRow({ id: 92002, title: "ئىككىنچى" })];
      const catalog = await installCatalog(page, books);
      const release = catalog.hold();
      await openDiscovery(page, width);
      await page.locator("[data-premium-group='literature']").click();
      await expect.poll(async () => (await pendingState(page)).slots).toBe(8);
      const pending = await pendingState(page);
      release();
      await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id]")).toHaveCount(2);
      const populated = await populatedCover(page);
      expect(populated.coverW, `cover width stays ${pending.coverW}`).toBe(pending.coverW);
      expect(populated.coverH, `cover height stays ${pending.coverH}`).toBe(pending.coverH);
      expect(populated.resultsH, `eight-slot reserve ${pending.resultsH}px, two cards ${populated.resultsH}px`).toBeLessThan(pending.resultsH);
    });
  }

  for (const viewport of [{ width: 390, height: 800 }, { width: 1280, height: 900 }]) {
    for (const theme of ["light", "dark"]) {
      test(`permanent image failure stays inside the reserved cover at ${viewport.width} ${theme}`, async ({ page }) => {
        await page.route(`**${PROBE}`, (route) => route.abort("failed"));
        const catalog = await installCatalog(page, [bookRow({ id: 92031, title: "مۇقاۋىسى يوق", image_url: PROBE })]);
        await openDiscovery(page, viewport.width);
        await setTheme(page, theme);
        await page.locator("[data-premium-group='literature']").click();
        const card = page.locator("#premiumDiscoveryResults [data-premium-book-id='92031']");
        await expect(card).toBeVisible();
        const before = await populatedCover(page);
        await expect(card.locator(".book-cover-unavailable")).toBeVisible({ timeout: 8000 });
        const after = await populatedCover(page);
        expect(after.coverW).toBe(before.coverW);
        expect(after.coverH).toBe(before.coverH);
        expect(after.mark.minHeight).toBe("0px");
        expect(after.mark.top).toBeGreaterThanOrEqual(after.coverTop - 1);
        expect(after.mark.bottom).toBeLessThanOrEqual(after.coverBottom + 1);
        expect(after.mark.left).toBeGreaterThanOrEqual(after.coverLeft - 1);
        expect(after.mark.right).toBeLessThanOrEqual(after.coverRight + 1);
        await expect(card.locator("strong")).toHaveText("مۇقاۋىسى يوق");
        expect(catalog.state.mode).toBe("books");
      });
    }
  }
});
