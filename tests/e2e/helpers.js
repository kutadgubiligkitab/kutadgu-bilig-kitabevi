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
 * Default maintenance_mode to false so the suite does not depend on the live flag.
 */
async function installReadSafeNetwork(page) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const isWrite = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
    if (!isWrite) {
      if (url.includes("/rest/v1/store_settings")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ key: "maintenance_mode", value: false }])
        });
      }
      if (url.includes("/rest/v1/store_announcements")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]"
        });
      }
      if (url.includes("/rest/v1/store_announcement_settings")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ id: 1, rotation_interval_seconds: 5 }])
        });
      }
      return route.continue();
    }
    if (url.includes("/auth/v1/")) return route.continue();
    if (/\/rest\/v1\/(analytics_events|orders|books|profiles|admin_users|store_settings|store_announcements|store_announcement_settings)/.test(url)) {
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
      localStorage.removeItem("kutadgu-shop-owner-v1");
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

/** Control carousel mode payloads for both static catalog and remote queries. */
async function installCarouselCatalogStub(page, flags) {
  const recommended = flags.recommended === true;
  const newest = flags.newest === true;
  const bestseller = flags.bestseller === true;
  const bookCount = Math.max(1, Number(flags.bookCount) || 1);
  const featuredCount = flags.featuredCount == null ? null : Math.max(0, Number(flags.featuredCount) || 0);
  await page.addInitScript(({ recommended, newest, bestseller, bookCount, featuredCount }) => {
    window.__kutadguPositiveSalesCount = bestseller ? 3 : 0;
    let catalog = [];
    Object.defineProperty(window, "KITAP_CATALOG", {
      configurable: true,
      enumerable: true,
      get() { return catalog; },
      set(arr) {
        let rows = Array.isArray(arr) ? arr : [];
        if (featuredCount != null) rows = rows.slice(0, featuredCount);
        catalog = rows.map((book, i) => ({
          ...book,
          is_recommended: !!(recommended && i < bookCount),
          is_new: !!(newest && i < bookCount),
          sales_count: bestseller && i < bookCount ? 4 : 0
        }));
      }
    });
    const origFetch = window.fetch.bind(window);
    const jsonResponse = (rows, head) => {
      const list = Array.isArray(rows) ? rows : [];
      const last = Math.max(0, list.length - 1);
      return new Response(head ? null : JSON.stringify(list), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-range": list.length ? `0-${last}/${list.length}` : "*/0"
        }
      });
    };
    const stubBook = (extra) => ({
      id: extra.id || 91001,
      title: extra.title || "Carousel Stub Book",
      author: "تەست",
      price: 25,
      category: "رومانلار",
      image_url: "sample-book-cover.png",
      is_active: true,
      is_recommended: extra.is_recommended === true,
      is_new: extra.is_new === true,
      sales_count: Number(extra.sales_count) || 0
    });
    const stubBooks = (extra) => Array.from({ length: bookCount }, (_, i) => stubBook({
      ...extra,
      id: (extra.id || 91001) + i,
      title: `${extra.title || "Carousel Stub Book"} ${i + 1}`
    }));
    window.fetch = async (input, init) => {
      const url = String(typeof input === "string" ? input : input && input.url || "");
      const method = String((init && init.method) || (typeof input === "object" && input && input.method) || "GET").toUpperCase();
      if (!url.includes("/rest/v1/books")) return origFetch(input, init);
      if (method === "HEAD" && url.includes("sales_count=gt.0")) {
        return new Response(null, { status: 200, headers: { "content-range": `0-0/${bestseller ? 3 : 0}` } });
      }
      if (method === "HEAD" && url.includes("is_active=eq.true")) {
        return new Response(null, { status: 200, headers: { "content-range": "0-0/12" } });
      }
      if (url.includes("is_active=eq.false")) return jsonResponse([]);
      if (url.includes("is_recommended=eq.true")) {
        return jsonResponse(recommended ? stubBooks({ is_recommended: true, id: 91001, title: "Recommended Stub" }) : []);
      }
      if (url.includes("is_new=eq.true")) {
        return jsonResponse(newest ? stubBooks({ is_new: true, id: 92001, title: "Newest Stub" }) : []);
      }
      if (url.includes("sales_count=gt.0")) {
        return jsonResponse(bestseller ? stubBooks({ sales_count: 4, id: 93001, title: "Bestseller Stub" }) : []);
      }
      if (featuredCount != null) {
        return jsonResponse(Array.from({ length: featuredCount }, (_, i) => stubBook({
          id: 94001 + i,
          title: `Featured Stub ${i + 1}`
        })));
      }
      return jsonResponse([]);
    };
  }, { recommended, newest, bestseller, bookCount, featuredCount });
}

async function installAnnouncementFixtures(page, opts) {
  const options = opts || {};
  const missing = options.missing === true;
  const interval = options.interval == null ? 5 : Number(options.interval);
  const rows = Array.isArray(options.announcements) ? options.announcements : [];
  await page.route("**/rest/v1/store_announcement_settings**", async (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    if (missing) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ code: "PGRST205", message: "table not found" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 1, rotation_interval_seconds: interval }])
    });
  });
  await page.route("**/rest/v1/store_announcements**", async (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    if (missing) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ code: "PGRST205", message: "table not found" })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows)
    });
  });
}

module.exports = {
  PRODUCTION,
  targetOrigin,
  adminCreds,
  memberCreds,
  installReadSafeNetwork,
  installCarouselCatalogStub,
  installAnnouncementFixtures,
  waitForShop,
  clearShopStorage,
  readCart,
  readFavs,
  badgeCount,
  openFresh,
  collectPageErrors,
  waitForDetailTitle
};
