const { test, expect } = require("./playwright-test");

const REAL = "تەۋسىيە كىتابى";
const OUT = "تۈگەپ كەتكەن كىتاب";
const HIDDEN = "يوشۇرۇن كىتاب";
const RELIGION = "دىن كىتابى";
const CHILD = "بالا كىتابى";
const TITLE_SORT = "ئات تەرتىپى";
const NEW_SORT = "يېڭى تەرتىپ";
const DEMO = /sample-book-cover\.png|رومان كىتابى/;

function row(overrides) {
  return {
    id: 91001,
    title: REAL,
    author: "سىناق ئاپتور",
    price: 88,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 4,
    stock_status: "in_stock",
    sales_count: 0,
    submission_status: "approved",
    created_at: "2026-08-02T00:00:00Z",
    ...overrides
  };
}

function catalogRows() {
  return [
    row({ id: 91001, title: REAL, price: 88, stock: 4, stock_status: "in_stock" }),
    row({ id: 91002, title: OUT, price: 40, stock: 0, stock_status: "out_of_stock" }),
    row({ id: 91003, title: HIDDEN, price: 10, is_active: false }),
    row({ id: 91011, title: RELIGION, category: "دىنىي كىتابلار", is_recommended: false, is_new: false, price: 55, stock: 2 }),
    row({ id: 91012, title: CHILD, category: "بالىلار كىتابلىرى", is_recommended: false, is_new: false, price: 30, stock: 3 }),
    row({ id: 91021, title: TITLE_SORT, category: "رومانلار", is_recommended: false, is_new: false, price: 70, stock: 1 }),
    row({ id: 91022, title: NEW_SORT, category: "رومانلار", is_recommended: false, is_new: true, price: 70, stock: 1 })
  ];
}

function decodeParam(url, key) {
  const value = new URL(url).searchParams.get(key) || "";
  return value.startsWith("eq.") ? decodeURIComponent(value.slice(3)) : value;
}

async function finish(route, options) {
  try { await route.fulfill(options); } catch (err) {}
}

async function installCatalog(page, state) {
  await page.addInitScript(() => {
    try { sessionStorage.removeItem("kutadgu-catalog-active-count-v1"); } catch (err) {}
  });
  await page.route("**/api/analytics-event**", (route) => route.abort());
  await page.route("**/cdn-cgi/rum**", (route) => route.abort());
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const availability = method === "HEAD" && url.includes("is_active=eq.true") && !url.includes("sales_count");
    const sales = method === "HEAD" && url.includes("sales_count=gt.0");
    if (sales) {
      state.salesHeads += 1;
      return finish(route, {
        status: 206,
        headers: { "content-range": "*/0", "content-type": "application/json" },
        body: ""
      });
    }
    if (availability) {
      state.availabilityHeads += 1;
      if (state.head === "hang") {
        await new Promise((resolve) => setTimeout(resolve, 12000));
        try { await route.abort(); } catch (err) {}
        return;
      }
      if (state.head === "fail") {
        return finish(route, {
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "probe failed" })
        });
      }
      return finish(route, {
        status: 206,
        headers: { "content-range": "0-0/4", "content-type": "application/json" },
        body: ""
      });
    }
    if (method !== "GET") {
      try { await route.continue(); } catch (err) {}
      return;
    }
    state.gets += 1;
    const range = String(req.headers().range || "");
    const parts = range.split("-").map(Number);
    if (Number.isFinite(parts[0]) && Number.isFinite(parts[1])) state.spans.push(parts[1] - parts[0] + 1);
    const headers = req.headers();
    state.auth.push({ apikey: headers.apikey || "", authorization: headers.authorization || "" });
    const order = new URL(url).searchParams.get("order") || "";
    state.orders.push(order);
    if (state.get === "hold" && (state.holdAll || url.includes("category=eq."))) {
      await new Promise((resolve) => state.pending.push(resolve));
    }
    if (state.get === "slow") await new Promise((resolve) => setTimeout(resolve, 1600));
    if (state.get === "fail") {
      return finish(route, {
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "catalog down" })
      });
    }
    let rows = catalogRows().filter((book) => book.is_active !== false || url.includes("is_active=eq.false"));
    if (!url.includes("is_active=eq.false")) rows = rows.filter((book) => book.is_active !== false);
    if (url.includes("is_recommended=eq.true")) rows = rows.filter((book) => book.is_recommended === true);
    if (url.includes("is_new=eq.true")) rows = rows.filter((book) => book.is_new === true);
    const category = decodeParam(url, "category");
    if (category) rows = rows.filter((book) => book.category === category);
    if (state.get === "empty") rows = [];
    if (order.startsWith("title.asc")) rows = rows.filter((book) => book.title === TITLE_SORT);
    else if (url.includes("source=eq.romanlar.html") && !category) rows = rows.filter((book) => book.title === NEW_SORT);
    const from = Number.isFinite(parts[0]) ? parts[0] : 0;
    const slice = rows.slice(from, Number.isFinite(parts[1]) ? parts[1] + 1 : rows.length);
    const last = Math.max(from, from + slice.length - 1);
    return finish(route, {
      status: slice.length ? 206 : 200,
      contentType: "application/json",
      headers: { "content-range": slice.length ? `${from}-${last}/${rows.length}` : "*/0" },
      body: JSON.stringify(slice)
    });
  });
}

