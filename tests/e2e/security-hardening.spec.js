const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const XSS_BOOK = {
  id: "900001",
  title: `<img src=x onerror="window.__xssRan=true">`,
  author: `</div><img src=x onerror="window.__xssRan=true">`,
  href: "javascript:window.__xssRan=true",
  image: "javascript:window.__xssRan=true",
  price: 12,
  category: `<b>onerror</b>`,
  isActive: true,
  is_active: true
};

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(overflow).toBe(false);
}

test.describe("security hardening 2a", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("security headers are present on HTML", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/", baseURL).href);
    expect(res.status()).toBe(200);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers()["x-frame-options"].toLowerCase()).toBe("deny");
    expect(res.headers()["content-security-policy"]).toMatch(/frame-ancestors\s+'none'/i);
    expect(res.headers()["permissions-policy"]).toMatch(/camera=\(\)/);
    expect(res.headers()["content-security-policy"] || "").not.toMatch(/script-src/);
  });

  test("stored XSS fixtures do not execute in mini, featured, or lightbox", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const result = await page.evaluate((book) => {
      window.__xssRan = false;
      const shop = window.kutadguShop;
      const wrap = document.createElement("div");
      wrap.id = "xss-fixture-host";
      wrap.innerHTML = shop.miniCard(book) + shop.homeFeatureCard(book) + shop.bookCardMarkup(book);
      document.body.appendChild(wrap);
      shop.openCoverLightbox(["javascript:alert(1)", "https://example.com/cover.webp"], 0, book.title);
      const overlay = document.querySelector(".cover-zoom-overlay img");
      const imgs = [...wrap.querySelectorAll("img")];
      const hrefs = [...wrap.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
      const dangerousHandlers = [...wrap.querySelectorAll("*")].filter((el) => {
        const onerror = el.getAttribute("onerror") || "";
        const onclick = el.getAttribute("onclick") || "";
        return /xssRan|alert\s*\(|javascript:/i.test(`${onerror} ${onclick}`);
      }).length;
      return {
        xss: window.__xssRan === true,
        scripts: wrap.querySelectorAll("script").length,
        dangerousHandlers,
        imgSrcs: imgs.map((img) => img.getAttribute("src") || ""),
        hrefs,
        miniTitle: wrap.querySelector(".shop-mini-title")?.textContent || "",
        featuredTitle: wrap.querySelector(".home-feature-title")?.textContent || "",
        lightboxSrc: overlay ? overlay.getAttribute("src") || overlay.src : "",
        unexpectedImg: wrap.querySelector('img[src="x"]') != null
      };
    }, XSS_BOOK);

    expect(result.xss).toBe(false);
    expect(result.scripts).toBe(0);
    expect(result.dangerousHandlers).toBe(0);
    expect(result.unexpectedImg).toBe(false);
    expect(result.miniTitle).toContain("<img");
    expect(result.featuredTitle).toContain("<img");
    expect(result.imgSrcs.every((src) => !/^\s*javascript:/i.test(src))).toBe(true);
    expect(result.hrefs.every((href) => !/^\s*javascript:/i.test(href))).toBe(true);
    expect(result.lightboxSrc).not.toMatch(/javascript:/i);
    expect(result.lightboxSrc).toContain("example.com/cover.webp");
  });

  test("valid https and internal covers still render", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const srcs = await page.evaluate(() => {
      const shop = window.kutadguShop;
      return {
        https: shop.coverSrc({ image: "https://cdn.example/ok.webp" }),
        root: shop.coverSrc({ image: "/sample-book-cover.png" }),
        relative: shop.coverSrc({ image: "sample-book-cover.png" }),
        bad: shop.coverSrc({ image: "javascript:alert(1)" })
      };
    });
    expect(srcs.https).toBe("https://cdn.example/ok.webp");
    expect(srcs.root).toBe("/sample-book-cover.png");
    expect(srcs.relative).toMatch(/sample-book-cover\.png$/);
    expect(srcs.bad).not.toMatch(/javascript:/i);
  });

  test("admin login and Google OAuth helpers still present", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#adminEmail")).toBeVisible();

    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.kutadguGoogleAccountRedirectTo === "function");
    const oauth = await page.evaluate(() => ({
      origin: window.KUTADGU_SITE_ORIGIN,
      google: window.kutadguGoogleAccountRedirectTo()
    }));
    expect(oauth.origin).toBe("https://www.kutadgubilik.com");
    expect(oauth.google).toMatch(/\/account\.html$/);
    expect(oauth.google).not.toMatch(/reset-password/);

    await page.goto("/reset-password.html?type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
  });

  for (const [width, height] of [[390, 844], [412, 915], [768, 1024], [1280, 800]]) {
    test(`storefront does not overflow at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("#searchInput")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });
  }
});
