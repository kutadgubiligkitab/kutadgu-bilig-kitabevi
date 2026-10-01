const { test, expect } = require("./playwright-test");
const H = require("./helpers");

function book(id, overrides = {}) {
  return {
    id,
    title: `كىتاب ${String(id).padStart(2, "0")}`,
    author: `ئاپتور ${id}`,
    price: 100 + id,
    source: id % 2 ? "romanlar.html" : "universal.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: id % 5 === 0,
    is_new: true,
    stock: id === 4 ? 0 : 6,
    stock_status: id === 4 ? "out_of_stock" : "in_stock",
    sales_count: id % 7,
    created_at: new Date(Date.UTC(2024, 0, id)).toISOString(),
    ...overrides
  };
}

function catalog(count) {
  return Array.from({ length: count }, (_, i) => book(i + 1));
}

async function mockCatalog(page, options = {}) {
  const state = {
    books: options.books || catalog(30),
    fail: !!options.fail,
    rowCap: options.rowCap || 0,
    recordCap: options.recordCap || 0,
    omitIds: new Set((options.omitIds || []).map(String)),
    delayForOrder: options.delayForOrder || null,
    holdNextRecord: null,
    heldRecord: false,
    analytics: []
  };
  page.on("request", (req) => {
    const url = req.url();
    if (/analytics_events|get_kutadgu_analytics|\/kbg\//.test(url)) state.analytics.push(url);
  });
  await page.route("**/rest/v1/analytics_events**", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/rest/v1/rpc/get_kutadgu_analytics**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}"
  }));
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    if (state.fail) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "catalog down" }) });
    }
    const url = new URL(req.url());
    const order = url.searchParams.get("order") || "";
    if (state.delayForOrder && order.startsWith(state.delayForOrder)) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    // PostgREST exposes Content-Range. A short 206 without that header is a truncated id index.
    if (req.method() === "HEAD") {
      const active = state.books.filter((row) => row.is_active !== false).length;
      return route.fulfill({
        status: 206,
        headers: {
          "content-range": `0-0/${active}`,
          "access-control-expose-headers": "Content-Range"
        },
        body: ""
      });
    }
    let rows = state.books.filter((row) => row.is_active !== false);
    if (url.searchParams.get("is_active") === "eq.false") rows = [];
    const source = url.searchParams.get("source") || "";
    if (source.startsWith("eq.")) rows = rows.filter((row) => row.source === source.slice(3));
    const idFilter = url.searchParams.get("id") || "";
    if (idFilter.startsWith("eq.")) rows = rows.filter((row) => String(row.id) === idFilter.slice(3));
    if (idFilter.startsWith("in.(")) {
      state.recordStarts = (state.recordStarts || 0) + 1;
      const wanted = new Set(idFilter.slice(4, -1).split(",").filter(Boolean));
      rows = rows.filter((row) => wanted.has(String(row.id)) && !state.omitIds.has(String(row.id)));
      if (state.holdNextRecord && !state.heldRecord) {
        state.heldRecord = true;
        await state.holdNextRecord;
      }
    }
    const sales = url.searchParams.get("sales_count") || "";
    if (sales.startsWith("gt.")) rows = rows.filter((row) => Number(row.sales_count) > Number(sales.slice(3)));
    const searchBlob = `${url.searchParams.get("or") || ""} ${url.searchParams.get("and") || ""}`;
    if (/ilike\./i.test(searchBlob)) {
      const patterns = [...searchBlob.matchAll(/ilike\.([^,)&]+)/gi)].map((match) => match[1] || "");
      rows = rows.filter((row) => {
        const hay = `${row.title} ${row.author} ${row.category || ""}`;
        return patterns.some((pattern) => {
          const tokens = pattern.split("*").map((part) => part.trim()).filter(Boolean);
          return tokens.length && tokens.every((token) => hay.includes(token));
        });
      });
    }
    rows = rows.slice().sort((a, b) => {
      if (order.startsWith("title")) return String(a.title).localeCompare(String(b.title), "ug") || a.id - b.id;
      if (order.startsWith("author")) return String(a.author).localeCompare(String(b.author), "ug") || a.id - b.id;
      if (order.startsWith("price.asc")) return a.price - b.price || a.id - b.id;
      if (order.startsWith("price.desc")) return b.price - a.price || a.id - b.id;
      if (order.startsWith("sales_count")) return b.sales_count - a.sales_count || b.id - a.id;
      if (order.startsWith("id.asc")) return a.id - b.id;
      return String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id;
    });
    const select = url.searchParams.get("select") || "";
    const indexRequest = select === "id,is_active" || select === "id";
    const range = String(req.headers().range || "0-23");
    const [fromRaw, toRaw] = range.split("-").map((part) => Number(part));
    const from = Number.isFinite(fromRaw) ? fromRaw : 0;
    const to = Number.isFinite(toRaw) ? toRaw : from + 23;
    let slice = rows.slice(from, to + 1);
    if (indexRequest && state.rowCap > 0) slice = slice.slice(0, state.rowCap);
    if (!indexRequest && state.recordCap > 0) slice = slice.slice(0, state.recordCap);
    if (!slice.length) {
      return route.fulfill({
        status: 416,
        contentType: "application/json",
        headers: {
          "content-range": `*/${rows.length}`,
          "access-control-expose-headers": "Content-Range"
        },
        body: "[]"
      });
    }
    const end = from + slice.length - 1;
    const payload = indexRequest ? slice.map((row) => ({ id: row.id, is_active: row.is_active !== false })) : slice;
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: {
        "content-range": `${from}-${end}/${rows.length}`,
        "access-control-expose-headers": "Content-Range"
      },
      body: JSON.stringify(payload)
    });
  });
  return state;
}