function freshState(overrides) {
  return {
    head: "fail",
    get: "ok",
    holdAll: false,
    availabilityHeads: 0,
    salesHeads: 0,
    gets: 0,
    spans: [],
    auth: [],
    orders: [],
    pending: [],
    ...overrides
  };
}

async function openHome(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test.describe("catalog probe recovery", () => {
  test("a failed availability probe still loads bounded homepage reads at 390", async ({ page }) => {
    const state = freshState();
    await installCatalog(page, state);
    await openHome(page, 390);
    await expect(page.locator("#homeCarouselTrack")).toContainText(REAL);
    await expect(page.locator("#homeFeaturedBooks")).toContainText(REAL);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText(HIDDEN);
    await expect(page.locator("#homeFeaturedBooks")).not.toContainText(HIDDEN);
    await expect(page.locator("#homeCarouselTrack")).toContainText("88 ₺");
    await expect(page.locator('#homeCarouselTrack [data-cart-id="91002"]')).toHaveCount(2);
    await expect(page.locator('#homeCarouselTrack [data-cart-id="91002"]:not([disabled])')).toHaveCount(0);
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("قايتا سىناش");
    await expect(page.locator("#homeFeaturedBooks")).not.toContainText("قايتا سىناش");
    const html = await page.locator("#homeCarouselTrack, #homeFeaturedBooks").evaluateAll((els) => els.map((el) => el.innerHTML).join(""));
    expect(html).not.toMatch(DEMO);
    expect(state.availabilityHeads).toBe(1);
    expect(state.gets).toBeGreaterThan(0);
    expect(state.gets).toBeLessThan(8);
    expect(Math.max(...state.spans)).toBeLessThanOrEqual(24);
    expect(state.auth.length).toBeGreaterThan(0);
    for (const headers of state.auth) {
      expect(headers.apikey.length).toBeGreaterThan(10);
      expect(headers.authorization).toBe(`Bearer ${headers.apikey}`);
    }
  });

  test("the availability timeout still recovers through a later bounded read", async ({ page }) => {
    test.setTimeout(30_000);
    const state = freshState({ head: "hang" });
    await installCatalog(page, state);
    await openHome(page, 390);
    await expect(page.locator("#homeCarouselTrack")).toContainText(REAL, { timeout: 20_000 });
    await expect(page.locator("#homeFeaturedBooks")).toContainText(REAL);
    expect(state.availabilityHeads).toBe(1);
    expect(state.gets).toBeGreaterThan(0);
    expect(state.gets).toBeLessThan(8);
  });

  test("a slow catalog read is shown and a healthy cold load probes once", async ({ page }) => {
    const slow = freshState({ head: "fail", get: "slow" });
    await installCatalog(page, slow);
    await openHome(page, 1280);
    await expect(page.locator("#homeCarouselTrack")).toContainText(REAL);
    await expect(page.locator("#homeFeaturedBooks .catalog-retry-btn")).toHaveCount(0);
    expect(Math.max(...slow.spans)).toBeLessThanOrEqual(24);

    const cold = freshState({ head: "ok", get: "ok" });
    const coldPage = await page.context().newPage();
    await installCatalog(coldPage, cold);
    await coldPage.setViewportSize({ width: 390, height: 844 });
    await coldPage.goto("/", { waitUntil: "domcontentloaded" });
    await expect(coldPage.locator("#homeCarouselTrack")).toContainText(REAL);
    await expect(coldPage.locator("#homeFeaturedBooks")).toContainText(REAL);
    expect(cold.availabilityHeads).toBe(1);
    expect(cold.gets).toBeGreaterThan(0);
    await expect(coldPage.locator(".catalog-retry-btn")).toHaveCount(0);
  });

  test("a permanent failure keeps the error and a later retry reads the same sections", async ({ page }) => {
    const state = freshState({ head: "fail", get: "fail" });
    await installCatalog(page, state);
    await openHome(page, 390);
    await expect(page.locator("#homeCarouselTrack .catalog-retry-btn")).toHaveText("قايتا سىناش");
    await expect(page.locator("#homeFeaturedBooks .catalog-retry-btn")).toHaveText("قايتا سىناش");
    await expect(page.locator("#homeCarouselTrack")).toContainText("كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    await expect(page.locator("#homeFeaturedBooks")).toContainText("يېقىندا قوشۇلغان كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    const before = state.gets;
    await page.locator("#homeCarouselTrack .catalog-retry-btn").click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    expect(state.gets).toBeGreaterThan(before);
    expect(state.gets).toBeLessThan(12);
    expect(state.availabilityHeads).toBe(1);
    const html = await page.locator("#homeCarouselTrack, #homeFeaturedBooks").evaluateAll((els) => els.map((el) => el.innerHTML).join(""));
    expect(html).not.toMatch(DEMO);
    expect(html).not.toContain(REAL);

    state.get = "ok";
    await page.locator("#homeFeaturedBooks .catalog-retry-btn").click();
    await page.locator("#homeCarouselTrack .catalog-retry-btn").click();
    await expect(page.locator("#homeFeaturedBooks")).toContainText(REAL);
    await expect(page.locator("#homeCarouselTrack")).toContainText(REAL);
    await expect(page.locator("#homeCarouselTrack")).toContainText("88 ₺");
  });

  test("an empty remote page stays empty", async ({ page }) => {
    const state = freshState({ head: "fail", get: "empty" });
    await installCatalog(page, state);
    await openHome(page, 390);
    await expect(page.locator("#homeCarouselTrack")).toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
    await expect(page.locator("#homeFeaturedBooks")).toContainText("كىتابلار تېخى قوشۇلمىغان");
    await expect(page.locator("#homeCarouselTrack .catalog-retry-btn, #homeFeaturedBooks .catalog-retry-btn")).toHaveCount(0);
    const html = await page.locator("#homeCarouselTrack, #homeFeaturedBooks").evaluateAll((els) => els.map((el) => el.innerHTML).join(""));
    expect(html).not.toMatch(DEMO);
    expect(html).not.toContain(REAL);
  });

  test("changing a category group does not rebuild reading discovery", async ({ page }) => {
    const state = freshState({ head: "fail", get: "hold" });
    await installCatalog(page, state);
    await openHome(page, 390);
    await expect(page.locator("#homeCarouselTrack")).toContainText(REAL);
    await page.locator(".category-nav-toggle").click();
    await page.locator("#bookCategories [data-category-group]").first().click();
    await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
    await expect(page.locator("#bookCategories .category-nav-leaf").first()).toBeVisible();
    state.pending.splice(0).forEach((release) => release());
    await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
    expect(Math.max(0, ...state.spans)).toBeLessThanOrEqual(24);
  });

  test("a listing sort change during recovery keeps the selected sort", async ({ page }) => {
    const state = freshState({ head: "fail", get: "hold", holdAll: true });
    await installCatalog(page, state);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect.poll(() => state.pending.length).toBeGreaterThan(0);
    await page.locator("#catalogSort").evaluate((el) => {
      el.value = "title";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => state.orders.some((order) => order.startsWith("title.asc"))).toBe(true);
    state.pending.splice(0).forEach((release) => release());
    await expect(page.locator(".books-grid")).toContainText(TITLE_SORT);
    await expect(page.locator(".books-grid")).not.toContainText(NEW_SORT);
    await expect(page.locator("#catalogSort")).toHaveValue("title");
    await expect(page.locator(".books-grid")).toContainText("70 ₺");
    const html = await page.locator(".books-grid").innerHTML();
    expect(html).not.toMatch(DEMO);
    expect(Math.max(...state.spans)).toBeLessThanOrEqual(24);
  });
});
