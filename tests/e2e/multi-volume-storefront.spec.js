const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shell = fs.readFileSync(path.join(__dirname, "..", "..", "book-shell.html"), "utf8");
const appConfig = fs.readFileSync(path.join(__dirname, "..", "..", "app-config.js"), "utf8")
  .replace("multiVolumeBooks:false", "multiVolumeBooks:true");

const members = [
  {
    book_id: "1001", position: 1, volume_label: "1-جىلد", title: "بىرىنچى جىلد",
    author: "سىناق ئاپتور", price: 35, image_url: "/volume-cover-1.svg",
    stock: 4, stock_status: "in_stock", is_active: true
  },
  {
    book_id: "1002", position: 2, volume_label: "2-جىلد", title: "ئىككىنچى جىلد",
    author: "سىناق ئاپتور", price: 55, image_url: "/volume-cover-2.svg",
    stock: 2, stock_status: "in_stock", is_active: true
  },
  {
    book_id: "1003", position: 3, volume_label: "3-جىلد", title: "ئۈچىنچى جىلد",
    author: "سىناق ئاپتور", price: 65, image_url: "/volume-cover-3.svg",
    stock: 0, stock_status: "out_of_stock", is_active: true
  }
];

const group = {
  id: "77",
  slug: "sample-series",
  title: "سىناق توپلام",
  author: "سىناق ئاپتور",
  category: "رومانلار",
  source: "romanlar.html",
  description: "ئۈچ جىلدلىق سىناق توپلام",
  complete_set_price: 125,
  effective_set_price: 125,
  representative_book_id: "1001",
  revision: 4,
  quote_revision: "quote-r4",
  members
};

function book(member) {
  return {
    id: Number(member.book_id),
    title: member.title,
    author: member.author,
    category: "رومانلار",
    source: "romanlar.html",
    description: member.title,
    price: member.price,
    image_url: member.image_url,
    stock: member.stock,
    stock_status: member.stock_status,
    is_active: true,
    submission_status: "approved",
    created_at: "2026-10-20T00:00:00Z"
  };
}

async function installFixture(page) {
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.removeItem("kutadgu-catalog-active-count-v1");
    } catch (error) {}
  });
  await page.route("**/volume-group/sample-series**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: shell
  }));
  await page.route("**/book/1002**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: shell
  }));
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
    if (url.includes("/rest/v1/books")) {
      if (request.method() === "HEAD") {
        return route.fulfill({
          status: 200,
          headers: { "content-range": "0-0/3" },
          body: ""
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-2/3" },
        body: JSON.stringify(members.map(book))
      });
    }
    if (url.includes("/rpc/get_public_book_volume_group_storefront")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(group) });
    }
    if (url.includes("/rpc/resolve_public_book_volume_context")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          book: book(members[1]),
          group,
          selected_book_id: "1002",
          canonical_path: "/book/1002"
        })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test.describe("multi-volume storefront", () => {
  test.beforeEach(async ({ page }) => {
    await installFixture(page);
  });

  test("group page selects available volumes and blocks an incomplete set", async ({ page }) => {
    await page.goto("/volume-group/sample-series", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-group-purchase-panel")).toBeVisible();
    await expect(page.locator("[data-volume-book-id]")).toHaveCount(3);
    await expect(page.locator(".volume-set-price")).toContainText("125");
    await expect(page.locator(".volume-add-set")).toBeDisabled();
    await expect(page.locator(".cart-stock-block-note")).toBeVisible();
    await expect(page.locator("[data-volume-book-id='1003']")).toBeDisabled();

    await page.locator("[data-volume-book-id='1002']").check();
    await expect(page.locator("[data-volume-selection-summary]")).toContainText("55");
    await expect(page.locator(".book-cover-box img")).toHaveAttribute("src", /volume-cover-2\.svg/);
    await page.locator(".volume-add-selected").click();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]")))
      .toEqual([{ id: "1001", qty: 1 }, { id: "1002", qty: 1 }]);
  });

  test("direct child link keeps that volume selected in group context", async ({ page }) => {
    await page.goto("/book/1002", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-group-purchase-panel")).toBeVisible();
    await expect(page.locator("[data-volume-book-id='1002']")).toBeChecked();
    await expect(page.locator("[data-volume-selection-summary]")).toContainText("ئىككىنچى جىلد");
    await expect(page.locator(".volume-group-stable-link")).toHaveAttribute("href", "/volume-group/sample-series");
  });
});
