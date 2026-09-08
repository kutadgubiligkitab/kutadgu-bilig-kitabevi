const { test, expect } = require("./playwright-test");

test.describe("legacy book color-print boolean", () => {
  test("Admin checkbox is gone; public detail still uses legacy true as رەڭلىك", async ({ page }) => {
    await page.addInitScript(() => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguAdminPreviewBooks = [];
      window.__kutadguBookSaves = [];
      window.__kutadguAdminPersistBook = async (payload, operation, id) => {
        window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
        return { error: null, data: [{ id }] };
      };
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookIsColorPrint")).toHaveCount(0);
    await expect(page.locator("#bookForm")).not.toContainText("ئىچكى بەتلىرى رەڭلىك");
    await expect(page.locator("#bookInteriorPrintType")).toBeHidden();

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
      return {
        trueHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(trueBook)),
        falseHtml: Shop.setDynamicMeta("ئىچكى بېسىلىشى", Shop.colorPrintDetailValue(falseBook)),
        listing: Shop.bookCardMarkup(trueBook),
        home: Shop.homeFeatureCard(trueBook)
      };
    });
    expect(out.trueHtml).toContain("رەڭلىك");
    expect(out.trueHtml).toContain("ئىچكى بېسىلىشى");
    expect(out.falseHtml).toBe("");
    expect(out.listing).not.toContain("رەڭلىك");
    expect(out.home).not.toContain("ئىچكى بېسىلىشى");
  });
});
