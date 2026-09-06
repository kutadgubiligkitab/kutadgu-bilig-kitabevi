const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1366, height: 800 }
];

const PUBLIC_PATHS = ["/", "/dini", "/book/122", "/cart.html", "/favorites.html", "/account.html"];

function malformedBookPaths(pathname) {
  return /^\/book\/.+\.html$/i.test(String(pathname || ""));
}

async function headerHrefs(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header.kutadgu-public-header, body > header");
    if (!header) return [];
    return [...header.querySelectorAll("a[href]")].map((a) => {
      try {
        return new URL(a.getAttribute("href") || "", location.origin).pathname;
      } catch (err) {
        return a.getAttribute("href") || "";
      }
    });
  });
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header.kutadgu-public-header, body > header");
    const main = document.querySelector("main, .book-detail-page, .cart-page, .account-main, .books-container, .hero");
    const bottom = document.querySelector(".mobile-bottom-nav");
    const headerBox = header ? header.getBoundingClientRect() : null;
    const mainBox = main ? main.getBoundingClientRect() : null;
    const bottomBox = bottom ? bottom.getBoundingClientRect() : null;
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      headerHeight: headerBox ? headerBox.height : 0,
      headerBottom: headerBox ? headerBox.bottom : 0,
      mainTop: mainBox ? mainBox.top : 0,
      bottomVisible: !!(bottom && getComputedStyle(bottom).display !== "none" && bottomBox && bottomBox.height > 8),
      bottomTop: bottomBox ? bottomBox.top : 0,
      viewportH: window.innerHeight,
      hasSearch: !!document.querySelector(".kutadgu-header-search"),
      hasTheme: !!document.querySelector("header .theme-button, header .theme-toggle, .mobile-site-menu .theme-button"),
      hasCart: !!document.querySelector('a[href="/cart.html"], .mobile-header-cart, .mobile-bottom-nav a[href="/cart.html"]'),
      hasFav: !!document.querySelector('a[href="/favorites.html"], .mobile-bottom-nav a[href="/favorites.html"]'),
      hasAccount: !!document.querySelector('a[href="/account.html"], .mobile-bottom-nav a[href="/account.html"]')
    };
  });
}

