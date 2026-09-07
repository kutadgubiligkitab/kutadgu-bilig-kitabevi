const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");
const path = require("path");

const FALLBACK = {
  eyebrow: "قۇتادغۇبىلىك كىتابخانىسى",
  trust: "2013-يىلدىن بۇيان",
  primary: "كىتابلارنى كۆرۈش",
  secondary: "بىز ھەققىدە"
};

const REPO = [
  "/assets/store/shop-interior-main.webp",
  "/assets/store/shop-interior-library.webp",
  "/assets/store/shop-exterior.webp"
];

function json(route, body, status) {
  return route.fulfill({
    status: status || 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function mockHero(page, opts = {}) {
  const settings = opts.settings !== undefined ? opts.settings : [{ id: 1, rotation_interval_seconds: 7 }];
  const slides = opts.slides !== undefined ? opts.slides : [];
  const campaigns = opts.campaigns !== undefined ? opts.campaigns : [];
  const books = opts.books !== undefined ? opts.books : [];
  const failCore = !!opts.failCore;
  await page.route("**/rest/v1/store_hero_settings**", async (route) => {
    if (failCore) return json(route, { message: "missing" }, 404);
    return json(route, settings);
  });
  await page.route("**/rest/v1/store_hero_store_slides**", async (route) => {
    if (failCore) return json(route, { message: "missing" }, 404);
    return json(route, slides);
  });
  await page.route("**/rest/v1/store_hero_campaigns**", async (route) => {
    if (failCore) return json(route, { message: "missing" }, 404);
    return json(route, campaigns);
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const url = route.request().url();
    if (url.includes("id=in.") || (opts.books !== undefined && url.includes("select=id,title,image_url,stock,is_active"))) {
      return json(route, books);
    }
    return route.fallback();
  });
}

async function openHero(page) {
  await H.openFresh(page, "/");
  await page.waitForFunction(() => !!(window.KutadguHeroContent && window.KutadguHeroContent.ready), null, { timeout: 15000 });
  await page.evaluate(() => window.KutadguHeroContent.ready);
}

async function expectFallbackStore(page) {
  const copy = page.locator(".home-hero-copy");
  await expect(copy.locator("[data-home-hero-eyebrow]")).toHaveText(FALLBACK.eyebrow);
  await expect(copy.locator("[data-home-hero-trust]")).toHaveText(FALLBACK.trust);
  await expect(copy.locator("[data-home-hero-primary]")).toHaveText(FALLBACK.primary);
  await expect(copy.locator("[data-home-hero-primary]")).toHaveAttribute("href", "#books");
  await expect(copy.locator("[data-home-hero-secondary]")).toHaveText(FALLBACK.secondary);
  await expect(copy.locator("[data-home-hero-secondary]")).toHaveAttribute("href", "#about");
  await expect(page.locator("[data-home-hero-title]")).toBeHidden();
  await expect(page.locator('img[src="/assets/store/shop-interior-main.webp"]')).toBeVisible();
  await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(3);
  await expect(page.locator("[data-shop-hero-slide]").nth(0)).toHaveAttribute("src", REPO[0]);
  await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveAttribute("src", REPO[1]);
  await expect(page.locator("[data-shop-hero-slide]").nth(2)).toHaveAttribute("src", REPO[2]);
}

test.describe("homepage Hero overlay fail-open", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("missing Hero tables keep the hard-coded store Hero", async ({ page }) => {
    await openHero(page);
    await expectFallbackStore(page);
  });

  test("empty Hero rows keep the hard-coded store Hero", async ({ page }) => {
    await mockHero(page, { settings: [], slides: [], campaigns: [] });
    await openHero(page);
    await expectFallbackStore(page);
  });

  test("store settings copy and interval apply without replacing fallback photos", async ({ page }) => {
    await mockHero(page, {
      settings: [{
        id: 1,
        rotation_interval_seconds: 10,
        eyebrow: "سىناق قاش",
        trust_line: "2026",
        body: "سىناق تېكىست",
        primary_label: "كىتابلار",
        primary_href: "#books",
        secondary_label: "بىز",
        secondary_href: "#about"
      }],
      slides: [
        { enabled: true, sort_order: 0, origin: "repo", repo_key: "main", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01" },
        { enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-eyebrow]")).toHaveText("سىناق قاش");
    await expect(page.locator("[data-home-hero-trust]")).toHaveText("2026");
    await expect(page.locator("[data-home-hero-body]")).toHaveText("سىناق تېكىست");
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(3);
    await expect(page.locator("[data-shop-hero-slide]").nth(0)).toHaveAttribute("src", REPO[0]);
  });

  test("store slide reorder and disable change visible order", async ({ page }) => {
    await mockHero(page, {
      slides: [
        { enabled: true, sort_order: 2, origin: "repo", repo_key: "main", created_at: "2020-01-01" },
        { enabled: true, sort_order: 0, origin: "repo", repo_key: "exterior", created_at: "2020-01-01" },
        { enabled: false, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(2);
    await expect(page.locator("[data-shop-hero-slide]").nth(0)).toHaveAttribute("src", REPO[2]);
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveAttribute("src", REPO[0]);
  });

  test("no usable configured store slides restore the original 3 photos", async ({ page }) => {
    await mockHero(page, {
      slides: [
        { enabled: true, sort_order: 0, origin: "upload", repo_key: null, image_url: "javascript:alert(1)", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, origin: "repo", repo_key: "not-a-key", created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expectFallbackStore(page);
  });

  test("active linked-book campaign with stock > 0 is shown", async ({ page }) => {
    await mockHero(page, {
      campaigns: [{
        enabled: true,
        sort_order: 0,
        book_id: 42,
        title: "",
        image_url: null,
        created_at: "2020-01-01"
      }],
      books: [{
        id: 42,
        title: "ئالتۇن يورۇق",
        image_url: REPO[1],
        stock: 6,
        is_active: true
      }]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toBeVisible();
    await expect(page.locator("[data-home-hero-title]")).toHaveText("ئالتۇن يورۇق");
    await expect(page.locator("[data-home-hero-primary]")).toHaveText("كىتابنى كۆرۈش");
    await expect(page.locator("[data-home-hero-primary]")).toHaveAttribute("href", "/book/42");
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(1);
    await expect(page.locator("[data-shop-hero-slide]")).toHaveAttribute("data-hero-kind", "campaign");
  });

  test("linked book stock 0 is ignored", async ({ page }) => {
    await mockHero(page, {
      campaigns: [{ enabled: true, sort_order: 0, book_id: 7, image_url: REPO[0], created_at: "2020-01-01" }],
      books: [{ id: 7, title: "تۈگىگەن", image_url: REPO[0], stock: 0, is_active: true }]
    });
    await openHero(page);
    await expectFallbackStore(page);
  });

  test("missing or inactive linked book is ignored", async ({ page }) => {
    await mockHero(page, {
      campaigns: [
        { enabled: true, sort_order: 0, book_id: 8, image_url: REPO[0], created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, book_id: 9, image_url: REPO[0], created_at: "2020-01-01" }
      ],
      books: [{ id: 9, title: "يوشۇرۇن", image_url: REPO[0], stock: 4, is_active: false }]
    });
    await openHero(page);
    await expectFallbackStore(page);
  });

  test("custom campaign without book_id shows when title and image exist", async ({ page }) => {
    await mockHero(page, {
      campaigns: [{
        enabled: true,
        sort_order: 0,
        book_id: null,
        title: "باھار باھاسى",
        body: "ئالاھىدە تەكلىپ",
        image_url: REPO[2],
        primary_label: "كىتابلار",
        primary_href: "#books",
        created_at: "2020-01-01"
      }]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("باھار باھاسى");
    await expect(page.locator("[data-home-hero-body]")).toHaveText("ئالاھىدە تەكلىپ");
    await expect(page.locator("[data-shop-hero-slide]")).toHaveAttribute("src", REPO[2]);
  });

  test("malformed custom campaign is ignored", async ({ page }) => {
    await mockHero(page, {
      campaigns: [{ enabled: true, sort_order: 0, book_id: null, title: "يالغۇز ماۋزۇ", created_at: "2020-01-01" }]
    });
    await openHero(page);
    await expectFallbackStore(page);
  });

  test("unsafe button URL is never assigned", async ({ page }) => {
    await mockHero(page, {
      settings: [{
        id: 1,
        rotation_interval_seconds: 7,
        primary_href: "javascript:alert(1)",
        primary_label: "خەتەرلىك",
        secondary_href: "https://evil.example",
        secondary_label: "سىرت"
      }]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-primary]")).toHaveAttribute("href", "#books");
    await expect(page.locator("[data-home-hero-secondary]")).toHaveAttribute("href", "#about");
    await expect(page.locator("[data-home-hero-primary]")).toHaveText("خەتەرلىك");
  });

  test("XSS-looking campaign copy is plain text", async ({ page }) => {
    const xss = "<img src=x onerror=alert(1)>";
    await mockHero(page, {
      campaigns: [{
        enabled: true,
        sort_order: 0,
        title: xss,
        body: xss,
        image_url: REPO[0],
        created_at: "2020-01-01"
      }]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText(xss);
    await expect(page.locator("[data-home-hero-title] img")).toHaveCount(0);
    await expect(page.locator("[data-home-hero-body] img")).toHaveCount(0);
  });

  test("failed campaign image falls through to the next valid campaign", async ({ page }) => {
    await mockHero(page, {
      campaigns: [
        { enabled: true, sort_order: 0, title: "بىرىنچى", image_url: "/missing-hero-campaign.webp", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, title: "ئىككىنچى", image_url: REPO[1], created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("ئىككىنچى");
    await expect(page.locator("[data-shop-hero-slide]")).toHaveAttribute("src", REPO[1]);
  });

  test("multiple campaigns keep image and copy synchronized on dots", async ({ page }) => {
    await mockHero(page, {
      campaigns: [
        { enabled: true, sort_order: 0, title: "بىرىنچى تەكلىپ", image_url: REPO[0], created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, title: "ئىككىنچى تەكلىپ", image_url: REPO[1], created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("بىرىنچى تەكلىپ");
    await page.locator("[data-shop-hero-dot]").nth(1).click();
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveClass(/is-active/);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("ئىككىنچى تەكلىپ");
  });

  test("autoplay advances copy with the image", async ({ page }) => {
    await mockHero(page, {
      settings: [{ id: 1, rotation_interval_seconds: 5 }],
      campaigns: [
        { enabled: true, sort_order: 0, title: "بىرىنچى", image_url: REPO[0], created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, title: "ئىككىنچى", image_url: REPO[1], created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("بىرىنچى");
    await page.waitForTimeout(5200);
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveClass(/is-active/);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("ئىككىنچى");
  });

  test("reduced-motion disables autoplay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockHero(page, {
      settings: [{ id: 1, rotation_interval_seconds: 5 }],
      campaigns: [
        { enabled: true, sort_order: 0, title: "بىرىنچى", image_url: REPO[0], created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, title: "ئىككىنچى", image_url: REPO[1], created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await page.waitForTimeout(1600);
    await expect(page.locator("[data-shop-hero-slide]").nth(0)).toHaveClass(/is-active/);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("بىرىنچى");
  });

  test("campaign expiration returns to the store Hero", async ({ page }) => {
    const ends = new Date(Date.now() + 1200).toISOString();
    await mockHero(page, {
      campaigns: [{
        enabled: true,
        sort_order: 0,
        title: "ۋاقىتلىق",
        image_url: REPO[0],
        ends_at: ends,
        created_at: "2020-01-01"
      }]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("ۋاقىتلىق");
    await page.route("**/rest/v1/store_hero_campaigns**", async (route) => json(route, []));
    await page.waitForTimeout(1800);
    await expect(page.locator("[data-home-hero-title]")).toBeHidden();
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(3);
  });

  test("no overflow at 390 430 768 1366 in light and dark", async ({ page }) => {
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    await mockHero(page, { failCore: true });
    for (const width of [390, 430, 768, 1366]) {
      await page.setViewportSize({ width, height: width >= 1366 ? 900 : 844 });
      await openHero(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "light " + width).toBeLessThanOrEqual(2);
      await page.locator(".home-bookstore-hero").screenshot({
        path: path.join(outDir, `hero-overlay-${width}.png`)
      });
      await page.evaluate(() => {
        document.body.classList.add("dark-mode");
        document.documentElement.classList.add("dark-mode");
      });
      const darkOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(darkOverflow, "dark " + width).toBeLessThanOrEqual(2);
      if (width === 1366) {
        await page.locator(".home-bookstore-hero").screenshot({
          path: path.join(outDir, "hero-overlay-1366-dark.png")
        });
      }
      await page.evaluate(() => {
        document.body.classList.remove("dark-mode");
        document.documentElement.classList.remove("dark-mode");
      });
    }
  });
});
