const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");
const path = require("path");

const SHORT = "قىسقا تەۋسىيە";
const LONG = "ئۇزۇن بايلىق نامى بەك ئۇزۇن بولۇپ قېلىش ۋە ئىككى قۇر سىنىقى ئۈچۈن يەنە بىر قۇر تېكىست";

async function installDiscoveryBooks(page) {
  await page.addInitScript(({ short, long }) => {
    const origFetch = window.fetch.bind(window);
    const jsonResponse = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const last = Math.max(0, list.length - 1);
      return new Response(JSON.stringify(list), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-range": list.length ? `0-${last}/${list.length}` : "*/0"
        }
      });
    };
    function row(extra) {
      return {
        id: extra.id,
        title: extra.title,
        author: extra.author || "سىناق ئاپتور",
        price: extra.price == null ? 88 : extra.price,
        category: extra.category || "رومانلار",
        image_url: "/kutadgu-logo.png",
        is_active: true,
        is_recommended: true,
        is_new: true,
        stock: extra.stock == null ? 5 : extra.stock,
        stock_status: extra.stock_status || "in_stock",
        sales_count: 3,
        created_at: "2026-08-01T00:00:00Z"
      };
    }
    window.fetch = async (input, init) => {
      const url = String(typeof input === "string" ? input : input && input.url || "");
      const method = String((init && init.method) || (typeof input === "object" && input && input.method) || "GET").toUpperCase();
      if (!url.includes("/rest/v1/books")) return origFetch(input, init);
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "0-0/8" } });
      }
      if (url.includes("is_active=eq.false")) return jsonResponse([]);
      const books = [
        row({ id: 81001, title: short }),
        row({ id: 81002, title: long }),
        row({ id: 81003, title: "تۈگىگەن بايلىق", stock: 0, stock_status: "out_of_stock" })
      ];
      return jsonResponse(books);
    };
  }, { short: SHORT, long: LONG });
}

function discoveryMetrics() {
  return () => {
    const slack = 1.5;
    const inside = (parent, child) => {
      if (!parent || !child) return false;
      const p = parent.getBoundingClientRect();
      const c = child.getBoundingClientRect();
      return c.left >= p.left - slack && c.right <= p.right + slack && c.top >= p.top - slack && c.bottom <= p.bottom + slack;
    };
    const card = document.querySelector("#premiumDiscoveryResults .premium-book-card");
    if (!card) return { missing: true };
    const cover = card.querySelector(".premium-card-cover");
    const img = cover && cover.querySelector("img");
    const title = card.querySelector("strong");
    const author = card.querySelector("small");
    const price = card.querySelector(".premium-card-price");
    const cart = card.querySelector(".premium-card-cart");
    const heart = card.querySelector(".premium-card-favorite");
    const badges = card.querySelector(".premium-card-badges");
    const coverBox = cover ? cover.getBoundingClientRect() : null;
    const titleBox = title ? title.getBoundingClientRect() : null;
    const nextAfterCover = badges || title;
    const nextBox = nextAfterCover ? nextAfterCover.getBoundingClientRect() : null;
    const priceBox = price ? price.getBoundingClientRect() : null;
    const cartBox = cart ? cart.getBoundingClientRect() : null;
    const titleStyle = title ? getComputedStyle(title) : null;
    const cardStyle = getComputedStyle(card);
    const grid = document.querySelector("#premiumDiscoveryResults .premium-book-grid");
    return {
      missing: false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      coverTitleGap: coverBox && nextBox ? nextBox.top - coverBox.bottom : 999,
      titleAfterCover: coverBox && titleBox ? titleBox.top - coverBox.bottom : 999,
      priceCartGap: priceBox && cartBox ? cartBox.top - priceBox.bottom : 999,
      cardHeight: card.getBoundingClientRect().height,
      titleClamp: titleStyle ? (titleStyle.webkitLineClamp || titleStyle.lineClamp) : "",
      objectFit: img ? getComputedStyle(img).objectFit : "",
      titleInside: inside(card, title),
      authorInside: !author || inside(card, author),
      priceInside: inside(card, price),
      cartInside: inside(card, cart),
      heartInside: !heart || inside(card, heart),
      alignItems: grid ? getComputedStyle(grid).alignItems : "",
      heightCss: cardStyle.height,
      justify: cardStyle.justifyContent
    };
  };
}

