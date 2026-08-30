"use strict";

const PRODUCTION = "https://kutadgu-bilig-kitab.vercel.app";

function targetOrigin(page) {
  const url = page.context()._options?.baseURL || PRODUCTION;
  return String(url).replace(/\/+$/, "");
}

function adminCreds() {
  const email = String(process.env.KUTADGU_ADMIN_EMAIL || "").trim();
  const password = String(process.env.KUTADGU_ADMIN_PASSWORD || "").trim();
  if (!email || !password) return null;
  return { email, password };
}

function memberCreds() {
  const email = String(process.env.KUTADGU_MEMBER_EMAIL || "").trim();
  const password = String(process.env.KUTADGU_MEMBER_PASSWORD || "").trim();
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Block catalog/order/analytics writes. Allow GET catalog + Auth token exchange.
 */
async function installReadSafeNetwork(page) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const isWrite = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
    if (!isWrite) return route.continue();
    if (url.includes("/auth/v1/")) return route.continue();
    if (/\/rest\/v1\/(analytics_events|orders|books|profiles|admin_users|store_settings)/.test(url)) {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: "[]"
      });
    }
    return route.continue();
  });
}

async function waitForShop(page) {
  await page.waitForFunction(() => {
    if (!window.kutadguShop || typeof window.kutadguShop.add !== "function") return false;
    if (Array.isArray(window.KUTADGU_LIVE_CATALOG)) return true;
    return false;
  }, { timeout: 45_000 });
}

async function clearShopStorage(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("kutadgu-cart-v1");
      localStorage.removeItem("kutadgu-favorites-v1");
      localStorage.removeItem("kutadgu-recent-v1");
      localStorage.removeItem("kutadgu-customer-v1");
    } catch (e) {}
  });
}

async function readCart(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]");
    } catch (e) {
      return [];
    }
  });
}

async function readFavs(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("kutadgu-favorites-v1") || "[]");
    } catch (e) {
      return [];
    }
  });
}

async function badgeCount(page) {
  const n = await page.locator(".cart-count").first().textContent().catch(() => "0");
  return Number(String(n || "0").trim()) || 0;
}

async function openFresh(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForShop(page);
}

function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err && err.message ? err.message : err)));
  return errors;
}

async function waitForDetailTitle(page) {
  await page.waitForFunction(() => {
    const h1 = document.querySelector(".book-detail-info h1");
    const t = h1 && h1.textContent && h1.textContent.trim();
    return !!(t && t !== "كىتاب" && t.length > 1);
  }, { timeout: 45_000 });
  return page.locator(".book-detail-info h1").innerText();
}

module.exports = {
  PRODUCTION,
  targetOrigin,
  adminCreds,
  memberCreds,
  installReadSafeNetwork,
  waitForShop,
  clearShopStorage,
  readCart,
  readFavs,
  badgeCount,
  openFresh,
  collectPageErrors,
  waitForDetailTitle
};
