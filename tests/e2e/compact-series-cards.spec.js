const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");

const artifactDir = "/opt/cursor/artifacts/compact-series-cards";
const MISSING = "باھا تېخى بېكىتىلمىگەن";

function fixtureItems() {
  const base = {
    author: "ئابدۇرېھىم ئۆتكۈر",
    image_url: "/kutadgu-logo.png",
    stock: 8,
    stock_status: "in_stock",
    is_active: true,
    category: "رومانلار",
    source: "romanlar.html"
  };
  return [
    { ...base, kind: "book", id: "11", title: "ئادەتتىكى كىتاب", price: 120 },
    { ...base, kind: "book", id: "12", title: "ئىككىنچى ئادەتتىكى", price: 80 },
    {
      ...base, kind: "group", id: "156", group_id: "1", group_slug: "series-156",
      title: "ئويغانغان زېمىن", member_count: 2, member_book_ids: ["156", "157"],
      member_prices: [370, 399], complete_set_price: 750, effective_set_price: 750,
      price: 370, category: "رومانلار", source: "romanlar.html"
    },
    {
      ...base, kind: "group", id: "301", group_id: "3", group_slug: "three",
      title: "ئۈچ قىسىملىق", member_count: 3, member_book_ids: ["301", "302", "303"],
      member_prices: [100, 120, 140], complete_set_price: null, effective_set_price: null, price: 55
    },
    {
      ...base, kind: "group", id: "302", group_id: "4", group_slug: "hundred",
      title: "يۈز قىسىملىق يۈرۈشلۈك", member_count: 100, member_book_ids: ["302", "303"],
      member_prices: [10], complete_set_price: 750, effective_set_price: null, price: 10
    },
    {
      ...base, kind: "group", id: "303", group_id: "5", group_slug: "long",
      title: "بۇ ناھايىتى ئۇزۇن يۈرۈشلۈك نامى بولۇپ بىر قۇرغا سىغمەيدۇ ۋە ئىككىنچى قۇرغا چۈشىدۇ",
      member_count: 2, member_book_ids: ["303", "304"], member_prices: [370, 399],
      complete_set_price: 750, effective_set_price: 750, price: 370
    },
    {
      ...base, kind: "group", id: "304", group_id: "6", group_slug: "missing",
      title: "باھاسىز يۈرۈشلۈك", member_count: 2, member_book_ids: ["304", "305"],
      member_prices: [null, null], complete_set_price: null, effective_set_price: null, price: 370
    },
    {
      ...base, kind: "group", id: "305", group_id: "7", group_slug: "summed",
      title: "يىغىندا", member_count: 2, member_book_ids: ["305", "306"],
      member_prices: [370, 399], complete_set_price: null, effective_set_price: 769, price: 370
    }
  ];
}

function unitKey(row) {
  return row.kind === "group" ? `group:${row.group_id}` : `book:${row.id}`;
}

function json(route, body, status = 200, headers = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function installIsolatedReads(page, unexpected) {
  const styleFailures = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "stylesheet") return;
    if (response.status() >= 400) styleFailures.push(`${response.status()} ${response.url()}`);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    let host = "";
    try { host = new URL(url).hostname; } catch (err) { host = ""; }
    const local = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
    if (local) {
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
      return route.fulfill({ status: 204, body: "" });
    }
    if (/\/rpc\/list_public_book_categories(?:\?|$)/.test(url)) {
      return json(route, { message: "missing" }, 404);
    }
    if (/\/rpc\/query_public_book_catalog(?:\?|$)/.test(url)) {
      const items = fixtureItems();
      return json(route, { items, total: items.length, has_more: false });
    }
    if (/\/rpc\/list_public_book_volume_discovery_unit_ids(?:\?|$)/.test(url)) {
      return json(route, fixtureItems().map(unitKey));
    }
    if (/\/rpc\/list_public_book_volume_part_prices(?:\?|$)/.test(url)) {
      return json(route, []);
    }
    if (/\/rpc\/get_public_book_volume_group_storefront(?:\?|$)/.test(url)) {
      return json(route, null);
    }
    if (/\/rpc\/quote_book_volume_cart(?:\?|$)/.test(url)) {
      return json(route, { schema_version: 1, currency: "TRY", total: 0, items: [] });
    }
    if (/\/rpc\/resolve_public_book_volume_context(?:\?|$)/.test(url)) {
      let requested = "";
      try { requested = String((request.postDataJSON() || {}).p_book_id || ""); } catch (err) { requested = ""; }
      const book = fixtureItems().find((row) => String(row.id) === requested) || null;
      return json(route, { book, group: null, selected_book_id: requested, canonical_path: requested ? `/book/${requested}` : "" });
    }
    if (method === "GET" && /\/rest\/v1\/books(?:\?|$)/.test(url) && !/is_active=eq\.false/.test(url)) {
      const items = fixtureItems();
      return json(route, items, 200, { "content-range": `0-${items.length - 1}/${items.length}` });
    }
    if (/\/rest\/v1\/books(?:\?|$)/.test(url) && (method === "HEAD" || method === "GET") && /select=id/.test(url) && /is_active=eq\.true/.test(url) && !/sales_count/.test(url)) {
      return json(route, method === "HEAD" ? "" : [], 200, { "content-range": "0-0/7" });
    }
    if (method === "HEAD" && /\/rest\/v1\/books(?:\?|$)/.test(url) && /sales_count=gt\.0/.test(url)) {
      return json(route, "", 200, { "content-range": "*/0" });
    }
    if (/\/rest\/v1\/books(?:\?|$)/.test(url) && /is_active=eq\.false/.test(url)) {
      return json(route, method === "HEAD" ? "" : [], 200, { "content-range": "*/0" });
    }
    if (/\/rest\/v1\/book_view_stats/.test(url)) return json(route, []);
    if (/\/rest\/v1\/book_credits/.test(url)) return json(route, []);
    if (/\/rest\/v1\/store_settings/.test(url)) {
      return json(route, [{ key: "maintenance_mode", value: false }]);
    }
    if (/\/rest\/v1\/store_announcements(?:\?|$)/.test(url)) return json(route, []);
    if (/\/rest\/v1\/store_announcement_settings/.test(url)) {
      return json(route, [{ id: 1, rotation_interval_seconds: 5 }]);
    }
    if (/\/rest\/v1\/store_hero_|\/rest\/v1\/store_homepage_about|\/rest\/v1\/store_shop_hours/.test(url)) {
      return json(route, { code: "PGRST205", message: "Could not find the table" }, 404);
    }
    unexpected.push(`${method} ${url}`);
    return route.abort();
  });
  return styleFailures;
}

