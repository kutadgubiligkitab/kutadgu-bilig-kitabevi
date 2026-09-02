const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("seo + admin", () => {
  test("19 sitemap.xml returns 200", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/sitemap.xml", baseURL).href);
    expect(res.status(), await res.text().then((t) => t.slice(0, 200)).catch(() => "")).toBe(200);
    const body = await res.text();
    expect(body).toContain("www.kutadgubilik.com");
    expect(body).toMatch(/sitemapindex|urlset/);
  });

  test("20 sitemap-books.xml returns 200", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/sitemap-books.xml", baseURL).href);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toMatch(/\/book\/\d+/);
    expect(body).toContain("https://www.kutadgubilik.com/book/");
    expect(body).not.toContain("book.html?id=");
    expect(body).not.toContain("kutadgu-bilig-kitab.vercel.app");
  });

  test("21 robots.txt returns 200 and production sitemap URL", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/robots.txt", baseURL).href);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sitemap: https://www.kutadgubilik.com/sitemap.xml");
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

  test("missing numeric book stays noindex after clean URL landing", async ({ page }) => {
    await page.goto("/book.html?id=999999999", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/book/999999999");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.kutadgubilik.com/book.html");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).not.toContain("999999999");
    expect(await page.locator("#kutadguBookSchema").count()).toBe(0);
  });

  test("resolved live book becomes index,follow with numeric www canonical", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await H.openFresh(page, book.detailPath);
    await H.waitForDetailTitle(page, book.title);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://www.kutadgubilik.com/book/${encodeURIComponent(book.id)}`
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `https://www.kutadgubilik.com/book/${encodeURIComponent(book.id)}`
    );
    expect(await page.locator("#kutadguBookSchema").count()).toBe(1);
  });

  test("category hub uses clean URL; old .html redirects; numbered stubs stay put", async ({ page, request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    const clean = await request.get(`${origin}/universal`, { maxRedirects: 0 });
    expect(clean.status()).toBe(200);
    expect(await clean.text()).toContain("ئۇنىۋېرسال");

    const legacy = await request.get(`${origin}/universal.html`, { maxRedirects: 0 });
    expect(legacy.status()).toBe(308);
    const location = String(legacy.headers().location || "");
    expect(new URL(location, origin).pathname).toBe("/universal");

    const again = await request.get(`${origin}/universal`, { maxRedirects: 0 });
    expect(again.status()).toBe(200);

    const stub = await request.get(`${origin}/universal-2.html`, { maxRedirects: 0 });
    expect(stub.status()).toBe(200);

    const cart = await request.get(`${origin}/cart.html`, { maxRedirects: 0 });
    expect(cart.status()).toBe(200);
    const trust = await request.get(`${origin}/privacy.html`, { maxRedirects: 0 });
    expect(trust.status()).toBe(200);
    const homeHtml = await request.get(`${origin}/index.html`, { maxRedirects: 0 });
    expect(homeHtml.status()).toBe(308);
    expect(new URL(homeHtml.headers().location || "/", origin).pathname).toBe("/");

    const pages = await request.get(`${origin}/sitemap-pages.xml`);
    expect(pages.status()).toBe(200);
    const pagesXml = await pages.text();
    expect(pagesXml).toContain("https://www.kutadgubilik.com/universal</loc>");
    expect(pagesXml).not.toContain("https://www.kutadgubilik.com/universal.html");
    expect(pagesXml).toContain("https://www.kutadgubilik.com/privacy.html");

    await page.goto("/universal.html", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/universal");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://www.kutadgubilik.com/universal"
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      "https://www.kutadgubilik.com/universal"
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    const shopPath = await page.evaluate(() => {
      const el = document.querySelector('script[src*="shop.js"]');
      return el ? new URL(el.src, location.href).pathname : "";
    });
    expect(shopPath).toBe("/shop.js");
    await page.goto("/universal-2.html", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/universal-2.html");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://www.kutadgubilik.com/universal.html"
    );
  });
});
