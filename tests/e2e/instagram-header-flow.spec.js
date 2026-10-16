const { execFileSync } = require("child_process");
const path = require("path");
const { test, expect } = require("./playwright-test");

const ROOT = path.join(__dirname, "../..");
const CACHED_MOBILE_CSS = "167b733cfbec42c89d48660c7220bcd879add64b";

function cachedMobileCss() {
  const args = ["show", CACHED_MOBILE_CSS + ":mobile.css"];
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
  } catch (err) {
    execFileSync("git", ["fetch", "--depth=1", "origin", CACHED_MOBILE_CSS], { cwd: ROOT, stdio: "ignore" });
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
  }
}

const MAIN_MOBILE_CSS = cachedMobileCss();

const IPHONE_INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F79 Instagram 340.0.0.0.0";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_INSTAGRAM = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 340.0.0.0.0";

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
      ig: document.documentElement.classList.contains("kutadgu-ig-iphone"),
      scrollY: window.scrollY,
      headerTop: rect ? rect.top : null,
      headerBottom: rect ? rect.bottom : null,
      headerHeight: rect ? rect.height : null,
      position: style ? style.position : "",
      transform: style ? style.transform : "",
      contentTop: contentRect ? contentRect.top : null,
      paddingTop: parseFloat(getComputedStyle(document.body).paddingTop) || 0,
      bottomGap: bottomRect ? window.innerHeight - bottomRect.bottom : null,
      bottomPosition: bottom ? getComputedStyle(bottom).position : "",
      menuTop: menuRect ? menuRect.top : null,
      search: header ? header.querySelectorAll("input").length : 0,
      cart: header ? header.querySelectorAll(".mobile-header-cart").length : 0
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

test.describe("iPhone Instagram keeps the public header in flow", () => {
  test.use({
    userAgent: IPHONE_INSTAGRAM,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });

  test.beforeEach(async ({ page }) => {
    await blockWrites(page);
  });

  test("reload, scroll, menu, and viewport changes do not add a second header gap", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header.is-mobile-enhanced")).toBeVisible();
    const cold = await anchorBox(page);
    expect(cold.ig).toBe(true);
    expect(cold.position).toBe("sticky");
    expect(cold.headerTop).toBe(0);
    expect(cold.paddingTop).toBe(0);
    expect(cold.contentTop).toBeGreaterThanOrEqual(cold.headerBottom - 1);
    expect(cold.contentTop).toBeLessThan(cold.headerBottom + 12);
    expect(cold.search).toBeGreaterThan(0);
    expect(cold.cart).toBe(1);
    expect(cold.bottomPosition).toBe("fixed");
    expect(Math.abs(cold.bottomGap)).toBeLessThan(2);
    expect(cold.transform === "none" || cold.transform === "").toBe(true);

    await scrollDown(page);
    const scrolled = await anchorBox(page);
    expect(scrolled.scrollY).toBeGreaterThan(100);
    expect(scrolled.position).toBe("sticky");
    expect(Math.abs(scrolled.headerTop)).toBeLessThan(1);
    expect(scrolled.paddingTop).toBe(0);
    expect(Math.abs(scrolled.bottomGap)).toBeLessThan(2);

    await page.reload();
    await expect(page.locator("header.is-mobile-enhanced")).toBeVisible();
    const restored = await anchorBox(page);
    expect(restored.ig).toBe(true);
    expect(restored.position).toBe("sticky");
    expect(Math.abs(restored.headerTop)).toBeLessThan(1);
    expect(restored.paddingTop).toBe(0);
    if (restored.scrollY < 20) {
      expect(restored.contentTop).toBeGreaterThanOrEqual(restored.headerBottom - 1);
      expect(restored.contentTop).toBeLessThan(restored.headerBottom + 12);
    }

    await page.locator(".mobile-menu-toggle").click();
    await expect(page.locator("#mobileSiteMenu")).toHaveClass(/is-open/);
    const open = await anchorBox(page);
    expect(Math.abs(open.headerTop)).toBeLessThan(1);
    expect(open.menuTop).toBeGreaterThanOrEqual(open.headerBottom - 2);
    expect(open.menuTop).toBeLessThan(open.headerBottom + 8);
    await page.locator(".mobile-menu-toggle").click();
    await expect(page.locator("#mobileSiteMenu")).not.toHaveClass(/is-open/);

    await page.setViewportSize({ width: 700, height: 390 });
    const landscape = await anchorBox(page);
    expect(landscape.position).toBe("sticky");
    expect(Math.abs(landscape.headerTop)).toBeLessThan(1);
    expect(landscape.paddingTop).toBe(0);
    expect(landscape.bottomPosition).toBe("fixed");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const desktop = await anchorBox(page);
    expect(desktop.position).toBe("sticky");
    expect(Math.abs(desktop.headerTop)).toBeLessThan(1);
    expect(desktop.paddingTop).toBe(0);
    expect(desktop.contentTop).toBeGreaterThanOrEqual(desktop.headerBottom - 1);
    expect(desktop.contentTop).toBeLessThan(desktop.headerBottom + 12);
    await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
  });
});

