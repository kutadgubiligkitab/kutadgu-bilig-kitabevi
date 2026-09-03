const { test, expect } = require("@playwright/test");

const BASE = [
  {id:1,title:"Alpha Book",author:"Author A",price:100,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/a.webp",is_active:true,is_recommended:false,is_new:false,stock:3,stock_status:"in_stock",sales_count:5,legacy_id:"leg-1",created_at:"2026-01-01",isbn:"9781111111111",description:"desc"},
  {id:2,title:"Beta Book",author:"Author B",price:200,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/b.webp",is_active:true,is_recommended:false,is_new:false,stock:1,stock_status:"in_stock",sales_count:0,legacy_id:"leg-2",created_at:"2026-01-02",isbn:"9782222222222",description:"desc"},
  {id:3,title:"Gamma Book",author:"Author C",price:20,source:"romanlar.html",category:"رومانلار",image_url:"https://cdn.example/c.webp",is_active:true,is_recommended:false,is_new:false,stock:2,stock_status:"in_stock",sales_count:1,legacy_id:"leg-3",created_at:"2026-01-03",isbn:"9783333333333",description:"desc"},
  {id:4,title:"Zero Price",author:"Author D",price:0,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/d.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"4",description:"d"},
  {id:5,title:"No Price",author:"Author E",price:null,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/e.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"5",description:"d"}
];

function extraBooks() {
  const rows = [];
  for (let i = 6; i <= 45; i += 1) {
    rows.push({
      id: i,
      title: `Catalog ${i}`,
      author: "Author",
      price: 10,
      source: "universal.html",
      category: "ئۇنىۋېرسال",
      image_url: "https://cdn.example/x.webp",
      is_active: true,
      stock: 1,
      stock_status: "in_stock",
      sales_count: 0,
      isbn: String(i),
      description: "d"
    });
  }
  return rows;
}

async function openAdminBooks(page, books = BASE) {
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = rows;
    window.__kutadguQuickPatches = [];
    window.__kutadguBulkCalls = [];
    window.__kutadguPriceCalls = [];
    window.__kutadguPriceFetches = [];
    window.__kutadguAdminPersistQuick = async (id, patch) => {
      window.__kutadguQuickPatches.push({ id, patch });
      return { error: null };
    };
    window.__kutadguAdminBulkUpdateOne = async (id, patch) => {
      window.__kutadguBulkCalls.push({ id, patch });
      return { error: null };
    };
    window.__kutadguAdminBulkPriceUpdateOne = async (id, patch) => {
      window.__kutadguPriceCalls.push({ id: String(id), patch });
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      if (row) row.price = patch.price;
      return { error: null };
    };
    window.__kutadguAdminFetchPriceTargets = async (settings) => {
      window.__kutadguPriceFetches.push({
        scope: settings.scope,
        source: settings.source,
        selectedCount: (settings.selectedIds || []).length,
        masterCount: (window.__kutadguAdminPreviewBooks || []).length
      });
      return window.KutadguAdminBulkPrice.selectScopeBooks(
        window.__kutadguAdminPreviewBooks,
        settings
      ).books;
    };
  }, books);
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

test.describe("admin bulk price change", () => {
  test("selected books preview then confirm writes only after confirmation", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator('article[data-book-id="2"] [data-select]').check();
    await page.locator("#bulkPriceOpenBtn").click();
    await expect(page.locator("#bulkPriceModal")).toBeVisible();
    await page.locator('input[name="bulkPriceScope"][value="selected"]').check();
    await expect(page.locator("#bulkPriceSelectedHint")).toContainText("2");
    await page.locator("#bulkPriceOperation").selectOption("pct_inc");
    await page.locator("#bulkPriceAmount").fill("10");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceSummary")).toContainText("نىشان: 2");
    await expect(page.locator("#bulkPricePreviewList")).toContainText("100 ₺");
    await expect(page.locator("#bulkPricePreviewList")).toContainText("110 ₺");
    const before = await page.evaluate(() => window.__kutadguPriceCalls.slice());
    expect(before).toEqual([]);
    await page.locator("#bulkPriceConfirmBtn").click();
    await expect(page.locator("#adminBulkResult")).toContainText("2 كىتابنىڭ باھاسى يېڭىلاندى");
    const calls = await page.evaluate(() => window.__kutadguPriceCalls.slice());
    expect(calls.map((c) => c.id).sort()).toEqual(["1", "2"]);
    expect(calls.map((c) => c.patch.price).sort()).toEqual([110, 220]);
    await expect(page.locator('article[data-book-id="1"] .admin-book-meta').first()).toContainText("110");
  });

  test("zero selected disables selected scope preview", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="selected"]').check();
    await expect(page.locator("#bulkPricePreviewBtn")).toBeDisabled();
    await expect(page.locator("#bulkPriceSelectedHint")).toContainText("تاللانمىدى");
    await expect(page.locator("#bulkPriceConfirmBtn")).toBeDisabled();
  });

  test("category and all-books scopes are not limited to 40 page rows", async ({ page }) => {
    await openAdminBooks(page, [...BASE, ...extraBooks()]);
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="category"]').check();
    await page.locator("#bulkPriceCategory").selectOption("romanlar.html");
    await page.locator("#bulkPriceOperation").selectOption("fixed_inc");
    await page.locator("#bulkPriceAmount").fill("5");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceSummary")).toContainText("نىشان: 1");
    await expect(page.locator("#bulkPricePreviewList")).toContainText("20 ₺");
    await expect(page.locator("#bulkPricePreviewList")).toContainText("25 ₺");

    await page.locator('input[name="bulkPriceScope"][value="all"]').check();
    await page.locator("#bulkPriceOperation").selectOption("pct_inc");
    await page.locator("#bulkPriceAmount").fill("10");
    await expect(page.locator("#bulkPriceConfirmBtn")).toBeDisabled();
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceSummary")).toContainText("نىشان: 45");
    const fetch = await page.evaluate(() => window.__kutadguPriceFetches.slice(-1)[0]);
    expect(fetch.scope).toBe("all");
    expect(fetch.masterCount).toBe(45);
    expect(fetch.masterCount).toBeGreaterThan(40);
  });

  test("percentage decrease, fixed decrease, zero price and missing price", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="all"]').check();
    await page.locator("#bulkPriceOperation").selectOption("pct_dec");
    await page.locator("#bulkPriceAmount").fill("10");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPricePreviewList")).toContainText("90 ₺");
    await expect(page.locator("#bulkPricePreviewList")).toContainText("0 ₺");
    await expect(page.locator("#bulkPricePreviewList")).toContainText("ئۆتكۈزۈلدى");

    await page.locator("#bulkPriceOperation").selectOption("fixed_dec");
    await page.locator("#bulkPriceAmount").fill("25");
    await expect(page.locator("#bulkPriceConfirmBtn")).toBeDisabled();
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceError")).toContainText("مەنپىي");
    await expect(page.locator("#bulkPriceConfirmBtn")).toBeDisabled();
    const calls = await page.evaluate(() => window.__kutadguPriceCalls.slice());
    expect(calls).toEqual([]);
  });

  test("changing amount after preview requires a new preview", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="selected"]').check();
    await page.locator("#bulkPriceOperation").selectOption("fixed_inc");
    await page.locator("#bulkPriceAmount").fill("20");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceConfirmBtn")).toBeEnabled();
    await page.locator("#bulkPriceAmount").fill("30");
    await expect(page.locator("#bulkPriceConfirmBtn")).toBeDisabled();
  });

  test("all-books first confirm opens high-risk step and does not write", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="all"]').check();
    await page.locator("#bulkPriceOperation").selectOption("pct_inc");
    await page.locator("#bulkPriceAmount").fill("10");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceSummary")).toContainText("0 ₺ بولىدۇ: 1");
    await page.locator("#bulkPriceConfirmBtn").click();
    await expect(page.locator("#bulkPriceHighRiskModal")).toBeVisible();
    await expect(page.locator("#bulkPriceHighRiskText")).toContainText("بارلىق كىتابلار");
    const before = await page.evaluate(() => window.__kutadguPriceCalls.slice());
    expect(before).toEqual([]);
    await expect(page.locator("#bulkPriceHighRiskConfirmBtn")).toBeDisabled();
  });

  test("20+ category books require typed count before write", async ({ page }) => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: 200 + i,
      title: `Bulk ${i}`,
      author: "Author",
      price: 10,
      source: "hekayiler.html",
      category: "ھېكايىلەر",
      image_url: "https://cdn.example/x.webp",
      is_active: true,
      stock: 1,
      stock_status: "in_stock",
      sales_count: 0,
      isbn: String(200 + i),
      description: "d"
    }));
    await openAdminBooks(page, many);
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="category"]').check();
    await page.locator("#bulkPriceCategory").selectOption("hekayiler.html");
    await page.locator("#bulkPriceOperation").selectOption("fixed_inc");
    await page.locator("#bulkPriceAmount").fill("1");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceSummary")).toContainText("يېڭىلىنىدۇ: 20");
    await page.locator("#bulkPriceConfirmBtn").click();
    await expect(page.locator("#bulkPriceHighRiskModal")).toBeVisible();
    await page.locator("#bulkPriceHighRiskCount").fill("19");
    await expect(page.locator("#bulkPriceHighRiskConfirmBtn")).toBeDisabled();
    expect(await page.evaluate(() => window.__kutadguPriceCalls.slice())).toEqual([]);
    await page.locator("#bulkPriceHighRiskCount").fill("20");
    await expect(page.locator("#bulkPriceHighRiskConfirmBtn")).toBeEnabled();
    await page.locator("#bulkPriceHighRiskConfirmBtn").click();
    await expect(page.locator("#adminBulkResult")).toContainText("20 كىتابنىڭ باھاسى يېڭىلاندى");
    const calls = await page.evaluate(() => window.__kutadguPriceCalls.slice());
    expect(calls).toHaveLength(20);
  });

  test("zeroing non-zero prices shows warning and stronger all-zero warning", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator('article[data-book-id="3"] [data-select]').check();
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="selected"]').check();
    await page.locator("#bulkPriceOperation").selectOption("fixed_dec");
    await page.locator("#bulkPriceAmount").fill("20");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceZeroWarning")).toContainText("دىققەت");
    await expect(page.locator("#bulkPriceZeroWarning")).toContainText("1");

    await page.locator("#bulkPriceOperation").selectOption("pct_dec");
    await page.locator("#bulkPriceAmount").fill("100");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPriceZeroWarning")).toContainText("جىددىي ئاگاھلاندۇرۇش");
    await page.locator("#bulkPriceConfirmBtn").click();
    await expect(page.locator("#bulkPriceHighRiskModal")).toBeVisible();
    expect(await page.evaluate(() => window.__kutadguPriceCalls.slice())).toEqual([]);
    await page.locator("#bulkPriceHighRiskCount").fill("2");
    await page.locator("#bulkPriceHighRiskConfirmBtn").click();
    await expect(page.locator("#adminBulkResult")).toContainText("2 كىتابنىڭ باھاسى يېڭىلاندى");
  });

  test("changing settings closes high-risk confirmation without writing", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="all"]').check();
    await page.locator("#bulkPriceAmount").fill("10");
    await page.locator("#bulkPricePreviewBtn").click();
    await page.locator("#bulkPriceConfirmBtn").click();
    await expect(page.locator("#bulkPriceHighRiskModal")).toBeVisible();
    await page.locator("#bulkPriceHighRiskCount").fill("4");
    await page.locator("#bulkPriceAmount").fill("15");
    await expect(page.locator("#bulkPriceHighRiskModal")).toBeHidden();
    await expect(page.locator("#bulkPriceConfirmBtn")).toBeDisabled();
    expect(await page.evaluate(() => window.__kutadguPriceCalls.slice())).toEqual([]);
  });

  test("existing quick edit, bulk edit, and admin navigation still work", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-quick-edit]').click();
    await expect(page.locator("#quickEditModal")).toBeVisible();
    await page.locator("#quickTitle").fill("Alpha Saved");
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditStatus")).toContainText("ساقلاندى");
    await page.locator("#quickEditCancel").click();

    await page.locator('article[data-book-id="2"] [data-select]').check();
    await page.locator("#bulkAction").selectOption("recommended_on");
    await page.locator("#bulkApplyBtn").click();
    await page.locator("#bulkConfirmOk").click();
    await expect(page.locator("#adminBulkResult")).toContainText("1 يېڭىلاندى");
    const bulk = await page.evaluate(() => window.__kutadguBulkCalls.slice());
    expect(bulk).toHaveLength(1);

    await page.locator('[data-admin-section="overview"]').click();
    await expect(page.locator("#overviewSection")).toBeVisible();
    await expect(page.locator("#booksCard")).toBeHidden();
    await page.locator('[data-admin-section="books"]').click();
    await expect(page.locator("#booksCard")).toBeVisible();
    await expect(page.locator("#bulkPriceOpenBtn")).toBeVisible();
  });

  test("login gate still hides bulk price without skip-auth", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#bulkPriceModal")).toBeHidden();
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
  ]) {
    test(`responsive ${viewport.width} keeps bulk price usable`, async ({ page }) => {
      await openAdminBooks(page);
      await page.setViewportSize(viewport);
      await page.locator("#bulkPriceOpenBtn").click();
      await expect(page.locator("#bulkPriceModal")).toBeVisible();
      await page.locator("#bulkPriceAmount").fill("10");
      await page.locator("#bulkPricePreviewBtn").click();
      await expect(page.locator("#bulkPricePreviewList")).toBeVisible();
      await expect(page.locator("#bulkPriceConfirmBtn")).toBeVisible();
      await noOverflow(page);
    });
  }
});
