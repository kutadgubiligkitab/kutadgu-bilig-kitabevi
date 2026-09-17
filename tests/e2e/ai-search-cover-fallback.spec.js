const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const QUERY = "بالام ئۈچۈن بىلىم ئاشۇرىدىغان بالىلار كىتابى ئىزدەۋاتىمەن";
const AI_TITLE = "سوغۇق يۈكلەش بالىلار كىتابى";
const FAILING_COVER = "/ai-cover-fail-probe.png";

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

async function mockAiSearch(page, results) {
  await page.route("**/api/ai-search", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, results })
    });
  });
}

test.describe("AI Search cover fallback", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockEmptyCatalog(page);
  });

  test("a failed AI result cover shows the neutral placeholder instead of the sample cover", async ({ page }) => {
    const sampleHits = [];
    page.on("request", (req) => {
      if (/sample-book-cover\.png/i.test(req.url())) sampleHits.push(req.url());
    });
    await page.route("**/ai-cover-fail-probe.png", async (route) => route.abort());
    await mockAiSearch(page, [{
      id: 164,
      title: AI_TITLE,
      author: "سىناق ئاپتور",
      category: "بالىلار كىتابلىرى",
      price: 45,
      stock: 3,
      image_url: FAILING_COVER
    }]);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await page.locator("#searchInput").fill(QUERY);
    await page.locator("#aiSearchButton").click();
    const results = page.locator("#aiSearchResults");
    await expect(results).toContainText(AI_TITLE, { timeout: 15_000 });
    await expect(results.locator("a.ai-search-title[href='/book/164']")).toBeVisible();
    await expect(results.locator(".ai-search-author")).toContainText("سىناق ئاپتور");
    await expect(results.locator(".ai-search-category")).toContainText("بالىلار كىتابلىرى");
    await expect(results.locator(".ai-search-meta")).toContainText("45 ₺");
    await expect(results.locator(".ai-search-cover-placeholder")).toBeVisible();
    await expect(results.locator(".ai-search-cover-placeholder")).toHaveText("مۇقاۋا يوق");
    await expect(results.locator(".ai-search-cover img")).toHaveCount(0);
    const html = await results.innerHTML();
    expect(html).not.toMatch(/sample-book-cover\.png/i);
    expect(sampleHits).toEqual([]);
    await expect(page.locator("#searchResults")).toBeHidden();
  });
});
