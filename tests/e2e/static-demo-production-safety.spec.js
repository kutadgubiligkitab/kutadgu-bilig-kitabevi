const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const DEMO_ID = "romanlar-2";
const DEMO_TITLE = "رومان كىتابى 2";
const REAL_ID = "123";
const REAL_TITLE = "رەسمىي رومان";
const OLD_SLUG = "old-slug";

function bookRow(overrides = {}) {
  return {
    id: Number(REAL_ID),
    title: REAL_TITLE,
    author: "رەسمىي ئاپتور",
    price: 88,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 5,
    stock_status: "in_stock",
    sales_count: 3,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

async function requireProductionAuthority(page) {
  await page.addInitScript(() => {
    window.KUTADGU_REQUIRE_REMOTE_PRODUCT_AUTHORITY = true;
  });
}

async function mockBooks(page, { fail = false, books = [bookRow()] } = {}) {
  await page.route("**/rest/v1/books**", async (route) => {
    if (fail) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "catalog down" })
      });
    }
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes("is_active=eq.false")) {
      const inactive = books.filter((row) => row.is_active === false);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `*/${inactive.length}` },
        body: JSON.stringify(inactive.map((row) => ({ id: row.id, legacy_id: row.legacy_id || null })))
      });
    }
    const parsed = new URL(url);
    let filtered = books.filter((row) => row.is_active !== false);
    const idParam = parsed.searchParams.get("id") || "";
    const legacyParam = parsed.searchParams.get("legacy_id") || "";
    const orParam = parsed.searchParams.get("or") || "";
    const wanted = [];
    const collect = (raw) => {
      const text = decodeURIComponent(String(raw || ""));
      const inMatch = text.match(/in\.\(([^)]*)\)/i);
      if (inMatch) {
        inMatch[1].split(",").forEach((part) => {
          const id = part.replace(/^"+|"+$/g, "").trim();
          if (id) wanted.push(id);
        });
      }
      const eqMatch = text.match(/eq\.([^,&)]+)/i);
      if (eqMatch) wanted.push(eqMatch[1].replace(/^"+|"+$/g, "").trim());
    };
    collect(idParam);
    collect(legacyParam);
    collect(orParam);
    if (wanted.length) {
      const set = new Set(wanted.map(String));
      filtered = books.filter((row) => set.has(String(row.id)) || set.has(String(row.legacy_id || "")));
    }
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${filtered.length}` },
        body: ""
      });
    }
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` },
      body: JSON.stringify(filtered)
    });
  });
}

async function detailState(page) {
  return page.evaluate(() => {
    const info = document.querySelector(".book-detail-info");
    const html = info ? info.innerHTML : "";
    const h1 = document.querySelector(".book-detail-info h1");
    return {
      title: h1 ? h1.textContent.trim() : "",
      html,
      unavailable: !!document.querySelector(".detail-unavailable-panel"),
      add: !!document.querySelector(".add-to-cart, [data-cart-id]"),
      fav: !!document.querySelector("[data-fav-id], .favorite-button"),
      fakePrice: /200\s*₺/.test(html) || /200\s*₺/.test(document.body.innerHTML),
      demoTitle: /رومان كىتابى 2/.test(html),
      visible: !!(window.kutadguShop && window.kutadguShop.isStorefrontVisible && window.kutadguShop.find && window.kutadguShop.isStorefrontVisible(window.kutadguShop.find("romanlar-2") || { id: "romanlar-2", isActive: true }))
    };
  });
}

