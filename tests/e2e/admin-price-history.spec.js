const { test, expect } = require("@playwright/test");

const BASE = [
  {id:1,title:"كىتاب A",author:"Author A",price:135,original_price:100,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/a.webp",is_active:true,is_recommended:false,is_new:false,stock:3,stock_status:"in_stock",sales_count:5,legacy_id:"leg-1",created_at:"2026-01-01",isbn:"9781111111111",description:"desc"},
  {id:2,title:"Beta Book",author:"Author B",price:200,original_price:200,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/b.webp",is_active:true,is_recommended:false,is_new:false,stock:1,stock_status:"in_stock",sales_count:0,legacy_id:"leg-2",created_at:"2026-01-02",isbn:"9782222222222",description:"desc"},
  {id:3,title:"Gamma Book",author:"Author C",price:20,original_price:15,source:"romanlar.html",category:"رومانلار",image_url:"https://cdn.example/c.webp",is_active:true,is_recommended:false,is_new:false,stock:2,stock_status:"in_stock",sales_count:1,legacy_id:"leg-3",created_at:"2026-01-03",isbn:"9783333333333",description:"desc"},
  {id:4,title:"Zero Original",author:"Author D",price:10,original_price:0,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/d.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"4",description:"d"},
  {id:5,title:"Missing Original",author:"Author E",price:0,original_price:null,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/e.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"9785555555555",description:"d"}
];

function seedHistory() {
  const rows = [
    {id:101,book_id:"1",old_price:100,new_price:135,change_kind:"price_change",changed_at:"2026-09-01T10:00:00.000Z"},
    {id:102,book_id:"1",old_price:0,new_price:100,change_kind:"price_change",changed_at:"2026-08-01T10:00:00.000Z"},
    {id:103,book_id:"1",old_price:null,new_price:0,change_kind:"price_change",changed_at:"2026-07-01T10:00:00.000Z"},
    {id:201,book_id:"2",old_price:180,new_price:200,change_kind:"price_change",changed_at:"2026-09-01T12:00:00.000Z"}
  ];
  for (let i = 0; i < 22; i += 1) {
    rows.push({
      id: 104 + i,
      book_id: "1",
      old_price: 10 + i,
      new_price: 11 + i,
      change_kind: "price_change",
      changed_at: `2026-06-${String(22 - i).padStart(2, "0")}T10:00:00.000Z`
    });
  }
  return rows;
}

async function openAdminBooks(page, books = BASE, history = seedHistory()) {
  await page.addInitScript(({ rows, historyRows }) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = rows;
    window.__kutadguQuickPatches = [];
    window.__kutadguBulkCalls = [];
    window.__kutadguPriceCalls = [];
    window.__kutadguResetCalls = [];
    window.__kutadguBookSaves = [];
    window.__kutadguOriginalCorrections = [];
    window.__kutadguSingleResets = [];
    window.__kutadguRollbackCalls = [];
    window.__kutadguHistoryFetches = [];
    window.__kutadguBookFetches = 0;
    window.__kutadguStaleRollbackPrice = false;
    window.__kutadguRaceOriginal = null;
    window.__kutadguSeedHistory = historyRows;
    window.__kutadguAdminFetchBook = async (id) => {
      window.__kutadguBookFetches += 1;
      const store = window.__kutadguPriceStore;
      const fromStore = store && store.books && store.books[String(id)];
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = fromStore || master.find((b) => String(b.id) === String(id));
      if (!row) return null;
      if (window.__kutadguStaleRollbackPrice) return { ...row, price: 999 };
      return { ...row };
    };
    window.__kutadguAdminCorrectOriginal = async (id, patch, expectedOriginal) => {
      window.__kutadguOriginalCorrections.push({ id: String(id), patch: { ...patch } });
      const master = window.__kutadguAdminPreviewBooks || [];
      const storeMap = {};
      master.forEach((book) => { storeMap[String(book.id)] = book; });
      const result = window.KutadguAdminOriginalPrice.compareAndSwapOriginalPrice(storeMap, {
        id,
        expectedOriginal,
        patch
      });
      if (window.__kutadguPriceStore && window.__kutadguPriceStore.books[String(id)] && result.data && result.data[0]) {
        window.__kutadguPriceStore.books[String(id)].original_price = result.data[0].original_price;
      }
      return { error: result.error, data: result.data };
    };
    window.__kutadguAdminResetOneBook = async (id, patch, expected) => {
      window.__kutadguSingleResets.push({ id: String(id), patch: { ...patch } });
      const Hist = window.KutadguAdminPriceHistory;
      const result = Hist.applyBookPriceChange(window.__kutadguPriceStore, id, patch.price);
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      if (row) row.price = patch.price;
      return { error: result.error, data: result.data };
    };
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      if (operation === "UPDATE" && payload && Object.prototype.hasOwnProperty.call(payload, "price")) {
        window.KutadguAdminPriceHistory.applyBookPriceChange(window.__kutadguPriceStore, id, payload.price);
        const master = window.__kutadguAdminPreviewBooks || [];
        const row = master.find((b) => String(b.id) === String(id));
        if (row) {
          row.price = payload.price;
          if (Object.prototype.hasOwnProperty.call(payload, "original_price")) row.original_price = payload.original_price;
        }
      }
      return { error: null, data: [{ id }] };
    };
    window.__kutadguAdminPersistQuick = async (id, patch) => {
      window.__kutadguQuickPatches.push({ id, patch });
      if (patch && Object.prototype.hasOwnProperty.call(patch, "price")) {
        window.KutadguAdminPriceHistory.applyBookPriceChange(window.__kutadguPriceStore, id, patch.price);
      }
      return { error: null };
    };
    window.__kutadguAdminBulkPriceUpdateOne = async (id, patch) => {
      window.__kutadguPriceCalls.push({ id: String(id), patch });
      window.KutadguAdminPriceHistory.applyBookPriceChange(window.__kutadguPriceStore, id, patch.price);
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      if (row) row.price = patch.price;
      return { error: null };
    };
    window.__kutadguAdminBulkResetUpdateOne = async (id, patch) => {
      window.__kutadguResetCalls.push({ id: String(id), patch });
      window.KutadguAdminPriceHistory.applyBookPriceChange(window.__kutadguPriceStore, id, patch.price);
      const master = window.__kutadguAdminPreviewBooks || [];
      const row = master.find((b) => String(b.id) === String(id));
      if (row) row.price = patch.price;
      return { error: null };
    };
    window.__kutadguAdminFetchPriceTargets = async (settings) => {
      return window.KutadguAdminBulkPrice.selectScopeBooks(window.__kutadguAdminPreviewBooks, settings).books;
    };
    window.__kutadguAdminFetchResetTargets = async (settings) => {
      return window.KutadguAdminBulkPrice.selectScopeBooks(window.__kutadguAdminPreviewBooks, settings).books;
    };
  }, { rows: books, historyRows: history });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate((historyRows) => {
    const Hist = window.KutadguAdminPriceHistory;
    window.__kutadguPriceStore = Hist.createHistoryStore(window.__kutadguAdminPreviewBooks, historyRows);
    window.__kutadguAdminFetchPriceHistory = async (bookId, offset, limit) => {
      window.__kutadguHistoryFetches.push({ bookId: String(bookId), offset, limit });
      const rows = Hist.historyForBook(window.__kutadguPriceStore, bookId);
      return Hist.paginateHistory(rows, offset, limit);
    };
    window.__kutadguAdminRollbackPrice = async (bookId, historyId, expectedPrice) => {
      window.__kutadguRollbackCalls.push({ bookId: String(bookId), historyId, expectedPrice });
      const result = Hist.simulateRollback(window.__kutadguPriceStore, {
        bookId,
        historyId,
        expectedPrice,
        isAdmin: true,
        aal: "aal2"
      });
      if (!result.error && window.__kutadguPriceStore.books[String(bookId)]) {
        const master = window.__kutadguAdminPreviewBooks || [];
        const row = master.find((b) => String(b.id) === String(bookId));
        if (row) row.price = window.__kutadguPriceStore.books[String(bookId)].price;
      }
      return result;
    };
  }, history);
  await expect(page.locator("#booksCard")).toBeVisible();
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

async function openBookHistory(page, id = "1") {
  await page.locator(`article[data-book-id="${id}"] [data-edit]`).click();
  await expect(page.locator("#bookModal")).toBeVisible();
  await expect(page.locator("#bookPriceHistoryBtn")).toBeVisible();
  await page.locator("#bookPriceHistoryBtn").click();
  await expect(page.locator("#priceHistoryModal")).toBeVisible();
}

test.describe("admin price history", () => {
  test("existing book shows Price History; New Book does not", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookPriceHistoryBtn")).toBeHidden();
    await page.locator("#cancelBookEdit").click();
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookPriceHistoryBtn")).toBeVisible();
    await expect(page.locator("#bookPriceHistoryBtn")).toHaveText("باھا تارىخى");
  });

  test("empty history state works for a book with no rows", async ({ page }) => {
    await openAdminBooks(page);
    await openBookHistory(page, "3");
    await expect(page.locator("#priceHistoryEmpty")).toBeVisible();
    await expect(page.locator("#priceHistoryEmpty")).toContainText("تېخى باھا ئۆزگىرىش تارىخى يوق.");
    await expect(page.locator("#priceHistoryList article")).toHaveCount(0);
    await expect(page.locator("#priceHistoryMoreBtn")).toBeHidden();
    const fetches = await page.evaluate(() => window.__kutadguHistoryFetches.slice());
    expect(fetches.every((f) => f.bookId === "3")).toBeTruthy();
  });

  test("entries are newest first and render date, old → new, 0, and NULL without rollback", async ({ page }) => {
    await openAdminBooks(page);
    await openBookHistory(page, "1");
    await expect(page.locator("#priceHistoryCurrent")).toContainText("135");
    await expect(page.locator("#priceHistoryOriginal")).toContainText("100");
    const items = page.locator("#priceHistoryList article");
    await expect(items).toHaveCount(20);
    await expect(items.nth(0)).toContainText("100");
    await expect(items.nth(0)).toContainText("135");
    await expect(items.nth(0)).toContainText("باھا ئۆزگەردى");
    await expect(items.nth(0)).toContainText("2026-يىلى");
    await expect(items.nth(0).locator("[data-history-rollback]")).toBeVisible();
    await expect(items.nth(1)).toContainText("0 ₺");
    await expect(items.nth(2)).toContainText("—");
    await expect(items.nth(2)).toContainText("0 ₺");
    await expect(items.nth(2).locator("[data-history-rollback]")).toHaveCount(0);
    await expect(page.locator("#priceHistoryList")).not.toContainText("changed_by");
  });

  test("Load More pagination appends remaining rows for that book only", async ({ page }) => {
    await openAdminBooks(page);
    await openBookHistory(page, "1");
    await expect(page.locator("#priceHistoryList article")).toHaveCount(20);
    await expect(page.locator("#priceHistoryMoreBtn")).toBeVisible();
    await page.locator("#priceHistoryMoreBtn").click();
    await expect(page.locator("#priceHistoryList article")).toHaveCount(25);
    await expect(page.locator("#priceHistoryMoreBtn")).toBeHidden();
    const fetches = await page.evaluate(() => window.__kutadguHistoryFetches.slice());
    expect(fetches.map((f) => f.bookId)).toEqual(["1", "1"]);
    expect(fetches[1].offset).toBe(20);
  });

  test("rollback confirmation shows current + target and writes price only", async ({ page }) => {
    await openAdminBooks(page);
    await openBookHistory(page, "1");
    await page.locator("#priceHistoryList [data-history-rollback]").first().click();
    await expect(page.locator("#priceRollbackModal")).toBeVisible();
    await expect(page.locator("#priceRollbackBook")).toContainText("كىتاب A");
    await expect(page.locator("#priceRollbackCurrent")).toContainText("ھازىرقى باھا");
    await expect(page.locator("#priceRollbackCurrent")).toContainText("135");
    await expect(page.locator("#priceRollbackTarget")).toContainText("قايتۇرۇلىدىغان باھا");
    await expect(page.locator("#priceRollbackTarget")).toContainText("100");
    await expect(page.locator("#priceRollbackModal")).toContainText("ئەسلى باھا ئۆزگەرمەيدۇ");
    await page.locator("#priceRollbackSaveBtn").click();
    await expect(page.locator("#priceRollbackModal")).toBeHidden();
    await expect(page.locator("#bookPrice")).toHaveValue("100");
    await expect(page.locator("#bookOriginalPriceStatus")).toContainText("100");
    await expect(page.locator("#priceHistoryList article").first()).toContainText("تارىختىن قايتۇرۇلدى");
    await expect(page.locator("#priceHistoryList article").first()).toContainText("135");
    await expect(page.locator("#priceHistoryCurrent")).toContainText("100");
    const snapshot = await page.evaluate(() => {
      const book = window.__kutadguPriceStore.books["1"];
      return {
        price: book.price,
        original_price: book.original_price,
        rollbackCalls: window.__kutadguRollbackCalls.slice(),
        kinds: window.KutadguAdminPriceHistory.historyForBook(window.__kutadguPriceStore, "1").map((r) => r.change_kind)
      };
    });
    expect(snapshot.price).toBe(100);
    expect(snapshot.original_price).toBe(100);
    expect(snapshot.rollbackCalls).toEqual([{ bookId: "1", historyId: 101, expectedPrice: 135 }]);
    expect(snapshot.kinds[0]).toBe("rollback");
  });

  test("stale current price aborts before a second write", async ({ page }) => {
    await openAdminBooks(page);
    await openBookHistory(page, "1");
    await page.locator("#priceHistoryList [data-history-rollback]").first().click();
    await expect(page.locator("#priceRollbackModal")).toBeVisible();
    await page.evaluate(() => { window.__kutadguStaleRollbackPrice = true; });
    await page.locator("#priceRollbackSaveBtn").click();
    await expect(page.locator("#priceRollbackError")).toContainText("باھا باشقا بەتتە ئۆزگەرتىلگەن");
    const calls = await page.evaluate(() => window.__kutadguRollbackCalls.slice());
    expect(calls).toEqual([]);
    const price = await page.evaluate(() => window.__kutadguPriceStore.books["1"].price);
    expect(price).toBe(135);
  });

  test("selected history row from another book is rejected", async ({ page }) => {
    await openAdminBooks(page);
    await openBookHistory(page, "1");
    const result = await page.evaluate(async () => {
      const out = await window.__kutadguAdminRollbackPrice("1", 201, 135);
      return { message: out.error && out.error.message, price: window.__kutadguPriceStore.books["1"].price };
    });
    expect(result.message).toContain("تارىخ قۇرى بۇ كىتابقا تەۋە ئەمەس");
    expect(result.price).toBe(135);
  });

  test("price-related previews are invalidated after rollback", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-select]').check();
    await page.locator("#bulkPriceOpenBtn").click();
    await expect(page.locator("#bulkPriceModal")).toBeVisible();
    await page.locator('input[name="bulkPriceScope"][value="selected"]').check();
    await page.locator("#bulkPriceAmount").fill("10");
    await page.locator("#bulkPricePreviewBtn").click();
    await expect(page.locator("#bulkPricePreviewWrap")).toBeVisible();
    await page.evaluate(() => { document.querySelector("#bulkPriceModal").hidden = true; });
    await page.locator("#bulkResetOpenBtn").click();
    await expect(page.locator("#bulkResetModal")).toBeVisible();
    await page.locator('input[name="bulkResetScope"][value="selected"]').check();
    await page.locator("#bulkResetPreviewBtn").click();
    await expect(page.locator("#bulkResetPreviewWrap")).toBeVisible();
    await page.evaluate(() => { document.querySelector("#bulkResetModal").hidden = true; });
    await openBookHistory(page, "1");
    await page.locator("#priceHistoryList [data-history-rollback]").first().click();
    await page.locator("#priceRollbackSaveBtn").click();
    await expect(page.locator("#bookPrice")).toHaveValue("100");
    await page.evaluate(() => {
      document.querySelector("#bulkPriceModal").hidden = false;
      document.querySelector("#bulkResetModal").hidden = false;
    });
    await expect(page.locator("#bulkPricePreviewWrap")).toBeHidden();
    await expect(page.locator("#bulkResetPreviewWrap")).toBeHidden();
  });

  test("original_price correction does not create selling-price history", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    const before = await page.evaluate(() => window.__kutadguPriceStore.history.length);
    await page.locator("#bookOriginalPriceCorrectBtn").click();
    await page.locator("#originalPriceCorrectValue").fill("420");
    await page.locator("#originalPriceCorrectSaveBtn").click();
    await expect(page.locator("#bookOriginalPriceStatus")).toContainText("420");
    await expect(page.locator("#bookPrice")).toHaveValue("135");
    const after = await page.evaluate(() => ({
      len: window.__kutadguPriceStore.history.length,
      price: window.__kutadguPriceStore.books["1"].price,
      original: window.__kutadguPriceStore.books["1"].original_price
    }));
    expect(after.len).toBe(before);
    expect(after.price).toBe(135);
    expect(after.original).toBe(420);
  });

  test("normal Edit price change is captured once by the history trigger simulation", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="2"] [data-edit]').click();
    await page.locator("#bookPrice").fill("210");
    await page.locator("#bookForm button[type='submit']").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    const snap = await page.evaluate(() => {
      const rows = window.KutadguAdminPriceHistory.historyForBook(window.__kutadguPriceStore, "2");
      return { price: window.__kutadguPriceStore.books["2"].price, original: window.__kutadguPriceStore.books["2"].original_price, newest: rows[0] };
    });
    expect(snap.price).toBe(210);
    expect(snap.original).toBe(200);
    expect(snap.newest.old_price).toBe(200);
    expect(snap.newest.new_price).toBe(210);
    expect(snap.newest.change_kind).toBe("price_change");
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
  ]) {
    test(`responsive ${viewport.width} keeps history modal usable`, async ({ page }) => {
      await openAdminBooks(page);
      await page.setViewportSize(viewport);
      await openBookHistory(page, "1");
      await expect(page.locator("#priceHistoryModal")).toBeVisible();
      await expect(page.locator("#priceHistoryList article").first()).toBeVisible();
      await expect(page.locator("#priceHistoryMoreBtn")).toBeVisible();
      await noOverflow(page);
      await page.locator("#priceHistoryList [data-history-rollback]").first().click();
      await expect(page.locator("#priceRollbackModal")).toBeVisible();
      await expect(page.locator("#priceRollbackSaveBtn")).toBeVisible();
      await noOverflow(page);
    });
  }
});
