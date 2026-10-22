const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const artifactDir = "/opt/cursor/artifacts/compact-series-cards";
const styles = [
  "/listing-card-safety.css?v=2",
  "/detail-similar-card-safety.css",
  "/stage4b-public-cards.css",
  "/premium-ux.css?v=10",
  "/stage4b2-homepage-discovery.css?v=1",
  "/storefront-cards-1a-polish.css?v=3"
];

function installWriteGuards(page, blocked) {
  return page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (/visit-count|analytics-event|analytics_events|visit-proof|cdn-cgi\/rum|posthog|\/orders|create_member_order|storage\/v1\/object|admin_/i.test(url)) {
        blocked.push(method + " " + url);
        return route.abort();
      }
      if (/\/rpc\/(get_public_book_volume_group_storefront|quote_book_volume_cart|query_public_book_catalog)(?:\?|$)/.test(url)) {
        return route.continue();
      }
      blocked.push(method + " " + url);
      return route.fulfill({ status: 204, contentType: "application/json", body: "[]" });
    }
    return route.fallback();
  });
}

async function paintFixture(page) {
  for (const href of styles) {
    await page.addStyleTag({ url: href }).catch(() => {});
  }
  await page.addScriptTag({ url: "/premium-ux.js?v=18" });
  await page.waitForFunction(() => window.KutadguPremiumUx && typeof window.KutadguPremiumUx.compactCard === "function");
  await page.evaluate(() => {
    const shop = window.kutadguShop;
    const premium = window.KutadguPremiumUx;
    const ordinary = {
      id: "11", title: "ئادەتتىكى كىتاب", author: "ئابدۇرېھىم ئۆتكۈر", price: 120,
      href: "/book/11", image: "/kutadgu-logo.png", category: "رومانلار", stock: 8
    };
    const series = {
      id: "156", catalogKind: "group", kind: "group", groupId: "1", groupSlug: "series-156",
      title: "ئويغانغان زېمىن", author: "ئابدۇرېھىم ئۆتكۈر", memberCount: 2,
      memberPrices: [370, 399], completeSetPrice: 750, effectiveSetPrice: 750, price: 370,
      href: "/volume-group/series-156", image: "/kutadgu-logo.png", category: "تارىخىي رومانلار", stock: 8
    };
    const three = {
      ...series, id: "301", groupId: "3", title: "ئۈچ قىسىملىق", memberCount: 3,
      memberPrices: [100, 120, 140], completeSetPrice: null, effectiveSetPrice: null, price: 55,
      href: "/volume-group/three"
    };
    const hundred = {
      ...series, id: "302", groupId: "4", title: "يۈز قىسىملىق يۈرۈشلۈك", memberCount: 100,
      memberPrices: [10], completeSetPrice: 750, price: 10, href: "/volume-group/hundred"
    };
    const longTitle = "بۇ ناھايىتى ئۇزۇن يۈرۈشلۈك نامى بولۇپ بىر قۇرغا سىغمەيدۇ ۋە ئىككىنچى قۇرغا چۈشىدۇ";
    const longBook = { ...series, id: "303", groupId: "5", title: longTitle, href: "/volume-group/long" };
    const missing = {
      ...series, id: "304", groupId: "6", title: "باھاسىز يۈرۈشلۈك", memberCount: 2,
      memberPrices: [], completeSetPrice: null, effectiveSetPrice: null, price: 370,
      href: "/volume-group/missing"
    };
    const summed = {
      ...series, id: "305", groupId: "7", title: "يىغىندا", completeSetPrice: null,
      effectiveSetPrice: 769, price: 370, href: "/volume-group/summed"
    };
    ["homeFeaturedBooks", "newBooksCarousel", "searchResults", "premiumDiscoveryResults"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.removeAttribute("id");
    });
    document.querySelectorAll("[data-detail-related]").forEach((node) => node.removeAttribute("data-detail-related"));
    const host = document.createElement("section");
    host.id = "compactSeriesFixture";
    host.innerHTML = `
      <style>
        #compactSeriesFixture{padding:16px;box-sizing:border-box}
        body > *:not(#compactSeriesFixture){display:none !important}
        #compactSeriesFixture .books-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
        @media(max-width:900px){#compactSeriesFixture .books-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:380px){#compactSeriesFixture .books-grid{grid-template-columns:1fr}}
        #compactSeriesFixture h2{margin:18px 0 8px;font-size:18px}
        @media(max-width:430px){
          #compactSeriesFixture #newBooksCarousel .home-carousel-viewport{overflow:visible}
          #compactSeriesFixture #newBooksCarousel .home-carousel-track.is-single-row{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}
          #compactSeriesFixture #newBooksCarousel .home-carousel-track.is-single-row .home-carousel-card{flex-basis:auto!important;max-width:none!important;width:100%!important}
        }
      </style>
      <h2>تىزىملىك</h2>
      <div class="books-grid" data-catalog-source="fixture" data-catalog-ready="1">
        ${shop.bookCardMarkup(ordinary)}
        ${shop.bookCardMarkup(series)}
        ${shop.bookCardMarkup(three)}
        ${shop.bookCardMarkup(hundred)}
        ${shop.bookCardMarkup(longBook)}
        ${shop.bookCardMarkup(missing)}
        ${shop.bookCardMarkup(summed)}
      </div>
      <h2>يېقىندا قوشۇلغانلار</h2>
      <div id="homeFeaturedBooks"><div class="home-featured-grid">${shop.homeFeatureCard(ordinary)}${shop.homeFeatureCard(series)}</div></div>
      <h2>تاللانما</h2>
      <div id="newBooksCarousel"><div class="home-carousel-viewport"><div class="home-carousel-track is-single-row">${shop.homeCarouselCard(ordinary, 0)}${shop.homeCarouselCard(series, 1)}</div></div></div>
      <h2>مۇناسىۋەتلىك</h2>
      <div data-detail-related="1"><div class="shop-grid detail-related-grid">${shop.miniCard(ordinary)}${shop.miniCard(series)}</div></div>
      <h2>ئىزدەش</h2>
      <div id="searchResults"><div class="advanced-search-results-grid">${shop.bookCardMarkup(ordinary, "search")}${shop.bookCardMarkup(series, "search")}</div></div>
      <h2>بايقاش</h2>
      <div id="premiumDiscoveryResults"><div class="premium-book-grid">${premium.compactCard(ordinary)}${premium.compactCard(series)}</div></div>
    `;
    document.body.appendChild(host);
    [...document.body.children].forEach((node) => {
      if (node !== host) node.hidden = true;
    });
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const problems = [];
    function pair(selector, coverSelector, actionSelector) {
      const cards = [...document.querySelectorAll(selector)].slice(0, 2);
      if (cards.length < 2) {
        problems.push(selector + " missing pair");
        return;
      }
      const covers = cards.map((card) => card.querySelector(coverSelector));
      const actions = cards.map((card) => card.querySelector(actionSelector));
      if (covers.some((node) => !node) || actions.some((node) => !node)) {
        problems.push(selector + " missing cover or action");
        return;
      }
      const coverBoxes = covers.map((node) => node.getBoundingClientRect());
      const actionBoxes = actions.map((node) => node.getBoundingClientRect());
      const cardBoxes = cards.map((node) => node.getBoundingClientRect());
      const coverDelta = Math.abs(coverBoxes[0].height - coverBoxes[1].height);
      const sameRow = Math.abs(cardBoxes[0].top - cardBoxes[1].top) < 8;
      const actionDelta = sameRow
        ? Math.abs(actionBoxes[0].bottom - actionBoxes[1].bottom)
        : Math.abs((cardBoxes[0].bottom - actionBoxes[0].bottom) - (cardBoxes[1].bottom - actionBoxes[1].bottom));
      if (coverDelta > 2) problems.push(selector + " cover " + coverDelta.toFixed(1));
      if (actionDelta > 4) problems.push(selector + " action " + actionDelta.toFixed(1));
    }
    const root = "#compactSeriesFixture";
    pair(root + " .books-grid .book-card", ".book-image", ".book-actions");
    pair(root + " #homeFeaturedBooks .home-feature-card", ".home-feature-cover", ".home-feature-bottom");
    pair(root + " #newBooksCarousel .home-carousel-card", ".home-carousel-cover", ".home-carousel-bottom");
    pair(root + " [data-detail-related] .shop-mini-card", "img", ".mini-actions");
    pair(root + " #searchResults .advanced-search-result", ".advanced-search-cover", ".advanced-search-actions");
    pair(root + " #premiumDiscoveryResults .premium-book-card", ".premium-card-cover", ".premium-card-cart");
    const series = document.querySelector('#compactSeriesFixture a.detail-button[href="/volume-group/series-156"]')?.closest("article");
    const text = series ? series.innerText : "";
    const title = series?.querySelector(".book-title");
    return {
      overflow,
      problems,
      text,
      titleAttr: title ? title.getAttribute("title") : "",
      titleText: title ? title.textContent : ""
    };
  });
}