test.describe("static demo production safety", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("production static romanlar-2 is not storefront-visible or sellable", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow()] });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const state = await page.evaluate(() => {
      const book = window.kutadguShop.find("romanlar-2");
      return {
        visible: window.kutadguShop.isStorefrontVisible(book || { id: "romanlar-2", isActive: true }),
        require: window.kutadguShop.requiresRemoteProductAuthority(),
        demoId: book && book.id
      };
    });
    expect(state.require).toBe(true);
    expect(state.visible).toBe(false);
  });

  test("/book/romanlar-2 is unavailable, not a fake priced product", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow()] });
    await page.goto(`/book/${DEMO_ID}`, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => (await detailState(page)).unavailable).toBe(true);
    const state = await detailState(page);
    expect(state.demoTitle).toBe(false);
    expect(state.fakePrice).toBe(false);
    expect(state.add).toBe(false);
    expect(state.title).toContain("تەمىنلەنمەيدۇ");
  });

  test("/romanlar-2.html raw first paint is not a fake product", async ({ request, baseURL }) => {
    const origin = String(baseURL || "").replace(/\/$/, "");
    const res = await request.get(`${origin}/romanlar-2.html`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/200\s*₺/);
    expect(html).not.toMatch(/رومان كىتابى 2/);
    expect(html).not.toMatch(/ئاپتور ئىسمى/);
    expect(html).not.toMatch(/add-to-cart/);
    expect(html).not.toMatch(/favorite-button/);
    expect(html).not.toMatch(/share-button/);
    expect(html).not.toMatch(/sample-book-cover\.png/);
    expect(html).toMatch(/data-static-detail-shell="1"/);
  });

  test("/romanlar-2.html is unavailable, not a fake priced product", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow()] });
    await page.goto("/romanlar-2.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => (await detailState(page)).unavailable).toBe(true);
    const state = await detailState(page);
    expect(state.demoTitle).toBe(false);
    expect(state.fakePrice).toBe(false);
    expect(state.add).toBe(false);
  });

  test("production static demo cannot add to cart or favorite", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow()] });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const result = await page.evaluate((id) => {
      window.kutadguShop.add(id);
      window.kutadguShop.toggleFav(id);
      return {
        cart: window.kutadguShop.cart().map((row) => String(row.id)),
        fav: window.kutadguShop.favorites(),
        toast: document.querySelector(".shop-toast") ? String(document.querySelector(".shop-toast").textContent || "") : ""
      };
    }, DEMO_ID);
    expect(result.cart).not.toContain(DEMO_ID);
    expect(result.fav).not.toContain(DEMO_ID);
  });

  test("static demo already in local cart cannot reach WhatsApp order", async ({ page }) => {
    await requireProductionAuthority(page);
    await page.addInitScript(({ demoId, realId }) => {
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: demoId, qty: 1 }, { id: realId, qty: 1 }]));
      localStorage.setItem("kutadgu-shop-owner-v1", "guest");
    }, { demoId: DEMO_ID, realId: REAL_ID });
    await mockBooks(page, { books: [bookRow()] });
    await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => page.evaluate((id) => {
      const book = window.kutadguShop.find(id);
      return !!(book && window.kutadguShop.isStorefrontVisible(book));
    }, REAL_ID)).toBe(true);
    await H.waitForHydratedCartTitle(page, REAL_TITLE);
    await expect(page.locator("#cartItems")).toHaveAttribute("data-cart-hydration", "ready");
    const ids = await page.evaluate(() => window.kutadguShop.cart().map((row) => String(row.id)));
    expect(ids).not.toContain(DEMO_ID);
    expect(ids).toContain(REAL_ID);
    const order = await page.evaluate(() => window.kutadguShop.buildOrderText(false));
    expect(order).toBeTruthy();
    expect(JSON.stringify(order)).not.toContain(DEMO_TITLE);
    expect(JSON.stringify(order)).not.toContain(DEMO_ID);
  });

  test("real active numeric supabase book still works", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow()] });
    await page.goto(`/book/${REAL_ID}`, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(".book-detail-info h1")).toContainText(REAL_TITLE);
    await page.evaluate((id) => window.kutadguShop.add(id), REAL_ID);
    const cart = await page.evaluate(() => window.kutadguShop.cart().map((row) => String(row.id)));
    expect(cart).toContain(REAL_ID);
  });

  test("static romanlar-2.html populates canonical remote book when mapped", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow({ legacy_id: DEMO_ID })] });
    await page.goto("/romanlar-2.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(".book-detail-info h1")).toContainText(REAL_TITLE);
    await expect(page.locator(".add-to-cart, .detail-main-cart")).toBeVisible();
    const state = await page.evaluate((slug) => {
      const book = window.kutadguShop.find(slug);
      return { id: book && String(book.id), remote: !!(book && book.isRemote) };
    }, DEMO_ID);
    expect(state.id).toBe(REAL_ID);
    expect(state.remote).toBe(true);
  });

  test("future remote legacy mapping resolves old-slug to canonical 123", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow({ legacy_id: OLD_SLUG })] });
    await page.goto(`/book/${OLD_SLUG}`, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect(page.locator(".book-detail-info h1")).toContainText(REAL_TITLE);
    const state = await page.evaluate((slug) => {
      const book = window.kutadguShop.find(slug);
      return {
        id: book && String(book.id),
        visible: !!(book && window.kutadguShop.isStorefrontVisible(book)),
        remote: !!(book && book.isRemote)
      };
    }, OLD_SLUG);
    expect(state.id).toBe(REAL_ID);
    expect(state.visible).toBe(true);
    expect(state.remote).toBe(true);
  });

  test("inactive remote mapped book is not sellable", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { books: [bookRow({ is_active: false, legacy_id: OLD_SLUG })] });
    await page.goto(`/book/${OLD_SLUG}`, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => {
      return page.evaluate(() => {
        const book = window.kutadguShop.find("old-slug") || window.kutadguShop.find("123");
        return book ? window.kutadguShop.isStorefrontVisible(book) : false;
      });
    }).toBe(false);
    const add = await page.evaluate(() => !!document.querySelector(".add-to-cart, .detail-main-cart"));
    expect(add).toBe(false);
  });

  test("supabase unavailable in production does not sell static demo inventory", async ({ page }) => {
    await requireProductionAuthority(page);
    await mockBooks(page, { fail: true });
    await page.goto(`/book/${DEMO_ID}`, { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await expect.poll(async () => (await detailState(page)).unavailable).toBe(true);
    const state = await detailState(page);
    expect(state.fakePrice).toBe(false);
    expect(state.add).toBe(false);
    const cart = await page.evaluate((id) => {
      window.kutadguShop.add(id);
      return window.kutadguShop.cart().map((row) => String(row.id));
    }, DEMO_ID);
    expect(cart).not.toContain(DEMO_ID);
  });

  test("local fixture static remains available when remote authority is not required", async ({ page }) => {
    await page.addInitScript(() => {
      window.KUTADGU_REQUIRE_REMOTE_PRODUCT_AUTHORITY = false;
    });
    await mockBooks(page, { fail: true });
    await page.goto("/romanlar-2.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const state = await page.evaluate(() => {
      const book = window.kutadguShop.find("romanlar-2");
      return {
        require: window.kutadguShop.requiresRemoteProductAuthority(),
        visible: !!(book && window.kutadguShop.isStorefrontVisible(book)),
        id: book && book.id
      };
    });
    expect(state.require).toBe(false);
    expect(state.id).toBe(DEMO_ID);
    expect(state.visible).toBe(true);
    await expect(page.locator(".book-detail-info h1")).toContainText(DEMO_TITLE);
  });
});
