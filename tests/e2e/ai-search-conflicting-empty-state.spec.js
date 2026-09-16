const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const QUERY = "بالام ئۈچۈن بىلىم ئاشۇرىدىغان بالىلار كىتابى ئىزدەۋاتىمەن";
const AI_TITLE = "سوغۇق يۈكلەش بالىلار كىتابى";

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

test.describe("BUG-01 AI Search vs Normal Search empty state", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockEmptyCatalog(page);
  });

  test("AI results hide the Normal Search zero-result empty state", async ({ page }) => {
    await mockAiSearch(page, [{
      id: 91001,
      title: AI_TITLE,
      author: "سىناق ئاپتور",
      category: "بالىلار كىتابلىرى",
      price: 45,
      stock: 3,
      image_url: "/kutadgu-logo.png"
    }]);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await expect(page.locator("#aiSearchButton")).toBeVisible();
    await page.locator("#searchInput").fill(QUERY);
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults")).toContainText(/0 دانە كىتاب تېپىلدى|نەتىجە تېپىلمىدى/);
    await page.locator("#aiSearchButton").click();
    await expect(page.locator("#aiSearchResults")).toContainText(AI_TITLE, { timeout: 15_000 });
    await expect(page.locator("#aiSearchResults a[href='/book/91001']").first()).toBeVisible();
    await expect(page.locator("#searchResults")).toBeHidden();
    await expect(page.locator("#searchResults")).not.toBeVisible();
  });

  test("AI empty message does not keep Normal Search empty copy visible", async ({ page }) => {
    await mockAiSearch(page, []);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await page.locator("#searchInput").fill(QUERY);
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults")).toContainText(/نەتىجە تېپىلمىدى|ئىزدەش نەتىجىسى تېپىلمىدى/);
    await page.locator("#aiSearchButton").click();
    await expect(page.locator("#aiSearchResults")).toContainText("AI ئىزدەش نەتىجىسى تېپىلمىدى");
    await expect(page.locator("#searchResults")).toBeHidden();
  });

  test("editing the query restores Normal Search", async ({ page }) => {
    await mockAiSearch(page, [{
      id: 91001,
      title: AI_TITLE,
      author: "A",
      category: "بالىلار",
      price: 10,
      stock: 1
    }]);
    await H.openFresh(page, "/");
    await H.waitForShop(page);
    await page.locator("#searchInput").fill(QUERY);
    await page.locator("#aiSearchButton").click();
    await expect(page.locator("#aiSearchResults")).toContainText(AI_TITLE);
    await expect(page.locator("#searchResults")).toBeHidden();
    await page.locator("#searchInput").fill("zzz-no-such-book-999");
    await expect(page.locator("#aiSearchResults")).toBeHidden();
    await expect(page.locator("#searchResults")).not.toBeHidden();
  });
});
