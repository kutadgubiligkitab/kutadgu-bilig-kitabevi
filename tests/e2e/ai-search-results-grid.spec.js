const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const QUERY = "بالام ئۈچۈن بىلىم ئاشۇرىدىغان بالىلار كىتابى ئىزدەۋاتىمەن";
const SHOW_MORE = "تېخىمۇ كۆپ كۆرسەت";
const LONG_TITLE = "بۇ بەك ئۇزۇن ئۇيغۇرچە كىتاب نامى بولۇپ كارتا ئىچىدە قۇر ئالماشتۇرۇشى كېرەك";

function bookRow(id, overrides) {
  return Object.assign({
    id,
    title: "كىتاب " + id,
    author: "ئاپتور " + id,
    category: "بالىلار كىتابلىرى",
    price: 20 + id,
    stock: 2,
    image_url: "/kutadgu-logo.png"
  }, overrides || {});
}

async function mockEmptyCatalog(page) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    if (!["GET", "HEAD"].includes(req.method())) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "*/0" },
      body: req.method() === "HEAD" ? "" : "[]"
    });
  });
}

async function mockAiSearch(page, results, hits) {
  await page.route("**/api/ai-search", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    if (hits) hits.n += 1;
    const body = typeof results === "function" ? results(hits && hits.n) : results;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, results: body })
    });
  });
}