test.describe("unified public header", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["122"]);
  });

  test("direct /book/122 header links stay on root app pages", async ({ page }) => {
    await page.goto("/book/122", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator("header.kutadgu-public-header").count()).toBeGreaterThan(0);
    const paths = await headerHrefs(page);
    expect(paths.some(malformedBookPaths), paths.filter(malformedBookPaths).join(",")).toBeFalsy();
    expect(paths).toContain("/cart.html");
    expect(paths).toContain("/favorites.html");
    expect(paths).toContain("/account.html");
    expect(paths.some((p) => p === "/" || p === "/index.html")).toBeTruthy();
    const resolved = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        return el ? new URL(el.href, location.origin).pathname : "";
      };
      return {
        cart: pick('header a[href="/cart.html"], header a[href="cart.html"]'),
        fav: pick('header a[href="/favorites.html"], header a[href="favorites.html"]'),
        account: pick('header a[href="/account.html"], header a[href="account.html"]'),
        home: pick("header a.logo, header a.kutadgu-header-home")
      };
    });
    expect(resolved.cart).toBe("/cart.html");
    expect(resolved.fav).toBe("/favorites.html");
    expect(resolved.account).toBe("/account.html");
    expect(resolved.home === "/" || resolved.home === "/index.html").toBeTruthy();
  });

  for (const path of PUBLIC_PATHS) {
    test(`header chrome is present on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 800 });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect.poll(async () => page.locator("header.kutadgu-public-header").count()).toBeGreaterThan(0);
      const snap = await layoutSnapshot(page);
      expect(snap.hasSearch).toBeTruthy();
      expect(snap.hasTheme).toBeTruthy();
      expect(snap.hasCart).toBeTruthy();
      expect(snap.hasFav).toBeTruthy();
      expect(snap.hasAccount).toBeTruthy();
      const paths = await headerHrefs(page);
      expect(paths.some((p) => p === "/book/cart.html" || p === "/book/favorites.html" || p === "/book/account.html")).toBeFalsy();
    });
  }

  for (const vp of VIEWPORTS) {
    test(`viewport ${vp.width} keeps header off main content and bottom nav usable`, async ({ page }) => {
      test.setTimeout(45_000);
      await page.setViewportSize(vp);
      await page.goto("/book/122", { waitUntil: "domcontentloaded" });
      await expect.poll(async () => page.locator("header.kutadgu-public-header").count()).toBeGreaterThan(0);
      if (vp.width <= 768) {
        await page.waitForFunction(() => document.body.classList.contains("has-mobile-bottom-nav") || document.querySelector(".mobile-bottom-nav"));
      }
      const snap = await layoutSnapshot(page);
      expect(snap.overflowX).toBeLessThanOrEqual(1);
      expect(snap.headerHeight).toBeGreaterThan(40);
      expect(snap.mainTop + 1).toBeGreaterThanOrEqual(snap.headerBottom);
      if (vp.width <= 768) {
        expect(snap.bottomVisible).toBeTruthy();
        await expect(page.locator(".mobile-bottom-nav a[href='/cart.html']")).toBeVisible();
        await expect(page.locator(".mobile-bottom-nav a[href='/favorites.html']")).toBeVisible();
        await expect(page.locator(".mobile-bottom-nav a[href='/account.html']")).toBeVisible();
      }
    });
  }

  test("header theme control works in light and dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto("/dini", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator("header .theme-button, header .theme-toggle").count()).toBeGreaterThan(0);
    const before = await page.evaluate(() => document.body.classList.contains("dark-mode"));
    await page.locator("header .theme-button, header .theme-toggle").first().click();
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark-mode"))).toBe(!before);
    const headerOk = await page.evaluate(() => {
      const header = document.querySelector("header.kutadgu-public-header");
      const cs = getComputedStyle(header);
      return cs.backgroundColor !== "rgba(0, 0, 0, 0)" && header.getBoundingClientRect().height > 40;
    });
    expect(headerOk).toBeTruthy();
    await page.locator("header .theme-button, header .theme-toggle").first().click();
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark-mode"))).toBe(before);
  });

  test("cart count control remains in the unified header", async ({ page }) => {
    await H.clearShopStorage(page);
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator("header.kutadgu-public-header a[href='/cart.html'] .cart-count").count()).toBeGreaterThan(0);
    const count = await page.locator("header.kutadgu-public-header a[href='/cart.html'] .cart-count").first().textContent();
    expect(String(count || "").trim()).toMatch(/^\d+$/);
  });

  test("desktop 1366 header is one compact bar, not a tall brown column", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator("header.kutadgu-public-header").count()).toBeGreaterThan(0);
    const geo = await page.evaluate(() => {
      const header = document.querySelector("header.kutadgu-public-header");
      const logo = header.querySelector(".logo");
      const search = header.querySelector(".kutadgu-header-search");
      const nav = header.querySelector("nav");
      const hero = document.querySelector(".hero, .home-bookstore-hero");
      const bar = document.getElementById("kutadguAnnounceBar");
      const hb = header.getBoundingClientRect();
      const logoB = logo.getBoundingClientRect();
      const searchB = search.getBoundingClientRect();
      const navB = nav.getBoundingClientRect();
      const mainTop = Math.min(logoB.top, searchB.top, navB.top);
      const mainBottom = Math.max(logoB.bottom, searchB.bottom, navB.bottom);
      const announceH = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().height : 0;
      return {
        display: getComputedStyle(header).display,
        flexDir: getComputedStyle(header).flexDirection,
        headerH: hb.height,
        mainRowH: mainBottom - mainTop,
        searchW: searchB.width,
        searchH: searchB.height,
        logoNavDelta: Math.abs(logoB.top - navB.top),
        logoSearchDelta: Math.abs(logoB.top - searchB.top),
        heroTop: hero ? hero.getBoundingClientRect().top : 0,
        announceH
      };
    });
    expect(geo.display === "grid" || geo.flexDir === "row").toBeTruthy();
    expect(geo.mainRowH).toBeGreaterThan(40);
    expect(geo.mainRowH).toBeLessThanOrEqual(76);
    expect(geo.searchW).toBeGreaterThanOrEqual(260);
    expect(geo.searchW).toBeLessThanOrEqual(430);
    expect(geo.searchH).toBeLessThanOrEqual(48);
    expect(geo.logoNavDelta).toBeLessThanOrEqual(14);
    expect(geo.logoSearchDelta).toBeLessThanOrEqual(14);
    expect(geo.headerH).toBeLessThanOrEqual(120);
    expect(geo.heroTop).toBeLessThanOrEqual(130);
  });

  for (const path of ["/", "/dini", "/book/122", "/cart.html", "/favorites.html", "/account.html"]) {
    test(`compact header geometry on ${path} at 390/768/1366`, async ({ page }) => {
      const limits = {
        390: { headerMax: 210, searchHMax: 48, overflowMax: 1 },
        768: { headerMax: 200, searchHMax: 48, overflowMax: 1 },
        1366: { headerMax: 120, searchHMax: 48, overflowMax: 1 }
      };
      for (const width of [390, 768, 1366]) {
        await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator("header.kutadgu-public-header").count()).toBeGreaterThan(0);
        if (width <= 768) {
          await page.waitForSelector(".mobile-bottom-nav", { timeout: 15_000 });
        }
        const geo = await page.evaluate(() => {
          const header = document.querySelector("header.kutadgu-public-header");
          const search = header && header.querySelector(".kutadgu-header-search");
          const bottom = document.querySelector(".mobile-bottom-nav");
          const hb = header.getBoundingClientRect();
          return {
            headerH: hb.height,
            searchH: search ? search.getBoundingClientRect().height : 0,
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            display: getComputedStyle(header).display,
            flexDir: getComputedStyle(header).flexDirection,
            bottomVisible: !!(bottom && getComputedStyle(bottom).display !== "none")
          };
        });
        const lim = limits[width];
        expect(geo.display === "grid" || geo.flexDir === "row", `${path} ${width}`).toBeTruthy();
        expect(geo.headerH, `${path} ${width} headerH`).toBeLessThanOrEqual(lim.headerMax);
        expect(geo.searchH, `${path} ${width} searchH`).toBeLessThanOrEqual(lim.searchHMax);
        expect(geo.overflowX, `${path} ${width} overflow`).toBeLessThanOrEqual(lim.overflowMax);
        if (width <= 768) expect(geo.bottomVisible).toBeTruthy();
      }
    });
  }
});
