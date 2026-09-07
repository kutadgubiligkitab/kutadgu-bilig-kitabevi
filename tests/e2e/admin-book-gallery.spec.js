const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const COVER = "/kutadgu-logo.png";
const EXTRA_A = "/hero-brand-logo.png";
const EXTRA_B = "/carousel-sample-cover.png";

const FIXTURES = [
  {
    id: 1,
    title: "Gallery Book",
    author: "Author A",
    price: 10,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: COVER,
    gallery_images: [EXTRA_A, EXTRA_B],
    is_active: true,
    is_recommended: false,
    is_new: false,
    sales_count: 0,
    isbn: "9781111111111",
    description: "desc"
  },
  {
    id: 2,
    title: "Cover Only Book",
    author: "Author B",
    price: 12,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: COVER,
    gallery_images: [],
    is_active: true,
    is_recommended: false,
    is_new: false,
    sales_count: 0,
    isbn: "9782222222222",
    description: "desc"
  }
];

async function openAdminBooks(page) {
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = books;
    window.__kutadguPersistCalls = [];
    window.__kutadguAdminPersistBook = async (payload, op, id) => {
      window.__kutadguPersistCalls.push({ payload, op, id });
      return { error: null, data: [{ id: id || 1 }] };
    };
  }, FIXTURES);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await expect(page.locator("#booksCard")).toBeVisible();
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

test.describe("admin book-detail gallery restore", () => {
  test("schema flag enables existing gallery section on create", async ({ page }) => {
    await openAdminBooks(page);
    const enabled = await page.evaluate(() => window.KUTADGU_BOOKS_SCHEMA?.optionalColumns?.gallery_images);
    expect(enabled).toBe(true);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    const section = page.locator('[data-book-col="gallery_images"]');
    await expect(section).toBeVisible();
    await expect(page.locator("#bookGallery")).toBeVisible();
    await expect(page.locator("#bookGalleryStatus")).toHaveText("ھازىرچە قوشۇمچە رەسىم يوق.");
    await expect(page.locator("#bookCover")).toBeVisible();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(0);
  });

  test("edit loads extras; empty gallery stays empty; remove/reorder/save keep image_url", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator('[data-book-col="gallery_images"]')).toBeVisible();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(2);
    await expect(page.locator("#bookGalleryList img").nth(0)).toHaveAttribute("src", EXTRA_A);
    await expect(page.locator("#bookGalleryList img").nth(1)).toHaveAttribute("src", EXTRA_B);
    await expect(page.locator("#bookCoverPreview")).toHaveAttribute("src", COVER);

    await page.locator('[data-gallery-down="0"]').click();
    await expect(page.locator("#bookGalleryList img").nth(0)).toHaveAttribute("src", EXTRA_B);
    await expect(page.locator("#bookGalleryList img").nth(1)).toHaveAttribute("src", EXTRA_A);

    await page.locator('[data-gallery-remove="0"]').click();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(1);
    await expect(page.locator("#bookGalleryList img")).toHaveAttribute("src", EXTRA_A);

    await page.locator("#bookForm button[type='submit']").click();
    await expect.poll(async () => page.evaluate(() => (window.__kutadguPersistCalls || []).length)).toBe(1);
    await expect(page.locator("#bookModal")).toBeHidden();
    const call = await page.evaluate(() => window.__kutadguPersistCalls[0]);
    expect(call.op).toBe("UPDATE");
    expect(call.payload.image_url).toBe(COVER);
    expect(call.payload.gallery_images).toEqual([EXTRA_A]);
    expect(Object.prototype.hasOwnProperty.call(call.payload, "id")).toBe(false);

    await page.locator("#cancelBookEdit").click().catch(() => {});
    await page.locator('article[data-book-id="2"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(0);
    await expect(page.locator("#bookGalleryStatus")).toHaveText("ھازىرچە قوشۇمچە رەسىم يوق.");
  });

  test("max 4 extras is still enforced by existing helper", async ({ page }) => {
    await openAdminBooks(page);
    const plan = await page.evaluate(() => {
      const fn = window.__kutadguAdminTest.planGallerySelection();
      return {
        full: fn(4, 1),
        overflow: fn(0, 5),
        ok: fn(1, 2)
      };
    });
    expect(plan.full.ok).toBe(false);
    expect(plan.full.take).toBe(0);
    expect(plan.overflow.ok).toBe(false);
    expect(plan.overflow.take).toBe(4);
    expect(plan.ok.ok).toBe(true);
    expect(plan.ok.take).toBe(2);
  });

  for (const width of [390, 768]) {
    test(`mobile admin create gallery has no overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAdminBooks(page);
      await page.locator("#newBookBtn").click();
      await expect(page.locator('[data-book-col="gallery_images"]')).toBeVisible();
      await noOverflow(page);
    });
  }

  test("Hero Admin card remains on storefront section", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('[data-admin-section="storefront"]').click();
    await expect(page.locator("#heroAdminCard")).toBeVisible();
    await expect(page.locator("#heroSave")).toBeVisible();
    await expect(page.locator("#heroCampaignForm")).toHaveCount(0);
  });
});

test.describe("storefront still uses image_url only for cards and empty gallery layout", () => {
  test("listing card ignores gallery extras", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await page.route("**/rest/v1/books**", async (route) => {
      const books = [
        {
          id: 91001,
          title: "Gallery Card Book",
          author: "سىناق ئاپتور",
          price: 88,
          source: "romanlar.html",
          category: "رومانلار",
          image_url: COVER,
          gallery_images: [EXTRA_A],
          is_active: true,
          is_recommended: true,
          is_new: true,
          stock: 5,
          stock_status: "in_stock",
          sales_count: 3,
          created_at: "2026-08-01T00:00:00Z"
        }
      ];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify(books)
      });
    });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const card = page.locator(".book-card:not(.is-skeleton)").first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const src = await card.locator("img").first().getAttribute("src");
    expect(src).toContain("kutadgu-logo.png");
    expect(src).not.toContain("hero-brand-logo.png");
  });

  test("empty gallery keeps single-cover detail layout", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["91002"]);
    await page.route("**/rest/v1/books**", async (route) => {
      const books = [
        {
          id: 91002,
          title: "Cover Only Detail",
          author: "سىناق ئاپتور",
          price: 88,
          source: "romanlar.html",
          category: "رومانلار",
          image_url: COVER,
          gallery_images: [],
          is_active: true,
          is_recommended: true,
          is_new: true,
          stock: 5,
          stock_status: "in_stock",
          sales_count: 3,
          created_at: "2026-08-01T00:00:00Z"
        }
      ];
      const url = route.request().url();
      if (url.includes("is_active=eq.false")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "*/0" },
          body: "[]"
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify(books)
      });
    });
    await page.goto("/book/91002", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, "Cover Only Detail");
    await expect(page.locator(".book-cover-box img")).toBeVisible();
    await expect(page.locator(".book-gallery-thumbs")).toHaveCount(0);
  });
});
