const { test, expect } = require("./playwright-test");

const BOOKS = [
  {
    id: 1,
    title: "Color Interior",
    author: "Author A",
    price: 40,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/a.webp",
    is_active: true,
    is_recommended: false,
    is_new: false,
    interior_print_type: "color",
    is_color_print: true,
    sales_count: 1,
    isbn: "9781111111111",
    description: "desc"
  },
  {
    id: 2,
    title: "BW Interior",
    author: "Author B",
    price: 20,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/b.webp",
    is_active: true,
    is_recommended: false,
    is_new: false,
    interior_print_type: "bw",
    is_color_print: false,
    sales_count: 0,
    isbn: "9782222222222",
    description: "desc"
  },
  {
    id: 3,
    title: "Unmarked Interior",
    author: "Author C",
    price: 15,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/c.webp",
    is_active: true,
    is_recommended: false,
    is_new: false,
    interior_print_type: null,
    is_color_print: false,
    sales_count: 0,
    isbn: "9783333333333",
    description: "desc"
  },
  {
    id: 4,
    title: "Legacy Color",
    author: "Author D",
    price: 18,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/d.webp",
    is_active: true,
    is_recommended: false,
    is_new: false,
    is_color_print: true,
    sales_count: 0,
    isbn: "9784444444444",
    description: "desc"
  }
];

async function openAdminBooks(page) {
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
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
}

async function enableInterior(page) {
  await page.evaluate(() => window.__kutadguAdminTest.enableInteriorPrintTypeColumn());
}

async function fillRequired(page, title) {
  await page.locator("#bookTitle").fill(title);
  await page.locator("#bookAuthor").fill("Author");
  await page.locator("#bookPrice").fill("33");
  await page.locator("#bookSource").selectOption("universal.html");
}

