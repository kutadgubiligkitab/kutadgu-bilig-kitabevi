const { test, expect } = require("@playwright/test");
const path = require("path");
const variants = require("../../kutadgu-cover-variants.js");
const books = require("../../kutadgu-public-book.js");

const ORIGINAL = "https://www.kutadgubilik.com/__r2/book-covers/311/cover.webp";
const NARROW = "https://www.kutadgubilik.com/__r2/book-covers/107/cover.webp";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const SHELL = '<html><head><title>old</title></head><body><div class="book-cover-box"><img src="" alt="" hidden></div><div class="book-detail-info"><h1>old</h1></div></body></html>';

function published(sourceKey, width, heights) {
  return {
    sources: {
      [sourceKey]: {
        width,
        height: Math.round(width * 1.5),
        variants: heights.map((item) => ({
          width: item,
          height: Math.round(item * 1.5),
          bytes: 10,
          key: variants.variantObjectKey(sourceKey, item)
        }))
      }
    }
  };
}

function detailHtml(url, availability) {
  variants.useAvailability(availability);
  return books.applyFoundPublicBookHead(SHELL, "311", { id: "311", title: "قۇتادغۇ بىلىك", image_url: url });
}

async function openDetail(browser, viewport, scale, html, javaScript) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, javaScriptEnabled: javaScript });
  const page = await context.newPage();
  const hits = [];
  await page.route("**/__r2/**", (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await page.setContent(html);
  await page.locator(".book-cover-box img").evaluate((img) => img.decode());
  return { context, page, hits };
}

test("server detail HTML requests only published variants", async ({ browser }) => {
  const none = await openDetail(browser, { width: 390, height: 844 }, 2, detailHtml(ORIGINAL, { sources: {} }), false);
  expect(none.hits.some((url) => url.includes("/variants/"))).toBe(false);
  expect(none.hits.some((url) => url.includes("/311/cover.webp"))).toBe(true);
  expect(await none.page.locator(".book-cover-box img").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await none.context.close();

  const only480 = detailHtml(ORIGINAL, published("book-covers/311/cover.webp", 1000, [480]));
  expect(only480).toContain("480w");
  expect(only480).toContain("1000w");
  expect(only480).not.toContain("960w");
  const phone1 = await openDetail(browser, { width: 390, height: 844 }, 1, only480, false);
  expect(await phone1.page.locator(".book-cover-box img").evaluate((img) => img.currentSrc)).toContain("/w480/");
  await phone1.context.close();
  const phone = await openDetail(browser, { width: 390, height: 844 }, 2, only480, false);
  expect(phone.hits.some((url) => url.includes("/w960/"))).toBe(false);
  const phoneSrc = await phone.page.locator(".book-cover-box img").evaluate((img) => img.currentSrc);
  expect(phoneSrc).toContain("/311/cover.webp");
  expect(phoneSrc).not.toContain("/w480/");
  await phone.context.close();
  const phone3 = await openDetail(browser, { width: 390, height: 844 }, 3, only480, false);
  expect(await phone3.page.locator(".book-cover-box img").evaluate((img) => img.currentSrc)).not.toContain("/w480/");
  await phone3.context.close();

  const both = detailHtml(ORIGINAL, published("book-covers/311/cover.webp", 1600, [480, 960]));
  const mobileDetail = await openDetail(browser, { width: 390, height: 844 }, 2, both, false);
  expect(await mobileDetail.page.locator(".book-cover-box img").evaluate((img) => img.currentSrc)).toContain("/w960/");
  await mobileDetail.context.close();
  const dense = await openDetail(browser, { width: 390, height: 844 }, 3, both, false);
  const denseSrc = await dense.page.locator(".book-cover-box img").evaluate((img) => img.currentSrc);
  expect(denseSrc).toContain("/311/cover.webp");
  expect(denseSrc).not.toContain("/variants/");
  await dense.context.close();
  const desktop = await openDetail(browser, { width: 1280, height: 900 }, 1, both, false);
  expect(await desktop.page.locator(".book-cover-box img").evaluate((img) => img.currentSrc)).toContain("/w960/");
  await desktop.context.close();
});

test("cards and narrow sources follow the same availability", async ({ browser }) => {
  const cases = [
    { scale: 1, expectWidth: "480" },
    { scale: 2, expectWidth: "480" },
    { scale: 3, expectWidth: "960" }
  ];
  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: item.scale });
    const page = await context.newPage();
    await page.route("**/__r2/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.setContent('<main id="probe"></main><div class="book-cover-box" id="detail"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "..", "..", "shop.css") });
    await page.addScriptTag({ path: path.join(__dirname, "..", "..", "kutadgu-cover-variants.js") });
    await page.addScriptTag({ path: path.join(__dirname, "..", "..", "shop.js") });
    await page.evaluate(({ availability, original, narrow }) => {
      window.KutadguCoverVariants.useAvailability(availability);
      const card = window.kutadguShop.coverImgHtml({ id: "311", title: "قۇتادغۇ بىلىك", image: original }, { loading: "lazy", width: 320, height: 460 });
      document.querySelector("#probe").innerHTML = `<article class="book-card"><a class="book-image">${card}</a></article>`;
      const detail = document.createElement("img");
      detail.alt = "";
      detail.width = 320;
      detail.height = 460;
      document.querySelector("#detail").appendChild(detail);
      window.kutadguShop.assignCoverImage(detail, original, { bookId: "311" });
      const small = window.kutadguShop.coverImgHtml({ id: "107", title: "كىچىك", image: narrow }, { loading: "lazy" });
      document.querySelector("#probe").insertAdjacentHTML("beforeend", `<article class="book-card" id="narrow"><a class="book-image">${small}</a></article>`);
    }, {
      availability: {
        sources: Object.assign(
          {},
          published("book-covers/311/cover.webp", 1600, [480, 960]).sources
        )
      },
      original: ORIGINAL,
      narrow: NARROW
    });
    await page.locator(".book-card img").first().evaluate((img) => img.decode());
    await page.locator("#detail img").evaluate((img) => img.decode());
    expect(await page.locator(".book-card img").first().evaluate((img) => img.currentSrc)).toContain(`/w${item.expectWidth}/`);
    const detailSrc = await page.locator("#detail img").evaluate((img) => img.currentSrc);
    expect(detailSrc).toContain(item.scale === 1 ? "/w480/" : item.scale === 2 ? "/w960/" : "/311/cover.webp");
    if (item.scale === 3) expect(detailSrc).not.toContain("/variants/");
    await expect(page.locator("#narrow img")).not.toHaveAttribute("srcset", /.+/);
    expect(await page.locator(".book-card img").first().getAttribute("loading")).toBe("lazy");
    for (const mode of ["", "dark-mode"]) {
      await page.evaluate((name) => { document.body.className = name; }, mode);
      expect(await page.locator(".book-card .book-image").first().evaluate((node) => getComputedStyle(node).aspectRatio)).toBe("2 / 3");
      expect(await page.locator(".book-card img").first().evaluate((node) => getComputedStyle(node).objectFit)).toBe("contain");
    }
    await context.close();
  }
});