async function expectFixedPhone(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("header.is-mobile-enhanced")).toBeVisible();
  const box = await anchorBox(page);
  expect(box.ig).toBe(false);
  expect(box.position).toBe("fixed");
  expect(box.headerTop).toBe(0);
  expect(box.paddingTop).toBeGreaterThanOrEqual(box.headerHeight - 1);
  expect(box.contentTop).toBeGreaterThanOrEqual(box.headerBottom - 1);
  expect(box.search).toBeGreaterThan(0);
  expect(box.cart).toBe(1);
  expect(box.bottomPosition).toBe("fixed");
}

test.describe("iPhone Safari keeps the fixed header", () => {
  test.use({ userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("ordinary mobile Safari does not take the Instagram fallback", async ({ page }) => {
    await blockWrites(page);
    await expectFixedPhone(page);
  });
});

test.describe("cached mobile.css does not drop the sticky header", () => {
  test.use({
    userAgent: IPHONE_INSTAGRAM,
    viewport: { width: 440, height: 879 },
    isMobile: true,
    hasTouch: true
  });

  test("opening and closing the menu at scroll 650 keeps the header at the top", async ({ page }) => {
    expect(MAIN_MOBILE_CSS).not.toContain("kutadgu-ig-iphone");
    const requests = [];
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = request.url();
      requests.push(request.method() + " " + url);
      if (request.method() !== "GET" && request.method() !== "HEAD") return route.abort();
      if (/analytics-event|cdn-cgi\/rum|member-visit|posthog|supabase\.co/.test(url)) return route.abort();
      if (/\/mobile\.css(?:\?|$)/.test(url)) {
        return route.fulfill({
          status: 200,
          contentType: "text/css; charset=utf-8",
          body: MAIN_MOBILE_CSS
        });
      }
      return route.continue();
    });

    await page.goto("/books");
    await expect(page.locator("header.is-mobile-enhanced")).toBeVisible();
    await expect(page.locator("link[href='mobile.css?v=24']")).toHaveCount(1);
    await expect(page.locator("script[src='public-header.js?v=4']")).toHaveCount(1);
    await expect(page.locator("#kutadguPublicHeaderCss")).toHaveAttribute("href", "/public-header.css?v=8");
    expect(requests.some((entry) => entry.includes("/mobile.css?v=24"))).toBe(true);

    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      document.body.style.minHeight = "2400px";
      window.scrollTo(0, 650);
    });
    const before = await anchorBox(page);
    expect(before.ig).toBe(true);
    expect(before.position).toBe("sticky");
    expect(before.scrollY).toBe(650);
    expect(before.headerTop).toBe(0);
    expect(before.paddingTop).toBe(0);

    const tapToggle = async () => {
      const point = await page.evaluate(() => {
        const button = document.querySelector(".mobile-menu-toggle");
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await page.touchscreen.tap(point.x, point.y);
    };

    await tapToggle();
    await expect(page.locator("#mobileSiteMenu")).toHaveClass(/is-open/);
    const open = await anchorBox(page);
    expect(open.scrollY).toBe(650);
    expect(Math.abs(open.headerTop)).toBeLessThan(1);
    expect(open.position).toBe("sticky");
    expect(open.menuTop).toBeGreaterThanOrEqual(open.headerBottom - 2);
    expect(open.menuTop).toBeLessThan(open.headerBottom + 8);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("clip");

    await tapToggle();
    await expect(page.locator("#mobileSiteMenu")).not.toHaveClass(/is-open/);
    const closed = await anchorBox(page);
    expect(closed.scrollY).toBe(650);
    expect(Math.abs(closed.headerTop)).toBeLessThan(1);
    expect(closed.position).toBe("sticky");
    expect(closed.paddingTop).toBe(0);
  });
});

test.describe("Android Instagram keeps the fixed header", () => {
  test.use({ userAgent: ANDROID_INSTAGRAM, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("Android Instagram does not take the iPhone fallback", async ({ page }) => {
    await blockWrites(page);
    await expectFixedPhone(page);
  });
});