async function expectStylesLoaded(page) {
  await page.waitForFunction(() => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].filter((link) => {
      try { return new URL(link.href, location.href).origin === location.origin; } catch (err) { return false; }
    });
    return links.length >= 4 && links.every((link) => link.sheet);
  }, { timeout: 15000 });
}

async function measurePair(page, cardSelector, coverSelector, actionSelector, ordinaryText = "ئادەتتىكى كىتاب") {
  return page.evaluate(({ cardSelector: cardsQuery, coverSelector: coverQuery, actionSelector: actionQuery, ordinaryText: ordinaryLabel }) => {
    const cardsInView = [...document.querySelectorAll(cardsQuery)];
    const ordinary = cardsInView.find((card) => (card.innerText || "").includes(ordinaryLabel));
    const series = cardsInView.find((card) => (card.innerText || "").includes("ئويغانغان زېمىن 2 قىسىم"));
    if (!ordinary || !series) return { problems: [`${cardsQuery} missing ordinary/series pair`] };
    const cards = [ordinary, series];
    const covers = cards.map((card) => card.querySelector(coverQuery));
    const actions = cards.map((card) => card.querySelector(actionQuery));
    if (covers.some((node) => !node) || actions.some((node) => !node)) {
      return { problems: [`${cardsQuery} missing cover or action`] };
    }
    const coverBoxes = covers.map((node) => node.getBoundingClientRect());
    const actionBoxes = actions.map((node) => node.getBoundingClientRect());
    const cardBoxes = cards.map((node) => node.getBoundingClientRect());
    const coverDelta = Math.abs(coverBoxes[0].height - coverBoxes[1].height);
    const sameRow = Math.abs(cardBoxes[0].top - cardBoxes[1].top) < 8;
    const actionDelta = sameRow
      ? Math.abs(actionBoxes[0].bottom - actionBoxes[1].bottom)
      : Math.abs((cardBoxes[0].bottom - actionBoxes[0].bottom) - (cardBoxes[1].bottom - actionBoxes[1].bottom));
    const problems = [];
    if (coverDelta > 2) problems.push(`${cardsQuery} cover ${coverDelta.toFixed(1)}`);
    if (actionDelta > 4) problems.push(`${cardsQuery} action ${actionDelta.toFixed(1)}`);
    return { problems };
  }, { cardSelector, coverSelector, actionSelector, ordinaryText });
}

