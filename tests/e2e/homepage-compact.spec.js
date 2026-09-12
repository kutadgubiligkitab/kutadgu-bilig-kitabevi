const { test, expect } = require("./playwright-test");
const H = require("./helpers");

test.describe("homepage compact first-view", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("idle #searchResults does not consume vertical space", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#searchResults .advanced-search-hint")).toHaveCount(0);
    const box = await page.locator("#searchResults").boundingBox();
    const height = box ? box.height : 0;
    expect(height).toBeLessThan(8);
  });

  test("search still returns results after typing", async ({ page }) => {
    const book = await H.discoverLiveBook(page);
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill(book.searchToken);
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
    await expect(page.locator(`.advanced-search-result[data-live-book-id="${book.id}"]`)).toBeVisible();
    const box = await page.locator("#searchResults").boundingBox();
    expect(box && box.height).toBeGreaterThan(40);
  });

  test("id=books search section stays below the sticky header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/#books");
    await expect.poll(async () => new URL(page.url()).hash).toBe("#books");
    const gap = await page.evaluate(() => {
      const header = document.querySelector("header");
      const books = document.querySelector("#books");
      if (!header || !books) return -1;
      return books.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  test("homepage carousel remains visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack, .home-carousel-card").first()).toBeVisible();
  });

  test("recommended empty + new books → newest tab opens", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: false, newest: true, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-carousel-mode="recommended"]')).toBeVisible();
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
  });

  test("recommended books + new empty → recommended tab opens", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
  });

  test("both recommended and new books keep both tabs usable", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-carousel-mode="newest"]')).toBeVisible();
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator('[data-carousel-mode="newest"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
  });

  test("all carousel modes empty keep the existing empty state", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: false, newest: false, bestseller: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
    await expect(page.locator("#homeCarouselTrack .home-carousel-card")).toHaveCount(0);
    await expect(page.locator("#homeCarouselTrack")).toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
    await expect(page.locator("#homeCarouselTrack")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card.is-skeleton")).toHaveCount(0);
    await expect(page.locator("#homeCarouselDots .home-carousel-dot")).toHaveCount(0);
    const before = await page.locator("#homeCarouselTrack").innerHTML();
    await page.waitForTimeout(1600);
    await expect(page.locator("#homeCarouselTrack")).toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
    expect(await page.locator("#homeCarouselTrack").innerHTML()).toBe(before);
  });

  test("featured query failure clears busy skeleton and marquee flags", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, failFeatured: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    const grid = page.locator("#homeFeaturedBooks .home-featured-grid");
    await expect(grid).toContainText("يېقىندا قوشۇلغان كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    await expect(grid).not.toHaveAttribute("aria-busy", "true");
    await expect(grid).not.toHaveClass(/is-skeleton-grid/);
    await expect(grid).not.toHaveClass(/is-marquee/);
    await expect(page.locator("#homeFeaturedBooks .home-feature-card.is-skeleton")).toHaveCount(0);
    await expect(page.locator("#homeFeaturedBooks .home-feature-card")).toHaveCount(0);
  });

  test("carousel query error clears busy, skeletons, dots, and autoplay", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, failNewest: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    await expect(page.locator("#homeCarouselTrack")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card")).toHaveCount(0);
    await expect(page.locator("#homeCarouselDots .home-carousel-dot")).toHaveCount(0);
    const before = await page.locator("#homeCarouselTrack").innerHTML();
    await page.waitForTimeout(1600);
    expect(await page.locator("#homeCarouselTrack").innerHTML()).toBe(before);
  });

  test("carousel mode loading sets aria-busy then clears after success", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false, holdNewest: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card:not(.is-skeleton)").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).not.toHaveAttribute("aria-busy", "true");
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator("#homeCarouselTrack .home-carousel-card.is-skeleton").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).toHaveAttribute("aria-busy", "true");
    await page.evaluate(() => window.__releaseCarouselNewest && window.__releaseCarouselNewest());
    await expect(page.locator("#homeCarouselTrack .home-carousel-card:not(.is-skeleton)").first()).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).toContainText("Newest Stub");
    await expect(page.locator("#homeCarouselTrack")).not.toHaveAttribute("aria-busy", "true");
  });

  test("stale carousel mode request does not overwrite the current mode", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false, holdNewest: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack")).toContainText("Recommended Stub");
    await page.locator('[data-carousel-mode="newest"]').click();
    await expect(page.locator("#homeCarouselTrack .home-carousel-card.is-skeleton").first()).toBeVisible();
    await page.locator('[data-carousel-mode="recommended"]').click();
    await expect(page.locator("#homeCarouselTrack")).toContainText("Recommended Stub");
    await expect(page.locator("#homeCarouselTrack")).not.toHaveAttribute("aria-busy", "true");
    await page.evaluate(() => window.__releaseCarouselNewest && window.__releaseCarouselNewest());
    await page.waitForTimeout(400);
    await expect(page.locator("#homeCarouselTrack")).toContainText("Recommended Stub");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("Newest Stub");
    await expect(page.locator("#homeCarouselTrack")).not.toContainText("كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    await expect(page.locator('[data-carousel-mode="recommended"]')).toHaveClass(/is-active/);
  });

  for (const width of [390, 430, 768, 1366]) {
    test(`empty and error homepage states fit at ${width}px`, async ({ page }) => {
      await H.installCarouselCatalogStub(page, {
        recommended: false,
        newest: false,
        bestseller: false,
        failFeatured: true
      });
      await page.setViewportSize({ width, height: 900 });
      await H.openFresh(page, "/");
      await expect(page.locator("#homeCarouselTrack")).toContainText("بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى");
      await expect(page.locator("#homeCarouselTrack")).not.toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#homeFeaturedBooks .home-featured-grid")).toContainText("يېقىندا قوشۇلغان كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
      await expect(page.locator("#homeFeaturedBooks .home-featured-grid")).not.toHaveClass(/is-skeleton-grid/);
      const metrics = await page.evaluate(() => {
        const carousel = document.querySelector("#newBooksCarousel");
        const featured = document.querySelector("#homeFeaturedBooks");
        const track = document.querySelector("#homeCarouselTrack");
        const grid = document.querySelector("#homeFeaturedBooks .home-featured-grid");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          carouselH: carousel ? carousel.getBoundingClientRect().height : 0,
          featuredH: featured ? featured.getBoundingClientRect().height : 0,
          trackBusy: track ? track.getAttribute("aria-busy") : "missing",
          gridBusy: grid ? grid.getAttribute("aria-busy") : "missing"
        };
      });
      expect(metrics.overflow).toBeLessThanOrEqual(4);
      expect(metrics.carouselH).toBeGreaterThan(80);
      expect(metrics.featuredH).toBeGreaterThan(80);
      expect(metrics.trackBusy).not.toBe("true");
      expect(metrics.gridBusy).not.toBe("true");
    });
  }

  test("more than 4 books auto-advance by one book", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform), { timeout: 8_000 }).not.toBe(before);
  });

  test("4 or fewer books do not auto-advance", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 4 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.waitForTimeout(5200);
    const after = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    expect(after).toBe(before);
  });

  test("hover pauses auto-slide and mouse leave resumes it", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    await page.locator("#newBooksCarousel").hover();
    const paused = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.waitForTimeout(5200);
    const still = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    expect(still).toBe(paused);
    await page.locator("header").hover();
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform), { timeout: 8_000 }).not.toBe(paused);
  });

  test("manual carousel arrows still move books", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.locator("#carouselNext").click();
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform)).not.toBe(before);
    const afterNext = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.locator("#carouselPrev").click();
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform)).not.toBe(afterNext);
  });

  test("reduced motion disables automatic carousel animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.waitForTimeout(5200);
    const after = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    expect(after).toBe(before);
  });

  test("mobile carousel has no horizontal overflow and swipe still moves", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 6 });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(4);
    const swipeReady = await page.locator("#homeCarouselViewport").evaluate((el) => el.dataset.mobileSwipe === "1");
    expect(swipeReady).toBe(true);
    const before = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
    await page.evaluate(() => {
      const viewport = document.querySelector("#homeCarouselViewport");
      const TouchCls = window.Touch;
      const fire = (type, x) => {
        if (typeof TouchCls === "function") {
          const t = new TouchCls({ identifier: 1, target: viewport, clientX: x, clientY: 80, radiusX: 2, radiusY: 2, rotationAngle: 0, force: 1 });
          viewport.dispatchEvent(new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === "touchend" ? [] : [t],
            targetTouches: type === "touchend" ? [] : [t],
            changedTouches: [t]
          }));
          return;
        }
        document.querySelector("#carouselNext")?.click();
      };
      fire("touchstart", 280);
      fire("touchend", 160);
    });
    await expect.poll(async () => page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform)).not.toBe(before);
  });

  test("mobile homepage search tap target is not cramped", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    const metrics = await page.evaluate(() => {
      const btn = document.querySelector("#searchButton");
      const input = document.querySelector("#searchInput");
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return {
        buttonHeight: btn ? btn.getBoundingClientRect().height : 0,
        inputHeight: input ? input.getBoundingClientRect().height : 0,
        overflow
      };
    });
    expect(metrics.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.inputHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.overflow).toBeLessThanOrEqual(4);
  });

  test("homepage section order puts books before category cards", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#books")).toHaveCount(1);
    await expect(page.locator("#newBooksCarousel")).toHaveCount(1);
    await expect(page.locator("#homeFeaturedBooks")).toHaveCount(1);
    await expect(page.locator("#bookCategories")).toHaveCount(1);
    await expect(page.locator("#searchInput")).toHaveCount(1);
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator("#homeCarouselTrack")).toBeVisible();
    await expect(page.locator("#homeFeaturedBooks .home-featured-section, #homeFeaturedBooks .home-feature-card, #homeFeaturedBooks .empty-state").first()).toBeVisible();
    await page.waitForSelector("#premiumDiscovery", { timeout: 45_000 });
    await expect(page.locator("#premiumDiscovery")).toHaveCount(1);
    const ordered = await page.evaluate(() => {
      const ids = ["books", "newBooksCarousel", "homeFeaturedBooks", "premiumDiscovery", "bookCategories", "orderProcess"];
      const nodes = ids.map((id) => document.getElementById(id));
      if (nodes.some((n) => !n)) return { missing: ids.filter((id, i) => !nodes[i]) };
      const ok = nodes.every((node, i) => i === 0 || !!(nodes[i - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { ok, ids };
    });
    expect(ordered.missing || []).toEqual([]);
    expect(ordered.ok).toBe(true);
    const book = await H.discoverLiveBook(page);
    await page.locator("#searchInput").fill(book.searchToken);
    await page.locator("#searchButton").click();
    await page.waitForSelector(".advanced-search-result, .advanced-search-summary", { timeout: 45_000 });
    await expect(page.locator("#searchResults")).toContainText("كىتاب تېپىلدى");
    await expect(page.locator(`.advanced-search-result[data-live-book-id="${book.id}"]`)).toBeVisible();
    await page.locator("#premiumDiscovery [data-premium-group]").first().click();
    await expect(page.locator("#premiumDiscoveryResults .premium-book-grid, #premiumDiscoveryResults .premium-friendly-empty").first()).toBeVisible();
    await expect(page.locator('#bookCategories a.card[href="/adabiyat"]')).toBeVisible();
    await expect(page.locator('#bookCategories a.card[href="/dini"]')).toBeVisible();
    await expect(page.locator('#bookCategories a.card[href="/children"]')).toBeVisible();
  });

  test("mobile homepage section order has no overflow regression", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#newBooksCarousel")).toBeVisible();
    await expect(page.locator("#homeFeaturedBooks")).toBeVisible();
    await expect(page.locator("#bookCategories")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(4);
    const tops = await page.evaluate(() => {
      const ids = ["books", "newBooksCarousel", "homeFeaturedBooks", "bookCategories"];
      return Object.fromEntries(ids.map((id) => {
        const el = document.getElementById(id);
        return [id, el ? el.getBoundingClientRect().top : null];
      }));
    });
    expect(tops.books).toBeLessThan(tops.newBooksCarousel);
    expect(tops.newBooksCarousel).toBeLessThan(tops.homeFeaturedBooks);
    expect(tops.homeFeaturedBooks).toBeLessThan(tops.bookCategories);
  });

  test("homepage category icons are decorative and hrefs stay intact", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    const cards = page.locator("#bookCategories a.card");
    await expect(cards).toHaveCount(9);
    await expect(page.locator("#bookCategories a.card .icon")).toHaveCount(9);
    await expect(page.locator('#bookCategories a.card .icon[aria-hidden="true"]')).toHaveCount(9);
    const hrefs = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(hrefs).toEqual(["/adabiyat", "/universal", "/tibb", "/derslik", "/terbiye", "/dini", "/children", "/dictionary", "/grammar"]);
    expect(hrefs.every((href) => href && !href.includes(".html"))).toBeTruthy();
  });

  for (const width of [390, 430, 768, 1366]) {
    test(`homepage category grid polish at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await H.openFresh(page, "/");
      await page.locator("#bookCategories").scrollIntoViewIfNeeded();
      await expect(page.locator("#bookCategories a.card")).toHaveCount(9);
      const metrics = await page.evaluate(() => {
        const grid = document.querySelector("#bookCategories .cards");
        const cards = [...document.querySelectorAll("#bookCategories a.card")];
        const last = cards[cards.length - 1];
        const seventh = cards[6];
        const first = cards[0];
        const gridBox = grid.getBoundingClientRect();
        const lastBox = last.getBoundingClientRect();
        const firstBox = first.getBoundingClientRect();
        const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean);
        const lastCenter = lastBox.left + lastBox.width / 2;
        const gridCenter = gridBox.left + gridBox.width / 2;
        const boxes = cards.map((c) => c.getBoundingClientRect());
        let overlap = false;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const separate = a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
            if (!separate) overlap = true;
          }
        }
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          colCount: cols.length,
          hrefs: cards.map((el) => el.getAttribute("href")),
          firstW: firstBox.width,
          lastW: lastBox.width,
          lastLeft: lastBox.left,
          firstTop: firstBox.top,
          secondTop: cards[1].getBoundingClientRect().top,
          lastTop: lastBox.top,
          sixthTop: cards[5].getBoundingClientRect().top,
          seventhTop: seventh ? seventh.getBoundingClientRect().top : 0,
          eighthTop: cards[7] ? cards[7].getBoundingClientRect().top : 0,
          ninthTop: cards[8] ? cards[8].getBoundingClientRect().top : 0,
          centerDelta: Math.abs(lastCenter - gridCenter),
          nth7: seventh ? getComputedStyle(seventh).gridColumnStart : "",
          overlap
        };
      });
      expect(metrics.overflow).toBeLessThanOrEqual(4);
      expect(metrics.overlap).toBe(false);
      expect(metrics.hrefs).toEqual(["/adabiyat", "/universal", "/tibb", "/derslik", "/terbiye", "/dini", "/children", "/dictionary", "/grammar"]);
      expect(metrics.hrefs.every((href) => href && !href.includes(".html"))).toBeTruthy();
      if (width <= 768) {
        expect(metrics.colCount).toBe(2);
        expect(Math.abs(metrics.firstTop - metrics.secondTop)).toBeLessThan(2);
        expect(metrics.lastTop).toBeGreaterThan(metrics.sixthTop + 8);
        expect(metrics.centerDelta).toBeLessThan(8);
        expect(Math.abs(metrics.lastW - metrics.firstW)).toBeLessThan(12);
      } else {
        expect(metrics.colCount).toBe(8);
        expect(metrics.nth7).toBe("6");
        const rows = await page.evaluate(() => {
          const cards = [...document.querySelectorAll("#bookCategories a.card")];
          const top = Math.round(cards[0].getBoundingClientRect().top);
          const second = Math.round(cards[4].getBoundingClientRect().top);
          const third = Math.round(cards[7].getBoundingClientRect().top);
          return {
            firstRow: cards.slice(0, 4).every((c) => Math.abs(c.getBoundingClientRect().top - top) < 2),
            originalSecondRow: cards.slice(4, 7).every((c) => Math.abs(c.getBoundingClientRect().top - second) < 2),
            appendedThirdRow: cards.slice(7, 9).every((c) => Math.abs(c.getBoundingClientRect().top - third) < 2)
          };
        });
        expect(rows.firstRow).toBe(true);
        expect(rows.originalSecondRow).toBe(true);
        expect(rows.appendedThirdRow).toBe(true);
        expect(metrics.seventhTop).toBeGreaterThan(metrics.firstTop + 8);
        expect(metrics.eighthTop).toBeGreaterThan(metrics.seventhTop + 8);
        expect(Math.abs(metrics.eighthTop - metrics.ninthTop)).toBeLessThan(2);
      }
    });
  }

  test("homepage category cards keep contrast in dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await H.openFresh(page, "/");
    await page.evaluate(() => document.body.classList.add("dark-mode"));
    await page.locator("#bookCategories").scrollIntoViewIfNeeded();
    const contrast = await page.evaluate(() => {
      const card = document.querySelector("#bookCategories a.card");
      const title = card.querySelector("h3");
      const cs = getComputedStyle(card);
      const ts = getComputedStyle(title);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, title: ts.color, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(contrast.overflow).toBeLessThanOrEqual(4);
    expect(contrast.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(contrast.title).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator("#bookCategories a.card")).toHaveCount(9);
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.locator("#bookCategories a.card")).toHaveCount(9);
    const desktop = await page.evaluate(() => getComputedStyle(document.querySelector("#bookCategories .cards")).gridTemplateColumns.split(" ").length);
    expect(desktop).toBe(8);
  });

  test("featured desktop marquee shows two visible rows without page overflow", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 20 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks [data-featured-row]")).toHaveCount(2);
    await expect(page.locator('[data-featured-row="top"]')).toBeVisible();
    await expect(page.locator('[data-featured-row="bottom"]')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const top = document.querySelector('[data-featured-row="top"]');
      const bottom = document.querySelector('[data-featured-row="bottom"]');
      const topBox = top ? top.getBoundingClientRect() : null;
      const bottomBox = bottom ? bottom.getBoundingClientRect() : null;
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const display = getComputedStyle(document.querySelector("#homeFeaturedBooks .home-featured-grid.is-marquee")).display;
      const maskOf = (el) => {
        const style = el ? getComputedStyle(el) : null;
        return style ? `${style.maskImage || ""} ${style.webkitMaskImage || ""}` : "";
      };
      const filled = (rowEl) => {
        if (!rowEl) return { full: 0, lead: 99, trail: 99, half: 99 };
        const rowBox = rowEl.getBoundingClientRect();
        const cards = [...rowEl.querySelectorAll(".home-feature-card")].map((el) => el.getBoundingClientRect());
        const full = cards.filter((box) => box.left >= rowBox.left - 2 && box.right <= rowBox.right + 2);
        const overlapping = cards.filter((box) => box.right > rowBox.left + 2 && box.left < rowBox.right - 2);
        const half = overlapping.length - full.length;
        const lead = full.length ? Math.abs(full[0].left - rowBox.left) : 99;
        const trail = full.length ? Math.abs(rowBox.right - full[full.length - 1].right) : 99;
        return { full: full.length, lead, trail, half };
      };
      return {
        overflow,
        display,
        clones: document.querySelectorAll("#homeFeaturedBooks [data-featured-clone]").length,
        overlays: document.querySelectorAll("#homeFeaturedBooks [data-edge-fade], #homeFeaturedBooks .featured-edge-fade").length,
        topMask: maskOf(top),
        bottomMask: maskOf(bottom),
        topFill: filled(top),
        bottomFill: filled(bottom),
        topH: topBox ? topBox.height : 0,
        bottomH: bottomBox ? bottomBox.height : 0,
        stacked: !!(topBox && bottomBox && bottomBox.top >= topBox.bottom - 1)
      };
    });
    expect(metrics.display).toBe("flex");
    expect(metrics.clones).toBe(0);
    expect(metrics.overlays).toBe(0);
    expect(metrics.topMask.replace(/\s+/g, " ").trim()).toMatch(/^(none none|none)$/i);
    expect(metrics.bottomMask.replace(/\s+/g, " ").trim()).toMatch(/^(none none|none)$/i);
    expect(metrics.topFill.full).toBe(5);
    expect(metrics.bottomFill.full).toBe(5);
    expect(metrics.topFill.half).toBe(0);
    expect(metrics.bottomFill.half).toBe(0);
    expect(metrics.topFill.lead).toBeLessThan(3);
    expect(metrics.bottomFill.lead).toBeLessThan(3);
    expect(metrics.topFill.trail).toBeLessThan(3);
    expect(metrics.bottomFill.trail).toBeLessThan(3);
    expect(metrics.topH).toBeGreaterThan(40);
    expect(metrics.bottomH).toBeGreaterThan(40);
    expect(metrics.stacked).toBe(true);
    expect(metrics.overflow).toBeLessThanOrEqual(4);
  });

  test("featured top and bottom rows move in opposite directions", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-direction", "rtl");
    await expect(page.locator('[data-featured-row="bottom"]')).toHaveAttribute("data-direction", "ltr");
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "1");
    await expect(page.locator('[data-featured-row="bottom"]')).toHaveAttribute("data-autoplay", "1");
    const before = await page.evaluate(() => {
      const ids = (which) => [...document.querySelectorAll(`[data-featured-row="${which}"] .home-feature-card [data-fav-id]`)].map((el) => el.getAttribute("data-fav-id"));
      return { top: ids("top"), bottom: ids("bottom") };
    });
    await expect.poll(async () => page.evaluate(() => {
      const ids = (which) => [...document.querySelectorAll(`[data-featured-row="${which}"] .home-feature-card [data-fav-id]`)].map((el) => el.getAttribute("data-fav-id"));
      return { top: ids("top"), bottom: ids("bottom") };
    }), { timeout: 9_000 }).not.toEqual(before);
    await expect.poll(async () => {
      const now = await page.evaluate(() => {
        const ids = (which) => [...document.querySelectorAll(`[data-featured-row="${which}"] .home-feature-card [data-fav-id]`)].map((el) => el.getAttribute("data-fav-id"));
        return { top: ids("top"), bottom: ids("bottom") };
      });
      return now.top[0] !== before.top[0] && now.bottom[0] !== before.bottom[0];
    }, { timeout: 9_000 }).toBe(true);
    const after = await page.evaluate(() => {
      const ids = (which) => [...document.querySelectorAll(`[data-featured-row="${which}"] .home-feature-card [data-fav-id]`)].map((el) => el.getAttribute("data-fav-id"));
      return { top: ids("top"), bottom: ids("bottom") };
    });
    expect(after.top[0]).toBe(before.top[1]);
    expect(after.top[after.top.length - 1]).toBe(before.top[0]);
    expect(after.bottom[0]).toBe(before.bottom[before.bottom.length - 1]);
    expect(after.bottom[1]).toBe(before.bottom[0]);
    expect(new Set(after.top).size).toBe(after.top.length);
    expect(new Set(after.bottom).size).toBe(after.bottom.length);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(4);
  });

  test("featured marquee recycles original cards without clones or gaps", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 20 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks [data-featured-clone]")).toHaveCount(0);
    const before = await page.evaluate(() => {
      const ids = (which) => [...document.querySelectorAll(`[data-featured-row="${which}"] .home-feature-card [data-fav-id]`)].map((el) => el.getAttribute("data-fav-id"));
      return {
        top: ids("top"),
        bottom: ids("bottom"),
        topCount: document.querySelectorAll('[data-featured-row="top"] .home-feature-card').length,
        bottomCount: document.querySelectorAll('[data-featured-row="bottom"] .home-feature-card').length
      };
    });
    expect(before.topCount).toBe(10);
    expect(before.bottomCount).toBe(10);
    expect(new Set(before.top).size).toBe(before.top.length);
    expect(new Set(before.bottom).size).toBe(before.bottom.length);
    await expect.poll(async () => {
      const now = await page.evaluate(() => {
        const ids = (which) => [...document.querySelectorAll(`[data-featured-row="${which}"] .home-feature-card [data-fav-id]`)].map((el) => el.getAttribute("data-fav-id"));
        return { top: ids("top"), bottom: ids("bottom") };
      });
      return now.top[0] !== before.top[0] && now.bottom[0] !== before.bottom[0];
    }, { timeout: 9_000 }).toBe(true);
    const after = await page.evaluate(() => {
      const ids = (which) => [...document.querySelectorAll(`[data-featured-row="${which}"] .home-feature-card [data-fav-id]`)].map((el) => el.getAttribute("data-fav-id"));
      const gaps = (which) => {
        const row = document.querySelector(`[data-featured-row="${which}"]`);
        const rowBox = row.getBoundingClientRect();
        const cards = [...row.querySelectorAll(".home-feature-card")]
          .map((el) => el.getBoundingClientRect())
          .filter((box) => box.right > rowBox.left + 2 && box.left < rowBox.right - 2)
          .sort((a, b) => a.left - b.left);
        let maxGap = 0;
        for (let i = 1; i < cards.length; i++) maxGap = Math.max(maxGap, cards[i].left - cards[i - 1].right);
        const trailing = cards.length ? rowBox.right - cards[cards.length - 1].right : rowBox.width;
        const full = cards.filter((box) => box.left >= rowBox.left - 2 && box.right <= rowBox.right + 2);
        return { maxGap, trailing, visible: cards.length, full: full.length, half: cards.length - full.length };
      };
      return {
        top: ids("top"),
        bottom: ids("bottom"),
        clones: document.querySelectorAll("#homeFeaturedBooks [data-featured-clone]").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        topCount: document.querySelectorAll('[data-featured-row="top"] .home-feature-card').length,
        bottomCount: document.querySelectorAll('[data-featured-row="bottom"] .home-feature-card').length,
        topGaps: gaps("top"),
        bottomGaps: gaps("bottom")
      };
    });
    expect(after.clones).toBe(0);
    expect(after.topCount).toBe(before.topCount);
    expect(after.bottomCount).toBe(before.bottomCount);
    expect(new Set(after.top).size).toBe(after.top.length);
    expect(new Set(after.bottom).size).toBe(after.bottom.length);
    expect(after.top[0]).toBe(before.top[1]);
    expect(after.bottom[0]).toBe(before.bottom[before.bottom.length - 1]);
    expect(after.topGaps.visible).toBe(5);
    expect(after.bottomGaps.visible).toBe(5);
    expect(after.topGaps.full).toBe(5);
    expect(after.bottomGaps.full).toBe(5);
    expect(after.topGaps.half).toBe(0);
    expect(after.bottomGaps.half).toBe(0);
    expect(after.topGaps.maxGap).toBeLessThan(24);
    expect(after.bottomGaps.maxGap).toBeLessThan(24);
    expect(after.topGaps.trailing).toBeLessThan(4);
    expect(after.bottomGaps.trailing).toBeLessThan(4);
    expect(after.overflow).toBeLessThanOrEqual(4);
  });

  test("featured controls still work after a rotation", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 20 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    const beforeFirst = await page.locator('[data-featured-row="top"] .home-feature-card [data-fav-id]').first().getAttribute("data-fav-id");
    await expect.poll(async () => page.locator('[data-featured-row="top"] .home-feature-card [data-fav-id]').first().getAttribute("data-fav-id"), { timeout: 9_000 }).not.toBe(beforeFirst);
    const card = page.locator('[data-featured-row="top"] .home-feature-card').first();
    await expect(card).toBeVisible();
    const href = await card.locator("a").first().getAttribute("href");
    expect(href).toMatch(/\/book\/\d+/);
    expect(href).not.toMatch(/book\.html/);
    await card.locator(".home-feature-heart").click();
    await expect(card.locator(".home-feature-heart")).toHaveAttribute("aria-pressed", "true");
    const beforeCart = await H.badgeCount(page);
    await card.locator("[data-cart-id]").click();
    await expect.poll(async () => H.badgeCount(page)).toBeGreaterThan(beforeCart);
  });

  test("featured rows with too few books do not autoplay", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 4 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks .home-feature-card").first()).toBeVisible();
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "0");
    await expect(page.locator('[data-featured-row="bottom"]')).toHaveAttribute("data-autoplay", "0");
    const before = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    await page.waitForTimeout(5800);
    const after = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    expect(after).toEqual(before);
  });

  test("recently-added title and author are RTL and right-aligned; price row stays space-between", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 8 });
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width >= 1000 ? 900 : 844 });
      await H.openFresh(page, "/");
      await expect(page.locator("#homeFeaturedBooks .home-featured-all")).toBeVisible();
      await expect.poll(async () => page.locator("#homeFeaturedBooks .home-feature-card:not(.is-skeleton) .home-feature-title").count()).toBeGreaterThan(0);
      const geo = await page.evaluate(() => {
        const card = document.querySelector("#homeFeaturedBooks .home-feature-card:not(.is-skeleton)");
        if (!card) return { missing: true };
        const title = card.querySelector(".home-feature-title");
        const author = card.querySelector(".home-feature-author");
        const price = card.querySelector(".home-feature-price");
        const bottom = card.querySelector(".home-feature-bottom");
        const cart = card.querySelector(".home-feature-cart");
        const titleStyle = title ? getComputedStyle(title) : null;
        const authorStyle = author ? getComputedStyle(author) : null;
        return {
          missing: false,
          titleDirection: titleStyle ? titleStyle.direction : "",
          titleAlign: titleStyle ? titleStyle.textAlign : "",
          authorDirection: authorStyle ? authorStyle.direction : "",
          authorAlign: authorStyle ? authorStyle.textAlign : "",
          bottomJustify: bottom ? getComputedStyle(bottom).justifyContent : "",
          hasPrice: !!price,
          hasCart: !!cart
        };
      });
      expect(geo.missing, String(width)).toBeFalsy();
      expect(geo.titleDirection, String(width)).toBe("rtl");
      expect(geo.titleAlign, String(width)).toBe("right");
      expect(geo.authorDirection, String(width)).toBe("rtl");
      expect(geo.authorAlign, String(width)).toBe("right");
      expect(geo.bottomJustify, String(width)).toBe("space-between");
      expect(geo.hasPrice, String(width)).toBeTruthy();
      expect(geo.hasCart, String(width)).toBeTruthy();
    }
  });

  test("featured hover pauses both rows and mouse leave resumes", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "1");
    await page.locator("#homeFeaturedBooks .home-featured-section").hover();
    const paused = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    await page.waitForTimeout(5800);
    const still = await page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    }));
    expect(still).toEqual(paused);
    await page.locator("header").hover();
    await expect.poll(async () => page.evaluate(() => ({
      top: document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "",
      bottom: document.querySelector('[data-featured-row="bottom"] .home-featured-track')?.style.transform || ""
    })), { timeout: 8_000 }).not.toEqual(paused);
  });

  test("reduced motion disables featured autoplay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks .home-feature-card").first()).toBeVisible();
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "0");
    const before = await page.evaluate(() => document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "");
    await page.waitForTimeout(5800);
    const after = await page.evaluate(() => document.querySelector('[data-featured-row="top"] .home-featured-track')?.style.transform || "");
    expect(after).toBe(before);
  });

  test("mobile featured has no forced autoplay or horizontal overflow", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#homeFeaturedBooks .home-feature-card").first()).toBeVisible();
    await expect(page.locator('[data-featured-row="top"]')).toHaveAttribute("data-autoplay", "0");
    const metrics = await page.evaluate(() => {
      const row = document.querySelector('[data-featured-row="top"]');
      const track = document.querySelector('[data-featured-row="top"] .home-featured-track');
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const display = track ? getComputedStyle(track).display : "";
      const transform = track ? track.style.transform : "";
      const style = row ? getComputedStyle(row) : null;
      const mask = style ? `${style.maskImage || ""} ${style.webkitMaskImage || ""}` : "";
      return { overflow, display, transform, mask };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(4);
    expect(metrics.display).toBe("contents");
    expect(!metrics.transform || metrics.transform === "none" || metrics.transform === "").toBeTruthy();
    expect(metrics.mask.replace(/\s+/g, " ").trim()).toMatch(/^(none none|none)$/i);
  });

  test("featured card heart, cart, and links stay usable", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, featuredCount: 12 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    const card = page.locator('[data-featured-row="top"] .home-feature-card').first();
    await expect(card).toBeVisible();
    await expect(card.locator(".home-feature-price")).toBeVisible();
    await expect(card.locator(".home-feature-author")).toBeVisible();
    const href = await card.locator("a").first().getAttribute("href");
    expect(href).toMatch(/\/book\/\d+/);
    expect(href).not.toMatch(/book\.html/);
    await card.locator(".home-feature-heart").click();
    await expect(card.locator(".home-feature-heart")).toHaveAttribute("aria-pressed", "true");
    const beforeCart = await H.badgeCount(page);
    await card.locator("[data-cart-id]").click();
    await expect.poll(async () => H.badgeCount(page)).toBeGreaterThan(beforeCart);
  });

  for (const width of [360, 390, 430]) {
    test(`mobile P1 homepage UX at ${width}px`, async ({ page }) => {
      await H.installCarouselCatalogStub(page, { recommended: true, newest: false, bestseller: false, bookCount: 4, featuredCount: 4 });
      await page.setViewportSize({ width, height: 844 });
      await H.openFresh(page, "/");
      await expect(page.locator("#homeCarouselTrack .home-carousel-card").first()).toBeVisible();
      await expect(page.locator(".mobile-filter-toggle")).toBeVisible();
      await expect(page.locator("#homeFeaturedBooks .home-feature-card, #homeFeaturedBooks .empty-state").first()).toBeVisible();
      await page.waitForTimeout(800);

      await expect(page.locator(".home-search-card .mobile-filter-toggle")).toBeVisible();
      const visibleCount = await page.locator(".home-search-card .mobile-filter-toggle, .home-search-card .premium-filter-toggle").evaluateAll((els) => els.filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && !el.hidden && el.getClientRects().length > 0;
      }).length);
      expect(visibleCount).toBe(1);

      const panel = page.locator("#advancedSearchPanel, .home-search-card .advanced-search-panel").first();
      await expect(panel).toHaveClass(/is-collapsed/);
      await page.locator(".mobile-filter-toggle").click();
      await expect(panel).not.toHaveClass(/is-collapsed/);
      await expect.poll(async () => panel.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(20);
      await expect(page.locator("#searchCategory, .advanced-search-panel select, .advanced-search-panel input").first()).toBeVisible();
      await page.locator(".mobile-filter-toggle").click();
      await expect(panel).toHaveClass(/is-collapsed/);

      const metrics = await page.evaluate(() => {
        const tab = [...document.querySelectorAll("#newBooksCarousel .home-carousel-tab")].find((el) => !el.hidden);
        const arrow = document.querySelector("#newBooksCarousel .home-carousel-arrow");
        const input = document.querySelector("#searchInput");
        const button = document.querySelector("#searchButton");
        const track = document.querySelector("#homeCarouselTrack");
        const featured = document.querySelector('[data-featured-row="top"]');
        const featuredTrack = document.querySelector('[data-featured-row="top"] .home-featured-track');
        const featuredStyle = featured ? getComputedStyle(featured) : null;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tabH: tab ? tab.getBoundingClientRect().height : 0,
          arrowW: arrow ? arrow.getBoundingClientRect().width : 0,
          arrowH: arrow ? arrow.getBoundingClientRect().height : 0,
          inputH: input ? input.getBoundingClientRect().height : 0,
          buttonH: button ? button.getBoundingClientRect().height : 0,
          carouselTransform: track ? track.style.transform : "",
          featuredAutoplay: featured ? featured.dataset.autoplay : "",
          featuredDisplay: featuredTrack ? getComputedStyle(featuredTrack).display : "",
          featuredMask: featuredStyle ? `${featuredStyle.maskImage || ""} ${featuredStyle.webkitMaskImage || ""}` : "",
          clones: document.querySelectorAll("#homeFeaturedBooks [data-featured-clone]").length
        };
      });
      expect(metrics.overflow).toBeLessThanOrEqual(4);
      expect(metrics.tabH).toBeGreaterThanOrEqual(44);
      expect(metrics.arrowW).toBeGreaterThanOrEqual(44);
      expect(metrics.arrowH).toBeGreaterThanOrEqual(44);
      expect(metrics.inputH).toBeGreaterThanOrEqual(44);
      expect(metrics.buttonH).toBeGreaterThanOrEqual(44);
      expect(metrics.featuredAutoplay).toBe("0");
      expect(metrics.featuredDisplay).toBe("contents");
      expect(metrics.featuredMask.replace(/\s+/g, " ").trim()).toMatch(/^(none none|none)$/i);
      expect(metrics.clones).toBe(0);
      await page.waitForTimeout(2200);
      const afterCarousel = await page.locator("#homeCarouselTrack").evaluate((el) => el.style.transform);
      expect(afterCarousel).toBe(metrics.carouselTransform);
    });
  }
});
