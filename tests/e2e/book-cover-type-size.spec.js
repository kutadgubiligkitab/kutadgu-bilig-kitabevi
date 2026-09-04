const { test, expect } = require("./playwright-test");

const FIXTURES = [
  {id:1,title:"Alpha Book",author:"Author A",price:10,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/a.webp",is_active:true,is_recommended:false,is_new:false,stock:3,stock_status:"in_stock",sales_count:5,legacy_id:"leg-1",created_at:"2026-01-01",isbn:"9781111111111",description:"desc",cover_type:"hardcover",book_size:"A5"}
];

async function openAdminCreate(page) {
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = books;
  }, FIXTURES);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator("#newBookBtn").click();
  await expect(page.locator("#bookModal")).toBeVisible();
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

test.describe("book cover type and size", () => {
  for (const width of [390, 768, 1280]) {
    test(`admin create form cover/size usable at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAdminCreate(page);
      await expect(page.locator("#bookCoverType")).toBeVisible();
      await expect(page.locator("#bookSize")).toBeVisible();
      await expect(page.locator("#bookCoverType")).toHaveValue("");
      await expect(page.locator("#bookSize")).toHaveValue("");
      await expect(page.locator('#bookCoverType option[value="hardcover"]')).toHaveText("قاتتىق مۇقاۋىلىق");
      await expect(page.locator('#bookCoverType option[value="paperback"]')).toHaveText("يۇمشاق مۇقاۋىلىق");
      await expect(page.locator('#bookCoverType option[value="other"]')).toHaveText("باشقا");
      await expect(page.locator('#bookSize option[value="A4"]')).toHaveCount(1);
      await expect(page.locator('#bookSize option[value="A5"]')).toHaveCount(1);
      await expect(page.locator('#bookSize option[value="B5"]')).toHaveCount(1);
      await expect(page.locator('#bookSize option[value="other"]')).toHaveText("باشقا");
      await page.locator("#bookCoverType").selectOption("hardcover");
      await page.locator("#bookSize").selectOption("A5");
      await expect(page.locator("#bookCoverType")).toHaveValue("hardcover");
      await expect(page.locator("#bookSize")).toHaveValue("A5");
      await noOverflow(page);
      if (width === 1280) {
        await page.screenshot({ path: "/opt/cursor/artifacts/admin_book_form_cover_type_size_1280.png", fullPage: false });
      }
      if (width === 390) {
        await page.screenshot({ path: "/opt/cursor/artifacts/admin_book_form_cover_type_size_390.png", fullPage: false });
      }
    });
  }

  test("storefront detail meta shows labels and hides empty or invalid values", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.kutadguShop && window.KutadguBibliography, { timeout: 30_000 });
    const out = await page.evaluate(() => {
      const Shop = window.kutadguShop;
      const Bib = window.KutadguBibliography;
      const shown = Shop.normalizeCatalogBook({
        id: "1", title: "T", author: "A", category: "C", source: "universal.html",
        cover_type: "hardcover", book_size: "A5"
      }, 0, true);
      const hidden = Shop.normalizeCatalogBook({
        id: "2", title: "T", author: "A", category: "C", source: "universal.html",
        cover_type: "", book_size: null
      }, 0, true);
      return {
        shownCover: shown.coverType,
        shownSize: shown.bookSize,
        coverHtml: Shop.setDynamicMeta("مۇقاۋا تۈرى", Bib.coverTypeLabel(shown.coverType)),
        sizeHtml: Shop.setDynamicMeta("كىتاب ئۆلچىمى", Bib.bookSizeLabel(shown.bookSize)),
        hiddenCover: Shop.setDynamicMeta("مۇقاۋا تۈرى", Bib.coverTypeLabel(hidden.coverType)),
        hiddenSize: Shop.setDynamicMeta("كىتاب ئۆلچىمى", Bib.bookSizeLabel(hidden.bookSize)),
        junk: Shop.setDynamicMeta("مۇقاۋا تۈرى", "undefined") + Shop.setDynamicMeta("كىتاب ئۆلچىمى", "null")
      };
    });
    expect(out.shownCover).toBe("hardcover");
    expect(out.shownSize).toBe("A5");
    expect(out.coverHtml).toContain("قاتتىق مۇقاۋىلىق");
    expect(out.sizeHtml).toContain("A5");
    expect(out.hiddenCover).toBe("");
    expect(out.hiddenSize).toBe("");
    expect(out.junk).toBe("");
    expect(out.coverHtml).not.toContain("undefined");
    expect(out.sizeHtml).not.toContain("null");
  });
});
