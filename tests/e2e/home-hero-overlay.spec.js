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

const SEEDED_STORE_SLIDES = [
  { enabled: true, sort_order: 0, origin: "repo", repo_key: "main", created_at: "2020-01-01" },
  { enabled: true, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01" },
  { enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01" }
];

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
  await expect(copy.locator("[data-home-hero-primary]")).toHaveAttribute("href", "/books");
  await expect(copy.locator("[data-home-hero-secondary]")).toHaveText(FALLBACK.secondary);
  await expect(copy.locator("[data-home-hero-secondary]")).toHaveAttribute("href", "#about");
  await expect(page.locator("[data-home-hero-title]")).toBeHidden();
  await expect(page.locator('img[src="/assets/store/shop-interior-main.webp"]')).toBeVisible();
  await expectDeferredSlides(page, REPO);
}

async function expectDeferredSlides(page, urls) {
  const slides = page.locator("[data-shop-hero-slide]");
  await expect(slides).toHaveCount(urls.length);
  await expect(slides.nth(0)).toHaveAttribute("src", urls[0]);
  await expect(slides.nth(0)).toHaveClass(/is-active/);
  for (let i = 1; i < urls.length; i += 1) {
    await expect(slides.nth(i)).toHaveAttribute("data-hero-src", urls[i]);
    await expect(slides.nth(i)).not.toHaveAttribute("src");
  }
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
    await expectDeferredSlides(page, [REPO[2], REPO[0]]);
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
    await expect(page.locator("[data-home-hero-primary]")).toHaveAttribute("href", "/books");
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

  test("campaign expiration with seeded repo slides restores hard-coded store media", async ({ page }) => {
    await mockHero(page, {
      slides: SEEDED_STORE_SLIDES,
      campaigns: [{
        enabled: true,
        sort_order: 0,
        title: "ۋاقىتلىق تەكلىپ",
        body: "ئالاھىدە تېكىست",
        image_url: REPO[1],
        created_at: "2020-01-01"
      }]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("ۋاقىتلىق تەكلىپ");
    await expect(page.locator("[data-home-hero-media]")).toHaveAttribute("aria-label", "ئالاھىدە تەۋسىيە");
    await expect(page.locator("[data-shop-hero-slide]")).toHaveAttribute("data-hero-kind", "campaign");
    await expect(page.locator(".home-bookstore-hero")).toHaveAttribute("data-hero-mode", "campaign");
    await mockHero(page, { slides: SEEDED_STORE_SLIDES, campaigns: [] });
    await page.evaluate(() => window.KutadguHeroContent.loadHero());
    await expect(page.locator("[data-home-hero-title]")).toBeHidden();
    await expect(page.locator(".home-bookstore-hero")).toHaveAttribute("data-hero-mode", "store");
    await expect(page.locator("[data-home-hero-media]")).toHaveAttribute("aria-label", "كىتابخانا رەسىملىرى");
    await expect(page.locator("[data-home-hero-media]")).not.toHaveAttribute("aria-label", "ئالاھىدە تەۋسىيە");
    await expectDeferredSlides(page, REPO);
    await expect(page.locator('[data-hero-kind="campaign"]')).toHaveCount(0);
    await expect(page.locator("[data-shop-hero-dot]")).toHaveCount(3);
    await expect(page.locator(".shop-hero-dots")).not.toHaveAttribute("hidden");
    await expectFallbackStore(page);
  });

  test("campaign image error falls back to the configured store gallery", async ({ page }) => {
    await mockHero(page, {
      slides: [
        { enabled: true, sort_order: 0, origin: "repo", repo_key: "exterior", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, origin: "repo", repo_key: "main", created_at: "2020-01-01" }
      ],
      campaigns: [{
        enabled: true,
        sort_order: 0,
        title: "ئاكتىپ تەكلىپ",
        image_url: REPO[1],
        created_at: "2020-01-01"
      }]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-title]")).toHaveText("ئاكتىپ تەكلىپ");
    await expect(page.locator("[data-shop-hero-slide]")).toHaveAttribute("data-hero-kind", "campaign");
    await page.evaluate(() => {
      document.querySelector("[data-shop-hero-slide]").dispatchEvent(new Event("error"));
    });
    await expect(page.locator(".home-bookstore-hero")).toHaveAttribute("data-hero-mode", "store");
    await expect(page.locator("[data-home-hero-title]")).toBeHidden();
    await expect(page.locator('[data-hero-kind="campaign"]')).toHaveCount(0);
    await expectDeferredSlides(page, [REPO[2], REPO[0]]);
    await expect(page.locator("[data-shop-hero-dot]")).toHaveCount(2);
  });

  test("store image exhaustion keeps settings copy and restores hardcoded media", async ({ page }) => {
    await mockHero(page, {
      settings: [{
        id: 1,
        rotation_interval_seconds: 10,
        eyebrow: "سىناق قاش قالدۇرۇلسۇن",
        body: "سىناق تېكىست قالدۇرۇلسۇن"
      }],
      slides: [
        { enabled: true, sort_order: 0, origin: "repo", repo_key: "main", alt_text: "بىرىنچى", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, origin: "repo", repo_key: "library", alt_text: "ئىككىنچى", created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-home-hero-eyebrow]")).toHaveText("سىناق قاش قالدۇرۇلسۇن");
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(2);
    await page.evaluate(() => {
      const slides = document.querySelectorAll("[data-shop-hero-slide]");
      slides[slides.length - 1].dispatchEvent(new Event("error"));
    });
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(1);
    await page.evaluate(() => {
      document.querySelector("[data-shop-hero-slide]").dispatchEvent(new Event("error"));
    });
    await expect(page.locator(".home-bookstore-hero")).toHaveAttribute("data-hero-mode", "store");
    await expect(page.locator("[data-home-hero-eyebrow]")).toHaveText("سىناق قاش قالدۇرۇلسۇن");
    await expect(page.locator("[data-home-hero-body]")).toHaveText("سىناق تېكىست قالدۇرۇلسۇن");
    await expectDeferredSlides(page, REPO);
    await expect(page.locator("[data-shop-hero-dot]")).toHaveCount(3);
    await expect(page.locator("[data-home-hero-media]")).toHaveAttribute("aria-label", "كىتابخانا رەسىملىرى");
    const interval = await page.evaluate(() => window.KutadguHeroSlideshow.getIntervalMs());
    expect(interval).toBe(10000);
  });

  test("repo main alt_text override is applied without changing store geometry", async ({ page }) => {
    await mockHero(page, {
      slides: [
        { enabled: true, sort_order: 0, origin: "repo", repo_key: "main", alt_text: "سىناق ئالت تېكىستى", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01" },
        { enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expectDeferredSlides(page, REPO);
    await expect(page.locator("[data-shop-hero-slide]").nth(0)).toHaveAttribute("alt", "سىناق ئالت تېكىستى");
    const fit = await page.locator("[data-shop-hero-slide]").nth(0).evaluate((el) => getComputedStyle(el).objectFit);
    expect(fit).toBe("cover");
  });

  test("store slide image error removes the matching dot", async ({ page }) => {
    await mockHero(page, {
      slides: [
        { enabled: true, sort_order: 0, origin: "repo", repo_key: "main", alt_text: "بىرىنچى", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, origin: "repo", repo_key: "library", alt_text: "ئىككىنچى", created_at: "2020-01-01" },
        { enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", alt_text: "ئۈچىنچى", created_at: "2020-01-01" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(3);
    await expect(page.locator("[data-shop-hero-dot]")).toHaveCount(3);
    await page.evaluate(() => {
      const img = document.querySelectorAll("[data-shop-hero-slide]")[1];
      img.dispatchEvent(new Event("error"));
    });
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(2);
    await expect(page.locator("[data-shop-hero-dot]")).toHaveCount(2);
    await page.evaluate(() => {
      const slides = document.querySelectorAll("[data-shop-hero-slide]");
      slides[slides.length - 1].dispatchEvent(new Event("error"));
    });
    await expect(page.locator("[data-shop-hero-slide]")).toHaveCount(1);
    await expect(page.locator(".shop-hero-dots")).toHaveAttribute("hidden", "");
    await page.evaluate(() => {
      document.querySelector("[data-shop-hero-slide]").dispatchEvent(new Event("error"));
    });
    await expectFallbackStore(page);
  });

  test("campaign mode has no overflow at 390 430 768 1366 and one dark mobile", async ({ page }) => {
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    await mockHero(page, {
      campaigns: [{
        enabled: true,
        sort_order: 0,
        title: "قۇتادغۇبىلىك كىتابخانىسىنىڭ ئالاھىدە ئەدەبىيات تەۋسىيەسى ۋە قەدىمكى تۈرك ئەسەرلىرى",
        body: "قەدىمكى تۈرك ئەدەبىياتىدىن زامانىۋى ئىلىم-پەنگىچە بولغان تۈرلۈك كىتابلارنى بىر يەرگە جەم قىلىپ خەلقىمىزگە تەۋسىيە قىلىمىز.",
        image_url: REPO[0],
        primary_label: "كىتابنى كۆرۈش",
        primary_href: "/book/42",
        secondary_label: "كىتابلار",
        secondary_href: "#books",
        created_at: "2020-01-01"
      }]
    });
    for (const width of [390, 430, 768, 1366]) {
      await page.setViewportSize({ width, height: width >= 1366 ? 900 : 844 });
      await openHero(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "campaign light " + width).toBeLessThanOrEqual(2);
      await expect(page.locator("[data-home-hero-title]")).toBeVisible();
      const fit = await page.locator("[data-shop-hero-slide]").first().evaluate((el) => getComputedStyle(el).objectFit);
      expect(fit, "contain " + width).toBe("contain");
      const primaryBox = await page.locator("[data-home-hero-primary]").boundingBox();
      expect(primaryBox && primaryBox.width, "primary " + width).toBeGreaterThan(40);
      const secondaryBox = await page.locator("[data-home-hero-secondary]").boundingBox();
      expect(secondaryBox && secondaryBox.height, "secondary " + width).toBeGreaterThan(20);
      await page.locator(".home-bookstore-hero").screenshot({
        path: path.join(outDir, `hero-overlay-campaign-${width}.png`)
      });
      if (width === 390) {
        await page.evaluate(() => {
          document.body.classList.add("dark-mode");
          document.documentElement.classList.add("dark-mode");
        });
        const darkOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(darkOverflow, "campaign dark 390").toBeLessThanOrEqual(2);
        await expect(page.locator("[data-home-hero-title]")).toBeVisible();
        await page.locator(".home-bookstore-hero").screenshot({
          path: path.join(outDir, "hero-overlay-campaign-390-dark.png")
        });
        await page.evaluate(() => {
          document.body.classList.remove("dark-mode");
          document.documentElement.classList.remove("dark-mode");
        });
      }
    }
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

  test("fresh load requests only the visible hero image until a slide is chosen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const heroUrls = [];
    page.on("request", (req) => {
      if (/shop-interior-library\.webp|shop-exterior\.webp/.test(req.url())) heroUrls.push(req.url());
    });
    await mockHero(page, { failCore: true });
    await openHero(page);
    await expect(page.locator("[data-shop-hero-slide].is-active")).toHaveAttribute("src", REPO[0]);
    await expect(page.locator("[data-shop-hero-slide].is-active")).toBeVisible();
    expect(heroUrls).toEqual([]);
    const before = await page.locator(".shop-hero-frame").boundingBox();
    await page.locator("[data-shop-hero-dot]").nth(1).click();
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveClass(/is-active/);
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveAttribute("src", REPO[1]);
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toBeVisible();
    const decoded = await page.locator("[data-shop-hero-slide].is-active").evaluate((img) => img.naturalWidth);
    expect(decoded).toBeGreaterThan(0);
    const after = await page.locator(".shop-hero-frame").boundingBox();
    expect(Math.abs(after.height - before.height)).toBeLessThan(2);
    expect(heroUrls.filter((url) => url.includes("shop-exterior"))).toEqual([]);
  });

  test("slow rejected and rapid hero moves keep the current photo until the chosen one is ready", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    let libraryHits = 0;
    await page.route("**/shop-interior-library.webp", async (route) => {
      libraryHits += 1;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return route.continue();
    });
    await page.route("**/missing-hero-slide.webp", (route) => route.abort("failed"));
    await mockHero(page, { failCore: true });
    await openHero(page);
    const main = page.locator("[data-shop-hero-slide]").nth(0);
    await page.locator("[data-shop-hero-dot]").nth(1).click();
    await page.locator("[data-shop-hero-dot]").nth(2).click();
    await expect(page.locator("[data-shop-hero-slide]").nth(2)).toHaveClass(/is-active/, { timeout: 10000 });
    await expect(main).not.toHaveClass(/is-active/);
    await expect(page.locator("[data-shop-hero-slide].is-active")).toHaveAttribute("src", REPO[2]);
    await page.locator("[data-shop-hero-dot]").nth(1).click();
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveClass(/is-active/);
    const hitsAfterLibrary = libraryHits;
    await page.locator("[data-shop-hero-dot]").nth(0).click();
    await expect(main).toHaveClass(/is-active/);
    await page.locator("[data-shop-hero-dot]").nth(1).click();
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveClass(/is-active/);
    expect(libraryHits).toBe(hitsAfterLibrary);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.setAttribute("data-shop-hero-slide", "");
      img.setAttribute("data-hero-src", "/missing-hero-slide.webp");
      img.alt = "missing";
      document.querySelector(".shop-hero-frame").appendChild(img);
      const dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("data-shop-hero-dot", "");
      dot.setAttribute("aria-label", "missing");
      document.querySelector(".shop-hero-dots").appendChild(dot);
      window.KutadguHeroSlideshow.refresh();
    });
    await page.locator("[data-shop-hero-dot]").nth(3).click();
    await page.waitForFunction(() => {
      const img = document.querySelectorAll("[data-shop-hero-slide]")[3];
      return !!(img && img.getAttribute("src") && img.complete);
    });
    await expect(page.locator("[data-shop-hero-slide].is-active")).toHaveAttribute("src", REPO[1]);
    await expect(page.locator("[data-shop-hero-slide].is-active")).toBeVisible();
  });

  test("keyboard, phone, desktop, and dark theme keep the visible hero", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockHero(page, { failCore: true });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 800 : 900 });
      await openHero(page);
      await expect(page.locator("[data-shop-hero-slide].is-active")).toBeVisible();
      await page.evaluate(() => {
        document.body.classList.add("dark-mode");
        document.documentElement.classList.add("dark-mode");
      });
      await expect(page.locator("[data-shop-hero-slide].is-active")).toBeVisible();
      const frame = await page.locator(".shop-hero-frame").boundingBox();
      expect(frame.height).toBeGreaterThan(80);
      await page.locator("[data-shop-hero-dot]").nth(1).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveClass(/is-active/);
      await page.evaluate(() => {
        document.body.classList.remove("dark-mode");
        document.documentElement.classList.remove("dark-mode");
      });
    }
  });

  test("disabled JavaScript still shows the first hero photo and skips inactive files", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    const inactive = [];
    page.on("request", (req) => {
      if (/shop-interior-library\.webp|shop-exterior\.webp/.test(req.url())) inactive.push(req.url());
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator('img[src="/assets/store/shop-interior-main.webp"]')).toBeVisible();
    expect(inactive).toEqual([]);
    const box = await page.locator(".shop-hero-frame").boundingBox();
    expect(box.height).toBeGreaterThan(80);
    await context.close();
  });

  test("configured custom slides defer every image after the first", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const seen = [];
    page.on("request", (req) => {
      if (/shop-interior-library\.webp/.test(req.url())) seen.push(new URL(req.url()).pathname);
    });
    await mockHero(page, {
      slides: [
        { enabled: true, sort_order: 0, origin: "upload", image_url: REPO[2], alt_text: "سىرت", created_at: "2020-01-01" },
        { enabled: true, sort_order: 1, origin: "upload", image_url: REPO[1], alt_text: "كۈتۈپخانا", created_at: "2020-01-02" }
      ]
    });
    await openHero(page);
    await expect(page.locator("[data-shop-hero-slide]").nth(0)).toHaveAttribute("src", REPO[2]);
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveAttribute("data-hero-src", REPO[1]);
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).not.toHaveAttribute("src");
    expect(seen).toEqual([]);
    await page.locator("[data-shop-hero-dot]").nth(1).click();
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveClass(/is-active/);
    await expect(page.locator("[data-shop-hero-slide]").nth(1)).toHaveAttribute("src", REPO[1]);
  });
});
