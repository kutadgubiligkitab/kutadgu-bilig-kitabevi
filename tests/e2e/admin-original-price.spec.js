const { test, expect } = require("@playwright/test");

const BASE = [
  {id:1,title:"كىتاب A",author:"Author A",price:135,original_price:100,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/a.webp",is_active:true,is_recommended:false,is_new:false,stock:3,stock_status:"in_stock",sales_count:5,legacy_id:"leg-1",created_at:"2026-01-01",isbn:"9781111111111",description:"desc"},
  {id:2,title:"Beta Book",author:"Author B",price:200,original_price:200,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/b.webp",is_active:true,is_recommended:false,is_new:false,stock:1,stock_status:"in_stock",sales_count:0,legacy_id:"leg-2",created_at:"2026-01-02",isbn:"9782222222222",description:"desc"},
  {id:3,title:"Gamma Book",author:"Author C",price:20,original_price:15,source:"romanlar.html",category:"رومانلار",image_url:"https://cdn.example/c.webp",is_active:true,is_recommended:false,is_new:false,stock:2,stock_status:"in_stock",sales_count:1,legacy_id:"leg-3",created_at:"2026-01-03",isbn:"9783333333333",description:"desc"},
  {id:4,title:"Zero Original",author:"Author D",price:10,original_price:0,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/d.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"4",description:"d"},
  {id:5,title:"Missing Original",author:"Author E",price:0,original_price:null,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/e.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"5",description:"d"}
];

function extraBooks() {
  const rows = [];
  for (let i = 6; i <= 45; i += 1) {
    rows.push({
      id: i,
      title: `Catalog ${i}`,
      author: "Author",
      price: 12,
      original_price: 10,
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
    window.__kutadguResetCalls = [];
    window.__kutadguResetFetches = [];
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
    window.__kutadguAdminBulkResetUpdateOne = async (id, patch) => {
      window.__kutadguResetCalls.push({ id: String(id), patch });
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      if (row) row.price = patch.price;
      return { error: null };
    };
    window.__kutadguAdminFetchResetTargets = async (settings) => {
      window.__kutadguResetFetches.push({
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
    window.__kutadguAdminFetchPriceTargets = async (settings) => {
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

test.describe("admin original price reset", () => {
  test("selected reset previews current to original and writes only after confirm", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator('article[data-book-id="4"] [data-select]').check();
    await page.locator("#bulkResetOpenBtn").click();
    await expect(page.locator("#bulkResetModal")).toBeVisible();
    await page.locator('input[name="bulkResetScope"][value="selected"]').check();
    await page.locator("#bulkResetPreviewBtn").click();
    await expect(page.locator("#bulkResetSummary")).toContainText("نىشان: 2");
    await expect(page.locator("#bulkResetPreviewList")).toContainText("135 ₺");
    await expect(page.locator("#bulkResetPreviewList")).toContainText("100 ₺");
    await expect(page.locator("#bulkResetPreviewList")).toContainText("0 ₺");
    expect(await page.evaluate(() => window.__kutadguResetCalls.slice())).toEqual([]);
    await page.locator("#bulkResetConfirmBtn").click();
    await expect(page.locator("#adminBulkResult")).toContainText("2 كىتابنىڭ باھاسى يېڭىلاندى");
    const calls = await page.evaluate(() => window.__kutadguResetCalls.slice());
    expect(calls.map((c) => c.id).sort()).toEqual(["1", "4"]);
    expect(calls.every((c) => Object.keys(c.patch).join() === "price")).toBeTruthy();
    expect(calls.map((c) => c.patch.price).sort((a, b) => a - b)).toEqual([0, 100]);
    await expect(page.locator('article[data-book-id="1"] .admin-book-meta').first()).toContainText("100");
  });

  test("NULL original_price is skipped and never guessed", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="5"] [data-select]').check();
    await page.locator("#bulkResetOpenBtn").click();
    await page.locator('input[name="bulkResetScope"][value="selected"]').check();
    await page.locator("#bulkResetPreviewBtn").click();
    await expect(page.locator("#bulkResetSummary")).toContainText("ئەسلى باھا يوق: 1");
    await expect(page.locator("#bulkResetPreviewList")).toContainText("ئەسلى باھا يوق");
    await expect(page.locator("#bulkResetConfirmBtn")).toBeDisabled();
    expect(await page.evaluate(() => window.__kutadguResetCalls.slice())).toEqual([]);
  });

  test("category and all-books reset scopes are not limited to the current page", async ({ page }) => {
    await openAdminBooks(page, [...BASE, ...extraBooks()]);
    await page.locator("#bulkResetOpenBtn").click();
    await page.locator('input[name="bulkResetScope"][value="category"]').check();
    await page.locator("#bulkResetCategory").selectOption("romanlar.html");
    await page.locator("#bulkResetPreviewBtn").click();
    await expect(page.locator("#bulkResetSummary")).toContainText("نىشان: 1");
    await expect(page.locator("#bulkResetPreviewList")).toContainText("20 ₺");
    await expect(page.locator("#bulkResetPreviewList")).toContainText("15 ₺");

    await page.locator('input[name="bulkResetScope"][value="all"]').check();
    await expect(page.locator("#bulkResetConfirmBtn")).toBeDisabled();
    await page.locator("#bulkResetPreviewBtn").click();
    await expect(page.locator("#bulkResetSummary")).toContainText("نىشان: 45");
    const fetch = await page.evaluate(() => window.__kutadguResetFetches.slice(-1)[0]);
    expect(fetch.scope).toBe("all");
    expect(fetch.masterCount).toBe(45);
    expect(fetch.masterCount).toBeGreaterThan(40);
  });

  test("all-books first confirm opens high-risk typed count and does not write", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#bulkResetOpenBtn").click();
    await page.locator('input[name="bulkResetScope"][value="all"]').check();
    await page.locator("#bulkResetPreviewBtn").click();
    await page.locator("#bulkResetConfirmBtn").click();
    await expect(page.locator("#bulkResetHighRiskModal")).toBeVisible();
    expect(await page.evaluate(() => window.__kutadguResetCalls.slice())).toEqual([]);
    await expect(page.locator("#bulkResetHighRiskConfirmBtn")).toBeDisabled();
    await page.locator("#bulkResetHighRiskCount").fill("3");
    await expect(page.locator("#bulkResetHighRiskConfirmBtn")).toBeEnabled();
  });

  test("20+ resettable books require typed count before write", async ({ page }) => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: 200 + i,
      title: `Reset ${i}`,
      author: "Author",
      price: 12,
      original_price: 10,
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
    await page.locator("#bulkResetOpenBtn").click();
    await page.locator('input[name="bulkResetScope"][value="category"]').check();
    await page.locator("#bulkResetCategory").selectOption("hekayiler.html");
    await page.locator("#bulkResetPreviewBtn").click();
    await expect(page.locator("#bulkResetSummary")).toContainText("قايتۇرۇلىدۇ: 20");
    await page.locator("#bulkResetConfirmBtn").click();
    await expect(page.locator("#bulkResetHighRiskModal")).toBeVisible();
    await page.locator("#bulkResetHighRiskCount").fill("19");
    await expect(page.locator("#bulkResetHighRiskConfirmBtn")).toBeDisabled();
    await page.locator("#bulkResetHighRiskCount").fill("20");
    await page.locator("#bulkResetHighRiskConfirmBtn").click();
    await expect(page.locator("#adminBulkResult")).toContainText("20 كىتابنىڭ باھاسى يېڭىلاندى");
    const calls = await page.evaluate(() => window.__kutadguResetCalls.slice());
    expect(calls).toHaveLength(20);
    expect(calls.every((c) => c.patch.price === 10 && !("original_price" in c.patch))).toBeTruthy();
  });

  test("changing scope after preview cannot apply", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#bulkResetOpenBtn").click();
    await page.locator('input[name="bulkResetScope"][value="all"]').check();
    await page.locator("#bulkResetPreviewBtn").click();
    await page.locator("#bulkResetConfirmBtn").click();
    await expect(page.locator("#bulkResetHighRiskModal")).toBeVisible();
    await page.locator("#bulkResetHighRiskCount").fill("3");
    await page.evaluate(() => {
      const el = document.querySelector('input[name="bulkResetScope"][value="category"]');
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.locator("#bulkResetHighRiskModal")).toBeHidden();
    await expect(page.locator("#bulkResetConfirmBtn")).toBeDisabled();
    expect(await page.evaluate(() => window.__kutadguResetCalls.slice())).toEqual([]);
  });

  test("admin book form shows original price as status, not a second input", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookOriginalPriceStatus")).toContainText("ئەسلى باھا");
    await expect(page.locator("#bookOriginalPriceStatus")).toContainText("100");
    await expect(page.locator("#bookPrice")).toBeVisible();
    await expect(page.locator("#bookOriginalPrice")).toHaveCount(0);
    await page.locator("#cancelBookEdit").click();
    await page.locator('article[data-book-id="5"] [data-edit]').click();
    await expect(page.locator("#bookOriginalPriceStatus")).toHaveText("ئەسلى باھا تېخى ساقلانمىغان");
  });

  test("normal bulk price change still writes price only", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator("#bulkPriceOpenBtn").click();
    await page.locator('input[name="bulkPriceScope"][value="selected"]').check();
    await page.locator("#bulkPriceOperation").selectOption("pct_inc");
    await page.locator("#bulkPriceAmount").fill("20");
    await page.locator("#bulkPricePreviewBtn").click();
    await page.locator("#bulkPriceConfirmBtn").click();
    const calls = await page.evaluate(() => window.__kutadguPriceCalls.slice());
    expect(calls).toHaveLength(1);
    expect(calls[0].patch).toEqual({ price: 162 });
    expect(await page.evaluate(() => {
      const row = window.__kutadguAdminPreviewBooks.find((b) => String(b.id) === "1");
      return row.original_price;
    })).toBe(100);
    expect(await page.evaluate(() => window.__kutadguResetCalls.slice())).toEqual([]);
  });

  test("existing quick edit and bulk edit still work", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-quick-edit]').click();
    await expect(page.locator("#quickEditModal")).toBeVisible();
    await page.locator("#quickTitle").fill("Alpha Saved");
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditStatus")).toContainText("ساقلاندى");
    const quick = await page.evaluate(() => window.__kutadguQuickPatches.slice());
    expect(quick[0].patch.original_price).toBeUndefined();
    await page.locator("#quickEditCancel").click();
    await page.locator('article[data-book-id="2"] [data-select]').check();
    await page.locator("#bulkAction").selectOption("recommended_on");
    await page.locator("#bulkApplyBtn").click();
    await page.locator("#bulkConfirmOk").click();
    await expect(page.locator("#adminBulkResult")).toContainText("1 يېڭىلاندى");
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
  ]) {
    test(`responsive ${viewport.width} keeps reset preview readable`, async ({ page }) => {
      await openAdminBooks(page);
      await page.setViewportSize(viewport);
      await page.locator("#bulkResetOpenBtn").click();
      await expect(page.locator("#bulkResetModal")).toBeVisible();
      await page.locator("#bulkResetPreviewBtn").click();
      await expect(page.locator("#bulkResetPreviewList")).toBeVisible();
      await expect(page.locator("#bulkResetConfirmBtn")).toBeVisible();
      await noOverflow(page);
    });
  }
});