test.describe("compact series cards", () => {
  test("grouped and ordinary cards stay aligned across widths and themes", async ({ page }) => {
    test.setTimeout(120000);
    fs.mkdirSync(artifactDir, { recursive: true });
    const blocked = [];
    await H.installReadSafeNetwork(page);
    await installWriteGuards(page, blocked);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.kutadguShop && typeof window.kutadguShop.bookCardMarkup === "function");
    await paintFixture(page);
    const owner = page.locator("#compactSeriesFixture .book-card", { has: page.locator('a[href="/volume-group/series-156"]') }).first();
    await expect(owner).toContainText("ئويغانغان زېمىن — 2 قىسىم");
    await expect(owner).toContainText("750");
    await expect(owner).toContainText("تەپسىلاتى");
    await expect(owner).not.toContainText("370");
    await expect(owner).not.toContainText("399");
    await expect(owner).not.toContainText("769");
    await expect(owner).not.toContainText("بېكىتىلگەن يۈرۈشلۈك باھاسى");
    await expect(page.locator("#compactSeriesFixture")).toContainText("360");
    await expect(page.locator("#compactSeriesFixture")).toContainText("100 قىسىم");
    await expect(page.locator("#compactSeriesFixture")).toContainText("باھا تېخى بېكىتىلمىگەن");
    await expect(page.locator("#compactSeriesFixture")).toContainText("769");
    for (const selector of [
      "#compactSeriesFixture #homeFeaturedBooks .home-feature-card",
      "#compactSeriesFixture #newBooksCarousel .home-carousel-card",
      "#compactSeriesFixture [data-detail-related] .shop-mini-card",
      "#compactSeriesFixture #searchResults .advanced-search-result",
      "#compactSeriesFixture #premiumDiscoveryResults .premium-book-card"
    ]) {
      const card = page.locator(selector).filter({ hasText: "ئويغانغان زېمىن — 2 قىسىم" }).first();
      await expect(card).toContainText("750");
      await expect(card).toContainText("تەپسىلاتى");
      await expect(card).not.toContainText("370");
      await expect(card).not.toContainText("399");
    }
    const longTitle = page.locator("#compactSeriesFixture .book-title[title*='سىغمەيدۇ']");
    await expect(longTitle).toHaveAttribute("title", /— 2 قىسىم$/);
    const sizes = [
      ["desktop", 1280, 900],
      ["tablet", 768, 1024],
      ["mobile", 390, 844]
    ];
    for (const [name, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.body.classList.remove("dark-mode"));
      let measured = await measure(page);
      expect(measured.overflow, name + " light overflow").toBeLessThanOrEqual(1);
      expect(measured.problems, name + " light " + measured.problems.join("; ")).toEqual([]);
      expect(measured.titleAttr).toBe(measured.titleText);
      await page.locator("#compactSeriesFixture").screenshot({ path: path.join(artifactDir, `${name}-light.png`) });
      await page.evaluate(() => document.body.classList.add("dark-mode"));
      measured = await measure(page);
      expect(measured.overflow, name + " dark overflow").toBeLessThanOrEqual(1);
      expect(measured.problems, name + " dark " + measured.problems.join("; ")).toEqual([]);
      await page.locator("#compactSeriesFixture").screenshot({ path: path.join(artifactDir, `${name}-dark.png`) });
    }
    expect(blocked.filter((item) => /^(GET|HEAD|OPTIONS)\s/i.test(item))).toEqual([]);
    expect(blocked.filter((item) => /quote_book_volume_cart|get_public_book_volume_group_storefront|query_public_book_catalog/i.test(item))).toEqual([]);
  });
});
