const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shell = fs.readFileSync(path.join(__dirname, "..", "..", "book-shell.html"), "utf8");
const MISSING = "باھا تېخى بېكىتىلمىگەن";
const appConfig = fs.readFileSync(path.join(__dirname, "..", "..", "app-config.js"), "utf8")
  .replace("multiVolumeBooks:false", "multiVolumeBooks:true");

function member(bookId, position, price, stock) {
  return {
    book_id: String(bookId),
    position,
    volume_label: `${position}-قىسىم`,
    title: `قىسىم ${position}`,
    author: "سىناق ئاپتور",
    price,
    image_url: "/volume-cover-1.svg",
    stock,
    stock_status: stock > 0 ? "in_stock" : "out_of_stock",
    is_active: true
  };
}

function group(overrides) {
  return {
    id: "1",
    slug: "series-156",
    title: "ئويغانغان زېمىن",
    author: "ئابدۇرېھىم ئۆتكۈر",
    category: "تارىخىي رومانلار",
    source: "tarikhiy-romanlar.html",
    description: "",
    complete_set_price: null,
    representative_book_id: "156",
    revision: 2,
    quote_revision: "quote-missing",
    members: [member(156, 1, 370, 4), member(157, 2, 399, 4)],
    ...overrides
  };
}

const missingGroup = group({
  complete_set_price: "   ",
  member_count: 2,
  members: [member(156, 1, null, 4), member(157, 2, "   ", 4)]
});

function bookRow(row) {
  return {
    id: Number(row.book_id || row.id),
    title: row.title,
    author: row.author || "سىناق ئاپتور",
    category: "تارىخىي رومانلار",
    source: "tarikhiy-romanlar.html",
    price: row.price,
    image_url: row.image_url || "/volume-cover-1.svg",
    stock: row.stock == null ? 4 : row.stock,
    stock_status: row.stock_status || "in_stock",
    is_active: true,
    submission_status: "approved"
  };
}

