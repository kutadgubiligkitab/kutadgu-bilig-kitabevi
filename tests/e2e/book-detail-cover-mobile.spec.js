const { test, expect } = require("./playwright-test");
const H = require("./helpers");
const fs = require("fs");
const path = require("path");

const DETAIL_TITLE = "سوغۇق يۈكلەش تەپسىلات كىتابى";

function bookRow(overrides) {
  return {
    id: 91001,
    title: DETAIL_TITLE,
    author: "سىناق ئاپتور",
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
