const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const path = require("path");

const COVER = "https://cdn.example/cover.webp";
const EXTRA_A = "https://cdn.example/toc.webp";
const EXTRA_B = "https://cdn.example/back.webp";
const LISTING_COVER = "/kutadgu-logo.png";
const LISTING_EXTRA = "/hero-brand-logo.png";
const GALLERY_STUB = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");

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
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = books;
    window.__kutadguBookSaves = [];
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      return { error: null, data: [{ id }] };
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
    await expect(page.locator("#bookGallery")).toBeAttached();
    await expect(page.locator("#bookGalleryPickBtn")).toBeVisible();
    await expect(page.locator("#bookGalleryPickBtn")).toHaveText("رەسىم تاللاش");
    await expect(page.locator("#bookGalleryPickStatus")).toHaveText("رەسىم تاللانمىدى");
    await expect(page.locator("#bookGalleryStatus")).toHaveText("ھازىرچە قوشۇمچە رەسىم يوق.");
    await expect(page.locator("#bookCover")).toBeVisible();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(0);
    const galleryText = await section.innerText();
    expect(galleryText).not.toMatch(/Choose Files|No file chosen/i);
    const inputBox = await page.locator("#bookGallery").boundingBox();
    expect(inputBox).toBeTruthy();
    expect(inputBox.width).toBeLessThanOrEqual(2);
    expect(inputBox.height).toBeLessThanOrEqual(2);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#bookGalleryPickBtn").click()
    ]);
    expect(chooser.isMultiple()).toBe(true);
    await chooser.setFiles([GALLERY_STUB]);
    await expect(page.locator("#bookGalleryPickStatus")).toHaveText("1 رەسىم تاللاندى");
  });

  test("edit loads extras; empty gallery stays empty; remove/reorder/save keep image_url", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator('[data-book-col="gallery_images"]')).toBeVisible();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(2);
    const removeBtns = page.locator("[data-gallery-remove]");
    await expect(removeBtns).toHaveCount(2);
    for (let i = 0; i < 2; i += 1) {
      const btn = removeBtns.nth(i);
      await expect(btn).toHaveAttribute("aria-label", "ئۆچۈرۈش");
      await expect(btn).toHaveAttribute("title", "ئۆچۈرۈش");
      await expect(btn.locator("svg")).toHaveCount(1);
      const visible = (await btn.innerText()).replace(/\s+/g, "");
      expect(visible).toBe("");
      expect(visible).not.toContain("ئۆچۈرۈش");
    }
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
    await expect(page.locator("#bookModal")).toBeHidden();
    const call = await page.evaluate(() => window.__kutadguBookSaves[0]);
    expect(call.operation).toBe("UPDATE");
    expect(call.payload.image_url).toBe(COVER);
    expect(call.payload.gallery_images).toEqual([EXTRA_A]);
    expect(Object.prototype.hasOwnProperty.call(call.payload, "id")).toBe(false);
  });

  test("empty gallery loads as empty in Admin", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="2"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(0);
    await expect(page.locator("#bookGalleryStatus")).toHaveText("ھازىرچە قوشۇمچە رەسىم يوق.");
    await expect(page.locator("#bookCoverPreview")).toHaveAttribute("src", COVER);
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

  for (const width of [390, 430, 768, 1366]) {
    test(`admin gallery has no overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width >= 1366 ? 900 : 844 });
      await openAdminBooks(page);
      await page.locator('article[data-book-id="1"] [data-edit]').click();
      await expect(page.locator('[data-book-col="gallery_images"]')).toBeVisible();
      await expect(page.locator("[data-gallery-remove]")).toHaveCount(2);
      const item = page.locator(".admin-gallery-item").first();
      const geometry = await item.evaluate((el) => {
        const card = el.getBoundingClientRect();
        const remove = el.querySelector("[data-gallery-remove]");
        const up = el.querySelector("[data-gallery-up]");
        const down = el.querySelector("[data-gallery-down]");
        const rr = remove.getBoundingClientRect();
        const ur = up.getBoundingClientRect();
        const dr = down.getBoundingClientRect();
        const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        return {
          cardW: card.width,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          removeInside: rr.left >= card.left - 1 && rr.right <= card.right + 1 && rr.bottom <= card.bottom + 1,
          overlapUp: overlap(rr, ur),
          overlapDown: overlap(rr, dr)
        };
      });
      expect(geometry.overflowX, JSON.stringify(geometry)).toBeLessThanOrEqual(1);
      expect(geometry.removeInside, JSON.stringify(geometry)).toBe(true);
      expect(geometry.overlapUp, JSON.stringify(geometry)).toBe(false);
      expect(geometry.overlapDown, JSON.stringify(geometry)).toBe(false);
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
          image_url: LISTING_COVER,
          gallery_images: [LISTING_EXTRA],
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
          image_url: LISTING_COVER,
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
