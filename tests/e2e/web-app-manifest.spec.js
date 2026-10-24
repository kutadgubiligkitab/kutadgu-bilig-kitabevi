const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const NAME = "قۇتادغۇبىلىك كىتابخانىسى";

async function themeIsDark(page) {
  return page.locator("body").evaluate((el) => el.classList.contains("dark-mode"));
}

async function setTheme(page, dark) {
  if ((await themeIsDark(page)) === dark) return;
  let button = page.locator(".theme-button:visible, .theme-toggle:visible").first();
  if (!(await button.count())) {
    await page.locator(".mobile-menu-toggle:visible").first().click();
    button = page.locator(".theme-button:visible, .theme-toggle:visible").first();
  }
  await button.click();
  await expect.poll(() => themeIsDark(page)).toBe(dark);
}

async function closeMobileMenu(page) {
  const menu = page.locator("#mobileSiteMenu.is-open");
  if (!(await menu.count())) return;
  await page.locator(".mobile-menu-toggle").first().click();
  await expect(menu).toHaveCount(0);
}

async function clickVisibleHref(page, href) {
  const link = page.locator(`a[href="${href}"]:visible`).first();
  await expect(link).toBeVisible();
  await link.click();
}

async function noHorizontalOverflow(page) {
  const box = await page.locator("body").evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

test("ordinary tab parses the manifest and keeps storefront navigation online", async ({ page }) => {
  test.setTimeout(150000);
  await H.installReadSafeNetwork(page);
  H.allowLiveCatalogReads(page);
  const parsed = await page.goto("/", { waitUntil: "domcontentloaded" }).then(async () => {
    const client = await page.context().newCDPSession(page);
    return client.send("Page.getAppManifest");
  });
  expect(parsed.errors || []).toEqual([]);
  const data = JSON.parse(parsed.data || "{}");
  expect(data.name).toBe(NAME);
  expect(data.short_name).toBe(NAME);
  expect(data.id).toBe("/");
  expect(data.start_url).toBe("/");
  expect(data.scope).toBe("/");
  expect(data.display).toBe("standalone");
  expect(data.lang).toBe("ug");
  expect(data.dir).toBe("rtl");
  expect(data.icons).toEqual([
    { src: "/kutadgu-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/kutadgu-icon-512.png", sizes: "512x512", type: "image/png" }
  ]);
  const app = parsed.manifest;
  expect(app.name).toBe(NAME);
  expect(app.id).toBe(new URL("/", page.url()).href);
  expect(app.startUrl).toBe(new URL("/", page.url()).href);
  expect(app.scope).toBe(new URL("/", page.url()).href);
  expect(app.display).toBe("kStandalone");
  expect(app.orientation).toBe("DEFAULT");
  expect(app.icons).toEqual([
    { url: new URL("/kutadgu-icon-192.png", page.url()).href, sizes: "192x192", type: "image/png" },
    { url: new URL("/kutadgu-icon-512.png", page.url()).href, sizes: "512x512", type: "image/png" }
  ]);
  const icon = await page.evaluate(async () => {
    async function readPng(href) {
      const response = await fetch(href);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const view = new DataView(bytes.buffer);
      const image = new Image();
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      const dimensions = await new Promise((resolve, reject) => {
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error(href + " failed to decode"));
        image.src = url;
      });
      URL.revokeObjectURL(url);
      return {
        type: response.headers.get("content-type"),
        ihdr: String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]),
        width: view.getUint32(16),
        height: view.getUint32(20),
        decoded: dimensions
      };
    }
    return {
      original: await readPng("/kutadgu-logo.png"),
      icon192: await readPng("/kutadgu-icon-192.png"),
      icon512: await readPng("/kutadgu-icon-512.png")
    };
  });
  for (const entry of [icon.original, icon.icon192, icon.icon512]) {
    expect(entry.type).toContain("image/png");
    expect(entry.ihdr).toBe("IHDR");
    expect(entry.decoded).toEqual({ width: entry.width, height: entry.height });
  }
  expect(icon.original.width).toBe(1254);
  expect(icon.original.height).toBe(1254);
  expect(icon.icon192.width).toBe(192);
  expect(icon.icon512.width).toBe(512);

  const workers = await page.evaluate(async () => ({
    registrations: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    controller: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    caches: window.caches ? await caches.keys() : [],
    standalone: window.matchMedia("(display-mode: standalone)").matches
  }));
  expect(workers).toEqual({
    registrations: 0,
    controller: false,
    caches: [],
    standalone: false
  });

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await H.openFresh(page, "/");
    expect(await themeIsDark(page)).toBe(false);
    await noHorizontalOverflow(page);
    await setTheme(page, true);
    await closeMobileMenu(page);
    await noHorizontalOverflow(page);
    await setTheme(page, false);
    await closeMobileMenu(page);

    const book = page.locator("#homeFeaturedBooks a[href^='/book/']:visible").first();
    await expect(book).toBeVisible();
    await book.click();
    await expect(page).toHaveURL(/\/book\/\d+/);
    const add = page.locator(".detail-main-cart").first();
    await expect(add).toBeEnabled();
    await add.click();
    await clickVisibleHref(page, "/cart.html");
    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(page.locator("#cartItems")).toBeVisible();
    await expect(page.locator("#whatsappOrder")).toBeVisible();
    await clickVisibleHref(page, "/favorites.html");
    await expect(page).toHaveURL(/\/favorites\.html$/);
    await expect(page.locator("main, #favorites, h1").first()).toBeVisible();
    await page.goto("/account.html#signup", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#signupForm")).toBeVisible();
    await expect(page.locator("#loginForm")).toBeHidden();
  }
});

test("offline navigation is a failure and does not cache protected reads", async ({ page }) => {
  await H.installReadSafeNetwork(page);
  H.allowLiveCatalogReads(page);
  await H.openFresh(page, "/");
  const before = await page.evaluate(async () => ({
    registrations: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    caches: window.caches ? await caches.keys() : []
  }));
  expect(before).toEqual({ registrations: 0, caches: [] });
  await page.context().setOffline(true);
  let navigationFailed = false;
  try {
    await page.goto("/cart.html?offline=1", { waitUntil: "commit", timeout: 8000 });
  } catch (err) {
    navigationFailed = /ERR_INTERNET_DISCONNECTED|net::|offline|NS_ERROR/i.test(String(err));
  }
  expect(navigationFailed).toBe(true);
  await page.context().setOffline(false);
});