async function openCart(page, bodyOrGetter, cart) {
  const calls = { quote: 0, group: 0 };
  await H.installReadSafeNetwork(page);
  await page.addInitScript((stored) => {
    try {
      localStorage.clear();
      sessionStorage.removeItem("kutadgu-catalog-active-count-v1");
      localStorage.setItem("kutadgu-cart-v1", JSON.stringify(stored.books));
      localStorage.setItem("kutadgu-set-cart-v1", JSON.stringify(stored.sets));
    } catch (error) {}
  }, cart);
  await page.route("**/app-config.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: appConfig
  }));
  await page.route("**/volume-cover-*.svg", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#70503d"/></svg>'
  }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: null })
  }));
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/rpc/get_public_book_volume_group_storefront")) {
      calls.group += 1;
      const body = typeof bodyOrGetter === "function" ? bodyOrGetter() : bodyOrGetter;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (url.includes("/rpc/quote_book_volume_cart")) {
      calls.quote += 1;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "quote_must_not_be_called" })
      });
    }
    if (url.includes("/rest/v1/books")) {
      const body = typeof bodyOrGetter === "function" ? bodyOrGetter() : bodyOrGetter;
      const books = (body.members || []).map(bookRow);
      if (cart.extraBooks) books.push(...cart.extraBooks);
      if (request.method() === "HEAD") {
        return route.fulfill({ status: 200, headers: { "content-range": `0-${Math.max(books.length - 1, 0)}/${books.length}` }, body: "" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `0-${Math.max(books.length - 1, 0)}/${books.length}` },
        body: JSON.stringify(books)
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/cart.html", { waitUntil: "domcontentloaded" });
  return calls;
}

test.describe("missing set prices", () => {
  test("null and whitespace RPC prices stay missing on the row and the total", async ({ page }) => {
    const calls = await openCart(page, missingGroup, {
      books: [],
      sets: [{ kind: "set", group_id: "1", qty: 1, quote_revision: "quote-missing" }]
    });
    const row = page.locator(".cart-volume-set");
    await expect(row).toHaveAttribute("data-set-quote-state", "blocked");
    await expect(row.locator(".cart-unit-price")).toContainText(MISSING);
    await expect(row.locator(".cart-line-price strong")).toHaveText(MISSING);
    await expect(page.locator(".cart-total strong")).toHaveText(MISSING);
    await expect(page.locator("#cartItems")).not.toContainText("0 ₺");
    await expect(page.locator("#checkoutCard")).toBeHidden();
    const normalized = await page.evaluate((raw) => {
      const api = window.KutadguVolumeGroups;
      const group = api.normalizeGroup(raw);
      return {
        prices: group.members.map((member) => member.price),
        explicit: group.complete_set_price,
        setPrice: api.groupSetPrice(group),
        available: api.setAvailable(group, 1)
      };
    }, missingGroup);
    expect(normalized).toEqual({
      prices: [null, null],
      explicit: null,
      setPrice: null,
      available: false
    });
    expect(calls.quote).toBe(0);
    expect(calls.group).toBeGreaterThan(0);
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-set-cart-v1") || "[]")))
      .toEqual([expect.objectContaining({ kind: "set", group_id: "1", qty: 1 })]);
  });

  test("explicit 750, explicit zero, a complete sum, and an invalid member stay distinct", async ({ page }) => {
    const cases = [
      {
        name: "string 750",
        body: group({ complete_set_price: "750", members: [member(156, 1, "370", 0), member(157, 2, "399", 0)] }),
        row: "750 ₺",
        total: "750 ₺"
      },
      {
        name: "explicit zero",
        body: group({ complete_set_price: 0, members: [member(156, 1, 370, 0), member(157, 2, 399, 0)] }),
        row: "0 ₺",
        total: "0 ₺"
      },
      {
        name: "complete sum",
        body: group({ complete_set_price: null, members: [member(156, 1, 370, 0), member(157, 2, 399, 0)] }),
        row: "769 ₺",
        total: "769 ₺"
      },
      {
        name: "invalid member",
        body: group({ complete_set_price: "", members: [member(156, 1, "nope", 0), member(157, 2, 399, 0)] }),
        row: MISSING,
        total: MISSING
      }
    ];
    let current = cases[0].body;
    const calls = await openCart(page, () => current, {
      books: [],
      sets: [{ kind: "set", group_id: "1", qty: 1 }]
    });
    for (const item of cases) {
      current = item.body;
      if (item !== cases[0]) await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".cart-volume-set .cart-line-price strong"), item.name).toHaveText(item.row);
      await expect(page.locator(".cart-total strong"), item.name).toHaveText(item.total);
      await expect(page.locator("#checkoutCard"), item.name).toBeHidden();
      expect(calls.quote, item.name).toBe(0);
    }
  });

  test("a mixed cart does not present the known book subtotal until the unknown set is removed", async ({ page }) => {
    const calls = await openCart(page, missingGroup, {
      books: [{ id: "658", qty: 1 }],
      sets: [{ kind: "set", group_id: "1", qty: 1 }],
      extraBooks: [bookRow({
        id: 658,
        title: "ئادەتتىكى كىتاب",
        price: 120,
        stock: 3,
        stock_status: "in_stock"
      })]
    });
    const book = page.locator(".cart-item").filter({ hasText: "ئادەتتىكى كىتاب" });
    await expect(book.locator(".cart-line-price strong")).toHaveText("120 ₺");
    await expect(page.locator(".cart-volume-set .cart-line-price strong")).toHaveText(MISSING);
    await expect(page.locator(".cart-total strong")).toHaveText(MISSING);
    await expect(page.locator(".cart-total strong")).not.toHaveText("120 ₺");
    await expect(page.locator("#checkoutCard")).toBeHidden();
    expect(calls.quote).toBe(0);

    await page.locator(".cart-volume-set .remove-cart").click();
    await expect(page.locator(".cart-volume-set")).toHaveCount(0);
    await expect(page.locator(".cart-total strong")).toHaveText("120 ₺");
    await expect(page.locator("#checkoutCard")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => ({
      books: JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]"),
      sets: JSON.parse(localStorage.getItem("kutadgu-set-cart-v1") || "[]")
    }))).toEqual({
      books: [{ id: "658", qty: 1 }],
      sets: []
    });
  });

  test("detail fallback keeps a missing set price missing and keeps series-156 prices", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.removeItem("kutadgu-catalog-active-count-v1");
      } catch (error) {}
    });
    const groups = {
      "missing-prices": group({
        id: "9",
        slug: "missing-prices",
        title: "باھاسى يوق يۈرۈشلۈك",
        complete_set_price: " ",
        representative_book_id: "201",
        members: [member(201, 1, 370, 4), member(202, 2, null, 4)]
      }),
      "series-156": group({
        complete_set_price: 750,
        members: [member(156, 1, 370, 4), member(157, 2, 399, 4)]
      })
    };
    await page.route("**/app-config.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: appConfig
    }));
    await page.route("**/volume-group/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shell
    }));
    await page.route("**/volume-cover-*.svg", (route) => route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#70503d"/></svg>'
    }));
    await page.route("**/auth/v1/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: null })
    }));
    await page.route("**/rest/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/rpc/get_public_book_volume_group_storefront")) {
        const payload = route.request().postDataJSON();
        const key = payload && payload.p_slug ? payload.p_slug : "series-156";
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(groups[key]) });
      }
      if (url.includes("/rpc/quote_book_volume_cart")) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "quote_must_not_be_called" }) });
      }
      if (url.includes("/rest/v1/books")) {
        const books = Object.values(groups).flatMap((item) => item.members.map(bookRow));
        if (route.request().method() === "HEAD") {
          return route.fulfill({ status: 200, headers: { "content-range": "0-3/4" }, body: "" });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(books) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/volume-group/missing-prices", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-set-price")).toContainText(MISSING);
    await expect(page.locator(".volume-set-price")).not.toContainText("370");
    await expect(page.locator(".volume-member-price").nth(0)).toContainText("370");
    await expect(page.locator(".volume-member-price").nth(1)).toContainText(MISSING);
    await expect(page.locator(".volume-add-set")).toBeDisabled();

    await page.goto("/volume-group/series-156", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-set-price")).toContainText("750");
    await expect(page.locator(".volume-set-price")).toContainText("بېكىتىلگەن يۈرۈشلۈك باھاسى");
    await expect(page.locator(".volume-group-price-range")).toHaveCount(0);
    await expect(page.locator(".detail-price-label", { hasText: "قىسىم باھاسى" })).toHaveCount(0);
    await expect(page.locator(".volume-member-price").nth(0)).toContainText("370");
    await expect(page.locator(".volume-member-price").nth(1)).toContainText("399");
    await expect(page.locator(".volume-set-price")).not.toContainText("769");
  });
});
