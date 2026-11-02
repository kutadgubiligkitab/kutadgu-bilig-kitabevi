const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");
const path = require("path");
const preview = require("../../cloudflare/preview-dispatch");
const listing = require("../../kutadgu-category-listing");
const sitemap = require("../../kutadgu-sitemap");
const root = path.resolve(__dirname, "../..");
const categories = [
  { slug: "romanlar", source: "romanlar.html", label: "رومانلار" },
  { slug: "tibb", source: "tibb.html", label: "تېببىي كىتابلار" },
  { slug: "new-category", source: "new-category.html", label: "يېڭى تۈر", group_key: "literature" },
  { slug: "unmapped", source: "unmapped.html", label: "باشقا تۈر" },
  { slug: "taamlar", source: "taamlar.html", label: "يوشۇرۇن", is_hidden: true },
  { slug: "retired", source: "retired.html", label: "كونا", retired: true }
];
const payload = { categories, redirects: [] };
async function homeResponse() {
  return preview.dispatch(new Request("http://localhost/"), {}, {
    listing, sitemap,
    readAsset: async file => new Response(fs.readFileSync(path.join(root, file.replace(/^\//, "")))),
    fetchImpl: async () => new Response(JSON.stringify(payload))
  });
}

for (const width of [320, 390, 768, 1280]) {
  test(`server category anchors survive hydration and collapsed RTL navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await H.installReadSafeNetwork(page);
    // All external application requests are mocked; no production reads or writes.
    await page.route("https://**/*", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    let directoryRequests = 0;
    await page.route("**/rpc/list_public_book_categories**", route => {
      directoryRequests++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await page.route("**/", async route => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await homeResponse();
      return route.fulfill({ status: response.status, contentType: "text/html", body: await response.text() });
    });
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    const initial = await response.text();
    for (const row of categories.filter(row => !row.is_hidden && !row.retired)) expect(initial).toContain(`href="/${row.slug}"`);
    await expect.poll(() => page.evaluate(() => window.KutadguBookCategories?.snapshot().mode)).toBe("authoritative");
    await expect(page.locator("#bookCategories")).toHaveAttribute("data-escape-bound", "1");
    const nav = page.locator("#bookCategories");
    const links = nav.locator(".category-nav-leaf");
    await expect(links).toHaveCount(4);
    await expect(nav.locator(".category-nav-leaf:visible")).toHaveCount(0);
    await expect(nav.locator('a[href="/taamlar"], a[href="/retired"]')).toHaveCount(0);
    if (width < 768) await nav.locator(".category-nav-toggle").click();
    await nav.locator("[data-category-group='literature']").click();
    await expect(nav.locator('a[href="/new-category"]')).toBeVisible();
    await expect(nav.locator('a[href="/tibb"]')).toBeHidden();
    await expect(links).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(links).toHaveCount(4);
    if (width < 768) await nav.locator(".category-nav-toggle").click();
    await nav.locator("[data-category-all]").click();
    await expect(nav.locator(".category-nav-leaf:visible")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(4);
    await page.screenshot({ path: test.info().outputPath(`categories-open-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(links).toHaveCount(4);
    expect(directoryRequests).toBe(0);
    expect(await nav.evaluate(node => getComputedStyle(node).direction)).toBe("rtl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(4);
    await page.screenshot({ path: test.info().outputPath(`categories-${width}.png`) });
  });
}

test("category anchors and privacy deletion link exist with JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.route("**/", async route => {
    const response = await homeResponse();
    await route.fulfill({ status: 200, contentType: "text/html", body: await response.text() });
  });
  await page.goto("/");
  await expect(page.locator("#bookCategories a.category-nav-leaf")).toHaveCount(4);
  await page.goto("/privacy");
  await expect(page.locator('a[href="/delete-account"]')).toBeVisible();
  await page.locator('a[href="/delete-account"]').click();
  await expect(page).toHaveURL(/\/delete-account$/);
  await expect(page.locator('a[href="mailto:info@kutadgubilik.com"]').first()).toBeVisible();
  await context.close();
});
