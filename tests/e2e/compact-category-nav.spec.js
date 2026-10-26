const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const WIDTHS = [320, 390, 768, 1024, 1280];

async function openHome(page, width) {
  await page.setViewportSize({ width, height: width >= 768 ? 900 : 800 });
  await H.openFresh(page, "/");
  await expect.poll(async () => page.locator("#bookCategories [data-category-group]").count()).toBeGreaterThan(0);
}

test.describe("compact category navigation", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    H.allowLiveCatalogReads(page);
    await H.installCategoryDirectoryFixture(page);
  });

  for (const width of WIDTHS) {
    for (const dark of [false, true]) {
      test(`closed and open states at ${width}px ${dark ? "dark" : "light"}`, async ({ page }) => {
        await openHome(page, width);
        if (dark) await page.evaluate(() => document.body.classList.add("dark-mode"));
        const mobile = width < 768;
        const toggle = page.locator(".category-nav-toggle");
        const groups = page.locator("#bookCategories [data-category-group]");
        await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
        if (mobile) {
          await expect(toggle).toBeVisible();
          let height = 0;
          await expect.poll(async () => {
            height = await page.evaluate(() => {
              const el = document.querySelector("#bookCategories .category-nav-toggle");
              return el ? el.getBoundingClientRect().height : 0;
            });
            return height;
          }).toBeGreaterThanOrEqual(54);
          expect(height).toBeLessThan(72);
          await expect(groups.first()).toBeHidden();
          await toggle.click();
          await expect(groups.first()).toBeVisible();
          const columns = await page.evaluate(() => getComputedStyle(document.querySelector("#bookCategories .category-nav-groups")).gridTemplateColumns.split(" ").filter(Boolean).length);
          expect(columns).toBe(2);
          const step = await page.evaluate(() => {
            const nav = document.querySelector("#bookCategories");
            const panel = document.querySelector("#categoryNavPanel");
            return {
              nav: nav.getBoundingClientRect().width,
              panel: panel.getBoundingClientRect().width,
              height: panel.getBoundingClientRect().height
            };
          });
          expect(step.panel).toBeGreaterThan(step.nav * 0.92);
          expect(step.height).toBeLessThan(420);
          await groups.first().click();
          await expect(page.locator("#bookCategories [data-category-back]")).toBeVisible();
          await expect(page.locator("#bookCategories .category-nav-leaf").first()).toBeVisible();
          await page.locator("#bookCategories [data-category-back]").click();
          await expect(groups.first()).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(groups.first()).toBeHidden();
          await expect(toggle).toBeFocused();
        } else {
          await expect(toggle).toBeHidden();
          let rowHeight = 0;
          await expect.poll(async () => {
            rowHeight = await page.evaluate(() => {
              const el = document.querySelector("#bookCategories .category-nav-groups");
              return el ? el.getBoundingClientRect().height : 0;
            });
            return rowHeight;
          }).toBeGreaterThanOrEqual(57);
          expect(rowHeight).toBeLessThan(96);
          await expect(page.locator("#bookCategories .category-nav-leaf")).toHaveCount(0);
          const family = groups.first();
          const familyId = await family.getAttribute("data-category-group");
          await family.click();
          await expect(page.locator("#bookCategories .category-nav-leaf").first()).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.locator("#bookCategories .category-nav-leaf")).toHaveCount(0);
          await expect(page.locator(`#bookCategories [data-category-group="${familyId}"]`)).toBeFocused();
          await page.locator(`#bookCategories [data-category-group="${familyId}"]`).click();
          await expect(page.locator("#bookCategories .category-nav-leaf").first()).toBeVisible();
          await page.locator("#bookCategories [data-category-close]").click();
          await expect(page.locator("#bookCategories .category-nav-leaf")).toHaveCount(0);
          await expect(page.locator(`#bookCategories [data-category-group="${familyId}"]`)).toBeFocused();
        }
        const place = await page.evaluate(() => {
          const search = document.querySelector(".home-search-card .search-box");
          const nav = document.querySelector("#bookCategories");
          const card = document.querySelector(".home-search-card");
          return {
            gap: nav.getBoundingClientRect().top - search.getBoundingClientRect().bottom,
            inside: card.contains(nav)
          };
        });
        expect(place.inside).toBe(true);
        expect(place.gap).toBeGreaterThan(-2);
        expect(place.gap).toBeLessThan(48);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(4);
        await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
      });
    }
  }

  test("a public group_key places a new category under literature once", async ({ page }) => {
    await page.route("**/rpc/list_public_book_categories**", async (route) => {
      const rows = [
        { slug: "romanlar", source: "romanlar.html", label: "رومانلار", sort_order: 1 },
        { slug: "dunyawi-meshhur-eser-2", source: "dunyawi-meshhur-eser-2.html", label: "دۇنياۋى مەشھۇر ئەسەر", sort_order: 2, group_key: "literature" }
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ categories: rows, direct: rows, redirects: [] })
      });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await page.locator("#bookCategories [data-category-group='literature']").click();
    await expect(page.locator('#bookCategories a[href="/dunyawi-meshhur-eser-2"]')).toHaveCount(1);
    await expect(page.locator('#bookCategories a[href="/romanlar"]')).toHaveCount(1);
    await expect(page.locator("#bookCategories [data-category-group='history']")).toHaveCount(0);
  });

  test("all categories reaches an unmapped public category and a leaf closes the mobile picker", async ({ page }) => {
    await page.route("**/rpc/list_public_book_categories**", async (route) => {
      const rows = [
        { slug: "romanlar", source: "romanlar.html", label: "رومانلار", sort_order: 1 },
        { slug: "dastanlar", source: "dastanlar.html", label: "داستانلار", sort_order: 2 },
        { slug: "yoshurun", source: "yoshurun.html", label: "يوشۇرۇن", is_hidden: true, sort_order: 3 }
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ categories: rows, direct: rows, redirects: [] })
      });
    });
    await page.setViewportSize({ width: 390, height: 800 });
    await H.openFresh(page, "/");
    await page.locator(".category-nav-toggle").click();
    await page.locator("#bookCategories [data-category-all]").click();
    await expect(page.locator('#bookCategories a[href="/dastanlar"]')).toBeVisible();
    await expect(page.locator('#bookCategories a[href="/yoshurun"]')).toHaveCount(0);
    await expect(page.locator('#bookCategories a[href="/meshhur-shexisler"]')).toHaveCount(0);
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.locator('#bookCategories a[href="/dastanlar"]').click();
    await expect(page).toHaveURL(/\/dastanlar$/);
    expect(requests.some((url) => url.includes("premium-ux.js?v=22"))).toBe(false);
    await expect(page.locator("#premiumDiscovery")).toHaveCount(0);
  });

  test("a category listing keeps the breadcrumb and drops the duplicate hub strip", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/romanlar");
    await expect(page.locator(".category-hub-nav a[href='/']")).toBeVisible();
    await expect(page.locator(".category-hub-nav a[href='/adabiyat']")).toBeVisible();
    await expect(page.locator(".category-hub-nav a[href='/romanlar']")).toBeVisible();
    await expect(page.locator(".category-hub-nav a[href='/sheirlar']")).toHaveCount(0);
    await expect(page.locator(".back-button")).toHaveAttribute("href", "/adabiyat");
    await expect.poll(async () => page.locator("#bookCategories [data-category-group='literature']").count()).toBeGreaterThan(0);
  });

  test("the close label stays intact and the filter label stays readable", async ({ page }) => {
    test.setTimeout(120000);
    async function contrast(selector) {
      return page.locator(selector).evaluate((el) => {
        const parse = (value) => {
          const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
        };
        const linear = (channel) => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const lum = (rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
        const style = getComputedStyle(el);
        const fg = parse(style.color);
        const bg = parse(style.backgroundColor);
        const hi = Math.max(lum(fg), lum(bg));
        const lo = Math.min(lum(fg), lum(bg));
        return {
          ratio: (hi + 0.05) / (lo + 0.05),
          color: style.color,
          background: style.backgroundColor,
          label: el.textContent.trim()
        };
      });
    }
    async function closeMetrics() {
      return page.locator("#bookCategories [data-category-close]").evaluate((el) => {
        const style = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return {
          text: el.textContent,
          display: style.display,
          fontFamily: style.fontFamily,
          lineHeight: Number.parseFloat(style.lineHeight),
          fontSize: Number.parseFloat(style.fontSize),
          padInline: Number.parseFloat(style.paddingInlineStart) + Number.parseFloat(style.paddingInlineEnd),
          flexShrink: style.flexShrink,
          textWidth: text.width,
          boxWidth: box.width,
          clipped: el.scrollWidth - el.clientWidth
        };
      });
    }
    for (const width of [768, 1280]) {
      await openHome(page, width);
      await page.locator("#bookCategories [data-category-all]").click();
      await expect(page.locator("#bookCategories [data-category-close]")).toBeVisible();
      let close;
      await expect.poll(async () => {
        close = await closeMetrics();
        return close.display;
      }).toMatch(/^(inline-)?flex$/);
      expect(close.text).toBe("يىغىش");
      expect(close.fontFamily.toLowerCase()).toContain("ukij");
      expect(close.lineHeight).toBeGreaterThanOrEqual(close.fontSize);
      expect(close.padInline).toBeGreaterThanOrEqual(24);
      expect(close.flexShrink).toBe("0");
      expect(close.boxWidth).toBeGreaterThan(close.textWidth + 12);
      expect(close.clipped).toBeLessThanOrEqual(1);
      await page.locator("#bookCategories [data-category-close]").click();
      await expect(page.locator("#bookCategories [data-category-all]")).toBeFocused();
      const family = page.locator("#bookCategories [data-category-group]").first();
      const familyId = await family.getAttribute("data-category-group");
      await family.click();
      await expect.poll(async () => {
        close = await closeMetrics();
        return close.display;
      }).toMatch(/^(inline-)?flex$/);
      expect(close.text).toBe("يىغىش");
      expect(close.clipped).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(`#bookCategories [data-category-group="${familyId}"]`)).toBeFocused();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(4);
    }
    for (const width of [390, 1280]) {
      for (const dark of [false, true]) {
        for (const path of ["/", "/romanlar"]) {
          await page.setViewportSize({ width, height: 900 });
          await H.openFresh(page, path);
          await page.evaluate((enabled) => document.body.classList.toggle("dark-mode", enabled), dark);
          const selector = path === "/" ? ".home-search-card .category-filter-toggle" : "#catalogFilterBar .category-filter-toggle";
          await expect(page.locator(selector)).toBeVisible();
          for (const state of ["normal", "hover", "focus"]) {
            if (state === "hover") await page.locator(selector).hover();
            if (state === "focus") await page.locator(selector).evaluate((el) => el.focus({ preventScroll: true, focusVisible: true }));
            const reading = await contrast(selector);
            expect(reading.label).toBe("سۈزگۈچ");
            expect(reading.ratio, `${path} ${width} ${dark ? "dark" : "light"} ${state}`).toBeGreaterThanOrEqual(4.5);
          }
          if (path === "/") {
            await page.locator(selector).click();
            await expect(page.locator("#searchSort")).toBeVisible();
            await expect(page.locator("#searchCategory")).toBeVisible();
          } else {
            await page.locator(selector).click();
            await expect(page.locator("#catalogSort")).toBeVisible();
            await expect(page.locator("#catalogCollection")).toBeVisible();
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});