test.describe("compact series cards", () => {
  test("grouped and ordinary cards stay aligned across widths and themes", async ({ page }) => {
    test.setTimeout(240000);
    fs.mkdirSync(artifactDir, { recursive: true });
    const unexpected = [];
    const styleFailures = await installIsolatedReads(page, unexpected);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((ids) => {
      sessionStorage.setItem("kutadgu-books-visit-v1", JSON.stringify({
        seed: "compact-series-fixture",
        ids,
        cursor: 0
      }));
    }, fixtureItems().map(unitKey));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectStylesLoaded(page);
    const featured = page.locator("#homeFeaturedBooks .home-feature-card", { hasText: "ئويغانغان زېمىن 2 قىسىم" }).first();
    await expect(featured).toBeVisible({ timeout: 30000 });
    await expect(featured).toContainText("750");
    await expect(featured).toContainText("تەپسىلاتى");
    await expect(featured).not.toContainText("370");
    await expect(featured).not.toContainText("399");
    const carousel = page.locator("#newBooksCarousel .home-carousel-card", { hasText: "ئويغانغان زېمىن 2 قىسىم" }).first();
    await expect(carousel).toBeVisible();
    await expect(carousel).toContainText("750");
    await expect(page.locator("#homeFeaturedBooks")).toContainText("360");
    await expect(page.locator("#homeFeaturedBooks")).toContainText("100 قىسىم");
    await expect(page.locator("#homeFeaturedBooks")).toContainText(MISSING);
    await expect(page.locator("#homeFeaturedBooks")).toContainText("769");

    await page.locator("#searchInput").fill("ئابدۇرېھىم");
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults .advanced-search-result", { hasText: "ئويغانغان زېمىن 2 قىسىم" }).first()).toBeVisible();

    await page.locator("[data-premium-group='literature']").click();
    await expect(page.locator("#premiumDiscoveryResults .premium-book-card", { hasText: "ئويغانغان زېمىن 2 قىسىم" }).first()).toBeVisible();

    const homeSurfaces = [
      ["#homeFeaturedBooks .home-feature-card", ".home-feature-cover", ".home-feature-bottom"],
      ["#newBooksCarousel .home-carousel-card", ".home-carousel-cover", ".home-carousel-bottom"],
      ["#searchResults .advanced-search-result", ".advanced-search-cover", ".advanced-search-actions"],
      ["#premiumDiscoveryResults .premium-book-card", ".premium-card-cover", ".premium-card-cart"]
    ];
    const sizes = [
      ["desktop", 1280, 900],
      ["tablet", 768, 1024],
      ["mobile", 390, 844]
    ];
    for (const [name, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.body.classList.remove("dark-mode"));
      for (const [cards, cover, action] of homeSurfaces) {
        const measured = await measurePair(page, cards, cover, action);
        expect(measured.problems, `${name} light ${measured.problems.join("; ")}`).toEqual([]);
      }
      await page.locator("#newBooksCarousel").screenshot({ path: path.join(artifactDir, `${name}-light-carousel.png`) });
      await page.evaluate(() => document.body.classList.add("dark-mode"));
      for (const [cards, cover, action] of homeSurfaces) {
        const measured = await measurePair(page, cards, cover, action);
        expect(measured.problems, `${name} dark ${measured.problems.join("; ")}`).toEqual([]);
      }
      await page.locator("#newBooksCarousel").screenshot({ path: path.join(artifactDir, `${name}-dark-carousel.png`) });
    }

    await page.goto("/book-shell.html?id=11", { waitUntil: "domcontentloaded" });
    await expectStylesLoaded(page);
    const related = page.locator("[data-detail-related] .shop-mini-card", { hasText: "ئويغانغان زېمىن 2 قىسىم" }).first();
    await expect(related).toBeVisible({ timeout: 30000 });
    for (const [name, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.body.classList.remove("dark-mode"));
      let measured = await measurePair(page, "[data-detail-related] .shop-mini-card", "img", ".mini-actions", "ئىككىنچى ئادەتتىكى");
      expect(measured.problems, `${name} light related ${measured.problems.join("; ")}`).toEqual([]);
      await page.evaluate(() => document.body.classList.add("dark-mode"));
      measured = await measurePair(page, "[data-detail-related] .shop-mini-card", "img", ".mini-actions", "ئىككىنچى ئادەتتىكى");
      expect(measured.problems, `${name} dark related ${measured.problems.join("; ")}`).toEqual([]);
    }

    await page.goto("/books", { waitUntil: "domcontentloaded" });
    await expectStylesLoaded(page);
    const listing = page.locator(".books-grid .book-card", { hasText: "ئويغانغان زېمىن 2 قىسىم" }).first();
    await expect(listing).toBeVisible({ timeout: 30000 });
    await expect(listing).toContainText("750");
    await expect(listing).toContainText("تەپسىلاتى");
    await expect(listing).not.toContainText("370");
    const longTitle = page.locator(".books-grid .book-title[title*='سىغمەيدۇ']");
    await expect(longTitle).toHaveAttribute("title", / 2 قىسىم$/);
    await expect(longTitle).not.toHaveAttribute("title", /— 2 قىسىم$/);
    for (const [name, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.body.classList.remove("dark-mode"));
      let measured = await measurePair(page, ".books-grid .book-card", ".book-image", ".book-actions");
      expect(measured.problems, `${name} light listing ${measured.problems.join("; ")}`).toEqual([]);
      await page.locator(".books-grid").screenshot({ path: path.join(artifactDir, `${name}-light.png`) });
      await page.evaluate(() => document.body.classList.add("dark-mode"));
      measured = await measurePair(page, ".books-grid .book-card", ".book-image", ".book-actions");
      expect(measured.problems, `${name} dark listing ${measured.problems.join("; ")}`).toEqual([]);
      await page.locator(".books-grid").screenshot({ path: path.join(artifactDir, `${name}-dark.png`) });
    }
    expect(styleFailures, styleFailures.join("; ")).toEqual([]);
    expect(unexpected).toEqual([]);
  });
});
