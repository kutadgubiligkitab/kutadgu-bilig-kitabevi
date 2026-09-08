const { test, expect } = require("./playwright-test");

const BOOKS = [
  {
    id: 1,
    title: "Color Print Book",
    author: "Author A",
    price: 40,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/a.webp",
    is_active: true,
    is_recommended: false,
    is_new: false,
    is_color_print: true,
    sales_count: 1,
    isbn: "9781111111111",
    description: "desc"
  },
  {
    id: 2,
    title: "Normal Book",
    author: "Author B",
    price: 20,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/b.webp",
    is_active: true,
    is_recommended: false,
    is_new: false,
    is_color_print: false,
    sales_count: 0,
    isbn: "9782222222222",
    description: "desc"
  },
  {
    id: 3,
    title: "Legacy Book",
    author: "Author C",
    price: 15,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/c.webp",
    is_active: true,
    is_recommended: false,
    is_new: false,
    sales_count: 0,
    isbn: "9783333333333",
    description: "desc"
  }
];

async function openAdminBooks(page, extraInit) {
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = rows;
    window.__kutadguBookSaves = [];
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      return { error: null, data: [{ id }] };
    };
    window.__kutadguAdminFetchBook = async (id) => {
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      return row ? { ...row } : null;
    };
  }, BOOKS);
  if (extraInit) await page.addInitScript(extraInit);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
}

async function enableColorPrintSchema(page) {
  await page.evaluate(() => {
    const spec = window.KUTADGU_BOOKS_SCHEMA || { optionalColumns: {} };
    spec.optionalColumns = spec.optionalColumns || {};
    spec.optionalColumns.is_color_print = true;
    window.KUTADGU_BOOKS_SCHEMA = spec;
    window.__kutadguAdminTest.applyBooksSchema();
  });
}

test.describe("optional book color-print flag", () => {
  test("Admin stays usable and omits is_color_print when the column is unsupported", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookIsColorPrint")).toBeHidden();
    await page.locator("#bookTitle").fill("No Color Column");
    await page.locator("#bookAuthor").fill("Author");
    await page.locator("#bookPrice").fill("18");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookForm button[type='submit']").click();
    const saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves).toHaveLength(1);
    expect(saves[0].payload).not.toHaveProperty("is_color_print");
    expect(saves[0].payload.title).toBe("No Color Column");
    expect(saves[0].payload).toHaveProperty("is_new", false);
    expect(saves[0].payload).toHaveProperty("is_recommended", false);
    expect(saves[0].payload).toHaveProperty("is_active", true);
    expect(saves[0].payload).not.toHaveProperty("stock");
  });

  test("new Admin form defaults unchecked and saves true/false", async ({ page }) => {
    await openAdminBooks(page);
    await enableColorPrintSchema(page);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookIsColorPrint")).toBeVisible();
    await expect(page.locator("#bookIsColorPrint")).not.toBeChecked();
    await expect(page.locator('[data-book-col="is_color_print"]').first()).toContainText("ئىچكى بەتلىرى رەڭلىك");
    await expect(page.locator("text=پەقەت رەڭلىك نەشر بولسا تاللاڭ")).toBeVisible();
    await expect(page.locator("#bookForm")).not.toContainText("رەڭسىز");
    await page.screenshot({ path: "/opt/cursor/artifacts/admin-color-print-checkbox.png", fullPage: false });

    await page.locator("#bookTitle").fill("Color Edition");
    await page.locator("#bookAuthor").fill("Author");
    await page.locator("#bookPrice").fill("55");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookIsColorPrint").check();
    await page.locator("#bookForm button[type='submit']").click();
    const checked = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(checked).toHaveLength(1);
    expect(checked[0].payload.is_color_print).toBe(true);
    expect(checked[0].payload.price).toBe(55);
    expect(checked[0].payload).toHaveProperty("is_new", false);
    expect(checked[0].payload).toHaveProperty("is_recommended", false);

    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookIsColorPrint")).not.toBeChecked();
    await page.locator("#bookTitle").fill("Normal Edition");
    await page.locator("#bookAuthor").fill("Author");
    await page.locator("#bookPrice").fill("25");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookForm button[type='submit']").click();
    const all = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(all).toHaveLength(2);
    expect(all[1].payload.is_color_print).toBe(false);
    expect(all[1].payload.price).toBe(25);
  });

  test("editing hydrates checked only when is_color_print is true", async ({ page }) => {
    await openAdminBooks(page);
    await enableColorPrintSchema(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookIsColorPrint")).toBeChecked();
    await page.locator("#cancelBookEdit").click();

    await page.locator('article[data-book-id="2"] [data-edit]').click();
    await expect(page.locator("#bookIsColorPrint")).not.toBeChecked();
    await page.locator("#cancelBookEdit").click();

    await page.locator('article[data-book-id="3"] [data-edit]').click();
    await expect(page.locator("#bookIsColorPrint")).not.toBeChecked();
  });

  test("public detail shows رەڭلىك only when true; cards never gain a color badge", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.kutadguShop, { timeout: 30_000 });
    const out = await page.evaluate(() => {
      const Shop = window.kutadguShop;
      const trueBook = Shop.normalizeCatalogBook({
        id: "1", title: "T", author: "A", category: "C", source: "universal.html",
        is_color_print: true, price: 10
      }, 0, true);
      const falseBook = Shop.normalizeCatalogBook({
        id: "2", title: "T", author: "A", category: "C", source: "universal.html",
        is_color_print: false, price: 10
      }, 0, true);
      const missing = Shop.normalizeCatalogBook({
        id: "3", title: "T", author: "A", category: "C", source: "universal.html", price: 10
      }, 0, true);
      const nulled = Shop.normalizeCatalogBook({
        id: "4", title: "T", author: "A", category: "C", source: "universal.html",
        is_color_print: null, price: 10
      }, 0, true);
      return {
        trueFlag: trueBook.isColorPrint,
        falseFlag: falseBook.isColorPrint,
        missingFlag: missing.isColorPrint,
        nullFlag: nulled.isColorPrint,
        trueHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(trueBook)),
        falseHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(falseBook)),
        missingHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(missing)),
        nullHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(nulled)),
        listing: Shop.bookCardMarkup(trueBook),
        home: Shop.homeFeatureCard(trueBook)
      };
    });
    expect(out.trueFlag).toBe(true);
    expect(out.falseFlag).toBe(false);
    expect(out.missingFlag).toBe(false);
    expect(out.nullFlag).toBe(false);
    expect(out.trueHtml).toContain("رەڭلىك");
    expect(out.trueHtml).toContain("ئىچكى بېسىلىشى");
    expect(out.falseHtml).toBe("");
    expect(out.missingHtml).toBe("");
    expect(out.nullHtml).toBe("");
    expect(out.listing).not.toContain("رەڭلىك");
    expect(out.listing).not.toContain("ئىچكى بېسىلىشى");
    expect(out.home).not.toContain("رەڭلىك");
    expect(out.home).not.toContain("ئىچكى بېسىلىشى");
  });
});
