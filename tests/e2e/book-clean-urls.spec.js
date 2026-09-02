const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("book clean URLs", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A clean active book uses /book/{id} SEO and does not bounce to book.html", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    const failed = [];
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (/\/book\/[^/]+\/(theme|shop|mobile|covers|catalog|kutadgu)/.test(url)) failed.push(url);
    });
    await H.openFresh(page, `/book/${book.id}`);
    await H.waitForDetailTitle(page, book.title);
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/book/${book.id}`);
    expect(url.pathname).not.toContain("book.html");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    const canonical = `https://www.kutadgubilik.com/book/${book.id}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
    const jsonLd = JSON.parse(await page.locator("#kutadguBookSchema").textContent());
    const bookNode = (jsonLd["@graph"] || []).find((n) => n["@type"] === "Book");
    expect(bookNode && bookNode.url).toBe(canonical);
    expect(failed, failed.join("\n")).toEqual([]);
  });

  function assertCleanBookLocation(location, origin, bookId) {
    expect(location, "missing Location").toBeTruthy();
    const dest = new URL(location, origin);
    expect(dest.pathname).toBe(`/book/${bookId}`);
    expect(dest.searchParams.has("id")).toBe(false);
    expect(String(location)).not.toMatch(/[?&]id=/);
    expect(dest.pathname + dest.search).not.toBe(`/book?id=${bookId}`);
  }

  test("B legacy /book.html?id={id} permanently lands on /book/{id}", async ({ page, request, baseURL }) => {
    const book = await H.discoverLiveBook(page);
    const origin = String(baseURL || "").replace(/\/$/, "");
    const redirect = await request.get(`${origin}/book.html?id=${encodeURIComponent(book.id)}`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    assertCleanBookLocation(redirect.headers().location, origin, book.id);

    await page.goto(H.legacyBookHtmlPath(book.id), { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForDetailTitle(page, book.title);
    const landed = new URL(page.url());
    expect(landed.pathname).toBe(`/book/${book.id}`);
    expect(landed.searchParams.has("id")).toBe(false);
    expect(page.url()).not.toMatch(/book\.html/);
    expect(page.url()).not.toMatch(/[?&]id=/);
  });

  test("B2 legacy /book?id={id} permanently lands on /book/{id} without leftover id query", async ({ page, request, baseURL }) => {
    const book = await H.discoverLiveBook(page);
    const origin = String(baseURL || "").replace(/\/$/, "");
    const redirect = await request.get(`${origin}/book?id=${encodeURIComponent(book.id)}`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    assertCleanBookLocation(redirect.headers().location, origin, book.id);

    await page.goto(`/book?id=${encodeURIComponent(book.id)}`, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await H.waitForDetailTitle(page, book.title);
    const landed = new URL(page.url());
    expect(landed.pathname).toBe(`/book/${book.id}`);
    expect(landed.searchParams.has("id")).toBe(false);
    expect(page.url()).not.toMatch(/[?&]id=/);
  });

  test("B3 /book/{id} stays put with no redirect loop", async ({ page, request, baseURL }) => {
    const book = await H.discoverLiveBook(page);
    const origin = String(baseURL || "").replace(/\/$/, "");
    const first = await request.get(`${origin}/book/${book.id}`, { maxRedirects: 0 });
    expect(first.status()).toBe(200);
    expect(first.headers().location || "").toBe("");
    await page.goto(`/book/${book.id}`, { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    expect(new URL(page.url()).pathname).toBe(`/book/${book.id}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, book.title);
    expect(new URL(page.url()).pathname).toBe(`/book/${book.id}`);
    expect(page.url()).not.toMatch(/[?&]id=/);
  });

  test("C invalid /book/not-a-number stays safe and noindex", async ({ page, request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    const res = await request.get(`${origin}/book/not-a-number`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    await page.goto("/book/not-a-number", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect(new URL(page.url()).pathname).toBe("/book/not-a-number");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.kutadgubilik.com/book.html");
    expect(await page.locator("#kutadguBookSchema").count()).toBe(0);
    const title = String(await page.locator(".book-detail-info h1").textContent()).trim();
    expect(title === "كىتاب" || title.length < 2).toBeTruthy();
  });

  test("D missing book /book/999999999 preserves noindex", async ({ page }) => {
    await page.goto("/book/999999999", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    expect(new URL(page.url()).pathname).toBe("/book/999999999");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.kutadgubilik.com/book.html");
    expect(await page.locator("#kutadguBookSchema").count()).toBe(0);
  });

  test("E homepage featured and search cards use /book/{id}", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await H.openFresh(page, "/");
    const featured = page.locator(".home-feature-card a[href], .home-carousel-link[href]").first();
    await expect(featured).toBeVisible({ timeout: 30_000 });
    const featuredHref = await featured.getAttribute("href");
    expect(featuredHref).toMatch(/\/book\/\d+/);
    expect(featuredHref).not.toMatch(/book\.html/);

    await page.locator("#searchInput").fill(book.searchToken);
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    const searchHref = await page.locator(`.advanced-search-result[data-live-book-id="${book.id}"] a`).first().getAttribute("href");
    expect(searchHref).toBe(`/book/${book.id}`);
  });

  test("F nested /book/{id} assets load from site root", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    const bad = [];
    page.on("response", (res) => {
      const url = res.url();
      if (res.status() === 404 && /\/book\/\d+\//.test(new URL(url).pathname)) bad.push(url);
    });
    await H.openFresh(page, `/book/${book.id}`);
    await H.waitForDetailTitle(page, book.title);
    const assets = await page.evaluate(() => {
      const hrefs = [...document.querySelectorAll("link[rel=stylesheet]")].map((n) => n.getAttribute("href") || "");
      const scripts = [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src") || "");
      return { hrefs, scripts };
    });
    expect(assets.hrefs.some((h) => h.startsWith("/theme.css"))).toBeTruthy();
    expect(assets.hrefs.some((h) => h.startsWith("/shop.css"))).toBeTruthy();
    expect(assets.scripts.some((s) => s.startsWith("/shop.js"))).toBeTruthy();
    expect(assets.scripts.some((s) => s.startsWith("/mobile.js"))).toBeTruthy();
    expect(assets.hrefs.some((h) => h.startsWith("theme.css"))).toBeFalsy();
    expect(assets.scripts.some((s) => s.startsWith("shop.js"))).toBeFalsy();
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("G category clean URLs still rewrite and redirect", async ({ request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    const clean = await request.get(`${origin}/universal`, { maxRedirects: 0 });
    expect(clean.status()).toBe(200);
    expect(await clean.text()).toContain("ئۇنىۋېرسال");
    const legacy = await request.get(`${origin}/universal.html`, { maxRedirects: 0 });
    expect(legacy.status()).toBe(308);
    expect(new URL(legacy.headers().location, origin).pathname).toBe("/universal");
  });

  test("non-numeric legacy query does not 308 into /book/{slug}", async ({ request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    for (const path of [`${origin}/book.html?id=children-3`, `${origin}/book?id=children-3`]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers().location || "").toBe("");
      const loc = String(res.headers().location || "");
      expect(loc).not.toMatch(/\/book\/children-3\b/i);
    }
  });

  test("invalid legacy ids do not redirect to /book/undefined|null|NaN", async ({ request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    for (const prefix of [`${origin}/book.html`, `${origin}/book`]) {
      for (const raw of ["undefined", "null", "NaN", "", "12.5"]) {
        const path = raw === "" ? prefix : `${prefix}?id=${encodeURIComponent(raw)}`;
        const res = await request.get(path, { maxRedirects: 0 });
        expect(res.status(), path).toBe(200);
        const location = String(res.headers().location || "");
        expect(location).not.toMatch(/\/book\/(undefined|null|NaN)\b/i);
        expect(location).not.toMatch(/\/book\/12\.5\b/);
      }
    }
  });
});

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844, mobileNav: true },
  { name: "mobile-412", width: 412, height: 915, mobileNav: true },
  { name: "tablet-768", width: 768, height: 1024, mobileNav: true },
  { name: "desktop-1280", width: 1280, height: 800, mobileNav: false }
];

async function overflowPx(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function bodyNotHidden(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const htmlHidden = html.classList.contains("kutadgu-maint-pending");
    const vis = getComputedStyle(body).visibility;
    return { htmlHidden, vis };
  });
}

test.describe("book clean URLs — responsive", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.name} homepage/category/search cards open /book/{id} without overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const book = await H.discoverLiveBook(page);

      await H.openFresh(page, "/");
      const homeCard = page.locator(".home-feature-card a[href^='/book/']").first();
      await expect(homeCard).toBeVisible({ timeout: 30_000 });
      const homeHref = await homeCard.getAttribute("href");
      expect(homeHref).toMatch(/^\/book\/\d+$/);
      expect(homeHref).not.toMatch(/book\.html/);
      await homeCard.click();
      await H.waitForShop(page);
      await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/book\/\d+$/);
      expect(page.url()).not.toMatch(/book\.html/);
      await H.waitForDetailTitle(page);
      expect(await overflowPx(page)).toBeLessThanOrEqual(4);
      const hiddenHome = await bodyNotHidden(page);
      expect(hiddenHome.htmlHidden).toBe(false);
      expect(hiddenHome.vis).not.toBe("hidden");

      await H.openFresh(page, "/universal");
      expect(new URL(page.url()).pathname).toBe("/universal");
      const catCard = page.locator(".book-card a.book-image[href^='/book/'], .book-card a[href^='/book/']").first();
      await expect(catCard).toBeVisible({ timeout: 30_000 });
      const catHref = await catCard.getAttribute("href");
      expect(catHref).toMatch(/^\/book\/\d+$/);
      await catCard.click();
      await H.waitForShop(page);
      await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/book\/\d+$/);
      await H.waitForDetailTitle(page);
      expect(await overflowPx(page)).toBeLessThanOrEqual(4);

      await H.openFresh(page, "/");
      await page.locator("#searchInput").fill(book.searchToken);
      await page.locator("#searchButton").click();
      await page.waitForSelector(".advanced-search-result", { timeout: 45_000 });
      const searchLink = page.locator(`.advanced-search-result[data-live-book-id="${book.id}"] a[href^='/book/']`).first();
      await expect(searchLink).toBeVisible();
      expect(await searchLink.getAttribute("href")).toBe(`/book/${book.id}`);
      await searchLink.click();
      await H.waitForShop(page);
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/book/${book.id}`);
      await H.waitForDetailTitle(page, book.title);
      await expect(page.locator(".book-cover-box img").first()).toBeVisible();
      expect(await overflowPx(page)).toBeLessThanOrEqual(4);
    });

    test(`${vp.name} /book/{id} assets, SEO-ready shell, and navigation`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const book = await H.discoverLiveBook(page);
      const bad = [];
      page.on("response", (res) => {
        if (res.status() === 404 && /\/book\/\d+\//.test(new URL(res.url()).pathname)) bad.push(res.url());
      });
      await H.openFresh(page, `/book/${book.id}`);
      await H.waitForDetailTitle(page, book.title);
      expect(new URL(page.url()).pathname).toBe(`/book/${book.id}`);
      const hidden = await bodyNotHidden(page);
      expect(hidden.htmlHidden).toBe(false);
      expect(hidden.vis).not.toBe("hidden");
      const assets = await page.evaluate(() => ({
        css: [...document.querySelectorAll("link[rel=stylesheet]")].map((n) => n.getAttribute("href") || ""),
        js: [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src") || ""),
        maint: [...document.querySelectorAll("script[data-kutadgu-maintenance]")].map((n) => n.getAttribute("src") || ""),
        announce: [...document.querySelectorAll("script[data-kutadgu-announcements]")].map((n) => n.getAttribute("src") || "")
      }));
      expect(assets.css.some((h) => h.startsWith("/theme.css"))).toBeTruthy();
      expect(assets.css.some((h) => h.startsWith("/shop.css"))).toBeTruthy();
      expect(assets.js.some((s) => s.startsWith("/shop.js"))).toBeTruthy();
      expect(assets.js.some((s) => s.startsWith("/mobile.js"))).toBeTruthy();
      expect(assets.maint.every((s) => s.startsWith("/kutadgu-maintenance.js"))).toBeTruthy();
      expect(assets.announce.every((s) => s.startsWith("/kutadgu-announcements.js"))).toBeTruthy();
      expect(bad, bad.join("\n")).toEqual([]);
      expect(await overflowPx(page)).toBeLessThanOrEqual(4);

      if (vp.mobileNav) {
        await expect(page.locator(".mobile-menu-toggle")).toBeVisible();
        await page.locator(".mobile-menu-toggle").click();
        await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).toHaveClass(/is-open/);
        await expect(page.locator(".mobile-menu-backdrop")).toHaveClass(/is-open/);
        const booksLink = page.locator("nav#mobileSiteMenu.mobile-site-menu a[href$='#books']").first();
        await expect(booksLink).toBeVisible();
        await page.locator(".mobile-menu-toggle").click();
        await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).not.toHaveClass(/is-open/);
        await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
      } else {
        await expect(page.locator(".mobile-menu-toggle")).toBeHidden();
        await expect(page.locator("a.detail-brand")).toBeVisible();
        await expect(page.locator("nav#mobileSiteMenu.is-open")).toHaveCount(0);
      }
    });
  }

  test("390 menu backdrop and close still work around book cards", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    const toggle = page.locator(".mobile-menu-toggle");
    await toggle.click();
    await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).toHaveClass(/is-open/);
    await expect(page.locator(".mobile-menu-backdrop")).toHaveClass(/is-open/);
    await expect.poll(async () => page.evaluate(() => {
      const backdrop = document.querySelector(".mobile-menu-backdrop");
      return backdrop ? Number(getComputedStyle(backdrop).opacity) >= 0.99 : false;
    })).toBe(true);
    await page.locator(".mobile-menu-toggle").click();
    await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).not.toHaveClass(/is-open/);
    await expect(page.locator("body")).not.toHaveClass(/mobile-menu-open/);
    await expect(page.locator(".mobile-menu-backdrop")).not.toHaveClass(/is-open/);
    const card = page.locator(".home-feature-card a[href^='/book/']").first();
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await H.waitForShop(page);
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/book\/\d+$/);
  });
});
