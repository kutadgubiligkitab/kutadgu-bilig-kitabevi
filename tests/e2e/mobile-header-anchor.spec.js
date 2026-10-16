const { test, expect } = require("./playwright-test");

async function blockWrites(page) {
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() !== "GET" && request.method() !== "HEAD") return route.abort();
    if (/analytics-event|cdn-cgi\/rum|member-visit|posthog|supabase\.co/.test(url)) return route.abort();
    return route.continue();
  });
}

async function anchorBox(page) {
  return page.evaluate(() => {
    const header = document.querySelector("body > header");
    const style = header ? getComputedStyle(header) : null;
    const rect = header ? header.getBoundingClientRect() : null;
    let content = header ? header.nextElementSibling : null;
    while (content && content.getBoundingClientRect().height < 8) content = content.nextElementSibling;
    const contentRect = content ? content.getBoundingClientRect() : null;
    const bottom = document.querySelector(".mobile-bottom-nav");
    const bottomRect = bottom ? bottom.getBoundingClientRect() : null;
    const menu = document.querySelector("#mobileSiteMenu");
    const menuRect = menu && menu.classList.contains("is-open") ? menu.getBoundingClientRect() : null;
    return {
      scrollY: window.scrollY,
      headerTop: rect ? rect.top : null,
      headerBottom: rect ? rect.bottom : null,
      headerHeight: rect ? rect.height : null,
      position: style ? style.position : "",
      backdrop: style ? style.backdropFilter : "",
      webkitBackdrop: style ? style.webkitBackdropFilter || "" : "",
      contentTop: contentRect ? contentRect.top : null,
      paddingTop: parseFloat(getComputedStyle(document.body).paddingTop) || 0,
      bottomGap: bottomRect ? window.innerHeight - bottomRect.bottom : null,
      bottomPosition: bottom ? getComputedStyle(bottom).position : "",
      menuTop: menuRect ? menuRect.top : null,
      search: header ? header.querySelectorAll("input").length : 0
    };
  });
}

async function scrollDown(page) {
  const about = page.locator("#about");
  if (await about.count()) await about.scrollIntoViewIfNeeded();
  if (await page.evaluate(() => window.scrollY) < 100) {
    await page.mouse.move(200, 500);
    await page.mouse.wheel(0, 1600);
  }
}

test.describe("mobile header stays at the visual top", () => {
  test.beforeEach(async ({ page }) => {
    await blockWrites(page);
  });

  test("homepage reload and scroll keep the opaque header over the hero", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator("header.is-mobile-enhanced")).toBeVisible();
    const cold = await anchorBox(page);
    expect(cold.position).toBe("fixed");
    expect(cold.backdrop).toBe("none");
    expect(cold.webkitBackdrop === "" || cold.webkitBackdrop === "none").toBe(true);
    expect(cold.headerTop).toBe(0);
    expect(cold.paddingTop).toBeGreaterThanOrEqual(cold.headerHeight - 1);
    expect(cold.contentTop).toBeGreaterThanOrEqual(cold.headerBottom - 1);
    expect(cold.search).toBeGreaterThan(0);
    expect(cold.bottomPosition).toBe("fixed");
    expect(Math.abs(cold.bottomGap)).toBeLessThan(2);

    await scrollDown(page);
    const scrolled = await anchorBox(page);
    expect(scrolled.scrollY).toBeGreaterThan(100);
    expect(Math.abs(scrolled.headerTop)).toBeLessThan(1);
    expect(scrolled.contentTop).toBeLessThan(scrolled.headerTop);
    expect(Math.abs(scrolled.bottomGap)).toBeLessThan(2);

    await page.reload();
    await expect(page.locator("header.is-mobile-enhanced")).toBeVisible();
    const restored = await anchorBox(page);
    expect(Math.abs(restored.headerTop)).toBeLessThan(1);
    expect(restored.position).toBe("fixed");
    expect(restored.backdrop).toBe("none");
    if (restored.scrollY < 20) {
      expect(restored.contentTop).toBeGreaterThanOrEqual(restored.headerBottom - 1);
    }

    await page.locator(".mobile-menu-toggle").click();
    await expect(page.locator("#mobileSiteMenu")).toHaveClass(/is-open/);
    const open = await anchorBox(page);
    expect(Math.abs(open.headerTop)).toBeLessThan(1);
    expect(open.menuTop).toBeGreaterThanOrEqual(open.headerBottom - 2);
    expect(open.menuTop).toBeLessThan(open.headerBottom + 8);
    await page.locator(".mobile-menu-toggle").click();

    await page.setViewportSize({ width: 700, height: 390 });
    const landscape = await anchorBox(page);
    expect(landscape.position).toBe("fixed");
    expect(Math.abs(landscape.headerTop)).toBeLessThan(1);
    expect(landscape.backdrop).toBe("none");
  });

  test("listing and detail headers stay above their content", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/books", "/book-shell.html"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect.poll(async () => page.evaluate(() => {
        const header = document.querySelector("body > header");
        return header ? header.className : "";
      })).toMatch(/is-mobile-enhanced|mobile-site-header/);
      const box = await anchorBox(page);
      expect(box.position, path).toBe("fixed");
      expect(box.backdrop, path).toBe("none");
      expect(box.headerTop, path).toBe(0);
      expect(box.contentTop, path).toBeGreaterThanOrEqual(box.headerBottom - 1);
      expect(box.bottomPosition, path).toBe("fixed");
      expect(Math.abs(box.bottomGap), path).toBeLessThan(2);
    }
  });

  test("desktop keeps the sticky blurred header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator("body > header")).toBeVisible();
    const box = await anchorBox(page);
    expect(box.position).toBe("sticky");
    expect(box.backdrop).toContain("blur");
    expect(box.headerTop).toBe(0);
    expect(box.contentTop).toBeGreaterThanOrEqual(box.headerBottom - 1);
    await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
  });
});