test("a deleted published variant still falls back to the original once", async ({ page }) => {
  const hits = [];
  await page.route("**/__r2/**", (route) => {
    const url = route.request().url();
    hits.push(url);
    if (url.includes("/variants/")) return route.fulfill({ status: 404, body: "missing" });
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await page.setContent(detailHtml(ORIGINAL, published("book-covers/311/cover.webp", 1600, [480, 960])));
  await page.addScriptTag({ path: path.join(__dirname, "..", "..", "kutadgu-cover-variants.js") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "..", "shop.js") });
  await page.evaluate((original) => {
    const img = document.querySelector(".book-cover-box img");
    window.KutadguCoverVariants.useAvailability({ sources: {} });
    window.kutadguShop.assignCoverImage(img, original, { bookId: "311" });
    img.setAttribute("srcset", img.getAttribute("srcset") || "https://www.kutadgubilik.com/__r2/book-covers/variants/v1/w960/311/cover.webp.webp 960w");
    img.src = original;
  }, ORIGINAL);
  await expect.poll(() => page.locator(".book-cover-box img").evaluate((img) => img.getAttribute("srcset"))).toBeNull();
  await expect.poll(() => page.locator(".book-cover-box img").evaluate((img) => img.currentSrc)).toContain("/311/cover.webp");
  expect(hits.filter((url) => url.includes("/variants/")).length).toBeLessThan(4);
});