test.describe("optional 3-state interior print type", () => {
  test("missing DB column keeps the control hidden and omits it from save", async ({ page }) => {
    await openAdminBooks(page);
    const enabled = await page.evaluate(() => window.KUTADGU_BOOKS_SCHEMA?.optionalColumns?.interior_print_type);
    expect(enabled).toBe(false);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookInteriorPrintType")).toBeHidden();
    await fillRequired(page, "No Interior Column");
    await page.locator("#bookForm button[type='submit']").click();
    const saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves).toHaveLength(1);
    expect(saves[0].payload).not.toHaveProperty("interior_print_type");
    expect(saves[0].payload).not.toHaveProperty("is_color_print");
    expect(saves[0].payload.title).toBe("No Interior Column");
    expect(saves[0].payload.price).toBe(33);
    expect(saves[0].payload).not.toHaveProperty("stock");
  });

  test("Admin default is unselected; color, bw, and null save correctly", async ({ page }) => {
    await openAdminBooks(page);
    await enableInterior(page);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookInteriorPrintType")).toBeVisible();
    await expect(page.locator("#bookInteriorPrintType")).toHaveValue("");
    await expect(page.locator('[data-book-col="interior_print_type"]').first()).toContainText("ئىچكى بېسىلىشى");
    await expect(page.locator('[data-book-col="interior_print_type"]').first()).toContainText("ئىختىيارىي");
    await expect(page.locator("#bookInteriorPrintType")).toContainText("تاللانمىغان");
    await expect(page.locator("#bookInteriorPrintType")).toContainText("رەڭلىك");
    await expect(page.locator("#bookInteriorPrintType")).toContainText("رەڭسىز");
    await page.locator("#bookInteriorPrintType").scrollIntoViewIfNeeded();
    await page.locator('[data-book-col="interior_print_type"]').first().screenshot({
      path: "/opt/cursor/artifacts/admin-interior-print-type-select.png"
    });

    await fillRequired(page, "Color Edition");
    await page.locator("#bookInteriorPrintType").selectOption("color");
    await page.locator("#bookForm button[type='submit']").click();
    let saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves[0].payload.interior_print_type).toBe("color");
    expect(saves[0].payload.is_color_print).toBe(true);
    expect(saves[0].payload.price).toBe(33);

    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookInteriorPrintType")).toHaveValue("");
    await fillRequired(page, "BW Edition");
    await page.locator("#bookInteriorPrintType").selectOption("bw");
    await page.locator("#bookForm button[type='submit']").click();
    saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves[1].payload.interior_print_type).toBe("bw");
    expect(saves[1].payload.is_color_print).toBe(false);

    await page.locator("#newBookBtn").click();
    await page.locator("#bookInteriorPrintType").selectOption("bw");
    await page.locator("#bookInteriorPrintType").selectOption("");
    await expect(page.locator("#bookInteriorPrintType")).toHaveValue("");
    await fillRequired(page, "Unmarked Edition");
    await page.locator("#bookForm button[type='submit']").click();
    saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves[2].payload.interior_print_type).toBeNull();
    expect(saves[2].payload.is_color_print).toBe(false);
  });

  test("edit hydration: color, bw, null, legacy true, legacy false", async ({ page }) => {
    await openAdminBooks(page);
    await enableInterior(page);

    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookInteriorPrintType")).toHaveValue("color");
    await expect(page.locator("#bookInteriorPrintType option:checked")).toHaveText("رەڭلىك");
    await page.locator("#cancelBookEdit").click();

    await page.locator('article[data-book-id="2"] [data-edit]').click();
    await expect(page.locator("#bookInteriorPrintType")).toHaveValue("bw");
    await expect(page.locator("#bookInteriorPrintType option:checked")).toHaveText("رەڭسىز");
    await page.locator("#cancelBookEdit").click();

    await page.locator('article[data-book-id="3"] [data-edit]').click();
    await expect(page.locator("#bookInteriorPrintType")).toHaveValue("");
    await expect(page.locator("#bookInteriorPrintType option:checked")).toHaveText("تاللانمىغان");
    await page.locator("#cancelBookEdit").click();

    await page.locator('article[data-book-id="4"] [data-edit]').click();
    await expect(page.locator("#bookInteriorPrintType")).toHaveValue("color");
  });

  test("public detail shows color/bw and hides null; cards stay badge-free", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.kutadguShop, { timeout: 30_000 });
    const out = await page.evaluate(() => {
      const Shop = window.kutadguShop;
      const colorBook = Shop.normalizeCatalogBook({
        id: "1", title: "T", author: "A", category: "C", source: "universal.html",
        interior_print_type: "color", price: 10
      }, 0, true);
      const bwBook = Shop.normalizeCatalogBook({
        id: "2", title: "T", author: "A", category: "C", source: "universal.html",
        interior_print_type: "bw", price: 10
      }, 0, true);
      const none = Shop.normalizeCatalogBook({
        id: "3", title: "T", author: "A", category: "C", source: "universal.html", price: 10
      }, 0, true);
      const legacy = Shop.normalizeCatalogBook({
        id: "4", title: "T", author: "A", category: "C", source: "universal.html",
        is_color_print: true, price: 10
      }, 0, true);
      const legacyFalse = Shop.normalizeCatalogBook({
        id: "5", title: "T", author: "A", category: "C", source: "universal.html",
        is_color_print: false, price: 10
      }, 0, true);
      return {
        colorType: colorBook.interiorPrintType,
        bwType: bwBook.interiorPrintType,
        noneType: none.interiorPrintType,
        colorHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(colorBook)),
        bwHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(bwBook)),
        noneHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(none)),
        legacyHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(legacy)),
        legacyFalseHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(legacyFalse)),
        listing: Shop.bookCardMarkup(colorBook),
        home: Shop.homeFeatureCard(bwBook),
        fav: Shop.favoriteCard(colorBook)
      };
    });
    expect(out.colorType).toBe("color");
    expect(out.bwType).toBe("bw");
    expect(out.noneType).toBe("");
    expect(out.colorHtml).toContain("رەڭلىك");
    expect(out.colorHtml).toContain("ئىچكى بېسىلىشى");
    expect(out.bwHtml).toContain("رەڭسىز");
    expect(out.noneHtml).toBe("");
    expect(out.legacyHtml).toContain("رەڭلىك");
    expect(out.legacyFalseHtml).toBe("");
    expect(out.listing).not.toContain("رەڭلىك");
    expect(out.listing).not.toContain("ئىچكى بېسىلىشى");
    expect(out.home).not.toContain("رەڭسىز");
    expect(out.fav).not.toContain("رەڭلىك");
  });
});