async function titles(page) {
  return page.locator(".books-grid[data-catalog-source] .book-card:not(.is-skeleton) .book-title").allTextContents();
}

async function loadAll(page) {
  await expect(page.locator(".books-grid[data-catalog-ready]")).toBeVisible();
  for (let i = 0; i < 20; i += 1) {
    const button = page.locator(".catalog-load-more");
    if (!(await button.count())) return;
    const before = (await titles(page)).length;
    await button.click();
    await expect.poll(async () => (await titles(page)).length, { timeout: 10000 }).toBeGreaterThan(before);
  }
}

test.describe("visit discovery order on all books", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("keeps one order across load more, detail back, and reload, then rotates on a new visit", async ({ page, browser }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await mockCatalog(page, { books: catalog(30) });
    await H.stubNumericBookDocuments(page, catalog(30).map((row) => row.id));
    const response = await page.goto("/books", { waitUntil: "domcontentloaded" });
    const html = await response.text();
    expect(html).toContain('rel="canonical" href="https://www.kutadgubilik.com/books"');
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(html).toContain("CollectionPage");
    await expect(page.locator("#catalogSort option[value='discover']")).toHaveText("بۇ قېتىملىق بايقاش تەرتىپى");
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(24);
    const first = await titles(page);
    await loadAll(page);
    const all = await titles(page);
    expect(new Set(all).size).toBe(30);
    expect(all.slice(0, 24)).toEqual(first);
    await expect(page.locator(".catalog-load-more")).toHaveCount(0);
    const seed = await page.evaluate(() => sessionStorage.getItem("kutadgu-books-visit-v1"));
    expect(seed).toContain("\"seed\"");
    await page.locator(".book-card:not(.is-skeleton) .detail-button").first().click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/book\/\d+\/?$/);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await titles(page)).length, { timeout: 15000 }).toBe(30);
    expect(await titles(page)).toEqual(all);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await titles(page)).length, { timeout: 15000 }).toBe(30);
    expect(await titles(page)).toEqual(all);
    state.books.push(book(99, { title: "يېڭى كىتاب" }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await titles(page)).length, { timeout: 15000 }).toBe(30);
    expect(await titles(page)).not.toContain("يېڭى كىتاب");
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await H.installReadSafeNetwork(freshPage);
    await mockCatalog(freshPage, { books: state.books });
    await freshPage.setViewportSize({ width: 1280, height: 900 });
    await freshPage.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(freshPage.locator(".books-grid[data-catalog-ready]")).toBeVisible();
    await loadAll(freshPage);
    const freshTitles = await titles(freshPage);
    expect(freshTitles).toContain("يېڭى كىتاب");
    expect(freshTitles).not.toEqual(all);
    const freshSeed = await freshPage.evaluate(() => sessionStorage.getItem("kutadgu-books-visit-v1"));
    expect(freshSeed).not.toBe(seed);
    expect(state.analytics.filter((url) => /fxlojnqwyojqjskfggmh/.test(url) && /analytics_events|get_kutadgu_analytics/.test(url))).toEqual([]);
    await fresh.close();
  });

  test("uses the mobile page size and still covers every id when the index page is short", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mockCatalog(page, { books: catalog(30), rowCap: 4 });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(12);
    await loadAll(page);
    const all = await titles(page);
    expect(new Set(all).size).toBe(30);
    expect(all).toHaveLength(30);
  });

  test("preserves search, explicit sorts, filters, and the same order when default returns", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockCatalog(page, { books: catalog(18), delayForOrder: "title.asc" });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(18);
    const discovery = await titles(page);
    await page.locator("#catalogSort").selectOption("title");
    await page.locator("#catalogSort").selectOption("author", { timeout: 1000 });
    await expect.poll(async () => (await titles(page)).join("|"), { timeout: 10000 }).toBe(
      catalog(18).slice().sort((a, b) => String(a.author).localeCompare(String(b.author), "ug") || a.id - b.id).map((row) => row.title).join("|")
    );
    await page.locator("#catalogSort").selectOption("new");
    await expect.poll(async () => (await titles(page))[0]).toBe("كىتاب 18");
    await page.locator("#catalogFilterText").fill("كىتاب 07");
    await expect.poll(async () => await titles(page), { timeout: 10000 }).toEqual(["كىتاب 07"]);
    await page.locator("#catalogFilterReset").click();
    await expect.poll(async () => (await titles(page)).join("|"), { timeout: 10000 }).toBe(discovery.join("|"));
    const out = page.locator(".book-card", { hasText: "كىتاب 04" });
    await expect(out.locator(".stock-badge")).toHaveText("تۈگەپ كەتتى");
    await page.locator(".book-card", { hasText: "كىتاب 03" }).locator("[data-cart-id]").click();
    await page.locator(".book-card", { hasText: "كىتاب 03" }).locator("[data-fav-id]").click();
    const saved = await page.evaluate(() => ({
      cart: JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]"),
      fav: JSON.parse(localStorage.getItem("kutadgu-favorites-v1") || "[]"),
      visitInLocal: localStorage.getItem("kutadgu-books-visit-v1")
    }));
    expect(saved.cart.map((line) => String(line.id))).toContain("3");
    expect(saved.fav.map(String)).toContain("3");
    expect(saved.visitInLocal).toBeNull();
    await expect(page.locator(".book-card", { hasText: "كىتاب 03" }).locator(".book-price")).toContainText("₺");
  });

  test("category pages stay on their own order and a failed catalog does not show demo books", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockCatalog(page, { books: catalog(6) });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#catalogSort option[value='discover']")).toHaveCount(0);
    const expected = catalog(6).filter((row) => row.source === "romanlar.html").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((row) => row.title);
    await expect.poll(async () => (await titles(page)).join("|"), { timeout: 15000 }).toBe(expected.join("|"));
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(6);
  });

  test("a configured catalog error stays an error, and storage failure still keeps one order", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await mockCatalog(page, { books: catalog(8), fail: true });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".catalog-error-state")).toBeVisible();
    await expect(page.locator(".books-grid")).not.toContainText("رومان كىتابى");
    state.fail = false;
    await page.locator(".catalog-retry-btn").click();
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(8);
    const order = await titles(page);
    await page.locator("#catalogSort").selectOption("priceLow");
    await expect.poll(async () => (await titles(page))[0]).toBe("كىتاب 01");
    await page.locator("#catalogSort").selectOption("discover");
    await expect.poll(async () => (await titles(page)).join("|")).toBe(order.join("|"));
  });

  test("sessionStorage failure falls back without sticking the order in localStorage", async ({ page }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      const getItem = Storage.prototype.getItem;
      const blocked = (key) => key === "kutadgu-books-visit-v1" || key === "kutadgu-books-visit-probe";
      Storage.prototype.setItem = function (key, value) {
        if (this === window.sessionStorage && blocked(key)) throw new Error("denied");
        return setItem.call(this, key, value);
      };
      Storage.prototype.getItem = function (key) {
        if (this === window.sessionStorage && blocked(key)) throw new Error("denied");
        return getItem.call(this, key);
      };
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockCatalog(page, { books: catalog(8) });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(8);
    const order = await titles(page);
    await page.locator("#catalogSort").selectOption("title");
    await expect.poll(async () => (await titles(page))[0]).not.toBe(order[0]);
    await page.locator("#catalogSort").selectOption("discover");
    await expect.poll(async () => (await titles(page)).join("|")).toBe(order.join("|"));
    expect(await page.evaluate(() => localStorage.getItem("kutadgu-books-visit-v1"))).toBeNull();
  });

  test("sort, search, and reset during Load more replace the append", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await mockCatalog(page, { books: catalog(30) });
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(24);
    const discovery = await titles(page);

    async function holdLoadMore() {
      let release;
      state.heldRecord = false;
      state.holdNextRecord = new Promise((resolve) => { release = resolve; });
      const started = state.recordStarts || 0;
      const pendingClick = page.locator(".catalog-load-more").click();
      await expect.poll(() => state.recordStarts || 0).toBe(started + 1);
      return { release, pendingClick, started };
    }

    const sortHold = await holdLoadMore();
    await page.locator(".catalog-load-more").evaluate((button) => {
      button.disabled = false;
      button.click();
    });
    expect(state.recordStarts).toBe(sortHold.started + 1);
    const titleRequest = page.waitForRequest((req) => req.url().includes("order=title.asc"));
    await page.locator("#catalogSort").selectOption("title");
    await titleRequest;
    sortHold.release();
    await sortHold.pendingClick;
    const titled = catalog(30).slice().sort((a, b) => String(a.title).localeCompare(String(b.title), "ug") || a.id - b.id).map((row) => row.title);
    await expect.poll(async () => (await titles(page)).join("|")).toBe(titled.slice(0, 24).join("|"));
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(24);

    await page.locator("#catalogFilterReset").click();
    await expect.poll(async () => (await titles(page)).join("|")).toBe(discovery.join("|"));

    const searchHold = await holdLoadMore();
    const searchRequest = page.waitForRequest((req) => /ilike/i.test(req.url()));
    await page.locator("#catalogFilterText").fill("كىتاب 07");
    await searchRequest;
    searchHold.release();
    await searchHold.pendingClick;
    await expect.poll(async () => await titles(page)).toEqual(["كىتاب 07"]);

    await page.locator("#catalogFilterReset").click();
    await expect.poll(async () => (await titles(page)).join("|")).toBe(discovery.join("|"));

    const resetHold = await holdLoadMore();
    const resetStarted = state.recordStarts || 0;
    await page.locator("#catalogFilterReset").click();
    await expect.poll(() => state.recordStarts || 0).toBe(resetStarted + 1);
    resetHold.release();
    await resetHold.pendingClick;
    await expect.poll(async () => (await titles(page)).join("|")).toBe(discovery.join("|"));
    await expect(page.locator(".book-card:not(.is-skeleton)")).toHaveCount(24);
  });

  test("a capped full-record response lists every eligible snapshot id once", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const books = catalog(60);
    await mockCatalog(page, { books, recordCap: 4, omitIds: ["7", "19"] });
    await H.stubNumericBookDocuments(page, books.map((row) => row.id));
    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await loadAll(page);
    const all = await titles(page);
    const expected = books.filter((row) => row.id !== 7 && row.id !== 19).map((row) => row.title);
    expect(all).toHaveLength(58);
    expect(new Set(all).size).toBe(58);
    expect(all.slice().sort()).toEqual(expected.slice().sort());
    await expect(page.locator(".catalog-load-more")).toHaveCount(0);
    await page.locator(".book-card:not(.is-skeleton) .detail-button").first().click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/book\/\d+\/?$/);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await titles(page)).length, { timeout: 15000 }).toBe(58);
    expect(await titles(page)).toEqual(all);
  });
});
