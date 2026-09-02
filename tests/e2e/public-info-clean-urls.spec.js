const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const PAGES = [
  { slug: "privacy", title: "مەخپىيەتلىك" },
  { slug: "returns", title: "قايتۇرۇش" },
  { slug: "order-info", title: "زاكاز قانداق بولىدۇ" }
];

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, mobileNav: true },
  { name: "412x915", width: 412, height: 915, mobileNav: true },
  { name: "768", width: 768, height: 1024, mobileNav: true },
  { name: "1280", width: 1280, height: 800, mobileNav: false }
];

function overflowPx(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function assertNoLoop(request, origin, slug) {
  const first = await request.get(`${origin}/${slug}`, { maxRedirects: 0 });
  expect(first.status(), `/${slug}`).toBe(200);
  expect(first.headers().location || "").toBe("");
  const again = await request.get(`${origin}/${slug}`, { maxRedirects: 0 });
  expect(again.status()).toBe(200);
}

test.describe("public info clean URLs", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  for (const pageInfo of PAGES) {
    test(`A /${pageInfo.slug} stays clean and returns 200`, async ({ request, baseURL }) => {
      const origin = String(baseURL || "").replace(/\/$/, "");
      const res = await request.get(`${origin}/${pageInfo.slug}`, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      expect(res.headers().location || "").toBe("");
      expect(await res.text()).toContain(pageInfo.title);
    });

    test(`B /${pageInfo.slug}.html permanently redirects to /${pageInfo.slug}`, async ({ request, baseURL }) => {
      const origin = String(baseURL || "").replace(/\/$/, "");
      const res = await request.get(`${origin}/${pageInfo.slug}.html`, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      const dest = new URL(res.headers().location || "", origin);
      expect(dest.pathname).toBe(`/${pageInfo.slug}`);
    });

    test(`C /${pageInfo.slug} does not redirect-loop`, async ({ request, baseURL }) => {
      const origin = String(baseURL || "").replace(/\/$/, "");
      await assertNoLoop(request, origin, pageInfo.slug);
    });

    test(`D /${pageInfo.slug} canonical is the www clean URL`, async ({ page }) => {
      await H.openFresh(page, `/${pageInfo.slug}`);
      expect(new URL(page.url()).pathname).toBe(`/${pageInfo.slug}`);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `https://www.kutadgubilik.com/${pageInfo.slug}`
      );
    });
  }

  test("B query string is preserved on .html → clean redirect", async ({ request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    const res = await request.get(`${origin}/privacy.html?utm=qa`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    const dest = new URL(res.headers().location || "", origin);
    expect(dest.pathname).toBe("/privacy");
    expect(dest.searchParams.get("utm")).toBe("qa");
  });

  test("E homepage footer and account use clean info links", async ({ page }) => {
    await H.openFresh(page, "/");
    await expect(page.locator('.site-footer-links a[href="/privacy"]')).toBeAttached();
    await expect(page.locator('.site-footer-links a[href="/returns"]')).toBeAttached();
    await expect(page.locator('.site-footer-links a[href="/order-info"]')).toBeAttached();
    expect(await page.locator('a[href$="privacy.html"]').count()).toBe(0);
    expect(await page.locator('a[href$="returns.html"]').count()).toBe(0);
    expect(await page.locator('a[href$="order-info.html"]').count()).toBe(0);

    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    expect(await page.locator('a[href="/privacy"]').count()).toBeGreaterThan(0);
    expect(await page.locator('a[href="/returns"]').count()).toBeGreaterThan(0);
    expect(await page.locator('a[href="/order-info"]').count()).toBeGreaterThan(0);
  });

  test("F critical CSS/JS assets load on /privacy", async ({ page }) => {
    const bad = [];
    page.on("response", (res) => {
      const url = res.url();
      if (res.status() === 404 && /\/(theme|shop|mobile|supabase-config)\./.test(url)) bad.push(url);
    });
    await H.openFresh(page, "/privacy");
    const assets = await page.evaluate(() => ({
      css: [...document.querySelectorAll("link[rel=stylesheet]")].map((n) => n.getAttribute("href") || ""),
      js: [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src") || "")
    }));
    expect(assets.css.some((h) => h.includes("theme.css"))).toBeTruthy();
    expect(assets.css.some((h) => h.includes("shop.css"))).toBeTruthy();
    expect(assets.js.some((s) => s.includes("shop.js"))).toBeTruthy();
    expect(assets.js.some((s) => s.includes("mobile.js"))).toBeTruthy();
    expect(bad, bad.join("\n")).toEqual([]);
  });

  for (const vp of VIEWPORTS) {
    test(`G ${vp.name} info pages render without overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const pageInfo of PAGES) {
        await H.openFresh(page, `/${pageInfo.slug}`);
        expect(new URL(page.url()).pathname).toBe(`/${pageInfo.slug}`);
        await expect(page.locator("h1")).toContainText(pageInfo.title);
        expect(await overflowPx(page)).toBeLessThanOrEqual(1);
        await expect(page.locator("header, .site-footer").first()).toBeVisible();
        if (vp.mobileNav && vp.width <= 700) {
          const toggle = page.locator(".mobile-menu-toggle");
          if (await toggle.isVisible()) {
            await toggle.click();
            await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).toHaveClass(/is-open/);
            await toggle.click();
            await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).not.toHaveClass(/is-open/);
          }
          await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
        }
      }
    });
  }

  test("deferred transactional/auth pages stay on .html", async ({ request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    for (const path of ["/cart.html", "/favorites.html", "/account.html", "/reset-password.html", "/admin.html", "/my-books.html"]) {
      const res = await request.get(`${origin}${path}`, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers().location || "", path).toBe("");
    }
  });

  test("category and book clean URLs remain intact", async ({ request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    const hub = await request.get(`${origin}/universal`, { maxRedirects: 0 });
    expect(hub.status()).toBe(200);
    const hubHtml = await request.get(`${origin}/universal.html`, { maxRedirects: 0 });
    expect(hubHtml.status()).toBe(308);
    expect(new URL(hubHtml.headers().location || "", origin).pathname).toBe("/universal");

    const book = await request.get(`${origin}/book/122`, { maxRedirects: 0 });
    expect(book.status()).toBe(200);
    const legacyHtml = await request.get(`${origin}/book.html?id=122`, { maxRedirects: 0 });
    expect(legacyHtml.status()).toBe(308);
    expect(new URL(legacyHtml.headers().location || "", origin).pathname).toBe("/book/122");
    const legacyBare = await request.get(`${origin}/book?id=122`, { maxRedirects: 0 });
    expect(legacyBare.status()).toBe(308);
    expect(new URL(legacyBare.headers().location || "", origin).pathname).toBe("/book/122");
  });
});