async function runAiSearch(page, query) {
  await page.locator("#searchInput").fill(query || QUERY);
  await page.locator("#aiSearchButton").click();
  await expect(page.locator("#aiSearchResults .ai-search-item").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("AI Search results grid and show more", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockEmptyCatalog(page);
  });

  test("A desktop starts with six cards in two columns and a show-more button", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const rows = Array.from({ length: 12 }, (_, i) => bookRow(i + 1));
    await mockAiSearch(page, rows);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await runAiSearch(page);
    const cards = page.locator("#aiSearchResults .ai-search-item");
    await expect(cards).toHaveCount(6);
    await expect(page.locator("#aiSearchResults .ai-search-show-more")).toHaveText(SHOW_MORE);
    const layout = await page.locator("#aiSearchResults .ai-search-list").evaluate((list) => {
      const style = getComputedStyle(list);
      const items = [...list.querySelectorAll(".ai-search-item")];
      const tops = items.map((el) => Math.round(el.getBoundingClientRect().top));
      return { columns: style.gridTemplateColumns, tops };
    });
    expect(String(layout.columns).split(" ").filter(Boolean).length).toBe(2);
    expect(layout.tops[0]).toBe(layout.tops[1]);
    expect(layout.tops[2]).toBeGreaterThan(layout.tops[0]);
  });

  test("B show more reveals the rest once without another API call", async ({ page }) => {
    const hits = { n: 0 };
    const rows = Array.from({ length: 12 }, (_, i) => bookRow(i + 1));
    await mockAiSearch(page, rows, hits);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await runAiSearch(page);
    expect(hits.n).toBe(1);
    await page.locator("#aiSearchResults .ai-search-show-more").click();
    const cards = page.locator("#aiSearchResults .ai-search-item");
    await expect(cards).toHaveCount(12);
    const titles = await cards.locator(".ai-search-title").allTextContents();
    expect(titles).toEqual(rows.map((row) => row.title));
    await expect(page.locator("#aiSearchResults .ai-search-show-more")).toHaveCount(0);
    expect(hits.n).toBe(1);
  });

  test("C four results have no show-more button", async ({ page }) => {
    await mockAiSearch(page, [bookRow(1), bookRow(2), bookRow(3), bookRow(4)]);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await runAiSearch(page);
    await expect(page.locator("#aiSearchResults .ai-search-item")).toHaveCount(4);
    await expect(page.locator("#aiSearchResults .ai-search-show-more")).toHaveCount(0);
  });

  test("D a new AI query resets visible cards to six", async ({ page }) => {
    const hits = { n: 0 };
    await mockAiSearch(page, (n) => {
      const start = n === 1 ? 1 : 101;
      return Array.from({ length: 12 }, (_, i) => bookRow(start + i));
    }, hits);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await runAiSearch(page);
    await page.locator("#aiSearchResults .ai-search-show-more").click();
    await expect(page.locator("#aiSearchResults .ai-search-item")).toHaveCount(12);
    await page.locator("#aiSearchButton").click();
    await expect(page.locator("#aiSearchResults .ai-search-title").first()).toHaveText("كىتاب 101", { timeout: 15_000 });
    await expect(page.locator("#aiSearchResults .ai-search-item")).toHaveCount(6);
    await expect(page.locator("#aiSearchResults .ai-search-show-more")).toBeVisible();
    expect(hits.n).toBe(2);
  });

  test("E BUG-01 remains fixed while the grid is showing", async ({ page }) => {
    await mockAiSearch(page, Array.from({ length: 8 }, (_, i) => bookRow(i + 1)));
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await page.locator("#searchInput").fill(QUERY);
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults")).toContainText(/0 دانە كىتاب تېپىلدى|نەتىجە تېپىلمىدى/);
    await page.locator("#aiSearchButton").click();
    await expect(page.locator("#aiSearchResults .ai-search-item").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#searchResults")).toBeHidden();
    await page.locator("#searchInput").fill("zzz-no-such-book-999");
    await expect(page.locator("#aiSearchResults")).toBeHidden();
    await expect(page.locator("#searchResults")).not.toBeHidden();
  });

  test("F failed covers still use the neutral placeholder, never the sample image", async ({ page }) => {
    const sampleHits = [];
    page.on("request", (req) => {
      if (/sample-book-cover\.png/i.test(req.url())) sampleHits.push(req.url());
    });
    await page.route("**/ai-cover-fail-probe.png", async (route) => route.abort());
    await mockAiSearch(page, [
      bookRow(207, { title: "ھەقىقىي مۇقاۋا", image_url: "/kutadgu-logo.png" }),
      bookRow(164, { title: "مەغلۇپ مۇقاۋا", image_url: "/ai-cover-fail-probe.png" })
    ]);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await runAiSearch(page);
    await expect(page.locator("#aiSearchResults a.ai-search-title[href='/book/207']")).toBeVisible();
    await expect(page.locator("#aiSearchResults .ai-search-cover img[src*='kutadgu-logo.png']")).toBeVisible();
    await expect(page.locator("#aiSearchResults .ai-search-cover-placeholder:not([hidden])")).toHaveText("مۇقاۋا يوق");
    const html = await page.locator("#aiSearchResults").innerHTML();
    expect(html).not.toMatch(/sample-book-cover\.png/i);
    expect(sampleHits).toEqual([]);
  });

  test("G mobile stays one column without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAiSearch(page, [
      bookRow(1, { title: LONG_TITLE, image_url: "/kutadgu-logo.png" }),
      bookRow(2),
      bookRow(3)
    ]);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await runAiSearch(page);
    const metrics = await page.locator("#aiSearchResults").evaluate((box) => {
      const list = box.querySelector(".ai-search-list");
      const first = box.querySelector(".ai-search-item");
      const img = box.querySelector(".ai-search-cover img");
      const title = box.querySelector(".ai-search-title");
      const style = getComputedStyle(list);
      const imgStyle = img ? getComputedStyle(img) : {};
      return {
        columns: style.gridTemplateColumns,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        itemWidth: first.getBoundingClientRect().width,
        viewport: window.innerWidth,
        objectFit: imgStyle.objectFit,
        titleWraps: title.scrollHeight > title.clientHeight || title.getClientRects().length >= 1,
        titleOverflow: title.scrollWidth - title.clientWidth
      };
    });
    expect(String(metrics.columns).split(" ").filter(Boolean).length).toBe(1);
    expect(metrics.overflowX).toBeLessThanOrEqual(1);
    expect(metrics.itemWidth).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.objectFit).toBe("contain");
    expect(metrics.titleOverflow).toBeLessThanOrEqual(1);
  });
});
