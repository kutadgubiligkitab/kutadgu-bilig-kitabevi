const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const NAME = "قۇتادغۇبىلىك كىتابخانىسى";

async function themeIsDark(page) {
  return page.locator("body").evaluate((el) => el.classList.contains("dark-mode"));
}

async function noHorizontalOverflow(page) {
  const box = await page.locator("body").evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

test("ordinary tab parses the manifest and keeps storefront navigation online", async ({ page }) => {
  await H.installReadSafeNetwork(page);
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
  expect(data.icons).toEqual([{
    src: "/kutadgu-logo.png",
    sizes: "1254x1254",
    type: "image/png"
  }]);
  if (parsed.parsed) {
    expect(parsed.parsed.name).toBe(NAME);
    expect(String(parsed.parsed.display || "")).toMatch(/standalone/i);
  }
  const icon = await page.evaluate(async () => {
    const response = await fetch("/kutadgu-logo.png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const image = new Image();
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const dimensions = await new Promise((resolve, reject) => {
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("logo failed to decode"));
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
  });
  expect(icon.type).toContain("image/png");
  expect(icon.ihdr).toBe("IHDR");
  expect(icon.width).toBe(1254);
  expect(icon.height).toBe(1254);
  expect(icon.decoded).toEqual({ width: 1254, height: 1254 });

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
    await page.locator("#themeButton").click();
    await expect.poll(() => themeIsDark(page)).toBe(true);
    await noHorizontalOverflow(page);
    await page.locator("#themeButton").click();
    await expect.poll(() => themeIsDark(page)).toBe(false);

    const book = page.locator('a[href^="/book/"]').first();
    await expect(book).toBeVisible();
    await book.click();
    await expect(page).toHaveURL(/\/book\/\d+/);
    await page.locator('a[href="/cart.html"]').first().click();
    await expect(page).toHaveURL(/\/cart\.html$/);
    await expect(page.locator("#whatsappOrder")).toBeVisible();
    await page.locator('a[href="/favorites.html"]').first().click();
    await expect(page).toHaveURL(/\/favorites\.html$/);
    await page.goto("/account.html#signup", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#signupForm")).toBeVisible();
    await expect(page.locator("#loginForm")).toBeHidden();
  }
});

test("offline navigation is a failure and does not cache protected reads", async ({ page }) => {
  await H.installReadSafeNetwork(page);
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
