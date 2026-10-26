const { test, expect } = require("./playwright-test");

async function installCommonJsGlobals(page) {
  await page.addInitScript(() => {
    const holder = { exports: {} };
    Object.defineProperty(window, "module", { configurable: true, writable: true, value: holder });
    Object.defineProperty(window, "exports", { configurable: true, writable: true, value: holder.exports });
  });
}

test("signed-out admin shows login when CommonJS globals capture the SDK", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error && error.message || error)));
  await installCommonJsGlobals(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#loginPanel")).toBeVisible();
  await expect(page.locator("#setupPanel")).toBeHidden();
  await expect(page.locator("#adminEmail")).toBeVisible();
  await expect(page.locator("#adminPassword")).toBeVisible();
  expect(await page.evaluate(() => typeof window.supabase.createClient)).toBe("function");
  expect(await page.evaluate(() => window.__kutadguSkipAdminAuth)).toBeFalsy();
  expect(errors).toEqual([]);
});

test("signed-out admin shows login without CommonJS globals", async ({ page }) => {
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#loginPanel")).toBeVisible();
  await expect(page.locator("#setupPanel")).toBeHidden();
  expect(await page.evaluate(() => typeof window.supabase.createClient)).toBe("function");
  expect(await page.evaluate(() => window.__kutadguSkipAdminAuth)).toBeFalsy();
});
