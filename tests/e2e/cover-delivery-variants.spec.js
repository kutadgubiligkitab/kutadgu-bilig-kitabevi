const { test, expect } = require("@playwright/test");
const path = require("path");

const ORIGINAL = "https://www.kutadgubilik.com/__r2/book-covers/311/cover.webp";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function pageWithImages(browser, viewport, scale) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  const page = await context.newPage();
  await page.route("**/__r2/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  return { context, page };
}

test("card and detail srcset select the measured widths", async ({ browser }) => {
  const cases = [
    { viewport: { width: 390, height: 844 }, scale: 2, sizes: "(max-width: 650px) 46vw, (max-width: 900px) 30vw, 240px", expectWidth: "480" },
    { viewport: { width: 390, height: 844 }, scale: 2, sizes: "(max-width: 700px) min(92vw, 560px), 560px", expectWidth: "960" },
    { viewport: { width: 1280, height: 900 }, scale: 1, sizes: "(max-width: 650px) 46vw, (max-width: 900px) 30vw, 240px", expectWidth: "480" },
    { viewport: { width: 1280, height: 900 }, scale: 2, sizes: "(max-width: 700px) min(92vw, 560px), 560px", expectWidth: "960" }
  ];
  for (const item of cases) {
    const { context, page } = await pageWithImages(browser, item.viewport, item.scale);
    await page.setContent(`<img id="cover" alt="" width="320" height="460" loading="lazy" decoding="async">`);
    await page.addScriptTag({ path: path.join(__dirname, "..", "..", "kutadgu-cover-variants.js") });
    await page.evaluate(({ original, sizes }) => {
      const img = document.querySelector("#cover");
      img.src = original;
      img.srcset = window.KutadguCoverVariants.srcsetFor(original);
      img.sizes = sizes;
    }, { original: ORIGINAL, sizes: item.sizes });
    await page.locator("#cover").evaluate((img) => img.decode());
    const selected = await page.locator("#cover").evaluate((img) => img.currentSrc);
    expect(selected).toContain(`/w${item.expectWidth}/`);
    expect(selected).not.toContain("/book-covers/311/cover.webp");
    await context.close();
  }
});

test("a missing variant falls back to the original once", async ({ page }) => {
  const hits = [];
  await page.route("**/__r2/**", (route) => {
    const url = route.request().url();
    hits.push(url);
    if (url.includes("/variants/")) return route.fulfill({ status: 404, body: "missing" });
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await page.setContent('<img id="cover" alt="" data-cover-src="" width="320" height="460" loading="lazy" decoding="async">');
  await page.addScriptTag({ path: path.join(__dirname, "..", "..", "kutadgu-cover-variants.js") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "..", "shop.js") });
  await page.evaluate((original) => {
    const img = document.querySelector("#cover");
    img.setAttribute("data-cover-book", "311");
    window.kutadguShop.assignCoverImage(img, original, { bookId: "311", loading: "lazy" });
  }, ORIGINAL);
  await expect.poll(() => page.locator("#cover").evaluate((img) => img.getAttribute("srcset"))).toBeNull();
  await expect.poll(() => page.locator("#cover").evaluate((img) => img.currentSrc)).toContain("/311/cover.webp");
  const variantHits = hits.filter((url) => url.includes("/variants/"));
  expect(variantHits.length).toBeGreaterThan(0);
  expect(variantHits.length).toBeLessThan(4);
  expect(await page.locator("#cover").getAttribute("loading")).toBe("lazy");
});

test("zoom uses the original and cards keep their frame", async ({ page }) => {
  await page.route("**/__r2/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.setContent('<div id="probe"></div>');
  await page.addStyleTag({ path: path.join(__dirname, "..", "..", "shop.css") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "..", "kutadgu-cover-variants.js") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "..", "shop.js") });
  const markup = await page.evaluate((original) => {
    const html = window.kutadguShop.coverImgHtml({ id: "311", title: "قۇتادغۇ بىلىك", image: original }, { loading: "lazy", width: 320, height: 460 });
    document.querySelector("#probe").innerHTML = `<article class="book-card"><a class="book-image">${html}</a></article>`;
    window.kutadguShop.openCoverLightbox([original], 0);
    return html;
  }, ORIGINAL);
  expect(markup).toContain("loading=\"lazy\"");
  const card = page.locator(".book-card .book-image");
  const image = page.locator(".book-card img");
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image).toHaveAttribute("srcset", /w480\/311\/cover\.webp 480w/);
  for (const mode of ["", "dark-mode"]) {
    await page.evaluate((name) => { document.body.className = name; }, mode);
    const frame = await card.evaluate((node) => getComputedStyle(node).aspectRatio);
    const fit = await image.evaluate((node) => getComputedStyle(node).objectFit);
    expect(frame).toBe("2 / 3");
    expect(fit).toBe("contain");
  }
  const zoom = page.locator(".cover-zoom-overlay img");
  await expect(zoom).toHaveAttribute("src", ORIGINAL);
  await expect(zoom).not.toHaveAttribute("srcset", /.+/);
});

test("encoding keeps proportions and does not enlarge", async ({ page }) => {
  await page.addScriptTag({ path: path.join(__dirname, "..", "..", "kutadgu-cover-variants.js") });
  const result = await page.evaluate(async () => {
    function canvas(width, height, alpha) {
      const node = document.createElement("canvas");
      node.width = width;
      node.height = height;
      const ctx = node.getContext("2d", { alpha: true });
      ctx.clearRect(0, 0, width, height);
      if (!alpha) {
        ctx.fillStyle = "#f4efe6";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.fillStyle = "#24170f";
      ctx.font = "600 18px sans-serif";
      ctx.fillText("قۇتادغۇ بىلىك 古兰经注 Kutadgu", 8, 28);
      return new Promise((resolve) => node.toBlob(resolve, alpha ? "image/png" : "image/webp", 0.92));
    }
    const large = await canvas(1200, 1800, false);
    const small = await canvas(300, 450, false);
    const clear = await canvas(800, 1200, true);
    const encoded = await window.KutadguCoverVariants.encodeDeliveryVariants(large);
    const skipped = await window.KutadguCoverVariants.encodeDeliveryVariants(small);
    const transparent = await window.KutadguCoverVariants.encodeDeliveryVariants(clear);
    return {
      widths: encoded.map((item) => item.width),
      heights: encoded.map((item) => item.height),
      bytes: encoded.map((item) => item.bytes),
      skipped: skipped.length,
      transparent: transparent.map((item) => ({ width: item.width, bytes: item.bytes }))
    };
  });
  expect(result.widths).toEqual([480, 960]);
  expect(result.heights).toEqual([720, 1440]);
  expect(result.bytes[0]).toBeGreaterThan(0);
  expect(result.bytes[1]).toBeGreaterThan(0);
  expect(result.skipped).toBe(0);
  expect(result.transparent.length).toBeGreaterThan(0);
  expect(result.transparent.every((item) => item.bytes > 0 && [480, 960].includes(item.width))).toBe(true);
});
