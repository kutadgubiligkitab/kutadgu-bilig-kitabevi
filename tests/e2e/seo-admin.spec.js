const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("seo + admin", () => {
  test("19 sitemap.xml returns 200", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/sitemap.xml", baseURL).href);
    expect(res.status(), await res.text().then((t) => t.slice(0, 200)).catch(() => "")).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/sitemapindex|urlset/);
    expect(body).toContain("kutadgu-bilig-kitab.vercel.app");
  });

  test("20 sitemap-books.xml returns 200", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/sitemap-books.xml", baseURL).href);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toMatch(/book\.html\?id=\d+/);
  });

  test("21 robots.txt returns 200 and production sitemap URL", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/robots.txt", baseURL).href);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sitemap: https://kutadgu-bilig-kitab.vercel.app/sitemap.xml");
    expect(body).toContain("Disallow: /admin.html");
  });

  test("17 admin login page loads", async ({ page }) => {
    const errors = H.collectPageErrors(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#adminEmail")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("18 admin page requires authentication", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#loginForm")).toBeVisible();
  });

  test("admin dashboard login (optional credentials)", async ({ page }) => {
    const creds = H.adminCreds();
    test.skip(!creds, "KUTADGU_ADMIN_EMAIL / KUTADGU_ADMIN_PASSWORD not set");
    await H.installReadSafeNetwork(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await page.locator("#adminEmail").fill(creds.email);
    await page.locator("#adminPassword").fill(creds.password);
    await page.locator("#loginForm button[type=submit]").click();
    await expect(page.locator("#dashboardPanel")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("#loginPanel")).toBeHidden();
  });

  test("member account login (optional credentials)", async ({ page }) => {
    const creds = H.memberCreds();
    test.skip(!creds, "KUTADGU_MEMBER_EMAIL / KUTADGU_MEMBER_PASSWORD not set");
    await H.installReadSafeNetwork(page);
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginEmail")).toBeVisible({ timeout: 30_000 });
    await page.locator("#loginEmail").fill(creds.email);
    await page.locator("#loginPassword").fill(creds.password);
    await page.locator("#loginForm button[type=submit]").click();
    await expect(page.locator("#accountApp, .account-dashboard, #accountHome").first()).toBeVisible({
      timeout: 45_000
    });
  });
});
