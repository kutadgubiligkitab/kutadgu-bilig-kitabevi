const { test, expect } = require("./playwright-test");

const FIXTURES = [
  {id:1,title:"Alpha Book",author:"Author A",price:10,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/a.webp",is_active:true,is_recommended:false,is_new:false,stock:3,stock_status:"in_stock",sales_count:5,legacy_id:"leg-1",created_at:"2026-01-01",isbn:"9781111111111",description:"desc"},
  {id:2,title:"Beta Book",author:"Author B",price:12,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/b.webp",is_active:true,is_recommended:false,is_new:false,stock:1,stock_status:"in_stock",sales_count:0,legacy_id:"leg-2",created_at:"2026-01-02",isbn:"9782222222222",description:"desc"},
  {id:3,title:"Gamma Book",author:"Author C",price:8,source:"romanlar.html",category:"رومانلار",image_url:"https://cdn.example/c.webp",is_active:true,is_recommended:false,is_new:false,stock:2,stock_status:"in_stock",sales_count:1,legacy_id:"leg-3",created_at:"2026-01-03",isbn:"9783333333333",description:"desc"},
  {id:4,title:"",author:"Author D",price:9,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/d.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"1",description:"d"},
  {id:5,title:"No Author",author:"ئاپتور ئىسمى",price:8,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/e.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"2",description:"d"},
  {id:6,title:"No Cat",author:"Author F",price:5,source:"",category:"",image_url:"https://cdn.example/f.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"3",description:"d"},
  {id:7,title:"No Price",author:"Author G",price:null,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/g.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"4",description:"d"},
  {id:8,title:"Zero Price",author:"Author H",price:0,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/h.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"5",description:"d"},
  {id:9,title:"No Cover",author:"Author I",price:4,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"sample-book-cover.png",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"6",description:"d"},
  {id:10,title:"Hidden Book",author:"Author J",price:4,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/j.webp",is_active:false,stock:1,stock_status:"in_stock",sales_count:9,isbn:"7",description:"d"},
  {id:11,title:"No Stock",author:"Author K",price:4,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/k.webp",is_active:true,stock:null,stock_status:"",sales_count:0,isbn:"8",description:"d"}
];

async function openAdminBooks(page, extraInit) {
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = books;
    window.__kutadguQuickPatches = [];
    window.__kutadguBulkCalls = [];
    window.__kutadguAdminPersistQuick = async (id, patch) => {
      window.__kutadguQuickPatches.push({ id, patch });
      if (window.__kutadguQuickFail) return { error: new Error("save failed") };
      return { error: null };
    };
    window.__kutadguAdminBulkUpdateOne = async (id, patch) => {
      window.__kutadguBulkCalls.push({ id, patch });
      if (window.__kutadguBulkFailIds && window.__kutadguBulkFailIds.includes(String(id))) {
        return { error: new Error("row failed") };
      }
      return { error: null };
    };
  }, FIXTURES);
  if (extraInit) await page.addInitScript(extraInit);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await expect(page.locator("#booksCard")).toBeVisible();
  await page.evaluate(() => {
    const spec = window.KUTADGU_BOOKS_SCHEMA || { optionalColumns: {} };
    spec.optionalColumns = spec.optionalColumns || {};
    spec.optionalColumns.stock = true;
    spec.optionalColumns.stock_status = true;
    window.KUTADGU_BOOKS_SCHEMA = spec;
    window.__kutadguAdminTest.applyBooksSchema();
  });
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

test.describe("admin catalog productivity", () => {
  test("login gate still hides books without skip-auth", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#quickEditModal")).toBeHidden();
  });

  test("quick edit opens prefills cancel does not persist and save patches intended fields", async ({ page }) => {
    await openAdminBooks(page);
    const row = page.locator('article[data-book-id="1"]');
    await row.locator("[data-quick-edit]").click();
    await expect(page.locator("#quickEditModal")).toBeVisible();
    await expect(page.locator("#quickTitle")).toHaveValue("Alpha Book");
    await expect(page.locator("#quickAuthor")).toHaveValue("Author A");
    await expect(page.locator("#quickPrice")).toHaveValue("10");
    await page.locator("#quickTitle").fill("Alpha Edited");
    await page.locator("#quickEditCancel").click();
    await expect(page.locator("#quickEditModal")).toBeHidden();
    const afterCancel = await page.evaluate(() => window.__kutadguQuickPatches.slice());
    expect(afterCancel).toEqual([]);
    await expect(row.locator(".admin-book-title")).toHaveText("Alpha Book");

    await row.locator("[data-quick-edit]").click();
    await page.locator("#quickTitle").fill("Alpha Saved");
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditStatus")).toContainText("ساقلاندى");
    const patches = await page.evaluate(() => window.__kutadguQuickPatches);
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe("1");
    expect(patches[0].patch.title).toBe("Alpha Saved");
    expect(patches[0].patch).not.toHaveProperty("id");
    expect(patches[0].patch).not.toHaveProperty("legacy_id");
    expect(patches[0].patch).not.toHaveProperty("sales_count");
    expect(patches[0].patch).not.toHaveProperty("created_at");
    await expect(row.locator(".admin-book-title")).toHaveText("Alpha Saved");
    await page.locator("#quickEditCancel").click();
    await expect(row.locator("[data-quick-edit]")).toBeFocused();
  });

  test("quick edit failure stays visible as text", async ({ page }) => {
    await openAdminBooks(page);
    await page.evaluate(() => { window.__kutadguQuickFail = true; });
    await page.locator('article[data-book-id="1"] [data-quick-edit]').click();
    await page.locator("#quickEditSave").click();
    await expect(page.locator("#quickEditError")).toBeVisible();
    await expect(page.locator("#quickEditError")).toContainText("مەغلۇپ");
    await expect(page.locator("#quickEditModal")).toBeVisible();
  });

  test("bulk selection select page and clear", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await expect(page.locator("#adminSelectedCount")).toContainText("تاللانغان: 1");
    await page.locator('article[data-book-id="2"] [data-select]').check();
    await expect(page.locator("#adminSelectedCount")).toContainText("تاللانغان: 2");
    await page.locator("#selectPageBtn").click();
    const visible = await page.locator("#adminBookList article").count();
    await expect(page.locator("#adminSelectedCount")).toContainText(`تاللانغان: ${visible}`);
    await page.locator("#clearSelectionBtn").click();
    await expect(page.locator("#adminSelectedCount")).toContainText("تاللانغان: 0");
  });

  test("bulk edit requires confirmation and only updates selected rows", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator('article[data-book-id="2"] [data-select]').check();
    await page.locator("#bulkAction").selectOption("recommended_on");
    await page.locator("#bulkApplyBtn").click();
    await expect(page.locator("#bulkConfirmModal")).toBeVisible();
    await expect(page.locator("#bulkConfirmText")).toContainText("2");
    await expect(page.locator("#bulkConfirmText")).toContainText("تەۋسىيە");
    await page.locator("#bulkConfirmCancel").click();
    const none = await page.evaluate(() => window.__kutadguBulkCalls.slice());
    expect(none).toEqual([]);
    await page.locator("#bulkApplyBtn").click();
    await page.locator("#bulkConfirmOk").click();
    await expect(page.locator("#adminBulkResult")).toContainText("2 يېڭىلاندى");
    const calls = await page.evaluate(() => window.__kutadguBulkCalls);
    expect(calls.map((c) => String(c.id)).sort()).toEqual(["1", "2"]);
    expect(calls.every((c) => c.patch.is_recommended === true)).toBeTruthy();
    expect(calls.every((c) => !("sales_count" in c.patch) && !("legacy_id" in c.patch))).toBeTruthy();
    await expect(page.locator('article[data-book-id="3"] .admin-status-badge-recommended')).toHaveCount(0);
  });

  test("bulk partial failure is reported and keeps failed selection", async ({ page }) => {
    await openAdminBooks(page);
    await page.evaluate(() => { window.__kutadguBulkFailIds = ["2"]; });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator('article[data-book-id="2"] [data-select]').check();
    await page.locator("#bulkAction").selectOption("activate");
    await page.locator("#bulkApplyBtn").click();
    await page.locator("#bulkConfirmOk").click();
    await expect(page.locator("#adminBulkResult")).toContainText("1 يېڭىلاندى");
    await expect(page.locator("#adminBulkResult")).toContainText("1 مەغلۇپ");
    await expect(page.locator('article[data-book-id="2"] [data-select]')).toBeChecked();
    await expect(page.locator('article[data-book-id="1"] [data-select]')).not.toBeChecked();
  });

  test("problem filters return fixture rows combine with search and clear", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('[data-problem-filter="missing_title"]').click();
    await expect(page.locator("#adminBookList article")).toHaveCount(1);
    await expect(page.locator('article[data-book-id="4"]')).toBeVisible();

    await page.locator('[data-problem-filter="missing_author"]').click();
    await expect(page.locator('article[data-book-id="5"]')).toBeVisible();
    await expect(page.locator("#adminBookList article")).toHaveCount(1);

    await page.locator('[data-problem-filter="missing_category"]').click();
    await expect(page.locator('article[data-book-id="6"]')).toBeVisible();

    await page.locator('[data-problem-filter="missing_price"]').click();
    await expect(page.locator('article[data-book-id="7"]')).toBeVisible();
    await expect(page.locator('article[data-book-id="8"]')).toHaveCount(0);

    await page.locator('[data-problem-filter="missing_cover"]').click();
    await expect(page.locator('article[data-book-id="9"]')).toBeVisible();

    await page.locator('[data-problem-filter="inactive"]').click();
    await expect(page.locator('article[data-book-id="10"]')).toBeVisible();

    await page.locator('[data-problem-filter="missing_stock"]').click();
    await expect(page.locator('article[data-book-id="11"]')).toBeVisible();

    await page.locator('[data-problem-filter="missing_stock_status"]').click();
    await expect(page.locator('article[data-book-id="11"]')).toBeVisible();

    await page.locator('[data-problem-filter="missing_cover"]').click();
    await page.locator("#adminSearch").fill("Cover");
    await expect.poll(async () => page.locator("#adminBookList article").count()).toBe(1);

    await page.locator('[data-problem-filter=""]').click();
    await page.locator("#adminSearch").fill("");
    await expect.poll(async () => page.locator("#adminBookList article").count()).toBe(FIXTURES.length);
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
  ]) {
    test(`responsive ${viewport.width}x${viewport.height} keeps productivity UI usable`, async ({ page }) => {
      await openAdminBooks(page);
      await page.setViewportSize(viewport);
      await noOverflow(page);
      if (viewport.width <= 850) {
        await expect(page.locator("#adminSectionSelect")).toBeVisible();
      } else {
        await expect(page.locator(".admin-sidenav")).toBeVisible();
      }
      const check = page.locator('article[data-book-id="1"] [data-select]');
      await expect(check).toBeVisible();
      const box = await check.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const wrap = el.closest(".admin-book-check-wrap")?.getBoundingClientRect();
        return { w: wrap?.width || r.width, h: wrap?.height || r.height };
      });
      expect(box.w).toBeGreaterThanOrEqual(22);
      expect(box.h).toBeGreaterThanOrEqual(22);
      await page.locator('article[data-book-id="1"] [data-quick-edit]').click();
      await expect(page.locator("#quickEditModal")).toBeVisible();
      await expect(page.locator("#quickEditSave")).toBeVisible();
      await expect(page.locator("#quickEditCancel")).toBeVisible();
      await noOverflow(page);
      await page.locator("#quickEditCancel").click();
      await page.locator('article[data-book-id="1"] [data-select]').check();
      await page.locator("#bulkAction").selectOption("deactivate");
      await page.locator("#bulkApplyBtn").click();
      await expect(page.locator("#bulkConfirmModal")).toBeVisible();
      await expect(page.locator("#bulkConfirmOk")).toBeVisible();
      await noOverflow(page);
      await page.locator("#bulkConfirmCancel").click();
    });
  }
});