test.describe("compact discovery and recommended cards", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.clearShopStorage(page);
  });

  async function openDiscovery(page, width = 1366) {
    await installDiscoveryBooks(page);
    await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#premiumDiscovery", { timeout: 20000 });
    await page.locator("#premiumDiscovery [data-premium-group]").first().click();
    await expect.poll(async () => page.locator("#premiumDiscoveryResults .premium-book-card").count()).toBeGreaterThan(0);
  }

  test("A–E discovery cards stay compact with title clamp and contain cover", async ({ page }) => {
    await openDiscovery(page);
    const geo = await page.evaluate(discoveryMetrics());
    expect(geo.missing).toBeFalsy();
    expect(geo.coverTitleGap).toBeGreaterThanOrEqual(0);
    expect(geo.coverTitleGap).toBeLessThan(28);
    expect(geo.titleAfterCover).toBeLessThan(72);
    expect(geo.priceCartGap).toBeLessThan(28);
    expect(geo.alignItems).toMatch(/start/);
    expect(String(geo.titleClamp)).toBe("2");
    expect(geo.objectFit).toBe("contain");
    expect(geo.titleInside).toBeTruthy();
    expect(geo.authorInside).toBeTruthy();
    expect(geo.priceInside).toBeTruthy();
    expect(geo.cartInside).toBeTruthy();
    expect(geo.heartInside).toBeTruthy();
  });

  test("B natural height is not stretched by the discovery grid", async ({ page }) => {
    await openDiscovery(page);
    const geo = await page.evaluate(discoveryMetrics());
    expect(geo.heightCss).not.toBe("100%");
    expect(geo.justify).not.toBe("space-between");
  });

  test("F stock-zero discovery add stays blocked by storefront stock rules", async ({ page }) => {
    await openDiscovery(page);
    await page.locator('#premiumDiscoveryResults [data-premium-cart="81003"]').click();
    const count = await H.badgeCount(page);
    expect(count).toBe(0);
  });

  test("G 390 768 1366 discovery has no overflow or giant gaps", async ({ page }) => {
    for (const width of [390, 768, 1366]) {
      await openDiscovery(page, width);
      const geo = await page.evaluate(discoveryMetrics());
      expect(geo.missing, String(width)).toBeFalsy();
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      expect(geo.coverTitleGap, String(width)).toBeLessThan(28);
      expect(geo.priceCartGap, String(width)).toBeLessThan(28);
      expect(geo.cartInside, String(width)).toBeTruthy();
    }
  });

  test("recommended carousel also drops forced min-height", async ({ page }) => {
    await H.installCarouselCatalogStub(page, { recommended: true, newest: true, bestseller: false });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#newBooksCarousel .home-carousel-card").first()).toBeVisible();
    const geo = await page.evaluate(() => {
      const card = document.querySelector("#newBooksCarousel .home-carousel-card");
      const img = document.querySelector("#newBooksCarousel .home-carousel-cover img");
      return {
        minHeight: card ? getComputedStyle(card).minHeight : "",
        objectFit: img ? getComputedStyle(img).objectFit : "",
        titleClamp: (() => {
          const title = document.querySelector("#newBooksCarousel .home-carousel-title");
          if (!title) return "";
          const cs = getComputedStyle(title);
          return cs.webkitLineClamp || cs.lineClamp || "";
        })()
      };
    });
    expect(geo.minHeight === "0px" || geo.minHeight === "auto" || Number.parseFloat(geo.minHeight) === 0).toBeTruthy();
    if (geo.objectFit) expect(geo.objectFit).toBe("contain");
    if (geo.titleClamp) expect(String(geo.titleClamp)).toBe("2");
  });

  test("light and dark discovery cards stay compact", async ({ page }) => {
    await openDiscovery(page);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((next) => {
        document.body.classList.toggle("dark-mode", next === "dark");
        document.documentElement.classList.toggle("dark-mode", next === "dark");
      }, mode);
      const geo = await page.evaluate(discoveryMetrics());
      expect(geo.coverTitleGap, mode).toBeLessThan(28);
      expect(geo.objectFit, mode).toBe("contain");
    }
  });

  test("preview screenshots of discovery cards", async ({ page }) => {
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    for (const width of [1366, 390]) {
      await openDiscovery(page, width);
      const section = page.locator("#premiumDiscovery");
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: path.join(outDir, `discovery-cards-${width}.png`) });
    }
  });
});
