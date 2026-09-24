const { test, expect } = require("./playwright-test");
const fs = require("fs");
const path = require("path");
const H = require("./helpers");

const LOGO = fs.readFileSync(path.join(__dirname, "..", "..", "kutadgu-logo.png"));

function bookRow(id, title, image) {
  return {
    id,
    title,
    author: "سىناق ئاپتور",
    price: 20,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: image,
    is_active: true,
    is_recommended: false,
    is_new: false,
    stock: 4,
    stock_status: "in_stock",
    sales_count: 1,
    created_at: "2026-08-01T00:00:00Z"
  };
}

async function mockBooks(page, books) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    if (req.url().includes("is_active=eq.false")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0" },
        body: "[]"
      });
    }
    if (req.method() === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${books.length}` },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(books.length - 1, 0)}/${books.length}` },
      body: JSON.stringify(books)
    });
  });
  await page.route("**/cover-bind-*.png", async (route) => {
    return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
  });
}

test.describe("customer covers stay bound to their own book", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("listing cards bind data-cover-book and refuse known sample names", async ({ page }) => {
    await mockBooks(page, [
      bookRow(91021, "ھەقىقىي", "/cover-bind-a.png"),
      bookRow(91022, "نامۇنا", "/sample-book-cover.png"),
      bookRow(91023, "كارۇسېل", "/carousel-sample-cover.png"),
      bookRow(91024, "كۆپەيتىلگەن", "/sample-book-cover(1).png")
    ]);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    const real = page.locator('[data-live-book-id="91021"] img');
    await expect(real).toHaveAttribute("data-cover-book", "91021", { timeout: 20_000 });
    await expect(real).toHaveAttribute("data-cover-src", /cover-bind-a\.png/);
    await expect(page.locator('[data-live-book-id="91022"] .book-cover-unavailable')).toBeVisible();
    await expect(page.locator('[data-live-book-id="91023"] .book-cover-unavailable')).toBeVisible();
    await expect(page.locator('[data-live-book-id="91024"] .book-cover-unavailable')).toBeVisible();
    const html = await page.locator(".books-grid[data-catalog-source]").innerHTML();
    expect(html).not.toMatch(/src="[^"]*sample-book-cover/i);
    expect(html).not.toMatch(/src="[^"]*carousel-sample-cover/i);
  });

  test("a late cover error cannot replace another book's image", async ({ page }) => {
    await mockBooks(page, [
      bookRow(91031, "كىتاب A", "/cover-bind-a.png"),
      bookRow(91032, "كىتاب B", "/cover-bind-b.png")
    ]);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    const imgA = page.locator('[data-live-book-id="91031"] img');
    const imgB = page.locator('[data-live-book-id="91032"] img');
    await expect(imgA).toHaveAttribute("data-cover-book", "91031", { timeout: 20_000 });
    await expect(imgB).toHaveAttribute("data-cover-book", "91032");
    const before = await imgB.getAttribute("src");
    const changed = await page.evaluate(() => {
      const a = document.querySelector('[data-live-book-id="91031"] img');
      const b = document.querySelector('[data-live-book-id="91032"] img');
      const beforeSrc = b.getAttribute("src");
      a.setAttribute("data-cover-book", "91032");
      window.kutadguHandleCoverError(a);
      return b.getAttribute("src") !== beforeSrc || b.getAttribute("data-cover-book") !== "91032";
    });
    expect(changed).toBe(false);
    await expect(imgB).toHaveAttribute("src", before);
    await expect(page.locator('[data-live-book-id="91032"] .book-cover-unavailable')).toHaveCount(0);
  });
});
