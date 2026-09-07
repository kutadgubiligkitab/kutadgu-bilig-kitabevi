const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");
const path = require("path");

const DETAIL_TITLE = "سوغۇق يۈكلەش تەپسىلات كىتابى";
const DETAIL_AUTHOR = "ھاجى مىرزاھىد كېرىمى، ساۋۇت داۋۇت ۋە يەنە بىر ئۇزۇن ئاپتور نامى";

function bookRow(overrides) {
  return {
    id: 91001,
    title: DETAIL_TITLE,
    author: DETAIL_AUTHOR,
    price: 88,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: "/kutadgu-logo.png",
    gallery_images: ["/hero-brand-logo.png"],
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

async function mockCatalog(page, books) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes("is_active=eq.false")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0" },
        body: "[]"
      });
    }
    const parsed = new URL(url);
    let filtered = books.filter((row) => row.is_active !== false);
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
    collect(parsed.searchParams.get("id") || "");
    collect(parsed.searchParams.get("legacy_id") || "");
    collect(parsed.searchParams.get("or") || "");
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
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` },
      body: JSON.stringify(filtered)
    });
  });
}

function authorMetrics() {
  return () => {
    const el = document.querySelector(".book-detail-info .book-author");
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fontPx = Number.parseFloat(cs.fontSize);
    return {
      missing: false,
      hidden: el.hidden || cs.display === "none" || cs.visibility === "hidden",
      text: String(el.textContent || "").trim(),
      fontPx,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      clipped: r.left < -2 || r.right > window.innerWidth + 2 || r.bottom < r.top,
      height: r.height,
      width: r.width
    };
  };
}

function coverMetrics() {
  return () => {
    const box = document.querySelector(".book-cover-box");
    const img = box && box.querySelector("img");
    if (!box || !img) return { missing: true };
    const br = box.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const imgCs = getComputedStyle(img);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return {
      missing: false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      boxWidth: br.width,
      imgWidth: ir.width,
      padX,
      minHeight: cs.minHeight,
      aspectRatio: cs.aspectRatio,
      padding: cs.padding,
      objectFit: imgCs.objectFit,
      objectPosition: imgCs.objectPosition,
      imgHeightCss: imgCs.height,
      fillRatio: br.width > 0 ? ir.width / br.width : 0
    };
  };
}

test.describe("mobile book detail cover frame", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["91001"]);
    await mockCatalog(page, [bookRow()]);
  });

  async function openDetail(page, width) {
    await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
    await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
    await H.waitForDetailTitle(page, DETAIL_TITLE);
    await page.waitForSelector(".book-cover-box img", { timeout: 20000 });
    await page.locator(".book-detail-info .book-author").waitFor({ state: "visible" });
  }

  test("G H I 390px cover uses compact padding and natural height", async ({ page }) => {
    await openDetail(page, 390);
    const geo = await page.evaluate(coverMetrics());
    expect(geo.missing).toBeFalsy();
    expect(geo.padX).toBeLessThanOrEqual(16);
    expect(geo.minHeight === "0px" || Number.parseFloat(geo.minHeight) === 0).toBeTruthy();
    expect(geo.aspectRatio === "auto" || geo.aspectRatio === "none").toBeTruthy();
    expect(geo.objectFit).toBe("contain");
    expect(geo.fillRatio).toBeGreaterThan(0.9);
    expect(geo.overflowX).toBeLessThanOrEqual(2);
  });

  test("J gallery thumb and zoom still work", async ({ page }) => {
    await openDetail(page, 390);
    const thumbs = page.locator(".book-gallery-thumb");
    await expect.poll(async () => thumbs.count()).toBeGreaterThan(0);
    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveClass(/is-active/);
    await page.locator(".book-cover-box img").click();
    await expect(page.locator(".cover-zoom-overlay")).toBeVisible();
    await page.locator(".cover-zoom-close").click();
    await expect(page.locator(".cover-zoom-overlay")).toHaveCount(0);
  });

  test("K L 768 and 1366 stay usable without overflow", async ({ page }) => {
    for (const width of [768, 1366]) {
      await openDetail(page, width);
      const geo = await page.evaluate(coverMetrics());
      expect(geo.missing, String(width)).toBeFalsy();
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      expect(geo.objectFit, String(width)).toBe("contain");
    }
    await openDetail(page, 1366);
    const desktop = await page.evaluate(coverMetrics());
    expect(Number.parseFloat(desktop.minHeight) || 0).toBeGreaterThanOrEqual(400);
  });

  test("light and dark 390 cover stays contained", async ({ page }) => {
    await openDetail(page, 390);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((next) => {
        document.body.classList.toggle("dark-mode", next === "dark");
        document.documentElement.classList.toggle("dark-mode", next === "dark");
      }, mode);
      const geo = await page.evaluate(coverMetrics());
      expect(geo.objectFit, mode).toBe("contain");
      expect(geo.padX, mode).toBeLessThanOrEqual(16);
    }
  });

  async function shotTitleAuthor(page, filename) {
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    const clip = await page.evaluate(() => {
      const h1 = document.querySelector(".book-detail-info h1");
      const author = document.querySelector(".book-detail-info .book-author");
      if (!h1 || !author) return null;
      const a = h1.getBoundingClientRect();
      const b = author.getBoundingClientRect();
      const left = Math.max(0, Math.min(a.left, b.left) - 12);
      const top = Math.max(0, Math.min(a.top, b.top) - 12);
      const right = Math.max(a.right, b.right) + 12;
      const bottom = Math.max(a.bottom, b.bottom) + 12;
      return { x: left, y: top, width: right - left, height: bottom - top };
    });
    if (!clip) return;
    await page.screenshot({ path: path.join(outDir, filename), clip });
  }

  test("detail author is 15px on mobile and 17px on desktop", async ({ page }) => {
    for (const width of [390, 430, 768]) {
      await openDetail(page, width);
      await page.locator(".book-detail-info .book-author").scrollIntoViewIfNeeded();
      await expect(page.locator(".book-detail-info .book-author")).toBeVisible();
      const geo = await page.evaluate(authorMetrics());
      expect(geo.missing, String(width)).toBeFalsy();
      expect(geo.hidden, String(width)).toBeFalsy();
      expect(geo.text, String(width)).toContain(DETAIL_AUTHOR);
      expect(geo.fontPx, String(width)).toBeGreaterThanOrEqual(14.5);
      expect(geo.fontPx, String(width)).toBeLessThanOrEqual(15.5);
      expect(geo.fontPx, String(width)).not.toBeCloseTo(10.5, 1);
      expect(geo.clipped, String(width)).toBeFalsy();
      expect(geo.height, String(width)).toBeGreaterThan(16);
      expect(geo.overflowX, String(width)).toBeLessThanOrEqual(2);
      await shotTitleAuthor(page, `stage6_detail_author_${width}_light.png`);
    }
    await openDetail(page, 1366);
    await page.locator(".book-detail-info .book-author").scrollIntoViewIfNeeded();
    await expect(page.locator(".book-detail-info .book-author")).toBeVisible();
    const desktop = await page.evaluate(authorMetrics());
    expect(desktop.missing).toBeFalsy();
    expect(desktop.hidden).toBeFalsy();
    expect(desktop.text).toContain(DETAIL_AUTHOR);
    expect(desktop.fontPx).toBeGreaterThanOrEqual(16.5);
    expect(desktop.fontPx).toBeLessThanOrEqual(17.5);
    expect(desktop.clipped).toBeFalsy();
    expect(desktop.overflowX).toBeLessThanOrEqual(2);
    await shotTitleAuthor(page, "stage6_detail_author_1366_light.png");
    await openDetail(page, 390);
    await page.evaluate(() => {
      document.body.classList.add("dark-mode");
      document.documentElement.classList.add("dark-mode");
    });
    await page.locator(".book-detail-info .book-author").scrollIntoViewIfNeeded();
    const dark = await page.evaluate(authorMetrics());
    expect(dark.fontPx).toBeGreaterThanOrEqual(14.5);
    expect(dark.fontPx).toBeLessThanOrEqual(15.5);
    await shotTitleAuthor(page, "stage6_detail_author_390_dark.png");
  });

  test("preview screenshots of detail cover", async ({ page }) => {
    const outDir = "/opt/cursor/artifacts/screenshots";
    fs.mkdirSync(outDir, { recursive: true });
    await openDetail(page, 390);
    await page.locator(".book-cover-column").screenshot({
      path: path.join(outDir, "book-detail-cover-390.png")
    });
    await openDetail(page, 1366);
    await page.locator(".book-detail-top").screenshot({
      path: path.join(outDir, "book-detail-cover-1366.png")
    });
  });
});
