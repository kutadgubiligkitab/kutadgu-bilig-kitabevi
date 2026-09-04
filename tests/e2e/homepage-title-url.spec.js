const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const HOME_TITLE = "قۇتادغۇبىلىك كىتابخانىسى";

test.describe("homepage title and root URL", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("open / keeps exact homepage title and clean URL", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page).toHaveTitle(HOME_TITLE);
    expect(new URL(page.url()).pathname).toBe("/");
    const canonical = String(await page.locator('link[rel="canonical"]').first().getAttribute("href") || "").trim();
    expect(canonical.replace(/\/+$/, "/")).toMatch(/^https:\/\/www\.kutadgubilik\.com\/$/);
    await expect(page.locator("a.logo")).toHaveAttribute("href", "/");
  });

  test("book detail keeps a book-specific title then home resets", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await page.goto(book.detailPath, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForDetailTitle(page, book.title);
    const detailTitle = await page.title();
    expect(detailTitle).toContain(book.title);
    expect(detailTitle).toContain(" - قۇتادغۇبىلىك كىتابخانىسى");
    expect(detailTitle).not.toBe(HOME_TITLE);
    expect(page.url()).toContain(`/book/${encodeURIComponent(book.id)}`);
    expect(page.url()).not.toContain("book.html");

    await page.locator("a.detail-brand").click();
    await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
    await H.waitForShop(page);
    await expect(page).toHaveTitle(HOME_TITLE);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("/index.html redirects to / without a loop", async ({ page }) => {
    const hops = [];
    page.on("response", (res) => {
      const u = new URL(res.url());
      if (u.pathname === "/index.html" || u.pathname === "/") hops.push({ status: res.status(), path: u.pathname });
    });
    const response = await page.goto("/index.html?from=test", { waitUntil: "domcontentloaded" });
    expect(response && response.ok()).toBeTruthy();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("?from=test");
    await expect(page).toHaveTitle(HOME_TITLE);
    const indexResponses = hops.filter((h) => h.path === "/index.html");
    expect(indexResponses.length).toBeLessThanOrEqual(1);
    expect(indexResponses.every((h) => h.status === 308 || h.status === 301 || h.status === 307)).toBeTruthy();
  });

  test("refresh / stays on /", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page).toHaveTitle(HOME_TITLE);
  });

  test("search, cart, and favorites still open", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill(book.searchToken);
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
    await expect(page.locator(`.advanced-search-result[data-live-book-id="${book.id}"]`)).toBeVisible();

    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("#cartItems")).toBeVisible();

    await page.goto("/favorites.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator("body")).toBeVisible();
  });

  test("recently-added view-all goes to public catalog, not my-books", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const link = page.locator("#homeFeaturedBooks .home-featured-all");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "#books");
    const href = await link.getAttribute("href");
    expect(href).not.toMatch(/my-books/);
    await link.click();
    expect(new URL(page.url()).hash).toBe("#books");
    await expect(page.locator("#books")).toBeVisible();
    expect(new URL(page.url()).pathname).not.toMatch(/my-books/);
  });
});
