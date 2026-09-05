const { test, expect } = require("./playwright-test");

const BOOKS = [
  {id:1,title:"Alpha Book",author:"Author A",price:10,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/a.webp",is_active:true,is_recommended:false,is_new:false,stock:null,sales_count:5,isbn:"9781111111111",description:"desc"},
  {id:2,title:"Beta Book",author:"Author B",price:12,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/b.webp",is_active:true,is_recommended:false,is_new:false,stock:0,sales_count:0,isbn:"9782222222222",description:"desc"},
  {id:3,title:"Gamma Book",author:"Author C",price:8,source:"romanlar.html",category:"رومانلار",image_url:"https://cdn.example/c.webp",is_active:true,is_recommended:false,is_new:false,stock:3,sales_count:1,isbn:"9783333333333",description:"desc"},
  {id:4,title:"Delta Book",author:"Author D",price:20,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/d.webp",is_active:true,stock:4,sales_count:0,isbn:"4",description:"d"}
];

async function openAdminBooks(page, extraInit, books = BOOKS) {
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = rows;
    window.__kutadguQuickPatches = [];
    window.__kutadguBookSaves = [];
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      return { error: null, data: [{ id }] };
    };
    window.__kutadguAdminPersistQuick = async (id, patch) => {
      window.__kutadguQuickPatches.push({ id, patch });
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      if (row && patch && Object.prototype.hasOwnProperty.call(patch, "stock")) row.stock = patch.stock;
      return { error: null };
    };
    window.__kutadguAdminFetchBook = async (id) => {
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      return row ? { ...row } : null;
    };
  }, books);
  if (extraInit) await page.addInitScript(extraInit);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await expect(page.locator("#booksCard")).toBeVisible();
}

async function enableStockSchema(page) {
  await page.evaluate(() => {
    const spec = window.KUTADGU_BOOKS_SCHEMA || { optionalColumns: {} };
    spec.optionalColumns = spec.optionalColumns || {};
    spec.optionalColumns.stock = true;
    spec.optionalColumns.stock_status = false;
    window.KUTADGU_BOOKS_SCHEMA = spec;
    window.__kutadguAdminTest.applyBooksSchema();
    window.__kutadguAdminTest.refreshPreviewBooks();
  });
}

test.describe("admin stock foundation", () => {
  test("Admin remains usable when stock schema column is absent", async ({ page }) => {
    await openAdminBooks(page);
    await expect(page.locator("#newBookBtn")).toBeVisible();
    await expect(page.locator("#bookStock")).toBeHidden();
    await expect(page.locator("#quickStock")).toBeHidden();
    await expect(page.locator('[data-problem-filter="missing_stock"]')).toBeHidden();
    await expect(page.locator("#adminUnconfiguredStock")).toBeHidden();
    await expect(page.locator("#adminBookList article")).toHaveCount(BOOKS.length);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await page.locator("#bookTitle").fill("Stockless Create");
    await page.locator("#bookAuthor").fill("Author");
    await page.locator("#bookPrice").fill("15");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookForm button[type='submit']").click();
    const saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves).toHaveLength(1);
    expect(saves[0].payload).not.toHaveProperty("stock");
    expect(saves[0].payload).not.toHaveProperty("stock_status");
    expect(saves[0].payload.title).toBe("Stockless Create");
  });

  test("Admin exposes stock when schema column exists and keeps NULL blank", async ({ page }) => {
    await openAdminBooks(page);
    await enableStockSchema(page);
    await expect(page.locator('[data-problem-filter="missing_stock"]')).toBeVisible();
    await expect(page.locator("#adminUnconfiguredStock")).toBeVisible();
    await expect(page.locator("#adminUnconfiguredStock")).toHaveText("ئامبار سانى تەڭشەلمىگەن: 1");
    await expect(page.locator("#bookStockStatus")).toBeHidden();
    await expect(page.locator('article[data-book-id="1"] .admin-book-meta').first()).toContainText("تەڭشەلمىگەن");
    await expect(page.locator('article[data-book-id="2"] .admin-book-meta').first()).toContainText("تۈگەپ كەتتى");
    await expect(page.locator('article[data-book-id="3"] .admin-book-meta').first()).toContainText("ئاز قالدى");
    await expect(page.locator('article[data-book-id="4"] .admin-book-meta').first()).toContainText("ئامباردا بار");

    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookStock")).toBeVisible();
    await expect(page.locator("#bookStock")).toHaveValue("");
    await expect(page.locator("#bookStockDerivedStatus")).toHaveText("ئامبار ھالىتى: تەڭشەلمىگەن");
    await page.locator("#cancelBookEdit").click();

    await page.locator('article[data-book-id="2"] [data-edit]').click();
    await expect(page.locator("#bookStock")).toHaveValue("0");
    await expect(page.locator("#bookStockDerivedStatus")).toHaveText("ئامبار ھالىتى: تۈگەپ كەتتى");
    await page.locator("#cancelBookEdit").click();
  });

  test("blank stock saves NULL; exact integer saves exact quantity; invalid values are rejected", async ({ page }) => {
    await openAdminBooks(page);
    await enableStockSchema(page);

    await page.locator('article[data-book-id="1"] [data-quick-edit]').click();
    await expect(page.locator("#quickEditModal")).toBeVisible();
    await expect(page.locator("#quickStock")).toHaveValue("");
    await expect(page.locator("#quickStockDerivedStatus")).toHaveText("ئامبار ھالىتى: تەڭشەلمىگەن");
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditStatus")).toContainText("ساقلاندى");
    let patches = await page.evaluate(() => window.__kutadguQuickPatches.slice());
    expect(patches).toHaveLength(1);
    expect(patches[0].patch.stock).toBeNull();
    expect(patches[0].patch).not.toHaveProperty("stock_status");

    await page.locator("#quickStock").fill("12");
    await expect(page.locator("#quickStockDerivedStatus")).toHaveText("ئامبار ھالىتى: ئامباردا بار");
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditStatus")).toContainText("ساقلاندى");
    patches = await page.evaluate(() => window.__kutadguQuickPatches.slice());
    expect(patches[patches.length - 1].patch.stock).toBe(12);

    await page.locator("#quickStock").fill("-1");
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditError")).toBeVisible();
    await page.locator("#quickStock").fill("1.5");
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditError")).toBeVisible();
    await page.locator("#quickEditCancel").click();

    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await page.locator("#bookStock").fill("7");
    await expect(page.locator("#bookStockDerivedStatus")).toHaveText("ئامبار ھالىتى: ئامباردا بار");
    await page.locator("#bookForm button[type='submit']").click();
    const saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves.some((s) => s.payload.stock === 7)).toBeTruthy();
    expect(saves.every((s) => !("stock_status" in s.payload))).toBeTruthy();
  });

  test("stock-not-configured filter and indicator follow NULL stock", async ({ page }) => {
    await openAdminBooks(page);
    await enableStockSchema(page);
    await page.locator('[data-problem-filter="missing_stock"]').click();
    await expect(page.locator("#adminBookList article")).toHaveCount(1);
    await expect(page.locator('article[data-book-id="1"]')).toBeVisible();
    await expect(page.locator('article[data-book-id="2"]')).toHaveCount(0);
  });
});
